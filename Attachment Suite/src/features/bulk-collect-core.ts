/** 收集全库散落附件 · 纯计算（不依赖 obsidian，可单测）。执行层见 bulk-collect.ts。 */

import type { AttachmentEntry } from '../core';
import { isSharedEntry, type CollectItem } from './collect-core';

export interface BulkCollectNotePlan {
  /** 归属笔记名（basename，去扩展名），供预览标签使用。 */
  noteName: string;
  /** 该笔记的待收集附件（真实 from→to）。 */
  items: CollectItem[];
}

export interface BulkCollectPlan {
  /** 按归属笔记路径分组的收集计划。 */
  perNote: Map<string, BulkCollectNotePlan>;
  /** 被多篇笔记共用而被跳过（不收集）的散落附件数。 */
  skippedShared: number;
  /** 全部待收集项总数（预览与计数用）。 */
  total: number;
}

/**
 * 从快照规划「收集全库散落附件」计划（纯计算，可测）。
 *
 * 语义（与"收集当前笔记附件"一致）：把被某篇笔记引用的、却落在该笔记归属附件目录之外的
 * 附件，移到该笔记的归属附件目录。为规避"一个附件名义上属于多篇笔记、目录互相冲突"，
 * 这里**只收集独占附件**（references 去重后仅一篇 sourcePath）；被多篇共用的附件跳过。
 *
 * @param targetDirs notePath → 该笔记的归属附件目录（执行层已解析并过滤排除目录）。
 */
export function planBulkCollect(
  entries: Iterable<AttachmentEntry>,
  targetDirs: ReadonlyMap<string, string>,
): BulkCollectPlan {
  const perNote = new Map<string, BulkCollectNotePlan>();
  let total = 0;
  let skippedShared = 0;
  for (const e of entries) {
    if (e.references.length === 0) continue;
    // 共享判定与「收集当前笔记附件」共用同一函数（isSharedEntry），保证两处口径一致
    if (isSharedEntry(e)) {
      skippedShared++;
      continue;
    }
    const owners = new Set<string>();
    for (const r of e.references) owners.add(r.sourcePath);
    const notePath = owners.values().next().value as string;
    const targetDir = targetDirs.get(notePath);
    if (targetDir === undefined) continue; // 归属笔记不在处理范围（如被排除目录过滤）
    const slash = e.path.lastIndexOf('/');
    const dir = slash >= 0 ? e.path.slice(0, slash) : '';
    if (dir === targetDir) continue; // 已在归属目录
    const filename = slash >= 0 ? e.path.slice(slash + 1) : e.path;
    const to = targetDir ? `${targetDir}/${filename}` : filename;
    if (to === e.path) continue;
    let np = perNote.get(notePath);
    if (!np) {
      np = { noteName: noteNameOf(notePath), items: [] };
      perNote.set(notePath, np);
    }
    np.items.push({ from: e.path, to });
    total++;
  }
  return { perNote, skippedShared, total };
}

/** 笔记名（去掉扩展名，与 note.basename 一致）。 */
function noteNameOf(path: string): string {
  const slash = path.lastIndexOf('/');
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}