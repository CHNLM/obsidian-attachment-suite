/**
 * link-fixer.ts — 移动/重命名后的“链接兜底改写”。
 *
 * 背景：插件依赖 Obsidian 的 fileManager.renameFile 在改名时联动改写链接。但实测
 * 发现它对**当前处于打开/活动状态的笔记**往往不主动改写其正文中的嵌入引用，导致
 * 重命名附件后该笔记的链接变坏。这里在每次移动成功后做一次幂等兜底改写：仅当正文
 * 仍含旧引用时才替换，Obsidian 已改写过的（旧引用已不存在）自然跳过，不会重复处理。
 */
import { TFile, type App } from 'obsidian';
import { refMapForMoves, rewrite, rewriteFrontmatter } from './link-fixer-core';

export { refMapForMoves } from './link-fixer-core';

/** 改写单个笔记正文中命中的引用；有改动则写回并返回 true。 */
export async function rewriteRefsInNote(app: App, notePath: string, map: Map<string, string>): Promise<boolean> {
  if (map.size === 0) return false;
  const f = app.vault.getAbstractFileByPath(notePath);
  if (!(f instanceof TFile)) return false;
  const text = await app.vault.read(f);
  // 同时改写正文链接（rewrite）与 frontmatter 本地资源引用（rewriteFrontmatter），
  // 避免改名/移动/修复后 frontmatter 的 cover/banner/attachments 变成 dangling 引用。
  let next = rewrite(text, map);
  next = rewriteFrontmatter(next, map);
  if (next === text) return false;
  await app.vault.modify(f, next);
  return true;
}

/** 改写全库所有文本文件的引用（用于路径修复这类跨笔记场景）。返回改动笔记数。 */
export async function rewriteRefsInAllNotes(app: App, moves: Array<{ from: string; to: string }>): Promise<number> {
  const map = refMapForMoves(moves);
  if (map.size === 0) return 0;
  let changed = 0;
  const notes = app.vault.getFiles().filter((f) => f.extension === 'md' || f.extension === 'canvas');
  for (const n of notes) {
    if (await rewriteRefsInNote(app, n.path, map)) changed++;
  }
  return changed;
}