/**
 * 一致性报告准确性专项：专打「误报」（让用户不再信任报告）与「漏报」（掩盖真断链）。
 * 与 real-suite.test.ts 同构（真实临时文件系统 + 真实 src 代码）。
 */

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { seedFixture, TEST_SETTINGS } from './fixture';
import { buildTestApp, writeText, writeBinary, tinyImage } from './infrastructure';
import type { TestAppHandle, ObsidianModule } from './infrastructure';
import '../mocks/obsidian-stub';

let VAULT_ROOT = '';

beforeAll(() => {
  (globalThis as any).window = globalThis;
  VAULT_ROOT = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'iap-report-'));
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

function command(id: string): () => void | Promise<void> {
  const found = handle.getCommands().find((c: any) => c.id === id);
  if (!found) throw new Error(`命令未注册: ${id}`);
  return found.callback;
}

const BROKEN_SECTION = '需修复的引用（断链 / URL 编码）';

/**
 * 跑一致性审计并取出「需修复的引用」分区的条目文本。
 *
 * **必须 fail loud**：早先这里是 `(opts?.sections ?? []).find(...)` 加 `?? []`，
 * 于是"弹窗没开"或"分区标题改了"都会安静地返回空数组，而四条"不误报"断言
 * （`expect(items.some(...)).toBe(false)`）在空数组上恒真——看起来一直在测，实际什么都没测。
 * 现在缺弹窗/缺分区一律抛错，把"环境不对"与"确实没有误报"分开。
 */
async function brokenItems(): Promise<string[]> {
  await command('attachment:check-consistency')();
  const modals = handle.app._modals;
  const opts = modals[modals.length - 1]?.opts;
  if (!opts?.sections) throw new Error('未打开一致性报告弹窗，本用例的断言将失去意义');
  const section = opts.sections.find((s: any) => s.title === BROKEN_SECTION);
  if (!section) {
    const titles = opts.sections.map((s: any) => s.title).join(' / ');
    throw new Error(`报告里没有「${BROKEN_SECTION}」分区（现有分区：${titles}）`);
  }
  return (section.items ?? []).map((i: any) => String(typeof i === 'string' ? i : i.text));
}

const abs = (rel: string): string => nodePath.join(VAULT_ROOT, rel);

describe('一致性报告：不误报', () => {
  it('代码块与行内代码里的假引用不报断链', async () => {
    writeText(
      VAULT_ROOT,
      'CodeBlock.md',
      [
        '# c',
        '',
        '```md',
        '![x](assets/in-code-block.png)',
        '```',
        '',
        '行内：`![y](assets/in-inline-code.png)`',
        '',
      ].join('\n'),
    );
    const items = await brokenItems();
    expect(items.some((t) => t.includes('in-code-block'))).toBe(false);
    expect(items.some((t) => t.includes('in-inline-code'))).toBe(false);
  });

  it('笔记跨章节锚点 X.md#heading 不报断链', async () => {
    writeText(VAULT_ROOT, 'Target.md', '# 目标\n\n## 小节\n');
    writeText(VAULT_ROOT, 'Anchor.md', '# a\n\n[[Target.md#小节]]\n[链接](Target.md#小节)\n');
    const items = await brokenItems();
    expect(items.some((t) => t.includes('Target.md#') || t.includes('Target.md'))).toBe(false);
  });

  it('外部 http 链接不报断链（未本地化的外链不是"断链"）', async () => {
    writeText(VAULT_ROOT, 'Ext.md', '# e\n\n![x](https://example.com/a.png)\n[链接](https://example.com/b.pdf)\n');
    const items = await brokenItems();
    expect(items.some((t) => t.includes('example.com'))).toBe(false);
  });

  it('HTML 注释里的引用不应报断链（注释内容不是有效引用）', async () => {
    writeText(VAULT_ROOT, 'Comment.md', '# c\n\n<!-- ![x](assets/commented.png) -->\n\n正常文字\n');
    const items = await brokenItems();
    expect(items.some((t) => t.includes('commented.png'))).toBe(false);
  });
});

describe('一致性报告：不漏报', () => {
  it('路径不存在且无同名候选的引用必须被报出', async () => {
    writeText(VAULT_ROOT, 'Real.md', '# r\n\n![x](assets/definitely-gone.png)\n');
    const items = await brokenItems();
    expect(items.some((t) => t.includes('definitely-gone.png'))).toBe(true);
  });

  it('无扩展名 wiki 引用（[[ghostpic]]）既无笔记也无附件时必须被报出', async () => {
    writeText(VAULT_ROOT, 'Ghost.md', '# g\n\n[[ghostpic]]\n');
    const items = await brokenItems();
    expect(items.some((t) => t.includes('ghostpic'))).toBe(true);
  });

  it('URL 编码引用（%20）指向真实文件时不报断链', async () => {
    writeBinary(VAULT_ROOT, 'assets/my img.png', tinyImage('png'));
    writeText(VAULT_ROOT, 'Enc.md', '# e\n\n![x](assets/my%20img.png)\n');
    const items = await brokenItems();
    expect(items.some((t) => t.includes('my%20img.png') || t.includes('my img.png'))).toBe(false);
    expect(nodeFs.existsSync(abs('assets/my img.png'))).toBe(true);
  });

  it('canvas file 节点指向缺失文件时报断链', async () => {
    nodeFs.writeFileSync(
      abs('Cv.canvas'),
      JSON.stringify({
        nodes: [{ id: 'n1', type: 'file', file: 'assets/canvas-gone.png', x: 0, y: 0, width: 10, height: 10 }],
        edges: [],
      }),
    );
    const items = await brokenItems();
    expect(items.some((t) => t.includes('canvas-gone.png'))).toBe(true);
  });
});
