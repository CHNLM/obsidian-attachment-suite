import { describe, expect, it } from 'vitest';
import { crc32, createZip, listZipEntries } from '../../../src/core/zip';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('zip (内联 store)', () => {
  it('CRC-32 标准校验向量', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
  });

  it('生成含 manifest 与多个文件的 zip，条目可列', () => {
    const zip = createZip([
      { name: 'manifest.json', data: enc('{}') },
      { name: 'a.png', data: new Uint8Array([1, 2, 3]) },
      { name: 'b.mp4', data: enc('video-bytes') },
    ]);
    const names = listZipEntries(zip);
    expect(names).toEqual(['manifest.json', 'a.png', 'b.mp4']);
  });

  it('zip 具有规范签名（local / central / EOCD）', () => {
    const zip = createZip([{ name: 'x.bin', data: new Uint8Array([0, 1, 2]) }]);
    // local: PK\x03\x04
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
    // EOCD 长 22 字节，签名位于末尾第 22~19 字节
    expect(zip[zip.length - 22]).toBe(0x50);
    expect(zip[zip.length - 21]).toBe(0x4b);
    expect(zip[zip.length - 20]).toBe(0x05);
    expect(zip[zip.length - 19]).toBe(0x06);
  });

  it('空文件列表仍生成合法 EOCD', () => {
    const zip = createZip([]);
    expect(listZipEntries(zip)).toEqual([]);
    expect(zip.length).toBe(22);
  });
});