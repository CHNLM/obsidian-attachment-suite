/** 设置版本迁移与旧插件配置导入。 */

import { DEFAULT_SETTINGS, SCHEMA_VERSION, type PluginSettings } from './settings';

/**
 * 逐版本迁移到当前 schema。未知键丢弃、缺失键回退默认值。
 */
export function migrateSettings(raw: unknown): PluginSettings {
  const original = isRecord(raw) ? raw : {};
  let data = original ? { ...original } : {};
  // 兼容旧配置：若此前已显式自定义过附件目录、且未声明来源模式，则保持 custom，
  // 避免引入「跟随 Obsidian」默认后静默改掉老用户的自定义目录（数据位置安全性）。
  if (
    typeof original.attachmentFolderMode === 'undefined' &&
    typeof original.attachmentFolder === 'string' &&
    original.attachmentFolder !== DEFAULT_SETTINGS.attachmentFolder
  ) {
    data = { ...data, attachmentFolderMode: 'custom' };
  }
  let fromVersion = typeof data.version === 'number' ? (data.version as number) : 0;
  while (fromVersion < SCHEMA_VERSION) {
    data = migrateOneStep(data, fromVersion);
    fromVersion++;
  }
  const merged = deepMerge(
    DEFAULT_SETTINGS as unknown as Record<string, unknown>,
    normalizeFields(data),
  );
  return merged as unknown as PluginSettings;
}

/** 单步版本升级。v0`→`v1 把扁平字段收进能力命名空间（v1 即当前）。 */
function migrateOneStep(s: Record<string, unknown>, from: number): Record<string, unknown> {
  if (from === 0) {
    const out: Record<string, unknown> = { ...s };
    out.naming = {
      ...(isRecord(s.naming) ? s.naming : {}),
      ...(typeof s.enableAuto === 'boolean' ? { enabled: s.enableAuto } : {}),
      ...(typeof s.connector === 'string' ? { connector: s.connector } : {}),
    };
    out.localize = {
      ...(isRecord(s.localize) ? s.localize : {}),
      ...(typeof s.useMd5ForNew === 'boolean' ? { useMd5ForNew: s.useMd5ForNew } : {}),
      ...(typeof s.minSizeKb === 'number' ? { minSizeKb: s.minSizeKb } : {}),
    };
    out.cleanup = {
      ...(isRecord(s.cleanup) ? s.cleanup : {}),
      ...(typeof s.deleteMode === 'string' ? { deleteMode: s.deleteMode } : {}),
    };
    return out;
  }
  return s;
}

/** 丢弃未知顶层字段，仅保留已知键并固定版本。 */
function normalizeFields(s: Record<string, unknown>): Record<string, unknown> {
  const known = [
    'version', 'attachmentFolder', 'attachmentFolderMode', 'naming', 'localize', 'consistency',
    'cleanup', 'exporter', 'automation', 'paths', 'notificationLevel',
  ] as const;
  const out: Record<string, unknown> = { version: SCHEMA_VERSION };
  for (const k of known) {
    if (k === 'version') continue;
    const v = s[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** 深层合并：b 覆盖 a（对象递归），返回新对象。 */
function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (
      v !== null && typeof v === 'object' && !Array.isArray(v) &&
      typeof out[k] === 'object' && out[k] !== null && !Array.isArray(out[k])
    ) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object';
}