/** 全库本地化（执行层）：批量下载全库笔记外链到本地。 */

import { type App } from 'obsidian';
import type { AttachmentIndex } from '../core';
import type { PluginSettings } from '../settings';
import { createNoticer } from '../notify';
import { logger } from '../logger';
import { ConfirmChangesModal } from '../modals';
import { isPathExcluded } from '../core';
import { findExternalRefs, runLocalizeNote, type MediaDownloader } from './localize-media';

export interface BulkLocalizeSummary {
  notes: number;
  downloaded: number;
  skipped: number;
  errors: number;
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
  // 遍历 markdown 笔记（用 getFiles 过滤，兼容 Obsidian stub 无 getMarkdownFiles）。
  const notes = app.vault.getFiles().filter((f) => f.extension === 'md' && !isPathExcluded(f.path, exclude));

  // 预览：轻量扫描统计每篇外链数（「笔记 → N 个外链」）；实际下载数可能因尝试失败/类别过滤少于该值。
  const preview: Array<{ path: string; name: string; count: number }> = [];
  let totalExternal = 0;
  for (const note of notes) {
    let count = 0;
    try {
      const text = await app.vault.read(note);
      count = findExternalRefs(text, scanHtml).length;
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
    toast.summary('全库没有可本地化的外部引用。');
    return { notes: 0, downloaded: 0, skipped: 0, errors: 0 };
  }

  const execute = async (): Promise<BulkLocalizeSummary> => {
    let downloaded = 0;
    let skipped = 0;
    let errors = 0;
    for (const p of preview) {
      try {
        // notify=false 交由本函数统一汇总；runLocalizeNote 内部按引用项跳过失败。
        const r = await runLocalizeNote(app, index, getSettings, downloader, p.path, undefined, false);
        downloaded += r.downloaded;
        skipped += r.skipped;
      } catch (e) {
        logger.error(`全库本地化单篇失败 ${p.path}: ${e instanceof Error ? e.message : String(e)}`);
        errors++;
      }
    }
    index.markDirty();
    toast.summary(`全库本地化完成：下载 ${downloaded}，跳过 ${skipped}，失败 ${errors}。`);
    return { notes: preview.length, downloaded, skipped, errors };
  };

  if (confirm) {
    new ConfirmChangesModal(app, {
      title: '本地化全库外部媒体',
      desc: `将扫描全库 ${preview.length} 篇笔记（共 ${totalExternal} 个外链），下载到附件目录并改写为本地引用；量大会耗时。排除目录已跳过。`,
      rows: preview.map((p) => ({ from: p.name, to: `${p.count} 个外链` })),
      confirmText: `确认本地化（${preview.length} 篇）`,
      onConfirm: async () => {
        await execute();
      },
    }).open();
    return { notes: 0, downloaded: 0, skipped: 0, errors: 0 };
  }

  return execute();
}