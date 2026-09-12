import { describe, expect, it } from 'vitest';
import { AttachmentIndex } from '../../../src/core/attachment-index';
import type { MetadataProvider, VaultAdapter } from '../../../src/core/types';

function mockVault(files: string[]): VaultAdapter {
  return {
    exists: async (p) => files.includes(p),
    read: async () => new ArrayBuffer(0),
    readHead: async () => new Uint8Array(),
    listFiles: async () => files,
  };
}

function mockMeta(resolved: Record<string, Record<string, number>>, texts: Record<string, string>): MetadataProvider {
  return {
    getResolvedLinks: () => resolved,
    getFileText: async (p) => texts[p] ?? '',
  };
}

describe('attachment-index', () => {
  it('构建条目、孤儿候选与坏引用', async () => {
    const vault = mockVault(['note.md', 'assets/a.png', 'assets/b.mp4', 'assets/unused.jpg', 'assets/doc.pdf']);
    const meta = mockMeta(
      {
        'note.md': { 'assets/a.png': 1, 'assets/b.mp4': 1, 'assets/missing.png': 1 },
      },
      { 'note.md': '![[assets/a.png]]\n![alt](assets/b.mp4)\n' },
    );
    const index = new AttachmentIndex(vault, meta);
    const snap = await index.build();

    expect(snap.entries.size).toBe(4); // a.png, b.mp4, unused.jpg, doc.pdf
    expect(snap.entries.get('assets/a.png')?.references.length).toBe(1);
    expect(snap.entries.get('assets/a.png')?.category).toBe('image');

    // 坏引用：missing.png 不存在
    expect(snap.brokenRefs.map((b) => b.linkText)).toContain('assets/missing.png');

    // 孤儿：未被引用的附件
    expect(snap.orphanCandidates).toContain('assets/unused.jpg');
    expect(snap.orphanCandidates).toContain('assets/doc.pdf'); // 未被引用 → 孤儿
    expect(snap.orphanCandidates).not.toContain('assets/a.png');
  });

  it('getSnapshot 幂等重建后可复用', async () => {
    const vault = mockVault(['n.md', 'x.png']);
    const meta = mockMeta({ 'n.md': { 'x.png': 1 } }, { 'n.md': '![[x.png]]' });
    const index = new AttachmentIndex(vault, meta);
    const s1 = await index.getSnapshot();
    const s2 = await index.getSnapshot();
    expect(s1).toBe(s2); // 未 dirty 时复用同一快照
  });

  it('resolvedLinks 缺失时，由正文短名引用的附件不判为孤儿（防误删）', async () => {
    // 模拟 Obsidian 尚未解析短名嵌入：resolvedLinks 为空，但文本里有 [[used.png]]
    const vault = mockVault(['lv_note.md', 'assets/used.png', 'assets/orphan.png']);
    const meta = mockMeta({}, { 'lv_note.md': '![[used.png]]\n' });
    const index = new AttachmentIndex(vault, meta);
    const snap = await index.build();
    expect(snap.orphanCandidates).not.toContain('assets/used.png');
    expect(snap.orphanCandidates).toContain('assets/orphan.png');
  });

  it('resolvedLinks 缺失时，唯一命名的短名嵌入会合成引用供命名规划使用', async () => {
    const vault = mockVault(['lv_note.md', 'assets/raw pic.png']);
    // resolvedLinks 为空（Obsidian 尚未解析短名嵌入）
    const meta = mockMeta({}, { 'lv_note.md': '![[raw pic.png]]\n' });
    const index = new AttachmentIndex(vault, meta);
    const snap = await index.build();
    const entry = snap.entries.get('assets/raw pic.png');
    expect(entry?.references.some((r) => r.sourcePath === 'lv_note.md')).toBe(true);
  });

  it('frontmatter 中引用的附件不判为孤儿（防误删 cover/banner）', async () => {
    // 仅出现在 YAML frontmatter 的封面图，不应被当未使用附件清理
    const vault = mockVault(['fm_note.md', 'assets/cover.png', 'assets/unused.png']);
    const meta = mockMeta(
      {},
      { 'fm_note.md': '---\ncover: "assets/cover.png"\nattachments:\n  - other.jpg\n---\n正文无内嵌图\n' },
    );
    const index = new AttachmentIndex(vault, meta);
    const snap = await index.build();
    expect(snap.orphanCandidates).not.toContain('assets/cover.png');
    expect(snap.orphanCandidates).toContain('assets/unused.png');
  });

  it('canvas 中 type=file 引用的附件不判为孤儿，缺失目标报断链', async () => {
    const vault = mockVault(['board.canvas', 'assets/used.png', 'assets/orphan.png']);
    const meta = mockMeta({}, {
      'board.canvas': JSON.stringify({
        nodes: [
          { type: 'file', file: 'assets/used.png' },
          { type: 'file', file: 'assets/gone.png' },
        ],
      }),
    });
    const index = new AttachmentIndex(vault, meta);
    const snap = await index.build();
    expect(snap.orphanCandidates).not.toContain('assets/used.png');
    expect(snap.orphanCandidates).toContain('assets/orphan.png');
    const cb = snap.brokenRefs.find((b) => b.linkText === 'assets/gone.png');
    expect(cb).toBeTruthy();
    expect(cb?.kind).toBe('canvas');
  });

  it('frontmatter 引用缺失文件时报断链，存在则不报', async () => {
    const vault = mockVault(['n.md', 'assets/cover.png']);
    const meta = mockMeta({}, {
      'n.md': '---\ncover: "assets/cover.png"\nbanner: "assets/banner.png"\n---\nbody\n',
    });
    const index = new AttachmentIndex(vault, meta);
    const snap = await index.build();
    // 存在的 cover 不报
    expect(snap.brokenRefs.some((b) => b.linkText === 'assets/cover.png')).toBe(false);
    // 缺失的 banner 报断链，并标记为 frontmatter 来源
    const cb = snap.brokenRefs.find((b) => b.linkText === 'assets/banner.png');
    expect(cb).toBeTruthy();
    expect(cb?.kind).toBe('frontmatter');
  });

  it('markDirty 后 getSnapshot 触发重建（不复用旧快照）', async () => {
    const vault = mockVault(['n.md', 'x.png']);
    const meta = mockMeta({ 'n.md': { 'x.png': 1 } }, { 'n.md': '![[x.png]]' });
    const index = new AttachmentIndex(vault, meta);
    const s1 = await index.getSnapshot();
    index.markDirty();
    const s2 = await index.getSnapshot();
    expect(s1).not.toBe(s2);
  });

  it('非托管文件（txt/js/md）不进入附件条目', async () => {
    const vault = mockVault(['note.md', 'assets/a.png', 'readme.txt', 'script.js']);
    const meta = mockMeta({}, { 'note.md': '![[assets/a.png]]\n' });
    const snap = await new AttachmentIndex(vault, meta).build();
    expect(snap.entries.size).toBe(1);
    expect(snap.entries.has('assets/a.png')).toBe(true);
  });

  it('同一坏链接重复出现时去重只报一次', async () => {
    const vault = mockVault(['note.md']);
    const meta = mockMeta({}, { 'note.md': '![[missing.png]]\n![x](missing.png)\n' });
    const snap = await new AttachmentIndex(vault, meta).build();
    expect(snap.brokenRefs.filter((b) => b.linkText === 'missing.png')).toHaveLength(1);
  });

  it('目标路径不同但 basename 存在时不报断链，且不判孤儿', async () => {
    const vault = mockVault(['note.md', 'assets/missing.png']);
    const meta = mockMeta({}, { 'note.md': '![[sub/missing.png]]\n' });
    const snap = await new AttachmentIndex(vault, meta).build();
    expect(snap.brokenRefs).toHaveLength(0);
    expect(snap.orphanCandidates).not.toContain('assets/missing.png');
  });

  it('同 basename 多文件时短名引用不合成引用（不冒险），但数据安全不判孤儿', async () => {
    const vault = mockVault(['note.md', 'a/img.png', 'b/img.png']);
    const meta = mockMeta({}, { 'note.md': '![[img.png]]\n' });
    const snap = await new AttachmentIndex(vault, meta).build();
    // 唯一性不满足 → 不合成引用
    expect(snap.entries.get('a/img.png')?.references).toHaveLength(0);
    expect(snap.entries.get('b/img.png')?.references).toHaveLength(0);
    // 但因短名被正文引用，不判为孤儿（防误删）
    expect(snap.orphanCandidates).not.toContain('a/img.png');
    expect(snap.orphanCandidates).not.toContain('b/img.png');
  });

  it('损坏 canvas JSON 不崩溃，正常 canvas 的 data 外链目标忽略', async () => {
    const vault = mockVault(['broken.canvas', 'ok.canvas', 'assets/used.png']);
    const meta = mockMeta({}, {
      'broken.canvas': '{ not valid json',
      'ok.canvas': JSON.stringify({ nodes: [
        { type: 'file', file: 'data:image/png;base64,AA==' },
        { type: 'file', file: 'assets/used.png' },
        { type: 'text', text: 'x' },
      ] }),
    });
    const snap = await new AttachmentIndex(vault, meta).build();
    // 外链 data 目标不报断链
    expect(snap.brokenRefs.some((b) => b.linkText.startsWith('data:'))).toBe(false);
    // 正常 file 节点引用不判孤儿
    expect(snap.orphanCandidates).not.toContain('assets/used.png');
  });

  it('getEntry 返回单条附件概览', async () => {
    const vault = mockVault(['n.md', 'x.png']);
    const meta = mockMeta({ 'n.md': { 'x.png': 1 } }, { 'n.md': '![[x.png]]' });
    const index = new AttachmentIndex(vault, meta);
    const e = await index.getEntry('x.png');
    expect(e?.category).toBe('image');
    expect(e?.references.some((r) => r.sourcePath === 'n.md')).toBe(true);
    expect(await index.getEntry('nope.png')).toBeUndefined();
  });

  it('frontmatter 中 markdown 链接格式的资源也被提取为 basename 兜底防误删', async () => {
    const vault = mockVault(['fm.md', 'assets/cover-link.png']);
    const meta = mockMeta({}, {
      'fm.md': '---\ncover: ![](assets/cover-link.png)\n---\n',
    });
    const index = new AttachmentIndex(vault, meta);
    const snap = await index.build();
    // frontmatter 引用 → usedByBasename 记录，不判孤儿
    expect(snap.orphanCandidates).not.toContain('assets/cover-link.png');
  });
});