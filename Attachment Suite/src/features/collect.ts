/** 收集当前笔记的散落附件到归属目录。 */

import { TFile, type App } from 'obsidian';
import { refMapForMoves, type AttachmentIndex, type SafeMoveEngine } from '../core';
import type { PluginSettings } from '../settings';
import { resolveAttachmentDirForNote, rewriteRefsInNote, rewriteRefsSafely } from '../obsidian-domain';
import { createNoticer, reportFailures } from '../notify';
import { ConfirmChangesModal } from '../modals';
import { logger } from '../logger';
import { planCollectDetailed } from './collect-core';

export * from './collect-core';

export interface RunSummary {
  moved: number;
  errors: number;
  /** 因被多篇笔记共用而跳过（不移动）的附件数。 */
  skippedShared?: number;
}

/**
 * 收集当前笔记被引用但落在其它目录的附件到归属目录。
 * @param notePath 显式指定笔记；省略回退当前打开的笔记。
 */
export async function runCollectNote(
  app: App,
  index: AttachmentIndex,
  getSettings: () => PluginSettings,
  mover: SafeMoveEngine,
  notePath?: string,
): Promise<RunSummary> {
  const toast = createNoticer(() => getSettings().notificationLevel);
  const note = notePath
    ? (app.vault.getAbstractFileByPath(notePath) as TFile | null)
    : (app.workspace.getActiveFile() as TFile | null);
  if (!note || !(note instanceof TFile)) {
    if (!notePath) toast.error('请先打开一个笔记。');
    return { moved: 0, errors: 0 };
  }
  const targetDir = resolveAttachmentDirForNote(app, getSettings(), note);
  const snapshot = await index.build();
  const { items, skippedShared } = planCollectDetailed(snapshot.entries.values(), note.path, targetDir);
  // 诊断：计划规模与去向。排查"计划基于过期快照"（真实宿主上表现为 ENOENT）时，
  // 这几行能直接看出"计划里有多少项、目标目录算成了什么"。
  logger.debug(`收集计划 @${note.path}：待移动 ${items.length}，跳过共享 ${skippedShared}，目标 ${targetDir || '(库根)'}`);
  for (const it of items) logger.debug(`  计划 ${it.from} → ${it.to}`);
  // 共享附件不移动（与全库收集同口径）：必须如实告知，避免"看起来没生效"
  const sharedNote = skippedShared > 0 ? `（另有 ${skippedShared} 个附件被多篇笔记共用，已跳过）` : '';
  if (items.length === 0) {
    toast.summary(
      skippedShared > 0
        ? `当前笔记没有可收集的附件${sharedNote}。`
        : '当前笔记的附件都已在其归属目录。',
    );
    return { moved: 0, errors: 0, skippedShared };
  }

  const execute = async (): Promise<void> => {
    const out = await mover.moveMany(items.map((i) => ({ from: i.from, to: i.to })));
    // 兜底改写当前笔记的引用（含 frontmatter），确保落到新目录后指向正确。
    // 失败不冒泡：文件已经移动完了，必须让用户知道"移动成功但引用没跟上"。
    const rewriteErr = await rewriteRefsSafely(() => rewriteRefsInNote(app, note.path, refMapForMoves(out.results)));
    index.markDirty();
    toast.summary(`收集完成：移动 ${out.results.length}，失败 ${out.errors.length}${sharedNote}。`);
    reportFailures(
      toast,
      out.errors.length,
      '收集',
      // 明细必须给：`MoveError.message` 里才有"源文件不存在/改名失败"这类可行动的原因
      out.errors.map((e) => `${e.from} → ${e.to}：${e.message}`),
    );
    if (rewriteErr) {
      toast.error(
        `附件已移动，但「${note.path}」的引用改写未完成（${rewriteErr}）。该笔记的链接可能仍指向旧路径，请运行「修复断链」处理。`,
      );
    }
  };

  new ConfirmChangesModal(app, {
    title: '收集当前笔记附件',
    desc: `以下附件被当前笔记引用但不在归属目录 ${targetDir || '(库根)'}，将移入并按 Obsidian 更新引用链接。${sharedNote}`,
    rows: items.map((i) => ({ from: i.from, to: i.to })),
    confirmText: `确认收集（${items.length}）`,
    onConfirm: execute,
  }).open();
  return { moved: 0, errors: 0, skippedShared };
}