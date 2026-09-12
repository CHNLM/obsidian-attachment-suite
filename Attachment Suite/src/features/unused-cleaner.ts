/** 未用清理：排除过滤 → 确认预览 → 按回收站/永久策略删除。 */

import { ButtonComponent, Modal, TFile, type App } from 'obsidian';
import type { AttachmentIndex } from '../core';
import type { CleanupSettings, PluginSettings } from '../settings';
import { createNoticer } from '../notify';
import { planCleanup } from './unused-cleaner-core';

export * from './unused-cleaner-core';

export interface RunSummary {
  deleted: number;
  excluded: number;
  errors: number;
  skipped: number;
}

/** 收集当前仍被引用的目标集合（复检依据）。 */
function collectUsedSet(app: App): Set<string> {
  const set = new Set<string>();
  const resolved = app.metadataCache.resolvedLinks as Record<string, Record<string, number>>;
  for (const links of Object.values(resolved)) {
    for (const target of Object.keys(links)) set.add(target);
  }
  return set;
}

async function performDelete(
  app: App,
  paths: string[],
  mode: CleanupSettings['deleteMode'],
): Promise<{ deleted: number; errors: number; skipped: number }> {
  // 删除前复检：若某附件此刻已被引用则跳过，避免因快照延迟误删
  const used = collectUsedSet(app);
  let deleted = 0;
  let errors = 0;
  let skipped = 0;
  for (const path of paths) {
    try {
      const f = app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile)) continue;
      if (used.has(path)) {
        skipped++;
        continue;
      }
      if (mode === '.trash') await app.vault.trash(f, false);
      else if (mode === 'system-trash') await app.vault.trash(f, true);
      else await app.vault.delete(f);
      deleted++;
    } catch {
      errors++;
    }
  }
  return { deleted, errors, skipped };
}

/** 确认删除弹窗：列出将要删除的文件，确认后才执行。 */
class ConfirmCleanupModal extends Modal {
  constructor(
    app: App,
    private readonly paths: string[],
    private readonly mode: CleanupSettings['deleteMode'],
    private readonly onDone: (r: { deleted: number; errors: number; skipped: number }) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass('iap-cleanup-modal');

    const modeLabel =
      this.mode === '.trash' ? 'Obsidian 回收站' : this.mode === 'system-trash' ? '系统回收站' : '永久删除（不可恢复）';

    // 头部：标题 + 计数徽标 + 说明
    const header = contentEl.createDiv({ cls: 'iap-cleanup-header' });
    const titleRow = header.createDiv({ cls: 'iap-cleanup-title-row' });
    titleRow.createEl('h3', { text: '清理未用附件', cls: 'iap-cleanup-title' });
    titleRow.createEl('span', { text: `${this.paths.length} 个文件`, cls: 'iap-cleanup-count' });
    header.createEl('p', { text: `删除方式：${modeLabel}。删除后将按回收站策略处理，请核对列表后确认。`, cls: 'iap-cleanup-desc' });

    // 文件清单（可滚动）
    const list = contentEl.createDiv({ cls: 'iap-cleanup-list' });
    for (const p of this.paths.slice(0, 50)) {
      const row = list.createDiv({ cls: 'iap-cleanup-row' });
      row.createSpan({ text: basenameOf(p), cls: 'iap-cleanup-name' });
      row.createSpan({ text: p, cls: 'iap-cleanup-path' });
    }
    if (this.paths.length > 50) {
      list.createDiv({ text: `… 及另外 ${this.paths.length - 50} 个文件`, cls: 'iap-cleanup-more' });
    }

    // 底部操作区
    const footer = contentEl.createDiv({ cls: 'iap-cleanup-footer' });
    new ButtonComponent(footer)
      .setButtonText('取消')
      .setClass('iap-btn')
      .onClick(() => this.close());
    new ButtonComponent(footer)
      .setButtonText(`确认删除（${this.paths.length}）`)
      .setCta()
      .setWarning()
      .setClass('iap-btn')
      .onClick(async () => {
        const r = await performDelete(this.app, this.paths, this.mode);
        this.onDone(r);
        this.close();
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function basenameOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

/** 清理未用附件并执行（含确认预览）。 */
export async function runCleanupUnused(
  app: App,
  index: AttachmentIndex,
  getSettings: () => PluginSettings,
): Promise<RunSummary> {
  const toast = createNoticer(() => getSettings().notificationLevel);
  const cleanup = getSettings().cleanup;
  if (!cleanup.enabled) {
    toast.summary('清理能力已关闭。');
    return { deleted: 0, excluded: 0, errors: 0, skipped: 0 };
  }
  const snapshot = await index.getSnapshot();
  // 把全局排除目录并入清理排除，避免误清用户显式保留的目录
  const excludes = [...cleanup.excludedFolders, ...(getSettings().paths?.exclude ?? [])];
  const plan = planCleanup(snapshot.orphanCandidates, excludes, cleanup.excludeSubfolders);
  if (plan.toDelete.length === 0) {
    toast.summary(plan.excluded.length ? `没有可清理项（${plan.excluded.length} 个被排除目录保留）。` : '没有未使用的附件。');
    return { deleted: 0, excluded: plan.excluded.length, errors: 0, skipped: 0 };
  }

  // 运行时复检跳过的数量：快照后新增的引用会导致个别附件在删除前一刻被判定为“在用”
  const finish = (r: { deleted: number; errors: number; skipped: number }): void => {
    index.markDirty();
    toast.summary(`清理完成：删除 ${r.deleted}，失败 ${r.errors}（排除 ${plan.excluded.length}，复检跳过 ${r.skipped}）。`);
  };

  if (cleanup.requireConfirm) {
    new ConfirmCleanupModal(app, plan.toDelete, cleanup.deleteMode, finish).open();
    return { deleted: 0, excluded: plan.excluded.length, errors: 0, skipped: 0 };
  }

  const r = await performDelete(app, plan.toDelete, cleanup.deleteMode);
  finish(r);
  return { deleted: r.deleted, excluded: plan.excluded.length, errors: r.errors, skipped: r.skipped };
}