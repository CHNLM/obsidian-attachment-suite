import { describe, expect, it } from 'vitest';
import { migrateSettings } from '../../src/settings-migration';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../../src/settings';

describe('settings-migration', () => {
  it('无配置时回退到默认值', () => {
    const s = migrateSettings(undefined);
    expect(s.version).toBe(SCHEMA_VERSION);
    expect(s.attachmentFolder).toBe(DEFAULT_SETTINGS.attachmentFolder);
    expect(s.naming.enabled).toBe(true);
    expect(s.cleanup.deleteMode).toBe('.trash');
    expect(s.consistency.followNoteMove).toBe(false);
  });

  it('v0 的扁平字段迁移进能力命名空间', () => {
    const s = migrateSettings({
      enableAuto: false,
      connector: '-',
      useMd5ForNew: false,
      minSizeKb: 5,
      deleteMode: 'permanent',
    });
    expect(s.naming.enabled).toBe(false);
    expect(s.naming.connector).toBe('-');
    expect(s.localize.useMd5ForNew).toBe(false);
    expect(s.localize.minSizeKb).toBe(5);
    expect(s.cleanup.deleteMode).toBe('permanent');
    // 未迁移字段保持默认
    expect(s.consistency.reportBrokenLinks).toBe(true);
  });

  it('未知顶层字段被丢弃', () => {
    const s = migrateSettings({ someJunk: 1, another: 'x' });
    expect(s).not.toHaveProperty('someJunk');
    expect(s).not.toHaveProperty('another');
  });

  it('局部配置能保留，缺失键回退默认', () => {
    const s = migrateSettings({ attachmentFolder: '/custom', naming: { addTime: true } });
    expect(s.attachmentFolder).toBe('/custom');
    expect(s.naming.addTime).toBe(true);
    expect(s.naming.enabled).toBe(true); // 未提供 → 默认
    expect(s.localize.enabled).toBe(true);
  });

  it('版本一致时不做迁移，仅合并', () => {
    const s = migrateSettings({ version: SCHEMA_VERSION, attachmentFolder: 'x' });
    expect(s.version).toBe(SCHEMA_VERSION);
    expect(s.attachmentFolder).toBe('x');
    expect(s.naming.connector).toBe('_');
  });

  it('无自定义附件目录时默认跟随 Obsidian 模式', () => {
    const s = migrateSettings(undefined);
    expect(s.attachmentFolderMode).toBe('obsidian');
  });

  it('旧配置显式自定义过附件目录且未声明来源时，归入 custom 并保留', () => {
    const s = migrateSettings({ attachmentFolder: 'notes/attachments' });
    expect(s.attachmentFolderMode).toBe('custom');
    expect(s.attachmentFolder).toBe('notes/attachments');
  });

  it('已声明 custom 模式时显式生效', () => {
    const s = migrateSettings({ attachmentFolderMode: 'custom', attachmentFolder: './attachments' });
    expect(s.attachmentFolderMode).toBe('custom');
  });

  it('已声明 obsidian 模式时不被自定义目录改写', () => {
    const s = migrateSettings({ attachmentFolderMode: 'obsidian', attachmentFolder: './assets' });
    expect(s.attachmentFolderMode).toBe('obsidian');
  });

  it('v0 迁移时已存在的嵌套字段与扁平字段合并保留', () => {
    const s = migrateSettings({
      enableAuto: false,
      naming: { addTime: true, honorCategory: false },
      useMd5ForNew: false,
    });
    expect(s.naming.enabled).toBe(false); // 扁平字段迁移
    expect(s.naming.addTime).toBe(true); // 嵌套字段保留
    expect(s.naming.honorCategory).toBe(false);
    expect(s.localize.useMd5ForNew).toBe(false);
  });

  it('数组字段整体覆盖而非合并（默认值被替换）', () => {
    const s = migrateSettings({ paths: { exclude: ['a/b'] } });
    expect(s.paths.exclude).toEqual(['a/b']);
    // 未提供的其余默认仍保留
    expect(s.cleanup.excludedFolders).toEqual([]);
  });
});