/** 一致性：路径修复 · 纯计算（不依赖 obsidian，可脱离 App 单测）。 */

import { repairName } from '../core';
import type { PathCompatProfile } from '../core';

export interface PathFixItem {
  from: string;
  to: string;
  name: string;
}

/** 从平台列表构造路径兼容配置。 */
export function profileFromPlatforms(platforms: PathCompatProfile['platforms']): PathCompatProfile {
  return {
    platforms,
    maxBytes: 255,
    maxUnits: 255,
    windows: platforms.includes('windows'),
  };
}

/**
 * 规划需修复的路径（纯计算）。仅当修复后名字与当前不同才列入。
 * @param paths 全部附件路径。
 * @param profile 目标平台配置。
 */
export function planPathFixes(paths: Iterable<string>, profile: PathCompatProfile): PathFixItem[] {
  const items: PathFixItem[] = [];
  for (const path of paths) {
    const slash = path.lastIndexOf('/');
    const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
    const fullname = path.slice(slash + 1);
    const dot = fullname.lastIndexOf('.');
    const stem = dot > 0 ? fullname.slice(0, dot) : fullname;
    const ext = dot > 0 ? fullname.slice(dot + 1) : '';
    const repaired = repairName(stem, ext, profile);
    if (repaired === fullname) continue;
    items.push({ from: path, to: `${dir}${repaired}`, name: repaired });
  }
  return items;
}