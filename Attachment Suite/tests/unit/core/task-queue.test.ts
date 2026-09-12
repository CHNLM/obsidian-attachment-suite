import { describe, expect, it } from 'vitest';
import { TaskQueue, createCancellation } from '../../../src/core/task-queue';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('TaskQueue：串行与顺序', () => {
  it('按入队顺序串行执行，不并发交错', async () => {
    const q = new TaskQueue();
    const order: number[] = [];
    const run = (n: number) =>
      q.enqueue(async () => {
        order.push(n);
        await wait(5);
        order.push(n * 10);
      });
    await Promise.all([run(1), run(2), run(3)]);
    expect(order).toEqual([1, 10, 2, 20, 3, 30]);
  });

  it('enqueue 返回任务的返回值', async () => {
    const q = new TaskQueue();
    expect(await q.enqueue(async () => 7)).toBe(7);
  });
});

describe('TaskQueue：错误隔离', () => {
  it('单个任务失败不中断后续任务，drain 不抛错', async () => {
    const q = new TaskQueue();
    const log: string[] = [];
    const bad = q.enqueue(async () => {
      log.push('bad');
      throw new Error('fail');
    });
    const after = q.enqueue(async () => {
      log.push('after');
    });
    await expect(bad).rejects.toThrow('fail');
    await after;
    await q.drain();
    expect(log).toEqual(['bad', 'after']);
  });
});

describe('TaskQueue：状态', () => {
  it('isProcessing 在任务执行中为 true，结束后为 false', async () => {
    const q = new TaskQueue();
    expect(q.isProcessing()).toBe(false);

    let released: () => void = () => {};
    const gate = new Promise<void>((r) => {
      released = r;
    });
    const p = q.enqueue(async () => {
      await gate;
    });

    await wait(0); // 让任务开始执行
    expect(q.isProcessing()).toBe(true);

    released();
    await p;
    await q.drain(); // 等待 catch/finally 链清空，pending 归零
    expect(q.isProcessing()).toBe(false);
  });

  it('drain 等待所有已入队任务结束', async () => {
    const q = new TaskQueue();
    let done = false;
    q.enqueue(async () => {
      await wait(10);
      done = true;
    });
    await q.drain();
    expect(done).toBe(true);
  });
});

describe('createCancellation', () => {
  it('未取消时为 false，abort 后为 true', () => {
    const c = new AbortController();
    const token = createCancellation(c.signal);
    expect(token.isCancelled()).toBe(false);
    c.abort();
    expect(token.isCancelled()).toBe(true);
    expect(token.signal).toBe(c.signal);
  });
});