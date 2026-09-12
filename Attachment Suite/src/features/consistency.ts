/** 一致性：路径修复。执行入口；纯计算见 consistency-core。 */

import { type App } from 'obsidian';
import type { AttachmentIndex, SafeMoveEngine } from '../core';
import type { PluginSettings } from '../settings';
import { createNoticer } from '../notify';
import { ConfirmChangesModal } from '../modals';
import { profileFromPlatforms, planPathFixes } from './consistency-core';
import { rewriteRefsInAllNotes } from './link-fixer';

export * from './consistency-core';

export interface RunSummary {
  fixed: number;
  errors: number;
}

/** 修复库内全部不兼容路径并执行。`confirm=true` 时先弹预览确认。 */
export async function runRepairPaths(
  app: App,
  index: AttachmentIndex,
  getSettings: () => PluginSettings,
  mover: SafeMoveEngine,
  confirm = true,
): Promise<RunSummary> {
  const toast = createNoticer(() => getSettings().notificationLevel);
  const consistency = getSettings().consistency;
  if (!consistency.enabled || !consistency.repairIncompatiblePaths) {
    toast.summary('路径修复能力已关闭。');
    return { fixed: 0, errors: 0 };
  }
  const snapshot = await index.getSnapshot();
  const items = planPathFixes(snapshot.entries.keys(), profileFromPlatforms(consistency.platforms));
  if (items.length === 0) {
    toast.summary('没有需要修复的路径。');
    return { fixed: 0, errors: 0 };
  }

  const execute = async (): Promise<void> => {
    const out = await mover.moveMany(items.map((i) => ({ from: i.from, to: i.to })));
    // 兜底：路径修复可能影响任意笔记，跨库改写一遍（幂等，仅改仍含旧引用的）
    await rewriteRefsInAllNotes(app, out.results);
    index.markDirty();
    toast.summary(`路径修复：成功 ${out.results.length}，失败 ${out.errors.length}。`);
  };

  if (confirm) {
    new ConfirmChangesModal(app, {
      title: '修复不兼容路径',
      desc: '以下路径在当前目标平台不受支持，将按平台规则安全改名，并自动更新引用链接。',
      rows: items.map((i) => ({ from: i.from, to: i.to })),
      confirmText: `确认修复（${items.length}）`,
      onConfirm: execute,
    }).open();
    return { fixed: 0, errors: 0 };
  }

  await execute();
  return { fixed: items.length, errors: 0 };
}