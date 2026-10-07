/** 附件索引：库内"谁引用谁"的唯一数据源。 */

import type {
  AttachmentEntry,
  AttachmentIndexSnapshot,
  BrokenRef,
  MetadataProvider,
  Reference,
  ReferenceKind,
  VaultAdapter,
} from './types';
import { basenameOf, isManagedAttachment, isNoteText, extOf } from './types';
import type { AttachmentCategory } from './type-classifier';
import { decodePercentEncoded, listMatches, listFrontmatterResourceTokens } from './link-resolver';
import { normalizeInVault } from './path-compatibility';

interface ScanResult {
  targets: Map<string, ReferenceKind>;
}

/** 库内是否存在 basename 主名 = stem 的受管附件（wiki 无扩展名引用三态判定用）。 */
function managedStemsOf(files: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    if (!isManagedAttachment(extOf(f))) continue;
    const base = basenameOf(f);
    const dot = base.lastIndexOf('.');
    if (dot > 0) out.add(base.slice(0, dot));
  }
  return out;
}

/**
 * 从笔记文本中提取被引用的嵌入资源 target（`![[x]]` / `![alt](x)`），用于判定 embed/broken。
 *
 * 统一走 `listMatches`：过去这里自带一条正则（`!\[[^\]]*\]\(([^)\s]+)\)`），它的 markdown 分支
 * 按**空白截断**目标，`![x](assets/我的 图.png)` 会被读成 `assets/我的`——这正是口径不变式
 * 明令禁止的写法。虽然本函数结果只用于标注引用类型（不直接进孤儿/断链判定），
 * 但留着这份"半截路径"的口径迟早会被误用，故与正文解析层合并。
 *
 * 断链判定不在这里：它由 `scanUnresolvedBreaks`、`frontmatterBrokenRefs` 与 canvas 分支负责。
 * （早先本函数还返回过一个恒为空的 `broken` 数组，是重构残留，已删除。）
 */
function scanNoteText(text: string): ScanResult {
  const targets = new Map<string, ReferenceKind>();
  for (const m of listMatches(text)) {
    // 只看嵌入形态：wiki 侧要求原文以 `![` 开头（`![[x]]`），markdown 侧要求带 `!`（`![alt](x)`）。
    const isWiki = m.type.includes('wiki');
    if (isWiki ? !m.raw.startsWith('![') : !m.bang) continue;
    const target = m.linkText;
    if (!target) continue;
    if (/^(https?:|data:)/.test(target)) continue; // 外链不算库内资源
    targets.set(target, 'embed');
  }
  return { targets };
}

/**
 * 补全坏链接判定：resolvedLinks 只收录"已解析"目标，可能漏掉指向缺失文件的引用。
 * 这里对有扩展名的正文引用做“精确存在 / 按文件名存在”校验，确定真正不存在才报坏链接。
 * 同时消误报：笔记跨章节链接（相对路径 + 无扩展名）与标题锚点（`X.md#heading`）若
 * 能解析到库内已有文件/笔记，则不当作附件断链上报；URL 编码（%XX）引用先解码再判定。
 * wiki 无扩展名引用（[[pic]]）按三态判定：命中笔记/画布或受管附件 → 有效；双无 → 断链。
 */
function scanUnresolvedBreaks(
  text: string,
  sourcePath: string,
  fileSet: Set<string>,
  basenameMap: Map<string, Set<string>>,
  managedStems: Set<string>,
): BrokenRef[] {
  const out: BrokenRef[] = [];
  for (const m of listMatches(text)) {
    const t = m.linkText;
    if (/^(https?:|data:)/.test(t)) continue;
    const noAnchor = t.split('#')[0];
    const base = noAnchor.slice(noAnchor.lastIndexOf('/') + 1);
    const ext = extOf(base);
    // wiki 无扩展名：三态判定（笔记/画布 → 跳过；受管附件 → 跳过；双无 → 断链）。
    // 仅对纯 basename 引用（[[pic]]）启用——这是 Obsidian 附件短名引用的主流形态；
    // 带路径的无扩展名 wiki（[[folder/x]] / [[../../x]]）按笔记链接保守跳过（宁可漏检不误报）。
    if (!ext && m.type.includes('wiki')) {
      if (noAnchor.includes('/')) continue;
      if (basenameMap.has(`${base}.md`) || basenameMap.has(`${base}.canvas`)) continue;
      if (managedStems.has(base)) continue;
      out.push({ sourcePath, kind: 'wiki-attachment', raw: m.raw, linkText: t });
      continue;
    }
    // 仅将“受管附件类”引用当作附件断链：笔记链接、标题锚点、无扩展名、其它扩展名一律不报，
    // 从而消掉笔记跨章节链接与 `X.md#heading` 两类误报。
    if (!isManagedAttachment(ext)) continue;
    // URL 解码消误报：原始与解码两种解释任一可解析即非断链
    const decoded = decodePercentEncoded(noAnchor);
    if (resolvesInVault(sourcePath, t, fileSet, basenameMap)) continue;
    if (fileSet.has(t) || fileSet.has(decoded)) continue;
    if (basenameMap.has(base) || basenameMap.has(basenameOf(decoded))) continue; // Obsidian 可按文件名解析（即便路径不同）
    const kind: ReferenceKind = m.type === 'html' ? 'html' : m.type.includes('wiki') ? 'embed' : 'link';
    out.push({ sourcePath, kind, raw: m.raw, linkText: t });
  }
  return out;
}

/** 路径是否“看起来带扩展名”（最后一个 `/` 之后又有 `.后缀`）。 */
function hasExtension(p: string): boolean {
  const base = p.slice(p.lastIndexOf('/') + 1);
  return /\.[^/]+$/.test(base);
}

/**
 * 判定正文引用 `t`（可能是相对路径 + 无扩展名 + `#锚点`）能否解析到库内已有文件。
 * 只用于“是否为真断链”的消误报判定：锚点拆掉 `#` 后取基、相对路径按来源笔记目录解析、
 * 无扩展名的笔记链接尝试补 `.md`。命中（精确路径或唯一 basename）即视为可解析。
 * URL 编码（%XX）会先解码再参与判定。
 */
function resolvesInVault(
  sourcePath: string,
  t: string,
  fileSet: Set<string>,
  basenameMap: Map<string, Set<string>>,
): boolean {
  const noAnchor = t.split('#')[0];
  if (!noAnchor) return false;
  const slash = sourcePath.lastIndexOf('/');
  const baseDir = slash >= 0 ? sourcePath.slice(0, slash + 1) : '';
  const hasExt = hasExtension(noAnchor);
  const decoded = decodePercentEncoded(noAnchor);
  const cands = new Set<string>([noAnchor, decoded]);
  if (baseDir) {
    cands.add(baseDir + noAnchor);
    cands.add(baseDir + decoded);
  }
  const toTry: string[] = [];
  for (const c of cands) {
    toTry.push(c);
    if (!hasExt) toTry.push(`${c}.md`); // 笔记链接（无扩展名）补扩展名
  }
  for (const c of toTry) {
    const norm = normalizeInVault(c);
    if (norm === null) continue;
    if (fileSet.has(norm)) return true;
    if (basenameMap.has(norm.slice(norm.lastIndexOf('/') + 1))) return true;
  }
  return false;
}

function dedupeBroken(refs: BrokenRef[]): BrokenRef[] {
  const seen = new Set<string>();
  const out: BrokenRef[] = [];
  for (const r of refs) {
    const key = `${r.sourcePath}\u0000${r.linkText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * 提取 YAML frontmatter 中疑似受管附件的引用（如 cover / banner / attachments 数组）。
 *
 * 仅用作"绝不做成孤儿"的安全兜底：只要 frontmatter 里引用了的附件，纳入 usedByBasename，
 * 不会被未用清理误删。返回这些引用的 basename（去重）。
 *
 * 解析器与改写层共用 `listFrontmatterResourceTokens`（详见该函数注释）：**不能**在这里另写一套
 * 更窄的正则。曾经的写法是 `[A-Za-z0-9_.\-/]+` + 硬编码扩展名，它把含空格与中文的附件名
 * （插件命名会生成 `中文笔记_image_001.png`）读成半截路径，于是这些"确实被 frontmatter 引用"
 * 的附件既不进在用集合、又不被 Obsidian 的 resolvedLinks 收录（裸路径不算链接），
 * 最终被当作孤儿删掉。原始写法与 `%xx` 解码写法都纳入，与正文引用层保持同一口径。
 */
function managedBasenamesFromFrontmatter(text: string): string[] {
  const out = new Set<string>();
  for (const tok of listFrontmatterResourceTokens(text)) {
    if (/^(https?:|data:)/i.test(tok)) continue; // 外链 / data 不算库内资源
    for (const v of new Set([tok, decodePercentEncoded(tok)])) {
      const base = basenameOf(v);
      if (isManagedAttachment(extOf(base))) out.add(base);
    }
  }
  return Array.from(out);
}

/** 解析 canvas JSON 中被嵌入的文件节点（type === 'file' → file 字段）。 */
function canvasFileRefs(jsonText: string): string[] {
  try {
    const data = JSON.parse(jsonText) as { nodes?: Array<{ type?: string; file?: unknown }> };
    if (!Array.isArray(data.nodes)) return [];
    const out: string[] = [];
    for (const n of data.nodes) {
      if (n && n.type === 'file' && typeof n.file === 'string' && n.file) out.push(n.file);
    }
    return out;
  } catch {
    return [];
  }
}

interface FmBrokenCandidate {
  raw: string;
  linkText: string;
}

/**
 * 结构化解析 YAML frontmatter，返回可能的“本地资源路径”引用（排除外链 / data / 锚点）。
 * 供断链报告使用：仅收录带受管附件扩展名的本地路径，避免把纯文本键值误判为断链。
 */
function frontmatterBrokenRefs(text: string): FmBrokenCandidate[] {
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (!fm) return [];
  const out: FmBrokenCandidate[] = [];
  const seen = new Set<string>();
  const unquote = (s: string): string => s.trim().replace(/^["']+|["']+$/g, '');
  const add = (raw: string, candidate: string): void => {
    const t = unquote(candidate);
    if (!t) return;
    if (/^(https?:|\/\/|data:|!\[|#)/i.test(t)) return; // 外链 / 锚点 / 图片语法不算
    if (!isManagedAttachment(extOf(t.split('?')[0]))) return; // 只报受管附件类
    if (seen.has(raw)) return;
    seen.add(raw);
    out.push({ raw, linkText: t });
  };
  let lastKey = '';
  for (const line of fm[1].split('\n')) {
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem) {
      if (lastKey) add(`${lastKey}: ${listItem[1]}`, listItem[1]);
      continue;
    }
    const kv = line.match(/^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (kv) {
      lastKey = kv[1];
      const v = kv[2].trim();
      if (!v) continue;
      if (v.startsWith('[') && v.endsWith(']')) {
        for (const item of v.slice(1, -1).split(',')) add(`${lastKey}: ${item}`, item);
      } else {
        add(`${lastKey}: ${v}`, v);
      }
    } else {
      lastKey = '';
    }
  }
  return out;
}

export class AttachmentIndex {
  private snapshot: AttachmentIndexSnapshot | null = null;
  private dirty = true;

  constructor(
    private readonly vault: VaultAdapter,
    private readonly meta: MetadataProvider,
    /**
     * 诊断信息出口（默认丢弃）。
     *
     * core 不能 import `logger`（本仓库的架构守卫只允许同目录导入），所以走注入。
     * 这里报的"重建还是命中缓存"正是排查"计划基于过期快照"那类缺陷的第一手线索——
     * 2026-09-28 真实宿主上抓到的 `ENOENT: 改名失败` 就是计划里的路径与磁盘不符，
     * 而当时控制台里既看不到快照何时重建，也看不到它包含多少个受管附件。
     */
    private readonly onDebug: (msg: string) => void = () => {},
  ) {}

  /** 触发一次性重建。 */
  markDirty(): void {
    this.dirty = true;
    this.onDebug('索引被标记为待重建（markDirty）');
  }

  /** 惰性取快照：若已 dirty 则重建。 */
  async getSnapshot(): Promise<AttachmentIndexSnapshot> {
    if (!this.snapshot || this.dirty) {
      this.onDebug('索引快照：重建（dirty 或尚未构建）');
      this.snapshot = await this.build();
      this.dirty = false;
    } else {
      this.onDebug('索引快照：命中缓存，未重建');
    }
    return this.snapshot;
  }

  /** 重建完整快照。 */
  async build(): Promise<AttachmentIndexSnapshot> {
    const files = await this.vault.listFiles();
    const fileSet = new Set(files);
    // basename → 所有同名路径（Obsidian 按文件名解析的基准；多值索引供三态判定与候选池）
    const basenameMap = new Map<string, Set<string>>();
    for (const f of files) {
      const i = f.lastIndexOf('/');
      const b = i >= 0 ? f.slice(i + 1) : f;
      let s = basenameMap.get(b);
      if (!s) {
        s = new Set<string>();
        basenameMap.set(b, s);
      }
      s.add(f);
    }
    const managedStems = managedStemsOf(files);
    // stem → 受管附件路径：供无扩展名短名引用（![[pic]]）反查，使"在用"保护与
    // 断链判定层（managedStems）口径一致。
    const stemPaths = new Map<string, string[]>();
    for (const f of files) {
      if (!isManagedAttachment(extOf(f))) continue;
      const b = basenameOf(f);
      const dot = b.lastIndexOf('.');
      if (dot <= 0) continue;
      const stem = b.slice(0, dot);
      const arr = stemPaths.get(stem);
      if (arr) arr.push(f);
      else stemPaths.set(stem, [f]);
    }
    const noteFiles = files.filter(isNoteText);

    // Obsidian resolvedLinks: notePath -> { target: count }
    const resolved = this.meta.getResolvedLinks();

    const usedTargets = new Map<string, Reference[]>();
    const brokenRefs: BrokenRef[] = [];
    const embedTargets = new Set<string>();
    // 兜底：记录所有笔记文本引用的受管附件 basename，即使 Obsidian 尚未解析短名嵌入，
    // 也绝不把这些仍被引用的附件判为孤儿而误删（数据安全）。同时记录“哪个笔记引用了它”，
    // 以便为唯一命名的附件合成引用，让命名/修复不依赖 Obsidian 的索引就绪。
    const usedByBasename = new Map<string, Set<string>>();

    for (const note of noteFiles) {
      const text = await this.meta.getFileText(note);
      const scan = scanNoteText(text);
      for (const [t] of scan.targets) embedTargets.add(t);
      // 补全：resolvedLinks 可能漏掉指向缺失文件的引用
      brokenRefs.push(...scanUnresolvedBreaks(text, note, fileSet, basenameMap, managedStems));
      // 从正文收集受管附件 basename（含 markdown 内嵌、wiki 引用、无扩展名短名与 URL 编码写法）
      for (const m of listMatches(text)) {
        if (/^(https?:|data:)/.test(m.linkText)) continue;
        const noAnchor = m.linkText.split('#')[0];
        // URL 编码（%20 / %E4%B8%AD 等）与原始写法都要纳入：断链层会解码后判定，
        // 孤儿保护层若只看原始文本，`![x](assets/enc%20oded.png)` 之类引用就不会被认作在用 → 误删。
        const variants = new Set<string>([noAnchor, decodePercentEncoded(noAnchor)]);
        const bases: string[] = [];
        for (const v of variants) {
          if (v.endsWith('.md') || v.endsWith('.canvas')) continue;
          const base = basenameOf(v);
          if (isManagedAttachment(extOf(base))) {
            bases.push(base);
          } else if (!extOf(base) && m.type.includes('wiki') && !v.includes('/')) {
            // 无扩展名短名引用（`![[pic]]`）：按 stem 反查受管附件后纳入"在用"保护。
            // 断链判定层（scanUnresolvedBreaks + managedStems）已按 stem 认可此类引用，
            // 这里必须对齐——否则被 `![[pic]]` 引用的 pic.png 会被判为孤儿而误删。
            bases.push(...(stemPaths.get(base) ?? []).map(basenameOf));
          }
        }
        for (const b of bases) {
          let notes = usedByBasename.get(b);
          if (!notes) {
            notes = new Set<string>();
            usedByBasename.set(b, notes);
          }
          notes.add(note);
        }
      }
      // frontmatter 引用兜底：cover/banner/attachments 等仅出现于 YAML 的附件，
      // 同样纳入 usedByBasename，避免被误判为未使用而误删（数据安全）。
      for (const base of managedBasenamesFromFrontmatter(text)) {
        let notes = usedByBasename.get(base);
        if (!notes) {
          notes = new Set<string>();
          usedByBasename.set(base, notes);
        }
        notes.add(note);
      }
      // canvas 附件：type='file' 节点。做孤儿安全兜底，并对缺失目标报断链。
      if (note.endsWith('.canvas')) {
        for (const target of canvasFileRefs(text)) {
          if (/^(https?:|data:)/.test(target)) continue;
          const base = basenameOf(target);
          let notes = usedByBasename.get(base);
          if (!notes) {
            notes = new Set<string>();
            usedByBasename.set(base, notes);
          }
          notes.add(note);
          if (!fileSet.has(target) && !basenameMap.has(base)) {
            brokenRefs.push({ sourcePath: note, kind: 'canvas', raw: target, linkText: target });
          }
        }
      }
      // frontmatter 断链：YAML 中引用但本地不存在的受管附件。
      for (const f of frontmatterBrokenRefs(text)) {
        if (fileSet.has(f.linkText)) continue;
        if (basenameMap.has(basenameOf(f.linkText))) continue;
        brokenRefs.push({ sourcePath: note, kind: 'frontmatter', raw: f.raw, linkText: f.linkText });
      }

      const noteLinks = resolved[note] ?? {};
      for (const [target] of Object.entries(noteLinks)) {
        if (target.endsWith('.md')) continue; // 笔记不算附件
        // 仅受管附件类目标参与附件断链判定：笔记/锚点即使在 resolvedLinks 里也跳过（消误报）
        const noAnchor = target.split('#')[0];
        const base = noAnchor.slice(noAnchor.lastIndexOf('/') + 1);
        if (!isManagedAttachment(extOf(base))) continue;
        // URL 解码消误报：%XX 编码的引用解码后存在则非断链
        const decoded = decodePercentEncoded(target);
        if (!fileSet.has(target) && !fileSet.has(decoded)) {
          brokenRefs.push({ sourcePath: note, kind: linkOrEmbed(target, embedTargets), raw: target, linkText: target });
          continue;
        }
        const refs = usedTargets.get(target) ?? [];
        refs.push({
          sourcePath: note,
          kind: linkOrEmbed(target, embedTargets),
          raw: target,
          linkText: target,
          status: 'resolved',
        });
        usedTargets.set(target, refs);
      }
    }

    const broken = dedupeBroken(brokenRefs);

    // basename → 命中文件数，用于判断“唯一文件”以安全合成短名引用
    const baseCount = new Map<string, number>();
    for (const f of files) {
      if (!isManagedAttachment(extOf(f))) continue;
      const b = basenameOf(f);
      baseCount.set(b, (baseCount.get(b) ?? 0) + 1);
    }

    // 组装附件条目
    const entries = new Map<string, AttachmentEntry>();
    const orphanCandidates: string[] = [];
    for (const f of files) {
      if (!isManagedAttachment(extOf(f))) continue;
      const base = basenameOf(f);
      const resolvedRefs = usedTargets.get(f) ?? [];
      let references = resolvedRefs;
      if (baseCount.get(base) === 1) {
        // **合并**两套口径，而不是二选一：
        // `usedTargets` 来自 Obsidian 的 resolvedLinks，它**不认识** HTML 媒体标签
        // （`<audio src>` / `<video src>` / `<source src>`）这类写法；只看它就会漏掉这些引用者。
        // 而 `usedByBasename` 是按正文文本扫出来的，认得。过去写成「resolvedRefs 为空时才合成」，
        // 于是**部分重合**的附件（既被 markdown 链接引用、又被 HTML 标签引用）会丢掉后者：
        // 共享判定因此误判为独占 → 「重命名全库」原地改名而非按笔记各复制副本 →
        // HTML 那种 Obsidian 不认识、改名联动不会改的引用当场悬空。
        // basename 唯一是安全前提：若同名多文件，按名合成会把引用挂到错误目标。
        const srcs = usedByBasename.get(base);
        if (srcs && srcs.size > 0) {
          const seen = new Set(resolvedRefs.map((r) => r.sourcePath));
          const merged: Reference[] = [...resolvedRefs];
          for (const sourcePath of srcs) {
            if (seen.has(sourcePath)) continue;
            merged.push({ sourcePath, kind: 'embed', raw: base, linkText: f, status: 'resolved' });
          }
          references = merged;
        }
      }
      entries.set(f, { path: f, category: categoryFromExt(extOf(f)), mime: '', animated: false, size: 0, mtime: 0, references });
      if (references.length === 0 && !usedByBasename.has(base)) orphanCandidates.push(f);
    }

    this.onDebug(
      `索引重建完成：文件 ${files.length}，受管附件 ${entries.size}，断链 ${broken.length}，孤儿候选 ${orphanCandidates.length}`,
    );
    return { entries, brokenRefs: broken, orphanCandidates };
  }

  /** 单条附件概览（供命名/审计快速取用）。 */
  async getEntry(path: string): Promise<AttachmentEntry | undefined> {
    const snap = await this.getSnapshot();
    return snap.entries.get(path);
  }
}

function linkOrEmbed(target: string, embedTargets: Set<string>): ReferenceKind {
  return embedTargets.has(target) ? 'embed' : 'link';
}

/** 扩展名 → 默认类别（精确类别由 classify 内容识别补充）。 */
function categoryFromExt(ext: string): AttachmentCategory {
  switch (ext) {
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'bmp':
    case 'avif':
    case 'svg':
      return 'image';
    case 'mp4':
    case 'mov':
    case 'webm':
    case 'mkv':
      return 'video';
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'm4a':
    case 'flac':
      return 'audio';
    case 'pdf':
      return 'pdf';
    case 'docx':
    case 'xlsx':
    case 'pptx':
      return 'document';
    default:
      return 'misc';
  }
}