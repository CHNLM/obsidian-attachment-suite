/** 收集散落附件 · 纯计算（不依赖 obsidian，可单测）。 */

import type { AttachmentEntry } from '../core';

export interface CollectItem {
  from: string;
  to: string;
}

/**
 * 把"被当前笔记引用、却落在其它目录"的附件，规划移动到笔记的归属附件目录。
 * 已在目标目录内的跳过；同名冲突交由 SafeMoveEngine 避让。
 */
export function planCollect(
  entries: Iterable<AttachmentEntry>,
  notePath: string,
  targetDir: string,
): CollectItem[] {
  const out: CollectItem[] = [];
  for (const e of entries) {
    if (!e.references.some((r) => r.sourcePath === notePath)) continue;
    const slash = e.path.lastIndexOf('/');
    const dir = slash >= 0 ? e.path.slice(0, slash) : '';
    if (dir === targetDir) continue;
    const filename = slash >= 0 ? e.path.slice(slash + 1) : e.path;
    const to = targetDir ? `${targetDir}/${filename}` : filename;
    if (to === e.path) continue;
    out.push({ from: e.path, to });
  }
  return out;
}