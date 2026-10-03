import { describe, expect, it } from 'vitest';
import {
  applyRefReplacements,
  bytesMd5,
  decodeDataUri,
  estimateDataUriBytes,
  evaluateHostPolicy,
  findExternalRefs,
  findFrontmatterExternalRefs,
  hostMatches,
  hostOf,
  HostRateLimiter,
  isBlockedHost,
  isBlockedUrl,
  localLinkText,
  localName,
  matchesAnyHost,
  parseIPv4,
  type HostPolicy,
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

  it('扩展扫描：普通 markdown 链接改写后仍是链接（不被转成图片嵌入）', () => {
    const text = '见 [说明文档](https://x.com/a.pdf) 与 [图](https://x.com/b.png)';
    const refs = findExternalRefs(text, true);
    const map = new Map([
      ['https://x.com/a.pdf', 'assets/a.pdf'],
      ['https://x.com/b.png', 'assets/b.png'],
    ]);
    expect(applyRefReplacements(text, refs, map, 'markdown')).toBe(
      '见 [说明文档](assets/a.pdf) 与 [图](assets/b.png)',
    );
    expect(applyRefReplacements(text, refs, map, 'wiki')).toBe(
      '见 [[assets/a.pdf|说明文档]] 与 [[assets/b.png|图]]',
    );
  });

  it('扩展扫描：HTML 媒体标签只替换 src，保留标签与其它属性', () => {
    const text =
      '<img alt="封面" src="https://x.com/c.png" width="200"> <audio src="https://x.com/m.mp3" controls></audio> <video src="https://x.com/v.webm" loop></video>';
    const refs = findExternalRefs(text, true);
    const map = new Map([
      ['https://x.com/c.png', 'assets/c.png'],
      ['https://x.com/m.mp3', 'assets/m.mp3'],
      ['https://x.com/v.webm', 'assets/v.webm'],
    ]);
    const out = applyRefReplacements(text, refs, map, 'markdown');
    expect(out).toBe(
      '<img alt="封面" src="assets/c.png" width="200"> <audio src="assets/m.mp3" controls></audio> <video src="assets/v.webm" loop></video>',
    );
  });

  it('文件名含 $ 时改写不被替换模式破坏（健壮性）', () => {
    const text = '![a](https://x.com/q.png) ![b](https://x.com/q.png)';
    const refs = findExternalRefs(text);
    const out = applyRefReplacements(text, refs, new Map([['https://x.com/q.png', 'assets/$&$1.png']]), 'markdown');
    expect(out).toBe('![a](assets/$&$1.png) ![b](assets/$&$1.png)');
  });

  it('frontmatter：识别裸 URL 媒体引用，忽略非媒体外链与普通键值', () => {
    const text = [
      '---',
      'title: 标题',
      'cover: https://x.com/c.png',
      'source: https://example.com/page',
      'images:',
      '  - https://x.com/a.jpg',
      '  - assets/local.png',
      'n: 3',
      '---',
      '',
      '正文',
    ].join('\n');
    const refs = findFrontmatterExternalRefs(text);
    expect(refs.map((r) => r.url)).toEqual(['https://x.com/c.png', 'https://x.com/a.jpg']);
    // 与正文扫描合并后统一参与下载/改写
    expect(findExternalRefs(text).length).toBe(2);
  });

  it('frontmatter：改写保留 key、引号与列表结构', () => {
    const text = ['---', 'cover: "https://x.com/c.png"', 'images:', "  - 'https://x.com/a.jpg'", '---', ''].join('\n');
    const refs = findExternalRefs(text);
    const map = new Map([
      ['https://x.com/c.png', 'assets/c.png'],
      ['https://x.com/a.jpg', 'assets/a.jpg'],
    ]);
    expect(applyRefReplacements(text, refs, map, 'markdown')).toBe(
      ['---', 'cover: "assets/c.png"', 'images:', "  - 'assets/a.jpg'", '---', ''].join('\n'),
    );
  });

  it('frontmatter：data:image 也被识别，行尾注释不参与 URL', () => {
    const text = ['---', 'cover: data:image/png;base64,AA==', 'icon: https://x.com/i.png # 备注', '---', ''].join('\n');
    expect(findFrontmatterExternalRefs(text).map((r) => r.url)).toEqual([
      'data:image/png;base64,AA==',
      'https://x.com/i.png',
    ]);
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

describe('localize-media-core · 主机安全策略', () => {
  it('hostOf：去 userinfo / 端口 / IPv6 方括号，取小写主机名', () => {
    expect(hostOf('https://Example.COM/a.png')).toBe('example.com');
    expect(hostOf('http://user:pass@Host.com:8080/x')).toBe('host.com');
    expect(hostOf('http://[::1]:8080/x')).toBe('::1');
    expect(hostOf('data:image/png;base64,AA==')).toBe('');
    expect(hostOf('assets/local.png')).toBe('');
  });

  it('parseIPv4：标准、简写与进制伪装', () => {
    expect(parseIPv4('127.0.0.1')).toEqual([127, 0, 0, 1]);
    expect(parseIPv4('2130706433')).toEqual([127, 0, 0, 1]); // 十进制
    expect(parseIPv4('0x7f000001')).toEqual([127, 0, 0, 1]); // 十六进制
    expect(parseIPv4('0177.0.0.1')).toEqual([127, 0, 0, 1]); // 八进制首段
    expect(parseIPv4('127.1')).toEqual([127, 0, 0, 1]); // 两段简写
    expect(parseIPv4('example.com')).toBeNull();
    expect(parseIPv4('300.1.1.1')).toBeNull();
  });

  it('拦截回环 / 私网 / 链路本地 / 云元数据（含进制与简写伪装）', () => {
    for (const h of [
      '127.0.0.1',
      '127.1',
      '2130706433',
      '0x7f000001',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // 云元数据
      '100.64.0.1', // CGNAT
      '0.0.0.0',
      '255.255.255.255',
      '224.0.0.1',
      'localhost',
      'LOCALHOST',
      'localhost.',
      'foo.local',
      'svc.internal',
      'host.home.arpa',
      '::1',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isBlockedHost(h), `应拦截 ${h}`).toBe(true);
    }
  });

  it('放行普通公网主机与地址', () => {
    for (const h of [
      'example.com',
      '8.8.8.8',
      '1.1.1.1',
      '172.32.0.1', // 紧邻 172.16/12 之外的公网地址
      '192.169.0.1',
      '169.253.0.1',
      '2606:4700:4700::1111',
    ]) {
      expect(isBlockedHost(h), `不应拦截 ${h}`).toBe(false);
    }
  });

  it('isBlockedUrl：仅拦带主机名的 http(s)，data 与相对路径放行', () => {
    expect(isBlockedUrl('http://127.0.0.1/logo.png')).toBe(true);
    expect(isBlockedUrl('http://169.254.169.254/latest/meta-data/')).toBe(true);
    expect(isBlockedUrl('http://localhost:8080/a.png')).toBe(true);
    expect(isBlockedUrl('https://cdn.example.com/a.png')).toBe(false);
    expect(isBlockedUrl('data:image/png;base64,AA==')).toBe(false);
    expect(isBlockedUrl('assets/local.png')).toBe(false);
  });
});

describe('localize-media-core · 域名名单策略', () => {
  const policy = (over: Partial<HostPolicy> = {}): HostPolicy => ({
    allowHosts: [],
    denyHosts: [],
    allowlistOnly: false,
    blockPrivateHosts: true,
    ...over,
  });

  it('hostMatches：粘贴 URL / host:port 形态的名单项按主机名收口', () => {
    // 用户经常直接粘贴 URL 或带端口：必须解析成主机名，而不是被 `:` 截断
    // （`https://x` 会被截成 `https` 静默失效；`a.com:8080/p` 会被截成 a.com 而误拦整台主机）
    expect(hostMatches('https://ads.example.com/x.png', 'ads.example.com')).toBe(true);
    expect(hostMatches('https://ads.example.com/x.png', 'other.example.com')).toBe(false);
    expect(hostMatches('a.com:8080/path', 'a.com')).toBe(true);
    expect(hostMatches('a.com:8080/path', 'b.com')).toBe(false);
    expect(hostMatches('https://user:pw@a.com/x', 'a.com')).toBe(true);
  });

  it('hostMatches：精确 / 通配（含 apex）/ 任意 / 忽略大小写与端口', () => {
    expect(hostMatches('a.com', 'a.com')).toBe(true);
    expect(hostMatches('a.com', 'b.a.com')).toBe(false);
    expect(hostMatches('*.a.com', 'a.com')).toBe(true); // 通配含 apex
    expect(hostMatches('*.a.com', 'b.a.com')).toBe(true);
    expect(hostMatches('*.a.com', 'x.b.a.com')).toBe(true);
    expect(hostMatches('*.a.com', 'nota.com')).toBe(false);
    expect(hostMatches('*', 'anything.example')).toBe(true);
    expect(hostMatches('A.COM', 'a.com')).toBe(true);
    expect(hostMatches('a.com:8080', 'a.com')).toBe(true); // 模式带端口
    expect(hostMatches('  ', 'a.com')).toBe(false);
  });

  it('matchesAnyHost：任一名单命中即为真', () => {
    expect(matchesAnyHost(['x.com', '*.a.com'], 'b.a.com')).toBe(true);
    expect(matchesAnyHost(['x.com'], 'b.a.com')).toBe(false);
    expect(matchesAnyHost([], 'b.a.com')).toBe(false);
  });

  it('黑名单优先级最高，可覆盖白名单', () => {
    const p = policy({ allowHosts: ['*.a.com'], denyHosts: ['bad.a.com'] });
    expect(evaluateHostPolicy('https://ok.a.com/x.png', p)).toEqual({ allowed: true });
    expect(evaluateHostPolicy('https://bad.a.com/x.png', p)).toEqual({ allowed: false, reason: 'deny-list' });
  });

  it('显式白名单可覆盖内网拦截（自建内网图床场景）', () => {
    const p = policy({ allowHosts: ['127.0.0.1'] });
    expect(evaluateHostPolicy('http://127.0.0.1/x.png', p)).toEqual({ allowed: true });
    // 同策略下未列入白名单的内网地址仍被拦
    expect(evaluateHostPolicy('http://192.168.1.1/x.png', p).reason).toBe('private-host');
  });

  it('内网拦截优先于「仅白名单」模式', () => {
    const p = policy({ allowlistOnly: true });
    expect(evaluateHostPolicy('http://10.0.0.1/x.png', p).reason).toBe('private-host');
    expect(evaluateHostPolicy('https://cdn.example.com/x.png', p).reason).toBe('not-allowlisted');
  });

  it('仅白名单模式：空白名单时拒绝全部 http，但放行 data 与本地路径', () => {
    const p = policy({ allowlistOnly: true, allowHosts: [] });
    expect(evaluateHostPolicy('https://cdn.example.com/x.png', p).reason).toBe('not-allowlisted');
    expect(evaluateHostPolicy('data:image/png;base64,AA==', p)).toEqual({ allowed: true });
    expect(evaluateHostPolicy('assets/local.png', p)).toEqual({ allowed: true });
  });

  it('默认策略：公网放行、无主机名放行', () => {
    const p = policy();
    expect(evaluateHostPolicy('https://cdn.example.com/x.png', p)).toEqual({ allowed: true });
    expect(evaluateHostPolicy('data:image/png;base64,AA==', p)).toEqual({ allowed: true });
  });
});

describe('localize-media-core · data URI 尺寸预判', () => {
  it('base64：按 4 字符 3 字节精确预估（含填充）', () => {
    expect(estimateDataUriBytes('data:image/png;base64,AAAA')).toBe(3);
    expect(estimateDataUriBytes('data:image/png;base64,AA==')).toBe(1);
    expect(estimateDataUriBytes('data:image/png;base64,AAA=')).toBe(2);
    expect(estimateDataUriBytes('data:text/plain;charset=utf-8;base64,YWJj')).toBe(3); // "abc"
  });

  it('预估结果与真实解码字节数一致（常见向量）', () => {
    for (const uri of [
      'data:image/png;base64,AAAA',
      'data:image/png;base64,AA==',
      'data:image/png;base64,AAA=',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAIhQGAXbM3ZQAAAABJRU5ErkJggg==',
    ]) {
      const actual = decodeDataUri(uri);
      expect(actual).not.toBeNull();
      expect(estimateDataUriBytes(uri)).toBe(actual!.byteLength);
    }
  });

  it('非 base64（百分号编码文本）无法预判 → null，交由解码后校验兜底', () => {
    expect(estimateDataUriBytes('data:text/plain,hello')).toBeNull();
    expect(estimateDataUriBytes('data:text/plain,%E4%B8%AD%E6%96%87')).toBeNull();
  });

  it('畸形输入不抛错', () => {
    expect(estimateDataUriBytes('data:image/png;base64')).toBeNull(); // 无逗号
    expect(estimateDataUriBytes('')).toBeNull();
    expect(estimateDataUriBytes('data:image/png;base64,')).toBe(0);
  });
});

describe('localize-media-core · 同主机限速器', () => {
  it('interval 为 0 或主机为空时不等待', async () => {
    const limiter = new HostRateLimiter();
    const t0 = Date.now();
    await limiter.wait('a.com', 0);
    await limiter.wait('', 100);
    expect(Date.now() - t0).toBeLessThan(30);
  });

  it('同一主机的连续请求按最小间隔排开；不同主机互不影响', async () => {
    const limiter = new HostRateLimiter();
    const interval = 40;
    const t0 = Date.now();
    await limiter.wait('a.com', interval); // 首个不等待
    await limiter.wait('b.com', interval); // 另一主机不等待
    expect(Date.now() - t0).toBeLessThan(30);
    await limiter.wait('a.com', interval); // 同主机第二次需等待
    expect(Date.now() - t0).toBeGreaterThanOrEqual(30);
  });

  it('带标题的 markdown 图片外链必须被识别（旧实现因"目标后接不到 )"整条漏掉）', () => {
    const refs = findExternalRefs('![封面](https://x.com/a.png "图注")');
    expect(refs).toHaveLength(1);
    expect(refs[0].url).toBe('https://x.com/a.png');
    expect(refs[0].title).toBe(' "图注"');
  });

  it('改写时标题段原样带回去（不得擅自删改正文）', () => {
    const refs = findExternalRefs('![封面](https://x.com/a.png "图注")');
    const map = new Map([[refs[0].url, 'assets/我的 图.png']]);
    const out = applyRefReplacements('![封面](https://x.com/a.png "图注")', refs, map, 'markdown');
    // encodeMdTarget 只编码空格与圆括号（不动 `%`，免得把用户已有的 %20 二次编码）
    expect(out).toBe('![封面](assets/我的%20图.png "图注")');
  });

  it('尖括号 <…> 包裹的目标可被识别（含空格/括号的合法写法）', () => {
    const refs = findExternalRefs('![x](<https://x.com/a b.png>)');
    expect(refs).toHaveLength(1);
    expect(refs[0].url).toBe('https://x.com/a b.png');
  });

  it('目标含未转义括号时整条跳过并计数，绝不产出半截链接', () => {
    // `[^)]*` 会在第一个 `)` 提前收尾；若照旧下载回写，正文会变成 `...local.png).png)`。
    // 契约：宁可漏本地化，也不改坏正文，并且要如实计数（不能静默丢弃）。
    const stats = { ambiguousSkipped: 0 };
    const text = '![x](https://x.com/Foo_(bar).png)';
    const refs = findExternalRefs(text, false, stats);
    expect(refs).toHaveLength(0);
    expect(stats.ambiguousSkipped).toBe(1);
    // 原文一字不改
    expect(applyRefReplacements(text, refs, new Map(), 'markdown')).toBe(text);
  });

  it('尖括号包裹时含括号的目标是合法的，不得被当成歧义跳过', () => {
    const stats = { ambiguousSkipped: 0 };
    const refs = findExternalRefs('![x](<https://x.com/Foo_(bar).png>)', false, stats);
    expect(refs).toHaveLength(1);
    expect(refs[0].url).toBe('https://x.com/Foo_(bar).png');
    expect(stats.ambiguousSkipped).toBe(0);
  });

  it('扩展扫描下带标题的普通链接同样被识别并保形', () => {
    const refs = findExternalRefs('[说明](https://x.com/a.pdf "文档")', true);
    expect(refs).toHaveLength(1);
    expect(refs[0].syntax).toBe('md-link');
    const out = applyRefReplacements('[说明](https://x.com/a.pdf "文档")', refs, new Map([['https://x.com/a.pdf', 'assets/a.pdf']]), 'markdown');
    expect(out).toBe('[说明](assets/a.pdf "文档")');
  });
});