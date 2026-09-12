/** 通用确认/报告弹窗（破坏性操作三态；统一 UI）。 */

import { ButtonComponent, Modal, type App } from 'obsidian';

/** 确认弹窗的变更行。 */
export interface ConfirmChangeRow {
  from: string;
  to: string;
  /** 变更原因（可选，作为小标签）。 */
  reason?: string;
}

interface ConfirmChangesOptions {
  title: string;
  desc?: string;
  rows: ConfirmChangeRow[];
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

/** 预览确认弹窗：列出 from → to 变更，确认后执行。 */
export class ConfirmChangesModal extends Modal {
  constructor(
    app: App,
    private readonly opts: ConfirmChangesOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass('iap-confirm-modal');

    const header = contentEl.createDiv({ cls: 'iap-confirm-header' });
    const titleRow = header.createDiv({ cls: 'iap-confirm-title-row' });
    titleRow.createEl('h3', { text: this.opts.title, cls: 'iap-confirm-title' });
    titleRow.createEl('span', { text: `${this.opts.rows.length} 项`, cls: 'iap-confirm-count' });
    if (this.opts.desc) {
      header.createEl('p', { text: this.opts.desc, cls: 'iap-confirm-desc' });
    }

    const list = contentEl.createDiv({ cls: 'iap-confirm-list' });
    for (const row of this.opts.rows.slice(0, 50)) {
      const item = list.createDiv({ cls: 'iap-confirm-row' });
      // 原因标签
      if (row.reason) {
        item.createSpan({ text: row.reason, cls: 'iap-confirm-reason' });
      }
      const flow = item.createDiv({ cls: 'iap-confirm-flow' });
      flow.createSpan({ text: displayPath(row.from), cls: 'iap-confirm-from' });
      flow.createSpan({ text: '→', cls: 'iap-confirm-arrow' });
      flow.createSpan({ text: displayPath(row.to), cls: 'iap-confirm-to' });
    }
    if (this.opts.rows.length > 50) {
      list.createDiv({ text: `… 及另外 ${this.opts.rows.length - 50} 项`, cls: 'iap-confirm-more' });
    }

    const footer = contentEl.createDiv({ cls: 'iap-confirm-footer' });
    new ButtonComponent(footer)
      .setButtonText('取消')
      .setClass('iap-btn')
      .onClick(() => this.close());
    const confirm = new ButtonComponent(footer)
      .setButtonText(this.opts.confirmText ?? '确认')
      .setCta()
      .setClass('iap-btn');
    if (this.opts.danger) confirm.setWarning();
    confirm.onClick(() => {
      const cb = this.opts.onConfirm;
      this.close();
      void cb();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** 只读报告弹窗（一致性审计）。 */
export interface ReportSection {
  title: string;
  count?: number;
  items: string[];
  emptyText?: string;
}

interface ReportOptions {
  title: string;
  summary?: string;
  sections: ReportSection[];
}

export class ReportModal extends Modal {
  constructor(
    app: App,
    private readonly opts: ReportOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass('iap-report-modal');

    const header = contentEl.createDiv({ cls: 'iap-report-header' });
    header.createEl('h3', { text: this.opts.title, cls: 'iap-report-title' });
    if (this.opts.summary) {
      header.createEl('p', { text: this.opts.summary, cls: 'iap-report-summary' });
    }

    const body = contentEl.createDiv({ cls: 'iap-report-body' });
    const hasContent = this.opts.sections.some((s) => s.items.length > 0);

    if (hasContent) {
      for (const section of this.opts.sections) {
        if (section.items.length === 0) continue;
        const block = body.createDiv({ cls: 'iap-report-section' });
        const head = block.createDiv({ cls: 'iap-report-section-head' });
        head.createEl('h4', { text: section.title, cls: 'iap-report-section-title' });
        if (section.count !== undefined) {
          head.createEl('span', { text: String(section.count), cls: 'iap-report-count' });
        }
        const list = block.createDiv({ cls: 'iap-report-list' });
        for (const item of section.items.slice(0, 100)) {
          list.createDiv({ text: item, cls: 'iap-report-item' });
        }
        if (section.items.length > 100) {
          list.createDiv({ text: `… 及另外 ${section.items.length - 100} 项`, cls: 'iap-report-more' });
        }
      }
    } else {
      body.createDiv({ text: this.opts.sections.every((s) => s.emptyText) ? this.opts.sections[0].emptyText : '未发现需要关注的问题。', cls: 'iap-report-empty' });
    }

    const footer = contentEl.createDiv({ cls: 'iap-report-footer' });
    new ButtonComponent(footer).setButtonText('关闭').setCta().setClass('iap-btn').onClick(() => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function displayPath(p: string): string {
  const slash = p.lastIndexOf('/');
  const base = slash >= 0 ? p.slice(slash + 1) : p;
  const dir = slash >= 0 ? p.slice(0, slash) : '';
  return dir ? `${base}  ·  ${dir}` : base;
}