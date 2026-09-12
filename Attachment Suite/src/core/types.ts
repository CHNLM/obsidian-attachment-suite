/** 共享类型与依赖注入接口。 */

import type { AttachmentCategory } from './type-classifier';

/** 附件被引用的位置种类。 */
export type ReferenceKind = 'embed' | 'link' | 'frontmatter' | 'canvas' | 'transclusion';

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

/** 文件系统读取接口：让 core 摆脱对 App 的依赖，便于桌面/移动/测试替换。 */
export interface VaultAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<ArrayBuffer>;
  readHead(path: string, maxBytes: number): Promise<Uint8Array>;
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

/** 从路径取扩展名（含点返回小写，无则空串）。 */
export function extOf(path: string): string {
  const idx = path.lastIndexOf('.');
  if (idx < 0) return '';
  return path.slice(idx + 1).toLowerCase();
}

/** 判断一个对象是否"看起来像笔记"（可进一步由 isNoteEx 排除 Excalidraw）。 */
export function isNoteText(path: string): boolean {
  return path.endsWith('.md') || path.endsWith('.canvas');
}