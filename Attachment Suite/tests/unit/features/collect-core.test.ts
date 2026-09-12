import { describe, expect, it } from 'vitest';
import type { AttachmentEntry } from '../../../src/core';
import { planCollect } from '../../../src/features/collect-core';

function entry(path: string, note: string): AttachmentEntry {
  return {
    path,
    category: 'image',
    mime: '',
    animated: false,
    size: 0,
    mtime: 0,
    references: [{ sourcePath: note, kind: 'embed', raw: '', linkText: path, status: 'resolved' }],
  };
}

describe('collect-core planCollect', () => {
  it('把被当前笔记引用但不在目标目录的附件规划移动', () => {
    const plan = planCollect(
      [entry('root-pic.png', 'NoteC.md'), entry('assets/ok.png', 'NoteC.md'), entry('assets/b.png', 'Other.md')],
      'NoteC.md',
      'assets',
    );
    expect(plan).toEqual([{ from: 'root-pic.png', to: 'assets/root-pic.png' }]);
  });

  it('已在目标目录或非本笔记引用的不收集', () => {
    const plan = planCollect([entry('assets/ok.png', 'NoteC.md')], 'NoteC.md', 'assets');
    expect(plan).toHaveLength(0);
  });

  it('无目标目录时子目录附件规划移动到库根，根级附件跳过', () => {
    const plan = planCollect([entry('root-pic.png', 'NoteC.md'), entry('assets/a.png', 'NoteC.md')], 'NoteC.md', '');
    // 根级附件已“在目标目录” → 跳过；子目录附件被规划收集到库根
    expect(plan).toEqual([{ from: 'assets/a.png', to: 'a.png' }]);
  });
});