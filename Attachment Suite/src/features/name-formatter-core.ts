/** 统一命名 · 纯计算（不依赖 obsidian，可脱离 App 单测）。 */

import { DEFAULT_PROFILE, byteLength, cutByCodepoints, md5HexOfString, extOf, normalizeLocal } from '../core';
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
  // 比 core/link-resolver 的 sanitizeFilename 更严：分隔符与 Windows 保留字符一律**删除**
  // （那边是"含分隔符即拒绝、保留字符替换为 _"，且不处理控制字符），并额外清掉控制字符
  const cleaned = raw.replace(/[/\\:*?"<>|]/g, '').replace(/[\u0000-\u001f]/g, '').trim();
  return cleaned || fallback;
}

/** 给「.扩展名」留的字节余量（受管扩展名里最长的 `.webm`/`.jpeg`/`.docx` 都远小于它）。 */
const RESERVED_EXT_BYTES = 8;

/**
 * 按文件名长度上限裁剪**笔记名片段**（其余片段原样保留）。
 *
 * 为什么裁"笔记名"而不是从尾部截断：后缀「类别_序号_时间戳_哈希」是 `parseRenamed` 判定
 * "已命名"的依据。`repairName` 的默认行为是**从尾部截断**——后缀被切掉后解析失败 → 下一轮
 * 又改回完整名 → 再被截断，**永不收敛**（真实宿主上就是这么循环的）。裁掉笔记名里的一段，
 * 后缀完整，解析器仍认得回。
 *
 * **生成侧与解析侧必须共用本函数**：各算各的，写出的名字与期望前缀就会对不上，同样认不回。
 */
export function clipNoteName(noteName: string, restSegments: string[], connector: string): string {
  const restBytes = restSegments.length === 0 ? 0 : byteLength(restSegments.join(connector)) + byteLength(connector);
  const budget = (DEFAULT_PROFILE.maxBytes ?? 255) - restBytes - RESERVED_EXT_BYTES;
  if (byteLength(noteName) <= budget) return noteName;
  return cutByCodepoints(noteName, Math.max(1, budget));
}

/**
 * 生成完整文件名（含扩展名）。**结果保证不越过文件名长度上限**——超出时裁的是笔记名片段
 * （见 `clipNoteName`），后缀一律保留，这样"写出的名字"必定能被 `parseRenamed` 认回。
 */
export function buildName(input: NamingPartsInput & { ext: string }): string {
  const parts = namingParts(input);
  if (!input.includeNoteName || parts.length === 0) {
    return `${parts.join(input.connector)}.${input.ext}`;
  }
  const [note, ...rest] = parts;
  return `${[clipNoteName(note, rest, input.connector), ...rest].join(input.connector)}.${input.ext}`;
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
 *
 * 类别段同理**不按固定段数**消费：`showSubType` 会让它自身带连接符（`image_png`），
 * 故它的边界由"剩余前缀须等于笔记名"反推，而不是写死"一段"。
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
  // 类别段（可选）。⚠️ **不是"恰好一段"**：`showSubType` 让类别段自身带连接符（`image_png`），
  // 于是它占两段。这里改为**按笔记名反推**——从右往左把段逐段归给类别段，直到剩余前缀
  // 恰等于笔记名；这样"类别段占 1 段还是多段""笔记名自身含几个连接符"都能正确定位。
  //
  // 旧实现写死"恰好一段"，于是 `showSubType=true` 时已命名的附件**永远认不回来**
  // （前缀会多出 `image` 一段）：它与 `addTime` 组合时每轮都重新规划同一批、永不收敛
  // ——单独开任一个都还有"重算出的 `to` 与原路径相同"兜着，两个一起开（时间戳每轮都变）就震荡。
  if (includeCategory) {
    if (!includeNoteName) {
      if (idx < 1 || parts[idx - 1].length === 0) return null;
      idx--;
    } else {
      let k = idx - 1; // 至少留一段给类别段
      for (; k >= 1; k--) {
        const cand = parts.slice(0, k).join(connector);
        // 同样要认"被长度上限裁过的笔记名"（见 `clipNoteName`）——两侧共用同一函数。
        if (cand === noteName || cand === clipNoteName(noteName, parts.slice(k), connector)) break;
      }
      if (k < 1) return null;
      idx = k;
    }
  }
  // 剩余前缀：includeNoteName 时须等于笔记名；否则不要求（可能是 类别_序号 或 序号）
  if (includeNoteName) {
    const prefix = parts.slice(0, idx).join(connector);
    // 名字可能因**长度上限**被裁掉一段笔记名（见 `clipNoteName`）：用**同一个函数**算出期望
    // 前缀再比，保证"生成 → 解析"始终同一套规则；少了这一步，被裁过的名字就认不回来。
    if (prefix !== noteName && prefix !== clipNoteName(noteName, parts.slice(idx), connector)) return null;
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