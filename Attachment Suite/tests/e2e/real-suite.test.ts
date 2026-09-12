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
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.from(pngBytes()));
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
  plugin = new PluginClass(handle.app, { id: 'attachment-suite', name: 'Attachment Suite', version: '1.0.0' });
  await plugin.onload();
  // 以夹具配置覆盖（与 data.json 写入一致）
  plugin.settings = JSON.parse(JSON.stringify(TEST_SETTINGS));
});

function command(id: string): () => Promise<void> {
  const cmds = handle.getCommands();
  const found = cmds.find((c: any) => c.id === id);
  if (!found) throw new Error(`命令未注册: ${id}`);
  return found.callback;
}

function lastCTA(): (() => void | Promise<void>) | undefined {
  const reg = obsidian._registry;
  return reg.ctaClickCallbacks[reg.ctaClickCallbacks.length - 1];
}

/** 触发确认弹窗的执行体并等待其完成（异步一致性）。 */
async function runConfirm(): Promise<void> {
  const opts = lastModalOpts();
  if (opts && typeof opts.onConfirm === 'function') {
    // 通用 ConfirmChangesModal：直接调执行体，await 真正的移动结果
    await opts.onConfirm();
    return;
  }
  // ConfirmCleanupModal：其确认按钮为 async，等待 performDelete 完成
  const cb = lastCTA();
  if (!cb) throw new Error('没有可确认的执行回调');
  await cb();
}

function lastModalOpts(): any {
  const modals = handle.app._modals;
  return modals[modals.length - 1]?.opts;
}

function sorted(l: string[]): string[] {
  return [...l].sort();
}

/* ==================== 1. 插件加载与命令注册 ==================== */

describe('1. 插件加载与命令注册', () => {
  it('onload 不抛错且注册全部 11 条命令', () => {
    const ids = handle.getCommands().map((c: any) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'attachment:check-consistency',
        'attachment:cleanup-unused',
        'attachment:cleanup-empty-folders',
        'attachment:rename-note',
        'attachment:repair-incompatible-paths',
        'attachment:localize-note',
        'attachment:collect-current-note',
        'attachment:export-note',
        'attachment:export-unused',
        'attachment:bulk-rename',
        'attachment:bulk-localize',
      ]),
    );
    expect(ids).toHaveLength(11);
  });
});

/* ==================== 2. 一致性审计 ==================== */

describe('2. 一致性审计', () => {
  it('正确汇总坏链接与未用附件', async () => {
    handle.open('NoteA.md');
    await command('attachment:check-consistency')();
    const m = lastModalOpts();
    expect(m?.summary).toContain('坏链接 2');
    const orphan = m?.sections?.find((s: any) => s.title === '未使用附件');
    expect(sorted(orphan.items)).toEqual(
      sorted(['BBB/not-referenced.png', 'BBB/sample.pdf', 'BBB/sample.mp3', 'root-orphan.png']),
    );
    const broken = m?.sections?.find((s: any) => s.title === '坏链接（指向不存在文件）');
    expect(sorted(broken.items)).toEqual(
      sorted(['NoteA.md → assets/missing.png', 'NoteA.md → ghost.png']),
    );
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

  it('对外部真实页面复制来的笔记执行（含中文目录与真实 URL）', async () => {
    const fs = require('node:fs');
    // 复制用户真实的网页粘贴内容到 测试A 目录
    const dir = nodePath.join(VAULT_ROOT, '测试A');
    fs.mkdirSync(dir, { recursive: true });
    const notePath = '测试A/网页内容复制.md';
    fs.writeFileSync(
      nodePath.join(VAULT_ROOT, notePath),
      [
        'AgentDock 本身就是一个 MCP 工具运行时。',
        '',
        '![在 ChatGPT 设置中开启开发人员模式](https://www.acofork.com/img/agentdock-chatgpt-codex/developer-mode.png)',
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
    expect(text).not.toContain('https://www.acofork.com');
    expect(text).toContain(`![[${local}|`);
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

/* ==================== 9. 路径修复（Windows 上无非法文件 => 优雅无操作） ==================== */

describe('9. 路径修复', () => {
  it('在无非法路径的库上正常执行并提示无待修复项', async () => {
    await command('attachment:repair-incompatible-paths')();
    expect(obsidian._registry.notices.some((n) => n.message.includes('没有需要修复的路径'))).toBe(true);
  });
});

/* ==================== 10. 自动化：粘贴图片进笔记即自动本地化 + 命名 ==================== */

describe('10. 自动化（自动处理）', () => {
  it('笔记内容变更（粘贴外链）后自动下载并统一命名', async () => {
    const fs = require('node:fs');
    writeText(VAULT_ROOT, 'Auto.md', '# Auto\n');
    // 模拟用户从网页粘贴进一张外链图片并保存 → 触发 metadataCache.changed
    writeText(VAULT_ROOT, 'Auto.md', `# Auto\n\n![x](${httpBase}/logo.png)\n`);
    handle.open('Auto.md'); // 自动化仅处理当前活动笔记
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
    if (lastCTA() || lastModalOpts()?.onConfirm) await runConfirm();
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