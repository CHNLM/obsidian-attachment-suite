/** Obsidian 基础设施适配器：把 App 包装为 core 所需接口（infra 层）。 */

import { TFile, TFolder, type App } from 'obsidian';
import {
  dirOf,
  refMapForMoves,
  resolveAttachmentDir,
  renderAttachmentFolderTemplate,
  rewrite,
  rewriteCanvasFileFields,
  rewriteFrontmatter,
  type FileOps,
  type MetadataProvider,
  type VaultAdapter,
} from './core';
import type { PluginSettings } from './settings';
import { logger } from './logger';

/**
 * 确保目录（含祖先）存在。Obsidian 的 createFolder 在目录已存在时会抛错，
 * 也常因并发在此前刚被创建，故容忍"已存在"这种竞态。
 */
export async function ensureFolder(app: App, dir: string): Promise<void> {
  if (!dir) return;
  if (app.vault.getAbstractFileByPath(dir) instanceof TFolder) return;
  const parts = dir.split('/').filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    if (app.vault.getAbstractFileByPath(acc) instanceof TFolder) continue;
    try {
      await app.vault.createFolder(acc);
    } catch {
      // 竞态：检查后、创建前目录已被建立。再确认存在即视为成功。
      if (!(app.vault.getAbstractFileByPath(acc) instanceof TFolder)) {
        throw new Error(`创建目录失败：${acc}`);
      }
    }
  }
}

/**
 * 依据「附件目录来源」结算出有效的目录字符串（随后交给纯函数 resolveAttachmentDir 解析）。
 * - 'custom'：直接用 settings.attachmentFolder。
 * - 'obsidian'：读 Obsidian 全局附件目录配置（attachmentFolderPath）；
 *   缺失时回退到自定义目录，避免落空。
 */
export function effectiveAttachmentFolder(app: App, settings: PluginSettings): string {
  if (settings.attachmentFolderMode === 'custom') return settings.attachmentFolder;
  const cfg = (app.vault as unknown as { getConfig?: (k: string) => unknown }).getConfig?.('attachmentFolderPath');
  return typeof cfg === 'string' && cfg !== '' ? cfg : settings.attachmentFolder;
}

/**
 * 结算某条笔记的附件落地目录（解析模板变量后，再按笔记父目录计算相对路径）。
 * 供本地化/收集/命名等需要"该笔记附件放哪"的场景统一使用。
 */
export function resolveAttachmentDirForNote(app: App, settings: PluginSettings, note: TFile): string {
  const folder = effectiveAttachmentFolder(app, settings);
  const rendered = renderAttachmentFolderTemplate(folder, note.basename, note.parent?.path ?? '', new Date());
  return resolveAttachmentDir(note.parent?.path ?? '', rendered);
}

/** VaultAdapter 的 Obsidian 实现（只需文件清单，内容读取走 MetadataProvider）。 */
export class ObsidianVaultAdapter implements VaultAdapter {
  constructor(private readonly app: App) {}

  async listFiles(): Promise<string[]> {
    return this.app.vault.getFiles().map((f) => f.path);
  }
}

/** MetadataProvider 的 Obsidian 实现。 */
export class ObsidianMetadataProvider implements MetadataProvider {
  constructor(private readonly app: App) {}

  getResolvedLinks(): Record<string, Record<string, number>> {
    return this.app.metadataCache.resolvedLinks as Record<string, Record<string, number>>;
  }

  async getFileText(path: string): Promise<string> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      return this.app.vault.cachedRead(f);
    }
    return '';
  }
}

/** FileOps 的 Obsidian 实现：经 fileManager 改名（联动改写全部链接）。 */
export class ObsidianFileOps implements FileOps {
  constructor(private readonly app: App) {}

  async exists(path: string): Promise<boolean> {
    return this.app.vault.adapter.exists(path);
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(fromPath);
    if (!(f instanceof TFile)) {
      throw new Error(`Not a file: ${fromPath}`);
    }
    // 目标父目录可能还不存在——把附件收进 `<笔记目录>/assets` 时**第一次必然如此**。
    // Obsidian 的 `fileManager.renameFile` **不创建**目标目录，缺目录时底层 `fs.rename`
    // 直接抛 ENOENT；而该错误文本会同时打印源与目标，极易被误读成"源文件不存在"
    // （2026-09-28 真实宿主实测：`收集当前笔记附件` 报 ENOENT，实际源文件好端端在磁盘上）。
    // 本地化（写盘）与笔记重定位早就各自 `ensureFolder` 了，只有"移动"这条公共出口漏了——
    // 于是任何"笔记目录下还没有附件目录"的库，第一次收集/命名必然整批失败。
    await ensureFolder(this.app, dirOf(toPath));
    await this.app.fileManager.renameFile(f, toPath);
  }
}

/* ============================ 引用兜底改写 ============================ */

/**
 * 移动/重命名后的"链接兜底改写"。
 *
 * 背景：插件依赖 Obsidian 的 `fileManager.renameFile` 在改名时联动改写链接，但实测它对
 * **当前处于打开/活动状态的笔记**往往不主动改写其正文中的嵌入引用，导致重命名附件后该笔记的
 * 链接变坏。这里在每次移动成功后做一次幂等兜底改写：仅当正文仍含旧引用时才替换，
 * Obsidian 已改写过的（旧引用已不存在）自然跳过，不会重复处理。
 *
 * 为何住在 infra 层：**改引用那一族 feature 都要经由这一层**（命名、收集、路径修复、笔记跟随、
 * 全库收集、修复断链）——单篇改写走 `rewriteRefsInNote`，路径修复走 `rewriteRefsInAllNotes`
 * （它内部再调用前者）。
 * 放在某个 feature 里会让那个 feature 变成"事实上的共享执行模块"，并诱使其它 feature 横向
 * 依赖它（历史上就是这么长起来的）。它是"依赖 App 的库内写操作"，与 `ensureFolder`、
 * `resolveAttachmentDirForNote` 同类，故归属于此。
 */

/**
 * 安全兜底改写：把"改完文件之后的引用改写"包起来，不让它冒泡。
 *
 * 时序上这一步发生在 `mover.moveMany` **之后**——文件已经改名/移动完了。若这里抛错并冒泡，
 * 异常会顺着弹窗回调被丢弃（见 modals.ts 的 runConfirmed 注释），用户看到的是"点完确认后
 * 什么都没发生"，而库里实际是"路径已改、引用没跟上"。所以把错误就地转成返回值，
 * 让调用方能一边照常报告移动/改名的统计结果，一边明确告诉用户哪一步没做成、下一步该做什么。
 *
 * @returns 出错时返回错误信息，成功返回 null。
 */
export async function rewriteRefsSafely(step: () => Promise<unknown>): Promise<string | null> {
  try {
    await step();
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`引用改写失败：${msg}`);
    return msg;
  }
}

/**
 * 改写单个笔记正文中命中的引用；有改动则写回并返回 true。
 *
 * **必须按文件类型选改写器**：md 笔记走 `rewrite`（markdown/wiki/HTML）+ `rewriteFrontmatter`，
 * canvas 走 `rewriteCanvasFileFields`。
 *
 * 为什么 canvas 不能漏：`rewrite()` 不认识 canvas 的 `"file"` 字段。漏掉它，则
 * 「收集」（把附件搬进归属目录）与「全库命名」（改名）之后，canvas 里的引用**原地不动**变成悬空，
 * 紧接着的「清理未用附件」会按"谁都没引用我"把这个附件当孤儿删掉——附件真丢、canvas 真断。
 * 索引层（`core/attachment-index` 的 `canvasFileRefs`）一直把 canvas 引用算作"在用"，
 * 所以漏掉写入侧就是一次典型的"两层口径不一致"。
 */
export async function rewriteRefsInNote(app: App, notePath: string, map: Map<string, string>): Promise<boolean> {
  if (map.size === 0) return false;
  const f = app.vault.getAbstractFileByPath(notePath);
  if (!(f instanceof TFile)) return false;
  const text = await app.vault.read(f);
  const isCanvas = notePath.endsWith('.canvas');
  let next = isCanvas ? rewriteCanvasFileFields(text, map) : rewrite(text, map);
  if (!isCanvas) next = rewriteFrontmatter(next, map);
  if (next === text) return false;
  await app.vault.modify(f, next);
  return true;
}

/** 改写全库所有文本文件的引用（用于路径修复这类跨笔记场景）。返回改动笔记数。 */
export async function rewriteRefsInAllNotes(app: App, moves: Array<{ from: string; to: string }>): Promise<number> {
  const map = refMapForMoves(moves);
  if (map.size === 0) return 0;
  let changed = 0;
  const notes = app.vault.getFiles().filter((f) => f.extension === 'md' || f.extension === 'canvas');
  for (const n of notes) {
    if (await rewriteRefsInNote(app, n.path, map)) changed++;
  }
  return changed;
}