import { describe, expect, it } from 'vitest';
import { md5Hex, md5HexOfString } from '../../../src/core/hasher';

describe('hasher (MD5)', () => {
  it('计算空串的 MD5', () => {
    expect(md5HexOfString('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('计算 abc 的 MD5（RFC 向量）', () => {
    expect(md5HexOfString('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  it('对字节输入与字符串输入结果一致', () => {
    const s = 'hello attachment';
    expect(md5Hex(new TextEncoder().encode(s))).toBe(md5HexOfString(s));
  });

  it('长字符串稳定且不越界', () => {
    const s = 'x'.repeat(300);
    expect(md5HexOfString(s)).toHaveLength(32);
  });

  it('空字节输入与空串一致', () => {
    expect(md5Hex(new Uint8Array(0))).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('多字节 UTF-8（中文/emoji）字节输入与字符串一致', () => {
    for (const s of ['中文附件', 'emoji😀mix', '混合_abc_你好']) {
      expect(md5Hex(new TextEncoder().encode(s))).toBe(md5HexOfString(s));
    }
  });

  it('超过一个 512 位分块的输入仍正确（RFC 1321 权威向量）', () => {
    // RFC 1321 附录测试套件第 7 条：由 1~0 重复构成的 80 字节串。
    // 80 字节 > 64 字节单块边界，必须跨块；用权威摘要而非仅自一致性校验。
    const s = '12345678901234567890123456789012345678901234567890123456789012345678901234567890';
    const hex = md5HexOfString(s);
    expect(hex).toBe('57edf4a22be3c955ac49da2e2107b67a');
    // 字节输入与字符串输入结果一致
    expect(md5Hex(new TextEncoder().encode(s))).toBe(hex);
  });
});