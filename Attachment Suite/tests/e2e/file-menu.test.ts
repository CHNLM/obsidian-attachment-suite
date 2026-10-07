/**
 * 文件右键菜单入口契约。
 *
 * 为什么单独一套：这是"对某一篇笔记执行"的**第二条入口**（第一条是命令面板）。
 * 它有两条必须钉住的性质，而这两条都属于"改坏了别的套件不会报警"的那一类：
 *
 * ① **目标必须是「被右键的那一篇」**——右键的笔记不一定正打开着。若误用
 *    `getActiveFile()`（其余三个笔记级命令的内部默认行为就是这样），就会出现
 *    "右键 A、却改了 B"。所以每个用例都刻意让**活动笔记也有同样的东西可动**，
 *    使"误用活动笔记"留下可观测的痕迹（负对照）。
 * ② **名字与实现必须与命令面板同源**。本仓库已因"同一件事两份实现、后来只改一份"
 *    栽过 6 次，而"给已有命令再挂一个入口"正是最容易长出第二份实现的地方。
 */

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { buildTestApp, resetVault, tinyImage, writeBinary, writeText } from './infrastructure';
import type { TestAppHandle, ObsidianModule } from './infrastructure';
import { DEFAULT_SETTINGS, type PluginSettings } from '../../src/settings';
import '../mocks/obsidian-stub';

let VAULT_ROOT = '';
let obsidian: ObsidianModule;
let handle: TestAppHandle;
let plugin: any;

beforeAll(() => {
  (globalThis as any).window = globalThis;
  VAULT_ROOT = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'iap-filemenu-'));
});

afterAll(() => {
  nodeFs.rmSync(VAULT_ROOT, { recursive: true, force: true });
});

function settings(): PluginSettings {
  const s: PluginSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  s.automation.enabled = false;
  s.notificationLevel = 'summary';
  return s;
}

async function boot(): Promise<void> {
  obsidian._registry.notices = [];
  obsidian._registry.commands = [];
  obsidian._registry.modals = [];
  obsidian._registry.ctaClickCallbacks = [];
  handle = buildTestApp(VAULT_ROOT, obsidian);
  const { default: PluginClass } = await import('../../src/main');
  plugin = new PluginClass(handle.app, {
    id: 'attachment-suite',
    name: 'Attachment Suite',
    version: '1.0.0',
    minAppVersion: '1.6.7',
    description: 'test',
    author: 'test',
    isDesktopOnly: true,
  });
  await plugin.onload();
  plugin.settings = settings();
  // 丢掉 onload 那条"已加载"横幅，只看点击菜单项产生的
  obsidian._registry.notices = [];
}

/** 打开 relPath 的右键菜单，返回菜单替身。 */
function openFileMenu(relPath: string): any {
  const handlers = handle.getEventHandlers()['file-menu'];
  expect(handlers?.size, '插件没有注册 file-menu 处理器（右键菜单根本没挂上）').toBeGreaterThan(0);
  const file = handle.app.vault.getAbstractFileByPath(relPath);
  expect(file, `夹具里缺少 ${relPath}`).toBeTruthy();
  const menu = new (obsidian as any).Menu();
  for (const h of handlers) h(menu, file);
  return menu;
}

const entries = (menu: any): any[] => menu.items.filter((i: any) => !i.separator);
const titles = (menu: any): string[] => entries(menu).map((i: any) => i.title);
const itemNamed = (menu: any, title: string): any => entries(menu).find((i: any) => i.title === title);

/**
 * 菜单点击是"即发即忘"（Obsidian 的 `onClick` 返回 void，插件也只能 `void runForNote(...)`），
 * 所以这里轮询等副作用落盘——真实宿主里点完也是异步的。
 */
async function waitFor(cond: () => boolean, ms = 4000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
}

const exists = (rel: string): boolean => nodeFs.existsSync(nodePath.join(VAULT_ROOT, rel));

/** 本次启动以来打开过的弹窗（破坏性命令会先弹确认框，计划就在里面）。 */
const modals = (): any[] => (handle.app as any)._modals ?? [];

beforeEach(() => {
  obsidian = (globalThis as any).__OBSIDIAN_TEST;
  resetVault(VAULT_ROOT);
});

describe('文件菜单：只对笔记出现，且与命令面板同源', () => {
  it('右键笔记时追加四条笔记级命令，名字与命令面板完全一致', async () => {
    await boot();
    writeText(VAULT_ROOT, 'A.md', '# a\n');
    const menu = openFileMenu('A.md');

    const commandNames = handle.getCommands().map((c) => c.name);
    const got = titles(menu);
    expect(got.length, '右键笔记没有出现任何笔记级入口').toBeGreaterThan(0);
    for (const t of got) {
      expect(
        commandNames,
        `菜单项「${t}」在命令面板里找不到同名命令——两个入口的文案已经分叉`,
      ).toContain(t);
    }
    expect(got).toContain('收集当前笔记附件到归属目录');
    expect(got).toContain('重命名当前笔记附件');
    expect(got).toContain('本地化当前笔记附件');
    expect(got).toContain('导出当前笔记附件（zip）');
  });

  it('canvas 也是笔记，同样出现', async () => {
    await boot();
    writeText(VAULT_ROOT, 'x.canvas', '{"nodes":[],"edges":[]}');
    expect(titles(openFileMenu('x.canvas')).length).toBeGreaterThan(0);
  });

  it('右键附件（非笔记）时一条都不出现', async () => {
    await boot();
    writeBinary(VAULT_ROOT, 'assets/a.png', tinyImage());
    expect(titles(openFileMenu('assets/a.png'))).toEqual([]);
  });

  it('每个菜单项都真的挂了点击回调（空实现会让"挂上了却点了没反应"照样绿）', async () => {
    await boot();
    writeText(VAULT_ROOT, 'A.md', '# a\n');
    const items = entries(openFileMenu('A.md'));
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(typeof it.click, `菜单项「${it.title}」没有点击回调`).toBe('function');
    }
  });
});

describe('文件菜单：目标必须是「被右键的那一篇」，而不是当前打开的', () => {
  it('活动笔记 A、右键 B：导出落在 B 上，A 完全不受影响', async () => {
    await boot();
    plugin.settings.exporter.enabled = true;
    // 两篇都带附件——万一误用了 getActiveFile()，A 那边会留下可观测的导出包
    writeText(VAULT_ROOT, 'A.md', '# A\n\n![x](assets/a.png)\n');
    writeBinary(VAULT_ROOT, 'assets/a.png', tinyImage());
    writeText(VAULT_ROOT, 'B.md', '# B\n\n![x](assets/b.png)\n');
    writeBinary(VAULT_ROOT, 'assets/b.png', tinyImage());
    handle.open('A.md');

    const item = itemNamed(openFileMenu('B.md'), '导出当前笔记附件（zip）');
    expect(item, '菜单里没有「导出当前笔记附件（zip）」').toBeTruthy();
    item.click();

    expect(await waitFor(() => exists('B_Attachments.zip')), '右键 B 却没有生成 B 的导出包').toBe(true);
    expect(exists('A_Attachments.zip'), '导出的目标是活动笔记 A —— 右键 B 却动了 A').toBe(false);
  });

  it('活动笔记 A、右键 B：收集的计划指向 B，A 的附件不被碰', async () => {
    await boot();
    // 两篇各有一个"散落在子目录里"的附件，路径结构对称、文件名不同。
    // ⚠️ 名字必须不同：索引按 basename 解析，同名会被判成"被多篇笔记共用"而按设计跳过收集
    // （第一版就是这么写的，于是 collect 报 skippedShared:1 —— 夹具前提与 expect 对不上）。
    writeText(VAULT_ROOT, 'A/nA.md', '# A\n\n![x](stray/a.png)\n');
    writeBinary(VAULT_ROOT, 'A/stray/a.png', tinyImage());
    writeText(VAULT_ROOT, 'B/nB.md', '# B\n\n![x](stray/b.png)\n');
    writeBinary(VAULT_ROOT, 'B/stray/b.png', tinyImage());
    handle.open('A/nA.md');

    const item = itemNamed(openFileMenu('B/nB.md'), '收集当前笔记附件到归属目录');
    expect(item, '菜单里没有「收集当前笔记附件到归属目录」').toBeTruthy();
    item.click();

    // 「收集」是破坏性操作，会先弹确认框——计划本身就是"目标是谁"的直接证据
    await waitFor(() => modals().length > 0);
    const modal: any = modals()[modals().length - 1];
    expect(modal, '收集没有弹出确认框').toBeTruthy();
    const plan: string = (modal.opts?.rows ?? []).map((r: any) => `${r.from} → ${r.to}`).join('\n');
    expect(plan, '确认框里的计划不是被右键那篇的附件').toContain('B/stray/b.png → B/assets/b.png');
    expect(plan, '确认框里混进了活动笔记 A 的附件').not.toContain('A/');

    // 再真正点「确认」，确认副作用也落在 B 上
    const confirm = obsidian._registry.ctaClickCallbacks[obsidian._registry.ctaClickCallbacks.length - 1];
    expect(typeof confirm, '确认框里没有可点击的确认按钮').toBe('function');
    confirm();

    expect(await waitFor(() => exists('B/assets/b.png')), '确认后 B 的散落附件没有被收进 B/assets').toBe(true);
    expect(exists('A/assets/a.png'), '收集的目标是活动笔记 A —— 右键 B 却动了 A').toBe(false);
    expect(exists('A/stray/a.png'), '活动笔记 A 的附件被顺手挪走了').toBe(true);
  });
});

describe('文件菜单：随插件卸载一起回收', () => {
  it('卸载清理后不再向菜单追加（防重载插件后条目越叠越多）', async () => {
    await boot();
    writeText(VAULT_ROOT, 'A.md', '# a\n');
    expect(titles(openFileMenu('A.md')).length).toBeGreaterThan(0);

    handle.runPluginCleanups();

    expect(
      handle.getEventHandlers()['file-menu']?.size ?? 0,
      '卸载后 file-menu 处理器仍在——重载插件会让菜单项叠加',
    ).toBe(0);
  });
});
