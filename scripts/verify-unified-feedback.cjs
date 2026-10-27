// 验证统一提示与确认框：真实登录后点击删除，检查 ConfirmDialog 与 toast
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173';
const PORT = 9340;
const EMAIL = 'admin@comporalife.com';
const PASSWORD = 'admin123';

const { spawn } = require('node:child_process');

const profile = `${process.env.TEMP}/cdp-confirm-${Date.now()}`;
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
  const errors = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.text);
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

  // 通过 DOM 填表单并提交，避免依赖内存中的 token
  const uiLogin = async (theme) => {
    await goto('/login');
    await evaluate(`localStorage.setItem('cl-ui', JSON.stringify({state:{theme:'${theme}',language:'zh-CN',sidebarCollapsed:false},version:0}))`);
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
      const form = email.closest('form');
      if (form) form.requestSubmit();
      return 'submitted';
    })()`);
    await sleep(2500);
    return evaluate(`({ path: location.pathname })`);
  };

  await send('Page.enable');
  await send('Runtime.enable');

  const result = {};

  // 1. 双主题下 token 可被 canvas 解析（toast 靠这些变量染色）
  const themes = {};
  for (const theme of ['dark', 'light']) {
    await goto('/login');
    await evaluate(`localStorage.setItem('cl-ui', JSON.stringify({state:{theme:'${theme}',language:'zh-CN',sidebarCollapsed:false},version:0}))`);
    await goto('/login');
    themes[theme] = await evaluate(`(() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const cx = cv.getContext('2d');
      const sample = (name) => {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        cx.clearRect(0,0,1,1); cx.fillStyle = v; cx.fillRect(0,0,1,1);
        const d = cx.getImageData(0,0,1,1).data;
        return { rgba: [d[0],d[1],d[2],d[3]] };
      };
      return { surfaceRaised: sample('--color-surface-raised'), content: sample('--color-content') };
    })()`);
  }
  result.themes = themes;

  // 2. 登录并进入后台汇率页，点删除触发 ConfirmDialog
  const afterLogin = await uiLogin('dark');
  result.login = afterLogin;

  await goto('/admin/exchange-rates');
  await sleep(1500);
  const onRates = await evaluate(`({
    path: location.pathname,
    tbodyRows: document.querySelectorAll('tbody tr').length,
    cards: document.querySelectorAll('.card').length,
    deleteButtons: [...document.querySelectorAll('button')].filter(b => /删除|delete/i.test((b.getAttribute('aria-label')||b.title||'').trim())).length,
    bodyText: document.body.innerText.slice(0, 300),
  })`);
  result.ratesPage = onRates;

  // 点第一行的删除按钮（aria-label 或 title 含删除/delete）
  result.confirm = await evaluate(`(async () => {
    const buttons = [...document.querySelectorAll('button')];
    const del = buttons.find((b) => {
      const label = (b.getAttribute('aria-label') || b.title || b.textContent || '').trim();
      return /删除|delete/i.test(label) && !b.disabled;
    });
    if (!del) return { found: false, sample: buttons.slice(0,12).map(b => (b.getAttribute('aria-label')||b.textContent||'').trim()).filter(Boolean) };
    del.click();
    await new Promise((r) => setTimeout(r, 500));
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { found: true, dialogOpened: false };
    const rect = dialog.getBoundingClientRect();
    const style = getComputedStyle(dialog.parentElement);
    const confirmBtn = [...dialog.querySelectorAll('button')].find((b) => /删除|delete|确认|confirm/i.test(b.textContent || ''));
    return {
      found: true,
      dialogOpened: true,
      centered: Math.abs((rect.left + rect.right) / 2 - window.innerWidth / 2) < 4,
      zIndex: style.zIndex,
      confirmTone: confirmBtn ? getComputedStyle(confirmBtn).backgroundColor : null,
      title: dialog.querySelector('h2')?.textContent ?? null,
    };
  })()`);

  result.consoleErrors = errors;
  console.log(JSON.stringify(result, null, 2));

  ws.close();
  chrome.kill();
}

main().catch((err) => {
  console.error(err);
  chrome.kill();
  process.exit(1);
});
