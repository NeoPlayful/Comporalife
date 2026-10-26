// 验证币种扩充与国旗：下拉选项、SVG 渲染、汇率页币种对、精度显示
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173';
const PORT = 9371;
const EMAIL = 'admin@comporalife.com';
const PASSWORD = 'admin123';

const { spawn } = require('node:child_process');

const profile = `${process.env.TEMP}/cdp-currency-flags-${Date.now()}`;
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
    // 原生 confirm 会阻塞渲染进程：不自动应答，后续 evaluate 会全部超时
    if (msg.method === 'Page.javascriptDialogOpening') {
      nativeDialogs.push(msg.params.message);
      ws.send(
        JSON.stringify({
          id: ++id,
          method: 'Page.handleJavaScriptDialog',
          params: { accept: false },
        }),
      );
    }
  };

  const send = (method, params = {}) => {
    id += 1;
    const msgId = id;
    ws.send(JSON.stringify({ id: msgId, method, params }));
    return Promise.race([
      new Promise((resolve) => pending.set(msgId, resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000)),
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

  const report = {};
  const step = (name) => console.error('STEP ' + name);

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

  // ---- 设置页：基准币种下拉 ----
  step('settings-nav');
  await send('Page.navigate', { url: `${BASE}/settings` });
  await sleep(2500);

  step('settings-eval');
  report.settings = await evaluate(`
    (() => {
      const selects = [...document.querySelectorAll('select')];
      const currencySelect = selects.find(s => [...s.options].some(o => o.value === 'VND'));
      if (!currencySelect) return { missing: true, selectCount: selects.length };
      const options = [...currencySelect.options].map(o => o.textContent.trim());
      const wrapper = currencySelect.parentElement;
      const flag = wrapper ? wrapper.querySelector('svg') : null;
      return {
        optionCount: options.length,
        firstSix: options.slice(0, 6),
        hasVietnam: options.some(o => o.includes('VND')),
        hasIsrael: options.some(o => o.includes('ILS')),
        optionHasName: options.some(o => o.includes('·')),
        flagSvgRendered: !!flag,
        flagWidth: flag ? Math.round(flag.getBoundingClientRect().width) : 0,
      };
    })()
  `);

  // ---- 账户页：新建账户弹窗 ----
  step('accounts-nav');
  await send('Page.navigate', { url: `${BASE}/accounts` });
  await sleep(3000);

  await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('新建'));
      if (btn) btn.click();
      return !!btn;
    })()
  `);
  await sleep(1500);

  step('account-dialog-eval');
  report.accountDialog = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return { missing: true };
      const select = [...d.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'THB'));
      if (!select) return { missing: 'currency-select' };
      const options = [...select.options].map(o => o.textContent.trim());
      const wrapper = select.parentElement;
      const flag = wrapper ? wrapper.querySelector('svg') : null;
      return {
        optionCount: options.length,
        optionsWithNames: options.filter(o => o.includes('·')).length,
        flagSvgRendered: !!flag,
        flagIsSvg: flag ? flag.tagName.toLowerCase() === 'svg' : false,
      };
    })()
  `);

  // 切到 VND（0 位小数币种）确认选择生效
  report.selectVnd = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return { missing: 'no-dialog' };
      const select = [...d.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'VND'));
      if (!select) return { missing: 'no-select' };
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, 'VND');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.value;
    })()
  `);
  await sleep(500);

  report.flagAfterChange = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return { missing: 'no-dialog' };
      const select = [...d.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'VND'));
      if (!select) return { missing: 'no-select' };
      const svg = select.parentElement.querySelector('svg');
      return {
        selectValue: select.value,
        flagRendered: !!svg,
        // 越南国旗是红底黄星，取 fill 是否包含红色系
        hasRedFill: svg ? /#DA251D|da251d|red/i.test(svg.outerHTML) : false,
      };
    })()
  `);

  // 关闭弹窗
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
  await sleep(600);

  // ---- 汇率管理页：币种对是否渲染旗帜 ----
  step('rates-nav');
  await send('Page.navigate', { url: `${BASE}/admin/exchange-rates` });
  await sleep(3000);

  step('rates-eval');
  report.ratesPage = await evaluate(`
    (() => {
      const table = document.querySelector('table');
      const svgCount = document.querySelectorAll('table tbody svg').length;
      const filterSelect = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'PLN'));
      return {
        hasTable: !!table,
        svgInRows: svgCount,
        filterHasNames: filterSelect ? [...filterSelect.options].filter(o => o.textContent.includes('·')).length : null,
      };
    })()
  `);

  // ---- 用户汇率页 ----
  step('user-rates-nav');
  await send('Page.navigate', { url: `${BASE}/exchange-rates` });
  await sleep(2500);

  step('user-rates-eval');
  report.userRatesPage = await evaluate(`
    (() => {
      const svgs = document.querySelectorAll('main svg');
      return { svgCount: svgs.length, bodyHasPair: document.body.innerText.includes('→') };
    })()
  `);

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
