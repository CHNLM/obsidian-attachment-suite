/** 统一命名 · 纯计算（不依赖 obsidian，可脱离 App 单测）。 */

import { md5HexOfString, extOf, normalizeLocal } from '../core';
import type { AttachmentIndexSnapshot } from '../core';
import type { NamingSettings } from '../settings';

export interface NamingPartsInput {
  noteName: string;
  /** 命名的类型字段（已考虑 showSubType，如 `video_mp4`）。 */
  typeField: string;
  /** 是否在名字中写入类别字段（受 honorCategory 控制）。 */
  honorCategory: boolean;
  index: number;
  connector: string;
  includeNoteName: boolean;
  addTime: boolean;
  timeStr: string;
  addPathHash: boolean;
  hashSuffix: string;
}

/** 生成文件名片段（不含扩展名）。 */
export function namingParts(input: NamingPartsInput): string[] {
  const parts: string[] = [];
  if (input.includeNoteName) parts.push(input.noteName);
  if (input.honorCategory) parts.push(input.typeField);
  parts.push(String(input.index).padStart(3, '0'));
  if (input.addTime) parts.push(input.timeStr);
  if (input.addPathHash) parts.push(input.hashSuffix);
  return parts;
}

/** 生成完整文件名（含扩展名）。 */
export function buildName(input: NamingPartsInput & { ext: string }): string {
  return `${namingParts(input).join(input.connector)}.${input.ext}`;
}

/**
 * 判断文件是否已按本插件规则命名，避免重复处理（防幂等，14.4）。
 * 校验与当前命名方案一致：不仅看「笔记名/类别/序号」，还会确认后缀是否满足
 * 当前开启的「加时间 / 加路径哈希」——若方案新增了这些段而文件名缺失，
 * 视为“尚未按当前方案命名”，允许再次重命名以补齐（修复二次重命名不生效）。
 * @param stem 不含扩展名的文件名。
 * @param includeCategory 命名是否包含类别段（与 honorCategory 一致）。
 */
export function checkAlreadyRenamed(
  stem: string,
  noteName: string,
  includeNoteName: boolean,
  connector: string,
  includeCategory: boolean,
  addTime = false,
  addPathHash = false,
): boolean {
  if (!connector) return false;
  const parts = stem.split(connector);
  let idx = 0;
  if (includeNoteName) {
    if (parts[0] !== noteName || parts.length < 2) return false;
    idx = 1;
  }
  // 类别段（可选）
  if (includeCategory) {
    if (parts[idx].length === 0) return false;
    idx++;
  }
  // 序号段：parts[idx] 需为两位及以上数字
  if (idx >= parts.length) return false;
  if (!/^\d{2,}$/.test(parts[idx])) return false;
  idx++;

  // 后缀段：须与当前方案要求的存在性/类型严格一致，缺失或多出都视为“未按当前方案命名”
  const expected = (addTime ? 1 : 0) + (addPathHash ? 1 : 0);
  const suffixLen = parts.length - idx;
  if (suffixLen !== expected) return false;
  if (addTime) {
    // 时间戳 YYYYMMDDHHmmss（14 位数字）
    if (!/^\d{14}$/.test(parts[idx])) return false;
    idx++;
  }
  if (addPathHash) {
    // 路径哈希 8 位 hex
    if (!/^[0-9a-f]{8}$/i.test(parts[idx])) return false;
    idx++;
  }
  return true;
}

/** 当前时间 → YYYYMMDDHHmmss（用于命名后缀）。 */
export function formatTimestamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export interface RenameItem {
  from: string;
  to: string;
  newName: string;
}

/**
 * 面向当前笔记，从快照规划重命名计划（纯计算，可测）。
 * @param folderByCategory 是否按类别放入子目录。
 * @param targetBaseDir 开启 folderByCategory 时的附件根目录；默认空则回退到原目录。
 */
export function planForSnapshot(
  snapshot: AttachmentIndexSnapshot,
  notePath: string,
  noteName: string,
  naming: NamingSettings,
  folderByCategory = false,
  targetBaseDir = '',
): RenameItem[] {
  const items: RenameItem[] = [];
  const counters = new Map<string, number>();
  const now = new Date();
  const timeStr = naming.addTime ? formatTimestamp(now) : '';
  const hashSuffix = naming.addPathHash ? md5HexOfString(notePath).slice(0, 8) : '';

  // 预扫：已被当前方案命名（checkAlreadyRenamed 通过）的附件已占用序号段。
  // 若新到的原始附件再从 1 编号，会规划到已存在的文件名 → SafeMoveEngine 追加 `(1)`
  // 避让 → 生成的非标准名无法被二次识别 → 每次运行都再 +1，破坏幂等。这里把已占用
  // 序号计入计数器，让新附件接续编号（跨 skip 保持序号连续）。
  for (const entry of snapshot.entries.values()) {
    if (!entry.references.some((r) => r.sourcePath === notePath)) continue;
    const slash = entry.path.lastIndexOf('/');
    const fullname = entry.path.slice(slash + 1);
    const stem = fullname.replace(/\.[^.]+$/, '');
    const ext = extOf(entry.path);
    const word = naming.categoryWords[entry.category] ?? entry.category;
    const typeField = naming.showSubType ? `${word}_${ext}` : word;
    if (!checkAlreadyRenamed(stem, noteName, true, naming.connector, naming.honorCategory, naming.addTime, naming.addPathHash)) continue;
    // 从「笔记_类别_序号[时间][哈希]」解析序号段（分段顺序与 checkAlreadyRenamed 一致）
    const parts = stem.split(naming.connector);
    let idx = 1; // includeNoteName 恒 true
    if (naming.honorCategory) idx++;
    const num = Number.parseInt(parts[idx], 10);
    if (!Number.isNaN(num)) {
      const cur = counters.get(typeField) ?? 0;
      if (num > cur) counters.set(typeField, num);
    }
  }

  for (const entry of snapshot.entries.values()) {
    if (!entry.references.some((r) => r.sourcePath === notePath)) continue;
    const slash = entry.path.lastIndexOf('/');
    const ownDir = slash >= 0 ? entry.path.slice(0, slash + 1) : '';
    const fullname = entry.path.slice(slash + 1);
    const stem = fullname.replace(/\.[^.]+$/, '');
    const ext = extOf(entry.path);
    const word = naming.categoryWords[entry.category] ?? entry.category;
    const typeField = naming.showSubType ? `${word}_${ext}` : word;

    if (checkAlreadyRenamed(stem, noteName, true, naming.connector, naming.honorCategory, naming.addTime, naming.addPathHash)) continue;

    const index = (counters.get(typeField) ?? 0) + 1;
    counters.set(typeField, index);
    const newName = buildName({
      noteName,
      typeField,
      honorCategory: naming.honorCategory,
      index,
      connector: naming.connector,
      includeNoteName: true,
      addTime: naming.addTime,
      timeStr,
      addPathHash: naming.addPathHash,
      hashSuffix,
      ext,
    });
    // 按类别放入 <附件根>/<类型>/ 子目录（final 用 normalizeLocal 去掉 ./ 或前导斜杠）
    const dir = folderByCategory
      ? `${(targetBaseDir || ownDir.replace(/\/+$/g, '')).replace(/^\/+/, '')}/${entry.category}/`
      : ownDir;
    const to = folderByCategory ? normalizeLocal(`${dir}${newName}`) : `${dir}${newName}`;
    if (to === entry.path) continue;
    items.push({ from: entry.path, to, newName });
  }
  return items;
}