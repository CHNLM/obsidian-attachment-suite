/** 收集散落附件 · 纯计算（不依赖 obsidian，可单测）。 */

import { normalizeLocal, type AttachmentEntry } from '../core';

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
/**
 * 收集的实际落点目录：`folderByCategory` 开启时，在归属目录下追加**类别段**，
 * 与「重命名」按类别落盘的目录保持**同一口径**。
 *
 * 为什么必须同口径：两条命令都会跑。若这里不追加类别段，「收集」会把附件从
 * `<归属>/<类别>/` 搬回 `<归属>/`，而「重命名」又把它搬回去 —— 二者互相搬运，
 * **永不收敛**（真实宿主 `--variant naming-rich` 实测：每轮文件都在动，6 轮不收敛，
 * 且引用每轮被改写）。这个组合只在"按类别分目录"打开时才触发，故 harness 里一直没暴露。
 */
export function collectTargetDir(
  baseDir: string,
  ownDir: string,
  category: string,
  folderByCategory: boolean,
): string {
  if (!folderByCategory) return baseDir;
  // `baseDir` 为空串＝库根（**默认模式**）：此时与「重命名」的 `targetBaseDir || ownDir` 同口径，
  // 回退到附件的当前目录再分类别子目录。少了这个回退，"按类别分目录 + 默认库根"就会与
  // 「重命名」算出不同的落点，同样陷入互相搬运——这是同类缺陷的第二个实例，一并修掉。
  return normalizeLocal(`${baseDir || ownDir}/${category}`);
}

export function planCollect(
  entries: Iterable<AttachmentEntry>,
  notePath: string,
  targetDir: string,
  folderByCategory = false,
): CollectItem[] {
  return planCollectDetailed(entries, notePath, targetDir, folderByCategory).items;
}

/** 同 `planCollect`，额外给出"因被多篇笔记共用而跳过"的数量（供确认窗与汇总如实报告）。 */
export function planCollectDetailed(
  entries: Iterable<AttachmentEntry>,
  notePath: string,
  targetDir: string,
  folderByCategory = false,
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
    const wantDir = collectTargetDir(targetDir, dir, e.category, folderByCategory);
    if (dir === wantDir) continue;
    const filename = slash >= 0 ? e.path.slice(slash + 1) : e.path;
    const to = wantDir ? `${wantDir}/${filename}` : filename;
    if (to === e.path) continue;
    items.push({ from: e.path, to });
  }
  return { items, skippedShared };
}