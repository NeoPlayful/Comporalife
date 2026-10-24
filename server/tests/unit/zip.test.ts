import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildZip, crc32 } from '@/lib/zip';

/** 读中央目录之前的本地文件头，验证结构自洽 */
function readLocalEntries(buffer: Buffer): Array<{ name: string; data: Buffer; method: number; crc: number }> {
  const entries: Array<{ name: string; data: Buffer; method: number; crc: number }> = [];
  let offset = 0;

  while (offset < buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const crc = buffer.readUInt32LE(offset + 14);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);

    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    const dataStart = nameStart + nameLength + extraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    entries.push({ name, data, method, crc });
    offset = dataStart + compressedSize;
  }

  return entries;
}

describe('CRC32', () => {
  it('与已知值一致', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('空缓冲区返回 0', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});

describe('ZIP 写入器', () => {
  it('生成可被解析的本地文件头与结尾记录', () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello') }]);

    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 12)).toBe(1); // 条目数
  });

  it('条目内容与原名可还原', () => {
    const content = Buffer.from('第一行\n第二行', 'utf8');
    const zip = buildZip([{ name: '目录/文件.txt', data: content }]);

    const entries = readLocalEntries(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('目录/文件.txt');
    expect(entries[0]!.method).toBe(0);
    expect(entries[0]!.data.equals(content)).toBe(true);
    expect(entries[0]!.crc).toBe(crc32(content));
  });

  it('UTF-8 标志位被设置，中文文件名不乱码', () => {
    const zip = buildZip([{ name: '中文.csv', data: Buffer.from('x') }]);
    expect(zip.readUInt16LE(6) & 0x0800).toBe(0x0800);
    expect(readLocalEntries(zip)[0]!.name).toBe('中文.csv');
  });

  it('deflate 模式下解压后与原内容一致', () => {
    const content = Buffer.from('a'.repeat(5000));
    const zip = buildZip([{ name: 'big.txt', data: content }], { compress: true });

    const entry = readLocalEntries(zip)[0]!;
    expect(entry.method).toBe(8);
    expect(entry.data.length).toBeLessThan(content.length);
    expect(inflateRawSync(entry.data).equals(content)).toBe(true);
  });

  it('多个条目的中央目录数量与顺序正确', () => {
    const zip = buildZip([
      { name: 'a.csv', data: Buffer.from('1') },
      { name: 'b.csv', data: Buffer.from('2') },
      { name: 'c.json', data: Buffer.from('{}') },
    ]);

    expect(readLocalEntries(zip).map((entry) => entry.name)).toEqual(['a.csv', 'b.csv', 'c.json']);
    expect(zip.readUInt16LE(zip.length - 14)).toBe(3); // 中央目录条目数
  });

  it('拒绝路径穿越与绝对路径', () => {
    expect(() => buildZip([{ name: '../evil.txt', data: Buffer.from('x') }])).toThrow();
    expect(() => buildZip([{ name: '/abs.txt', data: Buffer.from('x') }])).toThrow();
    expect(() => buildZip([{ name: 'a\\b.txt', data: Buffer.from('x') }])).toThrow();
  });

  it('空条目列表也能生成合法 ZIP', () => {
    const zip = buildZip([]);
    expect(zip.length).toBe(22);
    expect(zip.readUInt32LE(0)).toBe(0x06054b50);
  });
});
