import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { seedFixture, TEST_SETTINGS, listVault } from './fixture';
import { buildTestApp, writeText, writeBinary, tinyImage, systemTrashDir } from './infrastructure';
import type { TestAppHandle, ObsidianModule } from './infrastructure';
import '../mocks/obsidian-stub';

let VAULT_ROOT = '';

beforeAll(() => {
  (globalThis as any).window = globalThis;
  VAULT_ROOT = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'iap-safety-'));
});

afterAll(() => {
  nodeFs.rmSync(VAULT_ROOT, { recursive: true, force: true });
});

let obsidian: ObsidianModule;
let handle: TestAppHandle;
let plugin: any;

beforeEach(async () => {
  obsidian = (globalThis as any).__OBSIDIAN_TEST;
  obsidian._registry.notices = [];
  obsidian._registry.ctaClickCallbacks = [];
  obsidian._registry.commands = [];
  obsidian._registry.modals = [];
  seedFixture(VAULT_ROOT);
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
  plugin.settings = JSON.parse(JSON.stringify(TEST_SETTINGS));
});

/** 本命令开始时的"弹窗/按钮水位"，用于把确认限定在本命令自己开出的弹窗上（见 real-suite 同名注释）。 */
let modalMark = 0;
let ctaMark = 0;

function command(id: string): () => void | Promise<void> {
  const found = handle.getCommands().find((c: any) => c.id === id);
  if (!found) throw new Error(`命令未注册: ${id}`);
  return () => {
    modalMark = handle.app._modals.length;
    ctaMark = obsidian._registry.ctaButtons.length;
    return found.callback();
  };
}

function freshModalOpts(): any {
  const fresh = handle.app._modals.slice(modalMark);
  return fresh[fresh.length - 1]?.opts;
}

/** 本命令新创建的按钮回调；可按按钮文案取。 */
function freshCTA(text?: string): (() => void | Promise<void>) | undefined {
  const fresh = obsidian._registry.ctaButtons.slice(ctaMark);
  return (text ? fresh.filter((b) => b.text.includes(text)).pop() : fresh.pop())?.onClick;
}

async function runConfirm(): Promise<void> {
  const opts = freshModalOpts();
  if (opts && typeof opts.onConfirm === 'function') {
    await opts.onConfirm();
    return;
  }
  const cb = freshCTA();
  if (!cb) throw new Error('本命令没有开确认窗（用例可能没有覆盖到预期路径）');
  await cb();
}

/** 容忍"没有弹窗"的确认：用于结果不确定（可能早退）的命令。 */
async function maybeConfirm(): Promise<void> {
  const opts = freshModalOpts();
  if (opts && typeof opts.onConfirm === 'function') {
    await opts.onConfirm();
    return;
  }
  const cb = freshCTA();
  if (cb) await cb();
}

const abs = (rel: string): string => nodePath.join(VAULT_ROOT, rel);
const exists = (rel: string): boolean => nodeFs.existsSync(abs(rel));

/* ==================== A. 清理未用：误删安全矩阵 ==================== */

describe('A. 清理未用不得误删「仍被引用」的附件', () => {
  it('七种引用形态（短名/无扩展名/URL 编码/canvas/frontmatter/HTML/正文）全部受保护', async () => {
    // 每个附件只通过一种"不那么显眼"的语法被引用，逐一验证它们不会被判为孤儿
    writeBinary(VAULT_ROOT, 'assets/short.png', tinyImage('png'));
    writeBinary(VAULT_ROOT, 'assets/noext.png', tinyImage('png'));
    writeBinary(VAULT_ROOT, 'assets/enc oded.png', tinyImage('png'));
    writeBinary(VAULT_ROOT, 'assets/cv.png', tinyImage('png'));
    writeBinary(VAULT_ROOT, 'assets/fm.png', tinyImage('png'));
    writeBinary(VAULT_ROOT, 'assets/html.png', tinyImage('png'));
    writeBinary(VAULT_ROOT, 'assets/plain.png', tinyImage('png'));

    // 短名嵌入（basename 唯一）
    writeText(VAULT_ROOT, 'SafeShort.md', '# s\n\n![[short.png]]\n');
    // 无扩展名 wiki 引用
    writeText(VAULT_ROOT, 'SafeNoExt.md', '# n\n\n![[noext]]\n');
    // URL 编码引用（含空格）
    writeText(VAULT_ROOT, 'SafeEnc.md', '# e\n\n![x](assets/enc%20oded.png)\n');
    // frontmatter 引用
    writeText(VAULT_ROOT, 'SafeFm.md', '---\ncover: assets/fm.png\n---\n\n# f\n');
    // HTML 标签引用
    writeText(VAULT_ROOT, 'SafeHtml.md', '# h\n\n<img src="assets/html.png">\n');
    // 正文普通引用（对照）
    writeText(VAULT_ROOT, 'SafePlain.md', '# p\n\n![x](assets/plain.png)\n');
    // canvas file 节点引用
    nodeFs.writeFileSync(
      abs('SafeCanvas.canvas'),
      JSON.stringify({
        nodes: [
          { id: 'n1', type: 'file', file: 'assets/cv.png', x: 0, y: 0, width: 100, height: 100 },
        ],
        edges: [],
      }),
    );

    await command('attachment:cleanup-unused')();
    await runConfirm();

    // 全部"被引用"的附件必须还在
    for (const p of [
      'assets/short.png',
      'assets/noext.png',
      'assets/enc oded.png',
      'assets/cv.png',
      'assets/fm.png',
      'assets/html.png',
      'assets/plain.png',
    ]) {
      expect(exists(p), `被引用的附件被误删：${p}`).toBe(true);
    }
    // 夹具里真正没人引用的孤儿应当被清掉（确认清理确实执行了）
    expect(exists('BBB/not-referenced.png')).toBe(false);
  });

  it('引用路径含空格 / %20 时，附件仍须算「在用」而不得被误删', async () => {
    // 背景：链接解析若按空白截断目标（旧实现 `([^)\s]+)`），`assets/my pic.png` 会被读成
    // `assets/my`（扩展名丢失）→ 该引用不进"在用"集合 → 附件被当孤儿删除。
    // 而"含空格的名字"恰恰是插件自身命名功能最常产生的形态（`笔记名_image_001.png`）。
    writeBinary(VAULT_ROOT, 'assets/my pic.png', tinyImage('png'));
    writeBinary(VAULT_ROOT, 'assets/enc oded.png', tinyImage('png'));
    writeText(VAULT_ROOT, 'SpaceRef.md', '# s\n\n![a](assets/my pic.png)\n\n![b](assets/enc%20oded.png)\n');

    await command('attachment:cleanup-unused')();
    await runConfirm();

    expect(exists('assets/my pic.png'), '含空格引用的附件被误删').toBe(true);
    expect(exists('assets/enc oded.png'), '%20 引用对应的附件被误删').toBe(true);
  });

  it('只含点文件的目录视为非空，不得被当作空目录清理', async () => {
    // 背景：库索引（getFiles/getAllLoadedFiles）**不含点文件**，因此"只含 .DS_Store / .gitkeep 的目录"
    // 在索引视角是空的。若不回查真实文件系统就删除，macOS 上几乎无处不在的 .DS_Store、
    // 以及用户明确用来占位的 .gitkeep 都会连带目录被移入回收站。删除前须回查 `adapter.list`。
    nodeFs.mkdirSync(nodePath.join(VAULT_ROOT, 'dotonly'), { recursive: true });
    nodeFs.writeFileSync(nodePath.join(VAULT_ROOT, 'dotonly/.DS_Store'), 'not-empty');
    nodeFs.mkdirSync(nodePath.join(VAULT_ROOT, 'reallyempty'), { recursive: true });

    await command('attachment:cleanup-empty-folders')();
    await maybeConfirm();

    expect(nodeFs.existsSync(nodePath.join(VAULT_ROOT, 'dotonly')), '只含点文件的目录被误清理').toBe(true);
    expect(
      nodeFs.existsSync(nodePath.join(VAULT_ROOT, 'reallyempty')),
      '真空目录未被清理（命令可能没生效，这条用于自证）',
    ).toBe(false);
  });

  it('单篇改名/移动后，其它引用该附件的笔记不得出现新断链', async () => {
    // 场景：同一附件被两篇笔记同时引用，其中一篇的引用走 **HTML 标签**——
    // Obsidian 的改名联动不认识这种写法（它只认 markdown/wiki 链接），
    // 所以"别的笔记的引用会不会坏"完全取决于插件自己：要么识别为共享而各留副本，
    // 要么在改写时把引用它的笔记都覆盖到。这是"绕开 fileManager 自己改名"讨论的守卫点。
    writeBinary(VAULT_ROOT, 'assets/dual.png', tinyImage('png'));
    writeText(VAULT_ROOT, 'Cur.md', '# c\n\n![a](assets/dual.png)\n');
    writeText(VAULT_ROOT, 'Other.md', '# o\n\n<img src="assets/dual.png">\n');

    handle.open('Cur.md');
    await command('attachment:rename-note')();
    await maybeConfirm();

    const other = nodeFs.readFileSync(nodePath.join(VAULT_ROOT, 'Other.md'), 'utf8');
    const m = other.match(/<img src="([^"]+)"/);
    expect(m, 'Other.md 的 HTML 引用被改没了').not.toBeNull();
    expect(
      nodeFs.existsSync(nodePath.join(VAULT_ROOT, m![1])),
      `Other.md 的 HTML 引用悬空：${m![1]}`,
    ).toBe(true);
  });

  it('当前笔记的 HTML 引用：附件改名后引用必须由插件自己跟上（Obsidian 联动不认识 HTML）', async () => {
    // 为什么单列一条：Obsidian 的 renameFile 联动改写**只认** markdown/wiki/frontmatter，
    // 不认识 `<img src="…">`。测试替身早期会连 HTML 一起改写，于是"引用有没有跟上"
    // 其实是被替身兜掉的——插件即便完全不改写，用例也照样绿。
    // 这里锚定 runRenameNote 末尾的 rewriteRefsInNote 兜底。
    writeBinary(VAULT_ROOT, 'assets/solo.png', tinyImage('png'));
    writeText(VAULT_ROOT, 'Html.md', '# h\n\n<img src="assets/solo.png">\n');
    handle.open('Html.md');

    await command('attachment:rename-note')();
    await maybeConfirm();

    const text = nodeFs.readFileSync(abs('Html.md'), 'utf8');
    const m = text.match(/<img src="([^"]+)"/);
    expect(m, 'Html.md 的 HTML 引用被改没了').not.toBeNull();
    const raw = m![1];
    expect(exists(raw), `HTML 引用悬空：${raw}`).toBe(true);
    // 条件不变式：改了名就必须把引用跟过去；没改名则必须仍是原路径。两种情况都不允许悬空。
    if (exists('assets/solo.png')) {
      expect(raw, '未改名却动了引用').toBe('assets/solo.png');
    } else {
      expect(raw, '附件已改名，但 HTML 引用仍指向旧路径').not.toBe('assets/solo.png');
    }
  });

  it('快照之后新增的引用会让「删除前复检」跳过（复检须与孤儿判定同一口径）', async () => {
    // 回归：复检曾自建一条只读 metadataCache.resolvedLinks 的近似口径，它**不认识 HTML 媒体标签**
    // （Obsidian 不会把 `[t](x)` 之外的 `<img src>` 写进 resolvedLinks），
    // 而孤儿判定层是把 resolvedLinks 与正文文本扫描合并后才下结论的。
    // 于是"删除前复检"比"判谁是孤儿"更弱：确认前一刻新增的 HTML 引用它看不见，附件照样被删。
    writeBinary(VAULT_ROOT, 'assets/late.png', tinyImage('png'));
    writeText(VAULT_ROOT, 'L.md', '# l\n');
    handle.open('L.md');

    await command('attachment:cleanup-unused')(); // 此刻计划里 assets/late.png 是孤儿
    // 用户还没点确认，另一篇笔记用 HTML 标签引用了它
    writeText(VAULT_ROOT, 'Late.md', '# late\n\n<img src="assets/late.png" alt="x">\n');
    await runConfirm();

    expect(exists('assets/late.png'), '快照后新增的 HTML 引用未被复检识别，附件被误删').toBe(true);
  });

  it('排除目录内的未用附件不被清理（含全局排除目录）', async () => {
    writeBinary(VAULT_ROOT, 'keepme/orphan.png', tinyImage('png'));
    const prev = plugin.settings.paths.exclude;
    plugin.settings.paths.exclude = ['keepme'];
    try {
      await command('attachment:cleanup-unused')();
      await runConfirm();
      expect(exists('keepme/orphan.png')).toBe(true);
    } finally {
      plugin.settings.paths.exclude = prev;
    }
  });
});

/* ==================== E. canvas 引用：搬走/改名后不得悬空，更不得被当孤儿删掉 ==================== */

describe('E. canvas 引用的附件在「收集 + 命名 + 清理」链路中必须存活', () => {
  it('canvas 的 file 引用随附件一起改写；附件不得被清理删除', async () => {
    // 回归：插件索引层把 canvas 的 file 节点算作"在用"，但改写层一度不认识 canvas。
    // 于是「收集」把附件搬进 canvas 的归属目录、「全库命名」再改名时，canvas 里的引用原地不动，
    // 下一轮「清理未用附件」就按"没人引用我"把它删进回收站——附件真丢、canvas 真断。
    writeBinary(VAULT_ROOT, 'orphans/cv-only.png', tinyImage('png'));
    nodeFs.mkdirSync(nodePath.join(VAULT_ROOT, 'canvas'), { recursive: true });
    nodeFs.writeFileSync(
      nodePath.join(VAULT_ROOT, 'canvas/Board.canvas'),
      JSON.stringify({ nodes: [{ id: 'n1', type: 'file', file: 'orphans/cv-only.png', x: 0, y: 0, width: 10, height: 10 }], edges: [] }),
    );
    const canvasRefs = (): string[] =>
      (JSON.parse(nodeFs.readFileSync(nodePath.join(VAULT_ROOT, 'canvas/Board.canvas'), 'utf8')).nodes as any[]).map((n) => n.file);
    const allPngs = (): string[] => listVault(VAULT_ROOT).filter((f) => f.endsWith('.png'));

    handle.open('canvas/Board.canvas');

    // 1) 收集：把散落附件搬进 canvas 的归属目录
    await command('attachment:collect-current-note')();
    await runConfirm();
    // 2) 全库命名：改名
    await command('attachment:bulk-rename')();
    await runConfirm();
    // 3) 清理未用：绝不能把刚刚改名过的它当孤儿删掉
    await command('attachment:cleanup-unused')();
    await maybeConfirm();

    const refs = canvasRefs();
    expect(refs, 'canvas 的 file 字段个数变了').toHaveLength(1);
    const target = refs[0];
    expect(
      nodeFs.existsSync(nodePath.join(VAULT_ROOT, target)),
      `canvas 引用悬空：${target}（库内 png：${allPngs().join(', ') || '无'}）`,
    ).toBe(true);
    // 附件必须仍然真实存在（被改名/移动都可以，但不许消失）
    expect(allPngs().length, 'canvas 引用的附件被清理删除').toBeGreaterThan(0);
  });
});

/* ==================== B. 修复断链：不得改到错误文件 ==================== */

describe('B. 修复断链不得把引用改到错误目标', () => {
  it('唯一同名候选：要么改写到真实存在的文件，要么保持原样（绝不改到不存在的路径）', async () => {
    writeBinary(VAULT_ROOT, 'assets/uniq.png', tinyImage('png'));
    const body = '# b\n\n![x](nowhere/uniq.png)\n';
    writeText(VAULT_ROOT, 'Bl.md', body);

    await command('attachment:fix-broken-links')();
    await maybeConfirm();

    const text = nodeFs.readFileSync(abs('Bl.md'), 'utf8');
    // 无论是否发生改写都必须断言（此前 `text === body` 时直接 return，等于这条用例没跑）。
    // 替身的链接解析按 basename 生效（比真实 Obsidian 宽松），该引用会被判为"已解析"、
    // 于是不做改写——那是预期；但**只要发生改写，目标就必须真实存在**。
    const m = text.match(/!\[x\]\(([^)]+)\)/);
    expect(m, '链接被整段破坏').not.toBeNull();
    const target = m![1];
    expect(
      target === 'nowhere/uniq.png' || exists(target),
      `断链修复把引用改到了不存在的目标：${target}`,
    ).toBe(true);
  });

  it('多个同名候选 → 不得自动改写（必须由用户选择）', async () => {
    writeBinary(VAULT_ROOT, 'assets/dup.png', tinyImage('png'));
    writeBinary(VAULT_ROOT, 'sub/dup.png', tinyImage('png'));
    writeText(VAULT_ROOT, 'Bl2.md', '# b\n\n![x](gone/dup.png)\n');

    await command('attachment:fix-broken-links')();

    // 自动层不得动它；进入交互层弹窗（此处不选任何候选）
    const text = nodeFs.readFileSync(abs('Bl2.md'), 'utf8');
    expect(text).toContain('gone/dup.png');
  });

  it('无任何候选 → 零改动（用全文比对证明）', async () => {
    const body = '# b\n\n![x](ghost/none.png)\n\n[[also-missing.png]]\n';
    writeText(VAULT_ROOT, 'Bl3.md', body);
    await command('attachment:fix-broken-links')();
    expect(nodeFs.readFileSync(abs('Bl3.md'), 'utf8')).toBe(body);
  });
});

/* ==================== C. 幂等与重跑 ==================== */

describe('C. 重复执行不得产生副作用累积', () => {
  it('全库命名跑两遍：第二遍零改动，且不产生 "(1)" 兜底名', async () => {
    writeBinary(VAULT_ROOT, 'assets/x1.png', tinyImage('png'));
    writeBinary(VAULT_ROOT, 'assets/x2.png', tinyImage('png'));
    writeText(VAULT_ROOT, 'Idem.md', '# i\n\n![a](assets/x1.png)\n\n![b](assets/x2.png)\n');

    await command('attachment:bulk-rename')();
    await runConfirm();
    const after1 = listVault(VAULT_ROOT).filter((f) => f.includes('Idem_image_') && f.endsWith('.png')).sort();
    expect(after1.length).toBe(2);

    obsidian._registry.notices = [];
    const modalsBefore = handle.app._modals.length;
    await command('attachment:bulk-rename')();
    // 幂等：第二遍不应有任何可重命名项 → 不弹预览、文件集合不变、不产生 (1) 兜底名
    expect(handle.app._modals.length, '第二遍应无可重命名项（不弹预览）').toBe(modalsBefore);
    const after2 = listVault(VAULT_ROOT).filter((f) => f.includes('Idem_image_') && f.endsWith('.png')).sort();
    expect(after2).toEqual(after1);
    expect(after2.some((f) => f.includes('(1)'))).toBe(false);
  });

  it('清理未用跑两遍：第二遍删 0 个（无副作用累积）', async () => {
    await command('attachment:cleanup-unused')();
    await runConfirm();
    const remaining = listVault(VAULT_ROOT).filter((f) => f.endsWith('.png'));
    expect(remaining.some((f) => f === 'root-orphan.png')).toBe(false);

    obsidian._registry.notices = [];
    const modalsBefore = handle.app._modals.length;
    await command('attachment:cleanup-unused')();
    // 幂等：第二遍应无可清理项 → 不弹确认窗、文件集合不变
    expect(handle.app._modals.length, '第二遍应无可清理项（不弹确认）').toBe(modalsBefore);
    const after = listVault(VAULT_ROOT).filter((f) => f.endsWith('.png'));
    expect(after).toEqual(remaining);
  });

  it('断链修复跑两遍：第二遍零改动', async () => {
    writeBinary(VAULT_ROOT, 'assets/twice.png', tinyImage('png'));
    writeText(VAULT_ROOT, 'Twice.md', '# t\n\n![x](lost/twice.png)\n');

    await command('attachment:fix-broken-links')();
    await maybeConfirm();
    const after1 = nodeFs.readFileSync(abs('Twice.md'), 'utf8');

    await command('attachment:fix-broken-links')();
    await maybeConfirm();
    const after2 = nodeFs.readFileSync(abs('Twice.md'), 'utf8');
    expect(after2).toBe(after1);
  });
});

/* ==================== F. 三种删除方式都必须按各自语义生效（不可逆分支） ==================== */
/**
 * 为什么单独成组：`cleanup.deleteMode` 有三种取值，走**三条不同的代码路径**
 * （`vault.trash(f,false)` / `vault.trash(f,true)` / `vault.delete(f)`），且全部不可逆。
 *
 * 而 2026-09-28 的覆盖审计发现：**只有 '.trash' 被任何用例执行过**——
 * 'system-trash' 在全仓库一次都没出现，'permanent' 只作为迁移测试里的字面量存在。
 * 根因之一是替身的 `trash` 曾**忽略 `system` 参数**：两种语义在测试里不可区分，
 * 于是"代码忘了传 system=true"这种缺陷永远看不出来（替身已改为区分，见 infrastructure.ts）。
 */
describe('F. 清理删除方式（三条不可逆分支）', () => {
  let seq = 0;
  /** 建一份"一个真孤儿 + 一个仍被引用"的库；返回两者路径。 */
  function setupMode(tag: string): { orphan: string; used: string } {
    seq++;
    const orphan = `assets/f-${tag}-${seq}-orphan.png`;
    const used = `assets/f-${tag}-${seq}-used.png`;
    writeBinary(VAULT_ROOT, orphan, tinyImage('png'));
    writeBinary(VAULT_ROOT, used, tinyImage('png'));
    writeText(VAULT_ROOT, `F-${tag}-${seq}.md`, `# f\n\n![u](${used})\n`);
    // 本组聚焦"删除语义"，确认路径另有覆盖；关掉确认以便直接观察删除结果
    plugin.settings.cleanup.requireConfirm = false;
    return { orphan, used };
  }

  it("deleteMode='.trash'：移入库内 .trash（用户可在文件管理器找回）", async () => {
    const { orphan, used } = setupMode('trash');
    plugin.settings.cleanup.deleteMode = '.trash';

    await command('attachment:cleanup-unused')();

    const name = nodePath.basename(orphan);
    expect(nodeFs.existsSync(abs(orphan)), '孤儿未被删除').toBe(false);
    expect(listVault(VAULT_ROOT)).not.toContain(orphan);
    expect(nodeFs.existsSync(abs(`.trash/${name}`)), '未进库内回收站').toBe(true);
    expect(
      nodeFs.existsSync(nodePath.join(systemTrashDir(VAULT_ROOT), name)),
      '.trash 模式却进了系统回收站',
    ).toBe(false);
    expect(nodeFs.existsSync(abs(used)), '仍被引用的附件被删了').toBe(true);
  });

  it("deleteMode='system-trash'：移出库（系统回收站），不得留在库内回收站", async () => {
    const { orphan, used } = setupMode('sys');
    plugin.settings.cleanup.deleteMode = 'system-trash';

    await command('attachment:cleanup-unused')();

    const name = nodePath.basename(orphan);
    expect(nodeFs.existsSync(abs(orphan)), '孤儿未被删除').toBe(false);
    expect(listVault(VAULT_ROOT)).not.toContain(orphan);
    expect(
      nodeFs.existsSync(nodePath.join(systemTrashDir(VAULT_ROOT), name)),
      '未进系统回收站——很可能把 system 参数传成了 false（两种回收站语义被混淆）',
    ).toBe(true);
    expect(
      nodeFs.existsSync(abs(`.trash/${name}`)),
      'system-trash 却留在了库内回收站：两种删除方式被实现成了同一种',
    ).toBe(false);
    expect(nodeFs.existsSync(abs(used)), '仍被引用的附件被删了').toBe(true);
  });

  it("deleteMode='permanent'：永久删除，两处回收站都不得留下痕迹", async () => {
    const { orphan, used } = setupMode('perm');
    plugin.settings.cleanup.deleteMode = 'permanent';

    await command('attachment:cleanup-unused')();

    const name = nodePath.basename(orphan);
    expect(nodeFs.existsSync(abs(orphan)), '孤儿未被删除').toBe(false);
    expect(nodeFs.existsSync(abs(`.trash/${name}`)), '永久删除却进了库内回收站').toBe(false);
    expect(
      nodeFs.existsSync(nodePath.join(systemTrashDir(VAULT_ROOT), name)),
      '永久删除却进了系统回收站',
    ).toBe(false);
    expect(nodeFs.existsSync(abs(used)), '仍被引用的附件被删了').toBe(true);
  });
});

/* ==================== D. 收集：单篇与全库同口径 ==================== */

describe('D. 收集口径一致（单篇 ↔ 全库）', () => {
  it('共享附件不被「收集当前笔记附件」移动，且如实告知跳过数', async () => {
    writeBinary(VAULT_ROOT, 'assets/pic.png', tinyImage('png'));
    writeText(VAULT_ROOT, 'deep/SharedNote.md', '# s\n\n![x](assets/pic.png)\n');
    writeText(VAULT_ROOT, 'SharedOther.md', '# o\n\n![x](assets/pic.png)\n');

    handle.open('deep/SharedNote.md');
    obsidian._registry.notices = [];
    await command('attachment:collect-current-note')();
    await maybeConfirm();

    // 该附件归属目录应为 deep/assets（笔记相对），但它是共享附件 → 不得移动
    expect(exists('assets/pic.png')).toBe(true);
    expect(exists('deep/assets/pic.png')).toBe(false);
    expect(obsidian._registry.notices.some((n) => String(n.message).includes('共用'))).toBe(true);
  });
});
