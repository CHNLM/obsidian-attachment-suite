/** 未用清理：排除过滤 → 确认预览 → 按回收站/永久策略删除。 */

import { ButtonComponent, Modal, Notice, TFile, type App } from 'obsidian';
import { basenameOf, type AttachmentIndex } from '../core';
import type { CleanupSettings, PluginSettings } from '../settings';
import { createNoticer, effectiveDuration, reportFailures, type Noticer } from '../notify';
import { logger } from '../logger';
import { planCleanup } from './unused-cleaner-core';

export * from './unused-cleaner-core';

export interface RunSummary {
  deleted: number;
  excluded: number;
  errors: number;
  skipped: number;
}

/**
 * 删除前复检 + 执行删除。
 *
 * **复检必须复用孤儿判定本身，不能自建第二份口径。** 早期这里自建了一个只读
 * `metadataCache.resolvedLinks` 的近似口径，它不认识 HTML 媒体标签（`<img src>`）与
 * frontmatter 里的裸路径——而孤儿判定层（`AttachmentIndex`）是把 resolvedLinks 与正文文本
 * 扫描**合并**后才下结论的。于是"删除前复检"实际比"判谁是孤儿"更弱：快照之后新增的
 * HTML 引用它看不见，附件照样被删。本仓库已经因为"两层口径不一致"栽过 5 次，
 * 这里直接用 `orphanCandidates` 做成员判定，口径不可能再分叉。
 *
 * 复检失败（索引构建抛错）时**一律不删**：无法确认安全时，删除是唯一不可逆的动作。
 */
async function performDelete(
  app: App,
  index: AttachmentIndex,
  paths: string[],
  mode: CleanupSettings['deleteMode'],
  toast: Noticer,
): Promise<{ deleted: number; errors: number; skipped: number; errorDetails: string[] }> {
  let stillOrphan: Set<string>;
  try {
    index.markDirty(); // 强制重建，拿到"此刻"的引用关系，而不是命令开始时的旧快照
    stillOrphan = new Set((await index.getSnapshot()).orphanCandidates);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`清理前复检失败，本次未删除任何文件：${msg}`);
    reportFailures(toast, paths.length, '清理（复检失败，未删除任何文件）');
    return { deleted: 0, errors: 0, skipped: paths.length, errorDetails: [] };
  }

  let deleted = 0;
  let errors = 0;
  let skipped = 0;
  const errorDetails: string[] = [];
  for (const path of paths) {
    try {
      // 快照之后被引用（含 HTML/frontmatter 形态）→ 跳过，绝不动
      if (!stillOrphan.has(path)) {
        skipped++;
        continue;
      }
      const f = app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile)) continue;
      if (mode === '.trash') await app.vault.trash(f, false);
      else if (mode === 'system-trash') await app.vault.trash(f, true);
      else await app.vault.delete(f);
      deleted++;
    } catch (e) {
      // 删除失败的原因必须留下：这条命令是破坏性的，"失败 N 项"而没有原因，
      // 用户无法判断文件到底删掉没有（提示还写着"详情见开发者控制台"）。
      errors++;
      errorDetails.push(`${path}：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { deleted, errors, skipped, errorDetails };
}

/** 确认删除弹窗：列出将要删除的文件，确认后才执行。 */
class ConfirmCleanupModal extends Modal {
  constructor(
    app: App,
    private readonly index: AttachmentIndex,
    private readonly paths: string[],
    private readonly mode: CleanupSettings['deleteMode'],
    private readonly toast: Noticer,
    private readonly onDone: (r: { deleted: number; errors: number; skipped: number; errorDetails: string[] }) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
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
        // 弹窗按钮的 async 回调 Obsidian 不会 await，异常会变成无人处理的 rejection；
        // 删除是破坏性操作，失败必须说出来。
        try {
          const r = await performDelete(this.app, this.index, this.paths, this.mode, this.toast);
          this.onDone(r);
        } catch (e) {
          const msg = `清理失败：${e instanceof Error ? e.message : String(e)}`;
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
  // 诊断：破坏性命令的计划规模必须可查（"删了几个/为什么跳过了"）
  logger.debug(
    `清理计划：孤儿候选 ${snapshot.orphanCandidates.length}，待删 ${plan.toDelete.length}，被排除 ${plan.excluded.length}`,
  );
  for (const p of plan.toDelete) logger.debug(`  待删 ${p}`);
  if (plan.toDelete.length === 0) {
    toast.summary(plan.excluded.length ? `没有可清理项（${plan.excluded.length} 个被排除目录保留）。` : '没有未用的附件。');
    return { deleted: 0, excluded: plan.excluded.length, errors: 0, skipped: 0 };
  }

  // 运行时复检跳过的数量：快照后新增的引用会导致个别附件在删除前一刻被判定为“在用”
  const finish = (r: { deleted: number; errors: number; skipped: number; errorDetails: string[] }, unconfirmed = false): void => {
    index.markDirty();
    const msg = `清理完成：删除 ${r.deleted}，失败 ${r.errors}（排除 ${plan.excluded.length}，删除前复检跳过 ${r.skipped}）。`;
    toast.summary(msg);
    // 「删除前确认」关闭时，用户已经放弃了执行前的核对机会，结果提示必须**不受通知级别影响**地出现一次；
    // 否则"通知级别=静默"与"关闭删除前确认"叠加，就成了一次完全无人知晓的数据删除。
    if (unconfirmed) new Notice(msg, effectiveDuration('summary', msg));
    reportFailures(toast, r.errors, '清理', r.errorDetails);
  };

  if (cleanup.requireConfirm) {
    new ConfirmCleanupModal(app, index, plan.toDelete, cleanup.deleteMode, toast, (r) => finish(r)).open();
    return { deleted: 0, excluded: plan.excluded.length, errors: 0, skipped: 0 };
  }

  const r = await performDelete(app, index, plan.toDelete, cleanup.deleteMode, toast);
  finish(r, true);
  return { deleted: r.deleted, excluded: plan.excluded.length, errors: r.errors, skipped: r.skipped };
}