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
import { isManagedAttachment, isNoteText, extOf } from './types';
import type { AttachmentCategory } from './type-classifier';
import { listMatches } from './link-resolver';

interface ScanResult {
  targets: Map<string, ReferenceKind>;
  broken: BrokenRef[];
}

/** 从笔记文本中提取被引用的资源 target（`![[x]]` 与 `![alt](x)`），用于判定 embed/broken。 */
function scanNoteText(text: string): ScanResult {
  const embedRegex = /!\[\[([^\]|#]+)(?:#[^\]|]*)?\]\]|!\[[^\]]*\]\(([^)\s]+)\)/g;
  const targets = new Map<string, ReferenceKind>();
  const broken: BrokenRef[] = [];
  for (const m of text.matchAll(embedRegex)) {
    const target = (m[1] || m[2] || '');
    if (!target) continue;
    if (/^(https?:|data:)/.test(target)) continue; // 外链不算库内资源
    targets.set(target, 'embed');
  }
  return { targets, broken };
}

/**
 * 补全坏链接判定：resolvedLinks 只收录"已解析"目标，可能漏掉指向缺失文件的引用。
 * 这里对有扩展名的正文引用做“精确存在 / 按文件名存在”校验，确定真正不存在才报坏链接。
 */
function scanUnresolvedBreaks(
  text: string,
  sourcePath: string,
  fileSet: Set<string>,
  basenameSet: Set<string>,
): BrokenRef[] {
  const out: BrokenRef[] = [];
  for (const m of listMatches(text)) {
    const t = m.linkText;
    if (/^(https?:|data:)/.test(t)) continue;
    if (t.endsWith('.md') || t.endsWith('.canvas')) continue;
    if (extOf(t) === '') continue; // 无扩展名不做判定，避免误报
    if (fileSet.has(t)) continue;
    const base = t.slice(t.lastIndexOf('/') + 1);
    if (basenameSet.has(base)) continue; // Obsidian 可按文件名解析（即便路径不同）
    out.push({ sourcePath, kind: 'link', raw: m.raw, linkText: t });
  }
  return out;
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
 * 仅用作“绝不做成孤儿”的安全兜底：只要正文 else 处引用了的附件，纳入 usedByBasename，
 * 不会被未用清理误删。返回这些引用的 basename（去重）。
 */
function managedBasenamesFromFrontmatter(text: string): string[] {
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (!fm) return [];
  // 在 frontmatter 块内寻找以受管扩展名结尾的文件名 token（含路径）。
  // 保守匹配，宁可多收（数据安全）也不漏掉真实引用。
  const tokenRe = /[A-Za-z0-9_.\-/]+\.(?:png|jpe?g|gif|webp|bmp|avif|svg|mp4|mov|webm|mkv|mp3|wav|ogg|m4a|flac|pdf|docx|xlsx|pptx)/gi;
  const out = new Set<string>();
  for (const m of fm[1].matchAll(tokenRe)) {
    const t = m[0];
    if (extOf(t) === 'svg' && /^(https?:\/\/)/i.test(t)) continue; // 外链 svg 不入库
    if (!/^(https?:|data:)/i.test(t)) out.add(basenameOf(t));
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
  ) {}

  /** 触发一次性重建。 */
  markDirty(): void {
    this.dirty = true;
  }

  /** 惰性取快照：若已 dirty 则重建。 */
  async getSnapshot(): Promise<AttachmentIndexSnapshot> {
    if (!this.snapshot || this.dirty) {
      this.snapshot = await this.build();
      this.dirty = false;
    }
    return this.snapshot;
  }

  /** 重建完整快照。 */
  async build(): Promise<AttachmentIndexSnapshot> {
    const files = await this.vault.listFiles();
    const fileSet = new Set(files);
    const basenameSet = new Set<string>();
    for (const f of files) {
      const i = f.lastIndexOf('/');
      basenameSet.add(i >= 0 ? f.slice(i + 1) : f);
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
      if (scan.broken.length) brokenRefs.push(...scan.broken);
      // 补全：resolvedLinks 可能漏掉指向缺失文件的引用
      brokenRefs.push(...scanUnresolvedBreaks(text, note, fileSet, basenameSet));
      // 从正文收集受管附件 basename（含 markdown 内嵌与 wiki 引用）
      for (const m of listMatches(text)) {
        if (/^(https?:|data:)/.test(m.linkText)) continue;
        if (m.linkText.endsWith('.md') || m.linkText.endsWith('.canvas')) continue;
        if (!isManagedAttachment(extOf(m.linkText))) continue;
        const base = basenameOf(m.linkText);
        let notes = usedByBasename.get(base);
        if (!notes) {
          notes = new Set<string>();
          usedByBasename.set(base, notes);
        }
        notes.add(note);
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
          if (!fileSet.has(target) && !basenameSet.has(base)) {
            brokenRefs.push({ sourcePath: note, kind: 'canvas', raw: target, linkText: target });
          }
        }
      }
      // frontmatter 断链：YAML 中引用但本地不存在的受管附件。
      for (const f of frontmatterBrokenRefs(text)) {
        if (fileSet.has(f.linkText)) continue;
        if (basenameSet.has(basenameOf(f.linkText))) continue;
        brokenRefs.push({ sourcePath: note, kind: 'frontmatter', raw: f.raw, linkText: f.linkText });
      }

      const noteLinks = resolved[note] ?? {};
      for (const [target] of Object.entries(noteLinks)) {
        if (target.endsWith('.md')) continue; // 笔记不算附件
        if (!fileSet.has(target)) {
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
      let references = usedTargets.get(f) ?? [];
      if (references.length === 0 && baseCount.get(base) === 1) {
        // Obsidian 尚未解析的短名嵌入：若 basename 唯一，则为其合成引用（提升规划确定性）
        const srcs = usedByBasename.get(base);
        if (srcs) {
          references = Array.from(srcs).map((sourcePath) => ({
            sourcePath,
            kind: 'embed' as const,
            raw: base,
            linkText: f,
            status: 'resolved' as const,
          }));
        }
      }
      entries.set(f, { path: f, category: categoryFromExt(extOf(f)), mime: '', animated: false, size: 0, mtime: 0, references });
      if (references.length === 0 && !usedByBasename.has(base)) orphanCandidates.push(f);
    }

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

/** 取路径的文件名部分。 */
function basenameOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
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