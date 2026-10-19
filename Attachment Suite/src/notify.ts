/** 通知分级：让「通知级别」设置真正生效（静默 / 仅摘要 / 详细）。 */

import { Notice } from 'obsidian';
import { logger } from './logger';
import type { NotificationLevel } from './settings';
import { shouldNotify, effectiveDuration, type NotifyKind } from './notify-core';

export { shouldNotify, effectiveDuration, type NotifyKind } from './notify-core';

export interface Noticer {
  /** 关键错误，任何级别都提示（静默也不例外）。 */
  error(msg: string): void;
  /** 操作结果汇总（成功/失败/跳过…）。静默时隐藏。 */
  summary(msg: string): void;
  /** 更详细的过程信息。仅「详细」级别提示。 */
  info(msg: string): void;
}

/** 由当前通知级别构造通知器。 */
export function createNoticer(getLevel: () => NotificationLevel): Noticer {
  const show = (kind: NotifyKind, msg: string): void => {
    if (shouldNotify(getLevel(), kind)) new Notice(msg, effectiveDuration(kind, msg));
  };
  return {
    error: (m): void => show('error', m),
    summary: (m): void => show('summary', m),
    info: (m): void => show('info', m),
  };
}

/**
 * 长任务进度提示（`info` 级，只有「详细」档可见）。
 *
 * 用途有两点：① 让全库级操作在「详细」档下有进度感，不必盯着什么都不动的界面等；
 * ② 让设置里的「详细：显示更多过程信息」真正有内容可看——此前 `info` 通道一次都没被用过，
 * 那一档实际与「仅摘要」完全等价，属"承诺了却没实现"。
 *
 * 节流：步长取 `max(10, ceil(总数/10))`，即无论总数多大，一条长任务最多约 10 条进度提示，
 * 避免在「详细」档下刷屏。
 */
export function reportProgress(toast: Noticer, done: number, total: number, what: string): void {
  if (total <= 0) return;
  const step = Math.max(10, Math.ceil(total / 10));
  if (done !== total && done % step !== 0) return;
  toast.info(`${what}进行中：${done}/${total}…`);
}

/**
 * 只把失败明细写进日志，不发提示。
 *
 * 供**批量流程逐篇调用**：它们刻意逐篇静默（避免 N 条提示刷屏），汇总提示由上层统一发；
 * 但"逐篇静默"绝不能连日志一起静默——否则上层的「失败 N 项」在控制台里同样查不到原因。
 * （2026-09-28 实测：`runRenameNote` 在 `notify=false` 时整段明细都被跳过，
 * 于是「全库命名失败 N」在控制台里没有任何线索。）
 *
 * `details.length < count` 时补一条，把"有多少项拿不到原因"显式暴露出来。
 */
export function logFailures(what: string, count: number, details: string[]): void {
  if (count <= 0) return;
  for (const d of details) logger.error(`${what}失败：${d}`);
  if (details.length < count) {
    logger.error(`${what}失败 ${count} 项，其中 ${count - details.length} 项没有可用明细（原因在产生处被丢弃）`);
  }
}

/**
 * 出现失败项时补一条 error 级提示。
 *
 * 为什么不能只把"失败 N"写进 summary 文本：`shouldNotify('silent','summary')` 为 false，
 * 而破坏性命令（清理、改名、收集、修复、导出）过去一律把失败计数混在 summary 里报——
 * 于是用户在「静默」档下对失败一无所知，与 notify-core "错误任何级别都提示"的承诺直接相悖。
 * 失败是本插件最不能静默的信息：它意味着文件状态与用户预期不一致。
 *
 * @param what 动作名，用于拼出「XX失败 N 项」。
 * @param details 失败明细（逐条落 logger）。**不是可选装饰**：提示文案本身承诺了
 *   「详情见开发者控制台」——有明细就必须打印，否则那句承诺是空的。
 *   2026-09-28 真实宿主实测：`收集当前笔记附件` 报「失败 2 项」，控制台里却一条原因也没有
 *   （`MoveError.message` 被构造出来后直接丢弃）。
 *   传 `undefined` 表示调用方已自行逐条记录（如 broken-link 在循环里就 logger.error 了），
 *   此时不做"明细够不够"的判断——否则会误报。
 */
export function reportFailures(
  toast: Noticer,
  count: number,
  what: string,
  details?: string[],
): void {
  if (count <= 0) return;
  if (details) logFailures(what, count, details);
  toast.error(`${what}失败 ${count} 项。已完成的改动不会自动回滚，详情见开发者控制台（Ctrl/Cmd+Shift+I）。`);
}