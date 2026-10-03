/** 收集全库散落附件（执行层）。纯规划见 bulk-collect-core。 */

import { type App } from 'obsidian';
import { isPathExcluded, refMapForMoves, type AttachmentIndex, type SafeMoveEngine } from '../core';
import type { PluginSettings } from '../settings';
import { createNoticer, reportFailures, reportProgress } from '../notify';
import { ConfirmChangesModal } from '../modals';
import { logger } from '../logger';
import { resolveAttachmentDirForNote, rewriteRefsInNote } from '../obsidian-domain';
import { planBulkCollect, type BulkCollectPlan } from './bulk-collect-core';

export * from './bulk-collect-core';

export interface BulkCollectSummary {
  notes: number;
  moved: number;
  errors: number;
  skippedShared: number;
}

/**
 * 收集全库散落附件：把各笔记引用的、却不在其归属目录的**独占**附件移到归属目录；
 * 被多篇笔记共用的附件跳过。`confirm=true` 时先弹预览确认。
 *
 * 与全库命名一致：只构建一次快照，逐篇按归属笔记分组收集；通知收敛为单条汇总，
 * 不逐篇刷屏；被移动附件仅被单篇引用，故只改写该篇笔记正文与 frontmatter 引用即可。
 */
export async function runBulkCollect(
  app: App,
  index: AttachmentIndex,
  getSettings: () => PluginSettings,
  mover: SafeMoveEngine,
  confirm = true,
): Promise<BulkCollectSummary> {
  const toast = createNoticer(() => getSettings().notificationLevel);

  // 构建一次快照 + 枚举受管文本文件（md + canvas），过滤排除目录。
  const snapshot = await index.getSnapshot();
  const exclude = getSettings().paths?.exclude ?? [];
  const notes = app.vault.getFiles().filter((f) => f.extension === 'md' || f.extension === 'canvas');

  // 逐篇结算归属附件目录（排除目录的笔记不参与，其散落附件不处理）。
  const targetDirs = new Map<string, string>();
  for (const f of notes) {
    if (isPathExcluded(f.path, exclude)) continue;
    targetDirs.set(f.path, resolveAttachmentDirForNote(app, getSettings(), f));
  }

  const plan = planBulkCollect(snapshot.entries.values(), targetDirs);
  logger.debug(
    `全库收集计划：笔记 ${plan.perNote.size} 篇，待移动 ${plan.total}，跳过共享 ${plan.skippedShared}（扫描笔记 ${targetDirs.size} 篇）`,
  );
  if (plan.total === 0) {
    toast.summary('全库没有需要收集的散落附件。');
    return { notes: 0, moved: 0, errors: 0, skippedShared: plan.skippedShared };
  }

  const execute = async (): Promise<BulkCollectSummary> => {
    let moved = 0;
    let errors = 0;
    let done = 0;
    // 失败原因必须逐条带出去：提示承诺"详情见开发者控制台"。
    // 早期这里是 `errors += out.errors.length` —— 数完就把 `MoveError` 丢了，
    // 于是"全库收集失败 10 项"在控制台里查不到任何原因（2026-09-28 真实宿主实测）。
    const errorDetails: string[] = [];
    // 串行逐篇执行：每篇的附件都是独占引用，安全地边移边改写该篇链接。
    for (const [notePath, np] of plan.perNote) {
      try {
        const out = await mover.moveMany(np.items.map((i) => ({ from: i.from, to: i.to })));
        // 兜底改写该笔记正文与 frontmatter 引用（含 Obsidian 对当前打开笔记播放的嵌入）
        await rewriteRefsInNote(app, notePath, refMapForMoves(out.results));
        moved += out.results.length;
        errors += out.errors.length;
        for (const e of out.errors) errorDetails.push(`${notePath}：${e.from} → ${e.to}：${e.message}`);
      } catch (e) {
        errors++;
        errorDetails.push(`${notePath}：${e instanceof Error ? e.message : String(e)}`);
      }
      reportProgress(toast, ++done, plan.perNote.size, '全库收集');
    }
    index.markDirty();
    const sharedNote = plan.skippedShared ? `，跳过共享附件 ${plan.skippedShared}` : '';
    toast.summary(`全库收集完成：移动 ${moved}，失败 ${errors}${sharedNote}。`);
    reportFailures(toast, errors, '全库收集', errorDetails);
    return { notes: plan.perNote.size, moved, errors, skippedShared: plan.skippedShared };
  };

  if (confirm) {
    new ConfirmChangesModal(app, {
      title: '收集全库散落附件',
      desc: '将把各笔记引用的、却不在其归属目录的「独占」附件移到归属附件目录；被多篇笔记共用的附件跳过。排除目录已跳过。',
      rows: bulkRows(plan),
      confirmText: `确认收集（${plan.total} 个附件）`,
      onConfirm: async () => {
        await execute();
      },
    }).open();
    return { notes: 0, moved: 0, errors: 0, skippedShared: plan.skippedShared };
  }

  return execute();
}

/** 生成确认弹窗行：量小时逐条 from→to；量大时按笔记折叠为摘要。 */
function bulkRows(plan: BulkCollectPlan): Array<{ from: string; to: string; reason?: string }> {
  const noteCount = plan.perNote.size;
  if (plan.total <= 20 && noteCount <= 5) {
    const rows: Array<{ from: string; to: string }> = [];
    for (const np of plan.perNote.values()) {
      for (const it of np.items) rows.push({ from: it.from, to: it.to });
    }
    return rows;
  }
  return Array.from(plan.perNote.values()).map((np) => ({ from: np.noteName, to: `${np.items.length} 个附件` }));
}