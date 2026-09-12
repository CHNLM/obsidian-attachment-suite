/** 清理空附件目录命令。 */

import { ButtonComponent, Modal, TFolder, type App, type TAbstractFile } from 'obsidian';
import type { PluginSettings } from '../settings';
import { createNoticer } from '../notify';
import { planEmptyFolderCleanup } from './empty-folder-core';

export * from './empty-folder-core';

export interface RunSummary {
  removed: number;
  errors: number;
}

/** 确认删除弹窗：列出将要删除的空目录，确认后执行（移入回收站，并迭代清理逐层变空的父目录）。 */
class ConfirmEmptyFoldersModal extends Modal {
  constructor(
    app: App,
    private readonly folders: string[],
    private readonly files: string[],
    private readonly allFolders: string[],
    private readonly onDone: (r: { removed: number; errors: number }) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass('iap-cleanup-modal');
    const header = contentEl.createDiv({ cls: 'iap-cleanup-header' });
    const titleRow = header.createDiv({ cls: 'iap-cleanup-title-row' });
    titleRow.createEl('h3', { text: '清理空附件目录', cls: 'iap-cleanup-title' });
    titleRow.createEl('span', { text: `${this.folders.length} 个空目录`, cls: 'iap-cleanup-count' });
    header.createEl('p', { text: '将把以下空目录移入 Obsidian 回收站；删除后逐层变空的父目录也会一并清理。仅删除不含任何文件与子目录的空目录。', cls: 'iap-cleanup-desc' });

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
        let removed = 0;
        let errors = 0;
        const removedSet = new Set<string>();
        let pool = [...this.folders];
        while (pool.length > 0) {
          const before = removed;
          for (const p of pool) {
            const f = this.app.vault.getAbstractFileByPath(p);
            if (!(f instanceof TFolder)) continue;
            try {
              await this.app.vault.trash(f, false);
              removed++;
              removedSet.add(p);
            } catch {
              errors++;
            }
          }
          if (removed === before) break; // 无进展，避免死循环
          // 删除叶子后逐层清理变空的父目录
          pool = planEmptyFolderCleanup(this.files, this.allFolders.filter((x) => !removedSet.has(x)));
        }
        this.onDone({ removed, errors });
        this.close();
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** 扫描并清理库内不含任何文件的空目录（可作用于清理后留下的空附件目录）。 */
export async function runCleanupEmptyFolders(app: App, getSettings: () => PluginSettings): Promise<RunSummary> {
  const toast = createNoticer(() => getSettings().notificationLevel);
  const all = (app.vault.getAllLoadedFiles?.() ?? (app.vault.getFiles() as unknown as TAbstractFile[])) as TAbstractFile[];
  const files: string[] = [];
  const folders: string[] = [];
  for (const f of all) {
    if (f.path.startsWith('.obsidian')) continue;
    if (f instanceof TFolder) folders.push(f.path);
    else files.push(f.path);
  }
  const empty = planEmptyFolderCleanup(files, folders);
  if (empty.length === 0) {
    toast.summary('没有需要清理的空目录。');
    return { removed: 0, errors: 0 };
  }
  const finish = (r: { removed: number; errors: number }): void => {
    toast.summary(`清理完成：删除空目录 ${r.removed}，失败 ${r.errors}。`);
  };
  new ConfirmEmptyFoldersModal(app, empty, files, folders, finish).open();
  return { removed: 0, errors: 0 };
}