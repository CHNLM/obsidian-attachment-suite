import { describe, expect, it } from 'vitest';
import { SafeMoveEngine } from '../../../src/core';
import type { FileOps } from '../../../src/core';

function mockOps(existing: Set<string>): { ops: FileOps; renamed: Array<{ from: string; to: string }> } {
  const renamed: Array<{ from: string; to: string }> = [];
  const ops: FileOps = {
    exists: async (p) => existing.has(p),
    rename: async (from, to) => {
      existing.delete(from);
      existing.add(to);
      renamed.push({ from, to });
    },
  };
  return { ops, renamed };
}

describe('SafeMoveEngine', () => {
  it('目标占用时自动追加编号避让', async () => {
    const existing = new Set(['assets/note.png']);
    const { ops, renamed } = mockOps(existing);
    const engine = new SafeMoveEngine(ops);
    const r = await engine.move('assets/x.png', 'assets/note.png');
    expect(r.conflict).toBe(true);
    expect(r.to).toBe('assets/note (1).png');
    expect(renamed[0].to).toBe('assets/note (1).png');
  });

  it('无冲突时直接改名', async () => {
    const existing = new Set(['assets/old.png']);
    const { renamed } = mockOps(existing);
    const engine = new SafeMoveEngine({
      exists: async (p) => existing.has(p),
      rename: async (from, to) => {
        existing.delete(from);
        existing.add(to);
        renamed.push({ from, to });
      },
    });
    const r = await engine.move('assets/old.png', 'assets/new.png');
    expect(r.conflict).toBe(false);
    expect(r.to).toBe('assets/new.png');
  });

  it('改名瞬时失败后重试成功（P2-8）', async () => {
    const existing = new Set(['assets/x.png']);
    let calls = 0;
    const engine = new SafeMoveEngine({
      exists: async (p) => existing.has(p),
      rename: async (from, to) => {
        calls++;
        if (calls < 3) throw new Error('EBUSY: file in use');
        existing.delete(from);
        existing.add(to);
      },
    });
    const r = await engine.move('assets/x.png', 'assets/y.png');
    expect(r.to).toBe('assets/y.png');
    expect(calls).toBe(3);
  });

  it('持续失败时抛出并记录错误（P2-8）', async () => {
    const existing = new Set(['assets/x.png']);
    const engine = new SafeMoveEngine({
      exists: async (p) => existing.has(p),
      rename: async () => {
        throw new Error('EBUSY');
      },
    });
    await expect(engine.move('assets/x.png', 'assets/z.png')).rejects.toThrow(/EBUSY/);
  });

  it('moveMany 批量移动，单项失败记入 errors 并继续', async () => {
    const existing = new Set(['assets/a.png', 'assets/b.png']);
    const renamed: Array<{ from: string; to: string }> = [];
    const engine = new SafeMoveEngine({
      exists: async (p) => existing.has(p),
      rename: async (from, to) => {
        if (from === 'assets/b.png') throw new Error('EBUSY: b locked');
        existing.delete(from);
        existing.add(to);
        renamed.push({ from, to });
      },
    });
    const out = await engine.moveMany([
      { from: 'assets/a.png', to: 'assets/a1.png' },
      { from: 'assets/b.png', to: 'assets/b1.png' },
      { from: 'assets/c.png', to: 'assets/c1.png' },
    ]);
    expect(out.results.map((r) => r.to).sort()).toEqual(['assets/a1.png', 'assets/c1.png']);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].from).toBe('assets/b.png');
    expect(out.errors[0].message).toContain('EBUSY');
  });

  it('目标被多重占用时递增避让编号 (1)/(2)', async () => {
    const existing = new Set(['x.png', 'x (1).png']);
    const renamed: Array<{ from: string; to: string }> = [];
    const engine = new SafeMoveEngine({
      exists: async (p) => existing.has(p),
      rename: async (from, to) => {
        existing.delete(from);
        existing.add(to);
        renamed.push({ from, to });
      },
    });
    const r = await engine.move('old.png', 'x.png');
    expect(r.to).toBe('x (2).png');
    expect(r.conflict).toBe(true);
    expect(renamed[0].to).toBe('x (2).png');
  });

  it('无扩展名文件冲突时同样避让', async () => {
    const existing = new Set(['LICENSE']);
    const engine = new SafeMoveEngine({
      exists: async (p) => existing.has(p),
      rename: async (from, to) => {
        existing.delete(from);
        existing.add(to);
      },
    });
    const r = await engine.move('old-file', 'LICENSE');
    expect(r.to).toBe('LICENSE (1)');
  });
});