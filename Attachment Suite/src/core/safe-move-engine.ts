/** 安全改名/移动引擎。目标占用时安全避让，不静默覆盖。 */

import type { FileOps } from './types';

export interface MoveResult {
  from: string;
  to: string;
  /** 是否因目标占用而附加了编号。 */
  conflict: boolean;
}

export interface MoveError {
  from: string;
  to: string;
  message: string;
}

export interface SafeMoveOutcome {
  results: MoveResult[];
  errors: MoveError[];
}

/** 单次改名重试次数与退避基数（应对目标/源文件瞬时被占用）。 */
const RENAME_ATTEMPTS = 3;
const RENAME_BACKOFF_MS = 150;

async function delay(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * 安全改名/移动：一律经 FileOps.rename（Obsidian 由 fileManager 联动改写链接），
 * 目标已存在时追加 `(1)`/`(2)`… 避让，绝不静默覆盖。
 * 改名失败时按退避重试多次，缓解文件被占用等瞬时冲突。
 */
export class SafeMoveEngine {
  constructor(
    private readonly ops: FileOps,
    /**
     * 诊断出口（默认丢弃）。core 不能 import `logger`，故由调用方注入（见 `main.ts`）。
     *
     * 为什么需要它：2026-09-28 真实宿主上出现「`exists(from)` 通过、紧接着 `renameFile` 抛
     * ENOENT」——计划里的源路径与实际磁盘不符。当时只能看到"失败 N 项"，
     * 无法判断是快照过期、还是冲突避让改了目标、还是宿主索引与磁盘不一致。
     * 这几行把"判定的源是否存在""最终目标"直接摊开。
     */
    private readonly onDebug: (msg: string) => void = () => {},
  ) {}

  /**
   * 将单个文件移动到目标路径；目标占用则自动避让。
   * @returns 实际落盘路径（可能带避让编号）。
   */
  async move(fromPath: string, toPath: string): Promise<MoveResult> {
    // 源不存在属"永久失败"：此时重试 3 次只会白等退避（每项约 450ms）。
    // 例如计划生成后文件被外部改名/删除、或调用方拿着过期快照执行——快速失败即可。
    const sourceExists = await this.ops.exists(fromPath);
    this.onDebug(`移动：${fromPath}（源存在：${sourceExists ? '是' : '否'}）`);
    if (!sourceExists) {
      throw new Error(`源文件不存在：${fromPath}`);
    }
    const target = await this.resolveNoConflict(toPath);
    if (target !== toPath) this.onDebug(`移动：目标被占用，避让为 ${target}`);
    let lastErr: unknown;
    for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt++) {
      try {
        await this.ops.rename(fromPath, target);
        this.onDebug(`移动成功：${fromPath} → ${target}`);
        return { from: fromPath, to: target, conflict: target !== toPath };
      } catch (e) {
        lastErr = e;
        if (attempt < RENAME_ATTEMPTS - 1) await delay(RENAME_BACKOFF_MS * (attempt + 1));
      }
    }
    throw new Error(`改名失败 ${fromPath} → ${target}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }

  /** 批量移动：逐项执行，单项失败记入 errors 并继续。 */
  async moveMany(moves: Array<{ from: string; to: string }>): Promise<SafeMoveOutcome> {
    const results: MoveResult[] = [];
    const errors: MoveError[] = [];
    for (const m of moves) {
      try {
        results.push(await this.move(m.from, m.to));
      } catch (e) {
        errors.push({
          from: m.from,
          to: m.to,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { results, errors };
  }

  /** 若目标已存在，在扩展名前追加 `(N)` 返回不冲突路径。 */
  private async resolveNoConflict(toPath: string): Promise<string> {
    if (!(await this.ops.exists(toPath))) return toPath;
    const dot = toPath.lastIndexOf('.');
    const slash = toPath.lastIndexOf('/');
    if (dot <= slash) {
      // 无扩展名
      let i = 1;
      let candidate = `${toPath} (${i})`;
      while (await this.ops.exists(candidate)) {
        i++;
        candidate = `${toPath} (${i})`;
      }
      return candidate;
    }
    const stem = toPath.slice(0, dot);
    const ext = toPath.slice(dot);
    let i = 1;
    let candidate = `${stem} (${i})${ext}`;
    while (await this.ops.exists(candidate)) {
      i++;
      candidate = `${stem} (${i})${ext}`;
    }
    return candidate;
  }
}