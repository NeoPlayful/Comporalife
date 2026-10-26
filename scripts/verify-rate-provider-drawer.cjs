// 验证后台汇率同步抽屉：数据源表单、密钥三态、权限收敛、保存后状态联动
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173';
const API = 'http://localhost:4000';
const PORT = 9361;
const EMAIL = 'admin@comporalife.com';
const PASSWORD = 'admin123';

const { spawn } = require('node:child_process');

const profile = `${process.env.TEMP}/cdp-rate-provider-${Date.now()}`;
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

async function apiLogin() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`API 登录失败：${body.error?.message}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { token: body.data.accessToken, cookie };
}

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
  const { token, cookie } = await apiLogin();

  const target = await pageTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  const nativeDialogs = [];

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
    // 原生 confirm 会阻塞渲染进程，后续 evaluate 全部挂住
    if (msg.method === 'Page.javascriptDialogOpening') {
      nativeDialogs.push(msg.params.message);
      ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: false } }));
    }
  };

  const send = (method, params = {}) => {
    id += 1;
    const msgId = id;
    ws.send(JSON.stringify({ id: msgId, method, params }));
    return Promise.race([
      new Promise((resolve) => pending.set(msgId, resolve)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000),
      ),
    ]);
  };

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text);
    }
    return res.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');

  const report = {};

  // 先清空配置，从未配置状态开始验证
  const reset = await fetch(`${API}/api/admin/rate-sync/provider`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Origin: BASE,
      Cookie: cookie,
    },
    body: JSON.stringify({
      provider: 'exchangerate-api',
      anchorCurrency: 'USD',
      apiKey: '',
      customUrl: '',
      ratesPath: 'rates',
      datePath: '',
    }),
  });
  report.reset = (await reset.json()).data;

  // ---- 登录 ----
  await send('Page.navigate', { url: `${BASE}/login` });
  await sleep(1500);
  await evaluate(`
    (() => {
      const email = document.querySelector('input[type="email"]');
      const pwd = document.querySelector('input[type="password"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(email, ${JSON.stringify(EMAIL)});
      email.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pwd, ${JSON.stringify(PASSWORD)});
      pwd.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form').requestSubmit();
      return true;
    })()
  `);
  await sleep(2500);
  report.login = await evaluate(`location.pathname`);

  // ---- 打开汇率管理页与抽屉 ----
  await send('Page.navigate', { url: `${BASE}/admin/exchange-rates` });
  await sleep(3000);

  report.pageLoad = await evaluate(`
    (() => ({
      path: location.pathname,
      hasHeading: document.body.innerText.includes('汇率'),
      syncBarShowsProvider: document.body.innerText.includes('数据源'),
    }))()
  `);

  await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '同步设置');
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `);
  await sleep(1200);

  // drawer 字段：数据源下拉、锚定币、密钥、保存按钮初始不可点
  report.drawerInitial = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return { missing: true };
      const selects = [...d.querySelectorAll('select')];
      const providerSelect = selects.find(s => [...s.options].some(o => o.value === 'openexchangerates'));
      const inputs = [...d.querySelectorAll('input')];
      return {
        open: true,
        providerOptions: providerSelect ? [...providerSelect.options].map(o => o.value) : null,
        providerDisabled: providerSelect ? providerSelect.disabled : null,
        hasAnchorInput: inputs.some(i => i.maxLength === 3),
        hasKeyInput: inputs.some(i => i.type === 'password'),
        saveDisabled: (() => {
          const btn = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === '保存');
          return btn ? btn.disabled : 'no-button';
        })(),
        textHasCustomUrl: d.innerText.includes('自定义地址'),
      };
    })()
  `);

  // ---- 切到需要密钥的预设：保存应被拦，提示缺密钥 ----
  report.requiresKey = await evaluate(`
    (async () => {
      const d = document.querySelector('[role="dialog"]');
      const selects = [...d.querySelectorAll('select')];
      const providerSelect = selects.find(s => [...s.options].some(o => o.value === 'openexchangerates'));
      const setSel = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setSel(providerSelect, 'openexchangerates');
      await new Promise(r => setTimeout(r, 500));
      const save = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === '保存');
      return {
        saveDisabled: save.disabled,
        hintShown: d.innerText.includes('必须提供密钥'),
      };
    })()
  `);

  // ---- 填密钥后保存，检查只回显末四位 ----
  report.saveWithKey = await evaluate(`
    (async () => {
      const d = document.querySelector('[role="dialog"]');
      const keyInput = [...d.querySelectorAll('input')].find(i => i.type === 'password');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(keyInput, 'integration-test-key-9999');
      keyInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));

      const save = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === '保存');
      const wasDisabled = save.disabled;
      save.click();
      await new Promise(r => setTimeout(r, 2600));

      const after = document.querySelector('[role="dialog"]');
      return {
        wasDisabled,
        dialogClosed: !after,
        bodyLeaksKey: document.body.innerText.includes('integration-test-key-9999'),
      };
    })()
  `);

  // 重新打开，确认末四位回显且输入框为空（不回填密钥）
  await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '同步设置');
      btn.click();
      return true;
    })()
  `);
  await sleep(1200);

  report.reopen = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return { missing: true };
      const keyInput = [...d.querySelectorAll('input')].find(i => i.type === 'password');
      const providerSelect = [...d.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'openexchangerates'));
      return {
        providerValue: providerSelect ? providerSelect.value : null,
        keyInputEmpty: keyInput ? keyInput.value === '' : null,
        showsHint9999: d.innerText.includes('9999'),
        hasClearCheckbox: !!d.querySelector('input[type="checkbox"]'),
      };
    })()
  `);

  // ---- 切到自定义源：出现地址与路径字段，非法地址被拒 ----
  report.customFields = await evaluate(`
    (async () => {
      const d = document.querySelector('[role="dialog"]');
      const providerSelect = [...d.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'custom'));
      const setSel = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setSel(providerSelect, 'custom');
      await new Promise(r => setTimeout(r, 500));

      const urlInput = [...d.querySelectorAll('input')].find(i => i.type === 'url');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(urlInput, 'http://insecure.example/rates');
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));

      const save = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === '保存');
      const rejected = {
        saveDisabled: save.disabled,
        invalidShown: d.innerText.includes('必须是 https 地址'),
        hasRatesPath: d.innerText.includes('汇率表路径'),
        hasDatePath: d.innerText.includes('日期字段路径'),
      };

      setter.call(urlInput, 'https://example.test/rates');
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      return { ...rejected, saveEnabledAfterFix: !save.disabled };
    })()
  `);

  // 关闭抽屉：改过内容会弹原生 confirm，脚本会自动取消，再按一次 Esc
  for (let i = 0; i < 3; i += 1) {
    const open = await evaluate(`document.querySelectorAll('[role="dialog"]').length`);
    if (!open) break;
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
    await sleep(500);
  }

  // ---- 恢复为免密钥预设 ----
  const restore = await fetch(`${API}/api/admin/rate-sync/provider`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Origin: BASE,
      Cookie: cookie,
    },
    body: JSON.stringify({
      provider: 'exchangerate-api',
      anchorCurrency: 'USD',
      apiKey: '',
      customUrl: '',
      ratesPath: 'rates',
      datePath: '',
    }),
  });
  report.restored = (await restore.json()).data;

  report.consoleErrors = consoleErrors;
  report.nativeDialogs = nativeDialogs;
  console.log(JSON.stringify(report, null, 2));

  ws.close();
  chrome.kill();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  chrome.kill();
  process.exit(1);
});
