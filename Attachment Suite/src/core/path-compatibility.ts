/** 跨平台路径兼容检测与修复（纯函数）。 */

export type Platform = 'windows' | 'mac' | 'linux' | 'android' | 'ios';

export interface PathCompatProfile {
  platforms: Platform[];
  /** ext4 / apfs 文件名最大字节数（255）。 */
  maxBytes?: number;
  /** NTFS 文件名最大 UTF-16 单元数（255）。 */
  maxUnits?: number;
  /** 平台是否包含 Windows（决定保留名校验）。 */
  windows?: boolean;
}

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/** 默认配置：面向主流三种平台。 */
export const DEFAULT_PROFILE: PathCompatProfile = {
  platforms: ['windows', 'mac', 'linux'],
  maxBytes: 255,
  maxUnits: 255,
  windows: true,
};

/**
 * 判断一个文件名（不含路径）是否违反给定平台的文件系统规则。
 * @param name 不含扩展名拆分的原始文件名。
 */
export function isViolation(name: string, profile: PathCompatProfile = DEFAULT_PROFILE): boolean {
  if (name.length === 0) return true;
  if (name === '.' || name === '..') return true;
  if (/[<>:"/\\|?*]/.test(name)) return true;
  // 尾随点或空格
  if (/[. ]$/.test(name)) return true;
  if (profile.windows !== false && /^[a-zA-Z]:/.test(name)) return true;
  if (profile.windows && WINDOWS_RESERVED.test(name)) return true;
  if (profile.maxBytes && byteLength(name) > profile.maxBytes) return true;
  if (profile.maxUnits && name.length > profile.maxUnits) return true;
  return false;
}

/**
 * 修复一个文件名：去掉末尾点/空格、替换非法字符、处理保留名。
 * @param basename 文件名（不含扩展名）。
 * @param extension 扩展名（不含点，可为空）。
 */
export function repairName(
  basename: string,
  extension: string,
  profile: PathCompatProfile = DEFAULT_PROFILE,
): string {
  let name = basename;
  // 1) 去除末尾点与空格
  name = name.replace(/[. ]+$/g, '');
  // 2) 替换非法字符（保留允许的 unicode 与空格中间）
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  if (profile.windows) {
    // 3) 处理保留名：在其后补下划线
    if (WINDOWS_RESERVED.test(name)) {
      name = name + '_';
    }
  }
  // 5) 按字节/单元截断
  if (profile.maxBytes) {
    name = cutByCodepoints(name, profile.maxBytes);
  }
  if (profile.maxUnits) {
    name = cutByUnits(name, profile.maxUnits);
  }
  if (name.length === 0) {
    name = 'attachment';
  }
  return extension && extension.length > 0 ? `${name}.${extension}` : name;
}

/** 字节长度（UTF-8）。 */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** 按码点截断，避免拆散代理对（字节维度）。 */
export function cutByCodepoints(s: string, maxBytes: number): string {
  let out = '';
  for (const ch of s) {
    const candidate = out + ch;
    if (byteLength(candidate) > maxBytes) break;
    out = candidate;
  }
  return out;
}

/** 按 UTF-16 单元数截断（NTFS 维度）。 */
export function cutByUnits(s: string, maxUnits: number): string {
  return Array.from(s).slice(0, maxUnits).join('');
}

/** 归一化库内路径：去前导斜杠、collapse 重复斜杠、解析 `.`/`..` 段。
 *  Obsidian 可能产出 `././assets` 之类的冗余相对段，若不清掉，`ensureFolder`
 *  会尝试创建以 `.` 结尾的目录名从而被 Obsidian 拒绝（"File names cannot end with a dot or a space"）。 */
export function normalizeLocal(path: string): string {
  const segs = path.replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const s of segs) {
    if (s === '' || s === '.') continue;
    if (s === '..') {
      out.pop();
      continue;
    }
    out.push(s);
  }
  return out.join('/');
}

/**
 * 计算笔记所在目录下附件目录的库内相对路径（Obsidian 语义）：
 * `''`/`./`/`.` → 笔记目录；`./x` → 笔记目录/x；`/x` 或 `x` → 库根/x。
 */
export function resolveAttachmentDir(parent: string, setting: string): string {
  const f = setting.trim();
  if (!f || f === '/' || f === '.') return normalizeLocal(parent);
  if (f.startsWith('./')) return normalizeLocal(`${parent}/${f.slice(2)}`);
  if (f.startsWith('/')) return normalizeLocal(f.slice(1));
  // 裸名 → 库根
  return normalizeLocal(f);
}

/** 附件目录是否为"跟随笔记"型（相对笔记目录）。 */
export function isNoteRelativeFolder(setting: string): boolean {
  const f = setting.trim();
  return f === '' || f === '.' || f === './' || f.startsWith('./');
}

/**
 * 渲染附件目录模板中的变量。
 * 支持：${notename} 笔记文件名、${parent} 上级目录名、${parentpath} 上级目录相对路径、${date} 当天日期(YYYY-MM-DD)。
 * 模板本身仍可能带 ./ 等，后续交给 resolveAttachmentDir 解析。
 */
export function renderAttachmentFolderTemplate(
  template: string,
  noteName: string,
  parentPath: string,
  now: Date = new Date(),
): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const datePart = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const i = parentPath.lastIndexOf('/');
  const parentBase = parentPath === '' ? '' : i >= 0 ? parentPath.slice(i + 1) : parentPath;
  return template
    .replace(/\$\{notename\}/g, noteName)
    .replace(/\$\{parent\}/g, parentBase)
    .replace(/\$\{parentpath\}/g, parentPath)
    .replace(/\$\{date\}/g, datePart);
}

/** 判断库内路径是否命中排除目录（精确或前缀命中）。空排除返回 false。 */
export function isPathExcluded(path: string, excludes: string[]): boolean {
  if (!excludes || excludes.length === 0) return false;
  const norm = path.replace(/^\/+|\/+$/g, '');
  for (const raw of excludes) {
    const e = raw.trim().replace(/\/+$/, '');
    if (!e) continue;
    if (norm === e || norm.startsWith(`${e}/`)) return true;
  }
  return false;
}