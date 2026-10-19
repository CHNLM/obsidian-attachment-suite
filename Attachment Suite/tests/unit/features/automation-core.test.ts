import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTOMATION_GUARD,
  decideMarkDirty,
  decideSweep,
  describeMarkSkip,
  describeSweepRefusal,
  type AutomationGuardOptions,
  type VaultGateState,
} from '../../../src/features/automation-core';

/**
 * 这两道防线保护同一个后果：**打开库就被静默批量改写**（`runAutoProcess` 调
 * `runRenameNote(..., confirm=false)`，不弹确认）。故这里的断言不追求"覆盖分支"，
 * 而是逐条钉住"什么情况下绝不标记"。
 */
const OPTS: AutomationGuardOptions = { ...DEFAULT_AUTOMATION_GUARD };
const T0 = 1_700_000_000_000; // 任意基准时刻，用例内只用相对差

/** 构造门状态：readyAt = T0，settledAt 由参数决定（0 = 尚未就绪）。 */
function gate(settledAt: number): VaultGateState {
  return { readyAt: T0, settledAt };
}

describe('automation-core：启动就绪门', () => {
  it('索引尚未就绪时，任何 changed 都不得标记（这正是"打开即批量处理"的入口）', () => {
    const r = decideMarkDirty({ now: T0 + 5, gate: gate(0), opts: OPTS, lastAutoAtForNote: null });
    expect(r).toEqual({ mark: false, reason: 'vault-not-settled' });
  });

  it('就绪前的"迟到批量事件"同样不得标记——不依赖固定毫秒数', () => {
    // 回归：旧实现用 `now - readyAt < 1500` 判定。库大的时候启动期批量事件会持续超过 1.5 秒，
    // 迟到的那些就被当成"用户编辑"，整库被标脏 → 全库附件被改名/搬移（无确认）。
    // 新判定只看"索引是否就绪"，与耗时长短无关。
    for (const elapsed of [1_600, 5_000, 30_000, 120_000]) {
      const r = decideMarkDirty({
        now: T0 + elapsed,
        gate: gate(0),
        opts: OPTS,
        lastAutoAtForNote: null,
      });
      expect(r, `就绪前已过 ${elapsed}ms 却被标记`).toEqual({ mark: false, reason: 'vault-not-settled' });
    }
  });

  it('就绪后的余震窗口内不标记，窗口一过即标记（边界）', () => {
    const settledAt = T0 + 900;
    const beforeEdge = settledAt + OPTS.postSettleQuietMs - 1;
    const atEdge = settledAt + OPTS.postSettleQuietMs;
    expect(decideMarkDirty({ now: beforeEdge, gate: gate(settledAt), opts: OPTS, lastAutoAtForNote: null })).toEqual({
      mark: false,
      reason: 'post-settle-quiet',
    });
    expect(decideMarkDirty({ now: atEdge, gate: gate(settledAt), opts: OPTS, lastAutoAtForNote: null })).toEqual({
      mark: true,
      reason: 'marked',
    });
  });

  it('就绪且过了余震窗口 → 标记（正常路径，防"门一直关着"的另一类缺陷）', () => {
    const r = decideMarkDirty({
      now: T0 + 10_000,
      gate: gate(T0 + 500),
      opts: OPTS,
      lastAutoAtForNote: null,
    });
    expect(r).toEqual({ mark: true, reason: 'marked' });
  });

  it('再武装窗口：刚被自动处理过的笔记，其自身写入的延迟事件不得重新标脏', () => {
    const settledAt = T0;
    const now = settledAt + OPTS.postSettleQuietMs + 100;
    // 该笔记刚刚（rearmMs 内）被自动处理过
    expect(
      decideMarkDirty({ now, gate: gate(settledAt), opts: OPTS, lastAutoAtForNote: now - OPTS.rearmMs + 1 }),
    ).toEqual({ mark: false, reason: 'rearm-window' });
    // 窗口恰好过期 → 允许（否则真实编辑会被永久吞掉）
    expect(
      decideMarkDirty({ now, gate: gate(settledAt), opts: OPTS, lastAutoAtForNote: now - OPTS.rearmMs }),
    ).toEqual({ mark: true, reason: 'marked' });
  });

  it('每条跳过原因都有可读文案，且互不相同（诊断日志不能把原因都写成同一句）', () => {
    const texts = (['vault-not-settled', 'post-settle-quiet', 'rearm-window'] as const).map(describeMarkSkip);
    for (const t of texts) expect(t.length).toBeGreaterThan(0);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe('automation-core：批量护栏（fail closed）', () => {
  it('不超过上限 → 允许处理', () => {
    expect(decideSweep(1, OPTS)).toEqual({ allowed: true, count: 1, limit: OPTS.maxPerSweep });
    expect(decideSweep(OPTS.maxPerSweep, OPTS)).toEqual({
      allowed: true,
      count: OPTS.maxPerSweep,
      limit: OPTS.maxPerSweep,
    });
  });

  it('超过上限 → 整批拒绝（不是"处理前 N 篇"：批次不可信时挑几篇的依据同样不可信）', () => {
    const d = decideSweep(OPTS.maxPerSweep + 1, OPTS);
    expect(d.allowed).toBe(false);
    expect(d.count).toBe(OPTS.maxPerSweep + 1);
  });

  it('真实规模：整库被标脏时必然被拦下', () => {
    // 验收库约 90 个文件、其中 40 余篇笔记：启动期批量事件漏进来就是这个量级
    expect(decideSweep(42, OPTS).allowed).toBe(false);
  });

  it('拒绝时的告知必须说清"为什么"与"那该怎么办"，且不含 markdown 标记（Notice 不渲染）', () => {
    const msg = describeSweepRefusal(42, OPTS.maxPerSweep);
    expect(msg).toContain('42');
    expect(msg).toContain(String(OPTS.maxPerSweep));
    expect(msg, '没告诉用户为什么跳过').toMatch(/索引刷新|同步工具/);
    expect(msg, '没告诉用户该怎么办').toContain('手动执行');
    expect(msg, 'Notice 里出现 markdown 标记会原样显示').not.toContain('**');
  });
});
