import { describe, expect, it } from 'vitest';
import type { AttachmentEntry, AttachmentIndexSnapshot } from '../../../src/core';
import { planBulkRename } from '../../../src/features/bulk-rename-core';
import type { NamingSettings } from '../../../src/settings';

const NAMING: NamingSettings = {
  enabled: true,
  connector: '_',
  addTime: false,
  addPathHash: false,
  honorCategory: true,
  showSubType: false,
  categoryWords: { image: 'image', video: 'video', audio: 'audio', pdf: 'pdf', document: 'document', webpage: 'webpage', misc: 'misc' },
};

function entry(path: string, category: AttachmentEntry['category'], notePaths: string[], noteName: string): AttachmentEntry {
  return {
    path,
    category,
    mime: '',
    animated: false,
    size: 0,
    mtime: 0,
    references: notePaths.map((sourcePath) => ({
      sourcePath,
      kind: 'embed',
      raw: path,
      linkText: path,
      status: 'resolved' as const,
    })),
  };
}

function snapshot(entries: AttachmentEntry[]): AttachmentIndexSnapshot {
  return { entries: new Map(entries.map((e) => [e.path, e])), brokenRefs: [], orphanCandidates: [] };
}

describe('bulk-rename-core planBulkRename', () => {
  it('按归属笔记分组生成真实 from→to', () => {
    const plan = planBulkRename(
      snapshot([
        entry('assets/a.png', 'image', ['note.md'], 'note'),
        entry('assets/b.mp4', 'video', ['note.md'], 'note'),
        entry('assets/c.jpg', 'image', ['doc.md'], 'doc'),
      ]),
      NAMING,
    );
    expect(plan.perNote.has('note.md')).toBe(true);
    expect(plan.perNote.has('doc.md')).toBe(true);
    expect(plan.total).toBe(3);
    // note 的独占附件生成各自命名
    const notePlan = plan.perNote.get('note.md')!;
    const tos = notePlan.items.map((i) => i.to).sort();
    expect(tos).toEqual(['assets/note_image_001.png', 'assets/note_video_001.mp4']);
  });

  it('共享附件 sharedCount 计数正确（被多篇引用计一份）', () => {
    const plan = planBulkRename(
      snapshot([
        entry('shared.png', 'image', ['note.md', 'doc.md'], 'note'),
        entry('only.png', 'image', ['note.md'], 'note'),
      ]),
      NAMING,
    );
    expect(plan.sharedCount).toBe(1);
    // 共享附件对每篇各生成一项（副本预览）
    const notePlan = plan.perNote.get('note.md')!;
    const docPlan = plan.perNote.get('doc.md')!;
    expect(notePlan.items.some((i) => i.from === 'shared.png')).toBe(true);
    expect(docPlan.items.some((i) => i.from === 'shared.png')).toBe(true);
  });

  it('已按方案命名的附件被跳过（幂等）', () => {
    const plan = planBulkRename(
      snapshot([
        entry('assets/note_image_001.png', 'image', ['note.md'], 'note'),
        entry('assets/note_video_001.mp4', 'video', ['note.md'], 'note'),
      ]),
      NAMING,
    );
    // 均已符合「笔记_类别_序号」，无需处理
    expect(plan.total).toBe(0);
    expect(plan.perNote.size).toBe(0);
  });

  it('未被引用的附件不进入计划', () => {
    const plan = planBulkRename(
      snapshot([
        entry('assets/used.png', 'image', ['note.md'], 'note'),
        entry('assets/orphan.png', 'image', [], 'note'), // 无引用
      ]),
      NAMING,
    );
    expect(plan.total).toBe(1);
    expect(plan.perNote.get('note.md')!.items.map((i) => i.from)).toEqual(['assets/used.png']);
  });

  it('folderByCategory 时全库命名按类别放入 <附件原目录>/<类型>/', () => {
    const plan = planBulkRename(
      snapshot([
        entry('assets/a.png', 'image', ['note.md'], 'note'),
        entry('doc/b.pdf', 'pdf', ['doc.md'], 'doc'),
      ]),
      { ...NAMING, folderByCategory: true },
    );
    expect(plan.perNote.get('note.md')!.items.map((i) => i.to)).toEqual([
      'assets/image/note_image_001.png',
    ]);
    expect(plan.perNote.get('doc.md')!.items.map((i) => i.to)).toEqual([
      'doc/pdf/doc_pdf_001.pdf',
    ]);
  });

  it('共享附件为每篇引用笔记各生成带各自笔记名的副本', () => {
    const plan = planBulkRename(
      snapshot([entry('assets/shared.png', 'image', ['a.md', 'b.md'], 'a')]),
      NAMING,
    );
    const aTos = plan.perNote.get('a.md')!.items.map((i) => i.to);
    const bTos = plan.perNote.get('b.md')!.items.map((i) => i.to);
    expect(aTos).toEqual(['assets/a_image_001.png']);
    expect(bTos).toEqual(['assets/b_image_001.png']);
    // 同一原文件 → 两个不同副本目标
    expect(aTos[0]).not.toBe(bTos[0]);
    expect(plan.perNote.get('a.md')!.items[0].from).toBe('assets/shared.png');
    expect(plan.perNote.get('b.md')!.items[0].from).toBe('assets/shared.png');
    expect(plan.sharedCount).toBe(1);
    expect(plan.total).toBe(2);
  });

  it('同类别多附件序号递增 001/002', () => {
    const plan = planBulkRename(
      snapshot([
        entry('assets/x.png', 'image', ['note.md'], 'note'),
        entry('assets/y.png', 'image', ['note.md'], 'note'),
      ]),
      NAMING,
    );
    const tos = plan.perNote.get('note.md')!.items.map((i) => i.to).sort();
    expect(tos).toEqual(['assets/note_image_001.png', 'assets/note_image_002.png']);
  });

  it('addTime/addPathHash 开启时全库命名含时间与哈希段', () => {
    const plan = planBulkRename(
      snapshot([entry('assets/x.png', 'image', ['note.md'], 'note')]),
      { ...NAMING, addTime: true, addPathHash: true },
    );
    const to = plan.perNote.get('note.md')!.items[0].to;
    expect(/^assets\/note_image_001_\d{14}_[0-9a-f]{8}\.png$/.test(to)).toBe(true);
  });

  it('空快照 → 空计划', () => {
    const plan = planBulkRename(snapshot([]), NAMING);
    expect(plan.total).toBe(0);
    expect(plan.perNote.size).toBe(0);
    expect(plan.sharedCount).toBe(0);
  });

  it('从带目录的 sourcePath 提取笔记名（去掉扩展名与目录）', () => {
    const plan = planBulkRename(
      snapshot([entry('assets/x.png', 'image', ['AAA/sub.md'], 'sub')]),
      NAMING,
    );
    const np = plan.perNote.get('AAA/sub.md')!;
    expect(np.noteName).toBe('sub');
    expect(np.items[0].to).toBe('assets/sub_image_001.png');
  });

  it('canvas 笔记作为归属者也被纳入（noteName 去 .canvas）', () => {
    const plan = planBulkRename(
      snapshot([entry('assets/x.png', 'image', ['board.canvas'], 'board')]),
      NAMING,
    );
    const np = plan.perNote.get('board.canvas')!;
    expect(np.noteName).toBe('board');
    expect(np.items[0].to).toBe('assets/board_image_001.png');
  });

  it('仅 frontmatter 类引用（kind=frontmatter）的附件也纳入计划', () => {
    const fmEntry: AttachmentEntry = {
      path: 'assets/cover.png',
      category: 'image',
      mime: '',
      animated: false,
      size: 0,
      mtime: 0,
      references: [{ sourcePath: 'fm.md', kind: 'frontmatter', raw: 'cover: assets/cover.png', linkText: 'assets/cover.png', status: 'resolved' }],
    };
    const plan = planBulkRename(snapshot([fmEntry]), NAMING);
    expect(plan.perNote.has('fm.md')).toBe(true);
    expect(plan.perNote.get('fm.md')!.items[0].to).toBe('assets/fm_image_001.png');
  });

  it('不同目录同名笔记按完整路径区分，副本目标相同（由执行层避让）', () => {
    const plan = planBulkRename(
      snapshot([entry('assets/shared.png', 'image', ['a.md', 'b/a.md'], 'a')]),
      NAMING,
    );
    expect(plan.perNote.has('a.md')).toBe(true);
    expect(plan.perNote.has('b/a.md')).toBe(true);
    // 两个同名笔记的副本命名相同（笔记名一致），执行层由 uniqueCopyTarget 追加编号避让
    const aTo = plan.perNote.get('a.md')!.items[0].to;
    const bTo = plan.perNote.get('b/a.md')!.items[0].to;
    expect(aTo).toBe('assets/a_image_001.png');
    expect(bTo).toBe(aTo);
    expect(plan.sharedCount).toBe(1);
  });

  it('folderByCategory + 跨目录共享附件 → 计划以附件自身目录为根（两副本同源）', () => {
    const plan = planBulkRename(
      snapshot([entry('a/x.png', 'image', ['a/note.md', 'b/note.md'], 'note')]),
      { ...NAMING, folderByCategory: true },
    );
    // 纯计划层 targetBaseDir 为空时回退附件 ownDir（'a/'），两篇的副本规划到同一源目录；
    // 执行层（runRenameNote）才以各笔记的归属附件目录为根，二者在附件目录内布局一致
    const aTo = plan.perNote.get('a/note.md')!.items[0].to;
    const bTo = plan.perNote.get('b/note.md')!.items[0].to;
    expect(aTo).toBe('a/image/note_image_001.png');
    expect(bTo).toBe(aTo);
  });
});