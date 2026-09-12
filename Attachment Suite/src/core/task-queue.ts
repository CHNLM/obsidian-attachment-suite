/** 串行任务队列 + 可取消。 */

/**
 * 简单串行队列：保证同一时刻只跑一个全库级操作，避免与库事件互相触发/重入。
 */
export class TaskQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private pending = 0;

  /** 追加一个任务到队尾串行执行。 */
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.pending++;
    const run = this.chain.then(task);
    // 吞掉已入队任务中途的错误，避免中断后续任务，同时保留给调用方
    this.chain = run.catch(() => undefined).finally(() => {
      this.pending--;
    });
    return run;
  }

  /** 队列是否空闲（无在途任务）。 */
  isProcessing(): boolean {
    return this.pending > 0;
  }

  /** 等待当前队列清空。 */
  async drain(): Promise<void> {
    await this.chain;
  }
}

/** 由 AbortController 驱动的可取消标记。 */
export interface CancellationToken {
  signal: AbortSignal;
  /** 若已取消则抛出或返回 true。 */
  isCancelled(): boolean;
}

export function createCancellation(signal: AbortSignal): CancellationToken {
  return {
    signal,
    isCancelled: () => signal.aborted,
  };
}