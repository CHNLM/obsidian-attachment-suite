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
  desktopOnly: boolean;
  /** 是否真正下载 http(s) 类型的外链；关闭则只处理笔记内嵌 data 图片、不发起网络请求。 */
  localizeWebUrls: boolean;
  /** 允许本地化的类别白名单（默认全部，除 svg）。 */
  allowedCategories: AttachmentCategory[];
  /** 扩展扫描：额外识别普通链接与 HTML 标签（默认关）。关闭时仅扫 markdown 图片 ![]()。 */
  scanHtmlAndLinks: boolean;
  useMd5ForNew: boolean;
  minSizeKb: number;
  tryCount: number;
  timeoutMs: number;
}

export interface ConsistencySettings {
  enabled: boolean;
  reportBrokenLinks: boolean;
  repairIncompatiblePaths: boolean;
  platforms: Platform[];
  /** 笔记移动时，将其相对型附件目录下的附件随笔记移动。默认关。 */
  followNoteMove: boolean;
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
}

/** 当前 schema 版本（迁移依据）。 */
export const SCHEMA_VERSION = 1;

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
    desktopOnly: true,
    localizeWebUrls: true,
    allowedCategories: ['image', 'video', 'audio', 'pdf', 'document', 'webpage', 'misc'],
    scanHtmlAndLinks: false,
    useMd5ForNew: true,
    minSizeKb: 0,
    tryCount: 3,
    timeoutMs: 30000,
  },
  consistency: {
    enabled: true,
    reportBrokenLinks: true,
    repairIncompatiblePaths: true,
    platforms: ['windows', 'mac', 'linux'],
    followNoteMove: false,
  },
  cleanup: {
    enabled: true,
    deleteMode: '.trash',
    excludedFolders: [],
    excludeSubfolders: false,
    requireConfirm: true,
  },
  exporter: {
    enabled: false,
  },
  automation: {
    enabled: true,
    interval: 5,
  },
  paths: {
    exclude: [],
  },
  notificationLevel: 'summary',
};