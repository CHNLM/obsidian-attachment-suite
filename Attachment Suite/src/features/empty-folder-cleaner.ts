/** 清理空附件目录命令。 */

import { ButtonComponent, Modal, Notice, TFolder, type App, type TAbstractFile } from 'obsidian';
import type { PluginSettings } from '../settings';
import { createNoticer, effectiveDuration, reportFailures } from '../notify';
import { planEmptyFolderCleanup, planEmptyFolderCleanupDetailed } from './empty-folder-core';
import { logger } from '../logger';

export * from './empty-folder-core';

export interface RunSummary {
  removed: number;
  errors: number;
  /** 规划阶段被认定为空、但**真实文件系统里并非空**（如只含 `.DS_Store`/`.gitkeep`）而跳过的目录数。 */
  skippedNotEmpty?: number;
}

/**
 * 目录在**真实文件系统**里是否为空。
 *
 * 为什么不能只看 Obsidian 索引：`vault.getAllLoadedFiles()` / `getFiles()` **不含点文件**，
 * 因此"只含 `.DS_Store` / `.gitkeep` 的目录"在索引视角是空的，会被当成空目录删掉。
 * macOS 上 `.DS_Store` 几乎无处不在，而 `.gitkeep` 更是用户明确要保留的占位文件——
 * 删掉它属于"用户圈了要留却被动了"。删除前一律回查 `adapter.list`（实测它能看到点文件）。
 *
 * 读不到目录内容时返回 false（当作非空）——**宁可漏清一个空目录，也不误删含内容的目录**。
 */
async function isReallyEmpty(app: App, path: string): Promise<boolean> {
  try {
    const l = await app.vault.adapter.list(path);
    return (l.files?.length ?? 0) === 0 && (l.folders?.length ?? 0) === 0;
  } catch {
    return false;
  }
}

/**
 * 迭代删除空目录：删除叶子空目录后重规划，逐层清理变空的父目录。
 * 确认弹窗路径与「删除前确认」关闭时的静默路径共用本函数，避免两处删除逻辑分叉。
 *
 * @param folders 首轮待删（已剔除排除目录）的叶子级空目录。
 * @param allFolders 全量目录（**含被排除项**，保证父目录判定不被排除名单影响）。
 * @param excludes 排除目录；重规划时同样传入，避免二次迭代把被排除项或其父目录删掉。
 */
export async function performEmptyFolderDelete(
  app: App,
  folders: string[],
  files: string[],
  allFolders: string[],
  excludes: string[] = [],
): Promise<{ removed: number; errors: number; skippedNotEmpty: number; errorDetails: string[] }> {
  let removed = 0;
  let errors = 0;
  let skippedNotEmpty = 0;
  const removedSet = new Set<string>();
  // 去重：迭代重规划会把"索引视角空、真实文件系统非空"的目录反复带回 pool
  // （如只含 .DS_Store 的目录），逐轮累加会把 1 个目录报成 N 个，用户会以为漏删是 bug。
  const notEmptySeen = new Set<string>();
  // 删除失败的原因必须留下（提示承诺"详情见开发者控制台"；破坏性命令尤其不能让失败无声）
  const errorDetails: string[] = [];
  logger.debug(`空目录清理：候选 ${folders.length}，全部目录 ${allFolders.length}，排除目录 ${excludes.length}`);
  let pool = [...folders];
  while (pool.length > 0) {
    const before = removed;
    for (const p of pool) {
      const f = app.vault.getAbstractFileByPath(p);
      if (!(f instanceof TFolder)) continue;
      // 删除前回查真实文件系统：索引看不见的点文件也算内容
      if (!(await isReallyEmpty(app, p))) {
        if (!notEmptySeen.has(p)) {
          notEmptySeen.add(p);
          skippedNotEmpty++;
        }
        continue;
      }
      try {
        await app.vault.trash(f, false);
        removed++;
        removedSet.add(p);
      } catch (e) {
        errors++;
        errorDetails.push(`${p}：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (removed === before) break; // 无进展，避免死循环
    // 删除叶子后逐层清理变空的父目录
    pool = planEmptyFolderCleanup(files, allFolders.filter((x) => !removedSet.has(x)), excludes);
  }
  return { removed, errors, skippedNotEmpty, errorDetails };
}

/** 确认删除弹窗：列出将要删除的空目录，确认后执行（移入回收站，并迭代清理逐层变空的父目录）。 */
class ConfirmEmptyFoldersModal extends Modal {
  constructor(
    app: App,
    private readonly folders: string[],
    private readonly files: string[],
    private readonly allFolders: string[],
    private readonly excludes: string[],
    private readonly excludedCount: number,
    private readonly onDone: (r: { removed: number; errors: number; skippedNotEmpty: number; errorDetails: string[] }) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass('iap-cleanup-modal');
    const header = contentEl.createDiv({ cls: 'iap-cleanup-header' });
    const titleRow = header.createDiv({ cls: 'iap-cleanup-title-row' });
    titleRow.createEl('h3', { text: '清理空附件目录', cls: 'iap-cleanup-title' });
    titleRow.createEl('span', { text: `${this.folders.length} 个空目录`, cls: 'iap-cleanup-count' });
    // 被排除而跳过的项如实报告（不静默丢弃），便于用户核对排除目录设置的效果
    const excludeNote =
      this.excludedCount > 0 ? `另有 ${this.excludedCount} 个空目录位于排除目录，已跳过。` : '';
    header.createEl('p', {
      text: `将把以下空目录移入 Obsidian 回收站；删除后逐层变空的父目录也会一并清理。仅删除不含任何文件与子目录的空目录。${excludeNote}`,
      cls: 'iap-cleanup-desc',
    });

    const list = contentEl.createDiv({ cls: 'iap-cleanup-list' });
    for (const p of this.folders) {
      const row = list.createDiv({ cls: 'iap-cleanup-row' });
      row.createSpan({ text: p, cls: 'iap-cleanup-path' });
    }

    const footer = contentEl.createDiv({ cls: 'iap-cleanup-footer' });
    new ButtonComponent(footer).setButtonText('取消').setClass('iap-btn').onClick(() => this.close());
    new ButtonComponent(footer)
      .setButtonText(`确认清理（${this.folders.length}）`)
      .setCta()
      .setWarning()
      .setClass('iap-btn')
      .onClick(async () => {
        // 弹窗按钮的 async 回调 Obsidian 不会 await，异常会变成无人处理的 rejection
        try {
          const r = await performEmptyFolderDelete(this.app, this.folders, this.files, this.allFolders, this.excludes);
          this.onDone(r);
        } catch (e) {
          const msg = `清理空目录失败：${e instanceof Error ? e.message : String(e)}`;
          // 与 modals.ts 的 runConfirmed 同口径：弹窗已关，失败必须**无条件可见**（故不走级别门禁），
          // 但停留时长仍交给 effectiveDuration——从前硬编码 8000 与设置页承诺的「错误 5 秒起、消息越长越久」对不上。
          new Notice(msg, effectiveDuration('error', msg));
        } finally {
          this.close();
        }
      });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** 扫描并清理库内不含任何文件的空目录（可作用于清理后留下的空附件目录）。 */
export async function runCleanupEmptyFolders(app: App, getSettings: () => PluginSettings): Promise<RunSummary> {
  const toast = createNoticer(() => getSettings().notificationLevel);
  const cleanup = getSettings().cleanup;
  // 与本组「清理未用附件」一致：清理总开关关闭时整个能力都不执行
  if (!cleanup.enabled) {
    toast.summary('清理能力已关闭。');
    return { removed: 0, errors: 0 };
  }
  const all = (app.vault.getAllLoadedFiles?.() ?? (app.vault.getFiles() as unknown as TAbstractFile[])) as TAbstractFile[];
  const files: string[] = [];
  const folders: string[] = [];
  for (const f of all) {
    if (f.path.startsWith('.obsidian')) continue;
    if (f instanceof TFolder) folders.push(f.path);
    else files.push(f.path);
  }
  // 排除名单口径与「清理未用附件」相同：「清理」的排除目录 + 全局排除目录，二者叠加
  const excludes = [...(cleanup.excludedFolders ?? []), ...(getSettings().paths?.exclude ?? [])];
  const { toDelete, excluded } = planEmptyFolderCleanupDetailed(files, folders, excludes);
  if (toDelete.length === 0) {
    toast.summary(
      excluded > 0 ? `没有需要清理的空目录（${excluded} 个位于排除目录已跳过）。` : '没有需要清理的空目录。',
    );
    return { removed: 0, errors: 0 };
  }
  const finish = (
    r: { removed: number; errors: number; skippedNotEmpty: number; errorDetails: string[] },
    unconfirmed = false,
  ): void => {
    const excludedNote = excluded > 0 ? `（排除目录跳过 ${excluded}）` : '';
    // 索引看不见点文件，故"实际非空"的候选要如实报出来，避免用户以为漏删是 bug
    const keptNote = r.skippedNotEmpty > 0 ? `（${r.skippedNotEmpty} 个目录实际含隐藏文件，已保留）` : '';
    const msg = `清理完成：删除空目录 ${r.removed}，失败 ${r.errors}${excludedNote}${keptNote}。`;
    toast.summary(msg);
    // 「删除前确认」关闭时结果必须不受通知级别影响地出现一次（同「清理未用附件」的理由：
    // 否则"静默 + 无确认"叠加就是一次无人知晓的删除）。
    if (unconfirmed) new Notice(msg, effectiveDuration('summary', msg));
    reportFailures(toast, r.errors, '清理空附件目录', r.errorDetails);
  };
  // 「删除前确认」关闭时直接执行，与「清理未用附件」的语义保持一致
  if (!cleanup.requireConfirm) {
    const r = await performEmptyFolderDelete(app, toDelete, files, folders, excludes);
    finish(r, true);
    return r;
  }
  new ConfirmEmptyFoldersModal(app, toDelete, files, folders, excludes, excluded, (r) => finish(r)).open();
  return { removed: 0, errors: 0, skippedNotEmpty: 0 };
}
