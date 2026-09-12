/** 导出：把当前笔记附件 / 未用附件打包为 zip 并写入库内。 */

import { normalizePath, TFile, type App } from 'obsidian';
import { createZip } from '../core';
import type { AttachmentIndex } from '../core';
import type { PluginSettings } from '../settings';
import { createNoticer } from '../notify';
import { logger } from '../logger';
import { tsOf, uniqueFlatName } from './export-name-core';

function e(name: string, s: string): { name: string; data: Uint8Array } {
  return { name, data: new TextEncoder().encode(s) };
}

async function readFile(app: App, path: string): Promise<Uint8Array | null> {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) return null;
  try {
    const buf = await app.vault.readBinary(f);
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/** 写 zip 到库内；目标已存在则先删除再覆盖，保证重复导出不报错。 */
async function saveZip(app: App, zipPath: string, zip: Uint8Array): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(zipPath);
  if (existing instanceof TFile) {
    await app.vault.delete(existing);
  }
  await app.vault.createBinary(
    zipPath,
    zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer,
  );
}

/** 取库内文件的修改时间（毫秒），读取失败回退当前时间。 */
function fileMtimeMs(app: App, path: string): number {
  const f = app.vault.getAbstractFileByPath(path);
  return f instanceof TFile && f.stat?.mtime ? f.stat.mtime : Date.now();
}

/** 导出当前笔记的附件。 */
export async function runExportNote(
  app: App,
  index: AttachmentIndex,
  getSettings: () => PluginSettings,
): Promise<void> {
  const toast = createNoticer(() => getSettings().notificationLevel);
  const note = app.workspace.getActiveFile() as TFile | null;
  if (!note) {
    toast.error('请先打开一个笔记。');
    return;
  }
  if (!getSettings().exporter.enabled) {
    toast.summary('导出能力已关闭。');
    return;
  }
  const snapshot = await index.getSnapshot();
  const paths: string[] = [];
  for (const entry of snapshot.entries.values()) {
    if (entry.references.some((r) => r.sourcePath === note.path)) paths.push(entry.path);
  }
  if (paths.length === 0) {
    toast.summary('当前笔记没有附件可导出。');
    return;
  }

  const entries = [e('manifest.json', JSON.stringify({
    plugin: 'attachment-suite',
    exportedAt: new Date().toISOString(),
    note: note.path,
    count: paths.length,
  }, null, 2))];
  // 以扁平文件名归档，避免重复路径问题
  const nameMap = new Map<string, number>();
  for (const p of paths) {
    const base = p.split('/').pop() ?? 'file';
    const n = nameMap.get(base) ?? 0;
    nameMap.set(base, n + 1);
    const finalName = n === 0 ? base : `${base.slice(0, base.lastIndexOf('.'))}_${n}${base.slice(base.lastIndexOf('.'))}`;
    const data = await readFile(app, p);
    entries.push({ name: finalName, data: data ?? new Uint8Array() });
  }

  const zip = createZip(entries);
  const dir = note.parent?.path ?? '';
  const zipPath = normalizePath(dir ? `${dir}/${note.basename}_Attachments.zip` : `${note.basename}_Attachments.zip`);
  await saveZip(app, zipPath, zip);
  logger.info(`导出完成：${zipPath}`);
  toast.summary(`导出了 ${paths.length} 个附件至 ${zipPath}。`);
}

/** 导出全部未用附件。 */
export async function runExportOrphaned(
  app: App,
  index: AttachmentIndex,
  getSettings: () => PluginSettings,
): Promise<void> {
  const toast = createNoticer(() => getSettings().notificationLevel);
  if (!getSettings().exporter.enabled) {
    toast.summary('导出能力已关闭。');
    return;
  }
  const snapshot = await index.getSnapshot();
  const orphaned = snapshot.orphanCandidates;
  if (orphaned.length === 0) {
    toast.summary('没有未使用的附件可导出。');
    return;
  }
  const entries = [e('manifest.json', JSON.stringify({
    plugin: 'attachment-suite',
    exportedAt: new Date().toISOString(),
    count: orphaned.length,
  }, null, 2))];
  const usedNames = new Set<string>();
  for (const p of orphaned) {
    const base = p.split('/').pop() ?? 'file';
    const name = uniqueFlatName(base, usedNames, tsOf(fileMtimeMs(app, p)));
    const data = await readFile(app, p);
    entries.push({ name, data: data ?? new Uint8Array() });
  }
  const zip = createZip(entries);
  const zipPath = 'Unused_Attachments.zip';
  await saveZip(app, zipPath, zip);
  logger.info(`导出未用完成：${zipPath}`);
  toast.summary(`导出了 ${orphaned.length} 个未用附件至 ${zipPath}。`);
}