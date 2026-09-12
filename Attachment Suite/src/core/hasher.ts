/** 内容指纹 / 去重哈希（零依赖内联 MD5）。 */

// 标准 MD5 实现（RFC 1321），不产生任何运行时依赖。
// 输入为 Uint8Array，输出 32 位小写十六进制。

const S: number[] = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K: number[] = new Array(64);
for (let i = 0; i < 64; i++) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
}

function rotl(x: number, c: number): number {
  return ((x << c) | (x >>> (32 - c))) >>> 0;
}

function toLittleEndianWords(message: Uint8Array): number[] {
  const len = message.length;
  const paddedLen = ((((len + 8) >> 6) + 1) << 6);
  const words = new Uint32Array(paddedLen >> 2);
  for (let i = 0; i < len; i++) {
    words[i >> 2] |= message[i] << ((i % 4) << 3);
  }
  // 追加 0x80 填充位
  words[len >> 2] |= 0x80 << ((len % 4) << 3);
  const bitLenLo = (len << 3) >>> 0;
  const bitLenHi = Math.floor(len / 0x20000000);
  words[words.length - 2] = bitLenLo;
  words[words.length - 1] = bitLenHi;
  return Array.from(words);
}

/**
 * 计算 MD5 摘要。
 * @param data 输入字节。
 * @returns 32 位小写十六进制摘要。
 */
export function md5Hex(data: Uint8Array): string {
  const words = toLittleEndianWords(data);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const chunkCount = words.length / 16;
  for (let chunk = 0; chunk < chunkCount; chunk++) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    const base = chunk * 16;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + K[i] + words[base + g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotl(f, S[i])) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const bytes = new Uint8Array(16);
  const out = [a0, b0, c0, d0];
  for (let j = 0; j < out.length; j++) {
    bytes[j * 4 + 0] = out[j] & 0xff;
    bytes[j * 4 + 1] = (out[j] >>> 8) & 0xff;
    bytes[j * 4 + 2] = (out[j] >>> 16) & 0xff;
    bytes[j * 4 + 3] = (out[j] >>> 24) & 0xff;
  }
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * 计算字符串 UTF-8 的 MD5（便捷方法，常用于命名片段）。
 */
export function md5HexOfString(data: string): string {
  return md5Hex(new TextEncoder().encode(data));
}