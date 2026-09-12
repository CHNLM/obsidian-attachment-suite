import { describe, expect, it } from 'vitest';
import { listMatches, listFrontmatterLinks, rewrite, rewriteFrontmatter, sanitizeFilename } from '../../../src/core/link-resolver';

describe('link-resolver', () => {
  it('解析 markdown 图片链接', () => {
    const m = listMatches('看图片 ![alt](assets/a.png) 结束');
    expect(m).toHaveLength(1);
    expect(m[0].type).toBe('markdown');
    expect(m[0].linkText).toBe('assets/a.png');
  });

  it('解析 wiki 链接与嵌入', () => {
    expect(listMatches('![[a.png]]')).toHaveLength(1);
    expect(listMatches('[[note|别名]]').find((x) => x.type === 'wiki')?.linkText).toBe('note');
  });

  it('识别 md 转包含锚点', () => {
    const m = listMatches('[seg](#sec)');
    expect(m[0].type).toBe('mdTransclusion');
  });

  it('按映射改写目标，保留外壳', () => {
    const text = '图 ![alt](assets/a.png) 与 ![[b.png]]';
    const newText = rewrite(text, new Map([
      ['assets/a.png', 'assets/new_a.png'],
      ['b.png', 'assets/new_b.png'],
    ]));
    expect(newText).toContain('![alt](assets/new_a.png)');
    expect(newText).toContain('![[assets/new_b.png]]');
  });

  it('改写 wiki 链接保留锚点与别名', () => {
    // 锚点
    const t1 = '看 [[old.png#sec1]]';
    const r1 = rewrite(t1, new Map([['old.png', 'assets/new.png']]));
    expect(r1).toBe('看 [[assets/new.png#sec1]]');
    // 别名
    const t2 = '看 [[old.png|我的图]]';
    const r2 = rewrite(t2, new Map([['old.png', 'new.png']]));
    expect(r2).toBe('看 [[new.png|我的图]]');
    // 锚点 + 别名
    const t3 = '看 [[old.png#sec1|我的图]]';
    const r3 = rewrite(t3, new Map([['old.png', 'new.png']]));
    expect(r3).toBe('看 [[new.png#sec1|我的图]]');
  });

  it('安全清洗文件名（防路径穿越）', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe(''); // 含分隔符
    expect(sanitizeFilename('..')).toBe('');
    expect(sanitizeFilename('..hidden')).toBe(''); // 以点开头
    expect(sanitizeFilename('但*清')).toBe('但_清');
    expect(sanitizeFilename('normal.png')).toBe('normal.png');
  });

  it('改写 frontmatter 本地资源引用（完整路径与 basename）', () => {
    const text = [
      '---',
      'cover: assets/hero.png',
      'images:',
      '  - assets/hero.png',
      '  - hero2.png',
      '---',
      '# 正文 ![[assets/hero.png]]',
      '',
    ].join('\n');
    const map = new Map([
      ['assets/hero.png', 'assets/note_image_001.png'],
      ['hero2.png', 'assets/note_image_002.png'],
    ]);
    const out = rewriteFrontmatter(text, map);
    expect(out).toContain('cover: assets/note_image_001.png');
    expect(out).toContain('- assets/note_image_001.png');
    expect(out).toContain('- assets/note_image_002.png');
    // 正文里的链接由 rewrite 处理，rewriteFrontmatter 不应改动正文
    expect(out).toContain('![[assets/hero.png]]');
  });

  it('frontmatter 改写保留引号且不命中无关 token', () => {
    const text = ['---', 'banner: "assets/hero.png"', 'title: hello world', '---', ''].join('\n');
    const out = rewriteFrontmatter(text, new Map([['assets/hero.png', 'assets/h2.png']]));
    expect(out).toContain('banner: "assets/h2.png"');
    expect(out).not.toContain('hero.png');
  });

  it('frontmatter 改写空映射/无 frontmatter 时原样返回', () => {
    expect(rewriteFrontmatter('# 无 frontmatter ![[a.png]]', new Map([['a.png', 'b.png']]))).toBe(
      '# 无 frontmatter ![[a.png]]',
    );
  });

  it('wiki 带锚点链接：linkText 剔除锚点以便映射命中', () => {
    const m = listMatches('![[old.png#sec1]]');
    // 目标段剔除锚点，映射可按纯路径命中；改写由 rewrite 保留锚点
    expect(m[0].linkText).toBe('old.png');
    expect(rewrite('[[old.png#sec1]]', new Map([['old.png', 'new.png']]))).toBe('[[new.png#sec1]]');
  });

  it('解析普通 markdown 链接（非图片）与空映射原样返回', () => {
    expect(listMatches('[文档](assets/a.pdf)')[0].type).toBe('markdown');
    expect(rewrite('![a](x.png) ![[y.png]]', new Map())).toBe('![a](x.png) ![[y.png]]');
  });

  it('listFrontmatterLinks：提取 markdown/wiki/相对路径资源', () => {
    const fm = {
      cover: './assets/hero.png',
      banner: '![[banner.jpg]]',
      pic: '![alt](pics/c.png)',
      attachments: ['./assets/a.pdf', '../docs/b.docx'],
      title: '一段纯文本说明', // 非资源，不应提取
      count: 42,
    };
    const links = listFrontmatterLinks(fm);
    const texts = links.map((l) => l.linkText);
    expect(texts).toEqual(expect.arrayContaining([
      './assets/hero.png',
      'banner.jpg',
      'pics/c.png',
      './assets/a.pdf',
      '../docs/b.docx',
    ]));
    expect(texts).not.toContain('一段纯文本说明');
  });

  it('listFrontmatterLinks：外链 data/http 也判为资源', () => {
    const links = listFrontmatterLinks({ banner: 'https://x.com/b.png', data: 'data:image/png;base64,AA==' });
    expect(links.map((l) => l.linkText)).toEqual([
      'https://x.com/b.png',
      'data:image/png;base64,AA==',
    ]);
  });

  it('rewrite 改写 markdown 非图片链接', () => {
    const out = rewrite('[资料](assets/a.pdf)', new Map([['assets/a.pdf', 'assets/a_001.pdf']]));
    expect(out).toBe('[资料](assets/a_001.pdf)');
  });

  it('frontmatter 改写保留单引号风格', () => {
    const text = ['---', "banner: 'assets/hero.png'", '---', ''].join('\n');
    const out = rewriteFrontmatter(text, new Map([['assets/hero.png', 'assets/h2.png']]));
    expect(out).toContain("banner: 'assets/h2.png'");
  });

  it('frontmatter 改写 map 含 basename 与完整路径均可命中', () => {
    // basename 命中（token 本身为短名）
    expect(rewriteFrontmatter(
      ['---', 'cover: hero.png', '---', ''].join('\n'),
      new Map([['hero.png', 'new.png']]),
    )).toContain('cover: new.png');
    // 完整路径命中
    expect(rewriteFrontmatter(
      ['---', 'cover: assets/hero.png', '---', ''].join('\n'),
      new Map([['assets/hero.png', 'x/y.png']]),
    )).toContain('cover: x/y.png');
    // 短名映射不命中完整路径 token（按原样保留）
    expect(rewriteFrontmatter(
      ['---', 'cover: assets/hero.png', '---', ''].join('\n'),
      new Map([['hero.png', 'new.png']]),
    )).toContain('cover: assets/hero.png');
  });
});