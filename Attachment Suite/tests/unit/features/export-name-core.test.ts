import { describe, expect, it } from 'vitest';
import { tsOf, uniqueFlatName } from '../../../src/features/export-name-core';

describe('exporter 扁平归档同名去重', () => {
  it('无冲突时保留原名', () => {
    const used = new Set<string>();
    expect(uniqueFlatName('photo.png', used, '20260910120000')).toBe('photo.png');
  });

  it('冲突时追加时间戳以区分', () => {
    const used = new Set<string>(['photo.png']);
    const name = uniqueFlatName('photo.png', used, '20260910120000');
    expect(name).toBe('photo_20260910120000.png');
  });

  it('时间戳也冲突时追加序号兜底', () => {
    const used = new Set<string>(['photo.png', 'photo_20260910120000.png']);
    expect(uniqueFlatName('photo.png', used, '20260910120000')).toBe('photo_20260910120000_1.png');
  });

  it('tsOf 格式化为 YYYYMMDDHHmmss', () => {
    const ms = new Date(2026, 8, 10, 12, 30, 45).getTime();
    expect(tsOf(ms)).toBe('20260910123045');
  });

  it('无扩展名文件冲突时同样追加时间戳', () => {
    const used = new Set<string>(['LICENSE']);
    expect(uniqueFlatName('LICENSE', used, '20260910120000')).toBe('LICENSE_20260910120000');
  });
});