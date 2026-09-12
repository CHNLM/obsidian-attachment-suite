/** 链接解析与写回（纯函数，不含 App）。 */

export type LinkType = 'markdown' | 'wiki' | 'wikiTransclusion' | 'mdTransclusion';

export interface LinkMatch {
  type: LinkType;
  /** 原文片段。 */
  raw: string;
  /** 解析出的目标字符串。 */
  linkText: string;
}

const MD_LINK = /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;
const WIKI_LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

function detectTransclusion(type: LinkType, linkText: string): LinkType {
  if (type === 'wiki' && linkText.includes('#')) return 'wikiTransclusion';
  if (type === 'markdown' && linkText.includes('#')) return 'mdTransclusion';
  return type;
}

/**
 * 列出文件正文中的所有链接匹配项。
 * @param text 文件内容。
 * @returns 匹配结果（不含 frontmatter，见 listFrontmatterLinks）。
 */
export function listMatches(text: string): LinkMatch[] {
  const out: LinkMatch[] = [];
  for (const m of text.matchAll(MD_LINK)) {
    const raw = m[0];
    // 跳过纯外部 http(s) 链接由上层决定，这里仍解析
    const linkText = m[2];
    out.push({
      type: detectTransclusion('markdown', linkText),
      raw,
      linkText,
    });
  }
  for (const m of text.matchAll(WIKI_LINK)) {
    const raw = m[0];
    const linkText = m[1].trim();
    out.push({
      type: detectTransclusion('wiki', linkText),
      raw,
      linkText,
    });
  }
  return out;
}

/** frontmatter 内的资源链接（banner / cover / attachments 数组等）。 */
export interface FrontmatterLink {
  key: string;
  raw: string;
  linkText: string;
}

/**
 * 从 YAML frontmatter 标量或数组中提取疑似资源链接。
 * @param fm frontmatter 对象（key → string | string[]）。
 */
export function listFrontmatterLinks(
  fm: Record<string, unknown>,
): FrontmatterLink[] {
  const out: FrontmatterLink[] = [];
  for (const [key, value] of Object.entries(fm)) {
    const candidates: string[] = Array.isArray(value) ? value.map(String) : [String(value)];
    for (const raw of candidates) {
      const t = extractLinkText(raw);
      if (t && isLikelyResource(t)) {
        out.push({ key, raw, linkText: t });
      }
    }
  }
  return out;
}

function extractLinkText(raw: string): string | null {
  const md = raw.match(/!\[[^\]]*\]\(([^)\s]+)\)/);
  if (md) return md[1];
  const wiki = raw.match(/\[\[([^\]|#]+)/);
  if (wiki) return wiki[1].trim();
  const bare = raw.trim();
  if (/^(\.{0,2}\/|data:|https?:\/\/)/.test(bare)) return bare;
  return null;
}

function isLikelyResource(linkText: string): boolean {
  if (/^(https?:|data:)/.test(linkText)) return true;
  const ext = linkText.split('.').pop()?.toLowerCase() ?? '';
  if (ext && ext.length <= 5 && /^[a-z0-9]+$/.test(ext)) return true;
  return false;
}

/**
 * 按映射批量改写链接目标，返回新文本。
 * @param text 原文。
 * @param mapping 旧目标 → 新目标。
 */
export function rewrite(text: string, mapping: Map<string, string>): string {
  if (mapping.size === 0) return text;
  let result = text;
  for (const idx of listMatches(text)) {
    const mapped = mapping.get(idx.linkText);
    if (mapped === undefined) continue;
    result = replaceTargetInRaw(result, idx, mapped);
  }
  return result;
}

/** 在原文 raw 中把目标替换为新值（保持链接外壳与别名不变）。 */
function replaceTargetInRaw(text: string, match: LinkMatch, newTarget: string): string {
  const raw = match.raw;
  let replaced: string;
  if (match.type === 'markdown' || match.type === 'mdTransclusion') {
    replaced = raw.replace(/\([^)\s]+\)/, `(${newTarget})`);
  } else {
    // wiki，重新拼装：仅替换目标段，保留 `#锚点` 与 `|别名`（二者可能同时出现）
    const body = raw.slice(2, -2);
    const pipeIdx = body.indexOf('|');
    const hashIdx = body.indexOf('#');
    // 锚点：从第一个 `#` 到候选的 `|` 之前
    const anchor = hashIdx >= 0
      ? body.slice(hashIdx, pipeIdx > hashIdx ? pipeIdx : undefined)
      : '';
    // 别名：从第一个 `|` 到结尾
    const alias = pipeIdx >= 0 ? body.slice(pipeIdx) : '';
    replaced = `[[${newTarget}${anchor}${alias}]]`;
  }
  return text.replace(raw, replaced);
}

/**
 * 便捷：安全（防路径穿越）地清理一个来源文件名，供下载/写盘使用。
 * 该函数面向"单个文件名"；任何含路径分隔符或点穿越的输入一律拒绝。
 */
export function sanitizeFilename(name: string): string {
  // 拒绝含分隔符（说明传入的是路径而非文件名）或点穿越
  if (name.includes('/') || name.includes('\\')) return '';
  if (name === '.' || name === '..') return '';
  if (/^\./.test(name)) return ''; // 隐藏文件 / 相对穿越
  let cleaned = name.replace(/[*:"?<>|]/g, '_');
  cleaned = cleaned.replace(/\s+$/g, '');
  return cleaned;
}

/** frontmatter 内可能出现的受管附件路径 token（含引号）。 */
const FM_RESOURCE_TOKEN =
  /["']?[A-Za-z0-9_.\-\/]+\.(?:png|jpe?g|gif|webp|bmp|avif|svg|mp4|mov|webm|mkv|mp3|wav|ogg|m4a|flac|pdf|docx|xlsx|pptx)["']?/gi;

/**
 * 改写 frontmatter 中的本地资源引用（cover / banner / attachments 等）。
 * 仅当 token（去除引号后）命中映射的完整路径或 basename 才替换，避免误伤纯文本键值。
 * body 链接改写见 rewrite()。二者结合可保证改名/移动/修复时不遗留 dangling 引用。
 */
export function rewriteFrontmatter(text: string, mapping: Map<string, string>): string {
  if (mapping.size === 0) return text;
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (!fm) return text;
  const block = fm[1];
  const next = block.replace(FM_RESOURCE_TOKEN, (tok) => {
    const clean = tok.trim().replace(/^["']+|["']+$/g, '');
    const mapped = mapping.get(clean);
    if (mapped === undefined) return tok;
    // 若原名带引号，新名保留引号风格
    if (tok.startsWith('"') && tok.endsWith('"')) return `"${mapped}"`;
    if (tok.startsWith("'") && tok.endsWith("'")) return `'${mapped}'`;
    return mapped;
  });
  if (next === block) return text;
  return text.replace(block, next);
}