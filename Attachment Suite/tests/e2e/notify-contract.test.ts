/**
 * 失败可见性契约（原 P1 遗留：`errors > 0` 的路径在所有套件里都跑不到）。
 *
 * 为什么单独一套：本插件最不能静默的信息就是"失败"——它意味着文件状态与用户预期不一致，
 * 而历史缺陷恰好都出在"失败被吞"（命令抛错无人接、弹窗回调异常被丢弃、排队任务 rejection 无人处理）。
 * 承诺写在三处：`notify.ts` 的 `reportFailures`、`commands.ts` 的 `traceCommand` catch、
 * `main.ts` 的 `reportBackgroundError`——但此前**没有任何用例进入 `errors > 0` 的世界**。
 *
 * 断言口径：不用 level（真实 `Notice` 没有这个信息），而是断言"静默档下是否出现了提示"这一
 * 可观测事实，并**必配对照组**——否则"任何情况都狂弹"的实现也能通过。
 */

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import { buildTestApp, resetVault, tinyImage, writeBinary, writeText } from './infrastructure';
import type { TestAppHandle, ObsidianModule } from './infrastructure';
import { DEFAULT_SETTINGS, type PluginSettings } from '../../src/settings';
import '../mocks/obsidian-stub';

let VAULT_ROOT = '';
let httpBase = '';
let server: http.Server;

beforeAll(async () => {
  (globalThis as any).window = globalThis;
  VAULT_ROOT = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'iap-notify-'));
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(PNG);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  httpBase = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => {
  if (server) server.close();
  nodeFs.rmSync(VAULT_ROOT, { recursive: true, force: true });
});

let obsidian: ObsidianModule;
let handle: TestAppHandle;
let plugin: any;

function settingsFor(level: PluginSettings['notificationLevel']): PluginSettings {
  const s: PluginSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  s.naming.enabled = false;
  s.localize.enabled = true;
  s.localize.useMd5ForNew = false;
  s.localize.blockPrivateHosts = false;
  s.localize.tryCount = 1;
  s.localize.timeoutMs = 2000;
  s.automation.enabled = false;
  s.notificationLevel = level;
  return s;
}

async function boot(level: PluginSettings['notificationLevel']): Promise<void> {
  obsidian._registry.notices = [];
  obsidian._registry.ctaClickCallbacks = [];
  obsidian._registry.ctaButtons = [];
  obsidian._registry.commands = [];
  obsidian._registry.modals = [];
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
  plugin.settings = settingsFor(level);
  obsidian._registry.notices = []; // 丢掉 onload 的"已加载"提示，只观察命令产生的
}

const notices = (): string[] => obsidian._registry.notices.map((n) => n.message);

function command(id: string): () => void | Promise<void> {
  const found = handle.getCommands().find((c: any) => c.id === id);
  if (!found) throw new Error(`命令未注册: ${id}`);
  return found.callback;
}

beforeEach(() => {
  obsidian = (globalThis as any).__OBSIDIAN_TEST;
  resetVault(VAULT_ROOT);
});

describe('静默档（notificationLevel = silent）的契约', () => {
  it('附件写盘失败必须仍然可见（不得被静默吞掉）', async () => {
    await boot('silent');
    writeText(VAULT_ROOT, 'F.md', `# f\n\n![x](${httpBase}/a.png)\n`);
    handle.open('F.md');

    const orig = handle.app.vault.createBinary;
    handle.app.vault.createBinary = async () => {
      throw new Error('EACCES: 库目录只读');
    };
    try {
      await command('attachment:localize-note')();
    } finally {
      handle.app.vault.createBinary = orig;
    }

    const msgs = notices().join('\n');
    expect(msgs, '静默档把"写盘失败"吞了——这是最不能静默的一类信息').toMatch(/失败/);
  });

  it('失败提示承诺「详情见开发者控制台」——控制台里必须真有原因', async () => {
    // 2026-09-28 真实宿主实测：`收集当前笔记附件` 报「失败 2 项」，提示还写着
    // 「详情见开发者控制台（Ctrl/Cmd+Shift+I）」，而控制台里**一条原因也没有**——
    // `MoveError.message`（"源文件不存在"/"改名失败 …"）被构造出来后直接丢弃。
    // 这条用例把"承诺必须为真"钉死：不仅要提示，还要能在日志里找到原因。
    await boot('silent');
    plugin.settings.naming.enabled = true;
    writeText(VAULT_ROOT, 'P.md', '# p\n\n![[assets/pic.png]]\n');
    writeBinary(VAULT_ROOT, 'assets/pic.png', tinyImage('png'));
    handle.open('P.md');

    const logged: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      logged.push(a.map((x) => String(x)).join(' '));
    });
    const orig = handle.app.fileManager.renameFile;
    handle.app.fileManager.renameFile = async () => {
      throw new Error('EBUSY: 目标被其它进程占用');
    };
    try {
      await command('attachment:rename-note')();
      const modals = (handle.app as any)._modals;
      const opts = modals[modals.length - 1]?.opts;
      expect(opts?.onConfirm, 'rename-note 未打开确认弹窗，用例前提不成立').toBeTypeOf('function');
      await opts.onConfirm();
    } finally {
      handle.app.fileManager.renameFile = orig;
      spy.mockRestore();
    }

    expect(notices().join('\n'), '静默档下失败没有提示给用户').toMatch(/命名失败/);
    const logs = logged.join('\n');
    expect(logs, '提示写着「详情见开发者控制台」，控制台里却没有原因——这句承诺是假的').toMatch(/命名失败：/);
    expect(logs, '日志里没有可行动的失败原因（应含底层错误消息）').toMatch(/EBUSY/);
  });

  it('对照组：静默档下纯成功不得产生任何提示', async () => {
    // 只测"失败有提示"是不够的：一个"什么情况都狂弹"的实现也能过。
    // 这一条才把"静默"这个档位的语义钉死。
    await boot('silent');
    writeText(VAULT_ROOT, 'OK.md', `# ok\n\n![x](${httpBase}/b.png)\n`);
    handle.open('OK.md');

    await command('attachment:localize-note')();

    expect(notices(), `静默档下成功也弹了提示：${notices().join(' | ')}`).toEqual([]);
  });

  it('命令级异常：任何档位下都必须报出「执行失败」', async () => {
    await boot('silent');
    writeText(VAULT_ROOT, 'X.md', '# x\n');
    handle.open('X.md');

    const orig = handle.app.vault.getFiles;
    handle.app.vault.getFiles = () => {
      throw new Error('boom：索引无法读取');
    };
    try {
      await command('attachment:cleanup-unused')();
    } finally {
      handle.app.vault.getFiles = orig;
    }

    const msgs = notices().join('\n');
    expect(msgs, '命令抛错后用户什么都没看到（点完命令一片安静，却可能已改过文件）').toMatch(/执行失败/);
  });

  it('「删除前确认」关闭 + 静默档：清理结果仍必须出现一次', async () => {
    // 两个"降低可见性"的设置叠加是最危险的组合：静默 + 无确认 = 无人知晓的删除。
    // 设置页对用户明确承诺：这种情况下结果仍会提示一次。
    await boot('silent');
    plugin.settings.cleanup.requireConfirm = false;
    writeText(VAULT_ROOT, 'N.md', '# n\n');
    // 必须真的有一个孤儿，否则清理会走"没有未用的附件"早退分支——那条分支本就不该提示
    writeBinary(VAULT_ROOT, 'assets/real-orphan.png', tinyImage('png'));
    handle.open('N.md');

    await command('attachment:cleanup-unused')();

    expect(notices().join('\n'), '静默 + 关闭确认 叠加后删除完全无提示').toMatch(/清理/);
    expect(nodeFs.existsSync(nodePath.join(VAULT_ROOT, 'assets/real-orphan.png')), '前提不成立：孤儿没被删').toBe(false);
  });
});

describe('诊断日志开关（命令式；与设置页同一状态、会持久化）', () => {
  it('打开后必须真有新的输出，关闭后恢复——否则就是"承诺了却不生效"', async () => {
    // 为什么必须是这条断言：把日志级别做成开关很容易，难的是"打开之后确实看得到东西"。
    // 本仓库已因"设置项/提示承诺了却不生效"栽过 5 次（最近一次是「详情见开发者控制台」
    // 而代码从不写控制台）。所以这里不满足于"命令能跑"，而是断言**输出的确有差异**。
    await boot('silent');
    writeText(VAULT_ROOT, 'D.md', '# d\n\n![[assets/d.png]]\n');
    writeBinary(VAULT_ROOT, 'assets/d.png', tinyImage('png'));
    handle.open('D.md');

    const debugLines: string[] = [];
    const spy = vi.spyOn(console, 'debug').mockImplementation((...a: unknown[]) => {
      debugLines.push(a.map((x) => String(x)).join(' '));
    });
    try {
      // ① 默认档位：debug 不可达（对照组——否则"任何情况都狂打日志"也能通过本用例）
      debugLines.length = 0;
      await command('attachment:check-consistency')();
      expect(debugLines, '默认档位不应该有 debug 输出').toEqual([]);

      // ② 打开诊断：提示必须**不受通知级别影响**地可见，否则用户不知道是开是关
      await command('attachment:toggle-debug-logging')();
      expect(notices().join('\n'), '静默档下开关状态不可见，用户无从判断是否已开启').toMatch(/诊断日志已开启/);
      // 命令必须改**设置**（唯一事实来源）：只改日志级别不改设置的话，
      // 设置页会显示"关"而实际是"开"——界面显示值与实际生效值不一致。
      expect(plugin.settings.debugLogging, '命令切了日志级别却没改设置').toBe(true);

      // ③ 打开后必须有新输出
      debugLines.length = 0;
      await command('attachment:check-consistency')();
      const on = debugLines.join('\n');
      expect(on, '诊断开关"打开了却什么也没有"——这正是要避免的那类缺陷').toMatch(/\[IAP\]/);
      expect(on, '缺少索引快照信息：排查"计划基于过期快照"时这是第一手线索').toMatch(/索引/);

      // ④ 关闭后恢复：不得再有 debug 输出
      await command('attachment:toggle-debug-logging')();
      expect(notices().join('\n')).toMatch(/诊断日志已关闭/);
      expect(plugin.settings.debugLogging, '关闭只作用于日志级别，设置仍是开').toBe(false);
      debugLines.length = 0;
      await command('attachment:check-consistency')();
      expect(debugLines, '关闭后仍在输出 debug——开关是单向的').toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('设置落盘后重载仍生效——"设置里有值、运行时没读"是同一类缺陷', async () => {
    // 只验证"打开后有效"还不够：设置项最常见的一种失效是**写进了配置、运行时读另一处**
    // （本仓库的「通知级别」等设置都栽过）。这里模拟"上次在设置页打开后退出"，
    // 只把 `debugLogging: true` 写进落盘文件，再走一次 `loadSettings()`。
    await boot('silent');
    const dataPath = nodePath.join(
      VAULT_ROOT,
      '.obsidian',
      'plugins',
      'attachment-suite',
      'data.json',
    );
    nodeFs.mkdirSync(nodePath.dirname(dataPath), { recursive: true });
    nodeFs.writeFileSync(dataPath, JSON.stringify({ debugLogging: true }), 'utf8');

    await plugin.loadSettings();
    expect(plugin.settings.debugLogging, '读回来的设置没有落到运行时设置上').toBe(true);

    const debugLines: string[] = [];
    const spy = vi.spyOn(console, 'debug').mockImplementation((...a: unknown[]) => {
      debugLines.push(a.map((x) => String(x)).join(' '));
    });
    try {
      await command('attachment:check-consistency')();
      expect(
        debugLines.join('\n'),
        '配置里是开、运行时没生效——"设置里有值、运行时没读"',
      ).toMatch(/索引/);
    } finally {
      spy.mockRestore();
      await plugin.setDebugLogging(false); // 还原：日志级别是模块级全局状态，别污染后续用例
    }
  });
});

describe('摘要档（notificationLevel = summary）的契约', () => {
  it('成功时给出结果汇总，且提示带停留时长', async () => {
    await boot('summary');
    writeText(VAULT_ROOT, 'S.md', `# s\n\n![x](${httpBase}/c.png)\n`);
    handle.open('S.md');

    await command('attachment:localize-note')();

    const msgs = notices();
    expect(msgs.join('\n')).toMatch(/本地化完成/);
    // createNoticer 会按级别给停留时长（错误 5s / 结果 3s / 过程 2s，长消息更久）
    const withDuration = obsidian._registry.notices.filter((n) => typeof n.duration === 'number');
    expect(withDuration.length, '提示没有带停留时长——分级停留时长的承诺未生效').toBeGreaterThan(0);
  });
});

describe('启动横幅必须受「通知级别」约束', () => {
  /**
   * 在 `onload` **之前**把设置落盘。
   *
   * 刻意不沿用 `boot()`：它在 onload **之后**才 `plugin.settings = settingsFor(level)`，
   * 而启动横幅读的是 `loadSettings()` 之后的 `this.settings`——照那样写，这条用例会恒真
   * （横幅早就按默认档弹完了，怎么断言都"通过"）。
   * 替身的 `loadData()` 读的是真实安装目录下的 `data.json`，所以这里先写盘、再 onload，
   * 走的正是真实用户的路径。
   */
  async function bootWithPersistedLevel(
    level: PluginSettings['notificationLevel'],
  ): Promise<string[]> {
    obsidian._registry.notices = [];
    obsidian._registry.commands = [];
    obsidian._registry.modals = [];
    handle = buildTestApp(VAULT_ROOT, obsidian);
    const dir = nodePath.join(VAULT_ROOT, '.obsidian', 'plugins', 'attachment-suite');
    nodeFs.mkdirSync(dir, { recursive: true });
    nodeFs.writeFileSync(
      nodePath.join(dir, 'data.json'),
      JSON.stringify({ ...DEFAULT_SETTINGS, notificationLevel: level }),
      'utf8',
    );
    const { default: PluginClass } = await import('../../src/main');
    const p = new PluginClass(handle.app, {
      id: 'attachment-suite',
      name: 'Attachment Suite',
      version: '1.0.0',
      minAppVersion: '1.6.7',
      description: 'test',
      author: 'test',
      isDesktopOnly: true,
    });
    await p.onload();
    return notices();
  }

  it('静默档：启动不得产生任何提示（承诺是「只出错时提示」）', async () => {
    const msgs = await bootWithPersistedLevel('silent');
    expect(
      msgs,
      '静默档下 onload 弹了提示——设置页写的「静默：只出错时提示」被插件自己打破'
        + '（默认配置下每次打开库都会弹一条成功横幅）',
    ).toEqual([]);
  });

  it('对照组：仅摘要档下应有且只有一条加载横幅，并带分级停留时长', async () => {
    const msgs = await bootWithPersistedLevel('summary');
    expect(msgs.length, '摘要档下反而没有加载提示了（横幅被误删）').toBe(1);
    expect(msgs[0]).toContain('已加载');
    expect(
      typeof obsidian._registry.notices[0].duration,
      '横幅没有走 effectiveDuration（时长不是数字）',
    ).toBe('number');
  });
});
