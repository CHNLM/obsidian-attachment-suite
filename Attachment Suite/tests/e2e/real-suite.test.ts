/**
 * Attachment Suite — 全量真实集成测试。
 * 以 for-test 真实文件系统为后端，加载“真实构建产物 main.js”，逐项驱动全部命令，
 * 校验真实落盘/链接触发行为。这是对“功能是否真的实现”的端到端验证。
 */

import * as http from 'node:http';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

// 说明：'obsidian' 已通过 vitest.config.ts 的 alias 解析到 tests/real/obsidian-stub.ts，
// 该 stub 以一套真实文件系统为后端，并在 globalThis.__OBSIDIAN_TEST 暴露实例供测试驱动。
//
// 重要：集成测试在独立的临时 vault 里运行（每次运行前重建），绝不动用户真实的
// for-test 目录，避免误删用户手写的笔记/文档。

import { seedFixture, TEST_SETTINGS, listVault } from './fixture';
import { buildTestApp, writeText, writeBinary, tinyImage } from './infrastructure';
import { DEFAULT_AUTOMATION_GUARD } from '../../src/features/automation-core';
import type { TestAppHandle, ObsidianModule } from './infrastructure';
// 触发 stub 初始化（把实例挂到 globalThis，并作为 'obsidian' 的共享单例）
import '../mocks/obsidian-stub';

let VAULT_ROOT = '';

let httpBase = '';
let server: http.Server;

function getObsidian(): ObsidianModule {
  return (globalThis as any).__OBSIDIAN_TEST;
}

function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
}

beforeAll(async () => {
  // 插件在 scheduleDirty 中使用 window.setTimeout（Obsidian 桌面环境全局存在）；
  // Node 测试环境以 globalThis 填充 window，保证事件路径可执行。对 Obsidian 运行时无影响。
  (globalThis as any).window = globalThis;
  VAULT_ROOT = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'iap-real-test-'));
  server = http.createServer((req, res) => {
    const url = req.url ?? '';
    // 以 `.html` 结尾的路径返回 HTML，供「网页不落存」用例使用；其余一律返回 PNG。
    if (url.endsWith('.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html><html><body>hi</body></html>');
      return;
    }
    // 内容随路径变化，使不同 URL 得到不同 MD5（供并发/多图用例区分落盘文件）
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.concat([Buffer.from(pngBytes()), Buffer.from(url, 'utf8')]));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
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

beforeEach(async () => {
  obsidian = getObsidian();
  obsidian._registry.notices = [];
  obsidian._registry.ctaClickCallbacks = [];
  obsidian._registry.commands = [];
  obsidian._registry.modals = [];

  seedFixture(VAULT_ROOT, httpBase);

  handle = buildTestApp(VAULT_ROOT, obsidian);
  // 经 Vite 加载插件源码，使 alias 对 'obsidian' 生效；构建产物为同一套源码经 esbuild 打包，逻辑等价
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
  // 以夹具配置覆盖（与 data.json 写入一致）
  plugin.settings = JSON.parse(JSON.stringify(TEST_SETTINGS));
});

/**
 * 本命令开始时的"弹窗/按钮水位"。
 *
 * 为什么需要：弹窗与按钮回调都挂在 app / registry 上、跨命令残留。若确认助手总是取
 * "最后一个"，那么当某条命令**没开弹窗**（无事可做）时，它会去确认**上一条命令**遗留的弹窗——
 * 等于把别人的破坏性操作又执行一遍。用起点水位把确认限定在"本命令自己开出的弹窗"内。
 */
let modalMark = 0;
let ctaMark = 0;

function command(id: string): () => void | Promise<void> {
  const cmds = handle.getCommands();
  const found = cmds.find((c: any) => c.id === id);
  if (!found) throw new Error(`命令未注册: ${id}`);
  return () => {
    modalMark = handle.app._modals.length;
    ctaMark = obsidian._registry.ctaButtons.length;
    return found.callback();
  };
}

/** 本命令新开的弹窗（自起点水位起）。 */
function freshModals(): any[] {
  return handle.app._modals.slice(modalMark);
}

function freshModalOpts(): any {
  const fresh = freshModals();
  return fresh[fresh.length - 1]?.opts;
}

/**
 * 本命令新创建的按钮回调；可按**按钮文案**取（如「全部跳过」「以此修复」）。
 *
 * 按文案而不是按创建顺序：顺序是实现的副产品（早期用 `cbs[length - 2]` 表示「全部跳过」），
 * 按钮顺序一调整用例就静默错位——那是"测试依赖实现细节"，不是"测试依赖契约"。
 */
function freshCTA(text?: string): (() => void | Promise<void>) | undefined {
  const fresh = obsidian._registry.ctaButtons.slice(ctaMark);
  const hit = text ? fresh.filter((b) => b.text.includes(text)).pop() : fresh.pop();
  return hit?.onClick;
}

/**
 * 触发本命令的确认弹窗并等待执行体完成。
 *
 * 本命令没有开确认窗（无事可做）时**直接返回**——这是正常的，不算错误。
 * 注意：本文件因此不保证"该弹确认的确实弹了"；这一点由 `acceptance.test.ts` 的
 * `runCmd` + `CONFIRM_REQUIRED` 显式断言，以及各用例对文件树变化的直接断言来兜底。
 */
async function runConfirm(): Promise<void> {
  const opts = freshModalOpts();
  if (opts && typeof opts.onConfirm === 'function') {
    // 通用 ConfirmChangesModal / ConfirmCleanupModal：直接调执行体，await 真正的移动结果
    await opts.onConfirm();
    return;
  }
  // ConfirmCleanupModal 的确认按钮为 async；等待其完成
  const cb = freshCTA();
  if (!cb) return;
  await cb();
}

/** 模拟候选选择弹窗：点击第 idx 个候选并确认修复（「以此修复」按钮）。 */
async function pickCandidate(idx: number): Promise<void> {
  const fresh = freshModals();
  const modal = fresh[fresh.length - 1];
  const items = (modal?.contentEl.querySelectorAll('iap-candidate-item') ?? []) as any[];
  if (!items[idx]) throw new Error(`候选 #${idx} 不存在`);
  items[idx].click();
  const cb = freshCTA('以此修复');
  if (!cb) throw new Error('没有候选确认回调');
  await cb();
}

/** 模拟候选选择弹窗：点击「全部跳过」。 */
function skipAllCandidates(): void {
  const cb = freshCTA('全部跳过');
  if (!cb) throw new Error('没有「全部跳过」回调');
  void cb();
}

function sorted(l: string[]): string[] {
  return [...l].sort();
}

/* ==================== 1. 插件加载与命令注册 ==================== */

describe('1. 插件加载与命令注册', () => {
  it('onload 不抛错且注册全部 13 条命令', () => {
    const ids = handle.getCommands().map((c: any) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'attachment:check-consistency',
        'attachment:cleanup-unused',
        'attachment:cleanup-empty-folders',
        'attachment:rename-note',
        'attachment:repair-incompatible-paths',
        'attachment:fix-broken-links',
        'attachment:localize-note',
        'attachment:collect-current-note',
        'attachment:bulk-collect',
        'attachment:export-note',
        'attachment:export-unused',
        'attachment:bulk-rename',
        'attachment:bulk-localize',
        // 诊断命令：切换日志级别，不改动库内容（与库内容相关的断言都应把它排除在外）
        'attachment:toggle-debug-logging',
      ]),
    );
    expect(ids).toHaveLength(14);
  });
});

/* ==================== 2. 一致性审计 ==================== */

describe('2. 一致性审计', () => {
  it('正确汇总坏链接与未用附件', async () => {
    handle.open('NoteA.md');
    await command('attachment:check-consistency')();
    const m = freshModalOpts();
    expect(m?.summary).toContain('坏链接 2');
    const orphan = m?.sections?.find((s: any) => s.title === '未用附件');
    expect(sorted(orphan.items)).toEqual(
      sorted(['BBB/not-referenced.png', 'BBB/sample.pdf', 'BBB/sample.mp3', 'root-orphan.png']),
    );
    const broken = m?.sections?.find((s: any) => s.title === '需修复的引用（断链 / URL 编码）');
    // 断链项现在为可点击对象 {text, onClick}，断言其 .text
    expect(sorted(broken.items.map((i: any) => i.text))).toEqual(
      sorted(['NoteA.md → assets/missing.png', 'NoteA.md → ghost.png']),
    );
    // 断链项都应带定位回调，可点击
    expect(broken.items.every((i: any) => typeof i.onClick === 'function')).toBe(true);
  });
});

/* ==================== 3. 统一命名 ==================== */

describe('3. 统一命名', () => {
  it('重命名当前笔记附件并同步改写正文与 frontmatter 引用', async () => {
    handle.open('NoteA.md');
    await command('attachment:rename-note')();
    await runConfirm();

    const files = listVault(VAULT_ROOT);
    // NoteA 的正文附件 imgA 与 frontmatter 附件 hero 都被命名（稳定排序下 hero→001，imgA→002）
    expect(files).toContain('assets/NoteA_image_001.png');
    expect(files).toContain('assets/NoteA_image_002.png');
    expect(files).not.toContain('assets/imgA.png');
    expect(files).not.toContain('assets/hero.png');

    const text = require('node:fs').readFileSync(nodePath.join(VAULT_ROOT, 'NoteA.md'), 'utf8');
    expect(text).toContain('![[assets/NoteA_image_002.png]]');
    expect(text).toContain('![small](assets/NoteA_image_002.png)');
    // frontmatter 引用也一并改写，避免 dangling
    expect(text).toContain('cover: assets/NoteA_image_001.png');
    expect(text).not.toContain('imgA.png');
    expect(text).not.toContain('hero.png');
  });
});

/* ==================== 4. 媒体本地化 ==================== */

describe('4. 媒体本地化', () => {
  it('下载 http 与 data 引用、写盘并改写为本地引用', async () => {
    handle.open('NoteA.md');
    // 关闭命名，隔离本地化行为
    plugin.settings.naming.enabled = false;
    await command('attachment:localize-note')();

    const files = listVault(VAULT_ROOT);
    const newImgs = files.filter((f) => /^assets\/[0-9a-f]{32}\.png$/.test(f));
    expect(newImgs.length).toBe(2);

    const text = require('node:fs').readFileSync(nodePath.join(VAULT_ROOT, 'NoteA.md'), 'utf8');
    expect(text).not.toContain('http://127.0.0.1');
    expect(text).not.toContain('data:image/png');
    expect(text).toMatch(/!\[\[assets\/[0-9a-f]{32}\.png/);
  });

  it('frontmatter 中的外链同样被本地化并保留 YAML 引号', async () => {
    const fs = require('node:fs');
    fs.writeFileSync(
      nodePath.join(VAULT_ROOT, 'FmCover.md'),
      ['---', 'title: 封面测试', `cover: "${httpBase}/cover.png"`, '---', '', '# 正文', ''].join('\n'),
    );
    handle.open('FmCover.md');
    plugin.settings.naming.enabled = false; // 隔离本地化行为

    await command('attachment:localize-note')();

    const text = fs.readFileSync(nodePath.join(VAULT_ROOT, 'FmCover.md'), 'utf8');
    expect(text).not.toContain('http://127.0.0.1');
    // 引号保留、键名与其它字段不变
    expect(text).toMatch(/cover: "assets\/[0-9a-f]{32}\.png"/);
    expect(text).toContain('title: 封面测试');
  });

  it('对外部页面复制来的笔记执行（含中文目录与多级路径 URL）', async () => {
    const fs = require('node:fs');
    // 复制用户真实的网页粘贴内容到 测试A 目录。
    // URL 指向本套件自建的本地服务（多级路径，形状与真实站点一致）而**不是**公网：
    // 早期这里直接写了一个第三方站点地址，导致本用例在离线/CI 环境必然红，
    // 且目标站改版或返回 HTML 时结论会漂移——测试不该依赖外部世界的可用性。
    const dir = nodePath.join(VAULT_ROOT, '测试A');
    fs.mkdirSync(dir, { recursive: true });
    const notePath = '测试A/网页内容复制.md';
    const remoteUrl = `${httpBase}/img/agentdock-chatgpt-codex/developer-mode.png`;
    fs.writeFileSync(
      nodePath.join(VAULT_ROOT, notePath),
      [
        'AgentDock 本身就是一个 MCP 工具运行时。',
        '',
        `![在 ChatGPT 设置中开启开发人员模式](${remoteUrl})`,
        '',
        '接好以后，它会出现在 ChatGPT 的工具列表里。',
        '',
      ].join('\n'),
    );
    handle.open(notePath);
    await command('attachment:localize-note')();

    const text = fs.readFileSync(nodePath.join(VAULT_ROOT, notePath), 'utf8');
    const files = listVault(VAULT_ROOT);
    const local = files.find((f) => f.startsWith('测试A/') && f.endsWith('.png') && f.includes('网页内容复制'));
    // 本地化成功 + 自动命名：图片已落地为 <note>_image_001.png
    expect(local).toBeTruthy();
    // 外链已被改写为本地 wiki 引用（保留原 alt 作为别名）
    expect(text).not.toContain(remoteUrl);
    expect(text).toContain(`![[${local}|`);
  });

  it('P0 内网拦截：开启后指向本机（127.0.0.1）的外链被跳过、不下载', async () => {
    const fs = require('node:fs');
    const notePath = 'LocalBlock.md';
    plugin.settings.naming.enabled = false;
    // 夹具默认关闭拦截（其本地服务即 127.0.0.1）；此处显式开启以验证拦截生效
    plugin.settings.localize.blockPrivateHosts = true;
    writeText(VAULT_ROOT, notePath, `# block\n\n![x](${httpBase}/logo.png)\n`);
    handle.open(notePath);
    await command('attachment:localize-note')();

    const text = fs.readFileSync(nodePath.join(VAULT_ROOT, notePath), 'utf8');
    const files = listVault(VAULT_ROOT);
    // 引用保持原样（未被改写为本地引用），且未产生任何新的 MD5 落盘文件
    expect(text).toContain(`${httpBase}/logo.png`);
    expect(files.filter((f) => /^assets\/[0-9a-f]{32}\.png$/.test(f))).toHaveLength(0);
  });

  it('网页（HTML）永不落存：引用被跳过、不产生任何 .html 附件', async () => {
    const fs = require('node:fs');
    const notePath = 'WebpageSkip.md';
    plugin.settings.naming.enabled = false;
    // 本轮镜像用例：该路径由测试服务器返回 text/html
    writeText(VAULT_ROOT, notePath, `# w\n\n![page](${httpBase}/page.html)\n`);
    handle.open(notePath);
    await command('attachment:localize-note')();

    const text = fs.readFileSync(nodePath.join(VAULT_ROOT, notePath), 'utf8');
    const files = listVault(VAULT_ROOT);
    // 引用保持外链原样（未被改写），且库中不存在任何 .html 附件
    expect(text).toContain(`${httpBase}/page.html`);
    expect(files.filter((f) => f.toLowerCase().endsWith('.html'))).toHaveLength(0);
  });

  it('域名黑名单命中：外链被跳过、不下载', async () => {
    const fs = require('node:fs');
    const notePath = 'DenyList.md';
    plugin.settings.naming.enabled = false;
    plugin.settings.localize.denyHosts = ['127.0.0.1'];
    writeText(VAULT_ROOT, notePath, `# d\n\n![x](${httpBase}/deny.png)\n`);
    handle.open(notePath);
    await command('attachment:localize-note')();

    const text = fs.readFileSync(nodePath.join(VAULT_ROOT, notePath), 'utf8');
    expect(text).toContain(`${httpBase}/deny.png`);
    expect(listVault(VAULT_ROOT).filter((f) => /^assets\/[0-9a-f]{32}\.png$/.test(f))).toHaveLength(0);
  });

  it('仅白名单模式：未列入白名单则跳过，列入后正常下载', async () => {
    const fs = require('node:fs');
    const notePath = 'AllowOnly.md';
    plugin.settings.naming.enabled = false;
    plugin.settings.localize.hostAllowlistOnly = true;
    plugin.settings.localize.allowHosts = [];
    writeText(VAULT_ROOT, notePath, `# a\n\n![x](${httpBase}/only.png)\n`);
    handle.open(notePath);
    await command('attachment:localize-note')();

    // 空白名单 + 仅白名单模式 → 一律跳过
    let text = fs.readFileSync(nodePath.join(VAULT_ROOT, notePath), 'utf8');
    expect(text).toContain(`${httpBase}/only.png`);
    expect(listVault(VAULT_ROOT).filter((f) => /^assets\/[0-9a-f]{32}\.png$/.test(f))).toHaveLength(0);

    // 显式列入白名单（同时覆盖内网拦截）→ 正常下载并改写
    plugin.settings.localize.allowHosts = ['127.0.0.1'];
    await command('attachment:localize-note')();
    text = fs.readFileSync(nodePath.join(VAULT_ROOT, notePath), 'utf8');
    expect(text).not.toContain(httpBase);
    expect(listVault(VAULT_ROOT).filter((f) => /^assets\/[0-9a-f]{32}\.png$/.test(f))).toHaveLength(1);
  });

  it('并发下载：maxConcurrent=4 时多张不同图片均正确落盘并改写', async () => {
    const fs = require('node:fs');
    const notePath = 'Concurrent.md';
    plugin.settings.naming.enabled = false;
    plugin.settings.localize.maxConcurrent = 4;
    const urls = [1, 2, 3, 4, 5].map((i) => `${httpBase}/c${i}.png`);
    writeText(VAULT_ROOT, notePath, `# c\n\n${urls.map((u) => `![i](${u})`).join('\n\n')}\n`);
    handle.open(notePath);
    await command('attachment:localize-note')();

    const text = fs.readFileSync(nodePath.join(VAULT_ROOT, notePath), 'utf8');
    expect(text).not.toContain(httpBase); // 全部改写为本地引用
    // 5 个不同 URL → 5 份不同内容 → 5 个不同 MD5 文件
    expect(listVault(VAULT_ROOT).filter((f) => /^assets\/[0-9a-f]{32}\.png$/.test(f))).toHaveLength(5);
  });

  it('同一 URL 重复引用：只下载一次，两处引用改写为同一本地文件', async () => {
    const fs = require('node:fs');
    const notePath = 'Dedupe.md';
    plugin.settings.naming.enabled = false;
    writeText(VAULT_ROOT, notePath, `# dd\n\n![a](${httpBase}/dup.png)\n\n![b](${httpBase}/dup.png)\n`);
    handle.open(notePath);
    await command('attachment:localize-note')();

    const text = fs.readFileSync(nodePath.join(VAULT_ROOT, notePath), 'utf8');
    expect(text).not.toContain(httpBase);
    expect(listVault(VAULT_ROOT).filter((f) => /^assets\/[0-9a-f]{32}\.png$/.test(f))).toHaveLength(1);
  });
});

/* ==================== 5. 未用清理 ==================== */

describe('5. 未用清理', () => {
  it('确认后把未引用附件移入回收站，保留被引用附件', async () => {
    await command('attachment:cleanup-unused')();
    await runConfirm();

    const files = listVault(VAULT_ROOT);
    expect(files).not.toContain('root-orphan.png');
    expect(files).not.toContain('BBB/not-referenced.png');
    // 被引用附件保留
    expect(files).toContain('assets/imgA.png');
    expect(files).toContain('BBB/pic1.jpg');
    expect(files).toContain('AAA/assets/move.png');
    // 已移入回收站
    expect(require('node:fs').existsSync(nodePath.join(VAULT_ROOT, '.trash', 'root-orphan.png'))).toBe(true);
  });
});

/* ==================== 6. 导出当前笔记 ==================== */

describe('6. 导出当前笔记附件', () => {
  it('生成 NoteA_Attachments.zip', async () => {
    handle.open('NoteA.md');
    await command('attachment:export-note')();

    const zip = nodePath.join(VAULT_ROOT, 'NoteA_Attachments.zip');
    const buf = require('node:fs').readFileSync(zip);
    // PK 魔数
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
});

/* ==================== 7. 导出未用附件 ==================== */

describe('7. 导出未用附件', () => {
  it('生成 Unused_Attachments.zip 且包含孤儿', async () => {
    await command('attachment:export-unused')();
    const zip = nodePath.join(VAULT_ROOT, 'Unused_Attachments.zip');
    const buf = require('node:fs').readFileSync(zip);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it('排除目录内的未用附件不导出（全部被排除时不生成 zip）', async () => {
    const fs = require('node:fs');
    // 夹具的未用附件为 BBB/not-referenced.png、BBB/sample.pdf、BBB/sample.mp3、root-orphan.png
    // → 一并排除后应无可导出内容（口径与「清理未用附件」一致）
    const prev = plugin.settings.paths.exclude;
    plugin.settings.paths.exclude = ['BBB', 'root-orphan.png'];
    obsidian._registry.notices = [];
    try {
      await command('attachment:export-unused')();
      expect(fs.existsSync(nodePath.join(VAULT_ROOT, 'Unused_Attachments.zip'))).toBe(false);
      expect(obsidian._registry.notices.some((n) => String(n.message).includes('均位于排除目录'))).toBe(true);
    } finally {
      plugin.settings.paths.exclude = prev;
    }
  });

  it('导出的 zip 不会被「清理未用附件」误删（不在受管附件白名单内）', async () => {
    const fs = require('node:fs');
    const zip = nodePath.join(VAULT_ROOT, 'Unused_Attachments.zip');
    await command('attachment:export-unused')();
    expect(fs.existsSync(zip)).toBe(true);

    // 清理未用会删掉夹具里的孤儿附件，但 zip 是"非受管扩展名"，绝不能被当成附件删掉
    await command('attachment:cleanup-unused')();
    await runConfirm();
    expect(fs.existsSync(zip)).toBe(true);
    expect(fs.existsSync(nodePath.join(VAULT_ROOT, 'BBB', 'not-referenced.png'))).toBe(false);
  });
});

/* ==================== 8. 笔记移动跟随 ==================== */

describe('8. 笔记移动跟随', () => {
  it('笔记跨目录移动时迁移相对型附件目录下的附件', async () => {
    const fs = require('node:fs');
    // 物理移动笔记
    fs.mkdirSync(nodePath.join(VAULT_ROOT, 'CCC'), { recursive: true });
    fs.renameSync(
      nodePath.join(VAULT_ROOT, 'AAA', 'move-note.md'),
      nodePath.join(VAULT_ROOT, 'CCC', 'move-note.md'),
    );
    // 触发 rename 事件（onRename 排队 runFollowNoteMove）
    handle.emitRename('CCC/move-note.md', 'AAA/move-note.md');
    // 事件经 TaskQueue 异步执行，等待队列完成
    await new Promise((r) => setTimeout(r, 50));

    const files = listVault(VAULT_ROOT);
    expect(files).toContain('CCC/assets/move.png');
    expect(files).not.toContain('AAA/assets/move.png');
  });
});

/* ==================== 9. 路径修复（存在违规名时执行改名 + 改写引用） ==================== */

describe('9. 路径修复', () => {
  it('在无非法路径的库上正常执行并提示无待修复项', async () => {
    await command('attachment:repair-incompatible-paths')();
    expect(obsidian._registry.notices.some((n) => n.message.includes('没有需要修复的路径'))).toBe(true);
  });

  /**
   * 执行路径的覆盖（此前只有上面的"空操作"用例，改名+改写链条从未被执行过）。
   *
   * 夹具用 `a..png`：它**在所有平台都可创建**，又**在所有平台都判为不兼容**
   * （`repairName` 会去掉基名末尾的点 → `a.png`），故不需要按平台分支。
   * 避免用 `?`/`*`（Windows 建不出）或超长中文名（macOS/Linux 的 255 字节上限建不出）。
   */
  it('存在不兼容路径时：改名附件并同步改写引用，且改写目标真实存在', async () => {
    writeBinary(VAULT_ROOT, 'assets/a..png', tinyImage('png'));
    writeText(VAULT_ROOT, 'Bad.md', '# bad\n\n![x](assets/a..png)\n');
    plugin.index.markDirty(); // 本用例在 onload 之后才写文件，强制重建索引

    await command('attachment:repair-incompatible-paths')();
    await runConfirm();

    const files = listVault(VAULT_ROOT);
    expect(files, '不兼容路径没有被改名').not.toContain('assets/a..png');
    expect(files, '改名后的附件不存在').toContain('assets/a.png');

    const text = nodeFs.readFileSync(nodePath.join(VAULT_ROOT, 'Bad.md'), 'utf8');
    const m = text.match(/!\[x\]\(([^)]+)\)/);
    expect(m, '引用被整段破坏').not.toBeNull();
    expect(
      nodeFs.existsSync(nodePath.join(VAULT_ROOT, m![1])),
      `改写后的目标不存在：${m![1]}`,
    ).toBe(true);
  });
});

/* ==================== 10. 自动化：粘贴图片进笔记即自动本地化 + 命名 ==================== */

/**
 * 让"宿主索引就绪"在测试里确定发生，并**过掉就绪后的余震窗口**。
 *
 * 生产默认会忽略"刚就绪 1.5 秒内"的 changed——真实宿主上那段窗口里确实有 46 个启动期事件
 * （见第 20 组的实测计数），不忽略就会把整库标脏。而这里的用例要驱动的是
 * "就绪之后用户编辑了这一篇"，故把该窗口调到 0；窗口本身由
 * `tests/unit/features/automation-core.test.ts` 与第 20 组覆盖。
 */
function markVaultReady(): void {
  plugin.automationGuard = { ...plugin.automationGuard, postSettleQuietMs: 0 };
  handle.emitMetadataResolved();
}

describe('10. 自动化（自动处理）', () => {
  it('笔记内容变更（粘贴外链）后自动下载并统一命名', async () => {
    const fs = require('node:fs');
    writeText(VAULT_ROOT, 'Auto.md', '# Auto\n');
    // 模拟用户从网页粘贴进一张外链图片并保存 → 触发 metadataCache.changed
    writeText(VAULT_ROOT, 'Auto.md', `# Auto\n\n![x](${httpBase}/logo.png)\n`);
    handle.open('Auto.md'); // 自动化仅处理当前活动笔记
    // 前提：宿主索引已就绪（插件只把就绪后的 changed 当作"用户编辑"）
    markVaultReady();
    handle.emitChanged('Auto.md');

    // 等待自动处理去抖(1200ms) + 队列串行完成
    await new Promise((r) => setTimeout(r, 2200));

    const files = listVault(VAULT_ROOT);
    // 已自动下载并统一命名
    expect(files).toContain('assets/Auto_image_001.png');
    const text = fs.readFileSync(nodePath.join(VAULT_ROOT, 'Auto.md'), 'utf8');
    expect(text).not.toContain(httpBase);
    expect(text).toContain('![[assets/Auto_image_001.png|x]]');
  });
});

/* ==================== 11. P0 增强 ==================== */

describe('11. P0 增强', () => {
  it('P0-1 粘贴事件（editor-paste）即触发本地化 + 命名', async () => {
    const fs = require('node:fs');
    writeText(VAULT_ROOT, 'Paste.md', `# Paste\n\n![x](${httpBase}/logo.png)\n`);
    handle.open('Paste.md');
    handle.emitPaste({ textHtml: `<img src="${httpBase}/logo.png" alt="x">`, textPlain: '' });
    // paste 触发的是 700ms 短延时调度
    await new Promise((r) => setTimeout(r, 1600));

    const files = listVault(VAULT_ROOT);
    expect(files).toContain('assets/Paste_image_001.png');
    const text = fs.readFileSync(nodePath.join(VAULT_ROOT, 'Paste.md'), 'utf8');
    expect(text).not.toContain(httpBase);
    expect(text).toContain('![[assets/Paste_image_001.png|x]]');
  });

  it('P0-2 焦点切换不影响自动化（按显式笔记路径处理，而非当前活动笔记）', async () => {
    const fs = require('node:fs');
    // Background.md 含外链；让当前活动笔记是另一篇 Front.md，触发 Background.md 的 changed
    writeText(VAULT_ROOT, 'Background.md', `# bg\n\n![y](${httpBase}/logo.png)\n`);
    writeText(VAULT_ROOT, 'Front.md', '# front\n');
    handle.open('Front.md');
    markVaultReady();
    handle.emitChanged('Background.md');
    await new Promise((r) => setTimeout(r, 1800));

    // 修复后：即使焦点不在 Background.md 上，轮询仍按显式 notePath 处理它
    const files = listVault(VAULT_ROOT);
    expect(files.some((f) => f.startsWith('assets/') && f.includes('Background_image'))).toBe(true);
    const text = fs.readFileSync(nodePath.join(VAULT_ROOT, 'Background.md'), 'utf8');
    expect(text).not.toContain(httpBase); // 已本地化
  });

  it('P0-3 被多篇笔记引用的附件采用复制副本再命名，原文件保留', async () => {
    const fs = require('node:fs');
    // 同一张图 shared.png 被两篇笔记引用
    writeText(VAULT_ROOT, 'ShareA.md', '# A\n\n![[assets/shared.png]]\n');
    writeText(VAULT_ROOT, 'ShareB.md', '# B\n\n![[assets/shared.png]]\n');
    writeBinary(VAULT_ROOT, 'assets/shared.png', tinyImage('png'));

    handle.open('ShareA.md');
    await command('attachment:rename-note')();
    await runConfirm();

    const files = listVault(VAULT_ROOT);
    // 生成 A 的命名副本，原共享文件保留
    expect(files).toContain('assets/ShareA_image_001.png');
    expect(files).toContain('assets/shared.png');
    const aText = fs.readFileSync(nodePath.join(VAULT_ROOT, 'ShareA.md'), 'utf8');
    const bText = fs.readFileSync(nodePath.join(VAULT_ROOT, 'ShareB.md'), 'utf8');
    expect(aText).toContain('![[assets/ShareA_image_001.png]]');
    expect(bText).toContain('![[assets/shared.png]]'); // B 仍引用原文件
  });
});

/* ==================== 12. P1 增强 ==================== */

describe('12. P1 增强', () => {
  it('P1-5 收集散落附件到笔记归属目录', async () => {
    const fs = require('node:fs');
    // NoteC 引用一张落在库根的图（其归属目录应是 assets/）
    writeText(VAULT_ROOT, 'NoteC.md', '# C\n\n![[root-pic.png]]\n');
    writeBinary(VAULT_ROOT, 'root-pic.png', tinyImage('png'));

    handle.open('NoteC.md');
    await command('attachment:collect-current-note')();
    await runConfirm();

    const files = listVault(VAULT_ROOT);
    expect(files).toContain('assets/root-pic.png');
    expect(files).not.toContain('root-pic.png');
    const text = fs.readFileSync(nodePath.join(VAULT_ROOT, 'NoteC.md'), 'utf8');
    expect(text).toContain('![[assets/root-pic.png]]');
  });

  it('P1-7 收集全库散落附件（bulk-collect）：各归其位、引用跟着改写', async () => {
    const fs = require('node:fs');
    // 两篇笔记各引用一张落在**库根**的图。⚠️ 文件名必须不同：索引按 basename 解析，
    // 同名会被判成"被多篇笔记共用"而按设计跳过（这条口径在别处已栽过一次）。
    writeText(VAULT_ROOT, 'sub/Na.md', '# A\n\n![[bc-a.png]]\n');
    writeBinary(VAULT_ROOT, 'bc-a.png', tinyImage('png'));
    writeText(VAULT_ROOT, 'sub/Nb.md', '# B\n\n![[bc-b.png]]\n');
    writeBinary(VAULT_ROOT, 'bc-b.png', tinyImage('png'));

    // 这是**全库级**命令：不依赖"当前打开的笔记"，故不 open 任何文件。
    await command('attachment:bulk-collect')();
    await runConfirm();

    const files = listVault(VAULT_ROOT);
    expect(files, '库根散落附件没有被收进各自笔记的归属目录').toContain('sub/assets/bc-a.png');
    expect(files).toContain('sub/assets/bc-b.png');
    expect(files, '移动后原位残留了副本（应为移动而非复制）').not.toContain('bc-a.png');
    expect(files).not.toContain('bc-b.png');
    // 引用必须跟着改写，否则等于把两篇笔记的链接改断。
    // 注意写法：笔记在 sub/ 下，wiki 引用按**库相对**改写为 `sub/assets/…`
    // （P1-5 的笔记在库根，两种写法恰好重合，别把那个当成通用形态）。
    expect(fs.readFileSync(nodePath.join(VAULT_ROOT, 'sub/Na.md'), 'utf8')).toContain('![[sub/assets/bc-a.png]]');
    expect(fs.readFileSync(nodePath.join(VAULT_ROOT, 'sub/Nb.md'), 'utf8')).toContain('![[sub/assets/bc-b.png]]');
  });

  it('P1-6 统一命名按类型放入子目录', async () => {
    const fs = require('node:fs');
    writeText(VAULT_ROOT, 'CatNote.md', '# cat\n\n![[assets/img.png]]\n');
    writeBinary(VAULT_ROOT, 'assets/img.png', tinyImage('png'));
    plugin.settings.naming.folderByCategory = true;

    handle.open('CatNote.md');
    await command('attachment:rename-note')();
    await runConfirm();

    const files = listVault(VAULT_ROOT);
    expect(files).toContain('assets/image/CatNote_image_001.png');
    expect(files).not.toContain('assets/img.png');
    const text = fs.readFileSync(nodePath.join(VAULT_ROOT, 'CatNote.md'), 'utf8');
    expect(text).toContain('![[assets/image/CatNote_image_001.png]]');
  });

  it('P1-4 附件目录模板变量使外链落到 assets/<notename>/ 下', async () => {
    const fs = require('node:fs');
    // 隔离命名，仅验证模板目录落盘
    plugin.settings.naming.enabled = false;
    plugin.settings.attachmentFolder = './assets/${notename}';
    writeText(VAULT_ROOT, 'Tmpl.md', `# tmpl\n\n![x](${httpBase}/logo.png)\n`);
    handle.open('Tmpl.md');
    await command('attachment:localize-note')();
    // 单个外部引用被下载到 assets/Tmpl/
    const files = listVault(VAULT_ROOT);
    expect(files.some((f) => /^assets\/Tmpl\/[0-9a-f]{32}\.png$/.test(f))).toBe(true);
    const text = fs.readFileSync(nodePath.join(VAULT_ROOT, 'Tmpl.md'), 'utf8');
    expect(text).toMatch(/!\[\[assets\/Tmpl\/[0-9a-f]{32}\.png/);
  });
});

/* ==================== 13. P2 增强 ==================== */

describe('13. P2 增强', () => {
  it('P2-9 清理空附件目录（移入回收站）', async () => {
    const fs = require('node:fs');
    fs.mkdirSync(nodePath.join(VAULT_ROOT, 'emptyDir'), { recursive: true });
    fs.mkdirSync(nodePath.join(VAULT_ROOT, 'assets', 'also-empty'), { recursive: true });

    await command('attachment:cleanup-empty-folders')();
    await runConfirm();

    expect(fs.existsSync(nodePath.join(VAULT_ROOT, 'emptyDir'))).toBe(false);
    expect(fs.existsSync(nodePath.join(VAULT_ROOT, 'assets', 'also-empty'))).toBe(false);
    expect(fs.existsSync(nodePath.join(VAULT_ROOT, '.trash', 'emptyDir'))).toBe(true);
    // 非空目录保留
    expect(fs.existsSync(nodePath.join(VAULT_ROOT, 'assets'))).toBe(true);
  });

  it('P2-9b 空目录清理受清理总开关、删除前确认与排除目录约束', async () => {
    const fs = require('node:fs');
    const mk = (name: string): void => fs.mkdirSync(nodePath.join(VAULT_ROOT, name), { recursive: true });
    const prev = JSON.parse(JSON.stringify(plugin.settings.cleanup));
    try {
      // ① 清理总开关关闭 → 整条命令不执行（与「清理未用附件」一致）
      mk('drop-empty');
      plugin.settings.cleanup.enabled = false;
      await command('attachment:cleanup-empty-folders')();
      expect(fs.existsSync(nodePath.join(VAULT_ROOT, 'drop-empty'))).toBe(true);

      // ② 开关开启 + 命中「清理」排除目录 → 命中项跳过、其余照常删除
      plugin.settings.cleanup.enabled = true;
      mk('keep-empty');
      plugin.settings.cleanup.excludedFolders = ['keep-empty'];
      await command('attachment:cleanup-empty-folders')();
      await runConfirm();
      expect(fs.existsSync(nodePath.join(VAULT_ROOT, 'keep-empty'))).toBe(true);
      expect(fs.existsSync(nodePath.join(VAULT_ROOT, 'drop-empty'))).toBe(false);

      // ③ 关闭「删除前确认」→ 不再弹窗，直接执行
      plugin.settings.cleanup.excludedFolders = [];
      plugin.settings.cleanup.requireConfirm = false;
      mk('drop-empty2');
      await command('attachment:cleanup-empty-folders')();
      expect(fs.existsSync(nodePath.join(VAULT_ROOT, 'drop-empty2'))).toBe(false);
    } finally {
      plugin.settings.cleanup = prev;
    }
  });
});

/* ==================== 14. 全库统一命名 ==================== */

describe('14. 全库统一命名', () => {
  it('批量命名全库独占与共享附件，共享为每篇各复制副本', async () => {
    const fs = require('node:fs');
    // 独占附件：NoteA 各引一张图；共享附件 shared.png 被两篇引用
    writeText(VAULT_ROOT, 'NoteX.md', '# X\n\n![[assets/only-x.png]]\n\n![[assets/shared.png]]\n');
    writeText(VAULT_ROOT, 'NoteY.md', '# Y\n\n![[assets/only-y.jpg]]\n\n![[assets/shared.png]]\n');
    writeBinary(VAULT_ROOT, 'assets/only-x.png', tinyImage('png'));
    writeBinary(VAULT_ROOT, 'assets/only-y.jpg', tinyImage('jpg'));
    writeBinary(VAULT_ROOT, 'assets/shared.png', tinyImage('png'));

    await command('attachment:bulk-rename')();
    await runConfirm();

    const files = listVault(VAULT_ROOT);
    // 独占附件：每篇生成各自的 note_image_001 / note_image_002
    expect(files).toContain('assets/NoteX_image_001.png');
    expect(files).toContain('assets/NoteY_image_001.jpg');
    // 共享附件：为每篇各生成一份副本（含各自笔记名），且原 shared.png 保留
    expect(files).toContain('assets/NoteX_image_002.png');
    expect(files).toContain('assets/NoteY_image_002.png');
    expect(files).toContain('assets/shared.png'); // 原共享文件保留
    const xText = fs.readFileSync(nodePath.join(VAULT_ROOT, 'NoteX.md'), 'utf8');
    const yText = fs.readFileSync(nodePath.join(VAULT_ROOT, 'NoteY.md'), 'utf8');
    // 每篇正文链接各自改写到自己的副本
    expect(xText).toContain('![[assets/NoteX_image_001.png]]');
    expect(xText).toContain('![[assets/NoteX_image_002.png]]');
    expect(xText).not.toContain('only-x.png');
    expect(xText).not.toContain('shared.png');
    expect(yText).toContain('![[assets/NoteY_image_001.jpg]]');
    expect(yText).toContain('![[assets/NoteY_image_002.png]]');
    expect(yText).not.toContain('shared.png');
  });

  it('全库命名 folderByCategory：共享附件在类别子目录下为每篇各复制副本', async () => {
    const fs = require('node:fs');
    plugin.settings.naming.folderByCategory = true;
    writeText(VAULT_ROOT, 'NoteX.md', '# X\n\n![[assets/shared.png]]\n');
    writeText(VAULT_ROOT, 'NoteY.md', '# Y\n\n![[assets/shared.png]]\n');
    writeBinary(VAULT_ROOT, 'assets/shared.png', tinyImage('png'));

    await command('attachment:bulk-rename')();
    await runConfirm();

    const files = listVault(VAULT_ROOT);
    // 类别子目录下各生成一份副本（带各自笔记名），原共享文件保留
    expect(files).toContain('assets/image/NoteX_image_001.png');
    expect(files).toContain('assets/image/NoteY_image_001.png');
    expect(files).toContain('assets/shared.png');
    const xText = fs.readFileSync(nodePath.join(VAULT_ROOT, 'NoteX.md'), 'utf8');
    const yText = fs.readFileSync(nodePath.join(VAULT_ROOT, 'NoteY.md'), 'utf8');
    expect(xText).toContain('![[assets/image/NoteX_image_001.png]]');
    expect(yText).toContain('![[assets/image/NoteY_image_001.png]]');
    expect(xText).not.toContain('shared.png');
    expect(yText).not.toContain('shared.png');
  });

  it('已命名附件占用序号段：新附件接续编号且重复运行幂等（不产生 (1)）', async () => {
    const fs = require('node:fs');
    // 笔记已有一张按方案命名的图（模拟此前运行过），又新增一张原始附件
    writeText(VAULT_ROOT, 'NoteZ.md', '# Z\n\n![[assets/NoteZ_image_001.png]]\n\n![[assets/raw-new.png]]\n');
    writeBinary(VAULT_ROOT, 'assets/NoteZ_image_001.png', tinyImage('png'));
    writeBinary(VAULT_ROOT, 'assets/raw-new.png', tinyImage('png'));

    await command('attachment:bulk-rename')();
    await runConfirm();

    let files = listVault(VAULT_ROOT);
    // 新附件接续为 002，不与既有 001 冲突
    expect(files).toContain('assets/NoteZ_image_001.png');
    expect(files).toContain('assets/NoteZ_image_002.png');
    expect(files.some((f) => f.includes('NoteZ_image_001 (1)'))).toBe(false);
    expect(files).not.toContain('assets/raw-new.png');
    expect(fs.readFileSync(nodePath.join(VAULT_ROOT, 'NoteZ.md'), 'utf8')).toContain('![[assets/NoteZ_image_002.png]]');

    // 第二次运行应为无操作（幂等），不弹确认框，不新增 (1)/(2) 后缀
    await command('attachment:bulk-rename')();
    if (freshCTA() || freshModalOpts()?.onConfirm) await runConfirm();
    files = listVault(VAULT_ROOT);
    expect(files).toContain('assets/NoteZ_image_001.png');
    expect(files).toContain('assets/NoteZ_image_002.png');
    expect(files.filter((f) => f.startsWith('assets/NoteZ_image_'))).toHaveLength(2);
  });

  it('排除目录中的笔记其附件不被全库命名', async () => {
    const fs = require('node:fs');
    plugin.settings.paths.exclude = ['excluded'];
    writeText(VAULT_ROOT, 'excluded/NoteE.md', '# E\n\n![[only-e.png]]\n');
    writeBinary(VAULT_ROOT, 'excluded/only-e.png', tinyImage('png'));

    await command('attachment:bulk-rename')();
    await runConfirm();

    const files = listVault(VAULT_ROOT);
    expect(files).toContain('excluded/only-e.png'); // 原样保留，未按 NoteE 重命名
    expect(files.some((f) => f.includes('NoteE_image_'))).toBe(false);
    expect(fs.readFileSync(nodePath.join(VAULT_ROOT, 'excluded/NoteE.md'), 'utf8')).toContain('only-e.png');
  });
});

/* ==================== 15. 全库本地化 ==================== */

describe('15. 全库本地化', () => {
  it('全库下载外链：同一外链去重仅落一份 MD5，排除目录笔记不处理', async () => {
    // 位于排除目录的笔记（绝对定位到库下 excluded/）
    const fs = require('node:fs');
    fs.mkdirSync(nodePath.join(VAULT_ROOT, 'excluded'), { recursive: true });
    writeText(VAULT_ROOT, 'W.md', `# W\n\n![a](${httpBase}/logo.png)\n`);
    writeText(VAULT_ROOT, 'V.md', `# V\n\n![b](${httpBase}/logo.png)\n`);
    writeText(VAULT_ROOT, 'excluded/Skip.md', `# Skip\n\n![c](${httpBase}/logo.png)\n`);
    // 排除 excluded 目录
    plugin.settings.paths = { ...plugin.settings.paths, exclude: ['excluded'] };

    handle.open('W.md');
    await command('attachment:bulk-localize')();
    await runConfirm();

    const files = listVault(VAULT_ROOT);
    // W 与 V 引用同一 httpBase/logo.png → 去重后都指向同一个本地 MD5 文件
    const wText = fs.readFileSync(nodePath.join(VAULT_ROOT, 'W.md'), 'utf8');
    const vText = fs.readFileSync(nodePath.join(VAULT_ROOT, 'V.md'), 'utf8');
    const m1 = wText.match(/!\[\[assets\/([0-9a-f]{32})\.png/);
    const m2 = vText.match(/!\[\[assets\/([0-9a-f]{32})\.png/);
    expect(m1).toBeTruthy();
    expect(m2).toBeTruthy();
    expect(m2![1]).toBe(m1![1]); // 去重：两篇指向同一 MD5 本地文件
    // 两篇链接都不再含外链
    expect(wText).not.toContain(httpBase);
    expect(vText).not.toContain(httpBase);
    // 该 MD5 文件确实落盘（同一外链仅一份）
    expect(files).toContain(`assets/${m1![1]}.png`);
    // 排除目录笔记未被处理，仍含外链
    const skipText = fs.readFileSync(nodePath.join(VAULT_ROOT, 'excluded/Skip.md'), 'utf8');
    expect(skipText).toContain(httpBase);
  });

  it('预览列出被拦截的引用并可点击定位（不只看数字）', async () => {
    const dataUri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAIhQGAXbM3ZQAAAABJRU5ErkJggg==';
    plugin.settings.naming.enabled = false;
    // 只拦 127.0.0.1：data: 引用仍可下载 → 本次既「有可下载项」又「有被拦截项」
    plugin.settings.localize.denyHosts = ['127.0.0.1'];
    writeText(VAULT_ROOT, 'Blocked.md', `# b\n\n![ok](${dataUri})\n\n![bad](${httpBase}/blocked.png)\n`);

    await command('attachment:bulk-localize')();

    const modals = handle.app._modals;
    const modal = modals[modals.length - 1] as any;
    const opts = modal.opts;
    // 描述里如实给出「将被拦截」的数量
    expect(String(opts.desc)).toContain('将被拦截');
    // 被拦截清单逐条列出：原因 + URL + 来源笔记
    const blockedItems = opts.blocked?.items ?? [];
    const mine = blockedItems.find((i: any) => String(i.from).includes('/blocked.png'));
    expect(mine).toBeTruthy();
    expect(mine.reason).toBe('域名黑名单');
    expect(mine.to).toBe('Blocked');

    // 可点击定位：点该行应打开来源笔记（验证跳转链路真的通）
    const rows = modal.contentEl.querySelectorAll('iap-confirm-row-clickable');
    expect(rows.length).toBe(blockedItems.length);
    const idx = blockedItems.findIndex((i: any) => String(i.from).includes('/blocked.png'));
    handle.openedNotePaths.length = 0;
    rows[idx].click();
    await new Promise((r) => setTimeout(r, 0));
    expect(handle.openedNotePaths).toEqual(['Blocked.md']);
  });

  it('全部外链都被拦截时，打开只读清单（而非“没有可本地化的引用”）', async () => {
    plugin.settings.naming.enabled = false;
    plugin.settings.localize.denyHosts = ['127.0.0.1'];
    // 仅一个外链且被拦截 → 可下载数为 0，但必须让用户看到拦了什么
    const fs = require('node:fs');
    const dir = nodePath.join(VAULT_ROOT, 'onlyblocked');
    fs.mkdirSync(dir, { recursive: true });
    writeText(VAULT_ROOT, 'onlyblocked/OB.md', `# ob\n\n![x](${httpBase}/ob.png)\n`);
    // 让库内除该笔记外没有其它可下载外链：清掉夹具里带外链的 NoteA
    fs.rmSync(nodePath.join(VAULT_ROOT, 'NoteA.md'), { force: true });

    await command('attachment:bulk-localize')();

    const modal = handle.app._modals[handle.app._modals.length - 1] as any;
    expect(String(modal.opts?.title)).toContain('无可下载外链');
    const items = modal.opts?.sections?.[0]?.items ?? [];
    expect(items.length).toBe(1);
    expect(String(items[0].text)).toContain('/ob.png');
    expect(typeof items[0].onClick).toBe('function');
  });
});

/* ==================== 16. 批量通知收敛（不逐篇刷屏） ==================== */

describe('16. 批量通知收敛（不逐篇刷屏）', () => {
  it('全库命名大量笔记只产生一条汇总通知', async () => {
    // 构造大量笔记、各一张独占附件，模拟“几百个操作”的压力场景
    const noteCount = 60;
    for (let i = 0; i < noteCount; i++) {
      writeText(VAULT_ROOT, `N${i}.md`, `# N${i}\n\n![[assets/n${i}.png]]\n`);
      writeBinary(VAULT_ROOT, `assets/n${i}.png`, tinyImage('png'));
    }
    obsidian._registry.notices = []; // 清零，聚焦本次批量产生的横幅通知

    await command('attachment:bulk-rename')();
    await runConfirm();

    const notices = obsidian._registry.notices;
    const summaries = notices.filter((n) => String(n.message).includes('全库命名完成'));
    // 收敛：即便处理 60 篇也只弹 1 条汇总，绝不逐篇刷屏
    expect(summaries).toHaveLength(1);
    // 汇总携带总计数（夹具 NoteA 等已含若干独占附件，数字可大于 60）
    expect(String(summaries[0].message)).toMatch(/重命名 \d+/);
    expect(String(summaries[0].message)).toContain('失败 0');
    // 若曾逐篇通知会是 60+ 条；这里仅「命令开始 + 汇总」两条数量级
    expect(notices.length).toBeLessThanOrEqual(3);
  });

  it('全库本地化多篇只产生一条汇总通知', async () => {
    // 多篇笔记各含一条外链，验证批量本地化同样收敛为单条汇总
    const noteCount = 8;
    for (let i = 0; i < noteCount; i++) {
      writeText(VAULT_ROOT, `L${i}.md`, `# L${i}\n\n![p](${httpBase}/logo.png)\n`);
    }
    obsidian._registry.notices = [];

    handle.open('L0.md');
    await command('attachment:bulk-localize')();
    await runConfirm();

    const notices = obsidian._registry.notices;
    const summaries = notices.filter((n) => String(n.message).includes('全库本地化完成'));
    // 收敛：8 篇只弹 1 条汇总
    expect(summaries).toHaveLength(1);
    expect(String(summaries[0].message)).toContain('全库本地化完成');
    expect(notices.length).toBeLessThanOrEqual(3);
  });
});

/* ==================== 17. 断链修复（候选式安全重链） ==================== */

describe('17. 断链修复', () => {
  it('一致性总开关关闭时命令直接返回，不改写任何笔记', async () => {
    // 这条引用有唯一同名候选（走自动层），若门禁缺失会弹预览/直接改写 → 故用通知断言门禁生效
    writeBinary(VAULT_ROOT, 'assets/target.png', tinyImage('png'));
    writeText(VAULT_ROOT, 'GateBroken.md', '# G\n\n![x](wrongdir/target.png)\n');
    obsidian._registry.notices = [];
    const prev = plugin.settings.consistency.enabled;
    plugin.settings.consistency.enabled = false;
    try {
      await command('attachment:fix-broken-links')();
      expect(obsidian._registry.notices.some((n) => String(n.message).includes('一致性能力已关闭'))).toBe(true);
      const text = nodeFs.readFileSync(nodePath.join(VAULT_ROOT, 'GateBroken.md'), 'utf-8');
      expect(text).toContain('wrongdir/target.png'); // 未被改写
    } finally {
      plugin.settings.consistency.enabled = prev;
    }
  });

  it('大小写差异候选进入交互弹窗，选择后改写断链', async () => {
    // 场景：真实文件 assets/target.png，但笔记引用了大小写不符的 olddir/Target.png
    // —— basename 大小写不匹配 → 报断链；候选唯一（忽略大小写命中）→ 交互候选（大小写保持敏感）
    writeBinary(VAULT_ROOT, 'assets/target.png', tinyImage('png'));
    writeText(VAULT_ROOT, 'BrokenFix.md', '# BrokenFix\n\n![x](olddir/Target.png)\n[[still-broken.png]]\n');
    obsidian._registry.notices = [];

    await command('attachment:fix-broken-links')();
    // 交互弹窗：选择唯一候选 assets/target.png 修复
    await pickCandidate(0);

    const text = nodeFs.readFileSync(nodePath.join(VAULT_ROOT, 'BrokenFix.md'), 'utf-8');
    expect(text).toContain('![x](assets/target.png)');
    expect(text).not.toContain('olddir/Target.png');
    // still-broken.png 无任何候选 → 不改，保持原样（数据安全）
    expect(text).toContain('[[still-broken.png]]');

    // 重建一致性报告：修好的那条断链消失，仍断的报告里只保留无法确定的
    handle.open('BrokenFix.md');
    await command('attachment:check-consistency')();
    const m = freshModalOpts();
    const broken = m?.sections?.find((s: any) => s.title === '需修复的引用（断链 / URL 编码）');
    const items: string[] = (broken?.items ?? []).map((i: any) => String(typeof i === 'string' ? i : i.text));
    expect(items.filter((t) => t.includes('still-broken'))).toHaveLength(1);
    expect(items.filter((t) => t.includes('target.png'))).toHaveLength(0);
  });

  it('同名候选多个（无法唯一确定）时进入交互弹窗，全部跳过则不改文件', async () => {
    // 两个目录下都有同名 target3.png，引用大小写不符的 TARGET3.png → 多候选 → 交互弹窗
    writeBinary(VAULT_ROOT, 'assets/target3.png', tinyImage('png'));
    writeBinary(VAULT_ROOT, 'sub/target3.png', tinyImage('png'));
    writeText(VAULT_ROOT, 'Wait.md', '# Wait\n\n![x](gone/TARGET3.png)\n');
    obsidian._registry.notices = [];

    await command('attachment:fix-broken-links')();
    // 交互弹窗：全部跳过 → 不修改任何文件
    skipAllCandidates();

    const text = nodeFs.readFileSync(nodePath.join(VAULT_ROOT, 'Wait.md'), 'utf-8');
    expect(text).toContain('gone/TARGET3.png'); // 未改动
  });

  it('%20 编码引用解码后命中真实文件时不再误报断链', async () => {
    // 真实文件 assets/my img.png；引用写 %20 编码 → 检测层解码识别有效，不报断链
    writeBinary(VAULT_ROOT, 'assets/my img.png', tinyImage('png'));
    writeText(VAULT_ROOT, 'Encoded.md', '# E\n\n![x](attachments/my%20img.png)\n');
    obsidian._registry.notices = [];

    await command('attachment:check-consistency')();
    const m = freshModalOpts();
    const broken = m?.sections?.find((s: any) => s.title === '需修复的引用（断链 / URL 编码）');
    const items: string[] = (broken?.items ?? []).map((i: any) => String(typeof i === 'string' ? i : i.text));
    expect(items.some((t) => t.includes('my%20img.png'))).toBe(false);

    const text = nodeFs.readFileSync(nodePath.join(VAULT_ROOT, 'Encoded.md'), 'utf-8');
    expect(text).toContain('my%20img.png'); // 文件未被修改
  });

  it('wiki 无扩展名断链（[[ghostpic]]）被检出且无候选时不修改', async () => {
    // 纯 basename 的 wiki 无扩展名引用，双无（无笔记无附件）→ 报断链；无候选 → 保持原样
    writeText(VAULT_ROOT, 'WikiBroken.md', '# W\n\n[[ghostpic]]\n');
    obsidian._registry.notices = [];

    await command('attachment:check-consistency')();
    const m = freshModalOpts();
    const broken = m?.sections?.find((s: any) => s.title === '需修复的引用（断链 / URL 编码）');
    const items: string[] = (broken?.items ?? []).map((i: any) => String(typeof i === 'string' ? i : i.text));
    expect(items.some((t) => t.includes('ghostpic'))).toBe(true);

    await command('attachment:fix-broken-links')();
    const text = nodeFs.readFileSync(nodePath.join(VAULT_ROOT, 'WikiBroken.md'), 'utf-8');
    expect(text).toContain('[[ghostpic]]'); // 无候选，保持原样
  });

  it('HTML <img> 断链被检出且无候选时不修改', async () => {
    // <img src="assets/gone.png"> 无任何同名文件 → 报 html 断链；无候选 → 保持原样
    writeText(VAULT_ROOT, 'HtmlImg.md', '# H\n\n<img src="assets/gone.png" alt="图">\n');
    obsidian._registry.notices = [];

    await command('attachment:check-consistency')();
    const m = freshModalOpts();
    const broken = m?.sections?.find((s: any) => s.title === '需修复的引用（断链 / URL 编码）');
    const items: string[] = (broken?.items ?? []).map((i: any) => String(typeof i === 'string' ? i : i.text));
    expect(items.some((t) => t.includes('assets/gone.png'))).toBe(true);

    await command('attachment:fix-broken-links')();
    const text = nodeFs.readFileSync(nodePath.join(VAULT_ROOT, 'HtmlImg.md'), 'utf-8');
    expect(text).toContain('<img src="assets/gone.png" alt="图">'); // 无候选，保持原样
  });
});

/* ==================== 18. 点击定位到断链所在笔记（reveal-ref，此前全仓库零用例） ==================== */
/**
 * 为什么单独一条：`revealRefInNote` 在覆盖审计里是**唯一全零覆盖**的功能。
 * 报告里"点击定位"看着是个小交互，但它的价值恰在"**打开 ≠ 定位**"这条分界上：
 * 早期替身把 `setCursor`/`scrollIntoView` 写成空实现，于是"只打开笔记、完全不定位"也照样绿。
 * 替身现已记录这两个调用，本用例据此断言"真的滚到了引用所在那一行"。
 */
describe('18. 点击定位到断链所在笔记', () => {
  const NOTE = 'Reveal.md';

  it('报告里点击断链条目：打开笔记**并定位到引用所在行**', async () => {
    // 引用放在第 5 行（0 基 4），前后各有内容，确保"落到正确行"是可判别的
    writeText(VAULT_ROOT, NOTE, '# r\n\n第一行\n\n![x](lost/reveal.png)\n\n最后一行\n');

    await command('attachment:check-consistency')();
    const m = freshModalOpts();
    const section = (m?.sections ?? []).find(
      (s: any) => s.title === '需修复的引用（断链 / URL 编码）',
    );
    expect(section, '报告里没有「需修复的引用」分区').toBeTruthy();

    const item = (section.items ?? []).find(
      (i: any) => i && typeof i === 'object' && String(i.text ?? '').includes(NOTE),
    );
    expect(item, `报告里没有 ${NOTE} 的断链条目`).toBeTruthy();
    expect(String(item.text)).toContain('lost/reveal.png');
    expect(item.onClick, '断链条目没有提供定位回调（点击无效）').toBeTypeOf('function');

    handle.openedNotePaths.length = 0;
    handle.editorCalls.length = 0;
    item.onClick();
    await new Promise((r) => setTimeout(r, 0));

    expect(handle.openedNotePaths, '点击断链条目没有打开对应笔记').toContain(NOTE);
    const cursor = handle.editorCalls.filter((c) => c.kind === 'cursor');
    expect(cursor.length, '只打开了笔记却没有定位——"打开 ≠ 定位到引用"').toBeGreaterThan(0);
    expect(cursor[0].line, `光标落在第 ${cursor[0].line + 1} 行，而不是引用所在的第 5 行`).toBe(4);
    expect(
      handle.editorCalls.some((c) => c.kind === 'scroll' && c.line === 4),
      '没有滚动到引用所在行（用户看不到它，等于没定位）',
    ).toBe(true);
  });

  it('边界：笔记不存在时静默返回，不得抛错、也不得乱开别的笔记', async () => {
    handle.openedNotePaths.length = 0;
    const { revealRefInNote } = await import('../../src/reveal-ref');
    await expect(revealRefInNote(handle.app, 'Nowhere.md', 'x')).resolves.toBeUndefined();
    expect(handle.openedNotePaths, '笔记不存在却打开了别的东西').toEqual([]);
  });

  it('边界：文本里找不到该引用时仍打开笔记，但不得把光标设到错误位置', async () => {
    writeText(VAULT_ROOT, NOTE, '# r\n\n没有任何引用\n');
    handle.openedNotePaths.length = 0;
    handle.editorCalls.length = 0;
    const { revealRefInNote } = await import('../../src/reveal-ref');
    await revealRefInNote(handle.app, NOTE, 'lost/不存在.png');
    expect(handle.openedNotePaths, '找不到引用时也应当把笔记打开（便于人工处理）').toContain(NOTE);
    expect(handle.editorCalls, '找不到引用的位置却设置了光标/滚动了视图').toEqual([]);
  });
});

/* ==================== 19. 粘贴即处理（X01） ==================== */
/**
 * 覆盖审计里 `X01` 是"故意不设机器校验"的三条之一——它在**验收夹具的断言表**里表达不出来
 * （断言表只拿得到最终状态，既改不了设置也发不出事件）。但"粘贴即处理"本身可以被验证：
 * 替身早已提供 `emitPaste`，只需把 automation 打开。
 * 用 **data URI** 而不是外链：本地化 data 图片不发起网络请求，用例因此与网络无关。
 */
describe('19. 粘贴即处理', () => {
  const DATA_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAIhQGAXbM3ZQAAAABJRU5ErkJggg==';

  it('在笔记里粘贴含图片的内容：该笔记应被自动本地化（无需手动跑命令）', async () => {
    plugin.settings.automation.enabled = true;
    plugin.settings.automation.interval = 1;
    plugin.settings.localize.enabled = true;
    plugin.settings.localize.useMd5ForNew = false;
    // 定时器必须在"启用之后确实存在"：onload 时若读到的配置是关的，就根本没建定时器
    // （设置页正是靠失焦时调它来兑现"改了间隔立即生效"这个承诺）。
    plugin.restartAutomationSweep();

    // ⚠️ 关键前提：替身的 `emitPaste` **只发事件、不写内容**——真实宿主里"把粘贴内容插进笔记"
    // 是编辑器的职责，插件只负责"据此标记该笔记待处理"。
    // 所以这里先按编辑器行为把内容写进笔记（`writeText` 直接落盘、**不发 vault 事件**），
    // 再发粘贴事件。这样就**隔离出粘贴这条路径**：若 onPaste 的标记失效，就没有任何事件能触发处理，
    // 断言必然失败（否则会被 vault 'modify' 事件掩盖）。
    const pasted = '![](' + DATA_PNG + ')';
    writeText(VAULT_ROOT, 'Paste.md', '# p\n\n' + pasted + '\n');
    handle.open('Paste.md');
    // 真实浏览器粘贴时会同时提供 html 与 plain，这里两者都给，贴近真实剪贴板
    handle.emitPaste({
      textHtml: '<img src="' + DATA_PNG + '">',
      textPlain: pasted,
    });

    const file = nodePath.join(VAULT_ROOT, 'Paste.md');
    let text = '';
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      text = nodeFs.readFileSync(file, 'utf8');
      if (text.includes('assets/') && !text.includes('data:image')) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    plugin.settings.automation.enabled = false; // 收尾：别让后续用例被后台轮询干扰

    expect(text, '粘贴后笔记没有被自动处理——"粘贴即处理"的链路未生效').not.toContain('data:image');
    expect(text, `粘贴的图片应已落盘并被引用：${text}`).toContain('assets/');
  }, 20000); // 需要等后台轮询（间隔 1s + 处理时间），默认 5s 不够
});
/* ==================== 20. 自动处理的启动门与批量护栏（防"打开库即批量改写"） ==================== */
/**
 * 这两道防线保护同一个后果：**用户只是打开了 Obsidian，整个库的附件被改名/搬走**。
 * 自动处理走的是 `runRenameNote(..., confirm=false)`，**不弹确认框**，所以一旦漏判，
 * 用户只有事后的一串 Notice。此前它们不可验证：抑制窗口写成 `isTestEnv ? 0 : 1500`，
 * 测试环境恒为 0 → 该分支在任何测试里一次都不执行，改坏了也不会红。
 */
describe('20. 自动处理的启动门与批量护栏', () => {
  /** 轮询等待条件成立（自动处理在后台队列里跑，没有可 await 的句柄）。 */
  async function waitUntil(pred: () => boolean, timeoutMs = 8000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (pred()) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return pred();
  }

  /** 打开自动化并把轮询缩短到 1 秒；guard 可按用例覆盖。 */
  function armAutomation(overrides: Partial<typeof DEFAULT_AUTOMATION_GUARD> = {}): void {
    plugin.automationGuard = { ...DEFAULT_AUTOMATION_GUARD, postSettleQuietMs: 0, ...overrides };
    plugin.settings.automation.enabled = true;
    plugin.settings.automation.interval = 1;
    plugin.settings.naming.enabled = true;
    plugin.restartAutomationSweep();
  }

  /** 造一篇"有活可干"的笔记：它引用的附件名字不合规，自动处理会把它规范命名并搬进 assets/。 */
  function seedNoteWithAttachment(name: string): string {
    const dir = name.toLowerCase() + '-raw';
    writeBinary(VAULT_ROOT, dir + '/pic.png', tinyImage('png'));
    writeText(
      VAULT_ROOT,
      name + '.md',
      '# ' + name + '\n\n' + '![x](' + dir + '/pic.png)' + '\n',
    );
    return name + '.md';
  }

  /** 库根下的绝对路径（本文件没有全局 abs 助手）。 */
  const absPath = (rel: string): string => nodePath.join(VAULT_ROOT, rel);
  const noteText = (rel: string): string => nodeFs.readFileSync(absPath(rel), 'utf8');

  it('库索引未就绪时的 changed 不得触发自动改写（"打开即批量处理"的入口）', async () => {
    // settleDeadlineMs 给足：本用例要断言的是"未就绪就不动"，不能被兜底放行打断
    armAutomation({ settleDeadlineMs: 600000 });
    const note = seedNoteWithAttachment('Guard');

    // 关键：**不**发 metadataCache.resolved —— 模拟"插件已 ready，库还在索引"
    handle.emitChanged(note);
    await new Promise((r) => setTimeout(r, 2400)); // 覆盖 2 个轮询间隔

    expect(noteText(note), '库未就绪就改写笔记（打开库会静默批量改写整个库）').toContain('guard-raw/pic.png');
    expect(nodeFs.existsSync(absPath('guard-raw/pic.png')), '附件被搬走了').toBe(true);
  }, 20000);

  it('对照：库就绪后收到的 changed 会被正常处理（门不是永久关着）', async () => {
    armAutomation();
    const note = seedNoteWithAttachment('Ready');

    handle.emitMetadataResolved();
    handle.emitChanged(note);

    const done = await waitUntil(() => !noteText(note).includes('ready-raw/pic.png'));
    expect(done, `库就绪后仍未自动处理：${noteText(note)}`).toBe(true);
    // 断言的是"被规范命名"而不是"进了 assets/"：「命名」只在改名（原地），把附件搬进
    // 目标目录是「本地化/收集」的职责。按目录断言会把两件事混为一谈（此处曾写错一次）。
    expect(noteText(note), `引用未指向规范命名后的位置：${noteText(note)}`).toMatch(/_image_001\.png/);
  }, 20000);

  it('批量护栏：一次标脏数不合常理时整批拒绝，并给出不受通知级别影响的告知', async () => {
    armAutomation({ maxPerSweep: 2 });
    // 静默档：拒绝服务属于"必须让用户知道"的信息，不能因为选了静默就无声
    plugin.settings.notificationLevel = 'silent';
    obsidian._registry.notices = [];

    const notes = ['Bulk1', 'Bulk2', 'Bulk3'].map((n) => seedNoteWithAttachment(n));
    handle.emitMetadataResolved();
    for (const n of notes) handle.emitChanged(n);

    await new Promise((r) => setTimeout(r, 2400));

    for (const n of notes) {
      expect(noteText(n), `${n} 被批量改写了——护栏没拦住`).toMatch(/-raw\/pic\.png/);
    }
    const refusal = obsidian._registry.notices.filter((x) => String(x.message).includes('已跳过本次'));
    expect(refusal.length, '整批拒绝却没有任何提示：用户只会以为"功能没生效"').toBeGreaterThan(0);
    expect(String(refusal[0].message), '提示没说明该怎么办').toContain('手动执行');
  }, 20000);

  it('批量护栏的边界：恰好等于上限时正常处理（护栏不是"把自动化关掉"）', async () => {
    armAutomation({ maxPerSweep: 2 });
    const notes = ['Edge1', 'Edge2'].map((n) => seedNoteWithAttachment(n));
    handle.emitMetadataResolved();
    for (const n of notes) handle.emitChanged(n);

    const done = await waitUntil(() => notes.every((n) => !noteText(n).includes('-raw/pic.png')));
    expect(done, `恰好等于上限却被拒绝：${notes.map(noteText).join(' | ')}`).toBe(true);
  }, 20000);

  it('事件与定时器都交给了宿主托管：卸载清理后不再触发（防重载插件后事件叠加）', async () => {
    // 真实宿主在禁用/重载插件时会执行这些托管清理。若插件注册事件时漏了 registerEvent
    // （或定时器漏了 registerInterval），重载后旧回调仍在 → 同一篇笔记被处理两次、定时器越堆越多。
    // 替身此前把 registerEvent 写成空实现、也没有 register，这类缺陷在 CI 里完全隐身。
    armAutomation();
    const handlers = (): Record<string, Set<unknown>> => handle.getEventHandlers();
    expect(handlers().resolved?.size ?? 0, '插件没有把「索引就绪」事件交给宿主托管').toBeGreaterThan(0);
    expect(handlers().changed?.size ?? 0).toBeGreaterThan(0);

    plugin.onunload();
    handle.runPluginCleanups();

    expect(handlers().resolved?.size ?? 0, '卸载后「索引就绪」回调仍挂着').toBe(0);
    expect(handlers().changed?.size ?? 0, '卸载后 metadataCache.changed 回调仍挂着').toBe(0);
    expect(handlers()['editor-paste']?.size ?? 0, '卸载后粘贴回调仍挂着').toBe(0);
  }, 20000);
});
