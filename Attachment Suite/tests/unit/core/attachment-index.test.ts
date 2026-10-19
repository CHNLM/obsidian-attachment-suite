import { describe, expect, it } from 'vitest';
import { AttachmentIndex } from '../../../src/core/attachment-index';
import type { MetadataProvider, VaultAdapter } from '../../../src/core/types';

function mockVault(files: string[]): VaultAdapter {
  return {
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

  it('frontmatter 引用含空格 / 中文名的附件同样不判为孤儿（口径与正文解析一致）', async () => {
    // 回归：孤儿保护层曾自带一条更窄的正则（`[A-Za-z0-9_.\-/]` + 硬编码扩展名）解析 frontmatter，
    // 含空格与中文的附件名会被读成半截路径（`我的 图片.png` → 只认出 `图片.png`），于是该附件
    // 既不进 usedByBasename，Obsidian 的 resolvedLinks 又不收录 frontmatter 裸路径，
    // 最终被「清理未用附件」当成孤儿删掉（数据损失）。此处锁定"两层口径必须一致"。
    const vault = mockVault(['fm_space_note.md', 'assets/我的 图片.png', 'assets/unused.png']);
    const meta = mockMeta(
      {},
      { 'fm_space_note.md': '---\ncover: assets/我的 图片.png\ntitle: 随便写的标题\n---\n正文无内嵌图\n' },
    );
    const index = new AttachmentIndex(vault, meta);
    const snap = await index.build();
    expect(snap.orphanCandidates).not.toContain('assets/我的 图片.png');
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

  it('标题锚点 `X.md#heading` 指向存在的笔记时不报断链（消误报）', async () => {
    const vault = mockVault(['15 Git/Git使用指南.md', 'assets/a.png']);
    // resolvedLinks 把锚点目标按『笔记.md#heading』存入
    const meta = mockMeta(
      { '15 Git/Git使用指南.md': { 'Git使用指南.md#7-分支管理': 1 } },
      { '15 Git/Git使用指南.md': '[[Git使用指南.md#7-分支管理]]\n' },
    );
    const index = new AttachmentIndex(vault, meta);
    const snap = await index.build();
    expect(snap.brokenRefs.some((b) => b.linkText.includes('Git使用指南.md#'))).toBe(false);
  });

  it('相对路径无扩展名的笔记链接解析到已有笔记时不报断链（消误报）', async () => {
    const vault = mockVault(['19 Python知识库/99-项目与研究记录/研究实验日志.md', '19 Python知识库/08-模块与包/延迟导入与启动性能.md']);
    const meta = mockMeta({}, { '19 Python知识库/99-项目与研究记录/研究实验日志.md': '[[../08-模块与包/延迟导入与启动性能]]\n' });
    const index = new AttachmentIndex(vault, meta);
    const snap = await index.build();
    // 目标笔记存在（相对 ../08-模块与包/... + 补 .md）→ 不算断链
    expect(snap.brokenRefs.some((b) => b.linkText.includes('延迟导入与启动性能'))).toBe(false);
  });

  it('跨库根向上跳出的相对路径，不发生可解析误判（无法解析→仍不报附件断链）', async () => {
    const vault = mockVault(['n.md', 'assets/x.png']);
    // ../../越出库根：normalizeInVault 返回 null，不应解析成某个存在的文件
    const meta = mockMeta({}, { 'n.md': '[[../../outside/文件]]\n[[../../ghost]]\n' });
    const index = new AttachmentIndex(vault, meta);
    const snap = await index.build();
    // 这些既非可解析笔记、也无扩展名 → 不报为“附件”断链
    expect(snap.brokenRefs.length).toBe(0);
  });

  it('附件型断链（有扩展名）不受消误报影响，仍照常上报', async () => {
    const vault = mockVault(['n.md', 'assets/real.png']);
    // 有扩展名、文件不存在 → 仍报断链（交给修复工具）
    const meta = mockMeta({ 'n.md': { 'assets/missing.png': 1 } }, { 'n.md': '![](assets/missing.png)\n' });
    const index = new AttachmentIndex(vault, meta);
    const snap = await index.build();
    expect(snap.brokenRefs.map((b) => b.linkText)).toContain('assets/missing.png');
  });

  it('wiki 无扩展名引用命中受管附件时不报断链（消误报）', async () => {
    const vault = mockVault(['n.md', 'assets/pic.png']);
    const meta = mockMeta({}, { 'n.md': '[[pic]]\n![[pic]]\n' });
    const snap = await new AttachmentIndex(vault, meta).build();
    expect(snap.brokenRefs.some((b) => b.kind === 'wiki-attachment')).toBe(false);
  });

  it('wiki 无扩展名引用命中笔记时不报断链', async () => {
    const vault = mockVault(['n.md', 'other.md']);
    const meta = mockMeta({}, { 'n.md': '[[other]]\n' });
    const snap = await new AttachmentIndex(vault, meta).build();
    expect(snap.brokenRefs.some((b) => b.kind === 'wiki-attachment')).toBe(false);
  });

  it('wiki 无扩展名引用双无时上报 wiki-attachment 断链', async () => {
    const vault = mockVault(['n.md']);
    const meta = mockMeta({}, { 'n.md': '[[ghostpic]]\n' });
    const snap = await new AttachmentIndex(vault, meta).build();
    const cb = snap.brokenRefs.find((b) => b.linkText === 'ghostpic');
    expect(cb).toBeTruthy();
    expect(cb?.kind).toBe('wiki-attachment');
  });

  it('URL 编码（%XX，含中文 UTF-8）引用解码后存在时不误报断链', async () => {
    const vault = mockVault(['n.md', 'assets/实验数据.png']);
    const meta = mockMeta({}, {
      'n.md': '![](assets/%E5%AE%9E%E9%AA%8C%E6%95%B0%E6%8D%AE.png)\n',
    });
    const snap = await new AttachmentIndex(vault, meta).build();
    expect(snap.brokenRefs.some((b) => b.linkText.includes('%E5%AE%9E'))).toBe(false);
  });

  it('HTML <img> 标签引用缺失文件时上报 html 断链', async () => {
    const vault = mockVault(['n.md', 'assets/real.png']);
    const meta = mockMeta({}, { 'n.md': '<img src="assets/gone.png" alt="x">\n<img src="assets/real.png">\n' });
    const snap = await new AttachmentIndex(vault, meta).build();
    const cb = snap.brokenRefs.find((b) => b.linkText === 'assets/gone.png');
    expect(cb).toBeTruthy();
    expect(cb?.kind).toBe('html');
    expect(snap.brokenRefs.some((b) => b.linkText === 'assets/real.png')).toBe(false);
  });

  it('fenced 代码块内的假链接不报断链', async () => {
    const vault = mockVault(['n.md', 'assets/real.png']);
    const meta = mockMeta({}, {
      'n.md': '```\n![](assets/ghost.png)\n```\n![[assets/real.png]]\n',
    });
    const snap = await new AttachmentIndex(vault, meta).build();
    expect(snap.brokenRefs.some((b) => b.linkText.includes('ghost.png'))).toBe(false);
  });

  it('HTML 媒体标签引用的笔记不得被 resolvedLinks 挤掉（两套口径须合并）', async () => {
    // 真实场景：`song.mp3` 同时被 markdown 链接（Obsidian 会解析）与 HTML `<audio src>`（Obsidian 不解析）引用。
    // 过去"仅当 resolvedLinks 为空才按名合成引用"的写法会让后者被前者挤掉 →
    // 共享判定误判为独占 → 全库命名原地改名（而非按笔记各复制），HTML 引用当场悬空（改名联动不认识该写法）。
    const vault = mockVault([
      'notes/a.md',
      'notes/b.md',
      'notes/c.md',
      'assets/mp3/song.mp3',
      'assets/mp4/clip.mp4',
      'assets/webm/clip2.webm',
    ]);
    const meta = mockMeta(
      // 只有 markdown 链接会被 Obsidian 解析进 resolvedLinks
      { 'notes/b.md': { 'assets/mp3/song.mp3': 1 } },
      {
        'notes/a.md':
          '<audio src="assets/mp3/song.mp3" controls></audio>\n\n<video src="assets/mp4/clip.mp4" loop></video>\n\n<video><source src="assets/webm/clip2.webm" type="video/webm"></video>\n',
        'notes/b.md': '![x](assets/mp3/song.mp3)\n',
        // 同一笔记既有 markdown 引用又有 HTML 引用 → 只应计一条
        'notes/c.md': '![y](assets/mp3/song.mp3)\n\n<audio src="assets/mp3/song.mp3"></audio>\n',
      },
    );
    const snap = await new AttachmentIndex(vault, meta).build();
    const refs = (p: string): string[] =>
      (snap.entries.get(p)?.references ?? []).map((r) => r.sourcePath).sort();
    expect(refs('assets/mp3/song.mp3')).toEqual(['notes/a.md', 'notes/b.md', 'notes/c.md']);
    expect(refs('assets/mp4/clip.mp4')).toEqual(['notes/a.md']);
    expect(refs('assets/webm/clip2.webm')).toEqual(['notes/a.md']);
    for (const p of ['assets/mp3/song.mp3', 'assets/mp4/clip.mp4', 'assets/webm/clip2.webm']) {
      expect(snap.orphanCandidates).not.toContain(p);
    }
  });
});