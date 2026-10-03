import { describe, expect, it } from 'vitest';
import type { AttachmentEntry } from '../../../src/core';
import { planBulkCollect } from '../../../src/features/bulk-collect-core';

function entry(path: string, ...notes: string[]): AttachmentEntry {
  return {
    path,
    category: 'image',
    mime: '',
    animated: false,
    size: 0,
    mtime: 0,
    references: notes.map((note) => ({
      sourcePath: note,
      kind: 'embed' as const,
      raw: '',
      linkText: path,
      status: 'resolved' as const,
    })),
  };
}

const dirs = new Map<string, string>([
  ['NoteA.md', 'NoteA/assets'],
  ['NoteB.md', 'NoteB/assets'],
]);

describe('bulk-collect-core planBulkCollect', () => {
  it('把每篇笔记的散落独占附件收集到各自归属目录', () => {
    const plan = planBulkCollect(
      [
        entry('root-a.png', 'NoteA.md'),
        entry('NoteB/assets/ok.png', 'NoteB.md'),
        entry('loose-b.png', 'NoteB.md'),
      ],
      dirs,
    );
    expect(plan.total).toBe(2);
    expect(plan.skippedShared).toBe(0);
    expect(plan.perNote.get('NoteA.md')?.items).toEqual([{ from: 'root-a.png', to: 'NoteA/assets/root-a.png' }]);
    expect(plan.perNote.get('NoteB.md')?.items).toEqual([{ from: 'loose-b.png', to: 'NoteB/assets/loose-b.png' }]);
  });

  it('已在归属目录或不在范围内的不收集', () => {
    const plan = planBulkCollect([entry('NoteA/assets/in.png', 'NoteA.md')], dirs);
    expect(plan.total).toBe(0);
  });

  it('被多篇笔记共用（至少 2 个不同 sourcePath）的附件跳过', () => {
    const plan = planBulkCollect([entry('shared/logo.png', 'NoteA.md', 'NoteB.md')], dirs);
    expect(plan.skippedShared).toBe(1);
    expect(plan.total).toBe(0);
  });

  it('归属笔记不在 targetDirs（如被排除目录过滤）时跳过其附件', () => {
    const plan = planBulkCollect([entry('excluded/a.png', 'Excluded.md')], dirs);
    expect(plan.total).toBe(0);
  });
});