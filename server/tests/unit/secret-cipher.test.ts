import { describe, expect, it } from 'vitest';
import { keyHint, openSecret, sameSecret, sealSecret } from '@/lib/secret-cipher';

const PURPOSE = 'rate-provider';

describe('密钥加解密', () => {
  it('往返后还原原文', () => {
    const sealed = sealSecret('my-super-secret-key', PURPOSE);
    expect(sealed).not.toContain('my-super-secret-key');
    expect(openSecret(sealed, PURPOSE)).toBe('my-super-secret-key');
  });

  it('同一明文两次加密得到不同密文（随机 IV）', () => {
    const a = sealSecret('same-key', PURPOSE);
    const b = sealSecret('same-key', PURPOSE);
    expect(a).not.toBe(b);
    expect(openSecret(a, PURPOSE)).toBe('same-key');
    expect(openSecret(b, PURPOSE)).toBe('same-key');
  });

  it('用途不匹配时解不开', () => {
    const sealed = sealSecret('my-key', PURPOSE);
    expect(openSecret(sealed, 'other-purpose')).toBeNull();
  });

  it('密文被篡改时解不开而不是给出损坏值', () => {
    const sealed = sealSecret('my-key', PURPOSE);
    const raw = Buffer.from(sealed, 'base64');
    // 翻转密文区的最后一个字节，认证标签必然校验失败
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff;
    expect(openSecret(raw.toString('base64'), PURPOSE)).toBeNull();
  });

  it('无法解析或过短的输入返回 null，不抛错', () => {
    expect(openSecret('', PURPOSE)).toBeNull();
    expect(openSecret('not-base64-at-all', PURPOSE)).toBeNull();
    expect(openSecret(Buffer.from('short').toString('base64'), PURPOSE)).toBeNull();
  });

  it('空字符串也能正常往返', () => {
    expect(openSecret(sealSecret('', PURPOSE), PURPOSE)).toBe('');
  });
});

describe('密钥回显提示', () => {
  it('足够长的密钥只显示末四位', () => {
    expect(keyHint('abcdefghijklmnop')).toBe('••••mnop');
  });

  it('短密钥整串遮蔽：露出末四位等于泄露大半', () => {
    expect(keyHint('short')).toBe('••••');
    expect(keyHint('abcdefghijk')).toBe('••••');
  });

  it('恰好 12 位开始显示末四位', () => {
    expect(keyHint('abcdefghijkl')).toBe('••••ijkl');
  });

  it('空串不显示任何内容', () => {
    expect(keyHint('')).toBe('');
  });

  it('首尾空格不影响判定', () => {
    expect(keyHint('  abcdefghijklmnop  ')).toBe('••••mnop');
  });
});

describe('常数时间比较', () => {
  it('相同字符串为真，长度不同为假', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abcd')).toBe(false);
    expect(sameSecret('abc', 'abd')).toBe(false);
  });
});
