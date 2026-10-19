import { describe, expect, it } from 'vitest';
import { migrateSettings } from '../../src/settings-migration';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../../src/settings';

describe('settings-migration', () => {
  it('DEFAULT_SETTINGS 的每个顶层键都必须能往返（白名单漏键 = 设置被静默丢弃）', () => {
    // 背景：`normalizeFields` 里有一份**手写的"已知顶层键"白名单**，它与 `PluginSettings`
    // 是同一件事的两份实现。新增字段却忘了补白名单时，配置会被静默丢弃——
    // 表现是"在设置页改好、重启后自己变回默认"，且没有任何报错。
    // 2026-09-28 加「详细诊断日志」时正是先写了 PluginSettings、漏了白名单，被此断言当场抓住。
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key === 'version') continue;
      const def = (DEFAULT_SETTINGS as Record<string, any>)[key];
      const raw: Record<string, any> = { version: SCHEMA_VERSION };
      if (typeof def === 'boolean') raw[key] = !def;
      else if (typeof def === 'number') raw[key] = def + 1;
      else if (typeof def === 'string') raw[key] = `${def}-sentinel`;
      else if (Array.isArray(def)) raw[key] = [...def, 'sentinel'];
      else if (def && typeof def === 'object') {
        // 嵌套区：翻一个布尔键（没有布尔键就追加到某个数组键），验证整个区不会被白名单丢掉
        const clone = JSON.parse(JSON.stringify(def)) as Record<string, any>;
        const boolKey = Object.keys(clone).find((k) => typeof clone[k] === 'boolean');
        const arrKey = Object.keys(clone).find((k) => Array.isArray(clone[k]));
        if (boolKey) clone[boolKey] = !clone[boolKey];
        else if (arrKey) clone[arrKey] = [...clone[arrKey], 'sentinel'];
        raw[key] = clone;
      }
      const out = migrateSettings(raw) as unknown as Record<string, unknown>;
      expect(
        out[key],
        `顶层键「${key}」在迁移后被丢弃或改写——检查 src/settings-migration.ts 的 known 白名单`,
      ).toEqual(raw[key]);
    }
  });

  it('无配置时回退到默认值', () => {
    const s = migrateSettings(undefined);
    expect(s.version).toBe(SCHEMA_VERSION);
    expect(s.attachmentFolder).toBe(DEFAULT_SETTINGS.attachmentFolder);
    expect(s.naming.enabled).toBe(true);
    expect(s.cleanup.deleteMode).toBe('.trash');
    // 开箱即用的一项决策（2026-09-30 起为 true）：笔记相对型附件目录下，
    // "不跟随"等于移动笔记即断链，而那是真实用户最常见的抱怨之一。
    expect(s.consistency.followNoteMove).toBe(true);
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

  it('默认类别白名单不含网页（HTML 永不落存）', () => {
    const s = migrateSettings(undefined);
    expect(s.localize.allowedCategories).not.toContain('webpage');
    expect(s.localize.allowedCategories).toContain('image');
    expect(s.localize.blockPrivateHosts).toBe(true);
    expect(s.localize.maxDownloadMb).toBe(100);
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