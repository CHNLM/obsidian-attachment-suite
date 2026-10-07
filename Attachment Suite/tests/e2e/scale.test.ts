/**
 * 规模探针：大库下的索引构建与全库命令耗时基线（B34）。
 * 目的：把"能否在真实大库上稳定运行"量化出来，并在回归时发现性能劣化。
 * 断言用宽松上限（防误报失败），真实耗时通过 [scale] 日志输出供人工比对。
 */

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { buildTestApp, writeText, writeBinary, tinyImage } from './infrastructure';
import type { TestAppHandle, ObsidianModule } from './infrastructure';
import { planBulkRename } from '../../src/features/bulk-rename-core';
import '../mocks/obsidian-stub';

const NOTES = 60;
const PER_NOTE = 3;
const ORPHANS = 20;

let VAULT_ROOT = '';

beforeAll(() => {
  (globalThis as any).window = globalThis;
  VAULT_ROOT = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'iap-scale-'));
});

afterAll(() => {
  nodeFs.rmSync(VAULT_ROOT, { recursive: true, force: true });
});

const SCALE_SETTINGS: any = {
  version: 1,
  attachmentFolder: './assets',
  attachmentFolderMode: 'obsidian',
  naming: {
    enabled: true,
    connector: '_',
    addTime: false,
    addPathHash: false,
    honorCategory: true,
    showSubType: false,
    folderByCategory: false,
    categoryWords: { image: 'image', video: 'video', audio: 'audio', pdf: 'pdf', document: 'document', webpage: 'webpage', misc: 'misc' },
  },
  localize: {
    enabled: true,
    localizeWebUrls: true,
    allowedCategories: ['image', 'video', 'audio', 'pdf', 'document', 'misc'],
    scanHtmlAndLinks: false,
    useMd5ForNew: true,
    minSizeKb: 0,
    tryCount: 1,
    timeoutMs: 2000,
    blockPrivateHosts: false,
    maxDownloadMb: 100,
    allowHosts: [],
    denyHosts: [],
    hostAllowlistOnly: false,
    perHostIntervalMs: 0,
    maxConcurrent: 1,
  },
  consistency: {
    enabled: true,
    reportBrokenLinks: true,
    repairIncompatiblePaths: true,
    platforms: ['windows'],
    followNoteMove: false,
    fuzzySuggest: true,
    fuzzyThreshold: 0.6,
    fuzzyTopN: 5,
  },
  cleanup: { enabled: true, deleteMode: '.trash', excludedFolders: [], excludeSubfolders: false, requireConfirm: true },
  exporter: { enabled: true },
  automation: { enabled: false, interval: 5 },
  paths: { exclude: [] },
  notificationLevel: 'silent',
};

async function buildPlugin(): Promise<{ handle: TestAppHandle; plugin: any }> {
  const obsidian: ObsidianModule = (globalThis as any).__OBSIDIAN_TEST;
  obsidian._registry.notices = [];
  obsidian._registry.ctaClickCallbacks = [];
  obsidian._registry.commands = [];
  obsidian._registry.modals = [];
  const handle = buildTestApp(VAULT_ROOT, obsidian);
  const { default: PluginClass } = await import('../../src/main');
  const plugin: any = new PluginClass(handle.app, {
    id: 'attachment-suite',
    name: 'Attachment Suite',
    version: '1.0.0',
    minAppVersion: '1.6.7',
    description: 'test',
    author: 'test',
    isDesktopOnly: true,
  });
  await plugin.onload();
  plugin.settings = JSON.parse(JSON.stringify(SCALE_SETTINGS));
  return { handle, plugin };
}

/** 生成大库：NOTES 篇笔记 × PER_NOTE 个独占附件 + ORPHANS 个孤儿。 */
function seedLarge(): { attachments: number } {
  for (let i = 0; i < NOTES; i++) {
    const dir = i % 7 === 0 ? `folder${i % 5}/deep` : `folder${i % 5}`;
    const links: string[] = [];
    for (let j = 0; j < PER_NOTE; j++) {
      const name = `${dir}/a${i}_${j}.png`;
      writeBinary(VAULT_ROOT, name, tinyImage('png'));
      links.push(`![x](${name})`);
    }
    writeText(VAULT_ROOT, `${dir}/note${i}.md`, ['# n', '', ...links, ''].join('\n'));
  }
  for (let k = 0; k < ORPHANS; k++) writeBinary(VAULT_ROOT, `folder0/orphan${k}.png`, tinyImage('png'));
  return { attachments: NOTES * PER_NOTE };
}

function listAll(): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of nodeFs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(nodePath.join(dir, e.name), r);
      else out.push(r);
    }
  };
  walk(VAULT_ROOT, '');
  return out.filter((f) => !f.startsWith('.obsidian') && !f.startsWith('.trash')).sort();
}

/** 触发最后一个弹窗的确认回调；返回是否真的存在该回调。 */
async function confirmLastModal(handle: TestAppHandle): Promise<boolean> {
  const opts = handle.app._modals[handle.app._modals.length - 1]?.opts;
  if (opts && typeof opts.onConfirm === 'function') {
    await opts.onConfirm();
    return true;
  }
  return false;
}

describe('规模探针', () => {
  it('大库下索引构建、审计与全库命名可完成，且第二遍无可处理项（幂等）', async () => {
    const { handle, plugin } = await buildPlugin();
    const { attachments } = seedLarge();

    const t0 = Date.now();
    const snap = await plugin.index.build();
    const buildMs = Date.now() - t0;
    console.log(
      `[scale] index.build(): ${buildMs}ms · 条目 ${snap.entries.size} · 笔记 ${NOTES} · 附件 ${attachments} · 断链 ${snap.brokenRefs.length} · 孤儿 ${snap.orphanCandidates.length}`,
    );
    expect(snap.entries.size).toBeGreaterThanOrEqual(attachments);
    expect(snap.orphanCandidates.length).toBeGreaterThanOrEqual(ORPHANS);
    expect(buildMs).toBeLessThan(20000);

    const t1 = Date.now();
    await handle.getCommands().find((c: any) => c.id === 'attachment:check-consistency')!.callback();
    const auditMs = Date.now() - t1;
    console.log(`[scale] 一致性审计: ${auditMs}ms`);
    expect(auditMs).toBeLessThan(20000);

    // 全库命名第 1 遍（真实改名）
    const t2 = Date.now();
    await handle.getCommands().find((c: any) => c.id === 'attachment:bulk-rename')!.callback();
    const confirmed = await confirmLastModal(handle);
    expect(confirmed).toBe(true);
    const renameMs = Date.now() - t2;
    const listAfterFirst = listAll();
    console.log(`[scale] 全库命名第 1 遍: ${renameMs}ms · 文件数 ${listAfterFirst.length}`);
    expect(renameMs).toBeLessThan(60000);
    expect(listAfterFirst.some((f) => f.includes('_image_001'))).toBe(true);

    // 幂等：第 2 遍规划应为 0 项 → 命令不弹预览、文件集合不变
    const snap2 = await plugin.index.getSnapshot();
    expect(planBulkRename(snap2, plugin.settings.naming).total).toBe(0);

    const modalsBefore = handle.app._modals.length;
    const t3 = Date.now();
    await handle.getCommands().find((c: any) => c.id === 'attachment:bulk-rename')!.callback();
    const plan2Ms = Date.now() - t3;
    const modalOpened = handle.app._modals.length !== modalsBefore;
    console.log(`[scale] 全库命名第 2 遍: ${plan2Ms}ms · 是否弹预览 ${modalOpened}`);
    expect(modalOpened, '第二遍应无可重命名项，不应弹预览').toBe(false);
    expect(listAll()).toEqual(listAfterFirst);
  }, 180000);
});
