// 验证新建汇率弹窗：打开、预填、校验、提交、关闭
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173';
const PORT = 9341;

const { spawn } = require('node:child_process');
const fs = require('node:fs');

const profile = `${process.env.TEMP}/cdp-rate-create-${Date.now()}`;
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
    const res = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.text);
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
    }).then(r => r.json()).then(j => j.success ? j.data.accessToken : 'failed').catch(e => 'threw: ' + e.message)
  `);
  if (login === 'failed' || login.startsWith('threw')) throw new Error(`登录失败：${login}`);
  const AUTH = JSON.stringify({ authorization: `Bearer ${login}` });

  await send('Page.navigate', { url: `${BASE}/admin/exchange-rates` });
  await sleep(3000);

  const report = {};

  // 页面里不应再有内嵌的新增面板
  report.noInlinePanel = await evaluate(`
    (() => {
      const text = document.body.innerText;
      return !text.includes('同一币种对同一天已有记录时会覆盖原值');
    })()
  `);

  // 点「新增汇率」打开弹窗
  await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '新增汇率');
      if (btn) btn.click();
      return !!btn;
    })()
  `);
  await sleep(700);

  report.dialog = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return { missing: true };
      const r = d.getBoundingClientRect();
      const text = d.innerText;
      return {
        centered: Math.abs((r.left + r.right) / 2 - window.innerWidth / 2) < 4,
        isModal: d.getAttribute('aria-modal') === 'true',
        hasTitle: text.includes('新增汇率'),
        hasSubtitle: text.includes('系统参考汇率'),
        selects: d.querySelectorAll('select').length,
        hasRateInput: !!d.querySelector('input[inputmode="decimal"]'),
        hasDateInput: !!d.querySelector('input[type="date"]'),
        hasOverwriteHint: text.includes('直接覆盖原值'),
        dateMaxIsToday: (() => {
          const input = d.querySelector('input[type="date"]');
          return input ? input.max === new Date().toISOString().slice(0, 10) : null;
        })(),
        submitDisabledWhenEmpty: (() => {
          const b = [...d.querySelectorAll('button')].find(x => x.textContent.trim() === '保存');
          return b ? b.disabled : 'no-save';
        })(),
      };
    })()
  `);

  // 两个币种选成一样时提示并禁用提交
  report.sameCurrency = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      const selects = d.querySelectorAll('select');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(selects[1], selects[0].value);
      selects[1].dispatchEvent(new Event('change', { bubbles: true }));
      return selects[0].value + '=' + selects[1].value;
    })()
  `);
  await sleep(400);
  report.sameCurrencyBlocked = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      const rect = d.querySelectorAll('select');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      // 换回一个不同的币种，避免影响后续提交
      const other = [...rect[1].options].map(o => o.value).find(v => v !== rect[0].value);
      setter.call(rect[1], other);
      rect[1].dispatchEvent(new Event('change', { bubbles: true }));
      return d.innerText.includes('不能相同');
    })()
  `);

  // 填一个合法汇率并提交
  const today = new Date().toISOString().slice(0, 10);
  await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      const input = d.querySelector('input[inputmode="decimal"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '6.5432');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    })()
  `);
  await sleep(400);

  const submitted = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      const b = [...d.querySelectorAll('button')].find(x => x.textContent.trim() === '保存');
      if (!b || b.disabled) return 'disabled';
      b.click();
      return 'clicked';
    })()
  `);
  await sleep(1800);

  report.submit = {
    action: submitted,
    dialogClosed: await evaluate(`!document.querySelector('[role="dialog"]')`),
    noticeShown: (await evaluate('document.body.innerText')).includes('汇率已新增'),
  };

  // 回查落库
  const saved = await evaluate(`
    fetch('/api/admin/exchange-rates/latest?page=1&pageSize=100', {
      credentials: 'include', headers: ${AUTH},
    })
      .then(r => r.json())
      .then(j => j.data.exchangeRates
        .filter(r => r.rateDate.slice(0, 10) === '${today}' && r.rate === '6.5432000000')
        .map(r => ({ id: r.id, pair: r.baseCurrency + '->' + r.quoteCurrency })))
      .catch(() => null)
  `);
  report.submit.persisted = saved;

  // 再打开一次，确认上次的值不残留
  await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '新增汇率');
      if (btn) btn.click();
      return !!btn;
    })()
  `);
  await sleep(600);
  report.reopen = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      return d ? { rate: d.querySelector('input[inputmode="decimal"]').value } : null;
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

  // 只删本次新建的那一条
  const persisted = Array.isArray(saved) ? saved : [];
  await evaluate(`
    Promise.all(${JSON.stringify(persisted.map((r) => r.id))}.map(id =>
      fetch('/api/admin/exchange-rates/' + id, { method: 'DELETE', credentials: 'include', headers: ${AUTH} })
    )).then(() => 'cleaned').catch(() => 'cleanup-failed')
  `);

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
