/** 收集散落附件 · 纯计算（不依赖 obsidian，可单测）。 */

import type { AttachmentEntry } from '../core';

export interface CollectItem {
  from: string;
  to: string;
}

/**
 * 该附件是否被多篇笔记共用（去重后 >1 个 sourcePath）。
 * 共用的附件**没有唯一归属**：移动它会改变其它笔记的落点。
 */
export function isSharedEntry(e: AttachmentEntry): boolean {
  if (e.references.length <= 1) return false;
  const owners = new Set<string>();
  for (const r of e.references) owners.add(r.sourcePath);
  return owners.size > 1;
}

/**
 * 把"被当前笔记引用、却落在其它目录"的附件，规划移动到笔记的归属附件目录。
 * 已在目标目录内的跳过；同名冲突交由 SafeMoveEngine 避让。
 *
 * **共享附件不移动**：与「收集全库散落附件」保持同一口径——被多篇笔记共用的附件不存在
 * 唯一归属，移动它虽然会联动改写链接，但会改变其它笔记的落点，属于"越权处置"。
 * 调用方应把跳过的数量如实告知用户（见 `planCollectDetailed`）。
 */
export function planCollect(entries: Iterable<AttachmentEntry>, notePath: string, targetDir: string): CollectItem[] {
  return planCollectDetailed(entries, notePath, targetDir).items;
}

/** 同 `planCollect`，额外给出"因被多篇笔记共用而跳过"的数量（供确认窗与汇总如实报告）。 */
export function planCollectDetailed(
  entries: Iterable<AttachmentEntry>,
  notePath: string,
  targetDir: string,
): { items: CollectItem[]; skippedShared: number } {
  const items: CollectItem[] = [];
  let skippedShared = 0;
  for (const e of entries) {
    if (!e.references.some((r) => r.sourcePath === notePath)) continue;
    if (isSharedEntry(e)) {
      skippedShared++;
      continue;
    }
    const slash = e.path.lastIndexOf('/');
    const dir = slash >= 0 ? e.path.slice(0, slash) : '';
    if (dir === targetDir) continue;
    const filename = slash >= 0 ? e.path.slice(slash + 1) : e.path;
    const to = targetDir ? `${targetDir}/${filename}` : filename;
    if (to === e.path) continue;
    items.push({ from: e.path, to });
  }
  return { items, skippedShared };
}