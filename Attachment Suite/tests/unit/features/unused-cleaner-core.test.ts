import { describe, expect, it } from 'vitest';
import { planCleanup, shouldExclude } from '../../../src/features/unused-cleaner-core';

describe('unused-cleaner-core', () => {
  it('精确目录排除', () => {
    expect(shouldExclude('assets/keep/a.png', ['assets'], false)).toBe(false);
    expect(shouldExclude('assets/keep/a.png', ['assets/keep'], false)).toBe(true);
  });

  it('含子目录排除覆盖后代', () => {
    expect(shouldExclude('assets/keep/sub/a.png', ['assets/keep'], true)).toBe(true);
    expect(shouldExclude('assets/keep/a.png', ['assets/keep'], true)).toBe(true);
    expect(shouldExclude('other/x.png', ['assets/keep'], true)).toBe(false);
  });

  it('planCleanup 过滤排除目录', () => {
    const plan = planCleanup(
      ['assets/a.png', 'assets/keep/b.png', 'other/c.jpg'],
      ['assets/keep'],
      false,
    );
    expect(plan.toDelete).toEqual(['assets/a.png', 'other/c.jpg']);
    expect(plan.excluded).toEqual(['assets/keep/b.png']);
  });

  it('空排除时不保留任何项', () => {
    const plan = planCleanup(['a.png'], [], false);
    expect(plan.toDelete).toEqual(['a.png']);
    expect(plan.excluded).toEqual([]);
  });

  it('排除目录带尾随斜杠时归一化后仍命中', () => {
    expect(shouldExclude('assets/keep/a.png', ['assets/keep/'], false)).toBe(true);
    expect(shouldExclude('assets/keep/a.png', ['assets/keep/'], true)).toBe(true);
  });

  it('库根文件（无父目录）不会被排除目录命中', () => {
    expect(shouldExclude('root.png', ['assets'], true)).toBe(false);
    expect(shouldExclude('assets.png', ['assets'], false)).toBe(false);
  });

  it('全局排除目录按整棵子树豁免（不受 excludeSubfolders 影响）', () => {
    // 回归：`paths.exclude` 在报告 / 本地化 / 导出 / 全库批量里都按前缀解释，
    // 只有清理曾把它并进「清理排除名单」按"仅列出目录本身"处理 → 子树里的孤儿
    // 既不出现在报告里（被前缀过滤掉）、又会被清理删掉。
    expect(shouldExclude('keep/orphan.png', [], false, ['keep'])).toBe(true);
    expect(shouldExclude('keep/sub/orphan.png', [], false, ['keep'])).toBe(true);
    // 前缀不得误伤同前缀的兄弟目录（keep 不能命中 kept）
    expect(shouldExclude('kept/orphan.png', [], false, ['keep'])).toBe(false);
    // 两条名单互不干扰：「清理」自己的排除名单仍只豁免本层（默认不连带子目录）
    expect(shouldExclude('assets/keep/sub/a.png', ['assets/keep'], false, ['other'])).toBe(false);
    const plan = planCleanup(['keep/sub/orphan.png', 'other.png'], [], false, ['keep']);
    expect(plan.toDelete).toEqual(['other.png']);
    expect(plan.excluded).toEqual(['keep/sub/orphan.png']);
  });
});