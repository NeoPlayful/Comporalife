// 检查源码里 t('ns:key') 与 t('key') 引用的键是否在对应语言文件里存在
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'frontend', 'src');
const LOCALES = path.join(ROOT, 'i18n', 'locales', 'zh-CN');

function flatten(obj, prefix = '') {
  const out = new Set();
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const nested of flatten(value, full)) out.add(nested);
    } else {
      out.add(full);
    }
  }
  return out;
}

const namespaces = {};
for (const file of fs.readdirSync(LOCALES)) {
  if (!file.endsWith('.json')) continue;
  namespaces[file.replace('.json', '')] = flatten(
    JSON.parse(fs.readFileSync(path.join(LOCALES, file), 'utf8')),
  );
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

const problems = [];
for (const file of walk(ROOT)) {
  const source = fs.readFileSync(file, 'utf8');
  // 只处理静态字面量键；模板拼接无法静态校验，跳过
  const useNs = source.match(/useTranslation\(\s*\[?['"]([a-z-]+)['"]/);
  const defaultNs = useNs ? useNs[1] : 'common';

  // 静态字面量键
  const patterns = [
    /(?<![.\w])t\(\s*'([a-zA-Z0-9_.-]+)'/g,
    /(?<![.\w])t\(\s*"([a-zA-Z0-9_.-]+)"/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const raw = match[1];
      let ns = defaultNs;
      let key = raw;
      if (raw.includes(':')) {
        [ns, key] = raw.split(':');
      }
      if (!namespaces[ns]) continue;
      if (key.endsWith('.')) continue;
      if (!namespaces[ns].has(key)) {
        problems.push(`${path.relative(ROOT, file)}  ->  ${ns}:${key}`);
      }
    }
  }

  // 模板拼接键：t(`a.b.${x}`) —— 只校验 `${` 之前的前缀下确实存在以它开头的键。
  // 这一层专为「拼错前缀」而设：前缀写错时渲染出来的是键名本身，界面上很难发现。
  const templatePattern = /(?<![.\w])t\(\s*`([^`]*\$\{[^`]*)`/g;
  let match;
  while ((match = templatePattern.exec(source)) !== null) {
    const raw = match[1];
    const prefix = raw.slice(0, raw.indexOf('${'));
    const ns = prefix.includes(':') ? prefix.split(':')[0] : defaultNs;
    const keyPrefix = prefix.includes(':') ? prefix.split(':')[1] : prefix;
    if (!namespaces[ns]) continue;
    const hasCandidate = [...namespaces[ns]].some((key) => key.startsWith(keyPrefix));
    if (!hasCandidate) {
      problems.push(`${path.relative(ROOT, file)}  ->  ${ns}:${keyPrefix}* (no key starts with this prefix)`);
    }
  }
}

if (problems.length === 0) {
  console.log('ALL STATIC t() KEYS RESOLVE');
} else {
  console.log(`MISSING KEYS (${problems.length}):`);
  for (const line of [...new Set(problems)].sort()) console.log('  ' + line);
  process.exitCode = 1;
}
