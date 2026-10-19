/** 笔记移动时跟随移动其相对型附件目录下的附件（**默认开启**，见 `ConsistencySettings.followNoteMove`；仅对笔记相对型目录生效）。 */

import { TFile, type App } from 'obsidian';
import {
  dirOf,
  isNoteRelativeFolder,
  refMapForMoves,
  resolveAttachmentDir,
  renderAttachmentFolderTemplate,
} from '../core';
import type { SafeMoveEngine } from '../core';
import type { PluginSettings } from '../settings';
import { effectiveAttachmentFolder, ensureFolder, rewriteRefsInNote } from '../obsidian-domain';
import { logger } from '../logger';
import { createNoticer } from '../notify';
import { attachmentTargetsFromText, planRelocation } from './note-relocator-core';

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

  // 先渲染模板（${notename}/${parent}/${parentpath}/${date}）再判定是否相对型目录
  const folder = renderAttachmentFolderTemplate(
    effectiveAttachmentFolder(app, getSettings()),
    file.basename,
    dirOf(notePath),
    new Date(),
  );
  if (!isNoteRelativeFolder(folder)) return;

  const oldParent = dirOf(oldPath);
  const newParent = dirOf(notePath);
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
  const toast = createNoticer(() => getSettings().notificationLevel);
  // 迁移失败**必须可见**：`moveMany` 是"逐项失败并继续"，过去这里只用了 results、
  // 把 errors 整个丢掉——用户看到的是"笔记已移动"，却不知道有几个附件根本没跟过来。
  // 故障方向是"附件留在原目录、引用也保持原样"（不会悬空），但沉默会让人以为搬全了。
  if (out.errors.length > 0) {
    for (const e of out.errors) {
      logger.warn(`笔记移动跟随：附件未能迁移 ${e.from} → ${e.to}：${e.message}`);
    }
    toast.error(
      `笔记已移动，但有 ${out.errors.length} 个附件未能跟随（仍在原目录）` +
        `。可手动移动后运行「修复断链」，或撤销本次笔记移动。`,
    );
  }
  // 兜底：确保迁移后的笔记正文里的附件引用指向新位置（幂等）。
  // 这一步失败时附件**已经搬走**，若只让异常冒到后台队列，用户看到的是笼统的"跟随失败"，
  // 不知道该去修哪篇笔记——所以就地转成可行动的提示（与「重命名」里的同类分支同口径）。
  try {
    await rewriteRefsInNote(app, notePath, refMapForMoves(out.results));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`笔记移动跟随：引用改写失败 ${notePath}: ${msg}`);
    toast.error(
      `附件已迁移，但「${notePath}」的引用改写未完成（${msg}）。请运行「修复断链」处理。`,
    );
  }
  logger.info(`笔记移动联动：迁移 ${out.results.length} 个附件 ${oldDir || '(根)'} → ${newDir || '(根)'}`);
}