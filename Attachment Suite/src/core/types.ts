/** 共享类型与依赖注入接口。 */

import type { AttachmentCategory } from './type-classifier';

/** 附件被引用的位置种类。 */
export type ReferenceKind =
  | 'embed'
  | 'link'
  | 'frontmatter'
  | 'canvas'
  | 'transclusion'
  /** HTML 标签属性（<img src> 等）引用。 */
  | 'html'
  /** wiki 无扩展名（[[x]]）指向附件的引用。 */
  | 'wiki-attachment';

export interface Reference {
  /** 引用来源路径（笔记 / 画布）。 */
  sourcePath: string;
  kind: ReferenceKind;
  /** 原文片段，便于定位/写回。 */
  raw: string;
  /** 解析到的目标路径。 */
  linkText: string;
  status: 'resolved' | 'broken';
}

export interface AttachmentEntry {
  /** 物理路径。 */
  path: string;
  /** 真实类别（内容识别）。 */
  category: AttachmentCategory;
  mime: string;
  animated: boolean;
  size: number;
  mtime: number;
  references: Reference[];
}

export interface BrokenRef {
  sourcePath: string;
  kind: ReferenceKind;
  raw: string;
  linkText: string;
}

export interface AttachmentIndexSnapshot {
  entries: Map<string, AttachmentEntry>;
  brokenRefs: BrokenRef[];
  orphanCandidates: string[];
}

/**
 * 文件系统读取接口：让 core 摆脱对 App 的依赖，便于桌面/移动/测试替换。
 *
 * 只保留**实际被消费**的成员。此前还声明了 `exists` / `read` / `readHead`，但 core 内
 * 零调用（索引只需文件清单，取内容是经 `MetadataProvider.getFileText` 走的）。
 * 未被消费的接口成员是负债：实现方要写、替身要写、读者会以为有人在用。
 * `readHead` 尤其误导——它的 Obsidian 实现是"整文件读完再切片"，既没有省下 IO，
 * 又容易被当成"流式读取"来用（下载前体积预探实际走的是 HEAD 请求，见 localize-media.ts）。
 */
export interface VaultAdapter {
  listFiles(): Promise<string[]>;
}

/** 元数据/引用关系接口。 */
export interface MetadataProvider {
  /** md 文件路径 → 其引用目标。 */
  getResolvedLinks(): Record<string, Record<string, number>>;
  getFileText(path: string): Promise<string>;
}

/** 安全改名/移动的底层文件操作接口（SafeMoveEngine 依赖）。 */
export interface FileOps {
  /** 目标路径是否已存在。 */
  exists(path: string): Promise<boolean>;
  /** 将文件改名/移动到新路径（Obsidian 会联动改写链接）。 */
  rename(fromPath: string, toPath: string): Promise<void>;
}

export const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg',
]);
export const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv']);
export const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac']);
export const OTHER_ATTACHMENT_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'pptx']);

/** 全部受管附件扩展名（单一来源，供候选补全 / 白名单遍历）。 */
export const MANAGED_ATTACHMENT_EXTENSIONS: string[] = [
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...OTHER_ATTACHMENT_EXTENSIONS,
];

/**
 * 顶层合并：判断某一扩展名是否为"应被插件管理的附件"。
 */
export function isManagedAttachment(ext: string): boolean {
  const e = ext.toLowerCase();
  return (
    IMAGE_EXTENSIONS.has(e) ||
    VIDEO_EXTENSIONS.has(e) ||
    AUDIO_EXTENSIONS.has(e) ||
    OTHER_ATTACHMENT_EXTENSIONS.has(e)
  );
}

/** 取路径的文件名部分（最后一个 `/` 之后；无 `/` 时原样返回）。 */
export function basenameOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

/** 取路径的父目录（最后一个 `/` 之前；无 `/` 时为空串，表示库根）。 */
export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}

/**
 * 从路径取扩展名（小写，无扩展名返回空串）。
 *
 * **必须先取 basename 再找点**：早先的实现在整条路径上取 `lastIndexOf('.')`，于是
 * "目录名含点 + 文件名无扩展名"会返回垃圾串——`docs/v1.2/README` → `"2/readme"`、
 * `assets/a.png/file` → `"png/file"`。它当时没造成故障纯属侥幸（垃圾串喂
 * `isManagedAttachment` 恰好也是 false），但 `broken-link-core` 用 `!extOf(t)` 判定
 * "这是无扩展名的短名引用"（据此把 `pic` 扩展成 `pic.png`/`pic.jpg` 参与候选匹配），
 * 一旦拿到垃圾串就会**静默跳过**扩展——故此处按 basename 语义修正，与调用方预期一致。
 */
export function extOf(path: string): string {
  const base = basenameOf(path);
  const idx = base.lastIndexOf('.');
  if (idx < 0) return '';
  return base.slice(idx + 1).toLowerCase();
}

/** 判断一个对象是否"看起来像笔记"（可进一步由 isNoteEx 排除 Excalidraw）。 */
export function isNoteText(path: string): boolean {
  return path.endsWith('.md') || path.endsWith('.canvas');
}