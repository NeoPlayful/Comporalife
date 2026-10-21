/**
 * 编码探测：只接受 UTF-8 与 GB18030。
 * UTF-16 与二进制文件直接拒绝，避免把字节流当文本解析造成乱码入账。
 */

export type SupportedEncoding = 'utf-8' | 'gb18030';

export interface EncodingResult {
  encoding: SupportedEncoding;
  /** 剥离 BOM 后的文本 */
  text: string;
  hadBom: boolean;
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16_BOMS = [Buffer.from([0xff, 0xfe]), Buffer.from([0xfe, 0xff])];

export class EncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncodingError';
  }
}

export function detectEncoding(buffer: Buffer, forced?: SupportedEncoding): EncodingResult {
  for (const bom of UTF16_BOMS) {
    if (buffer.subarray(0, bom.length).equals(bom)) {
      throw new EncodingError('不支持 UTF-16 编码，请另存为 UTF-8 或 GBK');
    }
  }

  const hadBom = buffer.subarray(0, UTF8_BOM.length).equals(UTF8_BOM);
  const body = hadBom ? buffer.subarray(UTF8_BOM.length) : buffer;

  if (forced === 'utf-8') {
    return { encoding: 'utf-8', text: decodeUtf8Strict(body), hadBom };
  }
  if (forced === 'gb18030') {
    return { encoding: 'gb18030', text: new TextDecoder('gb18030').decode(body), hadBom };
  }

  if (hadBom) {
    return { encoding: 'utf-8', text: decodeUtf8Strict(body), hadBom };
  }

  try {
    return { encoding: 'utf-8', text: decodeUtf8Strict(body), hadBom };
  } catch {
    const text = new TextDecoder('gb18030').decode(body);
    // GB18030 解码器把无法映射的字节产出为 U+FFFD，出现即视为失败
    if (text.includes('�')) {
      throw new EncodingError('无法识别文件编码，请手动选择 UTF-8 或 GBK');
    }
    return { encoding: 'gb18030', text, hadBom };
  }
}

function decodeUtf8Strict(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new EncodingError('文件不是有效的 UTF-8 文本');
  }
}

/** 二进制探测：含 NUL 字节即视为非文本 */
export function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0x00);
}
