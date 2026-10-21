import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAmount, parseDebitCredit } from '../../src/modules/imports/parser/amount.js';
import { inferDelimiter } from '../../src/modules/imports/parser/csv.js';
import { localDateKey, parseDate } from '../../src/modules/imports/parser/date.js';
import { detectEncoding } from '../../src/modules/imports/parser/encoding.js';
import { suggestMapping } from '../../src/modules/imports/parser/field-map.js';
import { buildFingerprint, buildHeaderSignature, normalizeDescription } from '../../src/modules/imports/parser/fingerprint.js';
import { detectHeader } from '../../src/modules/imports/parser/header.js';
import { normalizeRows, parseFile, ParseError } from '../../src/modules/imports/parser/index.js';
import { assertNotZipBomb } from '../../src/modules/imports/parser/xlsx.js';

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../fixtures/imports/${name}`, import.meta.url)));

const TZ = 'Asia/Shanghai';

describe('编码检测', () => {
  it('识别 UTF-8 并剥离 BOM', () => {
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('日期,金额\n', 'utf8')]);
    const result = detectEncoding(buffer);
    expect(result.encoding).toBe('utf-8');
    expect(result.hadBom).toBe(true);
    expect(result.text.startsWith('日期')).toBe(true);
  });

  it('识别 GB18030 编码的中文表头', () => {
    const result = detectEncoding(fixture('gbk-basic.csv'));
    expect(result.encoding).toBe('gb18030');
    expect(result.text).toContain('便利店消费');
  });

  it('拒绝 UTF-16', () => {
    const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a\0b\0', 'binary')]);
    expect(() => detectEncoding(buffer)).toThrow(/UTF-16/);
  });
});

describe('分隔符推断', () => {
  it('逗号', () => expect(inferDelimiter('a,b,c\n1,2,3')).toBe(','));
  it('分号', () => expect(inferDelimiter('a;b;c\n1;2;3')).toBe(';'));
  it('制表符', () => expect(inferDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t'));
  it('竖线', () => expect(inferDelimiter('a|b|c\n1|2|3')).toBe('|'));
});

describe('CSV 解析', () => {
  it('引号内换行不被切成两行', () => {
    const parsed = parseFile({ buffer: fixture('quoted-multiline.csv'), format: 'csv', rowLimit: 100 });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]!.cells[2]).toContain('第二行内容');
  });

  it('分号分隔文件正常解析', () => {
    const parsed = parseFile({ buffer: fixture('semicolon.csv'), format: 'csv', rowLimit: 100 });
    expect(parsed.delimiter).toBe(';');
    expect(parsed.headers).toEqual(['日期', '金额', '摘要']);
    expect(parsed.rows).toHaveLength(2);
  });

  it('表头不在首行时能定位', () => {
    const csv = '账户：示例银行\n账号：****1234\n日期,金额,摘要\n2026-03-01,-10.00,测试\n';
    const parsed = parseFile({ buffer: Buffer.from(csv, 'utf8'), format: 'csv', rowLimit: 100 });
    expect(parsed.headerRow).toBe(3);
    expect(parsed.headers).toEqual(['日期', '金额', '摘要']);
  });

  it('列数不齐的行被保留并标记', () => {
    const parsed = parseFile({ buffer: fixture('malformed.csv'), format: 'csv', rowLimit: 100 });
    expect(parsed.rows.length).toBe(4);

    const rows = normalizeRows(
      parsed,
      { occurredAt: 0, amountMode: 'signed', amount: 1, description: 2, dateFormat: 'YYYY-MM-DD' },
      { userId: 'u1', accountId: 'a1', accountCurrency: 'CNY', timezone: TZ },
    );

    const shortRow = rows.find((row) => row.rowNumber === parsed.rows[1]!.rowNumber)!;
    expect(shortRow.errors.some((err) => err.code === 'COLUMN_COUNT_MISMATCH')).toBe(true);
  });

  it('超出上限时报 ROW_LIMIT', () => {
    const csv = '日期,金额\n' + Array.from({ length: 5 }, (_, i) => `2026-03-0${i + 1},-1.00`).join('\n');
    expect(() => parseFile({ buffer: Buffer.from(csv, 'utf8'), format: 'csv', rowLimit: 3 })).toThrow(ParseError);
  });
});

describe('表头推断', () => {
  it('前两行是账户信息时选第三行', () => {
    const detected = detectHeader([
      { rowNumber: 1, cells: ['账户：示例银行'] },
      { rowNumber: 2, cells: ['账号：****1234'] },
      { rowNumber: 3, cells: ['日期', '金额', '摘要'] },
    ]);
    expect(detected?.headerRow).toBe(3);
  });
});

describe('字段同义词', () => {
  it('常见表头能自动推断', () => {
    const suggestions = suggestMapping(['交易日期', '交易金额', '币种', '摘要', '对方户名', '流水号', '余额']);
    const fields = suggestions.map((item) => item.field);
    expect(fields).toContain('occurredAt');
    expect(fields).toContain('amount');
    expect(fields).toContain('currency');
    expect(fields).toContain('merchant');
    expect(fields).toContain('externalId');
    expect(fields).toContain('balanceAfter');
  });

  it('同一列不会被两个字段占用', () => {
    const suggestions = suggestMapping(['日期', '金额', '摘要']);
    const columns = suggestions.map((item) => item.columnIndex);
    expect(new Set(columns).size).toBe(columns.length);
  });
});

describe('日期解析', () => {
  it('按用户时区当日零点转 UTC', () => {
    const result = parseDate('2026-03-01', 'YYYY-MM-DD', TZ);
    expect(result.value?.toISOString()).toBe('2026-02-28T16:00:00.000Z');
  });

  it('DD/MM/YYYY 显式格式', () => {
    const result = parseDate('03/04/2026', 'DD/MM/YYYY', TZ);
    expect(result.value?.toISOString()).toBe('2026-04-02T16:00:00.000Z');
  });

  it('MM/DD/YYYY 显式格式', () => {
    const result = parseDate('03/04/2026', 'MM/DD/YYYY', TZ);
    expect(result.value?.toISOString()).toBe('2026-03-03T16:00:00.000Z');
  });

  it('自动模式下歧义日期报错', () => {
    expect(parseDate('03/04/2026', 'auto', TZ).error).toBe('DATE_AMBIGUOUS');
  });

  it('自动模式可判定日大于 12 的情况', () => {
    const result = parseDate('25/04/2026', 'auto', TZ);
    expect(result.error).toBeUndefined();
    expect(result.value?.toISOString().slice(0, 10)).toBe('2026-04-24');
  });

  it('非法日期（2 月 30 日）', () => {
    expect(parseDate('2026-02-30', 'YYYY-MM-DD', TZ).error).toBe('DATE_INVALID');
  });

  it('年份超范围', () => {
    expect(parseDate('1800-01-01', 'YYYY-MM-DD', TZ).error).toBe('DATE_OUT_OF_RANGE');
  });

  it('本地日期键按用户时区', () => {
    expect(localDateKey(new Date('2026-02-28T16:00:00Z'), TZ)).toBe('2026-03-01');
  });
});

describe('金额解析', () => {
  it.each([
    ['1,234.56', '1234.56'],
    ['¥1,234.56', '1234.56'],
    ['-123.45', '-123.45'],
    ['(123.45)', '-123.45'],
    ['123.45-', '-123.45'],
    ['−123.45', '-123.45'],
    ['  88.00  ', '88'],
    ['CNY 500', '500'],
  ])('解析 %s', (input, expected) => {
    expect(parseAmount(input).value?.toFixed(2)).toBe(Number(expected).toFixed(2));
  });

  it('小数位超过 6 位报错', () => {
    expect(parseAmount('1.1234567').error).toBe('AMOUNT_PRECISION_INVALID');
  });

  it('无法识别报错', () => {
    expect(parseAmount('abc').error).toBe('AMOUNT_INVALID');
  });

  it('借贷双列：仅 debit 非空为负数', () => {
    expect(parseDebitCredit('300.00', '').value?.toFixed(2)).toBe('-300.00');
  });

  it('借贷双列：仅 credit 非空为正数', () => {
    expect(parseDebitCredit('', '8000.00').value?.toFixed(2)).toBe('8000.00');
  });

  it('借贷双列冲突', () => {
    expect(parseDebitCredit('50.00', '60.00').error).toBe('AMOUNT_CONFLICT');
  });
});

describe('指纹', () => {
  const base = {
    userId: 'u1',
    accountId: 'a1',
    occurredAt: new Date('2026-02-28T16:00:00Z'),
    timezone: TZ,
    amount: parseAmount('-123.45').value!,
    currency: 'CNY',
  };

  it('相同输入两次计算结果完全一致', () => {
    expect(buildFingerprint({ ...base, externalId: 'REF1' })).toBe(buildFingerprint({ ...base, externalId: 'REF1' }));
  });

  it('不同金额产生不同指纹', () => {
    const other = { ...base, amount: parseAmount('-123.46').value! };
    expect(buildFingerprint({ ...base, externalId: 'REF1' })).not.toBe(buildFingerprint({ ...other, externalId: 'REF1' }));
  });

  it('有外部号时描述变化不影响指纹', () => {
    const a = buildFingerprint({ ...base, externalId: 'REF1', description: '旧摘要' });
    const b = buildFingerprint({ ...base, externalId: 'REF1', description: '新摘要' });
    expect(a).toBe(b);
  });

  it('描述规范化处理全角、大小写与流水后缀', () => {
    expect(normalizeDescription('  星巴克　咖啡  ABC  123456  ')).toBe('星巴克 咖啡 abc');
  });

  it('表头签名与列顺序相关', () => {
    expect(buildHeaderSignature(['日期', '金额'])).toBe(buildHeaderSignature([' 日期 ', '金额']));
    expect(buildHeaderSignature(['日期', '金额'])).not.toBe(buildHeaderSignature(['金额', '日期']));
  });
});

describe('规范化', () => {
  const context = { userId: 'u1', accountId: 'a1', accountCurrency: 'CNY', timezone: TZ };

  it('正常行无错误并推导方向', () => {
    const parsed = parseFile({ buffer: fixture('utf8-basic.csv'), format: 'csv', rowLimit: 100 });
    const rows = normalizeRows(
      parsed,
      { occurredAt: 0, amountMode: 'signed', amount: 1, currency: 2, description: 3, merchant: 4, externalId: 5, balanceAfter: 6, dateFormat: 'YYYY-MM-DD' },
      context,
    );

    expect(rows).toHaveLength(3);
    expect(rows[0]!.errors).toEqual([]);
    expect(rows[0]!.direction).toBe('expense');
    expect(rows[1]!.direction).toBe('income');
    expect(rows[1]!.amount?.toFixed(2)).toBe('1200.00');
  });

  it('币种与账户不一致时报错', () => {
    const parsed = parseFile({ buffer: fixture('utf8-basic.csv'), format: 'csv', rowLimit: 100 });
    const rows = normalizeRows(
      parsed,
      { occurredAt: 0, amountMode: 'signed', amount: 1, currency: 2, description: 3, dateFormat: 'YYYY-MM-DD' },
      { ...context, accountCurrency: 'USD' },
    );
    expect(rows[0]!.errors.some((err) => err.code === 'CURRENCY_MISMATCH')).toBe(true);
  });

  it('批次内重复行被标记', () => {
    const csv = '日期,金额,摘要\n2026-03-01,-10.00,同一天同额\n2026-03-01,-10.00,同一天同额\n';
    const parsed = parseFile({ buffer: Buffer.from(csv, 'utf8'), format: 'csv', rowLimit: 100 });
    const rows = normalizeRows(
      parsed,
      { occurredAt: 0, amountMode: 'signed', amount: 1, description: 2, dateFormat: 'YYYY-MM-DD' },
      context,
    );
    expect(rows[0]!.errors).toEqual([]);
    expect(rows[1]!.errors.some((err) => err.code === 'DUPLICATE_IN_FILE')).toBe(true);
  });

  it('非法日期与金额分别报错', () => {
    const parsed = parseFile({ buffer: fixture('malformed.csv'), format: 'csv', rowLimit: 100 });
    const rows = normalizeRows(
      parsed,
      { occurredAt: 0, amountMode: 'signed', amount: 1, description: 2, dateFormat: 'YYYY-MM-DD' },
      context,
    );

    expect(rows[0]!.errors.some((err) => err.code === 'DATE_INVALID')).toBe(true);
    expect(rows[2]!.errors.some((err) => err.code === 'AMOUNT_INVALID')).toBe(true);
    expect(rows[3]!.errors).toEqual([]);
  });
});

describe('XLSX 解析', () => {
  it('读取指定工作表并解析日期单元格', () => {
    const parsed = parseFile({ buffer: fixture('xlsx-dates.xlsx'), format: 'xlsx', rowLimit: 100 });
    expect(parsed.headers).toEqual(['日期', '金额', '摘要']);
    expect(parsed.rows[0]!.cells[0]).toBe('2026-10-15');
  });

  it('多工作表时默认取第一个非空表', () => {
    const parsed = parseFile({ buffer: fixture('xlsx-multi-sheet.xlsx'), format: 'xlsx', rowLimit: 100 });
    expect(parsed.sheetName).toBe('流水');
    expect(parsed.sheetNames).toEqual(['流水', '备用']);
    expect(parsed.rows).toHaveLength(2);
  });

  it('可切换到其他工作表', () => {
    const parsed = parseFile({ buffer: fixture('xlsx-multi-sheet.xlsx'), format: 'xlsx', rowLimit: 100, sheetName: '备用' });
    expect(parsed.sheetName).toBe('备用');
    expect(parsed.rows[0]!.cells[2]).toBe('第二个工作表');
  });

  it('非 zip 文件被拒绝', () => {
    expect(() => assertNotZipBomb(Buffer.from('not a zip'))).toThrow();
  });
});
