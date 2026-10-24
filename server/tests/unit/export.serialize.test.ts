import { describe, expect, it } from 'vitest';
import {
  buildCsv,
  buildXlsx,
  contentDisposition,
  escapeCell,
  quoteField,
  sanitizeFilename,
} from '@/modules/reports/export.serialize';

describe('CSV 字段转义', () => {
  it('含逗号的字段被引号包裹', () => {
    expect(quoteField('餐饮,外卖')).toBe('"餐饮,外卖"');
  });

  it('含引号的字段内部引号翻倍', () => {
    expect(quoteField('他说"你好"')).toBe('"他说""你好"""');
  });

  it('含换行的字段被引号包裹', () => {
    expect(quoteField('第一行\n第二行')).toBe('"第一行\n第二行"');
  });

  it('普通字段不加引号', () => {
    expect(quoteField('工资')).toBe('工资');
  });
});

describe('公式注入防护', () => {
  it('等号开头的文本加单引号前缀', () => {
    expect(escapeCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
  });

  it('加号与 @ 开头的文本被阻断', () => {
    expect(escapeCell('+1a')).toBe("'+1a");
    expect(escapeCell('@x')).toBe("'@x");
  });

  it('减号开头但不是数值的文本被阻断', () => {
    expect(escapeCell('-abc')).toBe("'-abc");
    // -1 是合法数值，必须保留（见下一条）
    expect(escapeCell('-1')).toBe('-1');
  });

  it('负数不被误伤', () => {
    expect(escapeCell('-1234.56')).toBe('-1234.56');
    expect(escapeCell('-0.5')).toBe('-0.5');
  });

  it('数值类型原样输出', () => {
    expect(escapeCell(-42)).toBe('-42');
    expect(escapeCell(3.14)).toBe('3.14');
  });

  it('科学计数法视为数值', () => {
    expect(escapeCell('-1.5e-7')).toBe('-1.5e-7');
  });

  it('空值输出空字符串', () => {
    expect(escapeCell(null)).toBe('');
    expect(escapeCell(undefined)).toBe('');
  });

  it('NaN 与 Infinity 输出空字符串', () => {
    expect(escapeCell(Number.NaN)).toBe('');
    expect(escapeCell(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('CSV 组装', () => {
  it('带 UTF-8 BOM 与 CRLF 换行', () => {
    const csv = buildCsv([{ header: ['名称'], rows: [['工资']] }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('\r\n');
    expect(csv).not.toMatch(/[^\r]\n/);
  });

  it('多分区之间用空行分隔', () => {
    const csv = buildCsv([
      { header: ['A'], rows: [['1']] },
      { header: ['B'], rows: [['2']] },
    ]);

    expect(csv).toContain('\r\n\r\nB');
  });

  it('分区标题单独成行', () => {
    const csv = buildCsv([{ title: '账户余额', header: ['名称'], rows: [['招商']] }]);
    // 首行带 UTF-8 BOM，比较前先剥掉
    expect(csv.split('\r\n')[0]!.replace(String.fromCharCode(0xfeff), '')).toBe('账户余额');
  });

  it('可以重新解析回原值', () => {
    const csv = buildCsv([{ header: ['名称', '金额'], rows: [['餐饮,外卖', '-123.45']] }]);
    const line = csv.trim().split('\r\n')[1]!;
    expect(line).toBe('"餐饮,外卖",-123.45');
  });
});

describe('XLSX 生成', () => {
  it('生成非空工作簿缓冲', () => {
    const buffer = buildXlsx([{ name: '摘要', header: ['指标', '数值'], rows: [['净资产', 12345.67]] }]);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    // xlsx 的 ZIP 魔数
    expect(buffer.subarray(0, 2).toString('binary')).toBe('PK');
  });

  it('sheet 名中的非法字符被替换', () => {
    const buffer = buildXlsx([{ name: 'a/b:c', header: ['x'], rows: [] }]);
    expect(Buffer.isBuffer(buffer)).toBe(true);
  });
});

describe('文件名与响应头', () => {
  it('中文名走 filename* 百分号编码', () => {
    const header = contentDisposition('report.csv', '现金流量报表.csv');
    expect(header).toContain('filename="report.csv"');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain(encodeURIComponent('现金流量报表'));
  });

  it('ASCII 名中的引号被清洗', () => {
    const header = contentDisposition('a"b.csv', '标题.csv');
    expect(header).toContain('filename="a_b.csv"');
  });

  it('路径分隔符与控制字符被移除', () => {
    expect(sanitizeFilename('a/b\\c:d')).toBe('a-b-c-d');
    expect(sanitizeFilename('中文标题')).toBe('中文标题');
  });

  it('超长文件名被截断', () => {
    expect(sanitizeFilename('a'.repeat(500)).length).toBeLessThanOrEqual(120);
  });
});
