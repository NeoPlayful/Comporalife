#!/usr/bin/env node
/**
 * 校验前后端币种元数据一致。
 *
 * 两侧各存一份是刻意的（前端不依赖后端常量包），但一旦漂移就会出现
 * 难查的症状：界面按名称搜索不到、精度少一位、符号错乱。
 * 这里逐项比对，任何差异都以退出码 1 失败。
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

/**
 * 取出 `export const X: Record<...> = { ... };` 的字面量。
 *
 * 声明里的类型注解本身带花括号，所以不能取第一个 `{`；
 * 锚定 `= {` 到行首 `};` 才是稳的——这几个常量都是一层扁平对象。
 */
function readBlock(file, exportName) {
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf(`export const ${exportName}`);
  if (start === -1) throw new Error(`${file} 缺少 ${exportName}`);

  const assign = source.indexOf('= {', start);
  const braceStart = assign === -1 ? -1 : assign + 2;
  const braceEnd = source.indexOf('\n};', braceStart);
  if (braceStart === -1 || braceEnd === -1) throw new Error(`${exportName} 结构不符合预期`);

  const body = source.slice(braceStart + 1, braceEnd);
  // 求值只为了拿到字面量，不执行任何外部逻辑
  return new Function(`return {${body}};`)();
}

const serverFile = path.join(root, 'server/src/config/constants.ts');
const frontendFile = path.join(root, 'frontend/src/utils/constants.ts');

const problems = [];

for (const name of ['CURRENCY_DECIMALS', 'CURRENCY_NAMES', 'CURRENCY_SYMBOLS']) {
  const server = readBlock(serverFile, name);
  const frontend = readBlock(frontendFile, name);

  const serverKeys = Object.keys(server).sort();
  const frontendKeys = Object.keys(frontend).sort();

  const onlyServer = serverKeys.filter((code) => !frontendKeys.includes(code));
  const onlyFrontend = frontendKeys.filter((code) => !serverKeys.includes(code));
  if (onlyServer.length) problems.push(`${name}: 仅后端有 ${onlyServer.join(', ')}`);
  if (onlyFrontend.length) problems.push(`${name}: 仅前端有 ${onlyFrontend.join(', ')}`);

  for (const code of serverKeys) {
    if (!(code in frontend)) continue;
    const a = server[code];
    const b = frontend[code];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      problems.push(`${name}: ${code} 不一致（后端 ${JSON.stringify(a)} / 前端 ${JSON.stringify(b)}）`);
    }
  }
}

if (problems.length > 0) {
  console.error('币种元数据前后端不一致：');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const decimals = readBlock(serverFile, 'CURRENCY_DECIMALS');
console.log(`OK：${Object.keys(decimals).length} 个币种，前后端三张表完全一致`);
