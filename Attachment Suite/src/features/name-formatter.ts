/** 统一命名模块：执行入口。纯计算见 name-formatter-core。 */

import { TFile, type App } from 'obsidian';
import type { AttachmentIndex, AttachmentIndexSnapshot, SafeMoveEngine } from '../core';
import type { PluginSettings } from '../settings';
import { resolveAttachmentDirForNote } from '../obsidian-domain';
import { createNoticer } from '../notify';
import { ConfirmChangesModal } from '../modals';
import { planForSnapshot } from './name-formatter-core';
import { refMapForMoves, rewriteRefsInNote } from './link-fixer';

export * from './name-formatter-core';

export interface RunSummary {
  moved: number;
  errors: number;
  /** 成功复制（共享附件副本）数。 */
  copied?: number;
  /** 复制失败的共享附件数。 */
  copyFailed?: number;
}

/**
 * 重命名指定笔记的附件并执行。`confirm=true` 时先弹预览确认。
 * @param notePath 显式指定笔记路径（自动化后台用，不依赖当前活动笔记）；省略回退当前打开的笔记。
 * @param snapshot 可选注入的索引快照（全库批量场景复用单次构建，避免逐篇重建全库索引）；省略则强制重建。
 * @param notify 是否逐篇弹通知；全库批量场景传 false 交由调用方统一汇总。
 */
export async function runRenameNote(
  app: App,
  index: AttachmentIndex,
  getSettings: () => PluginSettings,
  mover: SafeMoveEngine,
  confirm = true,
  notePath?: string,
  snapshot?: AttachmentIndexSnapshot,
  notify = true,
): Promise<RunSummary> {
  const toast = createNoticer(() => getSettings().notificationLevel);
  const note = notePath
    ? (app.vault.getAbstractFileByPath(notePath) as TFile | null)
    : (app.workspace.getActiveFile() as TFile | null);
  if (!note || !(note instanceof TFile)) {
    if (!notePath && notify) toast.error('请先打开一个笔记。');
    return { moved: 0, errors: 0 };
  }
  const naming = getSettings().naming;
  if (!naming.enabled) {
    if (notify) toast.summary('命名能力已关闭。');
    return { moved: 0, errors: 0 };
  }
  // 默认强制重建索引，避免读到期旧快照；传入 snapshot 时复用（全库批量优化，R1）
  const snapshotUsed = snapshot ?? (await index.build());
  // 按类别子目录时，以笔记归属附件目录为根
  const baseDir = naming.folderByCategory ? resolveAttachmentDirForNote(app, getSettings(), note) : '';
  const items = planForSnapshot(snapshotUsed, note.path, note.basename, naming, naming.folderByCategory, baseDir);
  if (items.length === 0) {
    if (notify) toast.summary('没有需要重命名的附件。');
    return { moved: 0, errors: 0 };
  }

  // 统计每个附件的归属笔记数。被多篇笔记引用的附件，采用「复制副本再命名」，
  // 不让单篇笔记的命名约定强加到共享文件上（参照 ANF 的 oneInMany:Copy）。
  const ownerCount = new Map<string, number>();
  for (const e of snapshotUsed.entries.values()) {
    const owners = new Set(e.references.map((r) => r.sourcePath));
    ownerCount.set(e.path, owners.size);
  }
  const renameItems = items.filter((i) => (ownerCount.get(i.from) ?? 1) <= 1);
  const copyItems = items.filter((i) => (ownerCount.get(i.from) ?? 1) > 1);

  const execute = async (): Promise<{ renamed: number; copied: number; copyFailed: number; fail: number }> => {
    let copied = 0;
    let copyFailed = 0;
    const map = new Map<string, string>();

    // 1) 独占附件 → 直接改名（Obsidian 联动改写全库链接）
    const out = await mover.moveMany(renameItems.map((i) => ({ from: i.from, to: i.to })));
    for (const r of refMapForMoves(out.results)) map.set(r[0], r[1]);

    // 2) 共享附件 → 复制一份并按当前笔记规范命名，只改写当前笔记，原文件不动
    for (const ci of copyItems) {
      const target = await uniqueCopyTarget(app, ci.to);
      if (await copyFileTo(app, ci.from, target)) {
        map.set(ci.from, target);
        map.set(basenameOf(ci.from), target);
        copied++;
      } else {
        copyFailed++;
      }
    }
    // 兜底：Obsidian 对当前打开的笔记可能不自动改写嵌入链接，这里幂等改写一次
    await rewriteRefsInNote(app, note.path, map);
    index.markDirty();
    if (notify) {
      toast.summary(`命名完成：重命名 ${out.results.length}，复制 ${copied}，失败 ${out.errors.length}${copyFailed ? `（复制失败 ${copyFailed}）` : ''}。`);
    }
    return { renamed: out.results.length, copied, copyFailed, fail: out.errors.length };
  };

  if (confirm) {
    new ConfirmChangesModal(app, {
      title: '重命名当前笔记附件',
      desc: '将按「笔记_类别_序号」规范命名以下附件；被多篇笔记共用的附件会复制副本再命名，Obsidian 自动更新链接。',
      rows: items.map((i) => ({ from: i.from, to: i.to })),
      confirmText: `确认重命名（${items.length}）`,
      onConfirm: async () => {
        await execute();
      },
    }).open();
    return { moved: 0, errors: 0 };
  }

  const r = await execute();
  return { moved: r.renamed, errors: r.fail + r.copyFailed, copied: r.copied, copyFailed: r.copyFailed };
}

function basenameOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

/** 目标被占用时返回 `名 (1).ext` 等不冲突路径。 */
async function uniqueCopyTarget(app: App, desired: string): Promise<string> {
  if (!(await app.vault.adapter.exists(desired))) return desired;
  const dot = desired.lastIndexOf('.');
  const slash = desired.lastIndexOf('/');
  if (dot <= slash) {
    let i = 1;
    let c = `${desired} (${i})`;
    while (await app.vault.adapter.exists(c)) c = `${desired} (${++i})`;
    return c;
  }
  const stem = desired.slice(0, dot);
  const ext = desired.slice(dot);
  let i = 1;
  let c = `${stem} (${i})${ext}`;
  while (await app.vault.adapter.exists(c)) c = `${stem} (${++i})${ext}`;
  return c;
}

/** 复制附件字节到目标路径；成功返回 true。 */
async function copyFileTo(app: App, from: string, to: string): Promise<boolean> {
  try {
    const f = app.vault.getAbstractFileByPath(from);
    if (!(f instanceof TFile)) return false;
    const buf = await app.vault.readBinary(f); // ArrayBuffer
    const bytes = new Uint8Array(buf);
    await app.vault.createBinary(to, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    return true;
  } catch {
    return false;
  }
}