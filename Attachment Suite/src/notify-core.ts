/** 通知分级 · 纯计算（不依赖 obsidian，可脱离 App 单测）。 */

import type { NotificationLevel } from './settings';

export type NotifyKind = 'error' | 'summary' | 'info';

/** 依据通知级别决定某类通知是否弹出。 */
export function shouldNotify(level: NotificationLevel, kind: NotifyKind): boolean {
  switch (level) {
    case 'silent':
      return kind === 'error';
    case 'summary':
      return kind === 'error' || kind === 'summary';
    default: // verbose
      return true;
  }
}

/** 各通知级别的基础停留时长（毫秒）：错误最久，执行结果次之，过程信息最短。 */
export const BASE_DURATION: Record<NotifyKind, number> = {
  error: 5000,
  summary: 3000,
  info: 2000,
};

/** 横幅单行可容纳的字符数，用于估算换行数。 */
export const CHARS_PER_LINE = 40;
/** 单条消息每超出单行，额外增加的停留时长（毫秒），保证长结果读得完。 */
export const EXTRA_PER_LINE = 1000;

/** 计算某类通知的实际停留时长（毫秒）：消息越长（换行越多）停留越久。 */
export function effectiveDuration(kind: NotifyKind, msg: string): number {
  const base = BASE_DURATION[kind];
  const lines = Math.max(1, Math.ceil(msg.length / CHARS_PER_LINE));
  return base + (lines - 1) * EXTRA_PER_LINE;
}