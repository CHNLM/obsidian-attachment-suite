/** 链接兜底改写 · 纯计算（不依赖 obsidian，可脱离 App 单测）。 */
import { rewrite, rewriteFrontmatter } from '../core';

export interface MoveOutcomeRow {
  from: string;
  to: string;
}

/**
 * 由移动结果构造改写映射：同时覆盖“完整路径”与“纯 basename”两种写法，
 * 使正文中的短名嵌入 `[[old.png]]` 也能被正确改写为目标路径。
 */
export function refMapForMoves(moves: MoveOutcomeRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const mv of moves) {
    map.set(mv.from, mv.to);
    const base = basenameOf(mv.from);
    if (!map.has(base)) map.set(base, mv.to);
  }
  return map;
}

function basenameOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

export { rewrite, rewriteFrontmatter };