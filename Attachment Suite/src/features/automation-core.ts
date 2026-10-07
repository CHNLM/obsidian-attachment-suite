/**
 * 自动处理的**启动门**与**批量护栏**：纯决策逻辑（不 import obsidian、不读真实时钟）。
 *
 * 存在的理由（2026-09-29，一次真实风险评估的直接产物）：
 *
 * 这两道防线保护的是同一个后果——**"打开库就被静默批量改写"**。它是本插件唯一一条
 * 不经用户同意就批量改写整库的路径：`runAutoProcess` 调 `runRenameNote(..., confirm=false)`，
 * 不弹确认框，用户只会事后看到一串 Notice。
 *
 * 原先只有一道基于固定时长的抑制窗口：
 *
 * ```ts
 * const STARTUP_SUPPRESS_MS = isTestEnv ? 0 : 1500;
 * if (STARTUP_SUPPRESS_MS > 0 && Date.now() - readyAt < STARTUP_SUPPRESS_MS) return;
 * ```
 *
 * 它有两个问题，分别对应下面两道防线：
 *
 * 1. **1500ms 是启发式**。Obsidian 启动时对全库批量触发 `metadataCache.changed`，
 *    其持续时间取决于库大小 / 磁盘 / 已装插件数。大库上超过 1.5 秒，迟到的 changed
 *    仍会把全库标脏 → 整库被改名。故改为**条件式就绪门**：以"索引就绪"事件为准
 *    （见 `VaultGateState.settledAt`），时长随库自适应，而不是拍一个毫秒数。
 * 2. **一旦漏进来，没有第二道闸**。故加**批量护栏**：单次轮询要处理的笔记数不合常理时，
 *    判定为"非用户行为"（库索引刷新、同步工具批量写入），一律**拒绝处理**（fail closed）——
 *    宁可漏处理（用户可手动跑命令），也绝不批量改写用户的库。
 *
 * 为什么把决策抽到这里：主流程里它被包在事件回调 + 定时器 + 异步队列中间，用真实时钟验证
 * 只能靠 sleep，既慢又不稳。抽成纯函数后每个分支都能被确定性断言（见
 * `tests/unit/features/automation-core.test.ts`）。
 */

/** 自动处理的启动门与批量护栏参数。 */
export interface AutomationGuardOptions {
  /**
   * 「就绪」之后的余震窗口（毫秒）。
   *
   * 就绪事件（`metadataCache.resolved`）本身是准确的，但启动期事件可能还有一小段尾巴，
   * 故再让一段短窗口兜住。它只把自动处理推迟这么久，不影响安全性。
   */
  postSettleQuietMs: number;
  /**
   * 迟迟收不到「就绪」事件时的兜底放行时长（毫秒）。
   *
   * **只影响可用性，不影响安全性**：没有它，一旦宿主不发出就绪事件，自动处理就永久失效——
   * 那是本仓库另一类缺陷（"承诺了却不生效"）。故超时后按"已就绪"处理并记一条 warn。
   * 兜底放行时若真有批量事件在途，仍由 `maxPerSweep` 拦下。
   */
  settleDeadlineMs: number;
  /**
   * 单次轮询允许处理的笔记数上限。
   *
   * 判据是"一次轮询间隔内，一个真人能编辑几篇笔记"。手动逐篇编辑不会超过它；
   * 而库索引刷新、同步工具/git 拉取、批量替换脚本会一次命中很多篇——那些都**不是**
   * "用户正在编辑这篇笔记"的证据，替它们做改名/搬移没有任何授权基础。
   */
  maxPerSweep: number;
  /**
   * 自动处理后吸收"自有写入的延迟事件"的窗口（毫秒）。
   *
   * 自动处理改名/改写链接时，metadataCache 会**异步**（在 busy 标志清除之后）对同一笔记
   * 触发 changed；不吸收就会每 interval 秒空跑一次、无限自我放大。窗口短于轮询间隔，
   * 不影响后续真实编辑被再次采集。
   */
  rearmMs: number;
}

export const DEFAULT_AUTOMATION_GUARD: AutomationGuardOptions = {
  postSettleQuietMs: 1500,
  settleDeadlineMs: 8000,
  maxPerSweep: 5,
  rearmMs: 2000,
};

/** 库就绪门的状态（由调用方持有并更新；0 表示"尚未就绪"）。 */
export interface VaultGateState {
  /** 插件 ready 时刻（毫秒）。 */
  readyAt: number;
  /** 索引就绪时刻（毫秒）；0 = 尚未就绪。 */
  settledAt: number;
}

/** 未标记待处理的**机器可读**原因（用于诊断日志；文案在 `describeMarkSkip`）。 */
export type MarkSkipReason =
  | 'vault-not-settled'
  | 'post-settle-quiet'
  | 'rearm-window';

export type MarkDecision =
  | { mark: true; reason: 'marked' }
  | { mark: false; reason: MarkSkipReason };

/**
 * 判断一次 `metadataCache.changed` 是否应把该笔记标为"待自动处理"。
 *
 * 前置条件（开关、扩展名、busy）由调用方过滤——它们与这里的时序判断无关，
 * 放在一起会让这个函数同时依赖 App 与环境。
 */
export function decideMarkDirty(input: {
  now: number;
  gate: VaultGateState;
  opts: AutomationGuardOptions;
  /** 该笔记最近一次自动处理完成的时刻；从未处理过为 null。 */
  lastAutoAtForNote: number | null;
}): MarkDecision {
  const { now, gate, opts, lastAutoAtForNote } = input;
  if (gate.settledAt === 0) return { mark: false, reason: 'vault-not-settled' };
  if (now < gate.settledAt + opts.postSettleQuietMs) return { mark: false, reason: 'post-settle-quiet' };
  if (lastAutoAtForNote !== null && now - lastAutoAtForNote < opts.rearmMs) {
    return { mark: false, reason: 'rearm-window' };
  }
  return { mark: true, reason: 'marked' };
}

/** 把跳过原因转成诊断日志可读文案。 */
export function describeMarkSkip(reason: MarkSkipReason): string {
  if (reason === 'vault-not-settled') return '库索引尚未就绪（启动期批量事件，不作为用户编辑）';
  if (reason === 'post-settle-quiet') return '刚就绪的余震窗口内';
  return '自动处理自身的延迟事件（再武装窗口）';
}

/**
 * 自动处理的可取证计数。
 *
 * 这两道防线保护的是"**没有发生**的事"，而"什么都没发生"无法自证，也分不清
 * "防线生效"与"根本没触发"。有了计数，真实宿主验收就能回答
 * "启动期到底有多少 changed 被就绪门挡下"——> 0 说明这道门在当前环境里确实在干活。
 */
export interface AutomationStats {
  /** 因"库索引尚未就绪"而未被标记的 changed 次数。 */
  suppressedNotSettled: number;
  /** 因"刚就绪的余震窗口"而未被标记的次数。 */
  suppressedQuiet: number;
  /** 因"自动处理自身的延迟事件"而未被标记的次数。 */
  suppressedRearm: number;
  /** 批量护栏整批拒绝的次数。 */
  sweepRefused: number;
  /** 实际交给自动处理的笔记累计篇数。 */
  sweepProcessed: number;
}

export function createAutomationStats(): AutomationStats {
  return {
    suppressedNotSettled: 0,
    suppressedQuiet: 0,
    suppressedRearm: 0,
    sweepRefused: 0,
    sweepProcessed: 0,
  };
}

export interface SweepDecision {
  /** 是否允许处理这一批。 */
  allowed: boolean;
  /** 本批待处理笔记数。 */
  count: number;
  /** 上限。 */
  limit: number;
}

/**
 * 判断一次轮询是否允许处理当前这批脏笔记。
 *
 * 超过上限一律**整批拒绝**（而不是"处理前 N 篇"）：批次本身不可信时，从中挑几篇的
 * 依据同样不可信；拒绝后由调用方清空队列并明确告知用户去手动执行。
 */
export function decideSweep(count: number, opts: AutomationGuardOptions): SweepDecision {
  return { allowed: count <= opts.maxPerSweep, count, limit: opts.maxPerSweep };
}

/**
 * 批量护栏触发时给用户的提示文案。
 *
 * 抽成函数有两个原因：① 措辞要被单测钉住（这是"拒绝服务"的告知，必须说清"为什么"
 * 与"那该怎么办"）；② 它同时被主流程与用例引用，避免两处各写一份。
 *
 * 注意：这段文字会直接进 Notice，**不要写 markdown 标记**（Notice 不渲染）。
 */
export function describeSweepRefusal(count: number, limit: number): string {
  return (
    `检测到 ${count} 篇笔记同时待自动处理（超过单次上限 ${limit}），已跳过本次。` +
    `这种规模通常来自库索引刷新或同步工具批量写入，而不是逐篇编辑；` +
    `为避免未经确认就批量改名、搬移你的附件，自动处理只作用于少量改动。` +
    `如需处理这批笔记，请手动执行「收集/命名」等命令（这些命令会先给你预览）。`
  );
}
