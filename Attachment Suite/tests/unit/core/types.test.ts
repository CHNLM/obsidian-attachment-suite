/**
 * `src/core/types.ts` 的单元测试。
 *
 * 为什么单独补这一份：`types.ts` 是 core 里**唯一**自带逻辑却没有对应单测文件的模块，
 * 而它导出的四个工具（`basenameOf` / `dirOf` / `extOf` 与 `isManagedAttachment`）是
 * 全仓共用的"唯一归属"实现——`architecture.test.ts` 专门拦它们的重复实现。
 * 其中 `extOf` 历史上曾有两份**不等价**的实现（对"目录名含点 + 文件名无扩展名"处理不同），
 * 正是本仓库四次误删级缺陷的温床；这里把已修正的语义钉死，防止回归。
 *
 * 口径与 `types.ts` 的文档注释逐条对应：本文件只断言注释里**已声明**的行为，
 * 不给未定义行为发明预期。
 */

import { describe, it, expect } from 'vitest';

import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  MANAGED_ATTACHMENT_EXTENSIONS,
  OTHER_ATTACHMENT_EXTENSIONS,
  VIDEO_EXTENSIONS,
  basenameOf,
  dirOf,
  extOf,
  isManagedAttachment,
  isNoteText,
} from '../../../src/core/types';

describe('core/types：路径工具', () => {
  it('basenameOf 取最后一个 / 之后的部分；无 / 时原样返回', () => {
    expect(basenameOf('a/b/c.png')).toBe('c.png');
    expect(basenameOf('assets/中文 图.png')).toBe('中文 图.png');
    expect(basenameOf('c.png')).toBe('c.png');
    expect(basenameOf('')).toBe('');
  });

  it('dirOf 取最后一个 / 之前的部分；库根文件的父目录为空串', () => {
    expect(dirOf('a/b/c.png')).toBe('a/b');
    expect(dirOf('a/b')).toBe('a');
    expect(dirOf('c.png')).toBe('');
    expect(dirOf('')).toBe('');
  });

  it('extOf 返回小写扩展名；无扩展名返回空串', () => {
    expect(extOf('a/photo.PNG')).toBe('png');
    expect(extOf('a/photo.jpg')).toBe('jpg');
    expect(extOf('a/archive.tar.gz')).toBe('gz');
    expect(extOf('a/README')).toBe('');
    expect(extOf('')).toBe('');
  });

  it('extOf 必须先取 basename——目录名含点不得污染结果（历史缺陷回归）', () => {
    // 早期实现对整条路径取 lastIndexOf('.')：
    //   docs/v1.2/README → "2/readme"；assets/a.png/file → "png/file"。
    // 垃圾串喂 isManagedAttachment 恰好为 false，纯属侥幸——但 broken-link-core 用
    // `!extOf(t)` 判定"无扩展名短名引用"，拿到垃圾串会静默跳过候选扩展。
    expect(extOf('docs/v1.2/README')).toBe('');
    expect(extOf('assets/a.png/file')).toBe('');
    expect(extOf('v1.2/notes/plan')).toBe('');
  });
});

describe('core/types：受管附件名单', () => {
  it('isManagedAttachment 认全部 21 个受管扩展名', () => {
    for (const ext of MANAGED_ATTACHMENT_EXTENSIONS) {
      expect(isManagedAttachment(ext), `受管扩展名 ${ext} 未被认得`).toBe(true);
    }
  });

  it('isManagedAttachment 大小写不敏感，且拒绝非受管扩展名', () => {
    expect(isManagedAttachment('PNG')).toBe(true);
    expect(isManagedAttachment('JpEg')).toBe(true);
    for (const ext of ['txt', 'html', 'zip', 'exe', 'md', 'canvas', '']) {
      expect(isManagedAttachment(ext), `${ext} 不应算受管附件`).toBe(false);
    }
  });

  it('MANAGED_ATTACHMENT_EXTENSIONS 恰好 21 项、无重复，且等于四个分组之并', () => {
    expect(MANAGED_ATTACHMENT_EXTENSIONS.length).toBe(21);
    expect(new Set(MANAGED_ATTACHMENT_EXTENSIONS).size).toBe(21);
    expect(new Set(MANAGED_ATTACHMENT_EXTENSIONS)).toEqual(
      new Set([
        ...IMAGE_EXTENSIONS,
        ...VIDEO_EXTENSIONS,
        ...AUDIO_EXTENSIONS,
        ...OTHER_ATTACHMENT_EXTENSIONS,
      ]),
    );
  });

  it('isNoteText 认 .md 与 .canvas（附件不算笔记文本）', () => {
    expect(isNoteText('notes/a.md')).toBe(true);
    expect(isNoteText('board.canvas')).toBe(true);
    expect(isNoteText('assets/a.png')).toBe(false);
    expect(isNoteText('notes/readme.txt')).toBe(false);
    expect(isNoteText('')).toBe(false);
  });
});
