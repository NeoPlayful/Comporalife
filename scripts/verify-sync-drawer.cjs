// 用无头 Chrome 的 CDP 验证同步设置抽屉：不截图、不做视觉识别，只看 DOM 与接口
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173';
const PORT = 9334;

const { spawn } = require('node:child_process');
const fs = require('node:fs');

const profile = `${process.env.TEMP}/cdp-sync-drawer-${Date.now()}`;
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  'about:blank',
], { stdio: 'ignore' });

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
    return res.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');

  await send('Page.navigate', { url: `${BASE}/` });
  await sleep(1500);

  const login = await evaluate(`
    fetch('/api/auth/login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@comporalife.com', password: 'admin123' }),
    }).then(r => r.json()).then(j => j.success ? 'ok' : 'failed').catch(e => 'threw: ' + e.message)
  `);
  if (login !== 'ok') throw new Error(`登录失败：${login}`);

  await send('Page.navigate', { url: `${BASE}/admin/exchange-rates` });
  await sleep(2500);

  const before = await evaluate('document.body.innerText');
  const report = {};
  report.syncBar = {
    hasSummary: /自动同步已(开启|关闭)/.test(before),
    hasSettingsButton: before.includes('同步设置'),
    hasSyncNow: before.includes('立即同步'),
    // 旧的铺开式状态文字应已收进抽屉
    noOldInlineHint: !before.includes('汇率源地址与密钥由部署环境配置'),
  };

  // 打开抽屉
  const opened = await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '同步设置');
      if (!btn) return 'no-button';
      btn.click();
      return 'clicked';
    })()
  `);
  await sleep(900);

  const drawer = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return null;
      const r = d.getBoundingClientRect();
      return {
        rightAligned: Math.abs(r.right - window.innerWidth) < 2,
        fullHeight: Math.abs(r.height - window.innerHeight) < 2,
        width: Math.round(r.width),
        text: d.innerText,
      };
    })()
  `);

  report.drawer = drawer
    ? {
        opened,
        rightAligned: drawer.rightAligned,
        fullHeight: drawer.fullHeight,
        width: drawer.width,
        hasScopeHint: drawer.text.includes('不会覆盖同一天已经人工录入的汇率'),
        hasEnable: drawer.text.includes('开启自动同步'),
        hasFrequency: drawer.text.includes('更新频率'),
        frequencies: ['每小时', '每天', '每周'].filter((f) => drawer.text.includes(f)),
        hasLastSync: drawer.text.includes('上次同步'),
        hasNextSync: drawer.text.includes('下次同步'),
        notConfiguredBanner: drawer.text.includes('尚未配置外部汇率源'),
        hasSave: drawer.text.includes('保存'),
        hasCancel: drawer.text.includes('取消'),
      }
    : { opened, missing: true };

  // 未配置汇率源时开关必须禁用
  report.switchDisabled = await evaluate(`
    (() => {
      const sw = document.querySelector('[role="switch"]');
      return sw ? sw.disabled : 'no-switch';
    })()
  `);

  // Esc 关闭
  await evaluate(`
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  `);
  await sleep(500);
  report.escCloses = await evaluate(`!document.querySelector('[role="dialog"]')`);

  report.consoleErrors = consoleErrors;
  console.log(JSON.stringify(report, null, 2));

  ws.close();
  chrome.kill();
  await sleep(300);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Windows 偶发占用 */
  }
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  chrome.kill();
  process.exit(1);
});
