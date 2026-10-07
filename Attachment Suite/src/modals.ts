/** 通用确认/报告弹窗（破坏性操作三态；统一 UI）。 */

import { ButtonComponent, Modal, Notice, type App } from 'obsidian';
import { createNoticer, effectiveDuration } from './notify';
import type { NotificationLevel } from './settings';

/** 确认弹窗的变更行。 */
export interface ConfirmChangeRow {
  from: string;
  to: string;
  /** 变更原因（可选，作为小标签）。 */
  reason?: string;
  /** 可选点击回调（如定位到来源笔记）。提供后该行渲染为可点击。 */
  onClick?: () => void;
}

interface ConfirmChangesOptions {
  title: string;
  desc?: string;
  rows: ConfirmChangeRow[];
  /**
   * 额外只读分区：列出「将被跳过 / 拦截」的项。它们**不参与本次变更**，
   * 仅供用户在确认前核对（例如「哪些外链会因域名名单或内网拦截而不下载」）。
   */
  blocked?: { title: string; items: ConfirmChangeRow[] };
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

/** 单次渲染的条目上限（超出折叠为「及另外 N 项」）。 */
const ROW_RENDER_LIMIT = 50;

/**
 * 执行弹窗回调并兜住异常。
 *
 * 必须兜住：这些回调几乎都是"用户点完确认才开始做"的破坏性操作，且常常**先改动文件、再改写引用**。
 * 一旦后半段抛错而回调又是 `void cb()`，异常就被静默丢弃——弹窗关掉了，用户不知道文件到底改没改，
 * 甚至连本该出现的完成摘要都不会弹出（历史缺陷）。这里统一转成可见提示 + 明确的下一步动作。
 */
function runConfirmed(label: string, cb: () => void | Promise<void>): void {
  void Promise.resolve()
    .then(() => cb())
    .catch((e: unknown) => {
      const msg = `「${label}」执行失败：${e instanceof Error ? e.message : String(e)}。已完成的改动不会自动回滚，建议运行「检查库一致性」核对。`;
      // 这一条**必须无条件可见**（弹窗已经关了，用户必须知道"哪一步没做成"），
      // 所以不走 createNoticer 的级别门禁——它是本文件唯一被允许的裸 Notice。
      // 但**停留时长仍走同一口径**：从前硬编码 8000，与设置页承诺的
      // 「按级别分级时长（错误 5 秒起，消息越长越久）」对不上。
      new Notice(msg, effectiveDuration('error', msg));
    });
}

/** 预览确认弹窗：列出 from → to 变更，确认后执行。 */
export class ConfirmChangesModal extends Modal {
  constructor(
    app: App,
    private readonly opts: ConfirmChangesOptions,
  ) {
    super(app);
  }

  override onOpen(): void {
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
    this.renderRows(list, this.opts.rows);

    // 只读分区：将被拦截/跳过的项（可点击定位）
    const blocked = this.opts.blocked;
    if (blocked && blocked.items.length > 0) {
      contentEl.createEl('h4', { text: blocked.title, cls: 'iap-confirm-section-title' });
      const blockedList = contentEl.createDiv({ cls: 'iap-confirm-list iap-confirm-list-blocked' });
      this.renderRows(blockedList, blocked.items);
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
      runConfirmed(this.opts.title, cb);
    });
  }

  /** 渲染一批变更行；超出上限时折叠提示。 */
  private renderRows(host: HTMLElement, rows: ConfirmChangeRow[]): void {
    for (const row of rows.slice(0, ROW_RENDER_LIMIT)) {
      const item = host.createDiv({
        cls: row.onClick ? 'iap-confirm-row iap-confirm-row-clickable' : 'iap-confirm-row',
      });
      if (row.reason) {
        item.createSpan({ text: row.reason, cls: 'iap-confirm-reason' });
      }
      const flow = item.createDiv({ cls: 'iap-confirm-flow' });
      flow.createSpan({ text: displayPath(row.from), cls: 'iap-confirm-from' });
      flow.createSpan({ text: '→', cls: 'iap-confirm-arrow' });
      flow.createSpan({ text: displayPath(row.to), cls: 'iap-confirm-to' });
      if (row.onClick) {
        item.addEventListener('click', row.onClick);
        item.setAttribute('title', '点击定位到该引用所在笔记');
      }
    }
    if (rows.length > ROW_RENDER_LIMIT) {
      host.createDiv({ text: `… 及另外 ${rows.length - ROW_RENDER_LIMIT} 项`, cls: 'iap-confirm-more' });
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** 报告项：纯文本，或带点击回调（定位到笔记引用处等）。 */
export type ReportItem = string | { text: string; onClick?: () => void };

/** 只读报告弹窗（一致性审计）。 */
export interface ReportSection {
  title: string;
  count?: number;
  items: ReportItem[];
  emptyText?: string;
}

interface ReportOptions {
  title: string;
  summary?: string;
  sections: ReportSection[];
  /** 显示“导出 .md 报告”按钮：把报告写入库根（带时间戳，不覆盖）。 */
  exportable?: boolean;
  /** 提供后显示“去修复可确定断链”按钮：关闭弹窗并执行修复命令。 */
  onFixBrokenLinks?: () => void;
  /**
   * 读取当前通知级别（必填）。
   *
   * 弹窗内的提示也是「用户可见提示」，同样必须受级别约束：导出成功属"结果"，
   * 在「静默（只出错时提示）」档下不该弹；导出失败属"错误"，任何档位都要弹。
   * 交给调用方注入而不是自己读设置，是为了保持本文件不依赖插件实例。
   */
  getNotificationLevel: () => NotificationLevel;
}

export class ReportModal extends Modal {
  constructor(
    app: App,
    private readonly opts: ReportOptions,
  ) {
    super(app);
  }

  override onOpen(): void {
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
          if (typeof item === 'string') {
            list.createDiv({ text: item, cls: 'iap-report-item' });
          } else {
            const div = list.createDiv({ text: item.text, cls: 'iap-report-item iap-report-item-clickable' });
            if (item.onClick) div.addEventListener('click', item.onClick);
          }
        }
        if (section.items.length > 100) {
          list.createDiv({ text: `… 及另外 ${section.items.length - 100} 项`, cls: 'iap-report-more' });
        }
      }
    } else {
      // ⚠️ 空数组陷阱：`[].every(...)` 恒为 true，若直接写
      // `sections.every((s) => s.emptyText) ? sections[0].emptyText : …`，
      // 传空 sections 时会在 `[0]` 上抛错（未来某个调用方少传一节就炸）。
      // 零节属"没有问题要报"，走兜底文案即可——这也正是该分支的语义。
      const declared = this.opts.sections.length > 0 && this.opts.sections.every((s) => s.emptyText)
        ? this.opts.sections[0].emptyText
        : undefined;
      body.createDiv({ text: declared ?? '未发现需要关注的问题。', cls: 'iap-report-empty' });
    }

    const footer = contentEl.createDiv({ cls: 'iap-report-footer' });
    if (this.opts.onFixBrokenLinks) {
      new ButtonComponent(footer)
        .setButtonText('去修复可确定断链')
        .setCta()
        .setClass('iap-btn')
        .onClick(() => {
          const fn = this.opts.onFixBrokenLinks!;
          this.close();
          runConfirmed('修复断链', fn);
        });
    }
    if (this.opts.exportable) {
      new ButtonComponent(footer)
        .setButtonText('导出 .md 报告')
        .setClass('iap-btn')
        .onClick(() => void this.exportReport());
    }
    // 一个弹窗里只留一个 CTA（主操作）：修复入口提供时它就是唯一的主操作，
    // 「关闭」保持普通按钮——两个 setCta 会让人分不清主次，键盘默认焦点也不可预期。
    new ButtonComponent(footer).setButtonText('关闭').setClass('iap-btn').onClick(() => this.close());
  }

  /** 把报告内容导出为 .md 写入库根（时间戳命名，不覆盖；成功/失败均有提示）。 */
  private async exportReport(): Promise<void> {
    // 走 createNoticer：成功属"结果"（静默档下不弹，符合设置页的承诺），
    // 失败属"错误"（任何档位都必须可见）。时长同样由 effectiveDuration 决定，
    // 不再硬编码 3000/5000——那是"设置页承诺了分级时长、代码却另有一套数字"。
    const toast = createNoticer(this.opts.getNotificationLevel);
    let filename = '';
    try {
      const now = new Date();
      const p = (n: number): string => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
      filename = `一致性报告_${stamp}.md`;
      await this.app.vault.create(filename, this.toMarkdown());
      toast.summary(`已导出报告：${filename}`);
    } catch (e) {
      toast.error(`导出报告失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 由报告分节拼接 Markdown 文本。 */
  private toMarkdown(): string {
    const head = [`# ${this.opts.title}`, `> 生成时间：${new Date().toLocaleString()}`, ''];
    if (this.opts.summary) head.push(`${this.opts.summary}`, '');
    const lines = [...head];
    for (const s of this.opts.sections) {
      if (s.items.length === 0) continue;
      lines.push(`## ${s.title}${s.count !== undefined ? `（${s.count}）` : ''}`, '');
      for (const item of s.items) {
        const text = typeof item === 'string' ? item : item.text;
        lines.push(`- ${text.replace(/\r?\n/g, ' ')}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

function displayPath(p: string): string {
  const slash = p.lastIndexOf('/');
  const base = slash >= 0 ? p.slice(slash + 1) : p;
  const dir = slash >= 0 ? p.slice(0, slash) : '';
  return dir ? `${base}  ·  ${dir}` : base;
}

/** 候选选择弹窗的候选选项（与 broken-link-core 的候选结构兼容）。 */
export interface CandidateOption {
  path: string;
  score: number;
  matchedBy: string;
}

export interface CandidateChoice {
  sourcePath: string;
  linkText: string;
  kind: string;
  candidates: CandidateOption[];
}

interface CandidateSelectOptions {
  title: string;
  desc?: string;
  choices: CandidateChoice[];
  /** 全部处理完成回调：result 为「来源笔记 → {旧引用 → 新路径}」，skippedCount 为用户跳过的条数。 */
  onDone: (result: Map<string, Map<string, string>>, skippedCount: number) => void | Promise<void>;
}

/** 断链修复的候选选择弹窗：逐条展示断链与候选，用户点选后修复或跳过。 */
export class CandidateSelectModal extends Modal {
  private readonly result = new Map<string, Map<string, string>>();
  private skipped = 0;
  private idx = 0;
  private picked: string | null = null;

  constructor(
    app: App,
    private readonly opts: CandidateSelectOptions,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { modalEl } = this;
    modalEl.addClass('iap-confirm-modal');
    this.render();
  }

  /** 渲染当前第 idx 条断链；全部处理完则关闭并回调。 */
  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    if (this.idx >= this.opts.choices.length) {
      this.close();
      runConfirmed(this.opts.title, () => this.opts.onDone(this.result, this.skipped));
      return;
    }
    const choice = this.opts.choices[this.idx];
    this.picked = null;

    const header = contentEl.createDiv({ cls: 'iap-confirm-header' });
    const titleRow = header.createDiv({ cls: 'iap-confirm-title-row' });
    titleRow.createEl('h3', { text: this.opts.title, cls: 'iap-confirm-title' });
    titleRow.createEl('span', { text: `${this.idx + 1}/${this.opts.choices.length}`, cls: 'iap-confirm-count' });
    if (this.opts.desc) header.createEl('p', { text: this.opts.desc, cls: 'iap-confirm-desc' });

    const list = contentEl.createDiv({ cls: 'iap-confirm-list' });
    // 断链信息
    const info = list.createDiv({ cls: 'iap-confirm-row' });
    info.createSpan({ text: `来源：${displayPath(choice.sourcePath)}`, cls: 'iap-confirm-reason' });
    const flow = info.createDiv({ cls: 'iap-confirm-flow' });
    flow.createSpan({ text: choice.linkText, cls: 'iap-confirm-from' });
    flow.createSpan({ text: '→ ?', cls: 'iap-confirm-arrow' });

    // 候选列表（单选）。
    // 先把元素建好、把"谁对应哪个候选"记下来，等按钮建好后再统一挂事件——
    // 这样事件处理器里能直接拿到 `fixBtn`，不必依赖"闭包引用了后面才声明的 const"。
    const candEls: Array<{ el: HTMLElement; path: string }> = [];
    for (const cand of choice.candidates) {
      const item = list.createDiv({ cls: 'iap-candidate-item' });
      item.createSpan({ text: displayPath(cand.path), cls: 'iap-confirm-to' });
      item.createSpan({ text: matchedLabel(cand), cls: 'iap-confirm-reason' });
      candEls.push({ el: item, path: cand.path });
    }
    const hint = list.createDiv({
      cls: 'iap-candidate-hint',
      text: '请先在上方的候选里选一个，再点「以此修复」。',
    });

    const footer = contentEl.createDiv({ cls: 'iap-confirm-footer' });
    new ButtonComponent(footer)
      .setButtonText('跳过')
      .setClass('iap-btn')
      .onClick(() => {
        this.skipped++;
        this.idx++;
        this.render();
      });
    new ButtonComponent(footer)
      .setButtonText('全部跳过')
      .setClass('iap-btn')
      .onClick(() => {
        this.skipped += this.opts.choices.length - this.idx;
        this.idx = this.opts.choices.length;
        this.render();
      });
    const fixBtn = new ButtonComponent(footer)
      .setButtonText('以此修复')
      .setCta()
      .setClass('iap-btn')
      // 未选中候选时**置灰**，而不是让点击静默落空。
      // 从前是 `if (!this.picked) return;`：按钮看起来能点，点下去什么也不发生、连提示都没有，
      // 用户只会以为功能坏了（审计登记的 ②）。下面那个 `picked` 判断仍保留作第二层防御。
      .setDisabled(true)
      .onClick(() => {
        if (!this.picked) return; // 第二层防御：即使 disabled 态被绕过也不误改
        let map = this.result.get(choice.sourcePath);
        if (!map) {
          map = new Map<string, string>();
          this.result.set(choice.sourcePath, map);
        }
        map.set(choice.linkText, this.picked);
        this.idx++;
        this.render();
      });

    for (const { el, path } of candEls) {
      el.addEventListener('click', () => {
        this.picked = path;
        for (const other of list.querySelectorAll('.iap-candidate-item')) {
          other.classList.remove('iap-candidate-item-selected');
        }
        el.classList.add('iap-candidate-item-selected');
        // 选中即可修复：撤掉"先选一个"的提示并把按钮点亮。
        fixBtn.setDisabled(false);
        hint.remove();
      });
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** 候选匹配方式徽标文案。 */
function matchedLabel(c: CandidateOption): string {
  switch (c.matchedBy) {
    case 'case':
      return '大小写差异';
    case 'fuzzy':
      return `相似度 ${c.score.toFixed(2)}`;
    default:
      return '同名候选';
  }
}