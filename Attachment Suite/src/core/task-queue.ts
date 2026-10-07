/** 串行任务队列 + 可取消。 */

/**
 * 简单串行队列：保证同一时刻只跑一个全库级操作，避免与库事件互相触发/重入。
 */
export class TaskQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private pending = 0;

  /**
   * 追加一个任务到队尾串行执行。
   *
   * **调用方必须自行处理返回值上的 rejection**（例如 `void q.enqueue(...).catch(报告)`）。
   * 队列内部只保证"某个任务失败不中断后续任务"，它接住的是内部 chain；返回给调用方的是原始
   * promise，用于让调用方观察到失败（见 tests/unit/core/task-queue.test.ts 的错误隔离用例）。
   * 因此若调用方直接 `void q.enqueue(...)` 而任务会抛错，就会产生无人处理的 rejection：
   * 控制台一行告警、用户侧零提示——后台任务（自动处理、笔记移动跟随附件）尤其容易因此静默失败。
   */
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