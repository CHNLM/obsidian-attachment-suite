/** 未用清理 · 纯计算（不依赖 obsidian，可脱离 App 单测）。 */

import { isPathExcluded } from '../core';

export interface CleanupPlan {
  /** 将删除的附件路径。 */
  toDelete: string[];
  /** 因排除目录而保留的附件路径。 */
  excluded: string[];
}

/**
 * 判断路径是否命中排除目录。
 *
 * 两条名单的口径**故意不同**，因为它们表达的是两件不同的事：
 *
 * - `excludedFolders`（「清理」自己的排除名单）：由 `excludeSubfolders` 决定是否连带子目录。
 *   它回答的是"清理时哪些目录要跳过"，是清理专属的过滤条件。
 * - `recursiveExcludes`（全局排除目录 `paths.exclude`）：**整棵子树**豁免，
 *   不受 `excludeSubfolders` 影响。它回答的是"这块区域不要动"，是一条作用域声明。
 *
 * ⚠️ 为什么全局那条必须是整棵子树：`paths.exclude` 在其它入口（本地化、全库批量、导出、
 * 一致性报告）都按**前缀**解释。若只有清理按"仅列出目录本身"解释，子树里的孤儿就会
 * **既不出现在报告里（被前缀过滤掉）、又被清理删掉**——用户在报告里看不到它，
 * 却在清理时失去了它，正是本仓库反复栽过的"两层口径不一致"。
 */
export function shouldExclude(
  path: string,
  excludedFolders: string[],
  excludeSubfolders: boolean,
  recursiveExcludes: string[] = [],
): boolean {
  if (isPathExcluded(path, recursiveExcludes)) return true;
  if (!excludedFolders.length) return false;
  const slash = path.lastIndexOf('/');
  const parent = slash >= 0 ? path.slice(0, slash) : '';
  for (const raw of excludedFolders) {
    const norm = raw.trim().replace(/\/+$/, '');
    if (!norm) continue;
    if (excludeSubfolders) {
      if (parent === norm || parent.startsWith(`${norm}/`)) return true;
    } else if (parent === norm) {
      return true;
    }
  }
  return false;
}

/** 从孤儿候选生成清理计划（应用排除目录过滤）。 */
export function planCleanup(
  orphanCandidates: Iterable<string>,
  excludedFolders: string[],
  excludeSubfolders: boolean,
  recursiveExcludes: string[] = [],
): CleanupPlan {
  const toDelete: string[] = [];
  const excluded: string[] = [];
  for (const path of orphanCandidates) {
    if (shouldExclude(path, excludedFolders, excludeSubfolders, recursiveExcludes)) {
      excluded.push(path);
    } else {
      toDelete.push(path);
    }
  }
  return { toDelete, excluded };
}