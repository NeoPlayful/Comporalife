// 验证主题目录拆分：双主题下的图表配色、语义变量、首屏脚本
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173';
const PORT = 9337;

const { spawn } = require('node:child_process');

const profile = `${process.env.TEMP}/cdp-theme-${Date.now()}`;
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
    await sleep(1200);
  };

  await send('Page.enable');
  await send('Runtime.enable');

  // 1. 首屏脚本：默认（无 cl-ui）应为深色，且 html 上没有硬编码之前的空白期
  await goto('/login');
  const firstPaint = await evaluate(`(() => ({
    hasDark: document.documentElement.classList.contains('dark'),
    colorScheme: document.documentElement.style.colorScheme,
  }))()`);

  // 2. 写入浅色偏好后刷新，head 脚本应让首屏就是浅色
  await evaluate(`localStorage.setItem('cl-ui', JSON.stringify({ state: { theme: 'light', language: 'zh-CN', sidebarCollapsed: false }, version: 0 }))`);
  await goto('/login');
  const lightStored = await evaluate(`(() => ({
    hasDark: document.documentElement.classList.contains('dark'),
    colorScheme: document.documentElement.style.colorScheme,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }))()`);

  // 3. system 模式跟随系统（headless 默认 light）
  await evaluate(`localStorage.setItem('cl-ui', JSON.stringify({ state: { theme: 'system', language: 'zh-CN', sidebarCollapsed: false }, version: 0 }))`);
  await goto('/login');
  const systemResolved = await evaluate(`(() => ({
    prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    hasDark: document.documentElement.classList.contains('dark'),
  }))()`);

  // 4. 语义变量是否都能解析（--color-warning 之前缺失）
  const tokens = await evaluate(`(() => {
    const s = getComputedStyle(document.documentElement);
    const names = ['surface','surface-raised','border-subtle','content','content-muted','positive','negative','warning','accent','switch-on','switch-off'];
    const out = {};
    for (const n of names) out[n] = s.getPropertyValue('--color-' + n).trim();
    return out;
  })()`);

  // 5. 浅色与深色下 --color-warning 都必须可被 canvas 解析
  const warningProbe = await evaluate(`(() => {
    const probe = (v) => {
      const c = document.createElement('canvas'); c.width = c.height = 1;
      const ctx = c.getContext('2d');
      ctx.clearRect(0,0,1,1);
      ctx.fillStyle = v; ctx.fillRect(0,0,1,1);
      const d = ctx.getImageData(0,0,1,1).data;
      return [d[0], d[1], d[2], d[3]];
    };
    const s = getComputedStyle(document.documentElement);
    return { warning: s.getPropertyValue('--color-warning').trim(), rgba: probe(s.getPropertyValue('--color-warning').trim()) };
  })()`);

  // 6. 登录后在两种主题下检查图表是否还有黑线
  const loginResult = await evaluate(`(async () => {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@comporalife.com', password: 'admin123' }),
    });
    const json = await res.json();
    return { ok: res.ok, status: res.status, hasToken: !!(json.data && json.data.accessToken) };
  })()`);

  const charts = {};
  for (const wantDark of [true, false]) {
    await evaluate(`(() => {
      const el = JSON.parse(localStorage.getItem('cl-ui') || '{"state":{}}');
      el.state = { ...(el.state || {}), theme: '${wantDark ? 'dark' : 'light'}' };
      localStorage.setItem('cl-ui', JSON.stringify(el));
      document.documentElement.classList.toggle('dark', ${wantDark});
      document.documentElement.style.colorScheme = '${wantDark ? 'dark' : 'light'}';
    })()`);
    await goto('/');
    await sleep(2500);
    charts[wantDark ? 'dark' : 'light'] = await evaluate(`(() => {
      const canvases = [...document.querySelectorAll('canvas')];
      let nearBlack = 0, total = 0;
      for (const c of canvases) {
        if (!c.width || !c.height) continue;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        const { data } = ctx.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 200) continue;
          total += 1;
          if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] < 40) nearBlack += 1;
        }
      }
      return { canvasCount: canvases.length, sampled: total, nearBlackPixels: nearBlack };
    })()`);
  }

  console.log(JSON.stringify({
    firstPaint, lightStored, systemResolved, tokens, warningProbe, loginResult, charts, consoleErrors: errors,
  }, null, 2));

  ws.close();
  chrome.kill();
}

main().catch((err) => {
  console.error(err);
  chrome.kill();
  process.exit(1);
});
