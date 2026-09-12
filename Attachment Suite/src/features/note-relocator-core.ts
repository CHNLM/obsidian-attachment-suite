/** 笔记移动联动 · 纯计算（不依赖 obsidian，可单测）。 */

import { extOf, isManagedAttachment, listMatches } from '../core';

export interface MovePlanItem {
  from: string;
  to: string;
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}

export function basenameOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

/** 从笔记文本解析出的附件目标名（去重、排除笔记与外部链接）。 */
export function attachmentTargetsFromText(text: string): string[] {
  const names = new Set<string>();
  for (const m of listMatches(text)) {
    if (/^https?:/i.test(m.linkText)) continue;
    if (m.linkText.endsWith('.md') || m.linkText.endsWith('.canvas')) continue;
    if (!isManagedAttachment(extOf(m.linkText))) continue;
    names.add(basenameOf(m.linkText));
  }
  return Array.from(names);
}

/** 纯计算：由旧/新目录与附件名集合生成移动计划。 */
export function planRelocation(
  targets: string[],
  oldDir: string,
  newDir: string,
): MovePlanItem[] {
  const moves: MovePlanItem[] = [];
  for (const name of targets) {
    const from = oldDir ? `${oldDir}/${name}` : name;
    const to = newDir ? `${newDir}/${name}` : name;
    if (from === to) continue;
    moves.push({ from, to });
  }
  return moves;
}