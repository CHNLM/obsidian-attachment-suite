/** 未用清理 · 纯计算（不依赖 obsidian，可脱离 App 单测）。 */

export interface CleanupPlan {
  /** 将删除的附件路径。 */
  toDelete: string[];
  /** 因排除目录而保留的附件路径。 */
  excluded: string[];
}

/** 判断路径是否命中排除目录。 */
export function shouldExclude(
  path: string,
  excludedFolders: string[],
  excludeSubfolders: boolean,
): boolean {
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
): CleanupPlan {
  const toDelete: string[] = [];
  const excluded: string[] = [];
  for (const path of orphanCandidates) {
    if (shouldExclude(path, excludedFolders, excludeSubfolders)) {
      excluded.push(path);
    } else {
      toDelete.push(path);
    }
  }
  return { toDelete, excluded };
}