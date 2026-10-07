/** 统一设置 Schema。 */

import type { AttachmentCategory } from './core';
import type { Platform } from './core';

export type DeleteMode = '.trash' | 'system-trash' | 'permanent';
export type NotificationLevel = 'silent' | 'summary' | 'verbose';
/** 附件目录来源：跟随 Obsidian 全局设置，或使用本插件自定义目录。 */
export type AttachmentFolderMode = 'obsidian' | 'custom';

export interface NamingSettings {
  enabled: boolean;
  connector: string;
  addTime: boolean;
  addPathHash: boolean;
  /** 名字带类型类别（image/video/…）。 */
  honorCategory: boolean;
  /** 额外带具体子类型（video_mp4）。 */
  showSubType: boolean;
  /** 命名时按类别放入子目录（<附件目录>/<类型>/xxx）。默认关。 */
  folderByCategory: boolean;
  categoryWords: Record<string, string>;
}

export interface LocalizeSettings {
  enabled: boolean;
  /** 是否真正下载 http(s) 类型的外链；关闭则只处理笔记内嵌 data 图片、不发起网络请求。 */
  localizeWebUrls: boolean;
  /** 允许本地化的类别白名单（SVG 与 webpage 永不本地化，无需在此列出）。 */
  allowedCategories: AttachmentCategory[];
  /**
   * 扩展扫描：额外识别普通链接 `[text](url)` 与 HTML 媒体标签。
   *
   * 默认**开启**（2026-09-30 起，此前为关闭）。理由：插件的核心承诺是"把笔记里的外链媒体
   * 本地化"，而 `<img src>` / `<audio>` / `[文档](url)` 与 markdown 图片是**同一意图的不同写法**。
   * 不认这些写法，用户会遇到"我明明有图、跑完却什么都没发生"——那正是本仓库最忌讳的
   * "承诺了却不生效"。安全边界不靠"少认一种写法"来兜：网络是否发起由 `localizeWebUrls` 决定，
   * 存不存由 `allowedCategories` 决定，内网由 `blockPrivateHosts` 拦，体积另有上限。
   * 非媒体外链（如指向网页的普通链接）仍会被类型判定挡下，不会落盘。
   */
  scanHtmlAndLinks: boolean;
  useMd5ForNew: boolean;
  minSizeKb: number;
  tryCount: number;
  timeoutMs: number;
  /** 拦截指向本机/内网/保留地址的外链（默认开）。 */
  blockPrivateHosts: boolean;
  /** 单文件下载体积上限（MB），超过则不下载（默认 100）。 */
  maxDownloadMb: number;
  /** 域名白名单：只允许这些域（支持 *.example.com，含 apex）。 */
  allowHosts: string[];
  /** 域名黑名单：拒绝这些域（优先级最高，覆盖白名单）。 */
  denyHosts: string[];
  /** 仅允许白名单中的域；开启后不在 allowHosts 内的 http 引用一律跳过。 */
  hostAllowlistOnly: boolean;
  /** 同一主机的两次下载之间的最小间隔（毫秒）；0 表示不限速。 */
  perHostIntervalMs: number;
  /** 并发下载数；1 为串行（默认）。 */
  maxConcurrent: number;
}

export interface ConsistencySettings {
  enabled: boolean;
  reportBrokenLinks: boolean;
  repairIncompatiblePaths: boolean;
  platforms: Platform[];
  /**
   * 笔记移动时，将其**相对型**附件目录下的附件随笔记迁移。默认**开启**（2026-09-30 起）。
   *
   * 理由：只对笔记相对型目录（`.` / `./assets` 这类）生效，而这类目录下**不跟随就等于断链**——
   * 把笔记拖到别的文件夹后，`![](assets/x.png)` 指向的路径已经不存在了。
   * "整理完笔记发现图全丢了"是真实用户最常见的抱怨之一。对库根/绝对路径目录它是空操作。
   */
  followNoteMove: boolean;
  /** 断链修复：启用名称相似度推荐（无同名候选时推荐 top-N 供用户选择）。 */
  fuzzySuggest: boolean;
  /** 相似度阈值（0~1），低于该值的候选不推荐。 */
  fuzzyThreshold: number;
  /** 相似度推荐候选上限。 */
  fuzzyTopN: number;
}

export interface CleanupSettings {
  enabled: boolean;
  deleteMode: DeleteMode;
  excludedFolders: string[];
  excludeSubfolders: boolean;
  requireConfirm: boolean;
}

export interface ExporterSettings {
  enabled: boolean;
}

/** 自动化（自动处理）：笔记内容变更时自动本地化 + 统一命名当前笔记附件。 */
export interface AutomationSettings {
  /** 总开关。开启后，编辑中的笔记一旦出现外链图片/新附件，会自动下载并统一命名。 */
  enabled: boolean;
  /** 定时轮询间隔（秒）：每隔 N 秒扫描一次待处理笔记；最小 1，默认 5。 */
  interval: number;
}

/** 全局路径作用域：仅影响孤儿判定与本地化等处理范围。 */
export interface PathScopeSettings {
  /** 排除目录（库内路径，相对库根）。命中则不判为孤儿、不本地化。 */
  exclude: string[];
}

export interface PluginSettings {
  version: number;
  /** 自定义附件目录（仅当 attachmentFolderMode === 'custom' 时生效）。 */
  attachmentFolder: string;
  /** 附件目录来源：'obsidian' 跟随 Obsidian 全局设置；'custom' 用上者。 */
  attachmentFolderMode: AttachmentFolderMode;
  naming: NamingSettings;
  localize: LocalizeSettings;
  consistency: ConsistencySettings;
  cleanup: CleanupSettings;
  exporter: ExporterSettings;
  automation: AutomationSettings;
  /** 全局路径范围：排除目录。 */
  paths: PathScopeSettings;
  notificationLevel: NotificationLevel;
  /**
   * 详细诊断日志：把日志级别降到 debug，向开发者控制台输出更详细的过程信息
   * （索引重建与缓存命中、各命令的计划明细、每次移动的判定结果）。
   *
   * 与「通知级别」的分工：那个决定**用户可见的提示**，这个只影响**控制台输出**。
   * 默认关：这些日志含库内文件路径，只应在排查问题时开启。
   * 生效路径唯一：`main.ts` 的 `setDebugLogging()`（设置页开关与「切换诊断日志」命令共用）。
   */
  debugLogging: boolean;
}

/** 当前 schema 版本（迁移依据）。 */
export const SCHEMA_VERSION = 1;

/**
 * 当前运行平台（桌面端专用；无法识别时按 Windows 处理，规则更严格=更安全）。
 *
 * 供「修复不兼容路径」的默认目标平台。注意该平台开关**只影响两项 Windows 专属规则**：
 * 盘符前缀（`C:`）与 `CON`/`PRN` 等保留名（见 `core/path-compatibility.ts` 的 `isViolation`）。
 * **非法字符表（`< > : " / \ | ? *`）与字节/单元长度上限是各平台通用的**，不随平台变化——
 * 故在 macOS/Linux 上这些字符同样会被判为不兼容并改名。
 */
export function currentPlatform(): Platform {
  const p = typeof process !== 'undefined' ? process.platform : '';
  if (p === 'darwin') return 'mac';
  if (p === 'linux') return 'linux';
  return 'windows';
}

export const DEFAULT_SETTINGS: PluginSettings = {
  version: SCHEMA_VERSION,
  attachmentFolder: './assets',
  attachmentFolderMode: 'obsidian',
  naming: {
    enabled: true,
    connector: '_',
    addTime: false,
    addPathHash: false,
    honorCategory: true,
    showSubType: false,
    folderByCategory: false,
    // 说明：webpage 条目保留仅供“命名/整理已存在的 .html 附件”使用；
    // 本地化侧已不再支持 HTML（不会下载保存网页）。
    categoryWords: {
      image: 'image',
      video: 'video',
      audio: 'audio',
      pdf: 'pdf',
      document: 'document',
      webpage: 'webpage',
      misc: 'misc',
    },
  },
  localize: {
    enabled: true,
    localizeWebUrls: true,
    allowedCategories: ['image', 'video', 'audio', 'pdf', 'document', 'misc'],
    // 开箱即用：三种写法（md 图片 / 普通链接 / HTML 媒体标签）一并识别，见接口处注释
    scanHtmlAndLinks: true,
    useMd5ForNew: true,
    minSizeKb: 0,
    tryCount: 3,
    timeoutMs: 30000,
    blockPrivateHosts: true,
    maxDownloadMb: 100,
    allowHosts: [],
    denyHosts: [],
    hostAllowlistOnly: false,
    perHostIntervalMs: 0,
    maxConcurrent: 1,
  },
  consistency: {
    enabled: true,
    reportBrokenLinks: true,
    repairIncompatiblePaths: true,
    platforms: [currentPlatform()],
    // 开箱即用：笔记相对型附件目录下，"不跟随"等同于移动笔记即断链
    followNoteMove: true,
    fuzzySuggest: true,
    fuzzyThreshold: 0.6,
    fuzzyTopN: 5,
  },
  cleanup: {
    enabled: true,
    deleteMode: '.trash',
    excludedFolders: [],
    excludeSubfolders: false,
    requireConfirm: true,
  },
  /**
   * 导出：默认**开启**（2026-09-30 起）。
   *
   * 理由：两条导出命令就摆在命令面板里。默认关闭意味着用户按下去只得到
   * "导出能力已关闭。"——典型的"开箱不可用"。导出是只读操作（读附件、写一个 zip），
   * 没有破坏性风险，默认开启的成本近乎为零。
   */
  exporter: {
    enabled: true,
  },
  automation: {
    enabled: true,
    interval: 5,
  },
  paths: {
    exclude: [],
  },
  notificationLevel: 'summary',
  debugLogging: false,
};