/** 插件入口（main.ts）：组合 core + 基础设施 + 命令与事件。 */

import { Plugin, TFile, htmlToMarkdown, type Menu, type TAbstractFile } from 'obsidian';
import { AttachmentIndex, SafeMoveEngine, TaskQueue } from './core';
import { ObsidianFileOps, ObsidianMetadataProvider, ObsidianVaultAdapter } from './obsidian-domain';
import { DEFAULT_SETTINGS, type PluginSettings } from './settings';
import { migrateSettings } from './settings-migration';
import { logger, setLogLevel } from './logger';
import { createNoticer } from './notify';
import { AttachmentSettingTab } from './settings-tab';
import { createCommands, type CommandDef } from './commands';
import { ObsidianDownloader, findExternalRefs } from './features/localize-media';
import { runFollowNoteMove } from './features/note-relocator';
import { runAutoProcess, isAutoBusy } from './features/automation';
import {
  DEFAULT_AUTOMATION_GUARD,
  createAutomationStats,
  decideMarkDirty,
  decideSweep,
  describeMarkSkip,
  describeSweepRefusal,
  type AutomationGuardOptions,
  type AutomationStats,
  type VaultGateState,
} from './features/automation-core';

/**
 * 启动期为什么会误伤：Obsidian 打开库时会对**全库笔记**批量触发 `metadataCache.changed`。
 * 若不区分，这些事件会被当成"用户编辑了这篇笔记" → 全部标脏 → 下一个轮询周期（默认 5 秒）逐篇
 * 自动处理（`runAutoProcess` 内部走 `confirm=false` 的命名，不弹确认）→ **用户只是打开了 Obsidian，
 * 整个库的附件就被改名、搬进各笔记的归属目录**。这是本插件唯一一条不经同意就批量改写整库的路径。
 *
 * 旧实现是 `STARTUP_SUPPRESS_MS = isTestEnv ? 0 : 1500` 的固定毫秒窗，它有两个问题：
 * ① 大库/慢盘上启动期批量事件会超过 1.5 秒，"迟到的那些"照样漏进来；
 * ② 测试环境把常量置 0 → 该分支在**任何测试里一次都不执行**（改坏了也不会红）。
 *
 * 现在改为两道防线，参数与判定在 `features/automation-core.ts`：
 * ① **条件式就绪门**：以 `metadataCache.resolved`（缓存已解析完所有文件）为准，时长随库自适应；
 * ② **批量护栏（fail closed）**：单次轮询要处理的笔记数不合常理时整批拒绝，并明确告知用户。
 */

/** 文件菜单项的图标（Lucide 名）。只影响外观；缺失时回退为通用图标。 */
const FILE_MENU_ICONS: Record<string, string> = {
  'attachment:collect-current-note': 'folder-input',
  'attachment:rename-note': 'text-cursor-input',
  'attachment:localize-note': 'download',
  'attachment:export-note': 'file-archive',
};

export default class AttachmentSuitePlugin extends Plugin {
  override settings: PluginSettings = { ...DEFAULT_SETTINGS };
  index!: AttachmentIndex;
  mover!: SafeMoveEngine;
  downloader!: ObsidianDownloader;
  private readonly queue = new TaskQueue();

  // 事件节流：metadataCache 高频触发时延迟 markDirty。
  private indexDirtyTimer: number | null = null;
  // 自动处理：待处理（脏）笔记集合 + 轮询间隔句柄（参考 obsidian-local-images-plus 的定时清扫模式）。
  private readonly dirtyNotes = new Set<string>();
  /** 自动处理最近完成时间（按笔记路径）：用于吸收自有写入触发的延迟 changed 事件，阻断自我放大循环。 */
  private readonly autoProcessedAt = new Map<string, number>();
  private autoIntervalId: number | null = null;
  /**
   * 自动处理的启动门与护栏参数（可在构造后覆盖，用于用例与诊断）。
   *
   * 公开而非 private：默认值来自真实宿主的时序，而 E2E 的环境与真实宿主不同。
   * 硬编码会让这两道防线**在测试里不可达**——那正是它们此前无人验证的原因。
   */
  automationGuard: AutomationGuardOptions = { ...DEFAULT_AUTOMATION_GUARD };
  /** 库就绪门状态：`settledAt === 0` 表示尚未就绪，此间的 changed 一律不作为"用户编辑"。 */
  private readonly gate: VaultGateState = { readyAt: 0, settledAt: 0 };
  /** 兜底放行定时器（宿主迟迟不发「就绪」事件时用；只影响可用性，不影响安全性）。 */
  private settleTimerId: number | null = null;
  /** 就绪信号来源（写进诊断，便于判断"是宿主发了事件还是走了兜底"）。 */
  private settleSource = '';
  /**
   * 自动处理的**可取证计数**（只读）。
   *
   * 为什么要有它：这两道防线保护的是"不发生的事"——没有被静默批量改写。
   * 而"什么都没发生"无法自证，也分不清"防线生效"与"根本没触发"。有了计数，
   * 真实宿主验收就能回答"启动期到底有多少 changed 事件被就绪门挡下"，
   * 从而判断这道门在当前环境里是真在干活，还是白装了一道。
   */
  private readonly autoStats: AutomationStats = createAutomationStats();

  override async onload(): Promise<void> {
    logger.debug('onload 开始');
    try {
      await this.loadSettings();

      this.index = new AttachmentIndex(
        new ObsidianVaultAdapter(this.app),
        new ObsidianMetadataProvider(this.app),
        // 诊断出口：索引"重建还是命中缓存"是排查"计划基于过期快照"的第一手线索；
        // core 不能 import logger，故由此注入。默认级别（info）下这些行不输出。
        (msg) => logger.debug(`[索引] ${msg}`),
      );
      // 统一改名/移动出口（fileManager 联动改写链接）
      this.mover = new SafeMoveEngine(new ObsidianFileOps(this.app), (msg) =>
        logger.debug(`[移动] ${msg}`),
      );
      this.downloader = new ObsidianDownloader(() => this.settings);

      this.addSettingTab(new AttachmentSettingTab(this.app, this));

      const commandDefs = createCommands({
        app: this.app,
        index: this.index,
        mover: this.mover,
        downloader: this.downloader,
        getSettings: () => this.settings,
        setDebugLogging: (next: boolean) => this.setDebugLogging(next),
      });
      for (const cmd of commandDefs) {
        this.addCommand({ id: cmd.id, name: cmd.name, callback: cmd.callback });
      }
      // 同一份 commandDefs 再喂给文件右键菜单：两个入口的名字与实现同源，不可能各改一半
      this.registerNoteFileMenu(commandDefs);

      // 记录 ready 时刻并装好「库就绪门」：启动期对全库批量触发的 changed 不是"用户编辑"
      this.gate.readyAt = Date.now();
      this.wireEvents();
      this.startAutomationSweep();
      this.armSettleWatch();
      logger.info(`Attachment Suite 已加载（v${this.manifest.version}）`);
      // 加载成功且自动化在生效时弹一条可见确认条（用于排查“代码是否真的加载”）。
      //
      // 必须走统一通知通道：横幅要受「通知级别」约束，停留时长交给 `effectiveDuration`。
      // 此前是裸的 `new Notice(msg, 3000)`——于是设置页自己写的「静默：只出错时提示」被打破：
      // 默认配置（automation 默认开）下**每次打开库**都会弹一条成功横幅，
      // 连本仓库的通知契约用例都只能先把它丢掉再观察（见 notify-contract.test.ts 的 boot()）。
      // "代码到底加载没有"这个排查需求由上面那条 `logger.info` 满足——开诊断日志即可见。
      if (this.settings.automation?.enabled) {
        logger.info(`onload 完成：自动处理已开启（间隔 ${this.settings.automation.interval} 秒）`);
        createNoticer(() => this.settings.notificationLevel).summary(
          `Attachment Suite v${this.manifest.version} 已加载（自动处理：开 · 间隔 ${this.settings.automation.interval} 秒）`,
        );
      } else {
        logger.info('onload 完成：自动处理关闭');
      }
    } catch (e) {
      logger.error(`onload 失败：${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }

  override onunload(): void {
    if (this.indexDirtyTimer !== null) {
      window.clearTimeout(this.indexDirtyTimer);
      this.indexDirtyTimer = null;
    }
    if (this.autoIntervalId !== null) {
      window.clearInterval(this.autoIntervalId);
      this.autoIntervalId = null;
    }
    if (this.settleTimerId !== null) {
      window.clearTimeout(this.settleTimerId);
      this.settleTimerId = null;
    }
    this.dirtyNotes.clear();
    this.autoProcessedAt.clear();
  }

  async loadSettings(): Promise<void> {
    const raw = await this.loadData();
    this.settings = migrateSettings(raw);
    // 设置读进来就得生效：否则「详细诊断日志」只是配置里的一个字段，
    // 与"承诺了却不生效"同一类（本仓库已因这类问题栽过多次）。
    this.applyLogLevel();
  }

  /**
   * 让「详细诊断日志」设置生效。
   *
   * 设置页的开关与「切换诊断日志（排查用）」命令**共用这一条路径**——
   * 本仓库已因"同一件事两份实现、后来只改一份"栽过 6 次，日志级别尤其容易两边不一致。
   */
  applyLogLevel(): void {
    setLogLevel(this.settings.debugLogging ? 'debug' : 'info');
  }

  /**
   * 开启/关闭详细诊断日志：改设置 → **立即生效** → 落盘。
   *
   * 顺序有意如此：先让级别生效再落盘，落盘失败也不会出现"界面显示已开启、日志级别其实没变"
   * （本仓库的"界面显示值 ≠ 实际生效值"就是这么来的）。
   */
  async setDebugLogging(next: boolean): Promise<void> {
    this.settings.debugLogging = next;
    this.applyLogLevel();
    await this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * 在文件浏览器的右键菜单里，为**笔记**追加"对这篇笔记执行"的入口。
   *
   * 为什么用文件菜单（而不是 ribbon）：这些命令的作用对象是"某一篇笔记"，
   * 而右键正是用户表达"我要对**这个文件**做点什么"的时刻——上下文自带目标，无须先打开它，
   * 也不占常驻界面。
   *
   * 两个必须守住的点：
   * ① 目标必须是被点击的那一篇（走 `runForNote`）。右键的笔记不一定正打开着；
   *    若复用那条走 `getActiveFile()` 的路径，就会出现"右键 A、却改了 B"。
   * ② 名字与实现都取自同一次 `createCommands` 的返回值——命令面板与菜单不可能各改一半。
   */
  private registerNoteFileMenu(defs: CommandDef[]): void {
    const noteCommands = defs.filter((d) => d.runForNote);
    if (noteCommands.length === 0) return;
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
        // 只对笔记出现：这些命令的作用对象是笔记，右键一张图片没有意义，列出来只会添乱。
        if (!(file instanceof TFile) || !/\.(md|canvas)$/i.test(file.path)) return;
        for (const cmd of noteCommands) {
          menu.addItem((item) =>
            item
              .setTitle(cmd.name)
              .setIcon(FILE_MENU_ICONS[cmd.id] ?? 'file')
              // 同一 section 会被 Obsidian 归成一组，自带与原生菜单项的视觉分隔
              .setSection('attachment-suite')
              .onClick(() => void cmd.runForNote?.(file.path)),
          );
        }
      }),
    );
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

  /**
   * 装好「库索引就绪」的判定（第一道防线）。
   *
   * 主信号是 `metadataCache.on('resolved')`——它的语义就是"缓存已解析完所有文件"，
   * 耗时随库自适应，不像固定毫秒数那样在大库上失效。
   *
   * 兜底：若宿主因任何原因没发它就绪事件，`settleDeadlineMs` 之后按"已就绪"放行并记 warn。
   * 这**只影响可用性**——否则自动处理会永久失效，那是另一类缺陷（"承诺了却不生效"）；
   * 安全性不受影响：真有批量事件在途时仍会被第二道防线的批量护栏拦下。
   */
  private armSettleWatch(): void {
    this.registerEvent(
      this.app.metadataCache.on('resolved', () => this.markVaultSettled('metadataCache.resolved')),
    );
    this.settleTimerId = window.setTimeout(() => {
      this.settleTimerId = null;
      if (this.gate.settledAt !== 0) return;
      logger.warn(
        `未在 ${this.automationGuard.settleDeadlineMs}ms 内收到索引就绪事件，按已就绪兜底放行` +
          `（批量护栏仍然生效）`,
      );
      this.markVaultSettled('兜底超时');
    }, this.automationGuard.settleDeadlineMs);
    this.register(() => {
      if (this.settleTimerId !== null) window.clearTimeout(this.settleTimerId);
      this.settleTimerId = null;
    });
  }

  /** 标记库索引已就绪（幂等，只认第一次）。 */
  private markVaultSettled(source: string): void {
    if (this.gate.settledAt !== 0) return;
    this.gate.settledAt = Date.now();
    this.settleSource = source;
    if (this.settleTimerId !== null) {
      window.clearTimeout(this.settleTimerId);
      this.settleTimerId = null;
    }
    logger.debug(
      `库索引已就绪（${source}）：此前已挡下 ${this.autoStats.suppressedNotSettled} 个启动期 changed 事件`,
    );
  }

  /** md/canvas 内容或元数据变化 → 索引失效 + 标记待自动处理（轮询统一起处理）。 */
  private onVaultFileChange(file: TAbstractFile | null): void {
    this.scheduleDirty();
    if (!file || typeof file.path !== 'string') return;
    if (!/\.(md|canvas)$/i.test(file.path)) return;
    if (!this.settings.automation?.enabled) return;
    if (isAutoBusy()) return; // 自动处理的自身写入不再自我标记，避免每 5 秒空跑放大
    // 时序判定（库就绪门 + 再武装窗口）全部交给纯函数。
    // 留在这里的话，它被包在事件回调 + 异步队列 + 定时器中间，只能靠 sleep 验证——既慢又不稳，
    // 而且正是这里曾用 `isTestEnv ? 0 : 1500` 把整条分支在测试里关掉（改坏了也不会红）。
    const decision = decideMarkDirty({
      now: Date.now(),
      gate: this.gate,
      opts: this.automationGuard,
      lastAutoAtForNote: this.autoProcessedAt.get(file.path) ?? null,
    });
    if (!decision.mark) {
      if (decision.reason === 'vault-not-settled') this.autoStats.suppressedNotSettled++;
      else if (decision.reason === 'post-settle-quiet') this.autoStats.suppressedQuiet++;
      else this.autoStats.suppressedRearm++;
      logger.debug(`不标记待自动处理：${file.path}（${describeMarkSkip(decision.reason)}）`);
      return;
    }
    this.dirtyNotes.add(file.path);
    logger.debug(`标记待自动处理：${file.path}`);
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
    } catch (e) {
      // 剪贴板读取失败时静默跳过，避免影响粘贴事件本身（粘贴失败是宿主/系统层的事，
      // 不该由本插件弹提示）——但留痕：否则"粘贴没触发自动处理"无从排查。
      logger.debug(`剪贴板读取失败，跳过本次粘贴触发：${e instanceof Error ? e.message : String(e)}`);
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

  /**
   * 按当前设置重新装载轮询定时器（供设置页在「自动处理刷新间隔」变更后调用）。
   *
   * 为什么必须有：`setInterval` 的周期在创建那一刻就固定了，只改设置不改定时器，
   * 用户会看到"改了间隔完全没反应，只有重载插件才生效"——这正是本仓库反复出现的
   * 「设置项承诺了却不生效」缺陷。放在 main 而不是设置页，是因为只有这里能拿到句柄。
   *
   * 幂等：先清旧句柄再建新的，重复调用不会叠加多个定时器。
   * 注意 `sweepAuto()` 每轮都会重读 `enabled`，故开关本身无需重装定时器。
   */
  restartAutomationSweep(): void {
    if (this.autoIntervalId !== null) {
      window.clearInterval(this.autoIntervalId);
      this.autoIntervalId = null;
    }
    this.startAutomationSweep();
  }

  /**
   * 自动处理的只读诊断（供排查与真实宿主验收取证）。
   *
   * 回答的问题：库索引是什么时候就绪的、由谁触发；启动期有多少 changed 被就绪门挡下
   * （> 0 说明这道门在当前环境里确实在干活）；单次批量护栏拒绝过几次。
   */
  getAutomationDiagnostics(): {
    settled: boolean;
    settleSource: string;
    readyAt: number;
    settledAt: number;
    stats: AutomationStats;
  } {
    return {
      settled: this.gate.settledAt !== 0,
      settleSource: this.settleSource,
      readyAt: this.gate.readyAt,
      settledAt: this.gate.settledAt,
      stats: { ...this.autoStats },
    };
  }

  /**
   * 从磁盘重读并处理当前所有待处理笔记（幂等：已本地化/改名的不再处理）。
   *
   * ⚠️ 整体包一层 try：本方法由 `setInterval` 里的 `void this.sweepAuto()` 调用，
   * **没有调用方 await 它**，插件也没有全局 `unhandledrejection` 兜底 ——
   * 同步段一旦抛错就会变成无人处理的 rejection，表现为"自动处理突然不动了且毫无痕迹"。
   * 逐篇入队各自已有 `.catch`，这里兜的是它们之外的部分。
   */
  private async sweepAuto(): Promise<void> {
    try {
      await this.sweepAutoInner();
    } catch (e) {
      logger.error(`自动处理轮询异常：${e instanceof Error ? e.message : String(e)}`);
      createNoticer(() => this.settings.notificationLevel).error(
        `自动处理轮询出错：${e instanceof Error ? e.message : String(e)}。可先关闭「自动处理」，或运行「检查库一致性」核对库状态。`,
      );
    }
  }

  private async sweepAutoInner(): Promise<void> {
    const s = this.settings;
    if (!s.automation?.enabled || this.queue.isProcessing()) {
      logger.debug(`轮询跳过（自动处理 ${s.automation?.enabled ? '开' : '关'}，队列忙 ${this.queue.isProcessing()}）`);
      return;
    }
    if (this.dirtyNotes.size === 0) return;
    const paths = Array.from(this.dirtyNotes);
    this.dirtyNotes.clear();
    // 第二道防线（fail closed）：一次轮询要处理这么多篇，来源几乎不可能是"用户逐篇编辑"，
    // 而是库索引刷新 / 同步工具 / 批量脚本。整批拒绝并明确告知，绝不替它们改写用户的库。
    const verdict = decideSweep(paths.length, this.automationGuard);
    if (!verdict.allowed) {
      const msg = describeSweepRefusal(verdict.count, verdict.limit);
      logger.warn(`自动处理已整批跳过：${msg}`);
      // 用 error 级：`shouldNotify` 里错误在任何档位（含静默）都会提示。
      // 这是"拒绝服务"，不能因为用户选了静默就变成无声的"功能好像没生效"。
      createNoticer(() => this.settings.notificationLevel).error(msg);
      this.autoStats.sweepRefused++;
      return;
    }
    this.autoStats.sweepProcessed += paths.length;
    logger.debug(`轮询处理 ${paths.length} 篇：${paths.join(', ')}`);
    for (const notePath of paths) {
      void this.queue
        .enqueue(() =>
          runAutoProcess(this.app, this.index, () => this.settings, this.downloader, this.mover, notePath).then((r) => {
            // 处理完成即记入再武装窗口：此后短暂到达的延迟 changed 事件由 onVaultFileChange 吸收
            this.autoProcessedAt.set(notePath, Date.now());
            logger.debug(`自动处理完成 ${notePath}：下载 ${r.downloaded}，命名 ${r.renamed}`);
          }),
        )
        .catch((e) => this.reportBackgroundError('自动处理', notePath, e));
    }
  }

  private onRename(file: TAbstractFile, oldPath: string): void {
    // 触发全文索引失效
    this.scheduleDirty();
    // 仅笔记（md/canvas）移动需要联动；附件被本插件改名/移动（自动命名、归档、收集等）
    // 也会触发 rename 事件，若不按扩展名过滤，会为自己的每次写入都入队一次 runFollowNoteMove：
    // 既让 TaskQueue 空转堆积，又可能在 followNoteMove + 按类别子目录下把二进制附件当文本读取。
    if (!(file instanceof TFile)) return;
    if (!/\.(md|canvas)$/i.test(file.path)) return;
    void this.queue
      .enqueue(() => runFollowNoteMove(this.app, this.mover, () => this.settings, file.path, oldPath))
      .catch((e) => this.reportBackgroundError('笔记移动后跟随附件', file.path, e));
  }

  /**
   * 后台队列任务失败时的统一反馈。
   *
   * 队列任务的调用方一律 `void` 丢弃返回值，不在这里 catch 的话失败就是无人处理的 rejection：
   * 控制台一行告警，用户侧毫无提示。而这两条链路（自动处理、笔记移动跟随附件）都在后台跑，
   * 用户本来就看不见过程，失败信息必须主动送达，否则会误以为"功能没生效"。
   */
  private reportBackgroundError(label: string, target: string, e: unknown): void {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`${label}失败 ${target}: ${msg}`);
    createNoticer(() => this.settings.notificationLevel).error(`${label}失败：${target}。${msg}`);
  }

  private scheduleDirty(): void {
    if (this.indexDirtyTimer !== null) {
      window.clearTimeout(this.indexDirtyTimer);
    }
    // 300ms 去抖
    this.indexDirtyTimer = window.setTimeout(() => {
      this.indexDirtyTimer = null;
      this.index.markDirty();
      // 通过队列入队一次空任务，确保后续命令拿到最新快照顺序执行（空任务不会失败，故无需 catch）
      void this.queue.enqueue(async () => undefined);
    }, 300);
  }
}