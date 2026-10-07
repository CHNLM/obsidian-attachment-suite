/** 媒体本地化 · 纯计算（不依赖 obsidian，可脱离 App 单测）。 */

import { encodeMdTarget, extOf, isManagedAttachment, md5Hex, parseMdTarget, sanitizeFilename } from '../core';

export interface ExternalRef {
  url: string;
  alt: string;
  raw: string;
  kind: 'http' | 'data';
  /** 给命名用的提示名（URL 尾段或 alt）。 */
  nameHint: string;
  /**
   * 原文语法。改写时必须按语法还原，否则会把「普通链接」和「HTML 媒体标签」
   * 统统变成 markdown 图片嵌入（渲染被破坏、`</audio>` 之类闭合标签成为孤儿）。
   */
  syntax: RefSyntax;
  /**
   * markdown 链接的标题段（形如 ` "标题"`，含前导空格；无则 undefined）。
   * 改写时**必须原样带回去**，否则用户的标题会被悄悄吃掉。
   */
  title?: string;
}

/** 引用在原文中的语法形态。 */
export type RefSyntax = 'md-image' | 'md-link' | 'html' | 'frontmatter';

/** frontmatter 块（含 `---` 行本身）。 */
const FM_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * 收集 frontmatter 中形如 `cover: https://…` / `images:\n  - https://…` 的外部媒体引用。
 *
 * 为什么需要：断链检测（`frontmatterBrokenRefs`）**一直**把 frontmatter 的本地资源路径
 * 当作引用，但本地化只扫正文 → 只写在 frontmatter 里的外链图片永远不会被下载，
 * 笔记仍无法脱机使用。此处补齐口径，且走得保守：
 * - 只认裸 http(s)/data URL 值（不动自由文本），且 URL 必须带**受管附件扩展名**（或 data:image），
 *   避免把 `source: https://example.com/page` 这类非媒体外链也拉下来；
 * - 改写时保留原有引号与 YAML 行结构，不触碰其它键。
 */
export function findFrontmatterExternalRefs(text: string): ExternalRef[] {
  const fm = text.match(FM_BLOCK);
  if (!fm) return [];
  const refs: ExternalRef[] = [];
  for (const line of fm[1].split('\n')) {
    // 只处理 YAML 的两种取值形态：`key: value` 与列表项 `- value`。
    // 注意 key 必须排除 URL scheme（`https:`/`data:`），否则会把 `- https://x/a.png`
    // 里的 `https:` 当成键名，只剩 `//x/a.png` 从而漏掉整个引用。
    const listItem = line.match(/^\s*-\s+(.+?)\s*$/);
    const kv = listItem ? null : line.match(/^\s*(?!(?:https?|data)\s*:)([A-Za-z0-9_.-]+)\s*:\s*(.+?)\s*$/);
    let raw = listItem ? listItem[1] : kv ? kv[2] : '';
    if (!raw) continue;
    const hash = raw.search(/\s+#/); // YAML 行尾注释不属于值
    if (hash >= 0) raw = raw.slice(0, hash).trim();
    if (!raw) continue;
    const url = raw.replace(/^["']|["']$/g, '').replace(/^["']|["']$/g, '');
    if (!isHttp(url) && !isDataUrl(url)) continue;
    if (!isFrontmatterMediaUrl(url)) continue;
    refs.push({
      url,
      alt: '',
      raw,
      kind: isDataUrl(url) ? 'data' : 'http',
      nameHint: nameHintOf(url, ''),
      syntax: 'frontmatter',
    });
  }
  return refs;
}

/** frontmatter 值的保守过滤：data: 媒体，或带受管附件扩展名的 http(s) URL。 */
function isFrontmatterMediaUrl(url: string): boolean {
  if (isDataUrl(url)) return /^data:(image|audio|video)\//i.test(url);
  const clean = url.split('?')[0].split('#')[0];
  return isManagedAttachment(extOf(clean));
}

/** 提取正文中所有可本地化的外部媒体引用（markdown 图片的 http / data URI）。 */
export function findExternalRefs(text: string, scanExtended = false, stats?: ScanStats): ExternalRef[] {
  const refs: ExternalRef[] = [];
  for (const m of text.matchAll(MD_IMG)) {
    // m[1] alt、m[2] 括号内原文（可能含 ` "标题"` 或 `<...>` 外壳）
    if (skipIfAmbiguous(m, text, stats)) continue;
    pushMdRef(refs, m[0], m[1], m[2], 'md-image');
  }
  // frontmatter 的裸 URL 引用始终纳入（与断链检测的口径对称）
  refs.push(...findFrontmatterExternalRefs(text));
  if (scanExtended) {
    for (const m of text.matchAll(MD_LINK)) {
      if (skipIfAmbiguous(m, text, stats)) continue;
      pushMdRef(refs, m[0], m[1], m[2], 'md-link');
    }
    collectHtmlMedia(text, refs);
  }
  return refs;
}

/**
 * markdown 链接/嵌入：**整体捕获括号内容**，再交给 `parseMdTarget` 拆目标与标题。
 *
 * 不能按空白截断目标（旧写法 `\(([^)\s]+)\)`）：
 * - `![alt](url "标题")` 因"目标后面接不到 `)`"而**整个匹配失败** → 这类外链永远不会被本地化，
 *   笔记就是脱不了机；
 * - `<http://a/b.png>` 尖括号写法会连 `<>` 一起当作 URL，判定失败同样被跳过；
 * - 目标含 `)` 时会被截断成半截路径，**下载与改写都会作用在错的东西上**。
 *
 * 代价是目标本身含 `)` 时 `[^)]*?` 会提前收尾，故配合 `skipIfAmbiguous` 直接跳过——
 * 宁可漏本地化一条，也绝不把正文改坏。
 *
 * 注意 `(<[^>]*>|[^)]*?)` 这个**二选一分支**：`<...>` 是 CommonMark 为"目标含空格/括号"
 * 提供的显式包裹写法，必须整体捕获（否则 `[^)]*?` 会在目标内部的第一个 `)` 处收尾，
 * 后面的 `>` 永远看不到，"尖括号豁免"形同虚设）。普通分支用惰性匹配，好让结尾的 `\s*\)` 收口。
 */
const MD_IMG = /!\[([^\]]*)\]\(\s*(<[^>]*>|[^)]*?)\s*\)/g;
/** 普通 markdown 链接（负向断言排除图片语法 ![]）。 */
const MD_LINK = /(?<!!)\[([^\]]*)\]\(\s*(<[^>]*>|[^)]*?)\s*\)/g;
/** HTML 媒体开标签：img / audio / video。 */
const HTML_MEDIA = /<(img|audio|video)\b[^>]*>/gi;

/** 下载器抽象：便于注入真实 fetch 实现或测试替身。 */
export interface MediaDownloader {
  download(url: string): Promise<Uint8Array | null>;
}

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function isDataUrl(url: string): boolean {
  return /^data:/i.test(url);
}

function nameHintOf(url: string, alt: string): string {
  if (isDataUrl(url)) return alt || 'image';
  const clean = url.split('?')[0].split('#')[0];
  const last = clean.split('/').pop() ?? '';
  if (last && last.includes('.')) {
    // 恶意/畸形 URL 的百分号编码可能无法解码（如 %zz），此时不抛错，回退 alt/image。
    try {
      return decodeURIComponent(last);
    } catch {
      return alt || 'image';
    }
  }
  return alt || 'image';
}

/** 仅收集 http / data 的引用。 */
function pushRef(
  refs: ExternalRef[],
  url: string,
  alt: string,
  raw: string,
  syntax: RefSyntax,
): void {
  if (!isHttp(url) && !isDataUrl(url)) return;
  refs.push({
    url,
    alt,
    raw,
    kind: isDataUrl(url) ? 'data' : 'http',
    nameHint: nameHintOf(url, alt),
    syntax,
  });
}

/** 扫描统计（供执行层如实报告"因目标歧义而跳过"的条数，避免静默丢弃被误认为 bug）。 */
export interface ScanStats {
  /** 因 markdown 目标里含 `(`/`)`（未用尖括号包裹）而被跳过的引用数。 */
  ambiguousSkipped: number;
}

/**
 * markdown 目标是否歧义到"不能安全改写"。
 *
 * CommonMark 的目标段不允许裸 `)`（会被当成链接结束）。因此当括号内出现 `(`，或匹配结束后紧邻
 * 还有一个 `)` 时，说明我们看到的是一段**被截断的目标**——此时若照旧下载并回写，
 * 会把正文改成 `...local.png).png)` 这种坏形态。
 * 尖括号 `<...>` 是 CommonMark 提供的显式包裹写法，目标里允许有 `)`，故豁免。
 */
function isAmbiguousTarget(inner: string): boolean {
  const s = inner.trim();
  if (s.startsWith('<') && s.endsWith('>')) return false;
  return s.includes('(') || s.includes(')');
}

/** 命中歧义目标时记账并跳过（返回 true 表示"已跳过"）。 */
function skipIfAmbiguous(m: RegExpMatchArray, text: string, stats?: ScanStats): boolean {
  const after = text[(m.index ?? 0) + m[0].length];
  if (!isAmbiguousTarget(m[2]) && after !== ')') return false;
  if (stats) stats.ambiguousSkipped++;
  return true;
}

/** markdown 引用：整体捕获 + `parseMdTarget` 拆目标与标题（口径与 `link-resolver` 完全一致）。 */
function pushMdRef(refs: ExternalRef[], raw: string, alt: string, inner: string, syntax: RefSyntax): void {
  const { target, title } = parseMdTarget(inner);
  if (!isHttp(target) && !isDataUrl(target)) return;
  refs.push({
    url: target,
    alt,
    raw,
    kind: isDataUrl(target) ? 'data' : 'http',
    nameHint: nameHintOf(target, alt),
    syntax,
    title: title || undefined,
  });
}

/** HTML <img>/<audio>/<video> 标签：取 src。（alt 从 img 的可选属性读取）。 */
function collectHtmlMedia(text: string, refs: ExternalRef[]): void {
  for (const m of text.matchAll(HTML_MEDIA)) {
    const tag = m[0];
    const isImg = m[1].toLowerCase() === 'img';
    const src = attrOf(tag, 'src');
    if (!src) continue;
    const alt = isImg ? attrOf(tag, 'alt') : '';
    pushRef(refs, decodeHtmlEntity(src), alt, tag, 'html');
  }
}

/** 从标签/属性串中读取指定属性的值（支持单双引号与无引号）。 */
function attrOf(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  if (!m) return '';
  return m[1] ?? m[2] ?? m[3] ?? '';
}

/** 解码常用 HTML 实体（&amp; &quot; &#39; &#47;），避免 URL 解析偏差。 */
function decodeHtmlEntity(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export type LinkStyle = 'markdown' | 'wiki';

/** 依据链接风格生成本地引用文本（markdown 图片形态；wiki 风格为 `![[path|alt]]`）。 */
export function localLinkText(alt: string, localPath: string, style: LinkStyle, title = ''): string {
  if (style === 'wiki') {
    return `![[${localPath}${alt ? `|${alt}` : ''}]]`;
  }
  // markdown 目标必须编码：落盘名可能含空格（`笔记名_image_001.png`），裸空格会让链接失效
  return `![${alt}](${encodeMdTarget(localPath)}${title})`;
}

/** 只替换 HTML 标签里的 src 属性值，标签本身与其它属性原样保留。 */
function replaceSrcAttr(tag: string, localPath: string): string {
  return tag.replace(/(\bsrc\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i, (_m, prefix: string) => `${prefix}"${localPath}"`);
}

/**
 * 按原文语法生成本地引用文本。
 * 关键：**保持原语法**——普通链接仍是链接、HTML 媒体标签仍是标签（只换 src），
 * 否则会把 `[说明](a.pdf)` 变成图片嵌入、把 `<audio src>` 变成 `![](m.mp3)</audio>`。
 */
export function refReplacement(ref: ExternalRef, localPath: string, style: LinkStyle): string {
  if (ref.syntax === 'html') return replaceSrcAttr(ref.raw, localPath);
  if (ref.syntax === 'frontmatter') {
    // 保留原引号风格（YAML 值可以是裸串或带引号）
    const quote = ref.raw.startsWith('"') ? '"' : ref.raw.startsWith("'") ? "'" : '';
    return quote ? `${quote}${localPath}${quote}` : localPath;
  }
  // markdown 的标题段要原样带回去（`![x](a.png "图注")` 的 ` "图注"`）；
  // 它本来就是文档的一部分，丢了等于擅自删改正文。wiki 语法没有标题，此时自然丢弃。
  const title = ref.title ?? '';
  if (ref.syntax === 'md-link') {
    return style === 'wiki'
      ? `[[${localPath}${ref.alt ? `|${ref.alt}` : ''}]]`
      : `[${ref.alt}](${encodeMdTarget(localPath)}${title})`;
  }
  return localLinkText(ref.alt, localPath, style, title);
}

/**
 * 将正文按「原始引用 → 本地路径」映射改写。
 *
 * 注意两处必须保持的性质：
 * 1) 用**函数式**替换：字符串替换会把本地路径里的 `$&`/`$1` 当替换模式展开，改坏正文；
 * 2) 逐条 `refs` 替换（调用方传未按 URL 去重的完整列表），这样同一 URL 出现多次时每次都能命中下一条。
 */
export function applyRefReplacements(
  text: string,
  refs: ExternalRef[],
  map: Map<string, string>,
  style: LinkStyle,
): string {
  let out = text;
  for (const ref of refs) {
    const local = map.get(ref.url);
    if (local === undefined) continue;
    out = out.replace(ref.raw, () => refReplacement(ref, local, style));
  }
  return out;
}

/** 生成本地文件名。useMd5 时常为 `md5.ext`，否则用安全提示名（空则回退 md5）。 */
export function localName(md5: string, nameHint: string, useMd5: boolean, ext: string): string {
  if (useMd5) return `${md5}.${ext}`;
  const safe = sanitizeFilename(nameHint);
  if (!safe || !safe.includes('.')) return `${safe || md5}.${ext}`;
  return safe;
}

/** 解码 data URI 为字节（`data:[mime][;base64],<payload>`）。 */
export function decodeDataUri(uri: string): Uint8Array | null {
  const comma = uri.indexOf(',');
  if (comma < 0) return null;
  const meta = uri.slice(5, comma); // 去 "data:"
  const payload = uri.slice(comma + 1);
  if (/;base64$/i.test(meta)) {
    try {
      const bin = atob(payload);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch {
      return null;
    }
  }
  // 非 base64：假定为 UTF-8 文本（较少见）
  try {
    return new TextEncoder().encode(decodeURIComponent(payload));
  } catch {
    return null;
  }
}

/** 便捷：计算字节 MD5（供命名/去重）。 */
export function bytesMd5(data: Uint8Array): string {
  return md5Hex(data);
}

/**
 * 预估 data URI 解码后的字节数，用于**在解码之前**拦截超大载荷
 * （`decodeDataUri` 会先 `atob` 出一份中间字符串、再复制成 `Uint8Array`，
 * 若等解码完再判超限，这份瞬时副本已经产生了）。
 *
 * 仅 base64 形式可精确预估（4 个编码字符 → 3 字节，减去填充）；
 * 百分号编码的文本形式无法在不解码的前提下给出可靠上界，返回 `null` 表示「无法预判」，
 * 此时交给解码后的体积校验兜底（宁可多分配一次，也不误杀合法载荷）。
 */
export function estimateDataUriBytes(uri: string): number | null {
  const comma = uri.indexOf(',');
  if (comma < 0) return null;
  const meta = uri.slice(5, comma); // 去 "data:"
  if (!/;base64$/i.test(meta)) return null; // 与 decodeDataUri 的判定保持一致
  const payload = uri.slice(comma + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

/* ===================== 主机安全策略：内网 / 保留地址拦截 ===================== */

/**
 * 从 URL 取主机名：去 userinfo、去端口、IPv6 去方括号，统一小写。
 * 非 `scheme://host` 形式（如 `data:`、相对路径）返回空串。
 */
export function hostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(url);
  if (!m) return '';
  let authority = m[1];
  const at = authority.lastIndexOf('@');
  if (at >= 0) authority = authority.slice(at + 1); // 去 userinfo（可能含密码）
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    return end > 0 ? authority.slice(1, end).toLowerCase() : '';
  }
  const colon = authority.indexOf(':');
  return (colon >= 0 ? authority.slice(0, colon) : authority).toLowerCase();
}

/**
 * 宽松 IPv4 解析，兼容 inet_aton 语义：十进制 / 十六进制(0x) / 八进制(0)，
 * 以及 1~4 段简写（最后一段承载剩余字节）。无法解析为 IP 时返回 null。
 * 之所以要兼容这些形式：`http://2130706433/`、`http://0x7f000001/`、`http://0177.0.0.1/`
 * 都能被解析为 127.0.0.1，是绕过「按字面字符串判断」的常见手法。
 */
export function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length === 0 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (p === '') return null;
    let n: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(p)) n = parseInt(p.slice(2), 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p.slice(1), 8);
    else if (/^\d+$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  // inet_aton：末段承载剩余字节，故各段的取值范围随段数变化
  if (nums.length === 1 && nums[0] > 0xffffffff) return null;
  if (nums.length === 2 && (nums[0] > 0xff || nums[1] > 0xffffff)) return null;
  if (nums.length === 3 && (nums[0] > 0xff || nums[1] > 0xff || nums[2] > 0xffff)) return null;
  if (nums.length === 4 && nums.some((n) => n > 0xff)) return null;
  let v: number;
  if (nums.length === 4) v = nums[0] * 0x1000000 + nums[1] * 0x10000 + nums[2] * 0x100 + nums[3];
  else if (nums.length === 3) v = nums[0] * 0x1000000 + nums[1] * 0x10000 + nums[2];
  else if (nums.length === 2) v = nums[0] * 0x1000000 + nums[1];
  else v = nums[0];
  v = v >>> 0;
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
}

/** IPv4 是否属于私网 / 回环 / 链路本地 / 特殊用途 / 组播保留等不应由插件访问的地址。 */
export function isBlockedIPv4(ip: [number, number, number, number]): boolean {
  const [a, b, c] = ip;
  if (a === 0) return true; // 0.0.0.0/8 “本网络”
  if (a === 10) return true; // 10/8 私有
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 127) return true; // 127/8 回环
  if (a === 169 && b === 254) return true; // 169.254/16 链路本地（含云元数据 169.254.169.254）
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 私有
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0/24 IETF 保留
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2/24 TEST-NET-1
  if (a === 192 && b === 168) return true; // 192.168/16 私有
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 基准测试
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113/24 TEST-NET-3
  if (a >= 224) return true; // 224/4 组播 + 240/4 保留 + 广播
  return false;
}

/**
 * IPv6 文本是否属于回环 / 唯一本地(fc00::/7) / 链路本地(fe80::/10) / IPv4 映射后的私网。
 * 说明：仅做首段 hextet 的区间判断，对 `::` 缩写形式（首段为空）保守放行——
 * 这类形式在本插件的下载场景极罕见，且宁可漏检也不误伤。
 */
export function isBlockedIPv6(host: string): boolean {
  const h = host.split('%')[0].toLowerCase();
  if (h === '::1' || h === '::') return true; // 回环 / 未指定
  const mapped = /^::ffff:(.+)$/.exec(h);
  if (mapped) {
    const tail = mapped[1];
    const v4 = parseIPv4(tail);
    if (v4) return isBlockedIPv4(v4);
    if (/^[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(tail)) {
      const [hi, lo] = tail.split(':').map((x) => parseInt(x, 16));
      return isBlockedIPv4([(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255]);
    }
    return false;
  }
  const first = h.split(':')[0];
  if (!first) return false; // `::abcd` 等缩写形式，保守放行
  const n = parseInt(first, 16);
  if (!Number.isFinite(n)) return false;
  if ((n & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((n & 0xffc0) === 0xfe80) return true; // fe80::/10
  return false;
}

/** 已知内网 / 本机主机名（无法在下载前解析 DNS，故对常见名称做保守拦截）。 */
const BLOCKED_HOST_EXACT = new Set(['localhost', 'local']);
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan'];

/** 判断主机名（或字面 IP）是否指向内网 / 本机 / 保留地址。大小写不敏感，容忍末尾根点（`localhost.`）。 */
export function isBlockedHost(host: string): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  if (BLOCKED_HOST_EXACT.has(h)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s))) return true;
  const v4 = parseIPv4(h);
  if (v4) return isBlockedIPv4(v4);
  if (h.includes(':')) return isBlockedIPv6(h);
  return false;
}

/**
 * 外部引用 URL 是否指向本机 / 内网 / 保留地址（供下载前拦截）。
 *
 * 仅对带主机名的 http(s) 生效；`data:` 等无主机名的引用一律放行（本地解码、不发起网络请求）。
 * 已知局限（无法在纯函数内解决）：
 * - 不能解析 DNS，故 `evil.example` 解析到内网（DNS 重绑定）或 `192.168.1.1.nip.io` 之类不在覆盖内；
 * - Obsidian 的 `requestUrl` 不支持禁用/观测重定向，故只能校验**初始** URL 的主机。
 * 处理来源不可信的库时，可开启「仅允许白名单中的域名」从根上规避以上两条。
 */
export function isBlockedUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return isBlockedHost(host);
}

/* ===================== 域名 allow / deny 名单策略 ===================== */

/** 下载域名策略（来自设置）。 */
export interface HostPolicy {
  /** 允许下载的域；支持 `*.example.com`（含 apex）与 `*`（任意）。 */
  allowHosts: string[];
  /** 拒绝下载的域；优先级最高。 */
  denyHosts: string[];
  /** 仅允许白名单中的域：不在 allowHosts 内的 http 引用一律跳过。 */
  allowlistOnly: boolean;
  /** 是否拦截本机/内网/保留地址。 */
  blockPrivateHosts: boolean;
}

/** 策略拒绝原因。 */
export type HostDenyReason = 'deny-list' | 'private-host' | 'not-allowlisted';

/** 策略判定结果。 */
export interface HostVerdict {
  allowed: boolean;
  /** 仅当 allowed=false 时给出。 */
  reason?: HostDenyReason;
}

/** 归一化一条名单模式：去空白、去端口、去末尾根点、转小写。 */
function normalizePattern(pattern: string): string {
  let p = pattern.trim().toLowerCase().replace(/\.$/, '');
  if (!p) return '';
  // 容忍用户直接粘贴 URL：先去掉 scheme 与路径，只保留主机部分。
  // 否则 `https://ads.example.com/x.png` 会被 `:` 截成 `https`（永不命中，静默失效），
  // 而 `example.com:8080/x` 会被截成 `example.com`（比预期更宽，整台主机被拦）——
  // 两种都是"看起来生效、实际不符预期"，必须在解析阶段收口。
  const scheme = p.indexOf('://');
  if (scheme >= 0) p = p.slice(scheme + 3);
  const slash = p.indexOf('/');
  if (slash >= 0) p = p.slice(0, slash);
  const at = p.lastIndexOf('@'); // 去 userinfo（可能来自粘贴的 URL）
  if (at >= 0) p = p.slice(at + 1);
  if (!p) return '';
  if (p.startsWith('[')) {
    const end = p.indexOf(']');
    if (end > 0) return p.slice(1, end); // IPv6 字面量：去方括号
  }
  const colon = p.indexOf(':');
  if (colon > 0) p = p.slice(0, colon); // 去端口（IPv6 已在上面处理）
  return p;
}

/**
 * 名单模式是否匹配主机名。
 * - `*`          → 匹配任意主机
 * - `*.a.com`    → 匹配 `a.com` 本身及其所有子域
 * - `a.com`      → 仅精确匹配 `a.com`
 * 主机名与模式均忽略大小写、端口与末尾根点。
 */
export function hostMatches(pattern: string, host: string): boolean {
  const p = normalizePattern(pattern);
  if (!p) return false;
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  if (p === '*') return true;
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    if (!base) return false;
    return h === base || h.endsWith(`.${base}`);
  }
  return h === p;
}

/** 主机是否命中任一模式。 */
export function matchesAnyHost(patterns: readonly string[], host: string): boolean {
  return patterns.some((p) => hostMatches(p, host));
}

/**
 * 依据策略判定一个外部引用是否允许下载。判定顺序（先匹配先生效）：
 * 1. `denyHosts` 命中 → 拒绝（优先级最高）
 * 2. `allowHosts` 命中 → 允许（**显式允许可覆盖私网拦截**，便于自建内网图床）
 * 3. `blockPrivateHosts` 且为私网/本机/保留地址 → 拒绝
 * 4. `allowlistOnly` 且不在 `allowHosts` 内 → 拒绝
 * 5. 其余 → 允许
 * 无主机名的引用（`data:`、相对路径）一律放行（本地处理、不发起请求）。
 */
export function evaluateHostPolicy(url: string, policy: HostPolicy): HostVerdict {
  const host = hostOf(url);
  if (!host) return { allowed: true };
  if (matchesAnyHost(policy.denyHosts, host)) return { allowed: false, reason: 'deny-list' };
  if (matchesAnyHost(policy.allowHosts, host)) return { allowed: true };
  if (policy.blockPrivateHosts && isBlockedHost(host)) return { allowed: false, reason: 'private-host' };
  if (policy.allowlistOnly) return { allowed: false, reason: 'not-allowlisted' };
  return { allowed: true };
}

/* ===================== 同主机限速 ===================== */

/**
 * 同主机限速器：为每个主机预留「下一个可用时刻」，再按需等待。
 * 关键在于**先预留、后等待**——并发调用时各自拿到互不重叠的时间槽，
 * 因此即便并发下载数大于 1，对同一主机的请求仍会按最小间隔排开。
 *
 * 仅用 `setTimeout`，不依赖 Obsidian，故可脱离 App 单测。
 */
export class HostRateLimiter {
  private readonly nextAt = new Map<string, number>();

  /** 等待至该主机允许发起下一次请求；`intervalMs <= 0` 或主机为空时立即返回。 */
  async wait(host: string, intervalMs: number): Promise<void> {
    if (!host || intervalMs <= 0) return;
    const now = Date.now();
    const target = Math.max(now, this.nextAt.get(host) ?? 0);
    this.nextAt.set(host, target + intervalMs);
    const delayMs = target - now;
    if (delayMs > 0) await new Promise<void>((r) => setTimeout(r, delayMs));
  }
}