import { deflateRawSync } from 'node:zlib';

/**
 * 最小 ZIP 写入器。
 *
 * 不引入第三方 ZIP 依赖：导出只需要 store 与 deflate 两种模式，
 * 而通用库会带来与项目无关的加密、分卷、Zip64 等分支。
 * 这里只实现单卷、无 Zip64、UTF-8 文件名的子集，并显式拒绝超出范围的输入。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** 包内路径，使用 / 分隔；不允许以 / 开头或包含 .. */
  name: string;
  data: Buffer;
}

export interface ZipOptions {
  /** 是否 deflate 压缩；默认不压缩，保证任何解压工具都能打开 */
  compress?: boolean;
}

const MAX_ENTRIES = 65_535;
const MAX_SIZE = 0xffffffff; // 单卷 ZIP 的 32 位上限

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time: dosTime, date: dosDate };
}

function assertEntryName(name: string): void {
  if (name.startsWith('/') || name.includes('..') || name.includes('\\')) {
    throw new Error(`非法的 ZIP 条目名：${name}`);
  }
}

/** 组装标准 ZIP：本地文件头 + 数据 + 中央目录 + 结尾记录 */
export function buildZip(entries: ZipEntry[], options: ZipOptions = {}, now = new Date()): Buffer {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`ZIP 条目数超过 ${MAX_ENTRIES}`);
  }

  const { time, date } = dosDateTime(now);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    assertEntryName(entry.name);

    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const compressed = options.compress ? deflateRawSync(entry.data) : entry.data;
    const method = options.compress ? 8 : 0;

    if (compressed.length > MAX_SIZE || entry.data.length > MAX_SIZE) {
      throw new Error(`ZIP 条目过大：${entry.name}`);
    }

    // 本地文件头：签名 0x04034b50
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 解压所需版本
    local.writeUInt16LE(0x0800, 6); // bit 11：文件名为 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28); // 无扩展字段

    locals.push(local, nameBuffer, compressed);

    // 中央目录项：签名 0x02014b50
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // 创建版本
    central.writeUInt16LE(20, 6); // 解压所需版本
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30); // 扩展字段
    central.writeUInt16LE(0, 32); // 注释
    central.writeUInt16LE(0, 34); // 磁盘号
    central.writeUInt16LE(0, 36); // 内部属性
    central.writeUInt32LE(0, 38); // 外部属性
    central.writeUInt32LE(offset, 42);

    centrals.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const localBuffer = Buffer.concat(locals);

  // 结尾记录：签名 0x06054b50
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // 当前磁盘
  end.writeUInt16LE(0, 6); // 中央目录起始磁盘
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(localBuffer.length, 16);
  end.writeUInt16LE(0, 20); // 注释长度

  return Buffer.concat([localBuffer, centralBuffer, end]);
}
