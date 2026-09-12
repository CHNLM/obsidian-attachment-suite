import { describe, expect, it } from 'vitest';
import {
  applyRefReplacements,
  bytesMd5,
  decodeDataUri,
  findExternalRefs,
  localLinkText,
  localName,
} from '../../../src/features/localize-media-core';

describe('localize-media-core', () => {
  it('提取 markdown 外部图片（http 与 data）', () => {
    const refs = findExternalRefs('前 ![a](https://x.com/a.png) 中 ![b](data:image/png;base64,AA==) 后');
    expect(refs).toHaveLength(2);
    expect(refs[0].kind).toBe('http');
    expect(refs[0].nameHint).toBe('a.png');
    expect(refs[1].kind).toBe('data');
  });

  it('忽略本地路径与纯链接', () => {
    const refs = findExternalRefs('![l](assets/l.png) [链接](https://x.com/page)');
    expect(refs).toHaveLength(0);
  });

  it('默认关闭扩展扫描：不捕获普通链接与 HTML 标签', () => {
    const refs = findExternalRefs('[pdf](https://x.com/a.pdf) <img src="https://x.com/p.png">');
    expect(refs).toHaveLength(0);
  });

  it('扩展扫描捕获普通 markdown 链接（http）', () => {
    const refs = findExternalRefs('参考 [资料](https://x.com/a.pdf) 与 ![图](https://x.com/a.png)', true);
    const urls = refs.map((r) => r.url);
    expect(urls).toContain('https://x.com/a.pdf');
    // 图片语法未被普通链接重复捕获
    expect(urls.filter((u) => u === 'https://x.com/a.png')).toHaveLength(1);
  });

  it('扩展扫描捕获 HTML img/audio/video 的 src', () => {
    const refs = findExternalRefs(
      '<img alt="封面" src="https://x.com/c.png"> <audio src="https://x.com/m.mp3"></audio> 视频 <video src="https://x.com/v.webm"></video>',
      true,
    );
    expect(refs.map((r) => r.url)).toEqual([
      'https://x.com/c.png',
      'https://x.com/m.mp3',
      'https://x.com/v.webm',
    ]);
    expect(refs[0].nameHint).toBe('c.png');
    expect(refs[0].alt).toBe('封面');
  });

  it('扩展扫描：HTML src 支持单引号并解码实体，忽略本地/无 src 标签', () => {
    const text = "<img src='https://x.com/a.png'/> <img> <img src='assets/l.png'> <img src='https://x.com/&amp;.png'>";
    const refs = findExternalRefs(text, true);
    const urls = refs.map((r) => r.url);
    expect(urls).toContain('https://x.com/a.png');
    expect(urls).toContain('https://x.com/&.png');
    expect(urls).not.toContain('assets/l.png');
  });

  it('生成本地引用文本（markdown / wiki）', () => {
    expect(localLinkText('alt', 'assets/a1.png', 'markdown')).toBe('![alt](assets/a1.png)');
    expect(localLinkText('alt', 'assets/a1.png', 'wiki')).toBe('![[assets/a1.png|alt]]');
  });

  it('按映射改写正文', () => {
    const text = '图 ![alt](https://x.com/a.png) 和 ![b](data:image/png;base64,AA==)';
    const refs = findExternalRefs(text);
    const map = new Map([
      ['https://x.com/a.png', 'assets/a1.png'],
      ['data:image/png;base64,AA==', 'assets/b1.png'],
    ]);
    const out = applyRefReplacements(text, refs, map, 'markdown');
    expect(out).toBe('图 ![alt](assets/a1.png) 和 ![b](assets/b1.png)');
  });

  it('MD5 命名去重（useMd5）', () => {
    const data = new TextEncoder().encode('hello');
    const md5 = bytesMd5(data);
    expect(localName(md5, 'a.png', true, 'png')).toBe(`${md5}.png`);
  });

  it('非 MD5 时用安全原始名，空名回退 MD5', () => {
    const data = new TextEncoder().encode('hello');
    const md5 = bytesMd5(data);
    expect(localName(md5, 'my image.png', false, 'png')).toBe('my image.png');
    expect(localName(md5, '../evil', false, 'png')).toBe(`${md5}.png`);
  });

  it('解码 base64 data URI', () => {
    // "hi" base64
    const bytes = decodeDataUri('data:image/png;base64,aGk=');
    expect(bytes).not.toBeNull();
    expect(Array.from(bytes as Uint8Array)).toEqual([0x68, 0x69]);
  });

  it('解码非 base64（URL 编码文本）data URI', () => {
    const bytes = decodeDataUri('data:text/plain,%E4%BD%A0%E5%A5%BD');
    expect(bytes).not.toBeNull();
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe('你好');
  });

  it('畸形 data URI 返回 null', () => {
    expect(decodeDataUri('not-a-data-uri')).toBeNull();
    expect(decodeDataUri('data:image/png;base64,@@@bad@@@')).toBeNull(); // 非法 base64
  });

  it('nameHint 回退：URL 无扩展名时用 alt', () => {
    const refs = findExternalRefs('![封面图](https://x.com/path/to/page)');
    expect(refs[0].nameHint).toBe('封面图');
  });

  it('localName 非 MD5 且提示名无点时用 提示名+扩展名', () => {
    const md5 = 'abc123';
    expect(localName(md5, 'image', false, 'png')).toBe('image.png');
    expect(localName(md5, '', false, 'png')).toBe(`${md5}.png`);
  });

  it('applyRefReplacements 支持 wiki 链接风格', () => {
    const text = '图 ![alt](https://x.com/a.png)';
    const refs = findExternalRefs(text);
    const out = applyRefReplacements(text, refs, new Map([['https://x.com/a.png', 'assets/a1.png']]), 'wiki');
    expect(out).toBe('图 ![[assets/a1.png|alt]]');
  });

  it('data URI 的 nameHint 使用 alt', () => {
    const refs = findExternalRefs('![图示](data:image/png;base64,AA==)');
    expect(refs[0].nameHint).toBe('图示');
    expect(refs[0].kind).toBe('data');
  });

  it('畸形百分号编码 URL 不抛错，nameHint 回退 alt（健壮性）', () => {
    // decodeURIComponent('%zz') 会抛 URIError；findExternalRefs 不应因此崩溃
    expect(() =>
      findExternalRefs('![a](https://x.com/foo%zz.png) ![b](https://x.com/%E0%A4%A-bad%zz.png)'),
    ).not.toThrow();
    const refs = findExternalRefs('![封面图](https://x.com/a%zz-piece.png)');
    expect(refs).toHaveLength(1);
    expect(refs[0].nameHint).toBe('封面图');
    // 有 alt 时回退 alt（即便 URL 段含无法解码的百分号编码）
    expect(findExternalRefs('![图示](https://x.com/a%zz.png)')[0].nameHint).toBe('图示');
    // 无 alt 时回退 'image'
    expect(findExternalRefs('![](https://x.com/a%zz.png)')[0].nameHint).toBe('image');
  });

  it('localName：提示名含路径分隔符时回退 MD5（防路径穿越）', () => {
    const md5 = 'ab12cd34ef56ab12cd34ef56ab12cd34';
    expect(localName(md5, '../../evil.png', false, 'png')).toBe(`${md5}.png`);
    expect(localName(md5, '/abs/evil.png', false, 'png')).toBe(`${md5}.png`);
    // 合法带点提示名保留原名
    expect(localName(md5, 'normal.png', false, 'png')).toBe('normal.png');
  });
});