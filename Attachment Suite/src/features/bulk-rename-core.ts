/** 全库统一命名（纯计算）。执行层见 bulk-rename.ts。 */

import type { AttachmentIndexSnapshot } from '../core';
import type { NamingSettings } from '../settings';
import { planForSnapshot, type RenameItem } from './name-formatter-core';

export interface BulkRenameNotePlan {
  /** 归属笔记名（basename），供预览标签使用。 */
  noteName: string;
  /** 该笔记的待处理附件（真实 from→to）。 */
  items: RenameItem[];
}

export interface BulkRenamePlan {
  /** 按归属笔记路径分组的待命名计划。 */
  perNote: Map<string, BulkRenameNotePlan>;
  /** 被多篇笔记引用（将复制副本）的附件数量。 */
  sharedCount: number;
  /** 全部待处理项总数（预览与计数用）。 */
  total: number;
}

/**
 * 从快照规划「全库统一命名」计划（纯计算，可测）。
 *
 * 复用 `planForSnapshot` 为每篇归属笔记（出现在任一附件 references.sourcePath 的笔记）
 * 生成真实 from→to 明细。共享附件会对每篇引用笔记各生成一项 to —— 这正是执行层
 * `runRenameNote` "复制副本给每篇笔记" 的预览来源。
 *
 * @param folderByCategory 时以「附件原目录 + 类别」为目标（targetBaseDir 传空，
 *         由 planForSnapshot 回退到附件 ownDir，全库场景统一、合理）。
 */
export function planBulkRename(snapshot: AttachmentIndexSnapshot, naming: NamingSettings): BulkRenamePlan {
  // 1) 归属笔记集合：遍历所有被引用附件，收集其 references 的 sourcePath。
  const noteNames = new Map<string, string>();
  for (const e of snapshot.entries.values()) {
    for (const r of e.references) {
      if (!noteNames.has(r.sourcePath)) noteNames.set(r.sourcePath, noteNameOf(r.sourcePath));
    }
  }

  // 2) 统计被多篇引用（将复制副本）的附件数。
  const owners = new Map<string, Set<string>>();
  for (const e of snapshot.entries.values()) {
    if (e.references.length === 0) continue;
    const set = new Set<string>();
    for (const r of e.references) set.add(r.sourcePath);
    owners.set(e.path, set);
  }
  let sharedCount = 0;
  for (const set of owners.values()) if (set.size > 1) sharedCount++;

  // 3) 逐篇复用 planForSnapshot。
  const perNote = new Map<string, BulkRenameNotePlan>();
  let total = 0;
  for (const [notePath, noteName] of noteNames) {
    const items = planForSnapshot(snapshot, notePath, noteName, naming, naming.folderByCategory, '');
    if (items.length === 0) continue;
    perNote.set(notePath, { noteName, items });
    total += items.length;
  }

  return { perNote, sharedCount, total };
}

function basenameOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

/** 笔记名（去掉扩展名，与 note.basename 一致）。 */
function noteNameOf(path: string): string {
  const base = basenameOf(path);
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(0, i) : base;
}