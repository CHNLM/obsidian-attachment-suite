/** 链接解析与写回（纯函数，不含 App）。 */

import { basenameOf } from './types';

export type LinkType =
  | 'markdown'
  | 'wiki'
  | 'wikiTransclusion'
  | 'mdTransclusion'
  /** HTML 标签属性（<img src> / <a href> 等）引用。 */
  | 'html';

export interface LinkMatch {
  type: LinkType;
  /** 原文片段。 */
  raw: string;
  /** 解析出的目标字符串（已做 `<>` 去壳、`%xx` 解码，故与库内字面路径一致）。 */
  linkText: string;
  /** markdown 链接的 alt 文本（仅 type 为 markdown 系时有值）。 */
  alt?: string;
  /** markdown 链接的标题段（形如 ` "标题"`，含前导空格；无则空串）。 */
  title?: string;
  /** markdown 链接是否带 `!`（嵌入/图片）。 */
  bang?: boolean;
}

/**
 * markdown 链接：`![alt](dest)` / `[alt](<dest 带空格>)` / `[alt](dest "标题")`。
 *
 * 目标段整体捕获，**不能按空白截断**：Obsidian 与插件自身都会写出含空格的附件名
 * （插件命名会生成 `笔记名_image_001.png`，Obsidian 则把它写成 `%20` 形态）。
 * 一旦按空白截断，`notes/assets/15-中文 空格 emoji 😀_pdf_001.pdf` 会被读成 `notes/assets/15-中文`
 * ——扩展名丢失 → 该引用不进"在用"集合 → 「清理未用附件」把它当孤儿删掉（数据损失）。
 *
 * 也**不能写成 `([^)]*)`**：那会在目标内部的第一个 `)` 处收尾，而含括号的合法文件名很常见
 * （Windows 的同名副本 `报告 (1).png`）。截断后同样既不进"在用"集合、也不会被改写——
 * 2026-09-28 验收用例 L06/P01 实测到后果：`path-cases/normal name (1)-ok.png` 被当孤儿**移入回收站**，
 * 笔记留下断链。故允许**一层**括号嵌套（深层嵌套属病态写法，CommonMark 本就要求这类目标
 * 用 `<...>` 包裹或 `%28`/`%29` 编码）。
 */
const MD_DEST = String.raw`((?:[^()]|\([^()]*\))*)`;
const MD_LINK = new RegExp(String.raw`(!?)\[([^\]]*)\]\(${MD_DEST}\)`, 'g');
const WIKI_LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
/** HTML 标签：img/audio/video/source 的 src 属性，a 的 href 属性（属性顺序任意、单双引号均可）。 */
const HTML_ATTR = /<(img|audio|video|source|a)\b[^>]*?\b(src|href)=(["'])([^"']*)\3[^>]*>/gi;

/**
 * 拆解 markdown 链接括号内的原文 → `{ target, title }`。
 * 支持 CommonMark 的 `<带 空格 的路径>` 尖括号写法与 ` "标题"` 后缀；标题段原样保留（含前导空格）。
 *
 * 全仓**唯一**的 markdown 目标解析：正文引用、frontmatter 资源解析、媒体本地化都走它。
 * （本地化侧原先自建了一份"按空白截断"的解析，于是带标题的图片不被本地化、
 * 目标含 `)` 时还会被截断出一段错链接——同一件事两份实现的老问题。）
 */
export function parseMdTarget(inner: string): { target: string; title: string } {
  let s = inner.trim();
  let title = '';
  const tm = s.match(/^(.*?)\s+("[^"]*"|'[^']*')$/);
  if (tm) {
    s = tm[1].trim();
    title = ` ${tm[2]}`;
  }
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1);
  return { target: s, title };
}

/**
 * 链接目标里的 `%xx` 解码（`%20`、中文 `%E4%B8%AD` 等任意百分号编码）；解码失败（非法转义）时原样返回。
 *
 * 这是全仓**唯一**的百分号解码实现：正文引用、frontmatter 资源、断链候选都走它。
 * 过去有 3 份等价副本（本文件、`attachment-index`、`broken-link-core`），而"同一件事
 * 两份实现、后来只改了一份"正是本仓库 4 次误删级缺陷的共同成因。
 */
export function decodePercentEncoded(t: string): string {
  if (!t.includes('%')) return t;
  try {
    return decodeURIComponent(t);
  } catch {
    return t;
  }
}

/**
 * 把库内字面路径编码成 markdown 链接可直接使用的目标。
 *
 * 空格与圆括号必须编码：CommonMark 的目标段不允许裸空格（`![x](a b.png)` 不是链接，
 * 会退化成普通文本），而 Obsidian 生成的链接也正是 `%20` 形态。只编码这两个字符、
 * 不动 `%`，以免把用户已有的 `%20` 二次编码成 `%2520`。
 * wiki 链接不走这里（`[[ ]]` 本身允许空格）。
 */
export function encodeMdTarget(target: string): string {
  return target.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}


function detectTransclusion(type: LinkType, linkText: string): LinkType {
  if (type === 'wiki' && linkText.includes('#')) return 'wikiTransclusion';
  if (type === 'markdown' && linkText.includes('#')) return 'mdTransclusion';
  return type;
}

/**
 * 剥离 fenced 代码块（``` / ~~~）、行内反引号代码与 HTML 注释（`<!-- … -->`，支持跨行），
 * 返回仅含"有效引用区"的文本副本（被剥离部分替换为等长空格，保持行长与行数）。
 * 目的：避免把代码示例与被注释掉的写法中的假链接误报为断链。
 */
export function stripCodeBlocks(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceChar = '';
  const comment = { open: false };
  for (const line of lines) {
    const m = line.match(/^\s*(```+|~~~+)/);
    if (m) {
      if (!inFence) {
        inFence = true;
        fenceChar = m[1][0];
      } else if (m[1][0] === fenceChar) {
        inFence = false;
      }
      out.push('');
      continue;
    }
    if (inFence) {
      out.push('');
      continue;
    }
    // 先处理行内代码，再处理 HTML 注释：这样 `` `<!--` `` 不会被误判为注释开头
    const noInline = line.replace(/`[^`]*`/g, (s) => ' '.repeat(s.length));
    out.push(stripHtmlCommentsInLine(noInline, comment));
  }
  return out.join('\n');
}

/**
 * 剥离单行内的 HTML 注释（可跨行：未闭合时置位 `state.open`，后续行继续剥离）。
 * 注释区一律替换为等长空格，注释之外的文本原样保留。
 */
function stripHtmlCommentsInLine(line: string, state: { open: boolean }): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (state.open) {
      const end = line.indexOf('-->', i);
      if (end < 0) return out + ' '.repeat(line.length - i);
      out += ' '.repeat(end + 3 - i);
      i = end + 3;
      state.open = false;
      continue;
    }
    const start = line.indexOf('<!--', i);
    if (start < 0) return out + line.slice(i);
    out += line.slice(i, start) + ' '.repeat(4);
    i = start + 4;
    state.open = true;
  }
  return out;
}

/**
 * 列出文件正文中的所有链接匹配项（先剥离代码块，再匹配 markdown / wiki / HTML 标签）。
 * @param text 文件内容。
 * @returns 匹配结果（不含 frontmatter，见 listFrontmatterLinks）。
 */
export function listMatches(text: string): LinkMatch[] {
  const body = stripCodeBlocks(text);
  const out: LinkMatch[] = [];
  for (const m of body.matchAll(MD_LINK)) {
    const raw = m[0];
    // m[1] `!`、m[2] alt、m[3] 括号内原文（可能含空格/`<...>`/标题）
    const parsed = parseMdTarget(m[3]);
    const linkText = decodePercentEncoded(parsed.target);
    // 跳过纯外部 http(s) 链接由上层决定，这里仍解析
    out.push({
      type: detectTransclusion('markdown', linkText),
      raw,
      linkText,
      alt: m[2],
      title: parsed.title,
      bang: m[1] === '!',
    });
  }
  for (const m of body.matchAll(WIKI_LINK)) {
    const raw = m[0];
    const linkText = m[1].trim();
    out.push({
      type: detectTransclusion('wiki', linkText),
      raw,
      linkText,
    });
  }
  for (const m of body.matchAll(HTML_ATTR)) {
    out.push({ type: 'html', raw: m[0], linkText: m[4] });
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
  // 与 `MD_LINK` 同一口径（含一层括号嵌套），否则 frontmatter 里的资源 token 也会被截断
  const md = new RegExp(String.raw`!?\[[^\]]*\]\(${MD_DEST}\)`).exec(raw);
  if (md) {
    const t = parseMdTarget(md[1]).target;
    if (t) return decodePercentEncoded(t);
  }
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

/** 在原文 raw 中把目标替换为新值（保持链接外壳、别名与标题不变）。 */
function replaceTargetInRaw(text: string, match: LinkMatch, newTarget: string): string {
  const raw = match.raw;
  let replaced: string;
  if (match.type === 'html') {
    // HTML 属性：替换 src/href 值，保留引号风格
    replaced = raw.replace(/\b(src|href)=(["'])[^"']*\2/i, `$1=$2${newTarget}$2`);
  } else if (match.type === 'markdown' || match.type === 'mdTransclusion') {
    // 重新拼装而不是"正则替换括号内容"：旧目标可能含空格，按空白截断的正则替换会漏改；
    // 同时新目标必须编码（含空格/圆括号时），否则写出的引用不是合法 markdown 链接。
    const bang = match.bang ? '!' : '';
    replaced = `${bang}[${match.alt ?? ''}](${encodeMdTarget(newTarget)}${match.title ?? ''})`;
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
  // 函数式替换：newTarget/alt 里可能含 `$&`、`$1` 等，直接传字符串会被当成替换模式展开而改坏正文。
  return text.replace(raw, () => replaced);
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

/**
 * frontmatter 内可能出现的受管附件路径 token（含引号）。
 *
 * 字符类设计要点：
 * - 首字符**不含空白与 `-`**：否则 `cover: assets/a.png` 会从空格起匹配、`- assets/a.png`
 *   会从列表短横线起匹配，导致整段 token 去 trim 后匹配不上映射（引用漏改）。
 * - 后续字符**允许空白**：`cover: assets/我的 图.png` 这类字面写法必须整体捕获。
 * - 用 `\p{L}\p{N}` 而非 `A-Za-z0-9`：中文等非 ASCII 附件名（命名功能会生成
 *   `中文笔记_image_001.png`）同样要能被改写，否则 frontmatter 引用会在改名后悬空。
 * - 含 `%` 以覆盖 URL 编码的 `%20`；不含 `:`/`,`/`[`/`]` 以免吞掉 YAML 结构。
 */
const FM_RESOURCE_TOKEN =
  /["']?[\p{L}\p{N}_.\/%][\p{L}\p{N}_.\-\/% ]*\.(?:png|jpe?g|gif|webp|bmp|avif|svg|mp4|mov|webm|mkv|mp3|wav|ogg|m4a|flac|pdf|docx|xlsx|pptx)["']?/giu;

/**
 * 提取 frontmatter 块内的受管资源 token（已去引号，保留 `%xx` 原样）。
 *
 * 与 `rewriteFrontmatter` 共用**同一个** `FM_RESOURCE_TOKEN`：孤儿保护层（谁在用 → 不能删）
 * 与引用改写层（改名后要改谁）必须口径一致。历史教训是两层各写一套正则——改写层认中文/含空格名，
 * 保护层只认 `[A-Za-z0-9_.\-/]`，于是这类附件既不被认作"在用"、又确实被别的笔记引用着，
 * 最终被「清理未用附件」当成孤儿删掉（数据损失）。
 */
export function listFrontmatterResourceTokens(text: string): string[] {
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (!fm) return [];
  const out: string[] = [];
  for (const m of fm[1].matchAll(FM_RESOURCE_TOKEN)) {
    const clean = m[0].trim().replace(/^["']+|["']+$/g, '');
    if (clean) out.push(clean);
  }
  return out;
}

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
    // 先按字面匹配；未命中再按 `%xx` 解码匹配（mapping 的键是库内字面路径）
    const mapped = mapping.get(clean) ?? mapping.get(decodePercentEncoded(clean));
    if (mapped === undefined) return tok;
    // 若原名带引号，新名保留引号风格
    if (tok.startsWith('"') && tok.endsWith('"')) return `"${mapped}"`;
    if (tok.startsWith("'") && tok.endsWith("'")) return `'${mapped}'`;
    return mapped;
  });
  if (next === block) return text;
  // 函数式替换：newTarget 里可能含 `$&`、`$1` 等，直接传字符串会被当成替换模式展开而改坏正文。
  return text.replace(block, () => next);
}

/**
 * 改写 canvas JSON 文本中的 `"file": "<path>"` 引用。
 *
 * 为什么必须住在 core（而不能留在某个 feature 里）：
 * - 引用**读取**口径在 core 里（`attachment-index` 的 `canvasFileRefs` 解析 canvas 的 `file` 节点，
 *   据此把被 canvas 引用的附件算作"在用"）——所以引用**写入**口径也必须在这里，否则又是
 *   一次"两层口径不一致"；
 * - 需要它的有两处：feature 的断链修复（`broken-link`）与 infra 的通用引用兜底改写
 *   （`obsidian-domain.rewriteRefsInNote`）。infra **不允许** import features，
 *   所以它只能住在 core。
 *
 * 为什么通用兜底改写必须处理 canvas：`rewrite()` 只认 markdown / wiki / HTML，
 * canvas 的 `"file"` 字段一个都不沾。于是「收集」把 canvas 引用的附件搬走、
 * 「全库命名」再把它改名时，canvas 里的引用**原地不动**变成悬空；紧接着这一轮
 * 「清理未用附件」按"谁都没引用我"把它当孤儿删掉——
 * **附件真的丢了、canvas 真的断了**。这条链路曾被一条同义反复的验收断言掩盖（见
 * `acceptance.test.ts` 的字节指纹检查）。
 *
 * 实现取舍：**只改 `"file"` 字段的整值**，不解析/重写整个 JSON。
 *
 * 早期实现是 `text.split(from).join(to)`（对每个映射做全局子串替换），它有两个真实缺陷：
 * 1. 映射里同时含"完整路径"与"纯 basename"两项时（`refMapForMoves` 正是这么造的），
 *    第二次替换会命中第一次替换的结果——`assets/only-canvas.png` 被再替换一次成
 *    `assets/assets/only-canvas.png`，路径当场改坏；
 * 2. 全局替换还会命中出现在别的字段里的一模一样的字符串。
 * 整值匹配天然幂等（替换后是"新值"，不会再等于任何"旧值"键），也不会误伤其它字段。
 */
export function rewriteCanvasFileFields(
  text: string,
  mapping: ReadonlyMap<string, string>,
): string {
  if (mapping.size === 0) return text;
  return text.replace(/(\"file\"\s*:\s*)\"([^\"]*)\"/g, (m, prefix: string, value: string) => {
    // 与正文一致：先按字面匹配，未命中再按 `%xx` 解码匹配（mapping 的键是库内字面路径）
    const to = mapping.get(value) ?? mapping.get(decodePercentEncoded(value));
    return to === undefined ? m : `${prefix}${JSON.stringify(to)}`;
  });
}

/** 一次改名/移动的结果行。 */
export interface MoveOutcomeRow {
  from: string;
  to: string;
}

/**
 * 往改写映射里登记"同一个文件"的**三种引用写法**：完整路径 / 纯 basename / 无扩展名主名。
 *
 * 这是**唯一**允许构造引用改写键的地方。任何"移动/改名/复制后要改引用"的调用方都必须用它，
 * 不要自己手写 `map.set(...)`——2026-09-28 的两次真实数据损失都是这么来的：
 * - 第一次（改名路径）漏了主名键：`![[song]]` 未被改写 → 文件失去引用者 → 被当孤儿删；
 * - 第二次（共享附件的**复制副本**分支）漏了主名键：同一条笔记的 `![[song]]` 依然悬空，
 *   副本被创建后立刻因为没有引用者而进了回收站。
 *
 * @param map 目标映射（就地修改）。
 * @param fromPath 旧路径（库内）。
 * @param toPath 新路径（库内）。
 */
export function addRefKeys(map: Map<string, string>, fromPath: string, toPath: string): void {
  map.set(fromPath, toPath);
  const base = basenameOf(fromPath);
  if (!map.has(base)) map.set(base, toPath);
  // 无扩展名短名（`![[song]]`）按**主名**匹配；已有同名键时不覆盖（保留先到者，避免不确定映射）
  const dot = base.lastIndexOf('.');
  if (dot > 0) {
    const stem = base.slice(0, dot);
    if (stem && !map.has(stem)) map.set(stem, toPath);
  }
}

/**
 * 由移动结果构造改写映射（逐条走 `addRefKeys`，保证与"复制副本"路径同一口径）。
 *
 * 口径必须与**读取侧**对齐：`attachment-index` 的 `stemPaths` 早就按主名反查受管附件，
 * 把 `![[pic]]` 认作"在用"（见那里的注释，历史上正因这条口径缺失误删过附件）。
 *
 * 归位说明：它原本住在 `features/link-fixer-core.ts`，但**命名 / 收集 / 全库收集 / 笔记跟随**
 * 都要用它（infra 层的 `rewriteRefsInAllNotes` 也用它），于是 `link-fixer` 被当成了"共享执行模块"
 * （唯一被横向依赖的 feature）。它是纯函数，本该在 core 里 —— 见 `tests/unit/architecture.test.ts` 的守卫。
 */
export function refMapForMoves(moves: MoveOutcomeRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const mv of moves) addRefKeys(map, mv.from, mv.to);
  return map;
}