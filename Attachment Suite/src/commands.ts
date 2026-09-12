import { type App, Notice } from 'obsidian';
import type { AttachmentIndex, SafeMoveEngine } from './core';
import type { PluginSettings } from './settings';
import { logger } from './logger';
import { createNoticer } from './notify';
import { runRenameNote } from './features/name-formatter';
import { runRepairPaths, planPathFixes, profileFromPlatforms } from './features/consistency';
import { runLocalizeNote, type MediaDownloader } from './features/localize-media';
import { runCollectNote } from './features/collect';
import { runCleanupUnused } from './features/unused-cleaner';
import { runCleanupEmptyFolders } from './features/empty-folder-cleaner';
import { runExportNote, runExportOrphaned } from './features/exporter';
import { runBulkRename } from './features/bulk-rename';
import { runBulkLocalize } from './features/bulk-localize';
import { ReportModal } from './modals';

export interface CommandContext {
  app: App;
  index: AttachmentIndex;
  mover: SafeMoveEngine;
  downloader: MediaDownloader;
  getSettings: () => PluginSettings;
}

export interface CommandDef {
  id: string;
  name: string;
  callback: () => void | Promise<void>;
}

/** 调试：给手动命令加"开始/结束"控制台日志 + 右上角横幅，便于直观查看运行链路与耗时。 */
async function traceCommand(name: string, fn: () => void | Promise<unknown>): Promise<void> {
  const t0 = Date.now();
  console.log(`[AttachmentSuite] cmd START: ${name} (${t0})`);
  new Notice(`Attachment Suite\n执行命令：${name}`, 2000);
  try {
    await fn();
  } finally {
    console.log(`[AttachmentSuite] cmd done: ${name} (${Date.now() - t0}ms)`);
  }
}

/** 登记全部命令。 */
export function createCommands(ctx: CommandContext): CommandDef[] {
  return [
    {
      id: 'attachment:check-consistency',
      name: '检查库一致性（生成报告）',
      callback: async () => {
        await traceCommand('一致性审计', async () => {
          const consistency = ctx.getSettings().consistency;
          const toast = createNoticer(() => ctx.getSettings().notificationLevel);
          if (!consistency.enabled) {
            toast.summary('一致性能力已关闭。');
            return;
          }
          const t0 = Date.now();
          const snap = await ctx.index.build();
          const ms = Date.now() - t0;
          const fixes = planPathFixes(snap.entries.keys(), profileFromPlatforms(consistency.platforms));
          // "报告坏链接"关闭时，报告中不列出坏链接（但仍计入汇总计数，便于用户感知偏差）
          const showBroken = consistency.reportBrokenLinks;
          logger.info(
            `一致性审计：条目 ${snap.entries.size}，坏引用 ${snap.brokenRefs.length}，孤儿 ${snap.orphanCandidates.length}，可修复路径 ${fixes.length}（${ms}ms）`,
          );
          new ReportModal(ctx.app, {
            title: '库一致性报告',
            summary: `附件 ${snap.entries.size} · 坏链接 ${snap.brokenRefs.length} · 未用 ${snap.orphanCandidates.length} · 可修复路径 ${fixes.length}`,
            sections: [
              {
                title: '未使用附件',
                count: snap.orphanCandidates.length,
                items: snap.orphanCandidates,
                emptyText: '无未使用附件',
              },
              ...(showBroken
                ? [{
                    title: '坏链接（指向不存在文件）',
                    count: snap.brokenRefs.length,
                    items: snap.brokenRefs.map((b) => `${b.sourcePath} → ${b.linkText}`),
                    emptyText: '无坏链接',
                  }]
                : []),
              {
                title: '需修复的不兼容路径',
                count: fixes.length,
                items: fixes.map((f) => `${f.from} → ${f.to}`),
                emptyText: '无不兼容路径',
              },
            ],
          }).open();
        });
      },
    },
    {
      id: 'attachment:cleanup-unused',
      name: '清理未用附件',
      callback: async () => {
        await traceCommand('清理未用附件', () => runCleanupUnused(ctx.app, ctx.index, ctx.getSettings));
      },
    },
    {
      id: 'attachment:cleanup-empty-folders',
      name: '清理空附件目录',
      callback: async () => {
        await traceCommand('清理空附件目录', () => runCleanupEmptyFolders(ctx.app, ctx.getSettings));
      },
    },
    {
      id: 'attachment:rename-note',
      name: '重命名当前笔记附件（统一命名）',
      callback: async () => {
        await traceCommand('统一命名', () => runRenameNote(ctx.app, ctx.index, ctx.getSettings, ctx.mover));
      },
    },
    {
      id: 'attachment:repair-incompatible-paths',
      name: '修复不兼容路径',
      callback: async () => {
        await traceCommand('修复不兼容路径', () => runRepairPaths(ctx.app, ctx.index, ctx.getSettings, ctx.mover));
      },
    },
    {
      id: 'attachment:localize-note',
      name: '本地化当前笔记附件',
      callback: async () => {
        await traceCommand('本地化当前笔记', async () => {
          const r = await runLocalizeNote(ctx.app, ctx.index, ctx.getSettings, ctx.downloader);
          // 下载成功后若启用命名，自动规范命名（静默执行，不弹预览），实现"下载即命名"
          if (r.downloaded > 0 && ctx.getSettings().naming.enabled) {
            await runRenameNote(ctx.app, ctx.index, ctx.getSettings, ctx.mover, false);
          }
        });
      },
    },
    {
      id: 'attachment:collect-current-note',
      name: '收集当前笔记附件到归属目录',
      callback: async () => {
        await traceCommand('收集散落附件', () => runCollectNote(ctx.app, ctx.index, ctx.getSettings, ctx.mover));
      },
    },
    {
      id: 'attachment:export-note',
      name: '导出当前笔记附件（zip）',
      callback: async () => {
        await traceCommand('导出当前笔记附件', () => runExportNote(ctx.app, ctx.index, ctx.getSettings));
      },
    },
    {
      id: 'attachment:export-unused',
      name: '导出未用附件（zip）',
      callback: async () => {
        await traceCommand('导出未用附件', () => runExportOrphaned(ctx.app, ctx.index, ctx.getSettings));
      },
    },
    {
      id: 'attachment:bulk-rename',
      name: '重命名全库附件（全库统一命名）',
      callback: async () => {
        await traceCommand('全库统一命名', () => runBulkRename(ctx.app, ctx.index, ctx.getSettings, ctx.mover, true));
      },
    },
    {
      id: 'attachment:bulk-localize',
      name: '本地化全库附件（全库批量下载外链媒体）',
      callback: async () => {
        await traceCommand('全库本地化', () =>
          runBulkLocalize(ctx.app, ctx.index, ctx.getSettings, ctx.downloader, true),
        );
      },
    },
  ];
}