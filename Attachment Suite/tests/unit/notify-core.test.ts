import { describe, expect, it } from 'vitest';
import { shouldNotify } from '../../src/notify-core';
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