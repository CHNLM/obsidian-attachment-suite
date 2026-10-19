/** 导出：把当前笔记附件 / 未用附件打包为 zip 并写入库内。 */

import { normalizePath, TFile, type App } from 'obsidian';
import { createZip, isPathExcluded, MAX_ZIP_ENTRIES } from '../core';
import type { AttachmentIndex } from '../core';
import type { PluginSettings } from '../settings';
import { createNoticer } from '../notify';
import { ConfirmModal } from '../modals';
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

/** 取库内文件大小（字节）；未知则按 0 计（上限判定宁可宽松，不因元数据缺失而误拦）。 */
function fileSizeOf(app: App, path: string): number {
  const f = app.vault.getAbstractFileByPath(path);
  return f instanceof TFile && typeof f.stat?.size === 'number' ? f.stat.size : 0;
}

/** 单次导出的内存安全上限（字节）。ZIP 在内存内拼装，超过即中止而非冒险 OOM。 */
const MAX_EXPORT_BYTES = 512 * 1024 * 1024;

/**
 * 导出峰值内存的估算系数。
 *
 * 2026-10-19 规模实测：20MB 归档使进程 RSS 增加约 45MB（≈2.3×）——附件字节、条目数组
 * 与最终归档在拼装期间同时存在。这是**粗估**，只用来在"确认前"告诉用户这一步有多重。
 */
const EXPORT_PEAK_FACTOR = 2.3;

/** 估算峰值超过这个值就先弹确认（约 128MB；再小的导出不值得多一次点击）。 */
const EXPORT_CONFIRM_PEAK_BYTES = 128 * 1024 * 1024;

interface ExportEstimate {
  entryCount: number;
  totalBytes: number;
  peakBytes: number;
}

const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);

/** 按 stat 估算条目数、合计体积与峰值内存（**读取内容之前**即可算出）。 */
function estimateExport(app: App, paths: string[]): ExportEstimate {
  const totalBytes = paths.reduce((sum, p) => sum + fileSizeOf(app, p), 0);
  return {
    // 归档里固定附带 manifest.json（见下方两处 `entries` 的初始化）
    entryCount: paths.length + 1,
    totalBytes,
    peakBytes: Math.round(totalBytes * EXPORT_PEAK_FACTOR),
  };
}

/**
 * 导出前的硬限制体检：**条目数** + **体积**；超限时提示并返回 false。
 *
 * 条目数必须先查：`core/zip` 的 EOCD 条目数字段是 uint16，超限时 `createZip` 会抛错——
 * 但那时附件已经逐个读进内存了。提前判断既能给出可行动的建议，又避免白读几万个文件。
 */
function checkExportLimits(
  est: ExportEstimate,
  paths: string[],
  toast: ReturnType<typeof createNoticer>,
  label: string,
): boolean {
  if (est.entryCount > MAX_ZIP_ENTRIES) {
    toast.error(
      `${label}共 ${paths.length} 个附件，加上清单共 ${est.entryCount} 项，超过单次导出的条目上限 ${MAX_ZIP_ENTRIES}（ZIP 格式限制），已中止。请分批导出。`,
    );
    logger.warn(`导出中止：条目数 ${est.entryCount} > ${MAX_ZIP_ENTRIES}`);
    return false;
  }
  if (est.totalBytes <= MAX_EXPORT_BYTES) return true;
  toast.error(
    `${label}共 ${paths.length} 个附件约 ${mb(est.totalBytes)} MB，超过导出安全上限 ${mb(MAX_EXPORT_BYTES)} MB` +
      `（按实测峰值约需 ${mb(est.peakBytes)} MB 内存），已中止以免内存耗尽。请分批导出。`,
  );
  logger.warn(`导出中止：合计 ${est.totalBytes} 字节 > ${MAX_EXPORT_BYTES}（峰值约 ${est.peakBytes} 字节）`);
  return false;
}

/**
 * 预计内存较大时先确认。
 *
 * 为什么要有这一步：导出没有"预览"可看，用户点下去就开始把附件读进内存；512MB 上限是硬拦，
 * 但接近上限时（实测峰值可达 ~1.2GB）用户应当**在开始前**知道代价，而不是等 Obsidian 卡住。
 * 返回 true 表示已经交给确认窗（调用方应立即 return，不要继续执行）。
 */
function confirmIfHeavy(
  app: App,
  est: ExportEstimate,
  paths: string[],
  label: string,
  onConfirm: () => Promise<void>,
): boolean {
  if (est.peakBytes < EXPORT_CONFIRM_PEAK_BYTES) return false;
  new ConfirmModal(app, {
    title: '确认导出',
    desc:
      `${label}将导出 ${paths.length} 个附件，合计约 ${mb(est.totalBytes)} MB。` +
      `按实测峰值估算，约需 ${mb(est.peakBytes)} MB 内存（安全上限 ${mb(MAX_EXPORT_BYTES)} MB）。` +
      '导出期间 Obsidian 可能短暂卡顿，确定继续？',
    confirmText: '继续导出',
    onConfirm,
  }).open();
  return true;
}

/** 导出当前笔记的附件。 */
export async function runExportNote(
  app: App,
  index: AttachmentIndex,
  getSettings: () => PluginSettings,
  /**
   * 显式目标笔记；省略时用当前活动笔记。
   *
   * 文件菜单传的是**被右键的那一篇**，它不一定正打开着——若这里仍按 `getActiveFile()` 取目标，
   * 就会出现"右键 A、却把 B 导出了"。其余三个笔记级命令早就支持这个参数，这里补齐以保持一致。
   */
  notePath?: string,
): Promise<void> {
  const toast = createNoticer(() => getSettings().notificationLevel);
  const note = notePath
    ? (app.vault.getAbstractFileByPath(notePath) as TFile | null)
    : (app.workspace.getActiveFile() as TFile | null);
  if (!note || !(note instanceof TFile)) {
    if (!notePath) toast.error('请先打开一个笔记。');
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
  // 与「导出未用附件」同一套体检（单篇↔全库等价性）
  const est = estimateExport(app, paths);
  if (!checkExportLimits(est, paths, toast, '当前笔记的')) return;

  const execute = async (): Promise<void> => {
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
    // 写盘失败（磁盘满、权限、库只读）过去会冒泡成未处理 rejection，用户看到开始提示后再无下文，
    // 无法判断 zip 到底有没有生成。导出是明确的手动动作，结果必须送达。
    try {
      await saveZip(app, zipPath, zip);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`导出失败 ${zipPath}: ${msg}`);
      toast.error(`导出失败：${msg}。请确认库目录可写、磁盘空间充足后重试。`);
      return;
    }
    logger.info(`导出完成：${zipPath}`);
    toast.summary(`导出了 ${paths.length} 个附件至 ${zipPath}。`);
  };

  // 预计内存较大 → 先确认；确认后才开始读文件
  if (confirmIfHeavy(app, est, paths, '当前笔记的', execute)) return;
  await execute();
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
  // 与「清理未用附件」同源（用户把目录列为排除 = "这块区域不要动"，导出同理不打包），
  // 但**只取全局排除目录** `paths.exclude`：不含「清理」专属的 `cleanup.excludedFolders`。
  const exclude = getSettings().paths?.exclude ?? [];
  const allOrphaned = snapshot.orphanCandidates;
  const orphaned = allOrphaned.filter((p) => !isPathExcluded(p, exclude));
  const skipped = allOrphaned.length - orphaned.length;
  if (orphaned.length === 0) {
    toast.summary(
      skipped > 0 ? `未用附件 ${skipped} 个均位于排除目录，已跳过导出。` : '没有未用的附件可导出。',
    );
    return;
  }
  // 内存安全上限：ZIP 为 store 模式、在内存内一次性拼装（体积 ≈ 各附件之和），
  // 大库导出会把全部字节同时读入内存。超过上限直接中止并给出可行动的建议，
  // 避免"点了导出 → Obsidian 卡死/崩溃"这种不可预期后果。
  const est = estimateExport(app, orphaned);
  if (!checkExportLimits(est, orphaned, toast, '待导出')) return;

  const execute = async (): Promise<void> => {
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
    try {
      await saveZip(app, zipPath, zip);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`导出未用附件失败 ${zipPath}: ${msg}`);
      toast.error(`导出失败：${msg}。请确认库根目录可写、磁盘空间充足后重试。`);
      return;
    }
    logger.info(`导出未用完成：${zipPath}（${orphaned.length} 项${skipped > 0 ? `，排除目录跳过 ${skipped}` : ''}）`);
    toast.summary(
      `导出了 ${orphaned.length} 个未用附件至 ${zipPath}${skipped > 0 ? `（排除目录跳过 ${skipped}）` : ''}。`,
    );
  };

  if (confirmIfHeavy(app, est, orphaned, '待导出', execute)) return;
  await execute();
}