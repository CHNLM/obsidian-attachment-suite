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

/**
 * 归一化"名字片段"（连接符 / 类别用词）：剔除路径分隔符、文件系统保留字符与控制字符。
 *
 * 为什么必须做：连接符会被 `namingParts().join(connector)` **直接拼进文件名**，类别用词同样
 * 会作为名字片段写入。于是两个后果都能真实发生：
 * - 把连接符填成 `/`：附件被拼成 `notes/image/001.png`，落盘时**写进嵌套子目录**；
 * - 把连接符填成空串：`join('')` 无分隔，且 `parseRenamed` 因 `!connector` 直接返回 null →
 *   已命名的附件永远识别不出来，每次运行都重新规划同一批（幂等被破坏）。
 *
 * 这里是最后一道防线：即使配置被外部改写（手工改 data.json、旧配置迁移），命名也不会做出
 * 越界的事。设置界面另有一层输入清洗，负责让用户当场看到被纠正的值。
 *
 * @param fallback 清洗后为空时使用的兜底片段。
 */
export function sanitizeNameFragment(raw: string, fallback: string): string {
  // 与 core/link-resolver 的 sanitizeFilename 同一口径：路径分隔符 + Windows 保留字符 + 控制字符
  const cleaned = raw.replace(/[/\\:*?"<>|]/g, '').replace(/[\u0000-\u001f]/g, '').trim();
  return cleaned || fallback;
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
  return parseRenamed(stem, noteName, includeNoteName, connector, includeCategory, addTime, addPathHash) !== null;
}

export interface RenamedParts {
  /** 「笔记_类别_序号[时间][哈希]」中的序号段（用于接续编号，跨 skip 保持序号连续）。 */
  number: number;
}

/**
 * 从右侧解析一个已按方案命名的文件名片段。
 *
 * 关键：不能只按连接符从左到右分段并断言第 0 段等于笔记名——当**笔记名本身含连接符**
 * （如 `C_C++_编程环境部署`，连接符为 `_`）时，这种切分会让已命名附件永远无法被识别，
 * 导致「重命名全库附件」反复规划同一批、重复执行。这里改为**从右往左**消费段：
 * 可选路径哈希 → 可选时间戳 → 序号 → 可选类别 → 剩余前缀须等于笔记名。
 * 这样无论笔记名含多少个连接符都能正确判定与取序号。
 */
export function parseRenamed(
  stem: string,
  noteName: string,
  includeNoteName: boolean,
  connector: string,
  includeCategory: boolean,
  addTime = false,
  addPathHash = false,
): RenamedParts | null {
  if (!connector) return null;
  // 兼容冲突避让后缀（`笔记_image_002 (1).png`）：SafeMoveEngine 追加 `(N)` 后名字本身不再
  // 符合模板，若不剥离就会被判为"未按方案命名" → 每次运行都重新规划一次（反复复制副本、
  // 引用漂移、磁盘膨胀）。剥离后仍按原规则解析，保证幂等。
  const parts = stem.replace(/ \(\d+\)$/, '').split(connector);
  if (parts.length === 0) return null;
  let idx = parts.length;

  // 后缀段：先消费 路径哈希(8hex) → 时间戳(14位数字)
  if (addPathHash) {
    if (idx < 1 || !/^[0-9a-f]{8}$/i.test(parts[idx - 1])) return null;
    idx--;
  }
  if (addTime) {
    if (idx < 1 || !/^\d{14}$/.test(parts[idx - 1])) return null;
    idx--;
  }
  // 序号段：两位及以上数字
  if (idx < 1 || !/^\d{2,}$/.test(parts[idx - 1])) return null;
  const number = Number.parseInt(parts[idx - 1], 10);
  idx--;
  // 类别段（可选，恰好一段）
  if (includeCategory) {
    if (idx < 1 || parts[idx - 1].length === 0) return null;
    idx--;
  }
  // 剩余前缀：includeNoteName 时须等于笔记名；否则不要求（可能是 类别_序号 或 序号）
  if (includeNoteName) {
    const prefix = parts.slice(0, idx).join(connector);
    if (prefix !== noteName) return null;
  }
  return { number };
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
  // 连接符与类别用词会被直接拼进文件名，先归一化（见 sanitizeNameFragment）：
  // `/` 会把附件写进意外子目录，空串会让已命名附件永远解析不出来（每次运行都重规划）。
  const connector = sanitizeNameFragment(naming.connector, '_');
  const wordOf = (category: string): string =>
    sanitizeNameFragment(naming.categoryWords[category] ?? category, category);

  // 预扫：已被当前方案命名（parseRenamed 通过）的附件已占用序号段。
  // 若新到的原始附件再从 1 编号，会规划到已存在的文件名 → SafeMoveEngine 追加 `(1)`
  // 避让 → 生成的非标准名无法被二次识别 → 每次运行都再 +1，破坏幂等。这里把已占用
  // 序号计入计数器，让新附件接续编号（跨 skip 保持序号连续）。
  for (const entry of snapshot.entries.values()) {
    if (!entry.references.some((r) => r.sourcePath === notePath)) continue;
    const slash = entry.path.lastIndexOf('/');
    const fullname = entry.path.slice(slash + 1);
    const stem = fullname.replace(/\.[^.]+$/, '');
    const ext = extOf(entry.path);
    const word = wordOf(entry.category);
    const typeField = naming.showSubType ? `${word}_${ext}` : word;
    // 从右解析「笔记_类别_序号[时间][哈希]」：即使笔记名本身含连接符（如 C_C++_编程环境部署）
    // 也能正确识别并取出序号段。
    const parsed = parseRenamed(stem, noteName, true, connector, naming.honorCategory, naming.addTime, naming.addPathHash);
    if (!parsed) continue;
    const cur = counters.get(typeField) ?? 0;
    if (parsed.number > cur) counters.set(typeField, parsed.number);
  }

  for (const entry of snapshot.entries.values()) {
    if (!entry.references.some((r) => r.sourcePath === notePath)) continue;
    const slash = entry.path.lastIndexOf('/');
    const ownDir = slash >= 0 ? entry.path.slice(0, slash + 1) : '';
    const fullname = entry.path.slice(slash + 1);
    const stem = fullname.replace(/\.[^.]+$/, '');
    const ext = extOf(entry.path);
    const word = wordOf(entry.category);
    const typeField = naming.showSubType ? `${word}_${ext}` : word;

    if (checkAlreadyRenamed(stem, noteName, true, connector, naming.honorCategory, naming.addTime, naming.addPathHash)) continue;

    const index = (counters.get(typeField) ?? 0) + 1;
    counters.set(typeField, index);
    const newName = buildName({
      noteName,
      typeField,
      honorCategory: naming.honorCategory,
      index,
      connector,
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