import { describe, expect, it } from 'vitest';
import { planPathFixes, profileFromPlatforms } from '../../../src/features/consistency-core';

describe('consistency / path-fix', () => {
  it('构造 Windows 配置文件', () => {
    const p = profileFromPlatforms(['windows']);
    expect(p.windows).toBe(true);
  });

  it('修复 Windows 保留名', () => {
    const items = planPathFixes(['assets/CON.png'], profileFromPlatforms(['windows']));
    expect(items).toHaveLength(1);
    expect(items[0].to).toBe('assets/CON_.png');
  });

  it('修复尾随空格的文件名', () => {
    const items = planPathFixes(['assets/a .png'], profileFromPlatforms(['windows']));
    expect(items).toHaveLength(1);
    expect(items[0].to).toBe('assets/a.png');
  });

  it('合法文件名不列入', () => {
    const items = planPathFixes(['assets/ok.png', 'assets/fine-folder_123.mp4'], profileFromPlatforms(['windows']));
    expect(items).toHaveLength(0);
  });

  it('混合输入只列需修复项', () => {
    const items = planPathFixes(
      ['assets/good.png', 'assets/NUL.jpg', 'assets/bad?.png'],
      profileFromPlatforms(['windows']),
    );
    expect(items.map((i) => i.to)).toEqual(['assets/NUL_.jpg', 'assets/bad_.png']);
  });

  it('非 Windows 平台：保留名不修复，仅通用违规（尾随空格）被修复', () => {
    const items = planPathFixes(['assets/CON.png', 'assets/bad .png'], profileFromPlatforms(['mac', 'linux']));
    expect(items.map((i) => i.to)).toEqual(['assets/bad.png']);
  });

  it('根目录文件（无目录前缀）也能规划', () => {
    const items = planPathFixes(['CON.png'], profileFromPlatforms(['windows']));
    expect(items[0].to).toBe('CON_.png');
    expect(items[0].from).toBe('CON.png');
  });

  it('profileFromPlatforms 未含 windows 时 windows 标志为 false', () => {
    expect(profileFromPlatforms(['mac', 'linux']).windows).toBe(false);
    expect(profileFromPlatforms(['windows']).windows).toBe(true);
  });
});