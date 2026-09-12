/** 统一错误与结果模型。 */

export type PluginErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'CONFLICT'
  | 'INVALID_PATH'
  | 'TOO_LARGE'
  | 'FORBIDDEN'
  | 'CANCELED'
  | 'UNKNOWN';

export type ErrorLevel = 'fatal' | 'recoverable' | 'warning';

export interface PluginError {
  code: PluginErrorCode;
  level: ErrorLevel;
  message: string;
  detail?: unknown;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: PluginError };

/** 便捷构造 OK 结果。 */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** 便捷构造失败结果。 */
export function err<T = never>(
  code: PluginErrorCode,
  level: ErrorLevel,
  message: string,
  detail?: unknown,
): Result<T> {
  return { ok: false, error: { code, level, message, detail } };
}

/** 从任意抛出的异常构造失败结果。 */
export function errFromUnknown<T>(e: unknown, fallbackMessage = '未知错误'): Result<T> {
  const message =
    e instanceof Error ? e.message : typeof e === 'string' ? e : fallbackMessage;
  return { ok: false, error: { code: 'UNKNOWN', level: 'recoverable', message } };
}

/** 判断是否可重试的错误（网络/超时/冲突可达）。 */
export function isRetryable(error: PluginError): boolean {
  return (
    error.code === 'NETWORK' ||
    error.code === 'TIMEOUT' ||
    error.code === 'CONFLICT'
  );
}