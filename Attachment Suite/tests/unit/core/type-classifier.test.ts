import { describe, expect, it } from 'vitest';
import { classify, isCategory } from '../../../src/core/type-classifier';

function buf(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

describe('type-classifier', () => {
  it('识别 PNG 静态图', () => {
    const r = classify(buf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x49, 0x48, 0x44, 0x52));
    expect(r.category).toBe('image');
    expect(r.ext).toBe('png');
    expect(r.animated).toBe(false);
  });

  it('识别 APNG（含 acTL）为动画图', () => {
    // 头 8 字节 + acTL 标记
    const data = buf(
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x00,
      0x61, 0x63, 0x54, 0x4c,
    );
    const r = classify(data);
    expect(r.category).toBe('image');
    expect(r.animated).toBe(true);
  });

  it('识别 JPEG', () => {
    const r = classify(buf(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10));
    expect(r.category).toBe('image');
    expect(r.ext).toBe('jpg');
  });

  it('识别 SVG 并标记 isSvg', () => {
    const r = classify(buf(0x3c, 0x73, 0x76, 0x67)); // "<svg"
    expect(r.category).toBe('image');
    expect(r.isSvg).toBe(true);
  });

  it('识别 PDF', () => {
    const r = classify(buf(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34));
    expect(r.category).toBe('pdf');
    expect(r.ext).toBe('pdf');
  });

  it('识别 mp4', () => {
    const r = classify(buf(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d));
    expect(r.category).toBe('video');
    expect(r.ext).toBe('mp4');
  });

  it('回落到提示扩展名（未知内容 + hintPath）', () => {
    const r = classify(buf(0x01, 0x02, 0x03, 0x04), 'weird.custom');
    expect(r.category).toBe('misc');
    expect(r.ext).toBe('custom');
  });

  it('静态 GIF（单帧）不标动画', () => {
    // Header(6) + LSD(7)，无 GCE 扩展块
    const r = classify(buf(
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
      0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x3b,
    ));
    expect(r.category).toBe('image');
    expect(r.ext).toBe('gif');
    expect(r.animated).toBe(false);
  });

  it('动画 GIF（≥2 个 Graphic Control Extension）标动画', () => {
    const gce = [0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00];
    const r = classify(buf(
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
      0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
      ...gce, ...gce,
      0x3b,
    ));
    expect(r.animated).toBe(true);
  });

  it('识别 BMP', () => {
    const r = classify(buf(0x42, 0x4d, 0x00, 0x00, 0x00, 0x00));
    expect(r.category).toBe('image');
    expect(r.ext).toBe('bmp');
  });

  it('识别静态 WebP', () => {
    const r = classify(buf(
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ));
    expect(r.category).toBe('image');
    expect(r.ext).toBe('webp');
    expect(r.animated).toBe(false);
  });

  it('识别动画 WebP（VP8X 标志字节 bit1）', () => {
    const data = new Uint8Array(30);
    data.set([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
    data[20] = 0x02; // VP8X animation flag
    const r = classify(data);
    expect(r.animated).toBe(true);
  });

  it('识别 AVIF（ftyp 品牌 avif）', () => {
    const r = classify(buf(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66));
    expect(r.category).toBe('image');
    expect(r.ext).toBe('avif');
  });

  it('识别 WebM 视频', () => {
    const r = classify(buf(0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00));
    expect(r.category).toBe('video');
    expect(r.ext).toBe('webm');
  });

  it('识别音频：MP3 / FLAC / WAV / OGG', () => {
    expect(classify(buf(0x49, 0x44, 0x33, 0x04)).ext).toBe('mp3');
    expect(classify(buf(0x66, 0x4c, 0x61, 0x43)).ext).toBe('flac');
    expect(classify(buf(0x52, 0x49, 0x46, 0x46, 0x00, 0x00)).ext).toBe('wav');
    expect(classify(buf(0x4f, 0x67, 0x67, 0x53, 0x00)).ext).toBe('ogg');
    expect(classify(buf(0x49, 0x44, 0x33, 0x04)).category).toBe('audio');
  });

  it('识别 ZIP 办公文档 docx / xlsx / pptx 与普通 zip', () => {
    const word = [0x77, 0x6f, 0x72, 0x64, 0x2f]; // "word/"
    const xl = [0x78, 0x6c, 0x2f]; // "xl/"
    const ppt = [0x70, 0x70, 0x74, 0x2f]; // "ppt/"
    expect(classify(buf(0x50, 0x4b, 0x03, 0x04, ...word, ...word)).ext).toBe('docx');
    expect(classify(buf(0x50, 0x4b, 0x03, 0x04, ...xl, ...xl)).ext).toBe('xlsx');
    expect(classify(buf(0x50, 0x4b, 0x03, 0x04, ...ppt, ...ppt)).ext).toBe('pptx');
    const plainZip = classify(buf(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00));
    expect(plainZip.category).toBe('misc');
    expect(plainZip.ext).toBe('zip');
  });

  it('识别 HTML 页面（<!DOCTYPE 与 <html 文本）', () => {
    const r1 = classify(buf(0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54)); // "<!DOCT"
    expect(r1.category).toBe('webpage');
    expect(r1.ext).toBe('html');
    const r2 = classify(new TextEncoder().encode('<html><body>hi</body></html>'));
    expect(r2.category).toBe('webpage');
    expect(r2.ext).toBe('html');
  });

  it('纯 ASCII 文本识别为 document/txt', () => {
    const r = classify(new TextEncoder().encode('hello world, this is a plain note.'));
    expect(r.category).toBe('document');
    expect(r.ext).toBe('txt');
  });

  it('空内容返回 misc/bin 兜底', () => {
    const r = classify(new Uint8Array(0), 'a.png');
    expect(r.category).toBe('misc');
    expect(r.ext).toBe('bin');
  });

  it('未知内容无合法提示扩展名时回退 EMPTY', () => {
    // 尾随点（无扩展名段）/ 扩展名过长均不接受
    expect(classify(buf(0x01), 'file.').ext).toBe('bin');
    expect(classify(buf(0x01), 'a' + '.'.repeat(12)).ext).toBe('bin');
    expect(classify(buf(0x01), 'a.b.c').ext).toBe('c');
  });

  it('isCategory 判断类别归属', () => {
    const r = classify(buf(0x89, 0x50, 0x4e, 0x47));
    expect(isCategory(r, 'image')).toBe(true);
    expect(isCategory(r, 'video')).toBe(false);
  });
});