/** 媒体本地化 · 纯计算（不依赖 obsidian，可脱离 App 单测）。 */

import { md5Hex, sanitizeFilename } from '../core';

export interface ExternalRef {
  url: string;
  alt: string;
  raw: string;
  kind: 'http' | 'data';
  /** 给命名用的提示名（URL 尾段或 alt）。 */
  nameHint: string;
}

const MD_IMG = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
/** 普通 markdown 链接（负向断言排除图片语法 ![]）。 */
const MD_LINK = /(?<!!)\[([^\]]*)\]\(([^)\s]+)\)/g;
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

/** 提取正文中所有可本地化的外部媒体引用（markdown 图片的 http / data URI）。 */
export function findExternalRefs(text: string, scanExtended = false): ExternalRef[] {
  const refs: ExternalRef[] = [];
  for (const m of text.matchAll(MD_IMG)) {
    pushRef(refs, m[2], m[1], m[0]);
  }
  if (scanExtended) {
    collectMarkdownLinks(text, refs);
    collectHtmlMedia(text, refs);
  }
  return refs;
}

/** 仅收集 http / data 的引用。 */
function pushRef(
  refs: ExternalRef[],
  url: string,
  alt: string,
  raw: string,
): void {
  if (!isHttp(url) && !isDataUrl(url)) return;
  refs.push({
    url,
    alt,
    raw,
    kind: isDataUrl(url) ? 'data' : 'http',
    nameHint: nameHintOf(url, alt),
  });
}

/** 普通 markdown 链接 [text](url)，排除已由图片语法捕获的 ![] 形式。 */
function collectMarkdownLinks(text: string, refs: ExternalRef[]): void {
  for (const m of text.matchAll(MD_LINK)) {
    pushRef(refs, m[2], m[1], m[0]);
  }
}

/** HTML <img>/<audio>/<video> 标签：取 src。（alt 从 img 的可选属性读取）。 */
function collectHtmlMedia(text: string, refs: ExternalRef[]): void {
  for (const m of text.matchAll(HTML_MEDIA)) {
    const tag = m[0];
    const isImg = m[1].toLowerCase() === 'img';
    const src = attrOf(tag, 'src');
    if (!src) continue;
    const alt = isImg ? attrOf(tag, 'alt') : '';
    pushRef(refs, decodeHtmlEntity(src), alt, tag);
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

/** 依据链接风格生成本地引用文本。 */
export function localLinkText(alt: string, localPath: string, style: LinkStyle): string {
  if (style === 'wiki') {
    return `![[${localPath}${alt ? `|${alt}` : ''}]]`;
  }
  return `![${alt}](${localPath})`;
}

/** 将正文按「原始引用 → 本地路径」映射改写。 */
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
    out = out.replace(ref.raw, localLinkText(ref.alt, local, style));
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