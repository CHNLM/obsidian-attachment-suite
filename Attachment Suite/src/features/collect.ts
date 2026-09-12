/** 收集当前笔记的散落附件到归属目录。 */

import { TFile, type App } from 'obsidian';
import type { AttachmentIndex, SafeMoveEngine } from '../core';
import type { PluginSettings } from '../settings';
import { resolveAttachmentDirForNote } from '../obsidian-domain';
import { createNoticer } from '../notify';
import { ConfirmChangesModal } from '../modals';
import { planCollect } from './collect-core';
import { refMapForMoves, rewriteRefsInNote } from './link-fixer';

export * from './collect-core';

export interface RunSummary {
  moved: number;
  errors: number;
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
  const items = planCollect(snapshot.entries.values(), note.path, targetDir);
  if (items.length === 0) {
    toast.summary('当前笔记的附件都已在其归属目录。');
    return { moved: 0, errors: 0 };
  }

  const execute = async (): Promise<void> => {
    const out = await mover.moveMany(items.map((i) => ({ from: i.from, to: i.to })));
    // 兜底改写当前笔记的引用（含 frontmatter），确保落到新目录后指向正确
    await rewriteRefsInNote(app, note.path, refMapForMoves(out.results));
    index.markDirty();
    toast.summary(`收集完成：移动 ${out.results.length}，失败 ${out.errors.length}。`);
  };

  new ConfirmChangesModal(app, {
    title: '收集当前笔记附件',
    desc: `以下附件被当前笔记引用但不在归属目录 ${targetDir || '(库根)'}，将移入并按 Obsidian 更新引用链接。`,
    rows: items.map((i) => ({ from: i.from, to: i.to })),
    confirmText: `确认收集（${items.length}）`,
    onConfirm: execute,
  }).open();
  return { moved: 0, errors: 0 };
}