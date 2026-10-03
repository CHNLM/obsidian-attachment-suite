import { describe, expect, it } from 'vitest';
import { shouldNotify, effectiveDuration } from '../../src/notify-core';
import type { NotificationLevel } from '../../src/settings';

const LEVELS: NotificationLevel[] = ['silent', 'summary', 'verbose'];

describe('notify', () => {
  it('silent：只显示 error', () => {
    expect(shouldNotify('silent', 'error')).toBe(true);
    expect(shouldNotify('silent', 'summary')).toBe(false);
    expect(shouldNotify('silent', 'info')).toBe(false);
  });

  it('summary：显示 error 与 summary，隐藏 info', () => {
    expect(shouldNotify('summary', 'error')).toBe(true);
    expect(shouldNotify('summary', 'summary')).toBe(true);
    expect(shouldNotify('summary', 'info')).toBe(false);
  });

  it('verbose：全部显示', () => {
    for (const kind of ['error', 'summary', 'info'] as const) {
      expect(shouldNotify('verbose', kind)).toBe(true);
    }
  });

  it('所有级别下 error 都被提示', () => {
    for (const level of LEVELS) expect(shouldNotify(level, 'error')).toBe(true);
  });
});

describe('effectiveDuration', () => {
  it('短消息使用基础时长（error 5s / summary 3s / info 2s）', () => {
    expect(effectiveDuration('error', '出错了')).toBe(5000);
    expect(effectiveDuration('summary', '命名完成：重命名 1。')).toBe(3000);
    expect(effectiveDuration('info', '处理中')).toBe(2000);
  });

  it('消息越长（换行越多）停留越久', () => {
    const long = 'x'.repeat(80); // 按每行 40 字符 => 2 行，多 1 秒
    expect(effectiveDuration('summary', long)).toBe(3000 + 1000);
  });

  it('空/超长消息不会低于基础时长', () => {
    expect(effectiveDuration('summary', '')).toBe(3000);
  });
});