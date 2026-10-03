/**
 * 「开箱即用」契约——默认配置的守卫。
 *
 * 为什么要单独一套：默认值是**产品决策**，不是实现细节。它们决定了新用户装上插件后的
 * 第一印象——"能用"还是"按下去说能力已关闭"。而改一个默认值几乎不会让别的套件报警
 * （其他套件都在自己的夹具里显式设值），于是这些决策实际上处于无人看守的状态。
 *
 * 这里守三件事：
 * ① **13 条命令在默认配置下一条都不该报「能力已关闭」**——命令面板里能看到的命令，
 *    按下去必须真的干活，否则就是"开箱不可用"；
 * ② **扩展扫描默认开启**：HTML 写法与 markdown 图片是同一意图，不认它就会出现
 *    "我明明有图、跑完什么都没发生"；
 * ③ **笔记移动跟随默认开启**：笔记相对型目录下，"不跟随"等同于移动笔记即断链。
 *
 * 本套件刻意使用**与出厂默认完全一致的设置**（只关掉自动处理的定时器以避免测试期间
 * 后台轮询干扰断言——它是否默认为开，由下面的决策表直接断言）。
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
  VAULT_ROOT = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'iap-defaults-'));
});

afterAll(() => {
  nodeFs.rmSync(VAULT_ROOT, { recursive: true, force: true });
});

/** 出厂默认设置（只在测试期间关掉后台轮询，避免定时器打扰断言）。 */
function defaults(): PluginSettings {
  const s: PluginSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  s.automation.enabled = false;
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
  plugin.settings = defaults();
  obsidian._registry.notices = [];
}

const notices = (): string[] => obsidian._registry.notices.map((n) => n.message);

function command(id: string): () => void | Promise<void> {
  const found = handle.getCommands().find((c) => c.id === id);
  if (!found) throw new Error(`命令未注册: ${id}`);
  return found.callback;
}

async function waitFor(cond: () => boolean, ms = 4000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
}

const exists = (rel: string): boolean => nodeFs.existsSync(nodePath.join(VAULT_ROOT, rel));

/** 铺一个"什么都有"的小库：一条正文图片、一条外链、一个散落附件、一个孤儿。 */
function seedVault(): void {
  writeText(VAULT_ROOT, 'A.md', '# A\n\n![x](assets/a.png)\n\n![y](https://example.invalid/y.png)\n');
  writeBinary(VAULT_ROOT, 'A/assets/a.png', tinyImage());
  writeText(VAULT_ROOT, 'B.md', '# B\n\n![x](stray/b.png)\n');
  writeBinary(VAULT_ROOT, 'B/stray/b.png', tinyImage());
  writeText(VAULT_ROOT, 'orphans/README.md', '# 孤儿目录（附件无人引用）\n');
  writeBinary(VAULT_ROOT, 'orphans/lonely.png', tinyImage());
}

beforeEach(() => {
  obsidian = (globalThis as any).__OBSIDIAN_TEST;
  resetVault(VAULT_ROOT);
});

describe('开箱即用：出厂默认值的决策表', () => {
  it('关键开关的默认取值就是设计决策，改动必须是有意识的', () => {
    // 这张表把"有意为之"的默认值钉住。谁要改回去，测试先红，逼他重新想一遍——
    // 而不是像过去那样"顺手改了一个默认值，没人发现"。
    const d = DEFAULT_SETTINGS;
    // 能力总开关：装上就该都在
    expect({ naming: d.naming.enabled, localize: d.localize.enabled, consistency: d.consistency.enabled })
      .toEqual({ naming: true, localize: true, consistency: true });
    expect(d.cleanup.enabled).toBe(true);
    // 导出曾默认关闭 → 命令面板里按下去只得到"导出能力已关闭。"，属开箱不可用
    expect(d.exporter.enabled).toBe(true);
    // 自动化是插件的主打能力，默认开（两道防线各自守"不静默批量改写"）
    expect(d.automation.enabled).toBe(true);
    // 扩展扫描：不认 HTML/普通链接 = "我明明有图却没被处理"
    expect(d.localize.scanHtmlAndLinks).toBe(true);
    // 笔记相对型附件目录下，不跟随 = 移动笔记即断链
    expect(d.consistency.followNoteMove).toBe(true);
    // 安全性默认值不许被放松
    expect(d.localize.blockPrivateHosts).toBe(true);
    expect(d.cleanup.deleteMode).toBe('.trash');
    expect(d.cleanup.requireConfirm).toBe(true);
    // 通知默认「仅摘要」：既不吵，也不会静默掉失败（失败在任何档位都提示）
    expect(d.notificationLevel).toBe('summary');
  });
});

describe('开箱即用：默认配置下 13 条命令都不该"能力已关闭"', () => {
  it('逐条执行，任何一条都不出现「能力已关闭」', async () => {
    await boot();
    seedVault();
    handle.open('A.md');

    const ids = handle.getCommands().map((c) => c.id);
    expect(ids.length, '命令数量与预期不符').toBeGreaterThanOrEqual(13);

    for (const id of ids) {
      // 诊断日志开关不涉及能力门禁，跳过
      if (id.endsWith('toggle-debug-logging')) continue;
      obsidian._registry.notices = [];
      await command(id)();
      const msgs = notices().join('\n');
      expect(
        msgs,
        `默认配置下「${id}」报"能力已关闭"——命令面板里能按、按下去却不干活，就是开箱不可用`,
      ).not.toContain('能力已关闭');
    }
    // 这里要**串行**跑完 13 条命令。单跑约 0.8s，但全量并发时会被其它文件挤到
    // 超过默认的 5s（2026-10-01 实测：单跑 4/4 绿、全量超时判红）。
    // 超时是测试环境的资源竞争，不是被测行为的问题——给它一个宽松上限，
    // 免得这个"开箱即用"的主守卫变成一个随机报红的抖动源。
  }, 30000);
});

describe('开箱即用：扩展扫描默认认得 HTML 写法', () => {
  it('笔记里只有 <img src="data:…"> 时，默认配置也能把它落盘并改写', async () => {
    await boot();
    handle.open('H.md');
    // 只用 data: URI，不依赖网络；关键在于它是 **HTML 标签**写法——
    // 扩展扫描关闭时这段引用根本不会被认出来，命令会安静地什么都不做。
    const dataUri = `data:image/png;base64,${Buffer.from(tinyImage()).toString('base64')}`;
    writeText(VAULT_ROOT, 'H.md', `# H\n\n<img src="${dataUri}">\n`);

    await command('attachment:localize-note')();

    const localized = await waitFor(() => {
      const dir = nodePath.join(VAULT_ROOT, 'assets');
      if (!nodeFs.existsSync(dir)) return false;
      return nodeFs.readdirSync(dir).some((f) => f.endsWith('.png'));
    });
    expect(localized, '默认配置下 HTML 标签写法没被本地化——扩展扫描没生效').toBe(true);
    const text = nodeFs.readFileSync(nodePath.join(VAULT_ROOT, 'H.md'), 'utf8');
    expect(text, '引用未被改写为本地路径').not.toContain('data:image/png');
  });
});

describe('开箱即用：笔记移动时附件默认跟随', () => {
  it('把笔记移到别的目录，其相对附件目录一并迁移、引用仍可解析', async () => {
    await boot();
    writeText(VAULT_ROOT, 'A/n.md', '# n\n\n![x](assets/pic.png)\n');
    writeBinary(VAULT_ROOT, 'A/assets/pic.png', tinyImage());

    // 模拟用户在文件管理器里把笔记拖到 B/：真实改名 + 触发 host 的 rename 事件
    nodeFs.mkdirSync(nodePath.join(VAULT_ROOT, 'B'), { recursive: true });
    nodeFs.renameSync(nodePath.join(VAULT_ROOT, 'A/n.md'), nodePath.join(VAULT_ROOT, 'B/n.md'));
    handle.emitRename('B/n.md', 'A/n.md');

    expect(
      await waitFor(() => exists('B/assets/pic.png')),
      '笔记移动后附件没有跟随——笔记里的 ![](assets/pic.png) 已经断链',
    ).toBe(true);
    expect(exists('A/assets/pic.png'), '旧位置的附件没被迁走（留下了一份孤儿）').toBe(false);
    const text = nodeFs.readFileSync(nodePath.join(VAULT_ROOT, 'B/n.md'), 'utf8');
    // 引用与文件必须仍在同一处：相对写法 `assets/pic.png` 随笔记一起换了根，故内容不变即可
    expect(text, '引用被改成了别的东西，无法与新位置对应').toContain('assets/pic.png');
  });
});
