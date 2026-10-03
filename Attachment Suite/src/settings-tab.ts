/** 设置面板：按能力分区；说明用干净文字（不带反引号/代码样式），并附推荐取值。 */

import { App, PluginSettingTab, Setting, type TextComponent } from 'obsidian';
import type PluginMain from './main';
import { currentPlatform, type PluginSettings } from './settings';
import type { AttachmentCategory, Platform } from './core';
import { sanitizeNameFragment } from './features/name-formatter-core';
import { createNoticer } from './notify';

/** 当前平台的界面名（用于「路径修复的目标系统」下拉）。 */
function currentPlatformLabel(): string {
  const p = currentPlatform();
  return p === 'mac' ? 'macOS' : p === 'linux' ? 'Linux' : 'Windows';
}

/**
 * 类别的**基础**标签集（中文）。两份按用途裁剪过的列表都建在它之上，改它会同时影响两处。
 *
 * 之所以要分开，是因为两侧的「可选类别」并不相同：
 * - **本地化白名单** = 本列表**去掉「其他」**（`LOCALIZE_CATEGORY_OPTIONS`）——`misc` 只对应
 *   `bin`/`zip` 兜底分支、不在受管扩展名名单里，勾了也永不落盘；
 * - **命名用词** = 本列表**加上「网页」**（`NAMING_CATEGORY_OPTIONS`）——命名侧要处理库里
 *   已存在的 `.html` 附件，`classify()` 仍会产出 `webpage`。
 *
 * 本列表**刻意不含 `webpage`**（HTML 文档永不落存，本地化侧不提供该开关）。
 */
const CATEGORY_OPTIONS: Array<{ value: AttachmentCategory; label: string }> = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'pdf', label: 'PDF' },
  { value: 'document', label: '文档' },
  { value: 'misc', label: '其他' },
];

/**
 * 命名用词的可编辑类别 = 本地化类别 + `网页`。
 *
 * 为什么**不能**沿用 `CATEGORY_OPTIONS`：那份少一个 `webpage`，理由只在本地化侧成立
 * （HTML 不落存）。命名侧并不成立——`classify()` 仍会为 `.html` 产出 `webpage`，
 * `DEFAULT_SETTINGS.naming.categoryWords.webpage` 也一直被命名逻辑消费，
 * 而命名区文案写着"各类别在统一命名时写入名字的词语……可改成中文"。
 * 复用同一份列表的结果是：这个键**有值、有用、界面上却没有入口**（改不了）。
 */
const NAMING_CATEGORY_OPTIONS: Array<{ value: AttachmentCategory; label: string }> = [
  ...CATEGORY_OPTIONS,
  { value: 'webpage', label: '网页' },
];

/**
 * 本地化白名单的可选类别 = `CATEGORY_OPTIONS` **去掉「其他」**。
 *
 * 为什么连「其他」也不提供：`misc` 只对应 `classify()` 的 `bin` / `zip` 兜底分支，两者都不在受管
 * 扩展名名单里——`localize-media.ts` 落盘前会用 `isManagedAttachment()` 把它们一并挡下。留着它
 * 就是一个"勾了却永远不生效"的死选项，与 `webpage` 同理（故与 `webpage` 一样不提供开关）。
 * 注：默认值里仍保留 `misc`，它让这类下载走"跳过非受管类型"这条更具体的计数与日志，不做迁移。
 */
const LOCALIZE_CATEGORY_OPTIONS = CATEGORY_OPTIONS.filter((o) => o.value !== 'misc');

/** 把逗号分隔的输入解析为去空白、去空的字符串数组（供域名名单等列表型设置使用）。 */
function splitList(input: string): string[] {
  return input
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export class AttachmentSettingTab extends PluginSettingTab {
  /**
   * 受父开关联动的设置区容器：父开关一变就统一切换其中控件的可编辑状态。
   * 见 `gatedSection()` 的说明。
   */
  private gated: Array<{ el: HTMLElement; enabled: () => boolean }> = [];

  constructor(
    app: App,
    private readonly plugin: PluginMain,
  ) {
    super(app, plugin);
  }

  get s(): PluginSettings {
    return this.plugin.settings;
  }

  /**
   * 落盘设置，并在**失败时给出可见提示**。
   *
   * ⚠️ 为什么必须兜住 rejection：`PluginMain.saveSettings()` 内部只有 `await saveData(...)`，
   * 它自己不兜；而插件**没有全局 `unhandledrejection` 处理器**。任其 reject 的结果是
   * "改了设置、界面看着生效、实际没落盘、重启变回旧值"——用户零感知，正是本仓库反复出现的
   * 「界面显示值 ≠ 实际生效值」。所以这里走 error 级（`shouldNotify` 对 error 在任何档位都放行，
   * 含「静默」）：保存失败属于"必须无条件可见"的一类。
   */
  private persist(label: string, op: Promise<void>): void {
    void op.catch((e: unknown) => {
      createNoticer(() => this.s.notificationLevel).error(
        `${label}失败：${e instanceof Error ? e.message : String(e)}。改动可能不会在重启后保留。`,
      );
    });
  }

  private save(): void {
    this.persist('设置保存', this.plugin.saveSettings());
  }

  /**
   * 建一个「受父开关控制」的设置区容器。
   *
   * 存在意义：父开关（如「启用统一命名」）关闭后，其下的子项原本仍可编辑、看起来也生效，
   * 但命令实际不执行——用户会以为"改了设置没反应"。把子项收进独立容器后，
   * `applyGates()` 能一次性把它们禁用并降低不透明度，与 Obsidian 设置页惯例一致。
   */
  private gatedSection(host: HTMLElement, enabled: () => boolean): HTMLElement {
    const el = host.createDiv({ cls: 'iap-settings-gated' });
    this.gated.push({ el, enabled });
    return el;
  }

  /** 依据各父开关的当前状态，刷新所有受控子项的可用性。 */
  private applyGates(): void {
    for (const g of this.gated) {
      const on = g.enabled();
      g.el.toggleClass('iap-settings-gated-off', !on);
      const controls = g.el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
        'input, select, textarea, button',
      );
      for (const ctl of Array.from(controls)) ctl.disabled = !on;
    }
  }

  /**
   * 绑定数字型输入，保证"看到的 = 生效的"。
   *
   * 旧实现的缺陷：输入 500 想表示 500ms 超时，代码静默钳成 30000 写盘，输入框却仍显示 500，
   * 用户根本不知道自己的值没生效（「最小文件大小」还能把负数存进配置）。
   * 这里输入过程中不打断（避免边打边跳——否则 timeoutMs 的 "5" 会被立刻改写），
   * 但**失焦时把实际生效值回写到输入框**，偏差一定看得见。
   *
   * @param read 读取当前生效值（用于初始显示）。
   * @param write 写入归一化后的值。
   * @param normalize 把任意输入文本折算为合法生效值（含范围钳制与非法值兜底）。
   * @param onCommit 失焦提交后的附加动作（如"让新间隔真正生效"）。
   *   只在失焦时调用、不在每次按键时调用：后者会在用户逐位输入时反复重装定时器。
   */
  private bindNumber(
    t: TextComponent,
    read: () => number,
    write: (n: number) => void,
    normalize: (raw: string) => number,
    onCommit?: () => void,
  ): void {
    t.setValue(String(read()));
    t.onChange((raw) => {
      write(normalize(raw));
      this.save();
    });
    t.inputEl.addEventListener('blur', () => {
      const effective = normalize(t.inputEl.value);
      write(effective);
      this.save();
      if (t.inputEl.value !== String(effective)) t.inputEl.value = String(effective);
      onCommit?.();
    });
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.gated = [];

    // 开箱即用说明：40 多个选项平铺出来，本身就会让人以为"必须先配点什么"。
    // 所以第一句就说清楚"不改也能用"，并把唯一真正需要用户决定的那一项指出来。
    containerEl.createEl('p', {
      text: '默认设置已按常见做笔记的习惯配好：装上就能直接用，不必逐项调整。真正需要你决定的通常只有一项——「附件目录来源」，下面会按你库里的实际情况给出提示。其余选项都写了推荐值与适用场景，改之前建议先读那行说明。',
      cls: 'iap-settings-section-hint iap-settings-quickstart',
    });

    containerEl.createEl('h2', { text: '通用' });
    containerEl.createEl('p', {
      text: 'Attachment Suite 把库内附件的「本地化 → 命名 → 体检 → 收集 → 清理 → 导出」串成一套流程。各能力相互独立，可只开需要的那部分。带总开关的分组，总开关关闭后其下子项不再生效（会显示为不可编辑）。',
      cls: 'iap-settings-section-hint',
    });
    new Setting(containerEl)
      .setName('附件目录来源')
      .setDesc(
        // ⚠️ 引用的 Obsidian 原生标签必须逐字对上宿主语言包，否则用户按图索骥找不到那一项。
        // 取值来源：Obsidian 安装目录 resources/obsidian.asar 的 zh-CN 段
        // （`option-new-attachment-location` = 「附件默认存放路径」，`file.name` = 「文件与链接」）。
        '跟随 Obsidian 设置：采用 Obsidian「设置 → 文件与链接 → 附件默认存放路径」里的位置，与本插件保持一致（推荐——一个地方说了算，不会出现「Obsidian 显示放在 A、插件却放到 B」）。自定义：使用下方填写的目录，可覆盖 Obsidian 的默认位置。',
      )
      .addDropdown((d) =>
        d
          .addOption('obsidian', '跟随 Obsidian 设置')
          .addOption('custom', '自定义目录')
          .setValue(this.s.attachmentFolderMode)
          .onChange((v) => {
            this.s.attachmentFolderMode = v as PluginSettings['attachmentFolderMode'];
            this.save();
            this.applyGates();
            renderFolderHint();
          }),
      );

    /**
     * 按**实际生效**的附件目录给出针对性提示。
     *
     * 存在的意义：「跟随 Obsidian」是本插件的默认（也是唯一不会产生"两处配置打架"的选择），
     * 但 Obsidian 的出厂默认是**库根**——于是新用户粘贴的图会和笔记混在同一层目录，
     * 而这件事通常要等"库乱了"才被注意到。这里当场说清楚，并给出两种改法。
     *
     * 判定口径必须与 `effectiveAttachmentFolder` + `resolveAttachmentDir` 一致：
     * 只有字面 `'/'` 才是"落库根"；非字符串/空串会回退到「自定义目录」值（笔记相对），
     * 那种情况不该报这个警告。
     */
    const folderHint = containerEl.createDiv({ cls: 'iap-settings-hint-dynamic' });
    const renderFolderHint = (): void => {
      folderHint.empty();
      if (this.s.attachmentFolderMode !== 'obsidian') return;
      const cfg = (this.app as any)?.vault?.getConfig?.('attachmentFolderPath') as unknown;
      if (cfg !== '/') return;
      folderHint.createEl('p', {
        // 这里的三个标签都是 Obsidian 自己的文案，必须逐字一致（来源同上方注释）：
        // 「附件默认存放路径」/「当前文件所在的文件夹」/「当前文件所在文件夹下指定的子文件夹」。
        text: '提示：你的 Obsidian 附件默认存放路径是「库根」，附件会和笔记混在同一层目录。插件如实跟随这个设置，不会背着你改。想让附件归到各笔记旁边，任选一种改法：① 在 Obsidian「设置 → 文件与链接 → 附件默认存放路径」改为「当前文件所在的文件夹」（推荐，附件与笔记放在同一目录，Obsidian 与插件会归到同一处）；若想要 assets/ 那样单独的子目录，选「当前文件所在文件夹下指定的子文件夹」并把「子文件夹名称」填成 assets；② 或把上面的来源改为「自定义目录」并填 ./assets。',
        cls: 'iap-settings-warn',
      });
    };
    renderFolderHint();
    // 始终渲染、按来源开关禁用：比"隐藏"更易被发现，也不会让用户以为设置项消失了
    const customDirSection = this.gatedSection(containerEl, () => this.s.attachmentFolderMode === 'custom');
    new Setting(customDirSection)
      .setName('自定义附件目录')
      .setDesc(
        '附件存放目录。推荐用 ./assets 或 ./attachments，表示存放在笔记所在目录下的同名目录，这样移动笔记时更易跟随；也可以用 . 表示紧邻笔记，或用 assets 表示库根下的 assets。支持 ${notename}、${parent}、${date} 等模板变量。命名、本地化、笔记移动跟随都会以这里为准。',
      )
      .addText((t) =>
        t.setPlaceholder('./assets 或 ./attachments').setValue(this.s.attachmentFolder).onChange((v) => {
          this.s.attachmentFolder = v;
          this.save();
        }),
      );
    new Setting(containerEl)
      .setName('通知级别')
      .setDesc(
        '决定操作完成后提示的详细程度。静默：只出错时提示；仅摘要：显示成功、失败、跳过三项汇总（推荐）；详细：显示更多过程信息（含全库任务的进度）。注意：失败提示在任何级别都会出现——它意味着文件状态与预期不一致，不适合静默。提示按级别分级停留时长：错误 5 秒、执行结果 3 秒、过程信息 2 秒；消息越长（换行越多）停留越久，长提示也能完整读完。',
      )
      .addDropdown((d) =>
        d
          .addOption('silent', '静默')
          .addOption('summary', '仅摘要')
          .addOption('verbose', '详细')
          .setValue(this.s.notificationLevel)
          .onChange((v) => {
            this.s.notificationLevel = v as PluginSettings['notificationLevel'];
            this.save();
          }),
      );
    new Setting(containerEl)
      .setName('详细诊断日志')
      .setDesc('把日志级别降到 debug，向开发者控制台（Ctrl/Cmd+Shift+I）输出更详细的过程信息：索引重建与缓存命中、每条命令的计划明细、每次移动的判定结果。排查「命令为什么没生效／附件为什么没动」时开启；平时保持关闭——这些日志含库内文件路径。与上面的「通知级别」分工不同：那个决定用户可见的提示，这个只影响控制台。命令行里也有「切换诊断日志（排查用）」可临时开关，两者是同一个状态。')
      .addToggle((t) =>
        t.setValue(this.s.debugLogging).onChange((v) => {
          // 走插件的同一条路径（改设置 → 立即生效 → 落盘），与「切换诊断日志」命令共用实现。
          // 这里**不调 `this.save()`**：`setDebugLogging` 内部已落盘，再存一次只会掩盖"回调没生效"。
          // 但落盘失败同样必须可见——否则开关看着打开了、重启又变回去。
          this.persist('诊断日志开关保存', this.plugin.setDebugLogging(v));
        }),
      );
    new Setting(containerEl)
      .setName('全局排除目录（逗号分隔）')
      .setDesc('这些目录（相对库根）中的笔记不做本地化、其中的附件不会被判为未用而清理；清理未用附件、清理空附件目录、导出未用附件时也会一并把这里的目录视为排除（与「清理」的排除目录叠加生效）。多个目录用英文逗号分隔。')
      .addText((t) =>
        t
          .setValue((this.s.paths?.exclude ?? []).join(', '))
          .setPlaceholder('_resources, 笔记归档')
          .onChange((v) => {
            this.s.paths.exclude = splitList(v);
            this.save();
          }),
      );

    containerEl.createEl('h2', { text: '自动化' });
    new Setting(containerEl)
      .setName('自动处理（本地化 + 统一命名）')
      .setDesc(
        '开启后，当你编辑中的笔记出现新的外链图片或附件时，插件会自动把外链图片下载到本地并统一命名，无需手动执行命令。需要下方「本地化」开启才会下载，「统一命名」是否执行由下方「命名」开关决定；处理完成后会在右上角弹出一条结果通知。',
      )
      .addToggle((t) => t.setValue(this.s.automation.enabled).onChange((v) => {
        this.s.automation.enabled = v;
        this.save();
        this.applyGates();
      }));
    const automationSection = this.gatedSection(containerEl, () => this.s.automation.enabled);
    new Setting(automationSection)
      .setName('自动处理刷新间隔（秒）')
      .setDesc('每隔 N 秒扫描一次待处理笔记并执行本地化与统一命名。数值越小反应越快，但写入更频繁；最小 1，默认 5，无特殊需求建议保持默认。超出范围的输入会在离开输入框时被纠正为实际生效值，并在失焦后立即按新间隔重新装载定时器（无需重载插件）。')
      .addText((t) =>
        this.bindNumber(
          t,
          () => this.s.automation.interval,
          (n) => {
            this.s.automation.interval = n;
          },
          (raw) => {
            const n = Number.parseInt(raw, 10);
            return Number.isNaN(n) ? 5 : Math.max(1, n);
          },
          () => this.plugin.restartAutomationSweep(),
        ),
      );

    containerEl.createEl('h2', { text: '命名' });
    new Setting(containerEl)
      .setName('启用统一命名')
      .setDesc(
        '开启后，本地化的新附件会被自动改名，也可以用「重命名当前笔记附件」命令，把附件统一为「笔记名_类别_序号」的格式（下划线是默认的「连接符」，可在下方修改），便于整理和查找。关闭则附件保持原始文件名。推荐开启。',
      )
      .addToggle((t) => t.setValue(this.s.naming.enabled).onChange((v) => {
        this.s.naming.enabled = v;
        this.save();
        this.applyGates();
      }));
    const namingSection = this.gatedSection(containerEl, () => this.s.naming.enabled);
    new Setting(namingSection)
      .setName('连接符')
      .setDesc('名字各部分之间的分隔符号，建议保持默认下划线 _。例如下划线得到 笔记_image_001，短横线得到 笔记-image-001。不能包含 / 等路径分隔符（会被自动去掉），也不能留空——这两种写法会让附件被放进意外的子目录，或让已命名的附件无法被识别而反复重命名。')
      .addText((t) => {
        t.setValue(this.s.naming.connector);
        t.onChange((raw) => {
          // 立即清洗并把纠正后的值回写到输入框：连接符会被直接拼进文件名，
          // 用户必须当场看到实际生效的是什么（详见 name-formatter-core.sanitizeNameFragment）。
          const v = sanitizeNameFragment(raw, '_');
          this.s.naming.connector = v;
          this.save();
          if (t.inputEl.value !== v) t.inputEl.value = v;
        });
      });
    new Setting(namingSection)
      .setName('命名加入时间')
      .setDesc('在序号之后追加 14 位时间戳（年月日时分秒），通常无需开启。适合同一笔记频繁新增多个文件、想按时间区分的场景。')
      .addToggle((t) => t.setValue(this.s.naming.addTime).onChange((v) => {
        this.s.naming.addTime = v;
        this.save();
      }));
    new Setting(namingSection)
      .setName('命名加入路径哈希')
      .setDesc('在名字末尾追加 8 位路径哈希，用于区分来自不同目录但同名笔记的附件，降低跨笔记同名冲突。仅在不同目录存在同名笔记、或笔记会移动目录时建议开启。')
      .addToggle((t) => t.setValue(this.s.naming.addPathHash).onChange((v) => {
        this.s.naming.addPathHash = v;
        this.save();
      }));
    new Setting(namingSection)
      .setName('名称带类别')
      .setDesc('在名字中写入附件类别，一眼即可分辨类别，例如 image（图片）、video（视频）、pdf（PDF）。推荐开启。')
      .addToggle((t) => t.setValue(this.s.naming.honorCategory).onChange((v) => {
        this.s.naming.honorCategory = v;
        this.save();
      }));
    new Setting(namingSection)
      .setName('额外带子类型')
      .setDesc('在类别之后再附上具体格式，例如 image_png、video_mp4。信息更细但名字更长，按需开启。')
      .addToggle((t) => t.setValue(this.s.naming.showSubType).onChange((v) => {
        this.s.naming.showSubType = v;
        this.save();
      }));
    new Setting(namingSection)
      .setName('按类别放入子目录')
      .setDesc('统一命名时，把附件放进「附件目录/类别/」子目录，例如 image/、pdf/，便于按类别归档。')
      .addToggle((t) => t.setValue(this.s.naming.folderByCategory).onChange((v) => {
        this.s.naming.folderByCategory = v;
        this.save();
      }));
    namingSection.createEl('p', {
      text: '命名用词：各类别在统一命名时写入名字的词语。默认使用英文（image、video 等）；可改成中文（图片、视频），或带扩展名的形式（image_png）以增强区分。同样不能包含 / 等路径分隔符，留空则回退为默认英文词。',
      cls: 'iap-settings-section-hint',
    });
    for (const opt of NAMING_CATEGORY_OPTIONS) {
      new Setting(namingSection)
        .setName(`「${opt.label}」命名用词`)
        .setDesc(`统一命名时「${opt.label}」类别写入的名字片段。清空则回退为默认英文词 ${opt.value}。`)
        .addText((t) => {
          t.setPlaceholder(opt.value);
          t.setValue(this.s.naming.categoryWords[opt.value] ?? '');
          t.onChange((raw) => {
            const word = sanitizeNameFragment(raw, '');
            if (word) {
              this.s.naming.categoryWords[opt.value] = word;
            } else {
              // 清空则删除该键，命名时回退为默认英文词
              delete this.s.naming.categoryWords[opt.value];
            }
            this.save();
            if (t.inputEl.value !== word) t.inputEl.value = word;
          });
        });
    }

    containerEl.createEl('h2', { text: '本地化' });
    new Setting(containerEl)
      .setName('启用媒体本地化')
      .setDesc(
        '「本地化当前笔记附件」会把笔记里的外链图片、视频、音频、PDF、文档下载到本地，并改写为本地引用，保证脱机可用。网页（HTML）不会被下载保存，以避免把网页脚本落进库。关闭则不做下载和改写。',
      )
      .addToggle((t) => t.setValue(this.s.localize.enabled).onChange((v) => {
        this.s.localize.enabled = v;
        this.save();
        this.applyGates();
      }));
    const localizeSection = this.gatedSection(containerEl, () => this.s.localize.enabled);
    new Setting(localizeSection)
      .setName('本地化网络 URL')
      .setDesc(
        '是否真的下载 http(s) 类型的外链，推荐保持开启。关闭时只处理笔记内嵌的 data 图片、不发起任何网络请求。它在本地化链路里负责「被认出来的外链要不要真正下载」；下载后存不存，由下方那一组「本地化 图片／视频／…」开关决定。',
      )
      .addToggle((t) => t.setValue(this.s.localize.localizeWebUrls).onChange((v) => {
        this.s.localize.localizeWebUrls = v;
        this.save();
      }));
    new Setting(localizeSection)
      .setName('扩展扫描：普通链接与 HTML 标签')
      .setDesc(
        '决定扫描笔记时「要不要认出这些引用形式」。Markdown 图片嵌入 ![]() 始终会认；开启后才会额外认出普通链接 [text](url) 和 <img>/<audio>/<video> 标签并一起改写。默认开启：这三种写法是同一个意图，只认 markdown 图片会让用户遇到「明明有图却没被处理」。它是本地化链路的第一环——没被认出的引用，后续不会做任何处理。另注：笔记 YAML frontmatter 中的媒体外链（如 cover: https://…）始终会被识别，不受本开关影响。',
      )
      .addToggle((t) => t.setValue(this.s.localize.scanHtmlAndLinks).onChange((v) => {
        this.s.localize.scanHtmlAndLinks = v;
        this.save();
      }));
    new Setting(localizeSection)
      .setName('用 MD5 作为新文件名')
      .setDesc(
        '开启后按内容哈希命名（形如 9e599….jpg），同一张图贴多次只保存一份、节省空间且名字稳定合法，推荐开启。关闭则用下载时的原始文件名，更直观但不去重，特殊字符时可能需要路径修复。',
      )
      .addToggle((t) => t.setValue(this.s.localize.useMd5ForNew).onChange((v) => {
        this.s.localize.useMd5ForNew = v;
        this.save();
      }));
    new Setting(localizeSection)
      .setName('拦截内网与本机地址')
      .setDesc(
        '开启后，指向本机（127.0.0.1、localhost）、局域网（192.168.x、10.x、172.16~31.x）与链路本地/保留地址（169.254.x、云元数据 169.254.169.254）的外链会被跳过、不发起请求，并计入「拦截内网」计数，推荐保持开启。若你确实需要用内网图床，可关闭此项。注意：仅在下载前按字面主机名校验，无法解析 DNS，故「域名实际解析到内网」的情况不在拦截范围内。',
      )
      .addToggle((t) => t.setValue(this.s.localize.blockPrivateHosts).onChange((v) => {
        this.s.localize.blockPrivateHosts = v;
        this.save();
      }));
    // —— 以下是"设过一次就不用再碰"的细项，折叠起来 ——
    // 理由：40 多个选项平铺会让人以为"必须配点什么"，这本身就是开箱即用的阻力。
    // 常用项（上面的开关）保持可见，细项收进「高级」，默认值原样生效、不影响任何行为。
    localizeSection.createEl('p', {
      text: '以下细项默认值适用于绝大多数场景，通常无需改动；只在需要限速、限量或对接自建图床时才调整。',
      cls: 'iap-settings-section-hint',
    });
    const advancedNet = localizeSection.createEl('details', { cls: 'iap-settings-advanced' });
    advancedNet.createEl('summary', { text: '高级：体积、超时、重试、域名名单、限速、并发' });
    new Setting(advancedNet)
      .setName('最小文件大小（KB，0 为不限）')
      .setDesc('小于该数值的下载会被跳过，常用于过滤占位图和微型图标。默认 0 表示不过滤、接收全部，建议保持 0；如需过滤微小占位图，可设 2~10。负数按 0 处理。')
      .addText((t) =>
        this.bindNumber(
          t,
          () => this.s.localize.minSizeKb,
          (n) => {
            this.s.localize.minSizeKb = n;
          },
          (raw) => {
            const n = Number(raw);
            return Number.isFinite(n) ? Math.max(0, n) : 0;
          },
        ),
      );
    new Setting(advancedNet)
      .setName('单文件体积上限（MB）')
      .setDesc(
        '单个文件超过该体积则不下载，默认 100。下载前会先探测响应声明的长度（HEAD），超限即中止，避免把超大文件整体读入内存；对未声明长度的响应，则在下载完成后按同一上限丢弃。小于 1 视为无效输入，按默认 100 处理。',
      )
      .addText((t) =>
        this.bindNumber(
          t,
          () => this.s.localize.maxDownloadMb,
          (n) => {
            this.s.localize.maxDownloadMb = n;
          },
          (raw) => {
            const n = Number(raw);
            return Number.isFinite(n) && n >= 1 ? n : 100;
          },
        ),
      );
    new Setting(advancedNet)
      .setName('下载重试次数')
      .setDesc('某个文件下载失败时最多重试的次数，建议保持默认 3（过大只会拖慢失败下载）。小于 1 按 1 处理。')
      .addText((t) =>
        this.bindNumber(
          t,
          () => this.s.localize.tryCount,
          (n) => {
            this.s.localize.tryCount = n;
          },
          (raw) => {
            const n = Number(raw);
            return Number.isFinite(n) && n >= 1 ? n : 1;
          },
        ),
      );
    new Setting(advancedNet)
      .setName('单文件下载超时（毫秒）')
      .setDesc('单个文件下载超过该毫秒数则放弃。默认 30000（30 秒）。小于 1000 视为无效输入，按默认 30000 处理。')
      .addText((t) =>
        this.bindNumber(
          t,
          () => this.s.localize.timeoutMs,
          (n) => {
            this.s.localize.timeoutMs = n;
          },
          (raw) => {
            const n = Number(raw);
            return Number.isFinite(n) && n >= 1000 ? n : 30000;
          },
        ),
      );
    new Setting(advancedNet)
      .setName('域名白名单（逗号分隔）')
      .setDesc(
        '只允许从这些域名下载；留空表示不限制。支持通配：*.example.com 会同时匹配 example.com 与其所有子域，* 表示任意域名。多个用英文逗号分隔。注意：白名单中显式列出的域名会覆盖「拦截内网与本机地址」（便于使用自建内网图床）。',
      )
      .addText((t) =>
        t
          .setValue(this.s.localize.allowHosts.join(', '))
          .setPlaceholder('cdn.example.com, *.githubusercontent.com')
          .onChange((v) => {
            this.s.localize.allowHosts = splitList(v);
            this.save();
          }),
      );
    new Setting(advancedNet)
      .setName('域名黑名单（逗号分隔）')
      .setDesc(
        '拒绝从这些域名下载，优先级最高（连白名单也拦不住它）。适合屏蔽已知的统计/追踪域。支持与白名单相同的通配写法。',
      )
      .addText((t) =>
        t
          .setValue(this.s.localize.denyHosts.join(', '))
          .setPlaceholder('tracker.example.com, *.adnet.example')
          .onChange((v) => {
            this.s.localize.denyHosts = splitList(v);
            this.save();
          }),
      );
    new Setting(advancedNet)
      .setName('仅允许白名单中的域名')
      .setDesc(
        '开启后进入「默认拒绝」模式：只有命中「域名白名单」的 http 引用才会被下载，其余一律跳过并计入「名单」拦截数。适合处理来源不可信的库；日常使用建议关闭。注意：白名单为空时，开启此项将导致所有 http 外链都不下载。',
      )
      .addToggle((t) => t.setValue(this.s.localize.hostAllowlistOnly).onChange((v) => {
        this.s.localize.hostAllowlistOnly = v;
        this.save();
      }));
    new Setting(advancedNet)
      .setName('同主机下载最小间隔（毫秒）')
      .setDesc(
        '对同一个域名，两次下载之间的最小等待时间，用于避免短时间内对同一站点发起大量请求。默认 0（不限速）。仅在处理大规模外链时才有意义，例如设为 200 表示每秒最多约 5 次请求。',
      )
      .addText((t) =>
        this.bindNumber(
          t,
          () => this.s.localize.perHostIntervalMs,
          (n) => {
            this.s.localize.perHostIntervalMs = n;
          },
          (raw) => {
            const n = Number(raw);
            return Number.isFinite(n) && n >= 0 ? n : 0;
          },
        ),
      );
    new Setting(advancedNet)
      .setName('并发下载数')
      .setDesc(
        '同时进行的下载数量，默认 1（完全串行，最稳妥）。调大可以加快大量外链的本地化速度，但会增加瞬时请求量与内存占用；处理来源不可信的库时建议保持 1。取值 1~16，小于 1 按 1 处理、超过 16 按 16 处理。',
      )
      .addText((t) =>
        this.bindNumber(
          t,
          () => this.s.localize.maxConcurrent,
          (n) => {
            this.s.localize.maxConcurrent = n;
          },
          (raw) => {
            const n = Math.floor(Number(raw));
            return Number.isFinite(n) && n >= 1 ? Math.min(n, 16) : 1;
          },
        ),
      );
    localizeSection.createEl('p', {
      text: '允许本地化的类别（下面这几类默认全开；「网页」与「其他」不提供开关——HTML 永不落盘，「其他」也不对应任何受管类型，勾了也不会生效）。至少保留一个类别——取消最后一个会被拒绝，开关会自动回到「开」。文件下载后按实际识别出的类别（图片/视频/音频/PDF/文档）判断，只有落在勾选的白名单里才保存并改写链接，否则丢弃。本地化的完整链路是：扩展扫描「认哪些引用」→ 本地化网络 URL「要不要下载」→ 本白名单「要不要存」，三环都通过才会保存。',
      cls: 'iap-settings-section-hint',
    });
    for (const opt of LOCALIZE_CATEGORY_OPTIONS) {
      new Setting(localizeSection)
        .setName(`本地化 ${opt.label}`)
        .setDesc(`允许把识别为「${opt.label}」的附件下载到本地。`)
        .addToggle((t) => {
          t.setValue(this.s.localize.allowedCategories.includes(opt.value)).onChange((v) => {
            const arr = this.s.localize.allowedCategories;
            const idx = arr.indexOf(opt.value);
            if (v && idx < 0) {
              // 至少保留一个类别，避免全部关闭导致本地化永久空转
              arr.push(opt.value);
            } else if (!v && idx >= 0 && arr.length > 1) {
              arr.splice(idx, 1);
            }
            this.s.localize.allowedCategories = arr;
            this.save();
            // 把**实际生效状态**回写到开关。只剩一个类别时上面那次取消会被拒绝——
            // 不回写的话开关会停在「关」而配置里仍是「开」，正是本页明令禁止的
            // 「界面显示值 ≠ 实际生效值」（与 bindNumber 的失焦回写同一道理）。
            t.setValue(this.s.localize.allowedCategories.includes(opt.value));
          });
        });
    }

    containerEl.createEl('h2', { text: '一致性' });
    new Setting(containerEl)
      .setName('启用一致性')
      .setDesc('总开关。关闭后，「检查库一致性」「修复断链」「修复不兼容路径」「笔记移动时跟随移动附件」都不会工作。')
      .addToggle((t) => t.setValue(this.s.consistency.enabled).onChange((v) => {
        this.s.consistency.enabled = v;
        this.save();
        this.applyGates();
      }));
    const consistencySection = this.gatedSection(containerEl, () => this.s.consistency.enabled);
    new Setting(consistencySection)
      .setName('报告坏链接')
      .setDesc('在「检查库一致性」报告中列出指向不存在的文件的引用，方便定位断链。')
      .addToggle((t) => t.setValue(this.s.consistency.reportBrokenLinks).onChange((v) => {
        this.s.consistency.reportBrokenLinks = v;
        this.save();
      }));
    new Setting(consistencySection)
      .setName('修复不兼容路径')
      .setDesc(
        '「修复不兼容路径」命令会把 Windows 等系统的保留名、非法字符、超长文件名安全改名（例如 CON 改为 CON_），并自动更新引用链接。执行前会先列清单，可取消。',
      )
      .addToggle((t) => t.setValue(this.s.consistency.repairIncompatiblePaths).onChange((v) => {
        this.s.consistency.repairIncompatiblePaths = v;
        this.save();
      }));
    new Setting(consistencySection)
      .setName('路径修复的目标系统')
      .setDesc(
        '按哪套规则判定「不兼容」。默认「仅当前系统」与下拉中对应的那个平台项等价（本机是哪套系统就选哪个，二者效果相同）。平台差异只体现在两项 Windows 专属规则上——盘符前缀（如 C:）与 CON/PRN 等保留名：选「仅当前系统」时，在 macOS/Linux 上这两项不算违规；选「全平台」则一并按 Windows 规则改名（名字更可移植，但改动更多）。非法字符（< > : " / \\ | ? *）与超长文件名在任何平台都判为不兼容。',
      )
      .addDropdown((d) => {
        const cur = this.s.consistency.platforms ?? [];
        const all: Platform[] = ['windows', 'mac', 'linux'];
        const isAll = all.every((p) => cur.includes(p));
        const single = cur.length === 1 ? cur[0] : null;
        // 精确匹配存储值，而不是"长度!=1 就当全平台"：
        // 存量配置里可能存在界面表达不出的组合（如 ['windows','mac']），
        // 一律显示为「全平台」就等于"看到的 ≠ 生效的"——与设置页的基本承诺相悖。
        const key = single ?? (isAll ? 'all' : cur.length === 0 ? 'current' : '__other__');
        d.addOption('current', `仅当前系统（${currentPlatformLabel()}）`)
          .addOption('all', '全平台（可移植，改动更多）')
          .addOption('windows', '仅 Windows')
          .addOption('mac', '仅 macOS')
          .addOption('linux', '仅 Linux');
        if (key === '__other__') {
          // 原样列出，绝不谎报；用户一旦选择其它项即被归一化为可表达的形式
          d.addOption('__other__', `当前配置：${cur.join(' / ') || '（空）'}`);
        }
        d.setValue(key).onChange((v) => {
          if (v === '__other__') return; // 占位项不改变实际配置
          this.s.consistency.platforms =
            v === 'all' ? ['windows', 'mac', 'linux'] : v === 'current' ? [currentPlatform()] : [v as Platform];
          this.save();
        });
      });
    new Setting(consistencySection)
      .setName('笔记移动时跟随移动附件')
      .setDesc(
        '开启后，在文件管理器把笔记拖到其它目录时，会自动把该笔记所在目录下的附件目录（即 ./assets 这类相对目录）中的对应附件一并迁到新目录，并保持链接。默认开启——这类目录下不跟随就等于「移动笔记即断链」。附件目录是库根或绝对路径时本项无任何作用。',
      )
      .addToggle((t) => t.setValue(this.s.consistency.followNoteMove).onChange((v) => {
        this.s.consistency.followNoteMove = v;
        this.save();
      }));
    new Setting(consistencySection)
      .setName('断链修复：相似度推荐')
      .setDesc('修复断链时，对无同名候选的断链按名称相似度推荐候选文件（如 pic.png 被改名 pic-v2.png），由你选择确认后重链。')
      .addToggle((t) => t.setValue(this.s.consistency.fuzzySuggest).onChange((v) => {
        this.s.consistency.fuzzySuggest = v;
        this.save();
      }));
    new Setting(consistencySection)
      .setName('相似度阈值')
      .setDesc(`仅推荐相似度不低于该值的候选（0~1，推荐 0.6）。值越低推荐越多、噪音越大。`)
      .addSlider((sl) =>
        sl.setLimits(0, 1, 0.05).setValue(this.s.consistency.fuzzyThreshold).setDynamicTooltip().onChange((v) => {
          this.s.consistency.fuzzyThreshold = v;
          this.save();
        }),
      );
    new Setting(consistencySection)
      .setName('推荐候选上限')
      .setDesc('每条断链最多推荐多少个相似候选（1~10，推荐 5）。')
      .addSlider((sl) =>
        sl.setLimits(1, 10, 1).setValue(this.s.consistency.fuzzyTopN).setDynamicTooltip().onChange((v) => {
          this.s.consistency.fuzzyTopN = v;
          this.save();
        }),
      );

    containerEl.createEl('h2', { text: '清理' });
    new Setting(containerEl)
      .setName('启用清理')
      .setDesc('总开关。关闭后，「清理未用附件」「清理空附件目录」两条命令都不执行。')
      .addToggle((t) => t.setValue(this.s.cleanup.enabled).onChange((v) => {
        this.s.cleanup.enabled = v;
        this.save();
        this.applyGates();
      }));
    const cleanupSection = this.gatedSection(containerEl, () => this.s.cleanup.enabled);
    new Setting(cleanupSection)
      .setName('删除方式')
      .setDesc('清理时如何处置被选中的文件：Obsidian 回收站（推荐，可恢复）；系统回收站；永久删除（不可恢复，需谨慎使用）。')
      .addDropdown((d) =>
        d
          .addOption('.trash', 'Obsidian 回收站')
          .addOption('system-trash', '系统回收站')
          .addOption('permanent', '永久删除')
          .setValue(this.s.cleanup.deleteMode)
          .onChange((v) => {
            this.s.cleanup.deleteMode = v as PluginSettings['cleanup']['deleteMode'];
            this.save();
          }),
      );
    new Setting(cleanupSection)
      .setName('排除目录（逗号分隔）')
      .setDesc('这些目录下的文件，即使没有被任何笔记引用也绝不会被清理。路径相对于库根，多个目录用英文逗号分隔。注意：默认只豁免列出的目录本身，其子目录内的文件仍会被清理；要连带子目录一并豁免，请开启下方「排除目录含子目录」。（「清理空附件目录」不受此限制，排除目录内的各级空目录一律豁免。）')
      .addText((t) =>
        t
          .setValue(this.s.cleanup.excludedFolders.join(', '))
          .setPlaceholder('assets/keep, 笔记归档')
          .onChange((v) => {
            this.s.cleanup.excludedFolders = splitList(v);
            this.save();
          }),
      );
    new Setting(cleanupSection)
      .setName('排除目录含子目录')
      .setDesc('开启后，上方排除目录下的所有子目录也一并豁免；关闭则只豁免列出的目录本身。（清理空附件目录时，排除目录内的各级空目录一律豁免，不受本开关影响。）')
      .addToggle((t) => t.setValue(this.s.cleanup.excludeSubfolders).onChange((v) => {
        this.s.cleanup.excludeSubfolders = v;
        this.save();
      }));
    new Setting(cleanupSection)
      .setName('删除前确认')
      .setDesc('开启后清理前会弹窗列出受影响的文件（清理空附件目录时列出待删的空目录），需要再确认一次才执行；关闭则会直接按删除方式处理（存在误删风险，强烈建议保持开启）。关闭时，清理结果仍会在右上角提示一次，不受「通知级别」影响——否则叠加「静默」就成了一次无人知晓的删除。')
      .addToggle((t) => t.setValue(this.s.cleanup.requireConfirm).onChange((v) => {
        this.s.cleanup.requireConfirm = v;
        this.save();
      }));

    containerEl.createEl('h2', { text: '导出' });
    new Setting(containerEl)
      .setName('启用导出')
      .setDesc('开启后启用「导出当前笔记附件」和「导出未用附件」两条 zip 命令，将附件连同清单元数据打包归档。')
      .addToggle((t) => t.setValue(this.s.exporter.enabled).onChange((v) => {
        this.s.exporter.enabled = v;
        this.save();
      }));

    // 全部子项渲染完毕后统一应用一次联动状态
    this.applyGates();
  }
}
