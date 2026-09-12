/** 清理空附件目录 · 纯计算（不依赖 obsidian，可单测）。 */

/**
 * 找出"叶子级空目录"：既没有任何文件、也没有任意子目录的直接子级。
 * 删除叶子空目录后，其父目录若变空需再次运行本命令清理。
 */
export function planEmptyFolderCleanup(files: string[], folders: string[]): string[] {
  const out: string[] = [];
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
    if (!hasSub) out.push(folder);
  }
  return out;
}