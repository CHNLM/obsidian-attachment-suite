/**
 * 「跟随 Obsidian 设置」的落盘位置专项。
 *
 * 为什么必须单独一套：`attachmentFolderMode` 的**默认值就是 `'obsidian'`**，即绝大多数用户
 * 走的是"读 Obsidian 的『附件默认存放路径』"这条路。而在此之前，测试替身把
 * `vault.getConfig('attachmentFolderPath')` 恒写成空串，于是这条路上唯一被执行的只有
 * 「读不到 → 回退到插件自定义目录」这一个分支：
 *
 * - 真实 Obsidian 的默认值是 `'/'`（＝**库根**，设置项写作 "Vault folder"），
 *   插件会据此把附件放到库根——**这一格从未被验证过**；
 * - `useMarkdownLinks` 同理恒为 false，markdown 链接风格的分支也从未被走到。
 *
 * 这里用注入式库配置（`TestAppOptions.vaultConfig`）逐格覆盖。夹具的
 * `TEST_SETTINGS` 已改为显式 `'custom'`（把位置钉死），与本文档分工不重叠。
 *
 * 断言一律落在"**文件实际落在哪**"上，而不是"解析出的目录字符串是什么"——
 * 前者才是用户可见的行为。
 */

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { buildTestApp, resetVault, writeText } from './infrastructure';
import type { TestAppHandle, ObsidianModule } from './infrastructure';
import { DEFAULT_SETTINGS, type PluginSettings } from '../../src/settings';
import '../mocks/obsidian-stub';

let VAULT_ROOT = '';
let server: http.Server;
let base = '';

beforeAll(async () => {
  (globalThis as any).window = globalThis;
  VAULT_ROOT = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'iap-vaultcfg-'));
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(PNG);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => {
  if (server) server.close();
  nodeFs.rmSync(VAULT_ROOT, { recursive: true, force: true });
});

let obsidian: ObsidianModule;
let handle: TestAppHandle;
let plugin: any;

/** 造一套"只关心落盘位置"的最小设置：关命名（免去 md5/序号干扰）、关内网拦截（外链是本机服务）。 */
function settings(patch: Partial<PluginSettings>): PluginSettings {
  const s: PluginSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  s.naming.enabled = false;
  s.localize.enabled = true;
  s.localize.useMd5ForNew = false; // 用 URL 尾段命名，路径可预测
  s.localize.blockPrivateHosts = false;
  s.localize.maxConcurrent = 1;
  s.automation.enabled = false;
  return { ...s, ...patch };
}

/** 起一个"笔记在 sub/ 下、正文含一条本机外链"的库，返回笔记路径。 */
function seedNote(rel = 'sub/Note.md'): string {
  writeText(VAULT_ROOT, rel, `# n\n\n![x](${base}/img.png)\n`);
  return rel;
}

async function boot(pluginSettings: PluginSettings, vaultConfig?: Record<string, unknown>): Promise<void> {
  obsidian._registry.notices = [];
  obsidian._registry.ctaClickCallbacks = [];
  obsidian._registry.ctaButtons = [];
  obsidian._registry.commands = [];
  obsidian._registry.modals = [];
  handle = buildTestApp(VAULT_ROOT, obsidian, vaultConfig ? { vaultConfig } : {});
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
  plugin.settings = pluginSettings;
}

function command(id: string): () => void | Promise<void> {
  const found = handle.getCommands().find((c: any) => c.id === id);
  if (!found) throw new Error(`命令未注册: ${id}`);
  return found.callback;
}

/** 库内所有受管图片（相对路径）。 */
function images(): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of nodeFs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === '.obsidian' || e.name === '.trash') continue;
        walk(nodePath.join(dir, e.name), r);
      } else if (/\.png$/i.test(e.name)) out.push(r);
    }
  };
  walk(VAULT_ROOT, '');
  return out.sort();
}

const read = (rel: string): string => nodeFs.readFileSync(nodePath.join(VAULT_ROOT, rel), 'utf8');

beforeEach(() => {
  obsidian = (globalThis as any).__OBSIDIAN_TEST;
  resetVault(VAULT_ROOT);
});

describe('附件目录来源 = 跟随 Obsidian 设置（默认模式）', () => {
  /**
   * 逐格断言"附件实际落在哪"。每格期望值互不相同——若注入没生效，这些格子会一起指向
   * 同一个位置，测试立刻暴露（这也是为什么期望值必须写死而不是"取实际值再比对"）。
   */
  const cases: Array<{ name: string; cfg?: Record<string, unknown>; expected: string }> = [
    // Obsidian 的默认值就是 '/'，含义是**库根**（UI 写作 "Vault folder"）
    { name: "attachmentFolderPath='/'（Obsidian 默认）→ 库根", cfg: { attachmentFolderPath: '/' }, expected: 'img.png' },
    { name: "attachmentFolderPath='./assets' → 笔记同级 assets/", cfg: { attachmentFolderPath: './assets' }, expected: 'sub/assets/img.png' },
    { name: "attachmentFolderPath='assets'（裸名）→ 库根 assets/", cfg: { attachmentFolderPath: 'assets' }, expected: 'assets/img.png' },
    { name: "attachmentFolderPath='.' → 紧邻笔记", cfg: { attachmentFolderPath: '.' }, expected: 'sub/img.png' },
    { name: "attachmentFolderPath='/assets' → 库根 assets/", cfg: { attachmentFolderPath: '/assets' }, expected: 'assets/img.png' },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const notePath = seedNote();
      await boot(settings({ attachmentFolderMode: 'obsidian' }), c.cfg);
      handle.open(notePath);
      await command('attachment:localize-note')();

      const found = images();
      expect(found, `附件落点与预期不符（实际：${found.join(', ') || '无'}）`).toEqual([c.expected]);
      // 引用必须指向刚落盘的那份，且不再含外链
      expect(read(notePath)).not.toContain(base);
      expect(read(notePath)).toContain(c.expected);
    });
  }

  it('库配置里没有该键时回退到插件自定义目录（明确锁住回退契约）', async () => {
    const notePath = seedNote();
    await boot(settings({ attachmentFolderMode: 'obsidian', attachmentFolder: './fallback' }), {});
    handle.open(notePath);
    await command('attachment:localize-note')();

    expect(images()).toEqual(['sub/fallback/img.png']);
  });

  it('自定义目录模式忽略 Obsidian 的库配置', async () => {
    const notePath = seedNote();
    // 库配置说"库根"，但模式是自定义 → 必须以自定义为准
    await boot(settings({ attachmentFolderMode: 'custom', attachmentFolder: './mine' }), { attachmentFolderPath: '/' });
    handle.open(notePath);
    await command('attachment:localize-note')();

    expect(images()).toEqual(['sub/mine/img.png']);
  });
});

describe('链接风格 = Obsidian 的 useMarkdownLinks', () => {
  it('关闭（默认）→ 产出 wiki 嵌入 ![[path|alt]]', async () => {
    const notePath = seedNote();
    await boot(settings({ attachmentFolderMode: 'obsidian', attachmentFolder: './assets' }), { attachmentFolderPath: './assets' });
    handle.open(notePath);
    await command('attachment:localize-note')();

    expect(read(notePath)).toContain('![[sub/assets/img.png|x]]');
  });

  it('开启 → 产出 markdown 图片 ![alt](path)', async () => {
    const notePath = seedNote();
    await boot(
      settings({ attachmentFolderMode: 'obsidian', attachmentFolder: './assets' }),
      { attachmentFolderPath: './assets', useMarkdownLinks: true },
    );
    handle.open(notePath);
    await command('attachment:localize-note')();

    const text = read(notePath);
    expect(text).toContain('![x](sub/assets/img.png)');
    expect(text, '开启 markdown 链接后不该再产出 wiki 嵌入').not.toContain('![[');
  });

  it('带标题的外链：本地化后标题段必须原样保留', async () => {
    // 旧实现按空白截断目标，`![x](url "标题")` 因"目标后面接不到 `)`"整条匹配失败，
    // 这类外链**永远不会被本地化**（笔记脱不了机）。修复后整体捕获 + 复用 parseMdTarget。
    const notePath = 'sub/Titled.md';
    writeText(VAULT_ROOT, notePath, `# t\n\n![图注](${base}/img.png "我的图注")\n`);
    await boot(
      settings({ attachmentFolderMode: 'obsidian', attachmentFolder: './assets' }),
      { attachmentFolderPath: './assets', useMarkdownLinks: true },
    );
    handle.open(notePath);
    await command('attachment:localize-note')();

    const text = read(notePath);
    expect(text, '外链没被本地化（带标题的图片被整条漏掉）').not.toContain(base);
    expect(text, '标题段被吃掉了').toContain('"我的图注"');
    expect(text).toMatch(/!\[图注\]\(sub\/assets\/img\.png\s+"我的图注"\)/);
    expect(images()).toContain('sub/assets/img.png');
  });
});
