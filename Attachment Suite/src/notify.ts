/** 通知分级：让「通知级别」设置真正生效（静默 / 仅摘要 / 详细）。 */

import { Notice } from 'obsidian';
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