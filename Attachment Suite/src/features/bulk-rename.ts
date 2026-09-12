/** 全库统一命名（执行层）。纯规划见 bulk-rename-core。 */

import { type App } from 'obsidian';
import type { AttachmentIndex, SafeMoveEngine } from '../core';
import type { PluginSettings } from '../settings';
import { createNoticer } from '../notify';
import { logger } from '../logger';
import { ConfirmChangesModal } from '../modals';
import { isPathExcluded } from '../core';
import { planBulkRename } from './bulk-rename-core';
import { runRenameNote } from './name-formatter';

export * from './bulk-rename-core';

export interface BulkRenameSummary {
  notes: number;
  renamed: number;
  copied: number;
  errors: number;
}

/**
 * 全库统一命名：遍历全库受管文本文件（md + canvas），按「笔记_类别_序号」批量重命名所有被引用附件。
 * `confirm=true` 时先弹预览确认。
 *
 * 并发/重入说明（R3）：手动命令不进入 main.ts 的 TaskQueue——确认弹窗为同步 Promise，
 * 若在弹窗前入队会让队列挂起直至用户确认、阻塞其它命令。因此本函数在 bulk 层内用
 * `for...await` 串行逐篇执行；与自动化 sweep 的极小竞争窗口由两侧幂等（checkAlreadyRenamed /
 * adapter.exists）兜底，保证数据不被损坏。
 */
export async function runBulkRename(
  app: App,
  index: AttachmentIndex,
  getSettings: () => PluginSettings,
  mover: SafeMoveEngine,
  confirm = true,
): Promise<BulkRenameSummary> {
  const toast = createNoticer(() => getSettings().notificationLevel);
  const naming = getSettings().naming;
  if (!naming.enabled) {
    toast.summary('命名能力已关闭。');
    return { notes: 0, renamed: 0, copied: 0, errors: 0 };
  }

  // R1：只构建一次快照，注入全部笔记复用，避免逐篇重建全库索引。
  const snapshot = await index.getSnapshot();

  // 枚举受管文本文件（md + canvas，与 rewriteRefsInAllNotes 一致），过滤排除目录。
  const exclude = getSettings().paths?.exclude ?? [];
  const notes = app.vault
    .getFiles()
    .filter((f) => f.extension === 'md' || f.extension === 'canvas')
    .filter((f) => !isPathExcluded(f.path, exclude))
    .map((f) => f.path);

  const plan = planBulkRename(snapshot, naming);
  // 过滤排除目录笔记的条目：预览与总数只统计实际执行范围（执行层逐篇过滤一致），
  // 避免预览展示将被跳过的附件，以及"全部引用都来自排除目录"时仍弹确认框。
  const included = new Set(notes);
  for (const key of Array.from(plan.perNote.keys())) {
    if (!included.has(key)) plan.perNote.delete(key);
  }
  plan.total = Array.from(plan.perNote.values()).reduce((s, np) => s + np.items.length, 0);
  if (plan.total === 0) {
    toast.summary('全库没有需要重命名的附件。');
    return { notes: 0, renamed: 0, copied: 0, errors: 0 };
  }

  const execute = async (): Promise<BulkRenameSummary> => {
    let renamed = 0;
    let copied = 0;
    let errors = 0;
    for (const path of notes) {
      try {
        // confirm=false 逐篇静默执行（不弹预览、不逐篇通知），注入同一快照。
        const r = await runRenameNote(app, index, getSettings, mover, false, path, snapshot, false);
        renamed += r.moved;
        copied += r.copied ?? 0;
        errors += r.errors;
      } catch (e) {
        logger.error(`全库命名单篇失败 ${path}: ${e instanceof Error ? e.message : String(e)}`);
        errors++;
      }
    }
    index.markDirty();
    toast.summary(`全库命名完成：重命名 ${renamed}，复制 ${copied}，失败 ${errors}。`);
    return { notes: notes.length, renamed, copied, errors };
  };

  if (confirm) {
    new ConfirmChangesModal(app, {
      title: '重命名全库附件',
      desc: `将以「笔记_类别_序号」规范重命名全库 ${notes.length} 篇笔记被引用的附件；被多篇笔记共用的附件为每篇引用笔记复制副本。排除目录已跳过。`,
      rows: bulkRows(plan),
      confirmText: `确认重命名（${notes.length} 篇 · ${plan.total} 个附件）`,
      onConfirm: async () => {
        await execute();
      },
    }).open();
    return { notes: 0, renamed: 0, copied: 0, errors: 0 };
  }

  return execute();
}

/** 生成确认弹窗行：量小时逐条 from→to；量大时按笔记折叠为摘要，保证可核对又不超长。 */
function bulkRows(plan: ReturnType<typeof planBulkRename>): Array<{ from: string; to: string; reason?: string }> {
  const noteCount = plan.perNote.size;
  const items = Array.from(plan.perNote.values());
  // 总附件数小（且笔记数小）时展开真实明细，便于逐条核对。
  if (plan.total <= 20 && noteCount <= 5) {
    const rows: Array<{ from: string; to: string }> = [];
    for (const np of items) {
      for (const it of np.items) rows.push({ from: it.from, to: it.to });
    }
    return rows;
  }
  // 量大时按笔记折叠：「笔记 → N 个附件」。
  return items.map((np) => ({ from: `${np.noteName}`, to: `${np.items.length} 个附件` }));
}