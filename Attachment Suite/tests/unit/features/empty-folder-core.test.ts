import { describe, expect, it } from 'vitest';
import { planEmptyFolderCleanup } from '../../../src/features/empty-folder-core';

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