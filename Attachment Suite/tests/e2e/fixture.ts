/** 真实测试夹具：在 for-test 上铺设一套覆盖所有功能的真实数据。 */

import { resetVault, writeBinary, writeText, listVaultFiles, tinyImage, tinyPdf, tinyMp3 } from './infrastructure';

export const CATEGORY_WORDS = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  pdf: 'pdf',
  document: 'document',
  webpage: 'webpage',
  misc: 'misc',
};

export const TEST_SETTINGS: Record<string, unknown> = {
  version: 1,
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
    categoryWords: CATEGORY_WORDS,
  },
  localize: {
    enabled: true,
    desktopOnly: true,
    localizeWebUrls: true,
    allowedCategories: ['image', 'video', 'audio', 'pdf', 'document', 'webpage', 'misc'],
    useMd5ForNew: true,
    minSizeKb: 0,
    tryCount: 2,
    timeoutMs: 5000,
  },
  consistency: {
    enabled: true,
    reportBrokenLinks: true,
    repairIncompatiblePaths: true,
    platforms: ['windows', 'mac', 'linux'],
    followNoteMove: true,
  },
  cleanup: {
    enabled: true,
    deleteMode: '.trash',
    excludedFolders: [],
    excludeSubfolders: false,
    requireConfirm: true,
  },
  exporter: {
    enabled: true,
  },
  automation: {
    enabled: true,
    interval: 1,
  },
  paths: {
    exclude: [],
  },
  notificationLevel: 'summary',
};

/**
 * 清空并铺设夹具。
 * @param httpBase 本地 http 服务地址（如 http://127.0.0.1:42999），用于外链本地化测试。
 * @param withRepairFixture 是否额外铺设用于“路径修复”的定位数据（Windows 上无非法文件名，仅验证执行）。
 */
export function seedFixture(vaultRoot: string, httpBase = ''): void {
  resetVault(vaultRoot);

  // NoteA：覆盖 wiki 嵌入 / markdown 图片 / 外链 / data 图 / 坏链接 / frontmatter 引用
  writeText(
    vaultRoot,
    'NoteA.md',
    [
      '---',
      'cover: assets/hero.png',
      'images:',
      '  - assets/hero.png',
      '---',
      '# NoteA',
      '',
      '![[assets/imgA.png]]',
      '',
      '![small](assets/imgA.png)',
      '',
      '![broken](assets/missing.png)',
      '',
      '![[ghost.png]]',
      '',
      ...(httpBase ? [`![alt](${httpBase}/logo.png)`, ''] : []),
      '![d](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAIhQGAXbM3ZQAAAABJRU5ErkJggg==)',
      '',
    ].join('\n'),
  );

  // NoteA 已在正文与 frontmatter 中引用的附件
  writeBinary(vaultRoot, 'assets/imgA.png', tinyImage('png'));
  writeBinary(vaultRoot, 'assets/hero.png', tinyImage('png'));

  // NoteB：不同目录下的另一组附件（命名 / 导出按笔记隔离）
  writeText(
    vaultRoot,
    'BBB/NoteB.md',
    ['# NoteB', '', '![[pic1.jpg]]', '', '![x](sub.png)', ''].join('\n'),
  );
  writeBinary(vaultRoot, 'BBB/pic1.jpg', tinyImage('jpg'));
  writeBinary(vaultRoot, 'BBB/sub.png', tinyImage('png'));
  // 未使用附件（清理 / 导出未用 的目标）
  writeBinary(vaultRoot, 'BBB/not-referenced.png', tinyImage('png'));
  writeBinary(vaultRoot, 'root-orphan.png', tinyImage('png'));

  // 笔记移动跟随：note-relative 附件目录 ./assets
  writeText(vaultRoot, 'AAA/move-note.md', ['# move', '', '![[assets/move.png]]', ''].join('\n'));
  writeBinary(vaultRoot, 'AAA/assets/move.png', tinyImage('png'));

  // 其它类别附件样例（供命名/分类白名单使用；本例不引用）
  writeBinary(vaultRoot, 'BBB/sample.pdf', tinyPdf());
  writeBinary(vaultRoot, 'BBB/sample.mp3', tinyMp3());

  writeSettings(vaultRoot);
}

/** 写安装目录 data.json，便于真实 Obsidian 打开 for-test 时配置一致。 */
export function writeSettings(vaultRoot: string): void {
  writeText(
    vaultRoot,
    '.obsidian/plugins/attachment-suite/data.json',
    JSON.stringify(TEST_SETTINGS, null, 2),
  );
}

/** 提供可读的库内文件清单（排除 .obsidian 与 .trash）。 */
export function listVault(vaultRoot: string): string[] {
  return listVaultFiles(vaultRoot);
}