import { describe, expect, it } from 'vitest';
import { ok, err, errFromUnknown, isRetryable } from '../../../src/core/result';

describe('result：构造', () => {
  it('ok 构造成功结果', () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('err 构造失败结果并携带 code/level/message', () => {
    const r = err('NETWORK', 'fatal', '连接失败');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('NETWORK');
      expect(r.error.level).toBe('fatal');
      expect(r.error.message).toBe('连接失败');
    }
  });

  it('err 可携带 detail', () => {
    const detail = { url: 'https://x/a.png' };
    const r = err('TOO_LARGE', 'warning', '文件过大', detail);
    if (!r.ok) expect(r.error.detail).toBe(detail);
  });
});

describe('result：errFromUnknown 归一化', () => {
  it('Error 实例取 message', () => {
    const r = errFromUnknown(new Error('boom'));
    if (!r.ok) expect(r.error.message).toBe('boom');
  });

  it('字符串取字符串本身', () => {
    const r = errFromUnknown('oops');
    if (!r.ok) {
      expect(r.error.message).toBe('oops');
      expect(r.error.code).toBe('UNKNOWN');
      expect(r.error.level).toBe('recoverable');
    }
  });

  it('null / undefined 用默认信息', () => {
    const a = errFromUnknown(null);
    const b = errFromUnknown(undefined);
    if (!a.ok) expect(a.error.message).toBe('未知错误');
    if (!b.ok) expect(b.error.message).toBe('未知错误');
  });

  it('其它非字符串对象回退到默认信息（而非 Object 字符串化）', () => {
    const r = errFromUnknown({});
    if (!r.ok) expect(r.error.message).toBe('未知错误');
  });

  it('数字等原始类型回退到默认信息', () => {
    const r = errFromUnknown(42);
    if (!r.ok) expect(r.error.message).toBe('未知错误');
  });

  it('可自定义 fallbackMessage', () => {
    const a = errFromUnknown(undefined, '下载失败');
    if (!a.ok) expect(a.error.message).toBe('下载失败');
    const b = errFromUnknown(new Error('real'), '下载失败');
    if (!b.ok) expect(b.error.message).toBe('real');
  });
});

describe('result：isRetryable', () => {
  const errOf = (code: Parameters<typeof isRetryable>[0]['code']) => ({ code, level: 'fatal' as const, message: '' });

  it('网络/超时/冲突可重试', () => {
    expect(isRetryable(errOf('NETWORK'))).toBe(true);
    expect(isRetryable(errOf('TIMEOUT'))).toBe(true);
    expect(isRetryable(errOf('CONFLICT'))).toBe(true);
  });

  it('其余错误类型不可重试', () => {
    expect(isRetryable(errOf('INVALID_PATH'))).toBe(false);
    expect(isRetryable(errOf('TOO_LARGE'))).toBe(false);
    expect(isRetryable(errOf('FORBIDDEN'))).toBe(false);
    expect(isRetryable(errOf('CANCELED'))).toBe(false);
    expect(isRetryable(errOf('UNKNOWN'))).toBe(false);
  });
});