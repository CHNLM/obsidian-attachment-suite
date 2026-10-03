/** 自动化（自动处理）：笔记内容变更时，自动本地化 + 统一命名其附件。 */

import { type App, Notice } from 'obsidian';
import type { AttachmentIndex, SafeMoveEngine } from '../core';
import type { PluginSettings } from '../settings';
import type { MediaDownloader } from './localize-media';
import { runLocalizeNote } from './localize-media';
import { runRenameNote } from './name-formatter';
import { shouldNotify, effectiveDuration } from '../notify';
import { logger } from '../logger';

/** 忙锁：防止「自动处理」与它自身改写触发的事件重入（参照 ANF 的 renaming 忙锁）。 */
let autoBusy = false;

/** 是否正在执行自动处理（供事件层判断是否为“自身写入”，避免自我放大触发）。 */
export function isAutoBusy(): boolean {
  return autoBusy;
}

/**
 * 对指定笔记执行一次“自动处理”：
 * 0) 忙锁；按显式入参的 notePath 执行，不依赖“当前活动笔记”（运行时焦点切换不会中断）；
 * 1) 本地化当前仍存在的外链/data 图片（已本地化的 URL 已被替换，不会再处理）；
 * 2) 随后统一命名该笔记的附件（幂等，命名完再触发不会重复改名）。
 * 结束后若确有结果，在右上角弹出一条结果摘要通知。供后台轮询/粘贴事件调用。
 */
export async function runAutoProcess(
  app: App,
  index: AttachmentIndex,
  getSettings: () => PluginSettings,
  downloader: MediaDownloader,
  mover: SafeMoveEngine,
  notePath: string,
): Promise<{ downloaded: number; renamed: number }> {
  const s = getSettings();
  if (!s.automation?.enabled) return { downloaded: 0, renamed: 0 };
  if (!notePath) return { downloaded: 0, renamed: 0 };
  if (autoBusy) return { downloaded: 0, renamed: 0 };

  autoBusy = true;
  try {
    logger.debug(`自动处理开始：${notePath}`);
    // 自动化路径内收敛通知：让 runLocalizeNote 不再各自弹窗，由本函数统一汇总。
    const dl = await runLocalizeNote(app, index, getSettings, downloader, notePath, false);
    let renamed = 0;
    const namingEnabled = s.naming.enabled;
    if (namingEnabled) {
      // 第 8 参 notify=false：自动化路径不逐篇弹「没有需要重命名的附件」，
      // 通知统一由本函数（runAutoProcess）按汇总结果弹出，避免每篇冗余刷屏。
      const r = await runRenameNote(app, index, getSettings, mover, false, notePath, undefined, false);
      renamed = r.moved;
    }
    logger.debug(
      `自动处理结果 ${notePath}：找到 ${dl.found}，下载 ${dl.downloaded}，跳过 ${dl.skipped}` +
        `，拦截内网 ${dl.blockedPrivate}，拦截名单 ${dl.blockedByPolicy}` +
        `，网页不落存 ${dl.skippedWebpage}，非受管跳过 ${dl.skippedUnmanaged}，改名 ${renamed}`,
    );
    const show = (kind: 'summary' | 'error', msg: string): void => {
      if (shouldNotify(s.notificationLevel, kind)) {
        new Notice(`Attachment Suite\n${msg}`, effectiveDuration(kind, msg));
      }
    };
    const blocks = dl.blockedPrivate + dl.blockedByPolicy;
    const blockDetail: string[] = [];
    if (dl.blockedPrivate > 0) blockDetail.push(`内网 ${dl.blockedPrivate}`);
    if (dl.blockedByPolicy > 0) blockDetail.push(`名单 ${dl.blockedByPolicy}`);
    if (dl.downloaded > 0 || renamed > 0) {
      const blockedNote = blocks > 0 ? `，拦截 ${blocks}` : '';
      const webpageNote = dl.skippedWebpage > 0 ? `，网页不落存 ${dl.skippedWebpage}` : '';
      const unmanagedNote = dl.skippedUnmanaged > 0 ? `，非受管类型跳过 ${dl.skippedUnmanaged}` : '';
      // 有实际结果才通知成功，避免打字/轮询时空白刷屏
      show('summary', `本地化：下载 ${dl.downloaded}，跳过 ${dl.skipped}${blockedNote}${webpageNote}${unmanagedNote}；自动命名：${renamed} 个附件`);
    } else if (blocks > 0) {
      // 外链被拦截 → 必须可见，否则会被误认为“没触发”
      show('error', `已拦截 ${blocks} 处外链（${blockDetail.join(' · ')}），未下载。可在设置「本地化」中调整域名名单或关闭「拦截内网与本机地址」。`);
    } else if (dl.skippedWebpage > 0) {
      // 命中的是网页文档：按设计不落存，须如实告知，避免被误认为“没触发”
      show('summary', `检测到 ${dl.skippedWebpage} 处网页文档引用，按设计不落存 HTML，已跳过。`);
    } else if (dl.skippedUnmanaged > 0) {
      // 命中的是白名单外类型：按设计不落存，须如实告知（否则会被误认为“没触发”）
      show('summary', `检测到 ${dl.skippedUnmanaged} 处非受管附件类型（如纯文本），按设计不落存，已跳过。`);
    } else if (dl.found > 0) {
      // 检测到外链但全部下载失败 → 必须可见，否则会被误认为“没触发”
      show('error', `检测到 ${dl.found} 处外部图片，但下载失败/被跳过（${dl.skipped}）。请检查网络或链接有效性。`);
    }
    return { downloaded: dl.downloaded, renamed };
  } catch (e) {
    // 关键：任何内部异常都必须可见，否则会被误判为“完全没触发”
    logger.error(`自动处理出错 ${notePath}：${e instanceof Error ? e.message : String(e)}`);
    if (shouldNotify(s.notificationLevel, 'error')) {
      new Notice(`Attachment Suite\n自动处理出错：${e instanceof Error ? e.message : String(e)}`, effectiveDuration('error', String(e instanceof Error ? e.message : e)));
    }
    return { downloaded: 0, renamed: 0 };
  } finally {
    autoBusy = false;
  }
}