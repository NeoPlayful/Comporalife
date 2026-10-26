// 验证系统设置页的两个开关：语义、取消确认回弹、轨道配色、忙碌态隔离、真实切换
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173';
const PORT = 9342;

const { spawn } = require('node:child_process');
const fs = require('node:fs');

const profile = `${process.env.TEMP}/cdp-settings-switches-${Date.now()}`;
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

  // 登录会写入 refresh cookie，刷新后的路由守卫靠它恢复会话
  const login = await evaluate(`
    fetch('/api/auth/login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@comporalife.com', password: 'admin123' }),
    }).then(r => r.json()).then(j => j.success ? j.data.accessToken : 'failed').catch(e => 'threw: ' + e.message)
  `);
  if (login === 'failed' || String(login).startsWith('threw')) throw new Error(`登录失败：${login}`);
  const AUTH = JSON.stringify({ authorization: `Bearer ${login}` });

  // 记录真实配置，结束时还原
  const before = await evaluate(`
    fetch('/api/admin/settings', { credentials: 'include', headers: ${AUTH} })
      .then(r => r.json()).then(j => ({
        registration: j.data.registrationEnabled,
        emailVerification: j.data.emailVerificationEnabled,
        mailConfigured: j.data.mailConfigured,
      }))
  `);

  await send('Page.navigate', { url: `${BASE}/admin/settings` });
  await sleep(2500);

  const report = { before };

  report.switches = await evaluate(`
    (() => {
      const nodes = [...document.querySelectorAll('[role="switch"]')];
      return nodes.map((n) => {
        const track = n.querySelector('[aria-hidden="true"]');
        const style = track ? getComputedStyle(track) : null;
        return {
          label: n.getAttribute('aria-label'),
          checked: n.getAttribute('aria-checked'),
          isButton: n.tagName === 'BUTTON',
          disabled: n.disabled,
          busy: n.getAttribute('aria-busy'),
          trackColor: style ? style.backgroundColor : null,
          width: style ? style.width : null,
        };
      });
    })()
  `);

  // 整行可点：在按钮上挂捕获监听并截断传播，只观察事件是否到达开关本身
  report.titleClickable = await evaluate(`
    (() => {
      const sw = [...document.querySelectorAll('[role="switch"]')]
        .find(n => n.getAttribute('aria-label') === '公开注册');
      if (!sw) return 'no-switch';
      const title = sw.querySelector(':scope > span > span');
      if (!title) return 'no-title';

      let reached = false;
      const trap = (event) => { reached = true; event.stopPropagation(); };
      sw.addEventListener('click', trap, true);
      title.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      sw.removeEventListener('click', trap, true);
      return { reachedSwitch: reached, titleText: title.textContent };
    })()
  `);

  // 取消确认必须回弹：confirm 返回 false 时开关状态不变
  report.cancelKeepsState = await evaluate(`
    (() => {
      const original = window.confirm;
      window.confirm = () => false;
      const sw = [...document.querySelectorAll('[role="switch"]')]
        .find(n => n.getAttribute('aria-label') === '公开注册');
      const beforeState = sw.getAttribute('aria-checked');
      sw.click();
      const afterState = sw.getAttribute('aria-checked');
      window.confirm = original;
      return { beforeState, afterState, stayed: beforeState === afterState };
    })()
  `);
  await sleep(600);

  // 轨道颜色令牌必须落到元素上，且关闭态在深浅两主题下都要与卡片底色拉开明度差
  report.contrast = await evaluate(`
    (() => {
      const parse = (value) => {
        const m = String(value).match(/oklch\\(\\s*([\\d.]+)/);
        return m ? Number(m[1]) : null;
      };
      const root = document.documentElement;
      const tracks = [...document.querySelectorAll('[role="switch"]')]
        .map((n) => n.querySelector('[aria-hidden="true"]'))
        .filter(Boolean);
      const measure = () => {
        const css = getComputedStyle(root);
        const on = parse(css.getPropertyValue('--color-switch-on'));
        const off = parse(css.getPropertyValue('--color-switch-off'));
        const card = parse(css.getPropertyValue('--color-surface-raised'));

        // 轨道带 transition-colors，主题切换瞬间读到的是插值；测量前先关掉过渡
        tracks.forEach((t) => { t.style.transition = 'none'; });
        void root.offsetWidth;
        // 当前渲染的轨道色必须等于两个令牌之一，证明样式确实接了令牌
        const rendered = tracks.map((t) => parse(getComputedStyle(t).backgroundColor));
        tracks.forEach((t) => { t.style.transition = ''; });
        const wired = rendered.every((l) => l !== null && (Math.abs(l - on) < 0.01 || Math.abs(l - off) < 0.01));
        return {
          on, off, card,
          offGap: off !== null && card !== null ? Math.abs(off - card) : null,
          wired,
        };
      };

      root.classList.remove('dark');
      const light = measure();
      root.classList.add('dark');
      const dark = measure();
      root.classList.remove('dark');
      return { light, dark, minGap: 0.12, passes: light.offGap > 0.12 && dark.offGap > 0.12 && light.wired && dark.wired };
    })()
  `);

  // 真实切换：只有当前行进入忙碌态，成功后 aria-checked 跟着变。
  // 本地请求 ~20ms 就结束，轮询会错过忙碌态，改用 MutationObserver 记录过程值
  report.liveToggle = await evaluate(`
    (async () => {
      const getSw = (label) => [...document.querySelectorAll('[role="switch"]')]
        .find(n => n.getAttribute('aria-label') === label);
      const sw = getSw('邮箱验证');
      const other = getSw('公开注册');
      const start = sw.getAttribute('aria-checked');

      const seen = { self: new Set(), other: new Set() };
      const watch = (node, bucket) => {
        const mo = new MutationObserver(() => {
          bucket.add(node.getAttribute('aria-busy'));
          bucket.add(node.disabled ? 'disabled' : 'enabled');
        });
        mo.observe(node, { attributes: true, attributeFilter: ['aria-busy', 'disabled'] });
        return mo;
      };
      const moSelf = watch(sw, seen.self);
      const moOther = watch(other, seen.other);

      window.confirm = () => true;
      sw.click();
      await new Promise(r => setTimeout(r, 1600));

      moSelf.disconnect();
      moOther.disconnect();
      const after = getSw('邮箱验证').getAttribute('aria-checked');
      return {
        start,
        after,
        flipped: start !== after,
        selfSawBusy: seen.self.has('true'),
        otherSawBusy: seen.other.has('true'),
      };
    })()
  `);

  report.consoleErrors = consoleErrors;
  console.log(JSON.stringify(report, null, 2));

  // 还原真实配置，避免污染演示环境
  await evaluate(`
    (async () => {
      const headers = { 'Content-Type': 'application/json', ...${AUTH} };
      await fetch('/api/admin/settings/registration', {
        method: 'PATCH', credentials: 'include', headers,
        body: JSON.stringify({ enabled: ${Boolean(before && before.registration)} }),
      });
      await fetch('/api/admin/settings/email-verification', {
        method: 'PATCH', credentials: 'include', headers,
        body: JSON.stringify({ enabled: ${Boolean(before && before.emailVerification)} }),
      });
      return 'restored';
    })()
  `).catch(() => 'restore-failed');

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
