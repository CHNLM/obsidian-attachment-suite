/** 插件入口（main.ts）：组合 core + 基础设施 + 命令与事件。 */

import { Plugin, TFile, Notice, htmlToMarkdown, type TAbstractFile } from 'obsidian';
import { AttachmentIndex, SafeMoveEngine, TaskQueue } from './core';
import { ObsidianFileOps, ObsidianMetadataProvider, ObsidianVaultAdapter } from './obsidian-domain';
import { DEFAULT_SETTINGS, type PluginSettings } from './settings';
import { migrateSettings } from './settings-migration';
import { logger } from './logger';
import { AttachmentSettingTab } from './settings-tab';
import { createCommands } from './commands';
import { ObsidianDownloader, findExternalRefs } from './features/localize-media';
import { runFollowNoteMove } from './features/note-relocator';
import { runAutoProcess, isAutoBusy } from './features/automation';

/**
 * 启动抑制窗口（仅真实 Obsidian 生效）：Obsidian 刚启动时会对库内笔记批量触发
 * `metadataCache.changed`，若不抑制会把整库都标为"待自动处理"，导致"打开即批量处理+多次弹窗"。
 * 此窗口内不对 changed 事件采集脏笔记（索引失效仍照常），仅响应用户此后的真实编辑/粘贴。
 * Vitest E2E 环境（`__OBSIDIAN_TEST`）设为 0，避免干扰测试的显式事件驱动。
 */
const isTestEnv = typeof (globalThis as unknown as { __OBSIDIAN_TEST?: unknown }).__OBSIDIAN_TEST !== 'undefined';
const STARTUP_SUPPRESS_MS = isTestEnv ? 0 : 1500;

export default class AttachmentSuitePlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  index!: AttachmentIndex;
  mover!: SafeMoveEngine;
  downloader!: ObsidianDownloader;
  private readonly queue = new TaskQueue();

  // 事件节流：metadataCache 高频触发时延迟 markDirty。
  private indexDirtyTimer: number | null = null;
  // 自动处理：待处理（脏）笔记集合 + 轮询间隔句柄（参考 obsidian-local-images-plus 的定时清扫模式）。
  private readonly dirtyNotes = new Set<string>();
  private autoIntervalId: number | null = null;
  /** 插件 ready 时刻（纳秒起算点），用于启动抑制窗口。 */
  private automationReadyAt = 0;

  async onload(): Promise<void> {
    console.log('[AttachmentSuite] onload START', Date.now());
    try {
      await this.loadSettings();

      this.index = new AttachmentIndex(
        new ObsidianVaultAdapter(this.app),
        new ObsidianMetadataProvider(this.app),
      );
      // 统一改名/移动出口（fileManager 联动改写链接）
      this.mover = new SafeMoveEngine(new ObsidianFileOps(this.app));
      this.downloader = new ObsidianDownloader(() => this.settings);

      this.addSettingTab(new AttachmentSettingTab(this.app, this));

      for (const cmd of createCommands({
        app: this.app,
        index: this.index,
        mover: this.mover,
        downloader: this.downloader,
        getSettings: () => this.settings,
      })) {
        this.addCommand({ id: cmd.id, name: cmd.name, callback: cmd.callback });
      }

      // 记录 ready 时刻：此后的启动抑制窗口内不采集启动期 metadataCache.changed 批量触发
      this.automationReadyAt = Date.now();
      this.wireEvents();
      this.startAutomationSweep();
      logger.info(`Attachment Suite 已加载（v${this.manifest.version}）`);
      // 加载成功且自动化在生效时弹出的可见确认条（用于排查“代码是否真的加载”）
      if (this.settings.automation?.enabled) {
        console.log('[AttachmentSuite] onload OK, automation=', this.settings.automation, Date.now());
        new Notice(`Attachment Suite v${this.manifest.version} 已加载（自动处理：开 · 间隔 ${this.settings.automation.interval} 秒）`);
      } else {
        console.log('[AttachmentSuite] onload OK, automation 关闭, automation=', this.settings.automation, Date.now());
      }
    } catch (e) {
      console.error('[AttachmentSuite] onload FAILED:', e);
      throw e;
    }
  }

  onunload(): void {
    if (this.indexDirtyTimer !== null) {
      window.clearTimeout(this.indexDirtyTimer);
      this.indexDirtyTimer = null;
    }
    if (this.autoIntervalId !== null) {
      window.clearInterval(this.autoIntervalId);
      this.autoIntervalId = null;
    }
    this.dirtyNotes.clear();
  }

  async loadSettings(): Promise<void> {
    const raw = await this.loadData();
    this.settings = migrateSettings(raw);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private wireEvents(): void {
    // 库结构变化 → 索引失效
    this.registerEvent(this.app.vault.on('create', (file) => this.onVaultFileChange(file)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.onRename(file, oldPath)));
    this.registerEvent(this.app.vault.on('delete', () => this.scheduleDirty()));
    this.registerEvent(this.app.vault.on('modify', (file) => this.onVaultFileChange(file)));
    // 元数据/笔记内容变化 → 索引失效 + 标记待自动处理
    this.registerEvent(
      this.app.metadataCache.on('changed', (file: TAbstractFile | null) => this.onVaultFileChange(file)),
    );
    // 粘贴即处理：用户从网页复制含图片的内容粘贴进笔记时，立即标记待处理
    this.registerEvent(
      (this.app.workspace as any).on('editor-paste', (evt: { clipboardData?: { items?: any[]; getData?: (t: string) => string } }) => {
        this.onPaste(evt);
      }) as any,
    );
  }

  /** md/canvas 内容或元数据变化 → 索引失效 + 标记待自动处理（轮询统一起处理）。 */
  private onVaultFileChange(file: TAbstractFile | null): void {
    this.scheduleDirty();
    if (!file || typeof file.path !== 'string') return;
    if (!/\.(md|canvas)$/i.test(file.path)) return;
    if (!this.settings.automation?.enabled) return;
    if (isAutoBusy()) return; // 自动处理的自身写入不再自我标记，避免每 5 秒空跑放大
    // 启动抑制窗口：打开 Obsidian 时对库内笔记批量触发 changed，不当作“用户编辑”，避免打开即批量处理
    if (STARTUP_SUPPRESS_MS > 0 && Date.now() - this.automationReadyAt < STARTUP_SUPPRESS_MS) return;
    this.dirtyNotes.add(file.path);
    console.log('[AttachmentSuite] markDirty', file.path, '| enabled=', this.settings.automation?.enabled);
  }

  /** 拦截粘贴：剪贴板含外部/data 图片引用时，标记活动笔记待自动处理。 */
  private onPaste(evt: { clipboardData?: { items?: any[]; getData?: (t: string) => string } }): void {
    const s = this.settings;
    if (!s.automation?.enabled || !s.localize.enabled) return;
    if (!evt.clipboardData || !Array.isArray(evt.clipboardData.items)) return;
    const note = this.app.workspace.getActiveFile() as TFile | null;
    if (!note || !/\.(md|canvas)$/i.test(note.path)) return;
    try {
      let html = '';
      let plain = '';
      for (const item of evt.clipboardData.items ?? []) {
        if (item && item.kind === 'string') {
          const type = String(item.type ?? '');
          if (type === 'text/html') html = evt.clipboardData.getData?.(type) ?? '';
          else if (type === 'text/plain') plain = evt.clipboardData.getData?.(type) ?? '';
        }
      }
      const md = (html ? htmlToMarkdown(html) : '') + '\n' + (plain || '');
      if (findExternalRefs(md).length === 0) return;
      this.dirtyNotes.add(note.path);
    } catch {
      // 剪贴板读取失败时静默跳过，避免影响粘贴事件本身
    }
  }

  /** 定时轮询清扫脏笔记（参照 obsidian-local-images-plus 的 realTimeUpdateInterval 轮询模式）。 */
  private startAutomationSweep(): void {
    const intervalSec = Math.max(1, this.settings.automation?.interval ?? 5);
    this.autoIntervalId = window.setInterval(() => {
      void this.sweepAuto();
    }, intervalSec * 1000);
    this.registerInterval(this.autoIntervalId);
  }

  /** 从磁盘重读并处理当前所有待处理笔记（幂等：已本地化/改名的不再处理）。 */
  private async sweepAuto(): Promise<void> {
    const s = this.settings;
    if (!s.automation?.enabled || this.queue.isProcessing()) {
      console.log('[AttachmentSuite] sweep skip', { enabled: s.automation?.enabled, busy: this.queue.isProcessing() });
      return;
    }
    if (this.dirtyNotes.size === 0) return;
    const paths = Array.from(this.dirtyNotes);
    this.dirtyNotes.clear();
    console.log('[AttachmentSuite] sweep processing', paths);
    for (const notePath of paths) {
      void this.queue.enqueue(() =>
        runAutoProcess(this.app, this.index, () => this.settings, this.downloader, this.mover, notePath).then((r) =>
          console.log('[AttachmentSuite] auto done', notePath, r, Date.now()),
        ),
      );
    }
  }

  private onRename(file: TAbstractFile, oldPath: string): void {
    // 触发全文索引失效
    this.scheduleDirty();
    // 仅笔记移动需要联动（TFile 且是 md/canvas；文件夹移动不处理）
    if (!(file instanceof TFile)) return;
    void this.queue.enqueue(() =>
      runFollowNoteMove(this.app, this.mover, () => this.settings, file.path, oldPath),
    );
  }

  private scheduleDirty(): void {
    if (this.indexDirtyTimer !== null) {
      window.clearTimeout(this.indexDirtyTimer);
    }
    // 300ms 去抖
    this.indexDirtyTimer = window.setTimeout(() => {
      this.indexDirtyTimer = null;
      this.index.markDirty();
      // 通过队列入队一次空任务，确保后续命令拿到最新快照顺序执行
      void this.queue.enqueue(async () => undefined);
    }, 300);
  }
}