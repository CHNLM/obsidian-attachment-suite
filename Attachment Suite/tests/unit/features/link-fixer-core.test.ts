import { describe, expect, it } from 'vitest';
import { refMapForMoves } from '../../../src/features/link-fixer-core';
import { rewrite } from '../../../src/core/link-resolver';

describe('link-fixer refMapForMoves', () => {
  it('完整路径与 basename 均可映射', () => {
    const map = refMapForMoves([{ from: 'assets/raw pic.png', to: 'assets/E2E_image_001.png' }]);
    expect(map.get('assets/raw pic.png')).toBe('assets/E2E_image_001.png');
    expect(map.get('raw pic.png')).toBe('assets/E2E_image_001.png');
  });

  it('rewrite 能将短名嵌入改写为目标路径', () => {
    const map = refMapForMoves([{ from: 'assets/raw pic.png', to: 'assets/E2E_image_001.png' }]);
    const out = rewrite('![[raw pic.png]]\n', map);
    expect(out).toContain('assets/E2E_image_001.png');
    expect(out).not.toContain('raw pic.png');
  });

  it('两个目录存在同名文件时，basename 短名以首个移动目标为准（不覆盖）', () => {
    const map = refMapForMoves([
      { from: 'a/x.png', to: 'a/x_1.png' },
      { from: 'b/x.png', to: 'b/x_2.png' },
    ]);
    // 完整路径各自独立映射
    expect(map.get('a/x.png')).toBe('a/x_1.png');
    expect(map.get('b/x.png')).toBe('b/x_2.png');
    // 纯 basename 短名命中首个目标；不因第二个移动而改写，避免歧义改写错误文件
    expect(map.get('x.png')).toBe('a/x_1.png');
  });
});