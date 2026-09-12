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