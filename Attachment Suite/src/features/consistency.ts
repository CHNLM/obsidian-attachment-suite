/** 一致性：路径修复。执行入口；纯计算见 consistency-core。 */

import { type App } from 'obsidian';
import type { AttachmentIndex, SafeMoveEngine } from '../core';
import type { PluginSettings } from '../settings';
import { createNoticer, reportFailures } from '../notify';
import { rewriteRefsInAllNotes, rewriteRefsSafely } from '../obsidian-domain';
import { ConfirmChangesModal } from '../modals';
import { profileFromPlatforms, planPathFixes } from './consistency-core';

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

  // 让"确认弹窗"与"静默执行"两条路径共用同一份真实结果。
  // 早先静默路径返回的是 `errors: 0` 硬编码——即便改名失败也会报告零错误，
  // 调用方据此判断"一切正常"，与本仓库"失败必须可见"的承诺相悖。
  let lastResult: RunSummary = { fixed: 0, errors: 0 };

  const execute = async (): Promise<void> => {
    const out = await mover.moveMany(items.map((i) => ({ from: i.from, to: i.to })));
    // 兜底：路径修复可能影响任意笔记，跨库改写一遍（幂等，仅改仍含旧引用的）
    const rewriteErr = await rewriteRefsSafely(() => rewriteRefsInAllNotes(app, out.results));
    index.markDirty();
    lastResult = { fixed: out.results.length, errors: out.errors.length };
    toast.summary(`路径修复：成功 ${out.results.length}，失败 ${out.errors.length}。`);
    reportFailures(
      toast,
      out.errors.length,
      '路径修复',
      out.errors.map((e) => `${e.from} → ${e.to}：${e.message}`),
    );
    // 这一步失败最危险：文件已经改名/移动，引用却还指向旧路径 → 必须明确告知并给出下一步
    if (rewriteErr) {
      toast.error(
        `路径已改名 ${out.results.length} 个，但引用改写未完成（${rewriteErr}）。相关笔记的链接可能仍指向旧路径，请运行「修复断链」处理。`,
      );
    }
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
  return lastResult;
}