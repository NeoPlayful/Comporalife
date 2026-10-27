// 验证用户端 toast 统一：真实登录后触发操作，检查提示出现、文案、以及浅色主题下的可读性
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173';
const PORT = 9345;
const EMAIL = 'admin@comporalife.com';
const PASSWORD = 'admin123';

const { spawn } = require('node:child_process');

const profile = `${process.env.TEMP}/cdp-toast-${Date.now()}`;
const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {
      /* 端口未就绪 */
    }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

async function main() {
  const target = await pageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let id = 0;
  const pending = new Map();
  const consoleErrors = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  };

  const send = (method, params = {}) => {
    id += 1;
    const msgId = id;
    ws.send(JSON.stringify({ id: msgId, method, params }));
    return new Promise((resolve) => pending.set(msgId, resolve));
  };

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.exception?.description ?? 'evaluate failed');
    }
    return res.result?.result?.value;
  };

  const goto = async (path) => {
    await send('Page.navigate', { url: `${BASE}${path}` });
    await sleep(1600);
  };

  const setTheme = async (theme) => {
    await goto('/login');
    await evaluate(
      `localStorage.setItem('cl-ui', JSON.stringify({state:{theme:'${theme}',language:'zh-CN',sidebarCollapsed:false},version:0}))`,
    );
    await goto('/login');
    // 服务端偏好会在登录后覆盖 localStorage，这里直接钉住 class，测的是渲染结果
    await evaluate(`document.documentElement.classList.toggle('dark', ${theme === 'dark'})`);
  };

  const uiLogin = async () => {
    await goto('/login');
    await evaluate(`(() => {
      const set = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const inputs = [...document.querySelectorAll('input')];
      const email = inputs.find((i) => i.type === 'email') || inputs[0];
      const password = inputs.find((i) => i.type === 'password');
      if (!email || !password) return 'missing';
      set(email, ${JSON.stringify(EMAIL)});
      set(password, ${JSON.stringify(PASSWORD)});
      email.closest('form')?.requestSubmit();
      return 'submitted';
    })()`);
    await sleep(2800);
    return evaluate(`location.pathname`);
  };

  await send('Page.enable');
  await send('Runtime.enable');

  const result = {};

  await setTheme('dark');
  result.loginPath = await uiLogin();
  await evaluate(`document.documentElement.classList.add('dark')`);

  // 1. 成功提示：汇率自选页加入一个币种对（确认按钮是页脚的主色按钮）
  await goto('/exchange-rates');
  await sleep(1200);
  result.addPair = await evaluate(`(async () => {
    const addBtn = [...document.querySelectorAll('button')].find((b) => /添加|Add/i.test(b.textContent || ''));
    if (!addBtn) return { found: false };
    addBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { found: true, dialog: false };

    // 主色按钮 = 对话框页脚里的提交按钮
    const submit = [...dialog.querySelectorAll('button')].find((b) =>
      /color-accent/.test(b.className) && !b.disabled,
    );
    if (!submit) {
      return {
        found: true,
        dialog: true,
        submit: false,
        buttons: [...dialog.querySelectorAll('button')].map((b) => ({ t: (b.textContent || '').trim(), c: b.className.slice(0, 60) })),
      };
    }
    submit.click();
    await new Promise((r) => setTimeout(r, 1500));

    const regions = [...document.querySelectorAll('div[style*="position: fixed"], div[aria-live]')];
    const toastNodes = [...document.querySelectorAll('div')].filter(
      (n) => getComputedStyle(n).position === 'fixed' && /cl-toast/.test(n.className || ''),
    );
    const anyClToast = [...document.querySelectorAll('.cl-toast')];
    const liveText = regions.map((n) => (n.textContent || '').trim()).filter(Boolean).slice(0, 5);
    return {
      found: true,
      dialog: true,
      submit: true,
      clToastCount: anyClToast.length,
      toastCount: toastNodes.length,
      toastText: (anyClToast[0] ?? toastNodes[0])?.textContent?.trim() ?? null,
      liveRegions: liveText,
      toastBg: anyClToast[0] ? getComputedStyle(anyClToast[0]).backgroundColor : null,
    };
  })()`);

  // 2. 全局兜底：断网后触发一个没有 onError 的 mutation（通知标记已读）
  await send('Network.enable');
  await goto('/notifications');
  await sleep(1200);
  await send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  result.fallback = await evaluate(`(async () => {
    const btn = [...document.querySelectorAll('button')].find((b) => /全部已读|全部标记|标记全部|Mark all/i.test(b.textContent || ''));
    if (!btn) return { found: false, buttons: [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).slice(0, 10) };
    if (btn.disabled) return { found: true, disabled: true };
    btn.click();
    await new Promise((r) => setTimeout(r, 2000));
    const anyClToast = [...document.querySelectorAll('.cl-toast')];
    return {
      found: true,
      clToastCount: anyClToast.length,
      toastText: anyClToast.map((n) => (n.textContent || '').trim()).filter(Boolean).slice(0, 3),
    };
  })()`);
  await send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });

  // 3. 主题色可读性：检查 --color-negative / --color-positive 的实际渲染值
  const sampleColor = async () =>
    evaluate(`(() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const cx = cv.getContext('2d');
      const sample = (name) => {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        cx.clearRect(0,0,1,1); cx.fillStyle = v; cx.fillRect(0,0,1,1);
        const d = cx.getImageData(0,0,1,1).data;
        return [d[0],d[1],d[2]];
      };
      return {
        positive: sample('--color-positive'),
        negative: sample('--color-negative'),
        accent: sample('--color-accent'),
        surface: sample('--color-surface'),
      };
    })()`);

  const luminance = ([r, g, b]) => {
    const lin = (c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const contrast = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    const hi = Math.max(la, lb);
    const lo = Math.min(la, lb);
    return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
  };

  await evaluate(`document.documentElement.classList.remove('dark'); document.documentElement.style.colorScheme='light'`);
  await sleep(400);
  const light = await sampleColor();
  result.lightTheme = {
    colors: light,
    positiveOnSurface: contrast(light.positive, light.surface),
    negativeOnSurface: contrast(light.negative, light.surface),
    accentOnSurface: contrast(light.accent, light.surface),
  };

  await evaluate(`document.documentElement.classList.add('dark'); document.documentElement.style.colorScheme='dark'`);
  await sleep(400);
  const dark = await sampleColor();
  result.darkTheme = {
    colors: dark,
    positiveOnSurface: contrast(dark.positive, dark.surface),
    negativeOnSurface: contrast(dark.negative, dark.surface),
    accentOnSurface: contrast(dark.accent, dark.surface),
  };

  // 4. 确认页面已无遗留结果横幅（检查若干页面首屏不应出现 emerald 卡片式提示）
  const banners = {};
  for (const path of ['/settings', '/profile', '/categories', '/accounts']) {
    await goto(path);
    await sleep(900);
    banners[path] = await evaluate(`(() => {
      const hits = [...document.querySelectorAll('p,div')].filter((n) => {
        const c = getComputedStyle(n);
        return /emerald/.test(n.className || '') && n.textContent && n.textContent.trim().length < 60;
      });
      return { inlineEmeraldBanners: hits.length, sample: hits.slice(0,2).map(n=>n.textContent.trim()) };
    })()`);
  }
  result.banners = banners;

  result.consoleErrors = consoleErrors;
  console.log(JSON.stringify(result, null, 2));

  ws.close();
  chrome.kill();
}

main().catch((err) => {
  console.error(err);
  chrome.kill();
  process.exit(1);
});
