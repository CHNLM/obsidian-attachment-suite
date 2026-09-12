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
});