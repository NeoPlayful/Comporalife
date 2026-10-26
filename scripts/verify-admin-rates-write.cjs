// 验证后台汇率页的写入路径：编辑抽屉保存、批量录入提交，最后回查接口确认落库
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173';
const PORT = 9337;

const { spawn } = require('node:child_process');
const fs = require('node:fs');

const profile = `${process.env.TEMP}/cdp-rate-write-${Date.now()}`;
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
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.text);
    }
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

  // 页面自己走 axios 带 token；脚本里的裸 fetch 显式带上同一个 token
  const AUTH = JSON.stringify({ authorization: `Bearer ${login}` });

  const today = new Date().toISOString().slice(0, 10);
  // 准备两条今天的数据，并把它们的 id 记下来，收尾时只删自己创建的行
  const seededIds = await evaluate(`
    fetch('/api/admin/exchange-rates/bulk', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...${AUTH} },
      body: JSON.stringify({
        rateDate: '${today}',
        rates: [
          { baseCurrency: 'USD', quoteCurrency: 'CNY', rate: '7.1111' },
          { baseCurrency: 'EUR', quoteCurrency: 'CNY', rate: '7.7777' },
        ],
      }),
    })
      .then(r => r.json())
      .then(j => (j.success ? j.data.exchangeRates.map(r => r.id) : []))
      .catch(() => [])
  `);

  await send('Page.navigate', { url: `${BASE}/admin/exchange-rates` });
  await sleep(3000);

  const report = {};

  // ── 编辑抽屉保存 ──
  // 表格按币种代码排序，第一行不一定是 USD，先把实际要编辑的那一对读出来
  const editPair = await evaluate(`
    (() => {
      const row = document.querySelector('table tbody tr');
      const btn = row?.querySelector('button[aria-label="编辑"]');
      if (!btn) return null;
      const cells = row.querySelectorAll('td');
      const text = cells[1]?.innerText ?? '';
      const m = text.match(/1\\s+([A-Z]{3})\\s*→\\s*([A-Z]{3})/);
      btn.click();
      return m ? { from: m[1], to: m[2] } : null;
    })()
  `);
  const editOpened = editPair ? 'clicked' : 'no-button';
  await sleep(700);

  const typed = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return 'no-dialog';
      const input = d.querySelector('input[inputmode="decimal"]');
      if (!input) return 'no-input';
      // React 受控输入必须走原生 setter 才能触发 onChange
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '8.8888');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    })()
  `);
  await sleep(400);

  const saveEnabled = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      const b = [...d.querySelectorAll('button')].find(x => x.textContent.trim() === '保存');
      return b ? !b.disabled : 'no-save';
    })()
  `);

  await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      const b = [...d.querySelectorAll('button')].find(x => x.textContent.trim() === '保存');
      if (b) b.click();
      return !!b;
    })()
  `);
  await sleep(1500);

  report.editSave = {
    opened: editOpened,
    pair: editPair,
    typed,
    saveEnabled,
    drawerClosed: await evaluate(`!document.querySelector('[role="dialog"]')`),
    noticeShown: (await evaluate('document.body.innerText')).includes('汇率已更新'),
  };

  // 回查接口确认数值真的落库（查实际编辑的那一对）
  const afterEdit = await evaluate(`
    fetch('/api/admin/exchange-rates/latest?base=${editPair?.from ?? 'USD'}&quote=${editPair?.to ?? 'CNY'}', {
      credentials: 'include', headers: ${AUTH},
    })
      .then(r => r.json())
      .then(j => (j.data.exchangeRates[0] ? j.data.exchangeRates[0].rate : null))
      .catch(() => null)
  `);
  report.editSave.persisted = afterEdit;

  // ── 批量录入 ──
  const selectedCount = await evaluate(`
    (() => {
      const cbs = [...document.querySelectorAll('table tbody input[type="checkbox"]')];
      cbs.forEach(cb => cb.click());
      return cbs.length;
    })()
  `);
  report.bulkSubmit = { selectedCount };
  await sleep(600);

  await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '批量录入');
      if (btn) btn.click();
      return !!btn;
    })()
  `);
  await sleep(800);

  const bulkFilled = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return 'no-dialog';
      const inputs = [...d.querySelectorAll('input[inputmode="decimal"]')];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      inputs.forEach((input, i) => {
        setter.call(input, i === 0 ? '9.1111' : '9.2222');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      return inputs.length;
    })()
  `);
  await sleep(400);

  await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      const b = [...d.querySelectorAll('button')].find(x => x.textContent.trim() === '提交');
      if (b) b.click();
      return b ? !b.disabled : 'no-submit';
    })()
  `);
  await sleep(2000);

  report.bulkSubmit.filledInputs = bulkFilled;
  report.bulkSubmit.drawerClosed = await evaluate(`!document.querySelector('[role="dialog"]')`);
  report.bulkSubmit.noticeShown = (await evaluate('document.body.innerText')).includes('已批量写入');

  const afterBulk = await evaluate(`
    fetch('/api/admin/exchange-rates/latest?page=1&pageSize=100', { credentials: 'include', headers: ${AUTH} })
      .then(r => r.json())
      .then(j => j.data.exchangeRates
        .filter(r => r.quoteCurrency === 'CNY' && (r.baseCurrency === 'USD' || r.baseCurrency === 'EUR'))
        .map(r => r.baseCurrency + '=' + r.rate))
      .catch(() => null)
  `);
  report.bulkSubmit.persisted = afterBulk;

  // ── 搜索按中文名命中 ──
  await evaluate(`
    (() => {
      const input = document.querySelector('input[placeholder*="搜索"]');
      if (!input) return 'no-search';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '欧元');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    })()
  `);
  await sleep(1200);
  report.searchByChineseName = await evaluate(`
    (() => {
      const tbody = document.querySelector('table tbody');
      if (!tbody) return 'no-table';
      const rows = [...tbody.querySelectorAll('tr')].map(tr => tr.innerText);
      return { rowCount: rows.length, rows };
    })()
  `);

  report.consoleErrors = consoleErrors;
  console.log(JSON.stringify(report, null, 2));

  // 只删本脚本创建的这两行，按 id 精确删除，不碰其他历史数据
  const ids = JSON.stringify(seededIds ?? []);
  const cleaned = await evaluate(`
    Promise.all(${ids}.map(id =>
      fetch('/api/admin/exchange-rates/' + id, { method: 'DELETE', credentials: 'include', headers: ${AUTH} })
    )).then(() => 'cleaned').catch(() => 'cleanup-failed')
  `);
  report.cleanup = { ids: seededIds, result: cleaned };

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
