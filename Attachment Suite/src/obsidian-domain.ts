/** Obsidian 基础设施适配器：把 App 包装为 core 所需接口（infra 层）。 */

import { TFile, TFolder, type App } from 'obsidian';
import { resolveAttachmentDir, renderAttachmentFolderTemplate, type FileOps, type MetadataProvider, type VaultAdapter } from './core';
import type { PluginSettings } from './settings';

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

/** VaultAdapter 的 Obsidian 实现。 */
export class ObsidianVaultAdapter implements VaultAdapter {
  constructor(private readonly app: App) {}

  async exists(path: string): Promise<boolean> {
    return this.app.vault.adapter.exists(path);
  }

  async read(path: string): Promise<ArrayBuffer> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      return this.app.vault.readBinary(f);
    }
    throw new Error(`Not a file: ${path}`);
  }

  async readHead(path: string, maxBytes: number): Promise<Uint8Array> {
    const buf = await this.read(path);
    return new Uint8Array(buf).subarray(0, maxBytes);
  }

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
    if (f instanceof TFile) {
      await this.app.fileManager.renameFile(f, toPath);
      return;
    }
    throw new Error(`Not a file: ${fromPath}`);
  }
}