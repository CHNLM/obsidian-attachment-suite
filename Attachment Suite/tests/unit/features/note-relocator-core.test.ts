import { describe, expect, it } from 'vitest';
import { attachmentTargetsFromText, planRelocation } from '../../../src/features/note-relocator-core';
import { isNoteRelativeFolder, normalizeLocal, resolveAttachmentDir } from '../../../src/core';

describe('note-relocator', () => {
  it('resolveAttachmentDir 语义', () => {
    expect(resolveAttachmentDir('a', './assets')).toBe('a/assets');
    expect(resolveAttachmentDir('b/c', '.')).toBe('b/c');
    expect(resolveAttachmentDir('', './assets')).toBe('assets');
    // 回归：Obsidian 附件目录可能存为 ././assets 这类冗余相对段，必须归一化，否则会尝试创建以 . 结尾的目录
    expect(resolveAttachmentDir('测试A', '././assets')).toBe('测试A/assets');
    expect(normalizeLocal('测试A/./assets')).toBe('测试A/assets');
  });

  it('跟随型判定', () => {
    expect(isNoteRelativeFolder('./assets')).toBe(true);
    expect(isNoteRelativeFolder('.')).toBe(true);
    expect(isNoteRelativeFolder('')).toBe(true);
    expect(isNoteRelativeFolder('/assets')).toBe(false);
    expect(isNoteRelativeFolder('assets')).toBe(false);
  });

  it('从笔记文本解析附件目标', () => {
    const refs = attachmentTargetsFromText(
      '![[assets/logo.png]] ![x](assets/b.mp4) [[另一个笔记]] ![[note_image_001.jpg]] [外链](https://x.com/a.png)',
    );
    expect(refs).toEqual(expect.arrayContaining(['logo.png', 'b.mp4', 'note_image_001.jpg']));
    expect(refs).not.toContain('另一个笔记');
    expect(refs).not.toContain('a.png'); // 外链被排除
  });

  it('planRelocation 生成旧→新', () => {
    const moves = planRelocation(['a.png', 'b.mp4'], 'old/assets', 'new/assets');
    expect(moves).toEqual([
      { from: 'old/assets/a.png', to: 'new/assets/a.png' },
      { from: 'old/assets/b.mp4', to: 'new/assets/b.mp4' },
    ]);
  });

  it('planRelocation 同目录时跳过（无移动）', () => {
    expect(planRelocation(['a.png'], 'same/assets', 'same/assets')).toEqual([]);
  });
});