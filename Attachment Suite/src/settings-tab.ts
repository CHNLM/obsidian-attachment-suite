/** 设置面板：按能力分区；说明用干净文字（不带反引号/代码样式），并附推荐取值。 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type PluginMain from './main';
import type { PluginSettings } from './settings';
import type { AttachmentCategory } from './core';

/** 本地化类别白名单的可选标签（中文）。 */
const CATEGORY_OPTIONS: Array<{ value: AttachmentCategory; label: string }> = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'pdf', label: 'PDF' },
  { value: 'document', label: '文档' },
  { value: 'webpage', label: '网页' },
  { value: 'misc', label: '其他' },
];

export class AttachmentSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: PluginMain,
  ) {
    super(app, plugin);
  }

  get s(): PluginSettings {
    return this.plugin.settings;
  }

  private save(): void {
    void this.plugin.saveSettings();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: '通用' });
    new Setting(containerEl)
      .setName('附件目录来源')
      .setDesc(
        '跟随 Obsidian 设置：采用 Obsidian「文件与链接 → 默认附件文件夹」里的位置，与本插件保持一致（推荐）。自定义：使用下方填写的目录，可覆盖 Obsidian 的默认位置。',
      )
      .addDropdown((d) =>
        d
          .addOption('obsidian', '跟随 Obsidian 设置')
          .addOption('custom', '自定义目录')
          .setValue(this.s.attachmentFolderMode)
          .onChange((v) => {
            this.s.attachmentFolderMode = v as PluginSettings['attachmentFolderMode'];
            this.save();
            this.display();
          }),
      );
    if (this.s.attachmentFolderMode === 'custom') {
      new Setting(containerEl)
        .setName('自定义附件目录')
        .setDesc(
          '附件存放目录。推荐用 ./assets 或 ./attachments，表示存放在笔记所在目录下的同名文件夹，这样移动笔记时更易跟随；也可以用 . 表示紧邻笔记，或用 assets 表示库根下的 assets。支持 ${notename}、${parent}、${date} 等模板变量。命名、本地化、笔记移动跟随都会以这里为准。',
        )
        .addText((t) =>
          t.setPlaceholder('./assets 或 ./attachments').setValue(this.s.attachmentFolder).onChange((v) => {
            this.s.attachmentFolder = v;
            this.save();
          }),
        );
    }
    new Setting(containerEl)
      .setName('通知级别')
      .setDesc(
        '决定操作完成后提示的详细程度。静默：只出错时提示；仅摘要：显示成功、失败、跳过三项汇总（推荐）；详细：显示更多过程信息。提示按级别分级停留时长：错误 5 秒、执行结果 3 秒、过程信息 2 秒；消息越长（换行越多）停留越久，长提示也能完整读完。',
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
      .setName('全局排除目录（逗号分隔）')
      .setDesc('这些目录（相对库根）中的笔记不做本地化、其中的附件不会被判为未使用而清理；清理未用附件时也会一并把这里的目录视为排除（与「清理」的排除目录叠加生效）。多个目录用英文逗号分隔。')
      .addText((t) =>
        t
          .setValue((this.s.paths?.exclude ?? []).join(', '))
          .setPlaceholder('_resources, 笔记归档')
          .onChange((v) => {
            this.s.paths.exclude = v.split(',').map((x) => x.trim()).filter(Boolean);
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
      }));
    new Setting(containerEl)
      .setName('自动处理刷新间隔（秒）')
      .setDesc('每隔 N 秒扫描一次待处理笔记并执行本地化与统一命名。数值越小反应越快，但写入更频繁；最小 1，默认 5，无特殊需求建议保持默认。')
      .addText((t) =>
        t
          .setValue(String(this.s.automation.interval))
          .setPlaceholder('5')
          .onChange((v) => {
            const n = Number.parseInt(v, 10);
            this.s.automation.interval = Number.isNaN(n) ? 5 : Math.max(1, n);
            this.save();
          }),
      );

    containerEl.createEl('h2', { text: '命名' });
    new Setting(containerEl)
      .setName('启用统一命名')
      .setDesc(
        '开启后，本地化的新附件会被自动改名，也可以用“重命名当前笔记附件”命令，把附件统一为“笔记名-类别-序号”的格式，便于整理和查找。关闭则附件保持原始文件名。推荐开启。',
      )
      .addToggle((t) => t.setValue(this.s.naming.enabled).onChange((v) => {
        this.s.naming.enabled = v;
        this.save();
      }));
    new Setting(containerEl)
      .setName('连接符')
      .setDesc('名字各部分之间的分隔符号，建议保持默认下划线 _。例如下划线得到 笔记_image_001，短横线得到 笔记-image-001。')
      .addText((t) => t.setValue(this.s.naming.connector).onChange((v) => {
        this.s.naming.connector = v;
        this.save();
      }));
    new Setting(containerEl)
      .setName('命名加入时间')
      .setDesc('在序号之后追加 14 位时间戳（年月日时分秒），通常无需开启。适合同一笔记频繁新增多个文件、想按时间区分的场景。')
      .addToggle((t) => t.setValue(this.s.naming.addTime).onChange((v) => {
        this.s.naming.addTime = v;
        this.save();
      }));
    new Setting(containerEl)
      .setName('命名加入路径哈希')
      .setDesc('在名字末尾追加 8 位路径哈希，用于区分来自不同目录但同名笔记的附件，降低跨笔记同名冲突。仅在不同目录存在同名笔记、或笔记会移动目录时建议开启。')
      .addToggle((t) => t.setValue(this.s.naming.addPathHash).onChange((v) => {
        this.s.naming.addPathHash = v;
        this.save();
      }));
    new Setting(containerEl)
      .setName('名称带类型类别')
      .setDesc('在名字中写入附件类别，一眼即可分辨类型，例如 image（图片）、video（视频）、pdf（文档）。推荐开启。')
      .addToggle((t) => t.setValue(this.s.naming.honorCategory).onChange((v) => {
        this.s.naming.honorCategory = v;
        this.save();
      }));
    new Setting(containerEl)
      .setName('额外带子类型')
      .setDesc('在类别之后再附上具体格式，例如 image_png、video_mp4。信息更细但名字更长，按需开启。')
      .addToggle((t) => t.setValue(this.s.naming.showSubType).onChange((v) => {
        this.s.naming.showSubType = v;
        this.save();
      }));
    new Setting(containerEl)
      .setName('按类别放入子目录')
      .setDesc('统一命名时，把附件放进「附件目录/类型/」子目录，例如 image/、pdf/，便于按类型归档。')
      .addToggle((t) => t.setValue(this.s.naming.folderByCategory).onChange((v) => {
        this.s.naming.folderByCategory = v;
        this.save();
      }));
    containerEl.createEl('p', {
      text: '命名用词：各类别在统一命名时写入名字的词语。默认使用英文（image、video 等）；可改成中文（图片、视频），或带扩展名的形式（image_png）以增强区分。',
      cls: 'iap-settings-section-hint',
    });
    for (const opt of CATEGORY_OPTIONS) {
      new Setting(containerEl)
        .setName(`「${opt.label}」命名用词`)
        .setDesc(`统一命名时「${opt.label}」类别写入的名字片段。清空则回退为默认英文词 ${opt.value}。`)
        .addText((t) =>
          t
            .setPlaceholder(opt.value)
            .setValue(this.s.naming.categoryWords[opt.value] ?? '')
            .onChange((v) => {
              const word = v.trim();
              if (word) {
                this.s.naming.categoryWords[opt.value] = word;
              } else {
                // 清空则删除该键，命名时回退为默认英文词
                delete this.s.naming.categoryWords[opt.value];
              }
              this.save();
            }),
        );
    }

    containerEl.createEl('h2', { text: '本地化' });
    new Setting(containerEl)
      .setName('启用媒体本地化')
      .setDesc(
        '“本地化当前笔记附件”会把笔记里的外链图片、视频、音频、PDF、网页下载到本地，并改写为本地引用，保证脱机可用。关闭则不做下载和改写。',
      )
      .addToggle((t) => t.setValue(this.s.localize.enabled).onChange((v) => {
        this.s.localize.enabled = v;
        this.save();
      }));
    new Setting(containerEl)
      .setName('本地化网络 URL')
      .setDesc(
        '是否真的下载 http(s) 类型的外链，推荐保持开启。关闭时只处理笔记内嵌的 data 图片、不发起任何网络请求。这是三步中的第二步：决定“被认出来的外链要不要真正下载”；至于下载后存不存，由最后一步决定。',
      )
      .addToggle((t) => t.setValue(this.s.localize.localizeWebUrls).onChange((v) => {
        this.s.localize.localizeWebUrls = v;
        this.save();
      }));
    new Setting(containerEl)
      .setName('扩展扫描：普通链接与 HTML 标签')
      .setDesc(
        '决定扫描笔记时“要不要认出这些引用形式”。Markdown 图片嵌入 ![]() 始终会认；开启后才会额外认出普通链接 [text](url) 和 <img>/<audio>/<video> 标签并一起改写。默认关闭，以限制网络请求范围。这是三步中的第一步：没被认出的引用，后续不会做任何处理。',
      )
      .addToggle((t) => t.setValue(this.s.localize.scanHtmlAndLinks).onChange((v) => {
        this.s.localize.scanHtmlAndLinks = v;
        this.save();
      }));
    new Setting(containerEl)
      .setName('用 MD5 作为新文件名')
      .setDesc(
        '开启后按内容哈希命名（形如 9e599….jpg），同一张图贴多次只保存一份、节省空间且名字稳定合法，推荐开启。关闭则用下载时的原始文件名，更直观但不去重，特殊字符时可能需要路径修复。',
      )
      .addToggle((t) => t.setValue(this.s.localize.useMd5ForNew).onChange((v) => {
        this.s.localize.useMd5ForNew = v;
        this.save();
      }));
    new Setting(containerEl)
      .setName('最小文件大小（KB，0 为不限）')
      .setDesc('小于该数值的下载会被跳过，常用于过滤占位图和微型图标。设为 0 表示不过滤、接收全部，建议保持 0；如需过滤微小占位图，可设 2～10。')
      .addText((t) =>
        t.setValue(String(this.s.localize.minSizeKb)).onChange((v) => {
          const n = Number(v);
          this.s.localize.minSizeKb = Number.isFinite(n) ? n : 0;
          this.save();
        }),
      );
    new Setting(containerEl)
      .setName('下载重试次数')
      .setDesc('某个文件下载失败时最多重试的次数，建议保持默认 3（过大只会拖慢失败下载）。')
      .addText((t) =>
        t.setValue(String(this.s.localize.tryCount)).onChange((v) => {
          const n = Number(v);
          this.s.localize.tryCount = Number.isFinite(n) && n >= 1 ? n : 1;
          this.save();
        }),
      );
    new Setting(containerEl)
      .setName('单文件下载超时（毫秒）')
      .setDesc('单个文件下载超过该毫秒数则放弃。默认 30000（30秒）。')
      .addText((t) =>
        t.setValue(String(this.s.localize.timeoutMs)).onChange((v) => {
          const n = Number(v);
          this.s.localize.timeoutMs = Number.isFinite(n) && n >= 1000 ? n : 30000;
          this.save();
        }),
      );
    containerEl.createEl('p', {
      text: '允许本地化的类别（默认全开；SVG 始终不做本地化）。这是三步中的最后一步：文件下载后按实际类型（图片/视频/音频/PDF/文档/网页）判断，只有落在勾选的白名单里才保存并改写链接，否则丢弃。整条链路：①扩展扫描 认哪些引用 → ②本地化网络 URL 要不要下载 → ③类别白名单 要不要存，三步都通过才会保存。',
      cls: 'iap-settings-section-hint',
    });
    for (const opt of CATEGORY_OPTIONS) {
      new Setting(containerEl)
        .setName(`本地化 ${opt.label}`)
        .setDesc(`允许把识别为「${opt.label}」的附件下载到本地。`)
        .addToggle((t) =>
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
          }),
        );
    }

    containerEl.createEl('h2', { text: '一致性' });
    new Setting(containerEl)
      .setName('启用一致性')
      .setDesc('总开关。关闭后，“检查库一致性”“修复不兼容路径”“笔记移动时跟随移动附件”都不会工作。')
      .addToggle((t) => t.setValue(this.s.consistency.enabled).onChange((v) => {
        this.s.consistency.enabled = v;
        this.save();
      }));
    new Setting(containerEl)
      .setName('报告坏链接')
      .setDesc('在“检查库一致性”报告中列出指向不存在的文件的引用，方便定位断链。')
      .addToggle((t) => t.setValue(this.s.consistency.reportBrokenLinks).onChange((v) => {
        this.s.consistency.reportBrokenLinks = v;
        this.save();
      }));
    new Setting(containerEl)
      .setName('修复不兼容路径')
      .setDesc(
        '“修复不兼容路径”命令会把 Windows 等系统的保留名、非法字符、超长文件名安全改名（例如 CON 改为 CON_），并自动更新引用链接。',
      )
      .addToggle((t) => t.setValue(this.s.consistency.repairIncompatiblePaths).onChange((v) => {
        this.s.consistency.repairIncompatiblePaths = v;
        this.save();
      }));
    new Setting(containerEl)
      .setName('笔记移动时跟随移动附件')
      .setDesc(
        '开启后，在文件管理器把笔记拖到其它目录时，会自动把该笔记所在目录下的附件目录（即 ./assets 这类相对目录）中的对应附件一并迁到新目录，并保持链接。默认关闭以免误平移。',
      )
      .addToggle((t) => t.setValue(this.s.consistency.followNoteMove).onChange((v) => {
        this.s.consistency.followNoteMove = v;
        this.save();
      }));

    containerEl.createEl('h2', { text: '清理' });
    new Setting(containerEl)
      .setName('启用清理')
      .setDesc('总开关。关闭后，“清理未用附件”命令不执行。')
      .addToggle((t) => t.setValue(this.s.cleanup.enabled).onChange((v) => {
        this.s.cleanup.enabled = v;
        this.save();
      }));
    new Setting(containerEl)
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
    new Setting(containerEl)
      .setName('排除目录（逗号分隔）')
      .setDesc('这些文件夹下的文件，即使没有被任何笔记引用也绝不会被清理。路径相对于库根，多个目录用英文逗号分隔。')
      .addText((t) =>
        t
          .setValue(this.s.cleanup.excludedFolders.join(', '))
          .setPlaceholder('assets/keep, 笔记归档')
          .onChange((v) => {
            this.s.cleanup.excludedFolders = v.split(',').map((s) => s.trim()).filter(Boolean);
            this.save();
          }),
      );
    new Setting(containerEl)
      .setName('排除目录含子目录')
      .setDesc('开启后，上方排除目录下的所有子目录也一并豁免；关闭则只豁免列出的目录本身。')
      .addToggle((t) => t.setValue(this.s.cleanup.excludeSubfolders).onChange((v) => {
        this.s.cleanup.excludeSubfolders = v;
        this.save();
      }));
    new Setting(containerEl)
      .setName('删除前确认')
      .setDesc('开启后清理前会弹窗列出受影响的文件，需要再确认一次才执行；关闭则会直接按删除方式处理（存在误删风险，强烈建议保持开启）。')
      .addToggle((t) => t.setValue(this.s.cleanup.requireConfirm).onChange((v) => {
        this.s.cleanup.requireConfirm = v;
        this.save();
      }));

    containerEl.createEl('h2', { text: '导出' });
    new Setting(containerEl)
      .setName('启用导出')
      .setDesc('开启后启用“导出当前笔记附件”和“导出未用附件”两条 zip 命令，将附件连同清单元数据打包归档。')
      .addToggle((t) => t.setValue(this.s.exporter.enabled).onChange((v) => {
        this.s.exporter.enabled = v;
        this.save();
      }));
  }
}