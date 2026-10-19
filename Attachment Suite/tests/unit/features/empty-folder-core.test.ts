import { describe, expect, it } from 'vitest';
import {
  planEmptyFolderCleanup,
  planEmptyFolderCleanupDetailed,
} from '../../../src/features/empty-folder-core';

describe('empty-folder-core planEmptyFolderCleanup', () => {
  it('只清理叶子级空目录', () => {
    // assets 有文件，assets/empty 空；a/b 空但 a 有子目录 b，a 不是叶子空
    const files = ['assets/ok.png', 'note.md'];
    const folders = ['assets', 'assets/empty', 'a', 'a/b'];
    const empty = planEmptyFolderCleanup(files, folders);
    expect(empty.sort()).toEqual(['a/b', 'assets/empty']);
  });

  it('含文件或子目录的目录不清理', () => {
    // x/y 内有文件 → 非空；x 有子目录 → 非叶子空。均不清理。
    expect(planEmptyFolderCleanup(['x/y/f.png'], ['x', 'x/y'])).toEqual([]);
  });
});

describe('empty-folder-core 排除目录', () => {
  it('排除目录本身及其内部各级空目录都跳过，并如实计数', () => {
    // assets 与其子目录 assets/empty 都在排除名单内（前缀命中）→ 均不动；other 照常清理
    const folders = ['assets', 'assets/empty', 'other'];
    const r = planEmptyFolderCleanupDetailed([], folders, ['assets']);
    expect(r.toDelete).toEqual(['other']);
    // 仅叶子级空目录计入：assets 因含子目录本就不是候选，故只统计到 assets/empty
    expect(r.excluded).toBe(1);
    expect(planEmptyFolderCleanup([], folders, ['assets'])).toEqual(['other']);
  });

  it('被排除的空目录仍参与父目录判定，父目录不被误删', () => {
    // 若把被排除项从 folders 中剔除，a 会变成"叶子空目录"而被误删（绕过用户的排除意图）
    const r = planEmptyFolderCleanupDetailed([], ['a', 'a/b'], ['a/b']);
    expect(r.toDelete).toEqual([]);
    expect(r.excluded).toBe(1);
  });

  it('排除名单为空时与旧接口行为一致', () => {
    expect(planEmptyFolderCleanupDetailed([], ['a', 'a/b'], []).excluded).toBe(0);
    expect(planEmptyFolderCleanup([], ['a', 'a/b'], []).sort()).toEqual(['a/b']);
  });
});