import { describe, expect, it } from 'vitest';
import {
  isViolation,
  repairName,
  renderAttachmentFolderTemplate,
  isPathExcluded,
  byteLength,
  cutByCodepoints,
  cutByUnits,
  normalizeLocal,
  resolveAttachmentDir,
} from '../../../src/core/path-compatibility';

describe('path-compatibility', () => {
  it('标记 Windows 保留名为违规', () => {
    expect(isViolation('CON', { platforms: ['windows'], windows: true })).toBe(true);
    expect(isViolation('com1', { platforms: ['windows'], windows: true })).toBe(true);
  });

  it('标记非法字符与尾随点/空格', () => {
    expect(isViolation('a<bb')).toBe(true);
    expect(isViolation('trailing.')).toBe(true);
    expect(isViolation('trailing ')).toBe(true);
  });

  it('合法文件名不违规', () => {
    expect(isViolation('my_note_image')).toBe(false);
    expect(isViolation('CON.png')).toBe(false); // 扩展名不属于保留名判定（按整体）——此处整体是 CON.png，保留名不含扩展
  });

  it('修复保留名', () => {
    expect(repairName('CON', 'rgba', { platforms: ['windows'], windows: true })).toBe('CON_.rgba');
  });

  it('去掉尾随空格/点', () => {
    expect(repairName('name  ', 'png')).toBe('name.png');
  });

  it('替换非法字符', () => {
    expect(repairName('a<b>c|d', 'png')).toBe('a_b_c_d.png');
  });

  it('空基名回退', () => {
    expect(repairName('..', 'png')).toBe('attachment.png');
  });

  it('渲染附件目录模板变量', () => {
    const now = new Date(2026, 8, 10); // 2026-09-10
    expect(renderAttachmentFolderTemplate('./assets/${notename}', '我的笔记', 'AAA/BBB', now)).toBe(
      './assets/我的笔记',
    );
    expect(renderAttachmentFolderTemplate('${parent}/attachments', 'n', 'AAA/BBB', now)).toBe(
      'BBB/attachments',
    );
    expect(renderAttachmentFolderTemplate('${parentpath}/${date}', 'n', 'AAA/BBB', now)).toBe(
      'AAA/BBB/2026-09-10',
    );
  });

  it('排除路径精确/前缀命中', () => {
    expect(isPathExcluded('a/b.png', ['a'])).toBe(true);
    expect(isPathExcluded('a/b/c.png', ['a'])).toBe(true);
    expect(isPathExcluded('b/a.png', ['a'])).toBe(false);
    expect(isPathExcluded('x.png', [])).toBe(false);
  });

  it('isViolation：盘符前缀、空名与点目录', () => {
    expect(isViolation('C:folder')).toBe(true);
    expect(isViolation('c:\\path')).toBe(true);
    expect(isViolation('')).toBe(true);
    expect(isViolation('.')).toBe(true);
    expect(isViolation('..')).toBe(true);
  });

  it('isViolation：超过最大字节数（UTF-8）违规', () => {
    // 100 个中文字符 → 300 字节 > 255
    expect(isViolation('汉'.repeat(100))).toBe(true);
    // 250 个 ASCII 字符 → 250 字节 < 255，合法
    expect(isViolation('a'.repeat(250))).toBe(false);
  });

  it('isViolation：非 Windows 平台保留名不违规', () => {
    const nonWindows = { platforms: ['mac', 'linux'] as const, windows: false };
    expect(isViolation('CON', nonWindows)).toBe(false);
    expect(isViolation('aux', nonWindows)).toBe(false);
    // ':' 在任意平台都非法（通用非法字符表）；盘符前缀规则仅随 windows !== false 生效
    expect(isViolation('C:foo', nonWindows)).toBe(true);
  });

  it('repairName：按字节截断避免拆散代理对', () => {
    const r = repairName('汉'.repeat(100), 'png', { platforms: ['windows'], windows: true, maxBytes: 100 });
    expect(byteLength(r.replace(/\.png$/, ''))).toBeLessThanOrEqual(100);
  });

  it('repairName：按 UTF-16 单元数截断', () => {
    const r = repairName('ab'.repeat(200), 'png', { platforms: ['windows'], windows: true, maxUnits: 100 });
    expect(r).toBe(`${'ab'.repeat(50)}.png`);
  });

  it('repairName：替换控制字符', () => {
    expect(repairName('a\u0000b\u001fc', 'png')).toBe('a_b_c.png');
  });

  it('repairName：非法字符盘符保留名组合', () => {
    expect(repairName('C:*|', 'png', { platforms: ['windows'], windows: true })).toBe('C___.png');
  });

  it('byteLength / cutByCodepoints / cutByUnits 语义', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('中文')).toBe(6);
    // 单个 emoji（代理对）不可被字节截断拆散
    expect(cutByCodepoints('a😀b', 4)).toBe('a'); // 'a'=1 + 😀=4 → 5 字节装不下 → 停
    expect(cutByCodepoints('a😀b', 6)).toBe('a😀b');
    expect(cutByUnits('abcde', 3)).toBe('abc');
  });

  it('normalizeLocal：解析 . 与 .. 段、去前导斜杠、collapse 重复斜杠', () => {
    expect(normalizeLocal('a/./b/../c')).toBe('a/c');
    expect(normalizeLocal('/assets/x.png')).toBe('assets/x.png');
    expect(normalizeLocal('a//b///c')).toBe('a/b/c');
    expect(normalizeLocal('')).toBe('');
    expect(normalizeLocal('../x.png')).toBe('x.png');
  });

  it('resolveAttachmentDir：根路径与裸名指向库根', () => {
    expect(resolveAttachmentDir('a', '/assets')).toBe('assets');
    expect(resolveAttachmentDir('a', 'assets')).toBe('assets');
    expect(resolveAttachmentDir('a', './assets')).toBe('a/assets');
  });

  it('repairName：空扩展名文件（无 .ext）仅修复基名，不追加点扩展', () => {
    expect(repairName('LICENSE ', '')).toBe('LICENSE');
    expect(repairName('a<b', '')).toBe('a_b');
  });

  it('isViolation：超过 UTF-16 单元上限（NTFS）判定为违规', () => {
    const profile = { platforms: ['windows'] as const, windows: true, maxBytes: 255, maxUnits: 10 };
    expect(isViolation('a'.repeat(11), profile)).toBe(true);
    expect(isViolation('a'.repeat(10), profile)).toBe(false);
  });
});