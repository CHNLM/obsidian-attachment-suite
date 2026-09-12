/** 笔记移动时跟随移动其相对型附件目录下的附件（默认关闭，见 ConsistencySettings.followNoteMove）。 */

import { TFile, type App } from 'obsidian';
import { isNoteRelativeFolder, resolveAttachmentDir, renderAttachmentFolderTemplate } from '../core';
import type { SafeMoveEngine } from '../core';
import type { PluginSettings } from '../settings';
import { effectiveAttachmentFolder, ensureFolder } from '../obsidian-domain';
import { logger } from '../logger';
import { attachmentTargetsFromText, parentOf, planRelocation } from './note-relocator-core';
import { refMapForMoves, rewriteRefsInNote } from './link-fixer';

export * from './note-relocator-core';

/**
 * 笔记移动（父目录变化）后，把其相对型附件目录下的对应附件以同样规则迁往新目录。
 * @param notePath 新路径。
 * @param oldPath 旧路径（rename 事件提供）。
 */
export async function runFollowNoteMove(
  app: App,
  mover: SafeMoveEngine,
  getSettings: () => PluginSettings,
  notePath: string,
  oldPath: string,
): Promise<void> {
  const consistency = getSettings().consistency;
  if (!consistency.enabled || !consistency.followNoteMove) return;

  const file = app.vault.getAbstractFileByPath(notePath);
  if (!(file instanceof TFile)) return;

  // 先渲染模板（${notename}/${parent}/${date}）再判定是否相对型目录
  const folder = renderAttachmentFolderTemplate(
    effectiveAttachmentFolder(app, getSettings()),
    file.basename,
    parentOf(notePath),
    new Date(),
  );
  if (!isNoteRelativeFolder(folder)) return;

  const oldParent = parentOf(oldPath);
  const newParent = parentOf(notePath);
  if (oldParent === newParent) return; // 仅改名，非移动

  const oldDir = resolveAttachmentDir(oldParent, folder);
  const newDir = resolveAttachmentDir(newParent, folder);
  if (oldDir === newDir) return;

  let text = '';
  try {
    text = await app.vault.read(file);
  } catch {
    return;
  }
  const targets = attachmentTargetsFromText(text);
  const moves = planRelocation(targets, oldDir, newDir);
  if (moves.length === 0) return;

  const movedMoves: typeof moves = [];
  for (const m of moves) {
    // 仅移动真实存在且确在旧目录中的文件，避免误伤他人附件
    if (await app.vault.adapter.exists(m.from)) movedMoves.push(m);
  }
  if (movedMoves.length === 0) return;

  // Obsidian 的 fileManager.renameFile 不会自动创建目标父目录，须先确保新附件目录存在
  await ensureFolder(app, newDir);

  const out = await mover.moveMany(movedMoves);
  // 兜底：确保迁移后的笔记正文里的附件引用指向新位置（幂等）
  await rewriteRefsInNote(app, notePath, refMapForMoves(out.results));
  logger.info(`笔记移动联动：迁移 ${out.results.length} 个附件 ${oldDir || '(根)'} → ${newDir || '(根)'}`);
}