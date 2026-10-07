import { describe, expect, it } from 'vitest';
import {
  listMatches,
  listFrontmatterLinks,
  refMapForMoves,
  rewrite,
  rewriteFrontmatter,
  sanitizeFilename,
  stripCodeBlocks,
} from '../../../src/core/link-resolver';

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

  it('frontmatter 改写支持 URL 编码的 %20 路径（归一化为字面路径）', () => {
    const text = ['---', 'cover: attachments/my%20img.png', '---', ''].join('\n');
    expect(
      rewriteFrontmatter(text, new Map([['attachments/my%20img.png', 'assets/my img.png']])),
    ).toContain('cover: assets/my img.png');
  });

  it('解析 HTML 标签资源（img/audio/video/source/a，属性顺序与引号任意）', () => {
    const m = listMatches('<img src="assets/a.png" alt="x"> <audio src=\'b.mp3\'> <video src="c.mp4"></video>');
    const texts = m.filter((x) => x.type === 'html').map((x) => x.linkText);
    expect(texts).toEqual(['assets/a.png', 'b.mp3', 'c.mp4']);
    // 属性顺序任意：src 在后
    expect(listMatches('<img alt="x" width="10" src="d.png">')[0].linkText).toBe('d.png');
    // <a href> 链接
    expect(listMatches('<a href="docs/a.pdf">资料</a>')[0].linkText).toBe('docs/a.pdf');
    // <source> 标签
    expect(listMatches('<video><source src="v.webm" type="video/webm"></video>')[0].linkText).toBe('v.webm');
  });

  it('HTML 标签改写保留引号风格', () => {
    expect(rewrite('<img src="a.png">', new Map([['a.png', 'assets/b.png']]))).toBe('<img src="assets/b.png">');
    expect(rewrite("<audio src='b.mp3'>", new Map([['b.mp3', 'assets/c.mp3']]))).toBe("<audio src='assets/c.mp3'>");
  });

  it('含空格的中文/emoji 目标不被空白截断（否则会漏进"在用"集合而被误删）', () => {
    // 插件命名会生成 `笔记名_image_001.png`，其引用含空格；旧正则 `[^)\s]+` 会把它读成
    // `notes/assets/15-中文`（扩展名丢失）→「清理未用附件」误判为孤儿并删除。
    const text = '![x](notes/assets/15-中文 空格 emoji 😀_pdf_001.pdf)';
    expect(listMatches(text)[0].linkText).toBe('notes/assets/15-中文 空格 emoji 😀_pdf_001.pdf');
    // CommonMark 的尖括号写法同样要能解析
    expect(listMatches('![x](<notes/assets/我的 图.png>)')[0].linkText).toBe('notes/assets/我的 图.png');
    // 空格的 alt 与目标并存时不串位
    expect(listMatches('![我的 图](notes/assets/a.png)')[0].linkText).toBe('notes/assets/a.png');
  });

  it('目标做 %xx 解码，故与库内字面路径一致', () => {
    expect(listMatches('![x](assets/enc%20oded.png)')[0].linkText).toBe('assets/enc oded.png');
    // 非法转义不抛异常，原样返回
    expect(listMatches('![x](assets/bad%zz.png)')[0].linkText).toBe('assets/bad%zz.png');
    // 已解码的引用不会被二次处理
    expect(listMatches('![x](assets/enc oded.png)')[0].linkText).toBe('assets/enc oded.png');
  });

  it('markdown 标题段被保留，且不改动 alt', () => {
    const m = listMatches('[说明](assets/a.png "文档标题")')[0];
    expect(m.linkText).toBe('assets/a.png');
    expect(m.title).toBe(' "文档标题"');
    expect(m.alt).toBe('说明');
    expect(rewrite('[说明](assets/a.png "文档标题")', new Map([['assets/a.png', 'assets/b.png']])))
      .toBe('[说明](assets/b.png "文档标题")');
  });

  it('改写新目标时对空格/圆括号编码（裸空格会让 markdown 链接失效）', () => {
    expect(rewrite('![x](assets/old.png)', new Map([['assets/old.png', 'assets/我的 图.png']])))
      .toBe('![x](assets/我的%20图.png)');
    expect(rewrite('![x](assets/old.png)', new Map([['assets/old.png', 'assets/a(1).png']])))
      .toBe('![x](assets/a%281%29.png)');
    // 已编码的旧目标能被命中并改写
    expect(rewrite('![x](assets/my%20old.png)', new Map([['assets/my old.png', 'assets/new.png']])))
      .toBe('![x](assets/new.png)');
    // 新目标里的 `$&`/`$1` 不得被当作替换模式展开
    expect(rewrite('![x](assets/old.png)', new Map([['assets/old.png', 'assets/$&$1.png']])))
      .toBe('![x](assets/$&$1.png)');
  });

  it('frontmatter 改写支持含空格与中文的资源路径（含列表形式）', () => {
    expect(rewriteFrontmatter(
      ['---', 'cover: assets/我的 图.png', '---', ''].join('\n'),
      new Map([['assets/我的 图.png', 'assets/new.png']]),
    )).toContain('cover: assets/new.png');
    expect(rewriteFrontmatter(
      ['---', 'images:', '  - assets/我的 图.png', '---', ''].join('\n'),
      new Map([['assets/我的 图.png', 'assets/new.png']]),
    )).toContain('- assets/new.png');
    expect(rewriteFrontmatter(
      ['---', 'cover: "assets/my pic.png"', '---', ''].join('\n'),
      new Map([['assets/my pic.png', 'assets/new.png']]),
    )).toContain('cover: "assets/new.png"');
  });

  it('fenced 代码块内的链接不参与解析（不误报）', () => {
    const text = [
      '正文 ![[real.png]]',
      '```',
      '![fake](ghost.png)',
      '```',
      '~~~',
      '[[also-ghost.png]]',
      '~~~',
      '结尾',
    ].join('\n');
    const links = listMatches(text);
    expect(links.map((x) => x.linkText)).toEqual(['real.png']);
  });

  it('行内代码内的链接不参与解析', () => {
    const text = '代码 `![fake](ghost.png) 与 [[fake2.png]]` 后接 `code` 正文 ![[real.png]]';
    const links = listMatches(text);
    expect(links.map((x) => x.linkText)).toEqual(['real.png']);
  });

  it('stripCodeBlocks：剥离围栏与行内代码但保留正文', () => {
    const src = ['# t', '```js', 'const x = 1', '```', '正文 `inline` 结束'].join('\n');
    const stripped = stripCodeBlocks(src);
    expect(stripped).toContain('# t');
    expect(stripped).toContain('正文');
    expect(stripped).not.toContain('const x = 1');
    expect(stripped).not.toContain('inline');
  });

  it('stripCodeBlocks：剥离单行与跨行 HTML 注释，注释外文本原样保留', () => {
    const src = [
      '前 <!-- ![x](assets/commented.png) --> 后',
      '<!-- 多行注释开始',
      '![y](assets/also-commented.png)',
      '注释结束 -->',
      '正常 ![z](assets/real.png)',
    ].join('\n');
    const stripped = stripCodeBlocks(src);
    expect(stripped).toContain('前');
    expect(stripped).toContain('后');
    expect(stripped).not.toContain('commented');
    expect(stripped).not.toContain('also-commented');
    expect(stripped).toContain('正常');
    expect(stripped).toContain('assets/real.png');
    // 行数与行长保持（剥离区替换为空格，便于其它按位置处理的逻辑）
    expect(stripped.split('\n').length).toBe(src.split('\n').length);
  });

  it('stripCodeBlocks：行内代码里的 <!-- 不触发注释状态', () => {
    const src = ['行内 `<!--` 之后仍有 ![z](assets/real.png)'].join('\n');
    const stripped = stripCodeBlocks(src);
    expect(stripped).toContain('assets/real.png');
  });
});

// 原 tests/unit/features/link-fixer-core.test.ts：refMapForMoves 已归位到 core（纯函数），
// 测试随之落到这里，避免"模块搬家、测试还留在旧目录"。
describe('refMapForMoves（移动结果 → 改写映射）', () => {
  it('完整路径与 basename 均可映射', () => {
    const map = refMapForMoves([{ from: 'assets/raw pic.png', to: 'assets/E2E_image_001.png' }]);
    expect(map.get('assets/raw pic.png')).toBe('assets/E2E_image_001.png');
    expect(map.get('raw pic.png')).toBe('assets/E2E_image_001.png');
  });

  it('rewrite 能将短名嵌入改写为目标路径', () => {
    const map = refMapForMoves([{ from: 'assets/raw pic.png', to: 'assets/E2E_image_001.png' }]);
    const out = rewrite('![[raw pic.png]]\n', map);
    expect(out).toContain('assets/E2E_image_001.png');
    expect(out).not.toContain('raw pic.png');
  });

  it('两个目录存在同名文件时，basename 短名以首个移动目标为准（不覆盖）', () => {
    const map = refMapForMoves([
      { from: 'a/x.png', to: 'a/x_1.png' },
      { from: 'b/x.png', to: 'b/x_2.png' },
    ]);    // 完整路径各自独立映射
    expect(map.get('a/x.png')).toBe('a/x_1.png');
    expect(map.get('b/x.png')).toBe('b/x_2.png');
    // 纯 basename 短名命中首个目标；不因第二个移动而改写，避免歧义改写错误文件
    expect(map.get('x.png')).toBe('a/x_1.png');
  });

  it('无扩展名短名 `![[song]]` 必须能命中映射（真实 Obsidian 上的数据损失）', () => {
    // 回归：`![[song]]` 引用的 assets/mp3/song.mp3 被改名并搬走后，映射里只有
    // `assets/mp3/song.mp3` 与 `song.mp3` 两个键，`song` 查不到 → 引用原地不动 →
    // 文件失去引用者 → 被「清理未用附件」当孤儿移入回收站，笔记留下悬空引用。
    // 读取侧（attachment-index 的 stemPaths）早就按主名反查了，这里补上**写入侧**。
    const map = refMapForMoves([{ from: 'assets/mp3/song.mp3', to: 'notes/assets/14-短名_audio_001.mp3' }]);
    expect(map.get('song')).toBe('notes/assets/14-短名_audio_001.mp3');

    const out = rewrite('# 14\n\n![[song]]\n', map);
    expect(out).toContain('![[notes/assets/14-短名_audio_001.mp3]]');
    expect(out).not.toContain('![[song]]');
  });

  it('无扩展名短名遇到多份同名主名时以首个目标为准（不覆盖，避免改到错误文件）', () => {
    const map = refMapForMoves([
      { from: 'a/x.png', to: 'a/x_1.png' },
      { from: 'b/x.jpg', to: 'b/x_2.jpg' },
    ]);
    expect(map.get('x')).toBe('a/x_1.png');
  });

  it('主名不得覆盖已经存在的同名字符串键', () => {
    // `assets/x`（无扩展名文件）与 `x.png` 的主名同为 `x`：先到的键保留，不被覆盖
    const map = refMapForMoves([{ from: 'assets/x.png', to: 'dst/x.png' }]);
    expect(map.has('x')).toBe(true);
    expect(map.get('x.png')).toBe('dst/x.png');
    expect(map.get('x')).toBe('dst/x.png');
  });
});

describe('link-resolver：目标含嵌套括号的合法文件名（真实宿主上造成过数据损失）', () => {
  // 2026-09-28 验收用例 L06/P01 实测：`path-cases/normal name (1)-ok.png` 被「清理未用附件」
  // **移入回收站**，笔记留下断链。根因是目标捕获写成 `([^)]*)`，在 `(1)` 的 `)` 处提前收尾：
  // 截断后的目标既不在"在用"集合里（→ 被当孤儿删掉），也不会被改名联动改写。
  // Windows 的同名副本 `报告 (1).png` 是**合法且常见**的文件名，必须解析正确。
  const TARGET = 'path-cases/normal name (1)-ok.png';
  const mdTargets = (text: string): string[] =>
    listMatches(text).filter((m) => m.type === 'markdown').map((m) => m.linkText);

  it('listMatches 必须捕获完整目标（不能在第一个 ) 处截断）', () => {
    expect(mdTargets(`# t

![x](${TARGET})
`)).toEqual([TARGET]);
  });

  it('rewrite 必须能改写它（否则改名后引用悬空 → 附件被当孤儿清理）', () => {
    const out = rewrite(`# t

![x](${TARGET})
`, new Map([[TARGET, 'path-cases/new (2).png']]));
    expect(out).toContain('new%20%282%29.png');
    expect(
      out,
      '旧目标必须被替换掉；若仍原样保留，说明解析在第一个 ) 处截断、根本没匹配上',
    ).not.toContain('normal name (1)-ok.png');
  });

  it('带标题 + 嵌套括号：标题仍须被剥离，不进目标', () => {
    const m = listMatches(`![x](${TARGET} "图注 (1)")`)[0];
    expect(m.linkText).toBe(TARGET);
    expect(m.title, '标题段应原样保留，不并入目标').toContain('图注');
  });

  it('尖括号包裹 + 嵌套括号同样可用', () => {
    expect(mdTargets(`![x](<${TARGET}>)`)).toEqual([TARGET]);
  });

  it('反例：没有嵌套括号的普通目标不得被新规则破坏', () => {
    expect(mdTargets('![a](assets/pic.png) ![b](assets/a b.png) ![c](<assets/x y.png>)')).toEqual([
      'assets/pic.png',
      'assets/a b.png',
      'assets/x y.png',
    ]);
  });
});
