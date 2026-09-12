/** 内联 ZIP 写入（store，无压缩）。零运行时依赖，产物为合法 ZIP。 */

export interface ZipEntryInput {
  /** 归档内路径（UTF-8）。 */
  name: string;
  data: Uint8Array;
}

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 校验（标准 zip 算法）。 */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC32_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** 生成一个 store（无压缩）ZIP。 */
export function createZip(files: ZipEntryInput[], date = new Date()): Uint8Array {
  const { time, date: ddate } = dosDateTime(date);
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = new TextEncoder().encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    // Local file header（30B）
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true); // version needed
    lh.setUint16(6, 0, true); // flags
    lh.setUint16(8, 0, true); // method = store
    lh.setUint16(10, time, true);
    lh.setUint16(12, ddate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true); // extra

    localParts.push(new Uint8Array(lh.buffer), nameBytes, f.data);

    // Central directory header（46B）
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true); // version made by
    ch.setUint16(6, 20, true); // version needed
    ch.setUint16(8, 0, true);
    ch.setUint16(10, 0, true); // method
    ch.setUint16(12, time, true);
    ch.setUint16(14, ddate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint16(30, 0, true); // extra len
    ch.setUint16(32, 0, true); // comment len
    ch.setUint16(34, 0, true); // disk start
    ch.setUint16(36, 0, true); // internal attrs
    ch.setUint32(38, 0, true); // external attrs
    ch.setUint32(42, offset, true); // local header offset

    centralParts.push(new Uint8Array(ch.buffer), nameBytes);
    offset += 30 + nameBytes.length + size;
  }

  const cd = concat(centralParts);
  const cdOffset = offset;

  // EOCD（22B）
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cd.length, true);
  eocd.setUint32(16, cdOffset, true);
  eocd.setUint16(20, 0, true); // comment len

  return concat([...localParts, cd, new Uint8Array(eocd.buffer)]);
}

/** 解析 ZIP 中央目录，返回份条目名列表（供校验/测试）。 */
export function listZipEntries(zip: Uint8Array): string[] {
  // 从尾部找 EOCD
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
      const cdOffset = readU32(zip, i + 16);
      const numEntries = readU16(zip, i + 10);
      const names: string[] = [];
      let p = cdOffset;
      for (let n = 0; n < numEntries; n++) {
        if (readU32(zip, p) !== 0x02014b50) break;
        const nameLen = readU16(zip, p + 28);
        const extraLen = readU16(zip, p + 30);
        const commentLen = readU16(zip, p + 32);
        names.push(new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen)));
        p += 46 + nameLen + extraLen + commentLen;
      }
      return names;
    }
  }
  return [];
}

function readU16(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8)) & 0xffff;
}

function readU32(b: Uint8Array, o: number): number {
  return ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0);
}