/** 清理空附件目录 · 纯计算（不依赖 obsidian，可单测）。 */

import { isPathExcluded } from '../core';

/** 空目录清理计划：待删目录 + 命中排除目录而跳过的数量。 */
export interface EmptyFolderPlan {
  /** 待清理的叶子级空目录（已剔除排除目录）。 */
  toDelete: string[];
  /** 命中排除目录而跳过的空目录数（供通知与确认窗如实报告，避免"静默跳过"被当成 bug）。 */
  excluded: number;
}

/**
 * 找出"叶子级空目录"：既没有任何文件、也没有任意子目录的直接子级。
 * 删除叶子空目录后，其父目录若变空需再次运行本命令清理。
 *
 * @param excludes 排除目录（相对库根）。命中者不清理，**但仍留在 folders 里参与
 *   "是否有子目录"的判定**——若把被排除项从 folders 中剔除，它的父目录会被误判为
 *   空目录并删除，等于绕过了用户的排除意图。
 */
export function planEmptyFolderCleanup(files: string[], folders: string[], excludes: string[] = []): string[] {
  return planEmptyFolderCleanupDetailed(files, folders, excludes).toDelete;
}

/** 同 `planEmptyFolderCleanup`，额外给出「被排除跳过」的准确数量。 */
export function planEmptyFolderCleanupDetailed(
  files: string[],
  folders: string[],
  excludes: string[] = [],
): EmptyFolderPlan {
  const out: string[] = [];
  let excluded = 0;
  for (const folder of folders) {
    const prefix = `${folder}/`;
    let hasFile = false;
    let hasSub = false;
    for (const f of files) {
      if (f.startsWith(prefix)) {
        hasFile = true;
        break;
      }
    }
    if (hasFile) continue;
    for (const g of folders) {
      if (g !== folder && g.startsWith(prefix)) {
        hasSub = true;
        break;
      }
    }
    if (hasSub) continue;
    // 排除目录本身及其内部各级空目录一律不动（前缀命中）：空目录清理的价值低，
    // 越界删除排除目录内内容带来的意外感与不可控性更高，故取保守口径。
    if (excludes.length > 0 && isPathExcluded(folder, excludes)) {
      excluded++;
      continue;
    }
    out.push(folder);
  }
  return { toDelete: out, excluded };
}
