/** 全库本地化（执行层）：批量下载全库笔记外链到本地。 */

import { type App } from 'obsidian';
import type { AttachmentIndex } from '../core';
import type { PluginSettings } from '../settings';
import { createNoticer, reportFailures, reportProgress } from '../notify';
import { logger } from '../logger';
import { ConfirmChangesModal, ReportModal, type ConfirmChangeRow } from '../modals';
import { revealRefInNote } from '../reveal-ref';
import { isPathExcluded } from '../core';
import {
  evaluateHostPolicy,
  findExternalRefs,
  hostPolicyOf,
  runLocalizeNote,
  type HostDenyReason,
  type MediaDownloader,
} from './localize-media';

export interface BulkLocalizeSummary {
  notes: number;
  downloaded: number;
  skipped: number;
  errors: number;
}

/** 被域名名单 / 内网拦截的一条引用（用于确认前的可查看清单）。 */
interface BlockedRef {
  notePath: string;
  noteName: string;
  url: string;
  reason: HostDenyReason;
}

/** 拦截原因的中文标签。 */
function reasonLabel(reason: HostDenyReason): string {
  switch (reason) {
    case 'deny-list':
      return '域名黑名单';
    case 'private-host':
      return '内网/本机地址';
    default:
      return '不在白名单';
  }
}

/** 把被拦截项转成弹窗行：URL → 来源笔记，可点击定位到笔记中的该引用。 */
function blockedRows(app: App, blocked: readonly BlockedRef[]): ConfirmChangeRow[] {
  return blocked.map((b) => ({
    reason: reasonLabel(b.reason),
    from: b.url,
    to: b.noteName,
    onClick: () => void revealRefInNote(app, b.notePath, b.url),
  }));
}

/**
 * 全库本地化：遍历全库 markdown 笔记，把 http/data 外链下载到本地附件目录并改写为本地引用。
 *
 * - 为何只处理 md：canvas 中的外链以 JSON url 节点存储，`findExternalRefs` 抓不到，扫描无益。
 * - 为何不进 TaskQueue（R3）：确认弹窗为同步 Promise，入队会在用户确认前挂起队列；
 *   本函数在 bulk 层内串行执行，与自动化的竞争由幂等兜底。
 */
export async function runBulkLocalize(
  app: App,
  index: AttachmentIndex,
  getSettings: () => PluginSettings,
  downloader: MediaDownloader,
  confirm = true,
): Promise<BulkLocalizeSummary> {
  const toast = createNoticer(() => getSettings().notificationLevel);
  const localize = getSettings().localize;
  if (!localize.enabled) {
    toast.summary('本地化能力已关闭。');
    return { notes: 0, downloaded: 0, skipped: 0, errors: 0 };
  }

  const exclude = getSettings().paths?.exclude ?? [];
  const scanHtml = localize.scanHtmlAndLinks ?? false;
  const policy = hostPolicyOf(localize);
  // 遍历 markdown 笔记（用 getFiles 过滤，兼容 Obsidian stub 无 getMarkdownFiles）。
  const notes = app.vault.getFiles().filter((f) => f.extension === 'md' && !isPathExcluded(f.path, exclude));

  // 预览：轻量扫描统计每篇外链数（「笔记 → N 个外链」）；实际下载数可能因尝试失败/类别过滤少于该值。
  // 命中域名名单（黑名单/仅白名单）或内网拦截的引用不会下载，故不计入预览数，
  // 但**逐条记录**下来供用户在确认前查看/定位（避免「只知道数字、不知道拦了什么」）。
  //
  // 「本地化网络 URL」关闭时 http 引用**根本不会被处理**（`runLocalizeNote` 只保留内嵌 data 图片）。
  // 预览必须与执行同一口径：把它们算成"可下载外链"就是一次不会兑现的承诺——
  // 用户确认后只会看到「下载 0」，与本仓库反复出现的「承诺了却不生效」同一形态。
  const localizeWeb = localize.localizeWebUrls !== false;
  const preview: Array<{ path: string; name: string; count: number }> = [];
  const blocked: BlockedRef[] = [];
  let totalExternal = 0;
  let disabledHttp = 0;
  for (const note of notes) {
    let count = 0;
    try {
      const text = await app.vault.read(note);
      const found = findExternalRefs(text, scanHtml);
      for (const r of found) {
        if (r.kind !== 'http') {
          count++;
          continue;
        }
        if (!localizeWeb) {
          // 不是"被拦截"，只是按设置不处理：不计入可下载数，也不进拦截清单
          disabledHttp++;
          continue;
        }
        const verdict = evaluateHostPolicy(r.url, policy);
        if (verdict.allowed) {
          count++;
        } else {
          blocked.push({
            notePath: note.path,
            noteName: note.basename,
            url: r.url,
            reason: verdict.reason ?? 'not-allowlisted',
          });
        }
      }
    } catch (e) {
      logger.error(`全库本地化预览读取失败 ${note.path}: ${e instanceof Error ? e.message : String(e)}`);
      count = 0;
    }
    if (count > 0) {
      preview.push({ path: note.path, name: note.basename, count });
      totalExternal += count;
    }
  }

  if (totalExternal === 0) {
    // 无可下载项但有被拦截项时：打开只读清单，让用户能看清「为什么一个都没下」并逐条定位。
    if (blocked.length > 0) {
      new ReportModal(app, {
        title: '本地化全库外部媒体 — 无可下载外链',
        summary: `未发现可下载的外链；另有 ${blocked.length} 个被拦截（域名名单 / 内网），不会下载。`,
        // 弹窗内的提示也受「通知级别」约束（成功＝结果，静默档不弹；失败＝错误，任何档位都弹）
        getNotificationLevel: () => getSettings().notificationLevel,
        sections: [
          {
            title: '被拦截的引用（点击定位到笔记）',
            count: blocked.length,
            items: blocked.map((b) => ({
              text: `${reasonLabel(b.reason)} · ${b.url} · ${b.noteName}`,
              onClick: () => void revealRefInNote(app, b.notePath, b.url),
            })),
            emptyText: '无被拦截的引用',
          },
        ],
      }).open();
    } else if (disabledHttp > 0) {
      // 有外链、但按设置不处理：必须说清原因，否则会被当成"功能没生效"
      toast.summary(
        `已关闭「本地化网络 URL」：库内有 ${disabledHttp} 个 http 外链按设置不处理（未做任何改动）。如需下载，请先在设置「本地化」中开启该项。`,
      );
    } else {
      toast.summary('全库没有可本地化的外部引用。');
    }
    return { notes: 0, downloaded: 0, skipped: 0, errors: 0 };
  }

  const execute = async (): Promise<BulkLocalizeSummary> => {
    let downloaded = 0;
    let skipped = 0;
    let errors = 0;
    let done = 0;
    for (const p of preview) {
      try {
        // notify=false 交由本函数统一汇总；runLocalizeNote 内部按引用项跳过失败。
        const r = await runLocalizeNote(app, index, getSettings, downloader, p.path, false);
        downloaded += r.downloaded;
        skipped += r.skipped;
        errors += r.errors;
      } catch (e) {
        logger.error(`全库本地化单篇失败 ${p.path}: ${e instanceof Error ? e.message : String(e)}`);
        errors++;
      }
      reportProgress(toast, ++done, preview.length, '全库本地化');
    }
    index.markDirty();
    toast.summary(`全库本地化完成：下载 ${downloaded}，跳过 ${skipped}，失败 ${errors}。`);
    reportFailures(toast, errors, '全库本地化');
    return { notes: preview.length, downloaded, skipped, errors };
  };

  if (confirm) {
    const blockedNote = blocked.length > 0
      ? `另有 ${blocked.length} 个外链将被拦截（见下方清单，不会下载）。`
      : '';
    // 未处理的 http 引用要如实说明，否则"扫描了 N 篇、怎么只下了这么点"无从解释
    const disabledNote = disabledHttp > 0
      ? `另有 ${disabledHttp} 个 http 外链因「本地化网络 URL」关闭而不处理。`
      : '';
    new ConfirmChangesModal(app, {
      title: '本地化全库外部媒体',
      desc: `将扫描全库 ${preview.length} 篇笔记（可下载外链 ${totalExternal} 个），下载到附件目录并改写为本地引用；量大会耗时。排除目录已跳过。${blockedNote}${disabledNote}`,
      rows: preview.map((p) => ({ from: p.name, to: `${p.count} 个外链` })),
      blocked: blocked.length > 0
        ? { title: `将被拦截的引用（${blocked.length} 个，点击定位到笔记）`, items: blockedRows(app, blocked) }
        : undefined,
      confirmText: `确认本地化（${preview.length} 篇）`,
      onConfirm: async () => {
        await execute();
      },
    }).open();
    return { notes: 0, downloaded: 0, skipped: 0, errors: 0 };
  }

  return execute();
}