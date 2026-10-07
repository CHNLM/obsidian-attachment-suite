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
 * 读取当前日志级别（只读访问点）。
 *
 * **当前没有任何生产与测试调用方**，保留为对称的只读访问点。诊断开关的状态一律以**设置**为准
 * （`settings.debugLogging`：设置是唯一事实来源，而且能落盘、也能被脚本回读），
 * 见 `main.ts` 的 `setDebugLogging` 与 `commands.ts` 的「切换诊断日志」——那两处都不读本函数。
 * 历史教训仍成立：`setLogLevel` 曾长期零调用 → `logger.debug` 的 7 处调用永远打不出来；
 * 改动日志级别相关逻辑时，请连同这里一起检查。
 */
export function getLogLevel(): LogLevel {
  return minLevel;
}

/** 注入自定义 sink（**预留：当前无调用方**；测试捕获若需要再启用）。 */
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