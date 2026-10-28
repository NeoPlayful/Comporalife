// 验证动作色拆分：实心按钮变深、Logo 与进度条保持原 accent、禁用态仍可读
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173';
const PORT = 9346;

const { spawn } = require('node:child_process');

const profile = `${process.env.TEMP}/cdp-action-${Date.now()}`;
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
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.text);
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
    await sleep(1500);
  };

  await send('Page.enable');
  await send('Runtime.enable');

  // 登录：token 只存内存，必须走真实表单
  await goto('/login');
  const login = await evaluate(`(async () => {
    const setter = (el, value) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const email = document.querySelector('input[type="email"], input[name="email"]');
    const password = document.querySelector('input[type="password"]');
    if (!email || !password) return { ok: false, reason: 'inputs not found' };
    setter(email, 'admin@comporalife.com');
    setter(password, 'admin123');
    await new Promise((r) => setTimeout(r, 200));
    document.querySelector('form').requestSubmit();
    await new Promise((r) => setTimeout(r, 2500));
    return { ok: !location.pathname.includes('/login'), path: location.pathname };
  })()`);

  const setTheme = async (dark) => {
    await evaluate(`(() => {
      const el = JSON.parse(localStorage.getItem('cl-ui') || '{"state":{}}');
      el.state = { ...(el.state || {}), theme: '${dark ? 'dark' : 'light'}' };
      localStorage.setItem('cl-ui', JSON.stringify(el));
      document.documentElement.classList.toggle('dark', ${dark});
      document.documentElement.style.colorScheme = '${dark ? 'dark' : 'light'}';
    })()`);
  };

  // 读取 token 与 accent/action 变量，并用 canvas 把任意色值解析成 rgb
  const tokens = await evaluate(`(() => {
    const probe = (v) => {
      const c = document.createElement('canvas'); c.width = c.height = 1;
      const ctx = c.getContext('2d');
      ctx.clearRect(0,0,1,1);
      ctx.fillStyle = v; ctx.fillRect(0,0,1,1);
      const d = ctx.getImageData(0,0,1,1).data;
      return [d[0], d[1], d[2], d[3]];
    };
    const s = getComputedStyle(document.documentElement);
    const names = ['accent','action','action-hover','action-active','action-disabled'];
    const out = {};
    for (const n of names) {
      const raw = s.getPropertyValue('--color-' + n).trim();
      out[n] = { raw, rgb: raw ? probe(raw) : null };
    }
    return out;
  })()`);

  const results = { login, tokens, dark: {}, light: {} };

  // 各页面：抓一个实心按钮 + Logo；确认按钮底色 & Logo 底色分属两个 token
  const pages = [
    { path: '/settings', label: '设置页保存' },
    { path: '/assets', label: '资产页新建按钮' },
    { path: '/categories', label: '分类页新建' },
    { path: '/portfolios', label: '组合页新建' },
    { path: '/accounts', label: '账户页新建' },
  ];

  for (const dark of [true, false]) {
    const key = dark ? 'dark' : 'light';
    await setTheme(dark);
    await goto('/');
    for (const p of pages) {
      await goto(p.path);
      const info = await evaluate(`(() => {
        const rgb = (el) => getComputedStyle(el).backgroundColor;
        const logos = [...document.querySelectorAll('aside .rounded-lg, .rounded-xl')]
          .filter((el) => el.className.includes('bg-[var(--color-accent)]'));
        const actions = [...document.querySelectorAll('.btn-action')];
        const firstEnabled = actions.find((el) => !el.disabled);
        const firstDisabled = actions.find((el) => el.disabled);
        return {
          logoCount: logos.length,
          logoBg: logos[0] ? rgb(logos[0]) : null,
          actionCount: actions.length,
          actionBg: firstEnabled ? rgb(firstEnabled) : null,
          actionColor: firstEnabled ? getComputedStyle(firstEnabled).color : null,
          disabledBg: firstDisabled ? rgb(firstDisabled) : null,
          disabledColor: firstDisabled ? getComputedStyle(firstDisabled).color : null,
          legacyAccentButtons: [...document.querySelectorAll('button, a')]
            .filter((el) => el.className.includes('bg-[var(--color-accent)]')).length,
        };
      })()`);
      results[key][p.path] = info;
    }
  }

  // 禁用态对比度实测：打开资产页新建弹窗（保存按钮初始 disabled）
  await setTheme(false);
  await goto('/assets');
  const disabledLight = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.disabled && b.className.includes('btn-action'));
    if (!btn) return null;
    const b = getComputedStyle(btn).backgroundColor;
    const f = getComputedStyle(btn).color;
    return { bg: b, fg: f, text: btn.textContent.trim() };
  })()`);

  console.log(JSON.stringify({ ...results, disabledLight, consoleErrors }, null, 2));

  ws.close();
  chrome.kill();
}

main().catch((err) => {
  console.error(err);
  chrome.kill();
  process.exit(1);
});
