// 验证后台用户页重构：建号开关联动、建号、列表徽章、筛选、详情抽屉、确认层
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173';
const API = 'http://localhost:4000';
const PORT = 9351;
const EMAIL = 'admin@comporalife.com';
const PASSWORD = 'admin123';

const { spawn } = require('node:child_process');

const profile = `${process.env.TEMP}/cdp-admin-users-${Date.now()}`;
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
const createdEmails = [];

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
    // 原生 confirm 会阻塞渲染进程，后续 evaluate 全部挂住：记录并自动放行
    if (msg.method === 'Page.javascriptDialogOpening') {
      nativeDialogs.push(msg.params.message);
      ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: false } }));
    }
  };

  const send = (method, params = {}) => {
    id += 1;
    const msgId = id;
    ws.send(JSON.stringify({ id: msgId, method, params }));
    // 页面跳转中的执行上下文可能不响应：超时要显式失败，否则整个脚本静默挂住
    return Promise.race([
      new Promise((resolve) => pending.set(msgId, resolve)),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`CDP timeout: ${method} ${JSON.stringify(params).slice(0, 120)}`)), 15000),
      ),
    ]);
  };

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text);
    }
    return res.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');

  const report = {};

  // ---- 1. 先在页面里登录：access token 只存在内存，必须由应用自己走一遍登录 ----
  await send('Page.navigate', { url: `${BASE}/login` });
  await sleep(1500);
  const loginFill = await evaluate(`
    (() => {
      const email = document.querySelector('input[type="email"]');
      const pwd = document.querySelector('input[type="password"]');
      if (!email || !pwd) return 'no-inputs';
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(email, ${JSON.stringify(EMAIL)});
      email.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(pwd, ${JSON.stringify(PASSWORD)});
      pwd.dispatchEvent(new Event('input', { bubbles: true }));
      return 'filled';
    })()
  `);
  await sleep(300);
  await evaluate(`
    (() => {
      const form = document.querySelector('form');
      if (!form) return 'no-form';
      form.requestSubmit();
      return 'submitted';
    })()
  `);
  await sleep(2500);
  report.login = {
    fill: loginFill,
    state: await evaluate(`JSON.stringify({ path: location.pathname, title: document.title })`),
  };

  const setToggleViaApi = async (enabled) => {
    const res = await fetch(`${API}/api/admin/settings/user-creation`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Origin: BASE,
        Cookie: cookie,
      },
      body: JSON.stringify({ enabled }),
    });
    return (await res.json()).success;
  };

  await setToggleViaApi(true);

  // ---- 2. 用户页：开关开启时新建按钮可用 ----
  await send('Page.navigate', { url: `${BASE}/admin/users` });
  await sleep(2600);

  report.pageLoaded = await evaluate(`
    (() => ({
      hasHeading: document.body.innerText.includes('用户'),
      statsCount: document.querySelectorAll('.card').length,
      rowCount: document.querySelectorAll('tbody tr').length,
      newButtonDisabled: (() => {
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '新建用户');
        return btn ? btn.disabled : 'no-button';
      })(),
      filterSelects: document.querySelectorAll('section select').length,
    }))()
  `);

  // 表头是否含注销列与徽章
  report.table = await evaluate(`
    (() => {
      const headers = [...document.querySelectorAll('thead th')].map(th => th.textContent.trim());
      const badgeTexts = [...document.querySelectorAll('tbody span')].map(s => s.textContent.trim());
      return { headers, sampleBadges: badgeTexts.slice(0, 12) };
    })()
  `);

  // ---- 3. 建号：打开弹窗，检查字段与角色收敛 ----
  await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '新建用户');
      btn.click();
      return true;
    })()
  `);
  await sleep(700);

  report.createDialog = await evaluate(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return { missing: true };
      const roleSelect = [...d.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'admin'));
      const active = document.activeElement;
      return {
        open: true,
        inputs: d.querySelectorAll('input').length,
        roleOptions: roleSelect ? [...roleSelect.options].map(o => o.value) : null,
        focusedIsEmail: active ? active.type === 'email' : false,
        submitDisabled: (() => {
          const btn = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === '创建账号');
          return btn ? btn.disabled : 'no-button';
        })(),
      };
    })()
  `);

  // 填写并提交
  const suffix = Math.random().toString(36).slice(2, 8);
  const newEmail = `cdp-user-${suffix}@comporalife-cdp.local`;
  createdEmails.push(newEmail);

  report.createSubmit = await evaluate(`
    (async () => {
      const d = document.querySelector('[role="dialog"]');
      const set = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const inputs = [...d.querySelectorAll('input')];
      const emailInput = inputs.find(i => i.type === 'email');
      const pwdInput = inputs.find(i => i.type === 'password');
      const nickInput = inputs.find(i => i !== emailInput && i !== pwdInput);
      set(emailInput, ${JSON.stringify(newEmail)});
      if (nickInput) set(nickInput, 'CDP 测试用户');
      set(pwdInput, 'InitPass123');
      await new Promise(r => setTimeout(r, 300));

      const submit = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === '创建账号');
      const disabledBefore = submit.disabled;
      submit.click();
      await new Promise(r => setTimeout(r, 2200));

      const after = document.querySelector('[role="dialog"]');
      return {
        disabledBefore,
        dialogClosed: !after,
        dialogText: after ? after.innerText.slice(0, 300) : null,
        noticeShown: document.body.innerText.includes(${JSON.stringify(newEmail)}),
        listHasNewUser: document.body.innerText.includes('CDP 测试用户'),
      };
    })()
  `);

  // ---- 4. 筛选：按注销状态筛选应返回空态或不过滤 ----
  report.filters = await evaluate(`
    (async () => {
      const selects = [...document.querySelectorAll('section select')];
      const deletionSelect = selects[selects.length - 1];
      const setSel = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const before = location.search;
      setSel(deletionSelect, 'ready');
      await new Promise(r => setTimeout(r, 1600));
      const after = location.search;
      const chips = document.body.innerText.includes('已启用筛选');
      // 复位
      setSel(deletionSelect, '');
      await new Promise(r => setTimeout(r, 1600));
      return {
        urlUpdated: after.includes('deletion=ready'),
        hadQueryBefore: before,
        chipsShown: chips,
        resetQuery: location.search,
      };
    })()
  `);

  // 搜索防抖：输入昵称后 URL 更新
  report.search = await evaluate(`
    (async () => {
      const input = document.querySelector('input[aria-label="搜索昵称、邮箱或 ID"]');
      if (!input) return { missing: true };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'CDP');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1200));
      const hit = {
        urlHasSearch: location.search.includes('search=CDP'),
        rowCount: document.querySelectorAll('tbody tr').length,
      };
      // 清空搜索，后面要验证抽屉与确认层
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1600));
      return { ...hit, clearedRows: document.querySelectorAll('tbody tr').length };
    })()
  `);

  // ---- 5. 详情抽屉：点开一行，检查抽屉内容与 Esc 焦点回收 ----
  report.drawer = await evaluate(`
    (async () => {
      const row = document.querySelector('tbody tr');
      if (!row) return { missing: 'no-row' };
      row.click();
      await new Promise(r => setTimeout(r, 1400));
      const d = document.querySelector('[role="dialog"]');
      if (!d) return { missing: 'no-dialog' };
      const text = d.innerText;
      return {
        open: true,
        hasAccountSection: text.includes('账号信息'),
        hasActivitySection: text.includes('活动记录'),
        hasLoginTab: text.includes('登录记录'),
        hasAuditTab: text.includes('管理操作'),
        hasDeleteAction: text.includes('撤销会话'),
      };
    })()
  `);

  // 抽屉里点「禁用」应弹出确认层，且确认层在抽屉之上
  report.confirmLayer = await evaluate(`
    (async () => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')];
      const drawer = dialogs[0];
      const disable = [...drawer.querySelectorAll('footer button, button')].find(b => b.textContent.trim() === '禁用');
      if (!disable) return { missing: 'no-disable-button', buttons: [...drawer.querySelectorAll('button')].map(b => b.textContent.trim()) };
      disable.click();
      await new Promise(r => setTimeout(r, 600));
      const layers = [...document.querySelectorAll('[role="dialog"]')];
      const zIndexes = layers.map(d => getComputedStyle(d.parentElement).zIndex);
      return {
        layerCount: layers.length,
        topIsConfirm: layers.length === 2 && layers[1].innerText.includes('禁用该账号'),
        zIndexes,
      };
    })()
  `);

  // Esc 只关最上层：确认层未填内容，Esc 直接关掉，抽屉保留
  report.escTopOnly = await evaluate(`
    (async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 500));
      const layers = [...document.querySelectorAll('[role="dialog"]')];
      return {
        remaining: layers.length,
        stillDrawer: layers.some(d => d.innerText.includes('活动记录')),
        confirmGone: !layers.some(d => d.innerText.includes('禁用该账号')),
      };
    })()
  `);

  // 关闭抽屉：若仍叠着确认层，先关它
  for (let i = 0; i < 3; i += 1) {
    const open = await evaluate(`document.querySelectorAll('[role="dialog"]').length`);
    if (!open) break;
    await evaluate(`
      (() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return true;
      })()
    `);
    await sleep(400);
  }

  // ---- 6. 关闭开关后新建按钮应变灰不可点 ----
  await setToggleViaApi(false);
  await send('Page.navigate', { url: `${BASE}/admin/users` });
  await sleep(2400);
  report.toggleOff = await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '新建用户');
      return {
        disabled: btn ? btn.disabled : 'no-button',
        title: btn ? btn.title : null,
      };
    })()
  `);

  // ---- 7. 移动端视口 ----
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await sleep(1200);
  report.mobile = await evaluate(`
    (() => {
      const cards = document.querySelectorAll('main ul.space-y-2 > li > button');
      const table = document.querySelector('main table');
      const tableVisible = table ? table.getBoundingClientRect().width > 0 : false;
      return {
        cardRows: cards.length,
        tableVisible,
      };
    })()
  `);
  await send('Emulation.clearDeviceMetricsOverride');

  report.consoleErrors = consoleErrors;
  report.nativeDialogs = nativeDialogs;
  console.log(JSON.stringify(report, null, 2));

  // 清理本次创建的账号
  for (const email of createdEmails) {
    try {
      const res = await fetch(`${API}/api/admin/users?search=${encodeURIComponent(email)}&pageSize=5`, {
        headers: { Authorization: `Bearer ${token}`, Cookie: cookie, Origin: BASE },
      });
      const body = await res.json();
      const hit = body.data?.users?.find((u) => u.email === email || u.email.includes('***'));
      if (hit) {
        console.log(`NOTE: created account remains for manual cleanup: ${email} (id ${hit.id})`);
      }
    } catch {
      /* 忽略清理探测失败 */
    }
  }

  ws.close();
  chrome.kill();
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  chrome.kill();
  process.exit(1);
});
