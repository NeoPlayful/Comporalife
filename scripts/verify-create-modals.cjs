// 逐页验证「新建」入口统一为弹窗：语义、背景锁定、焦点回收、Esc、取消确认
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173';
const PORT = 9343;

const { spawn } = require('node:child_process');
const fs = require('node:fs');

const profile = `${process.env.TEMP}/cdp-create-modals-${Date.now()}`;
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
    }).then(r => r.json()).then(j => j.success ? 'ok' : 'failed').catch(e => 'threw: ' + e.message)
  `);
  if (login !== 'ok') throw new Error(`登录失败：${login}`);

  // 打开弹窗并检查通用契约；返回弹窗是否出现、角色、背景是否锁定等
  const openAndInspect = async (page, buttonText, waitMs = 900) => {
    await send('Page.navigate', { url: `${BASE}${page}` });
    await sleep(2600);

    const clicked = await evaluate(`
      (() => {
        const btn = [...document.querySelectorAll('button')]
          .find(b => b.textContent.trim() === ${JSON.stringify(buttonText)});
        if (!btn) return 'no-button';
        btn.focus();
        btn.click();
        return 'clicked';
      })()
    `);
    await sleep(waitMs);

    const inspect = await evaluate(`
      (() => {
        const d = document.querySelector('[role="dialog"]');
        if (!d) return { missing: true };
        const labelledBy = d.getAttribute('aria-labelledby');
        const heading = labelledBy ? document.getElementById(labelledBy) : null;
        const main = document.querySelector('main');
        const active = document.activeElement;
        return {
          isModal: d.getAttribute('aria-modal') === 'true',
          title: heading ? heading.textContent.trim() : null,
          titleLinked: Boolean(heading),
          focusInside: d.contains(active),
          mainLocked: main ? getComputedStyle(main).overflowY === 'hidden' : null,
          bodyLocked: getComputedStyle(document.body).overflowY === 'hidden',
        };
      })()
    `);

    return { clicked, inspect };
  };

  // Esc 关闭并把焦点还给触发按钮
  const escapeAndCheckFocus = async () => {
    return evaluate(`
      (() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return true;
      })()
    `).then(async () => {
      await sleep(500);
      return evaluate(`
        (() => {
          const stillOpen = Boolean(document.querySelector('[role="dialog"]'));
          const active = document.activeElement;
          return {
            stillOpen,
            focusText: active ? active.textContent.trim() : null,
          };
        })()
      `);
    });
  };

  const report = {};
  const targets = [
    { key: 'accounts', page: '/accounts', button: '新建账户' },
    { key: 'assets', page: '/assets', button: '登记资产' },
    { key: 'liabilities', page: '/liabilities', button: '登记负债' },
    { key: 'portfolios', page: '/portfolios', button: '新建组合' },
    { key: 'goals', page: '/goals', button: '新建目标' },
    { key: 'rules', page: '/imports/rules', button: '新建规则' },
    { key: 'exchangeRates', page: '/exchange-rates', button: '添加币种对' },
    { key: 'transactions', page: '/transactions', button: '新增交易' },
  ];

  for (const target of targets) {
    const { clicked, inspect } = await openAndInspect(target.page, target.button);
    report[target.key] = { clicked, ...inspect };
    if (!inspect.missing) {
      report[target.key].escape = await escapeAndCheckFocus();
    }
  }

  // 取消确认：在资产弹窗里填一个名字后按 Esc，confirm 返回 false 时不应关闭
  await send('Page.navigate', { url: `${BASE}/assets` });
  await sleep(2600);
  report.dirtyGuard = await evaluate(`
    (async () => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '登记资产');
      if (!btn) return 'no-button';
      btn.focus();
      btn.click();
      await new Promise(r => setTimeout(r, 700));

      const d = document.querySelector('[role="dialog"]');
      if (!d) return 'no-dialog';

      const input = d.querySelector('input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '测试资产');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));

      const original = window.confirm;
      let asked = 0;
      window.confirm = () => { asked += 1; return false; };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      const blocked = Boolean(document.querySelector('[role="dialog"]'));

      window.confirm = () => { asked += 1; return true; };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      const closed = !document.querySelector('[role="dialog"]');

      window.confirm = original;
      return { asked, blockedWhileDeclining: blocked, closedOnConfirm: closed };
    })()
  `);

  // footer 里的提交按钮靠 form 属性关联表单，需要确认空表单禁用、填了名字后可提交
  await send('Page.navigate', { url: `${BASE}/assets` });
  await sleep(2600);
  report.footerSubmit = await evaluate(`
    (async () => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '登记资产');
      if (!btn) return 'no-button';
      btn.click();
      await new Promise(r => setTimeout(r, 700));

      const d = document.querySelector('[role="dialog"]');
      if (!d) return 'no-dialog';
      const findSave = () => [...d.querySelectorAll('button')].find(b => b.textContent.trim() === '保存');
      const disabledWhenEmpty = findSave()?.disabled ?? 'no-save';

      const input = d.querySelector('input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '临时名称');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));

      const enabledAfterTyping = !(findSave()?.disabled ?? true);
      const linked = findSave()?.getAttribute('form');

      // 不真正提交：只确认按钮与表单 id 对应
      const formId = d.querySelector('form')?.id;
      return { disabledWhenEmpty, enabledAfterTyping, linked, formId, covers: linked === formId };
    })()
  `);

  // 移动端形态：小屏时交易表单应贴底
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 780,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await send('Page.navigate', { url: `${BASE}/transactions` });
  await sleep(2600);
  report.mobileSheet = await evaluate(`
    (async () => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '新增交易');
      if (!btn) return 'no-button';
      btn.click();
      await new Promise(r => setTimeout(r, 800));
      const d = document.querySelector('[role="dialog"]');
      if (!d) return 'no-dialog';
      const r = d.getBoundingClientRect();
      return {
        bottomAligned: Math.abs(r.bottom - window.innerHeight) < 2,
        width: Math.round(r.width),
        viewport: window.innerWidth,
      };
    })()
  `);
  await send('Emulation.clearDeviceMetricsOverride');

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
