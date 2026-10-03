import { Notice, type App } from 'obsidian';
import type { AttachmentIndex, SafeMoveEngine } from './core';
import { isPathExcluded } from './core';
import type { PluginSettings } from './settings';
import { logger } from './logger';
import { createNoticer, effectiveDuration } from './notify';
import { revealRefInNote } from './reveal-ref';
import { runRenameNote } from './features/name-formatter';
import { runRepairPaths, planPathFixes, profileFromPlatforms } from './features/consistency';
import { runLocalizeNote, type MediaDownloader } from './features/localize-media';
import { runCollectNote } from './features/collect';
import { runCleanupUnused } from './features/unused-cleaner';
import { runCleanupEmptyFolders } from './features/empty-folder-cleaner';
import { runExportNote, runExportOrphaned } from './features/exporter';
import { runBulkRename } from './features/bulk-rename';
import { runBulkLocalize } from './features/bulk-localize';
import { runBulkCollect } from './features/bulk-collect';
import { runFixBrokenLinks } from './features/broken-link';
import { ReportModal } from './modals';

export interface CommandContext {
  app: App;
  index: AttachmentIndex;
  mover: SafeMoveEngine;
  downloader: MediaDownloader;
  getSettings: () => PluginSettings;
  /**
   * 开启/关闭详细诊断日志（改设置 → 立即生效 → 落盘）。
   * 与设置页的开关共用 `main.ts` 的同名实现，避免"两处各写一套、只改一份"。
   */
  setDebugLogging: (next: boolean) => Promise<void>;
}

export interface CommandDef {
  id: string;
  name: string;
  callback: () => void | Promise<void>;
  /**
   * 对**指定笔记**执行同一条命令（文件右键菜单用）。省略 = 该命令不出现在文件菜单里。
   *
   * 为什么非要有这一项：文件菜单里被右键的笔记**不一定是打开着的那一篇**。
   * 若菜单项直接调 `callback`（内部走 `getActiveFile()`），就会出现"右键 A、却改了 B"。
   * 有了它，两个入口共用同一个 `run*` 实现，差别只在"目标从哪来"——
   * 这正是本仓库反复栽过的"同一件事两份实现"要避免的形态。
   */
  runForNote?: (notePath: string) => Promise<void>;
}

/**
 * 命令包装：统一记录耗时，并保证**失败一定可见**。
 *
 * 为什么必须有 catch：本函数是全部命令的唯一入口。异常若直接冒泡，就成了无人处理的 rejection
 * ——控制台一行告警，用户侧什么都没有：只会看到开始提示后再无下文，完全无法判断文件到底有没有
 * 被删／改名／移动。对破坏性命令（清理、全库改名）而言，这就是一次"不知情的数据改动"。
 *
 * 反馈分级（与设置项「通知级别」的说明保持一致）：
 * - 开始 → `info`，只在「详细」档出现（它本来就是过程信息）；
 * - 结果 → 由各能力自身发 `summary`（「仅摘要」及以上可见）；
 * - 失败 → 这里的 `error`，**任何级别都提示**（含「静默」，与 notify-core 的承诺一致）。
 */
async function traceCommand(
  displayName: string,
  getSettings: () => PluginSettings,
  fn: () => void | Promise<unknown>,
): Promise<void> {
  const t0 = Date.now();
  const toast = createNoticer(() => getSettings().notificationLevel);
  // 记在 debug 档：排查时（「切换诊断日志」命令）"哪条命令从哪一刻开始"是拼时序的第一步，
  // 但平时不必占控制台；失败/完成的结论是 info/error，不受此影响。
  logger.debug(`命令开始：${displayName}`);
  toast.info(`开始执行「${displayName}」…`);
  try {
    await fn();
    logger.info(`命令完成：${displayName}（${Date.now() - t0}ms）`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`命令失败：${displayName}（${Date.now() - t0}ms）— ${msg}`);
    // 已完成的改动不会自动回滚，所以除了报错还要告诉用户去哪自查
    toast.error(
      `「${displayName}」执行失败：${msg}。已完成的改动不会自动回滚，建议运行「检查库一致性」核对。`,
    );
  }
}

/**
 * 切换诊断日志（不动库内容）。
 *
 * 与设置页「通用 → 详细诊断日志」开关是**同一个状态、同一条实现**：命令用于"就在排查现场"，
 * 开关用于"想让它一直开着"。两者都走 `ctx.setDebugLogging`（见 `main.ts`），不会互相打脸。
 *
 * **它会写盘**（`setDebugLogging` 内部 `await saveSettings()`），因此与设置页开关一样是**持久**的，
 * 重启宿主后仍保持；不会"重启即复位"。要关掉它，再按一次本命令或到设置页关开关即可。
 *
 * 为什么同时保留命令（而不是只用设置项）：
 * - 排查自动化与人工排查可以走**同一条路径**（CDP 也能 `executeCommandById`），
 *   于是这条路径能被用例钉住："开关打开后必须真有新的输出"。
 *   设置项反而更容易变成"打开后什么也看不到"——本仓库已因"承诺了却不生效"栽过 5 次。
 * - 命令把"开/关"这个状态本身也讲清楚（含它在设置页的位置），比去设置页翻找更快。
 *
 * 提示用 Notice 而非 `toast.*`：开关状态必须**不受通知级别影响**地可见——
 * 否则用户按了命令却不知道是开是关，下一步的观察无从谈起。
 */
async function toggleDebugLogging(ctx: CommandContext): Promise<void> {
  // 状态以**设置**为准（而不是问 logger 当前级别）：设置是唯一事实来源，
  // 否则命令改了级别却不改设置，设置页会显示"关"而实际是"开"（界面显示值 ≠ 实际生效值）。
  const next = !ctx.getSettings().debugLogging;
  await ctx.setDebugLogging(next);
  logger.info(`诊断日志级别切换为：${next ? 'debug' : 'info'}`);
  const msg =
    next === true
      ? '诊断日志已开启（设置页「通用」里的开关也已同步打开）：会向开发者控制台输出更详细的过程信息。复现问题后按 Ctrl/Cmd+Shift+I 查看；排查完记得关掉——这些日志含库内文件路径。'
      : '诊断日志已关闭：恢复常规输出（结果与失败仍然可见）。';
  new Notice(msg, effectiveDuration('summary', msg));
}

/**
 * 登记全部命令。
 *
 * 实现要点：命令先以 `{ id, name, run }` 定义，再统一包一层 `traceCommand`。
 * 这样"开始提示里的名字"与"命令面板里的名字"由同一个 `name` 派生，不会再出现两者不一致
 * （历史实现给每条命令手写了一个内部代号作为提示名，用户对不上号）。
 */
export function createCommands(ctx: CommandContext): CommandDef[] {
  /**
   * 本地化某篇笔记，并在**真的下载了东西**时顺带规范命名（静默执行，不弹预览）= "下载即命名"。
   *
   * 抽成函数是因为它有两个入口（命令面板 / 文件菜单）：链式逻辑若各写一份，
   * 迟早出现"菜单那条忘了带命名"这种只改一半的偏差。
   */
  const localizeNote = async (notePath?: string): Promise<unknown> => {
    const r = await runLocalizeNote(ctx.app, ctx.index, ctx.getSettings, ctx.downloader, notePath);
    if (r.downloaded > 0 && ctx.getSettings().naming.enabled) {
      await runRenameNote(ctx.app, ctx.index, ctx.getSettings, ctx.mover, false, notePath);
    }
    return r;
  };

  const defs: Array<{
    id: string;
    name: string;
    run: () => void | Promise<unknown>;
    /** 提供后才出现在文件菜单里；实现必须与 `run` 同源，只是目标不同。 */
    runForNote?: (notePath: string) => void | Promise<unknown>;
  }> = [
    {
      id: 'attachment:check-consistency',
      name: '检查库一致性（生成报告）',
      run: async () => {
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
        // 报告口径统一（与清理/导出/本地化一致）：全局排除目录内的条目不计入报告。
        // 注意只过滤"展示层"，索引与保护层不动——被排除目录里的附件仍按"在用"保守处理，
        // 绝不因为过滤而进入可删集合。
        const exclude = ctx.getSettings().paths?.exclude ?? [];
        const orphaned = snap.orphanCandidates.filter((p) => !isPathExcluded(p, exclude));
        const broken = snap.brokenRefs.filter((b) => !isPathExcluded(b.sourcePath, exclude));
        const excludedFromReport = snap.orphanCandidates.length - orphaned.length + (snap.brokenRefs.length - broken.length);
        const excludeNote = excludedFromReport > 0 ? `（排除目录跳过 ${excludedFromReport}）` : '';
        // "报告坏链接"关闭时，报告中不列出坏链接（但仍计入汇总计数，便于用户感知偏差）
        const showBroken = consistency.reportBrokenLinks;
        logger.info(
          `一致性审计：条目 ${snap.entries.size}，坏引用 ${broken.length}，未用 ${orphaned.length}，可修复路径 ${fixes.length}${excludeNote}（${ms}ms）`,
        );
        new ReportModal(ctx.app, {
          title: '库一致性报告',
          summary: `附件 ${snap.entries.size} · 坏链接 ${broken.length} · 未用 ${orphaned.length} · 可修复路径 ${fixes.length}${excludeNote}`,
          exportable: true,
          // 弹窗内的提示也受「通知级别」约束（导出成功＝结果，静默档不弹；失败＝错误，任何档位都弹）
          getNotificationLevel: () => ctx.getSettings().notificationLevel,
          // 报告内快捷：关闭弹窗后唤起"修复断链（候选式安全重链）"
          onFixBrokenLinks: () => {
            void traceCommand('修复断链', ctx.getSettings, () =>
              runFixBrokenLinks(ctx.app, ctx.index, ctx.getSettings, true),
            );
          },
          sections: [
            {
              title: '未用附件',
              count: orphaned.length,
              items: orphaned,
              emptyText: '无未用附件',
            },
            ...(showBroken
              ? [{
                  title: '需修复的引用（断链 / URL 编码）',
                  count: broken.length,
                  // 可点击：定位到对应笔记中该断引用附近，便于无法自动确定的手动处理
                  items: broken.map(
                    (b) =>
                      ({
                        text: `${b.sourcePath} → ${b.linkText}`,
                        onClick: () => void revealRefInNote(ctx.app, b.sourcePath, b.linkText),
                      }) as { text: string; onClick: () => void },
                  ),
                  emptyText: '无需要修复的引用',
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
      },
    },
    {
      id: 'attachment:cleanup-unused',
      name: '清理未用附件',
      run: () => runCleanupUnused(ctx.app, ctx.index, ctx.getSettings),
    },
    {
      id: 'attachment:cleanup-empty-folders',
      name: '清理空附件目录',
      run: () => runCleanupEmptyFolders(ctx.app, ctx.getSettings),
    },
    {
      id: 'attachment:rename-note',
      name: '重命名当前笔记附件',
      run: () => runRenameNote(ctx.app, ctx.index, ctx.getSettings, ctx.mover),
      runForNote: (p) => runRenameNote(ctx.app, ctx.index, ctx.getSettings, ctx.mover, true, p),
    },
    {
      id: 'attachment:repair-incompatible-paths',
      name: '修复不兼容路径',
      run: () => runRepairPaths(ctx.app, ctx.index, ctx.getSettings, ctx.mover),
    },
    {
      id: 'attachment:fix-broken-links',
      name: '修复断链',
      run: () => runFixBrokenLinks(ctx.app, ctx.index, ctx.getSettings, true),
    },
    {
      id: 'attachment:localize-note',
      name: '本地化当前笔记附件',
      run: () => localizeNote(),
      runForNote: (p) => localizeNote(p),
    },
    {
      id: 'attachment:collect-current-note',
      name: '收集当前笔记附件到归属目录',
      run: () => runCollectNote(ctx.app, ctx.index, ctx.getSettings, ctx.mover),
      runForNote: (p) => runCollectNote(ctx.app, ctx.index, ctx.getSettings, ctx.mover, p),
    },
    {
      id: 'attachment:bulk-collect',
      name: '收集全库散落附件到归属目录',
      run: () => runBulkCollect(ctx.app, ctx.index, ctx.getSettings, ctx.mover, true),
    },
    {
      id: 'attachment:export-note',
      name: '导出当前笔记附件（zip）',
      run: () => runExportNote(ctx.app, ctx.index, ctx.getSettings),
      runForNote: (p) => runExportNote(ctx.app, ctx.index, ctx.getSettings, p),
    },
    {
      id: 'attachment:export-unused',
      name: '导出未用附件（zip）',
      run: () => runExportOrphaned(ctx.app, ctx.index, ctx.getSettings),
    },
    {
      id: 'attachment:bulk-rename',
      name: '重命名全库附件',
      run: () => runBulkRename(ctx.app, ctx.index, ctx.getSettings, ctx.mover, true),
    },
    {
      id: 'attachment:bulk-localize',
      name: '本地化全库附件',
      run: () => runBulkLocalize(ctx.app, ctx.index, ctx.getSettings, ctx.downloader, true),
    },
    // —— 诊断（排查用，不改动库内容）——
    {
      id: 'attachment:toggle-debug-logging',
      name: '切换诊断日志（排查用）',
      run: () => toggleDebugLogging(ctx),
    },
  ];
  return defs.map((d) => ({
    id: d.id,
    name: d.name,
    callback: () => traceCommand(d.name, ctx.getSettings, d.run),
    // 菜单入口同样包一层 traceCommand：耗时与失败可见性与命令面板完全一致，
    // 不会因为"从菜单进来"就少了 catch（那正是历史上失败被吞掉的形态之一）。
    runForNote: d.runForNote
      ? (notePath: string): Promise<void> =>
          traceCommand(d.name, ctx.getSettings, () => d.runForNote!(notePath))
      : undefined,
  }));
}

// 说明：报告内「点击定位到断链所在笔记」由 ./reveal-ref 的 revealRefInNote 提供（预览弹窗亦共用）。
