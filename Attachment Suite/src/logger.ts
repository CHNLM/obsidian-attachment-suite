/** 结构化分级日志。统一出口，避免各处散落 notice/console。 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const PREFIX = '[IAP]';

let minLevel: LogLevel = 'info';
let sink: (level: LogLevel, msg: string) => void = defaultSink;

function defaultSink(level: LogLevel, msg: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (console as any)[level === 'trace' ? 'log' : level] ?? console.log;
  fn.call(console, `${PREFIX} ${msg}`);
}

/** 设置全局日志级别。 */
export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

/**
 * 读取当前日志级别。
 *
 * 存在的意义：级别必须是**可读**的，否则"开启诊断"这类开关无法向用户/脚本如实回报状态，
 * 也无法写成可证伪的用例（`setLogLevel` 曾长期零调用 → `logger.debug` 的 7 处调用
 * 永远打不出来，见 `commands.ts` 的「切换诊断日志」命令）。
 */
export function getLogLevel(): LogLevel {
  return minLevel;
}

/** 注入自定义 sink（用于测试捕获）。 */
export function setSink(s: (level: LogLevel, msg: string) => void): void {
  sink = s;
}

const ORDER: Record<LogLevel, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };

function emit(level: LogLevel, msg: string): void {
  if (ORDER[level] < ORDER[minLevel]) return;
  sink(level, msg);
}

export const logger = {
  trace: (msg: string): void => emit('trace', msg),
  debug: (msg: string): void => emit('debug', msg),
  info: (msg: string): void => emit('info', msg),
  warn: (msg: string): void => emit('warn', msg),
  error: (msg: string): void => emit('error', msg),
};