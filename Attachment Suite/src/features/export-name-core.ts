/** 导出归档命名 · 纯计算（不依赖 obsidian，可脱离 App 单测）。 */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 把毫秒时间戳格式化为 YYYYMMDDHHmmss，用于归档时区分同名文件。 */
export function tsOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/**
 * 扁平归档命名：遇 basename 冲突时，对后续同名文件追加时间戳，
 * 使同名附件在 zip 中能并存、便于区分；时间戳也冲突则追加序号兜底。
 */
export function uniqueFlatName(base: string, used: Set<string>, stamp: string): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot >= 0 ? base.slice(dot) : '';
  let candidate = `${stem}_${stamp}${ext}`;
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let i = 1;
  candidate = `${stem}_${stamp}_${i}${ext}`;
  while (used.has(candidate)) {
    i++;
    candidate = `${stem}_${stamp}_${i}${ext}`;
  }
  used.add(candidate);
  return candidate;
}