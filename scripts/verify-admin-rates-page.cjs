// 用无头 Chrome 的 CDP 验证后台汇率页：不截图、不做视觉识别，只看 DOM 与接口
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173';
const PORT = 9336;

const { spawn } = require('node:child_process');
const fs = require('node:fs');

const profile = `${process.env.TEMP}/cdp-rate-page-${Date.now()}`;
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
    }).then(r => r.json()).then(j => j.success ? 'ok' : 'failed').catch(e => 'threw: ' + e.message)
  `);
  if (login !== 'ok') throw new Error(`登录失败：${login}`);

  // 确保至少有一条汇率可操作
  await evaluate(`
    fetch('/api/admin/exchange-rates', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseCurrency: 'USD', quoteCurrency: 'CNY', rate: '7.2',
        rateDate: new Date().toISOString().slice(0, 10),
      }),
    }).then(r => r.json()).then(j => j.success ? 'ok' : 'failed').catch(e => 'threw: ' + e.message)
  `);

  await send('Page.navigate', { url: `${BASE}/admin/exchange-rates` });
  await sleep(3000);

  const report = {};

  const text = await evaluate('document.body.innerText');
  report.header = {
    hasSyncSettings: text.includes('同步设置'),
    hasSyncNow: text.includes('立即同步'),
    hasNew: text.includes('新增汇率'),
    hasSyncSummary: /自动同步已(开启|关闭)/.test(text),
  };

  report.stats = {
    hasPairs: text.includes('覆盖币种对'),
    hasStale: text.includes('滞后币种对'),
    hasSource: text.includes('来源构成'),
    hasLastSync: text.includes('最近同步'),
  };

  report.toolbar = {
    // 视图切换已移除：两个按钮都不该再出现，页面上只剩当前汇率这一张表
    tabsRemoved: !text.includes('同步记录') && !text.includes('当前汇率'),
    hasSearch: await evaluate(`document.querySelectorAll('input').length > 0`),
    hasFilters: ['筛选基准币', '筛选计价币', '筛选来源'].every((v) => text.includes(v)),
    hasRefresh: text.includes('刷新'),
  };

  report.table = await evaluate(`
    (() => {
      const table = document.querySelector('table');
      if (!table) return { missing: true };
      const head = table.querySelector('thead').innerText;
      const bodyText = table.querySelector('tbody').innerText;
      const checkboxes = table.querySelectorAll('input[type="checkbox"]').length;
      return {
        columns: head.split(/\\s+/).filter(Boolean),
        hasLagColumn: head.includes('滞后'),
        hasCurrencyName: bodyText.includes('美元') || bodyText.includes('人民币'),
        checkboxCount: checkboxes,
      };
    })()
  `);

  // 选中一行 → 批量条出现
  await evaluate(`
    (() => {
      const cb = document.querySelector('table tbody input[type="checkbox"]');
      if (cb) cb.click();
      return !!cb;
    })()
  `);
  await sleep(400);
  const afterSelect = await evaluate('document.body.innerText');
  report.bulkBar = {
    appeared: afterSelect.includes('已选'),
    hasOpen: afterSelect.includes('批量录入'),
    hasDelete: afterSelect.includes('批量删除'),
  };

  // 打开批量录入抽屉
  const bulkOpened = await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '批量录入');
      if (!btn) return 'no-button';
      btn.click();
      return 'clicked';
    })()
  `);
  await sleep(700);
  report.bulkDrawer = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return { opened: '${bulkOpened}', missing: true };
      const r = d.getBoundingClientRect();
      const text = d.innerText;
      return {
        opened: '${bulkOpened}',
        rightAligned: Math.abs(r.right - window.innerWidth) < 2,
        fullHeight: Math.abs(r.height - window.innerHeight) < 2,
        hasTitle: text.includes('批量录入汇率'),
        hasDate: !!d.querySelector('input[type="date"]'),
        rowInputs: d.querySelectorAll('input[inputmode="decimal"]').length,
        hasFilledCounter: /已填写 \\d+ \\/ \\d+/.test(text),
        hasSubmit: text.includes('提交'),
      };
    })()
  `);
  await evaluate(`
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  `);
  await sleep(500);
  report.bulkEscCloses = await evaluate(`!document.querySelector('[role="dialog"]')`);

  // 编辑弹窗：与新建同为居中弹窗，不是右侧抽屉
  await evaluate(`
    (() => {
      const btn = document.querySelector('table tbody button[aria-label="编辑"]');
      if (!btn) return 'no-button';
      btn.click();
      return 'clicked';
    })()
  `);
  await sleep(700);
  report.editDialog = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return { missing: true };
      const r = d.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const text = d.innerText;
      return {
        hasTitle: text.includes('编辑汇率'),
        hasRateInput: !!d.querySelector('input[inputmode="decimal"]'),
        hasSourceManual: text.includes('人工录入'),
        hasSourceProvider: text.includes('自动同步'),
        hasCurrentValue: text.includes('当前值'),
        // 居中而不是贴右边：两侧留白都要有
        centered: Math.abs(cx - window.innerWidth / 2) < 3 && r.right < window.innerWidth - 8,
        notFullHeight: r.height < window.innerHeight - 8,
        dateLocked: !!d.querySelector('input[type="date"][disabled]'),
        saveDisabledInitially: (() => {
          const b = [...d.querySelectorAll('button')].find(x => x.textContent.trim() === '保存');
          return b ? b.disabled : 'no-save';
        })(),
      };
    })()
  `);
  await evaluate(`
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  `);
  await sleep(500);

  // 历史弹窗
  await evaluate(`
    (() => {
      const btn = document.querySelector('table tbody button[aria-label="查看走势"]');
      if (!btn) return 'no-button';
      btn.click();
      return 'clicked';
    })()
  `);
  await sleep(1500);
  report.historyDialog = await evaluate(`
    (() => {
      const d = [...document.querySelectorAll('div')].find(el => el.innerText && el.innerText.includes('汇率走势') && el.className.includes('card'));
      if (!d) return { missing: true };
      const text = d.innerText;
      return {
        hasRanges: ['7 天', '30 天', '90 天'].every(v => text.includes(v)),
        hasChart: !!d.querySelector('canvas'),
        // 有数据时不该出现反向提示
        invertedHintShown: text.includes('反向汇率的倒数'),
      };
    })()
  `);

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
