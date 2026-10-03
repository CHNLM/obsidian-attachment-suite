import { describe, expect, it } from 'vitest';
import type { AttachmentEntry, BrokenRef } from '../../../src/core';
// canvas 的 file 字段改写已归位到 core（读写两侧共用同一实现）
import { rewriteCanvasFileFields } from '../../../src/core';
import {
  levenshtein,
  planBrokenLinkFixes,
  relativePath,
  similarity,
  suggestCandidates,
  type FuzzyOptions,
} from '../../../src/features/broken-link-core';

const NO_FUZZY: FuzzyOptions = { suggest: false, threshold: 0.6, topN: 5 };

function entry(path: string): AttachmentEntry {
  return {
    path,
    category: 'image',
    mime: '',
    animated: false,
    size: 0,
    mtime: 0,
    references: [],
  };
}

function broken(sourcePath: string, linkText: string, kind: BrokenRef['kind'] = 'embed'): BrokenRef {
  return { sourcePath, kind, raw: linkText, linkText };
}

const entries = [entry('assets/pic.png'), entry('assets/case.PNG'), entry('assets/other.png')];

describe('broken-link-core planBrokenLinkFixes（分层）', () => {
  it('L1 精确 basename 唯一命中时自动修复', () => {
    const plan = planBrokenLinkFixes([broken('note.md', 'pic.png')], entries, NO_FUZZY);
    expect(plan.total).toBe(1);
    expect(plan.choices).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.fixes.get('note.md')?.get('pic.png')).toBe('assets/pic.png');
  });

  it('L2 归一化（去空格/连字符/下划线，保留大小写）唯一时自动修复', () => {
    const plan = planBrokenLinkFixes([broken('note.md', 'my pic.png')], [
      ...entries,
      entry('assets/my-pic.png'),
    ], NO_FUZZY);
    expect(plan.total).toBe(1);
    expect(plan.fixes.get('note.md')?.get('my pic.png')).toBe('assets/my-pic.png');
  });

  it('L3 %20 编码的空格引用：URL 解码后唯一命中真实文件并归一化为字面路径', () => {
    const enc = 'attachments/实验0%20%20%20%20PyCharm_image_016.png';
    const real = 'attachments/实验0    PyCharm_image_016.png';
    const plan = planBrokenLinkFixes([broken('note.md', enc)], [entry(real)], NO_FUZZY);
    expect(plan.total).toBe(1);
    expect(plan.fixes.get('note.md')?.get(enc)).toBe(real);
  });

  it('L4 相对路径形式断链：唯一命中后改写为正确相对路径', () => {
    // note 位于 a/ 目录，真实附件在库根 assets/x.png，断链相对路径写错目录
    const plan = planBrokenLinkFixes([broken('a/note.md', 'assets/../x.png')], [
      ...entries,
      entry('assets/x.png'),
    ], NO_FUZZY);
    expect(plan.total).toBe(1);
    // a/note.md → 库根 assets/x.png 的正确相对路径
    expect(plan.fixes.get('a/note.md')?.get('assets/../x.png')).toBe('../assets/x.png');
  });

  it('L4 库根来源笔记相对路径形式断链改写为库内路径', () => {
    const plan = planBrokenLinkFixes([broken('note.md', 'sub/pic.png')], [
      entry('sub/pic.png'),
    ], NO_FUZZY);
    expect(plan.total).toBe(1);
    expect(plan.fixes.get('note.md')?.get('sub/pic.png')).toBe('sub/pic.png');
  });

  it('L5 大小写不同但唯一命中：不自动修复，进入交互候选（大小写保持敏感）', () => {
    const plan = planBrokenLinkFixes([broken('note.md', 'CASE.PNG')], entries, NO_FUZZY);
    expect(plan.total).toBe(0);
    expect(plan.choices).toHaveLength(1);
    const c = plan.choices[0];
    expect(c.linkText).toBe('CASE.PNG');
    expect(c.candidates).toEqual([{ path: 'assets/case.PNG', score: 1, matchedBy: 'case' }]);
  });

  it('L5 跨层级并集去重后仅剩大小写差异唯一（Case.png → CASE.png）→ 交互候选', () => {
    const plan = planBrokenLinkFixes([broken('note.md', 'Case.png')], [entry('assets/CASE.png')], NO_FUZZY);
    expect(plan.total).toBe(0);
    expect(plan.choices).toHaveLength(1);
    expect(plan.choices[0].candidates[0].matchedBy).toBe('case');
  });

  it('L6 多候选（同名多文件）进入交互候选', () => {
    const plan = planBrokenLinkFixes([broken('note.md', 'other.png')], [
      ...entries,
      entry('sub/other.png'),
    ], NO_FUZZY);
    expect(plan.total).toBe(0);
    expect(plan.choices).toHaveLength(1);
    expect(plan.choices[0].candidates).toHaveLength(2);
  });

  it('L7 无候选时按相似度推荐进入交互候选（fuzzy）', () => {
    const plan = planBrokenLinkFixes([broken('note.md', 'pic-v2.png')], [
      ...entries,
      entry('assets/pic.png'),
    ], { suggest: true, threshold: 0.6, topN: 5 });
    expect(plan.total).toBe(0);
    expect(plan.choices).toHaveLength(1);
    expect(plan.choices[0].candidates[0]).toMatchObject({ path: 'assets/pic.png', matchedBy: 'fuzzy' });
  });

  it('L7 相似度低于阈值不推荐，进 skipped', () => {
    const plan = planBrokenLinkFixes([broken('note.md', 'zzz-totally-different.png')], entries, {
      suggest: true,
      threshold: 0.6,
      topN: 5,
    });
    expect(plan.total).toBe(0);
    expect(plan.choices).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
  });

  it('L8 无候选且关闭相似度推荐时保持报告', () => {
    const plan = planBrokenLinkFixes([broken('note.md', 'ghost.png')], entries, NO_FUZZY);
    expect(plan.total).toBe(0);
    expect(plan.choices).toHaveLength(0);
    expect(plan.skipped.map((r) => r.linkText)).toEqual(['ghost.png']);
  });

  it('L8 %20 编码但无对应真实文件时跳过', () => {
    const plan = planBrokenLinkFixes([broken('note.md', 'attachments/ghost%20pic.png')], entries, NO_FUZZY);
    expect(plan.total).toBe(0);
    expect(plan.skipped).toHaveLength(1);
  });

  it('L1 无扩展名 wiki 断链（[[pic]]）补受管扩展名后唯一命中自动修复', () => {
    const plan = planBrokenLinkFixes([broken('note.md', 'pic')], [
      ...entries,
      entry('assets/pic.png'),
    ], NO_FUZZY);
    expect(plan.total).toBe(1);
    expect(plan.fixes.get('note.md')?.get('pic')).toBe('assets/pic.png');
  });

  it('无扩展名 wiki 断链命中多个扩展名候选（pic.png + pic.jpg）时进入交互候选', () => {
    const plan = planBrokenLinkFixes([broken('note.md', 'pic')], [
      entry('assets/pic.png'),
      entry('assets/pic.jpg'),
    ], NO_FUZZY);
    expect(plan.total).toBe(0);
    expect(plan.choices).toHaveLength(1);
    expect(plan.choices[0].candidates).toHaveLength(2);
  });

  it('按来源笔记分组，不同笔记各自记录映射', () => {
    const plan = planBrokenLinkFixes(
      [broken('a.md', 'pic.png'), broken('b.md', 'pic.png')],
      entries,
      NO_FUZZY,
    );
    expect(plan.total).toBe(2);
    expect(plan.fixes.get('a.md')?.get('pic.png')).toBe('assets/pic.png');
    expect(plan.fixes.get('b.md')?.get('pic.png')).toBe('assets/pic.png');
  });
});

describe('broken-link-core similarity / suggestCandidates', () => {
  it('levenshtein 编辑距离', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });

  it('相似度：完全相同为 1，接近者高分', () => {
    expect(similarity('pic.png', 'pic.png')).toBeGreaterThanOrEqual(1);
    expect(similarity('pic-v2.png', 'pic.png')).toBeGreaterThan(0.5);
    expect(similarity('abc.png', 'xyz.png')).toBeLessThan(0.6);
  });

  it('相似度忽略大小写与分隔符', () => {
    expect(similarity('MY PIC.png', 'my-pic.png')).toBeGreaterThanOrEqual(1);
  });

  it('suggestCandidates：同扩展名预过滤 + 阈值 + top-N 排序', () => {
    const cands = suggestCandidates('pic-v2.png', 'png', [
      entry('assets/pic.png'),
      entry('assets/pic-v3.png'),
      entry('assets/note.txt'), // 不同扩展名不参与
      entry('assets/xyz.png'),
    ], { suggest: true, threshold: 0.5, topN: 2 });
    expect(cands).toHaveLength(2);
    expect(cands[0].score).toBeGreaterThanOrEqual(cands[1].score);
    expect(cands.every((c) => c.path.endsWith('.png'))).toBe(true);
  });

  it('suggestCandidates 关闭时返回空', () => {
    expect(suggestCandidates('pic', 'png', entries, { ...NO_FUZZY, topN: 5 })).toEqual([]);
  });
});

describe('broken-link-core relativePath', () => {
  it('同级目录', () => {
    expect(relativePath('a', 'a/b.png')).toBe('b.png');
  });
  it('上级目录', () => {
    expect(relativePath('a/b', 'assets/x.png')).toBe('../../assets/x.png');
  });
  it('库根来源', () => {
    expect(relativePath('', 'assets/x.png')).toBe('assets/x.png');
  });
  it('向下进入深层目录', () => {
    expect(relativePath('a', 'a/sub/deep/x.png')).toBe('sub/deep/x.png');
  });
  it('目标在库根、来源在子目录时相对路径越级', () => {
    expect(relativePath('a', 'x.png')).toBe('../x.png');
  });
});

describe('broken-link-core rewriteCanvasFileFields', () => {
  it('替换 canvas JSON 中 file 字段的引用路径', () => {
    const text = JSON.stringify({ nodes: [{ type: 'file', file: 'pic.png' }] });
    const next = rewriteCanvasFileFields(text, new Map([['pic.png', 'assets/pic.png']]));
    expect(JSON.parse(next).nodes[0].file).toBe('assets/pic.png');
  });

  it('同时含「完整路径」与「纯 basename」两项映射时不得二次替换（路径被改坏）', () => {
    // 回归：旧实现是 `text.split(from).join(to)`，basename 那一项会命中第一次替换的结果，
    // 把 `canvas/assets/a.png` 再替换成 `canvas/assets/canvas/assets/a.png`。
    // `refMapForMoves` 正是同时提供这两种键的（见 link-resolver）。
    const text = JSON.stringify({ nodes: [{ type: 'file', file: 'orphans/a.png' }] });
    const map = new Map([
      ['orphans/a.png', 'canvas/assets/a.png'],
      ['a.png', 'canvas/assets/a.png'],
    ]);
    const next = rewriteCanvasFileFields(text, map);
    expect(JSON.parse(next).nodes[0].file).toBe('canvas/assets/a.png');
  });

  it('幂等：对已是新值的文本再跑一次不改动', () => {
    const map = new Map([['orphans/a.png', 'canvas/assets/a.png']]);
    const once = rewriteCanvasFileFields(JSON.stringify({ nodes: [{ file: 'orphans/a.png' }] }), map);
    expect(rewriteCanvasFileFields(once, map)).toBe(once);
  });

  it('只动 file 字段的整值，不误伤其它字段里出现的同样字符串', () => {
    const text = JSON.stringify({
      nodes: [{ id: 'orphans/a.png', type: 'file', file: 'orphans/a.png', color: 'orphans/a.png' }],
    });
    const next = JSON.parse(rewriteCanvasFileFields(text, new Map([['orphans/a.png', 'canvas/assets/a.png']])));
    expect(next.nodes[0].file).toBe('canvas/assets/a.png');
    expect(next.nodes[0].id).toBe('orphans/a.png');
    expect(next.nodes[0].color).toBe('orphans/a.png');
  });

  it('保留原有缩进与键值间距（不重写整个 JSON）', () => {
    const text = '{\n  "nodes": [\n    { "type": "file", "file": "a.png" }\n  ]\n}';
    const next = rewriteCanvasFileFields(text, new Map([['a.png', 'assets/a.png']]));
    expect(next).toContain('"file": "assets/a.png"');
    // 逐行结构不变（5 行：`{` / nodes / 节点 / `]` / `}`）
    expect(next.split('\n')).toHaveLength(5);
    expect(next.startsWith('{\n  "nodes": [')).toBe(true);
  });
});
