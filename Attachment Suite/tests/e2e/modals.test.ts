/**
 * 弹窗交互与**弹窗内提示**的契约。
 *
 * 覆盖审计登记的 3 项遗留（`docs/coverage-audit-2026-09-28.md` §11.5 的 ②③④）：
 *
 * ② 候选弹窗「以此修复」在未选中候选时 `return`——按钮看着能点、点下去毫无反应，
 *    用户只会以为功能坏了。现在必须**置灰**并给出"先选一个"的提示。
 * ③ `ReportModal` 传空 `sections` 会抛错：`[].every(...)` 恒为 true，于是走到
 *    `sections[0].emptyText` —— 将来任何调用方少传一节就炸。
 * ④ 弹窗内的 `Notice` 时长曾硬编码 3000/5000/8000，与设置页承诺的「按级别分级时长」
 *    不是同一口径；而且"导出成功"这条**结果**提示绕过了「静默＝只出错时提示」。
 *    现在统一走 `createNoticer` + `effectiveDuration`。
 *
 * 断言口径：不用臆造的通知 level（真实 `Notice` 没有这个概念），只看可观测事实
 * ——「静默档下到底弹没弹」「时长是不是那个函数算出来的」。
 */

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { buildTestApp, resetVault, writeText } from './infrastructure';
import type { TestAppHandle, ObsidianModule } from './infrastructure';
import { DEFAULT_SETTINGS, type PluginSettings } from '../../src/settings';
import { CandidateSelectModal, ReportModal } from '../../src/modals';
import { effectiveDuration } from '../../src/notify-core';
import '../mocks/obsidian-stub';

let VAULT_ROOT = '';

beforeAll(() => {
  (globalThis as any).window = globalThis;
  VAULT_ROOT = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'iap-modals-'));
});

afterAll(() => {
  nodeFs.rmSync(VAULT_ROOT, { recursive: true, force: true });
});

let obsidian: ObsidianModule;
let handle: TestAppHandle;
let plugin: any;

function settingsFor(level: PluginSettings['notificationLevel']): PluginSettings {
  const s: PluginSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
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
  obsidian._registry.notices = []; // 丢掉 onload 的加载提示，只观察本用例产生的
}

const notices = (): Array<{ message: string; duration?: number }> => obsidian._registry.notices;

function command(id: string): () => void | Promise<void> {
  const found = handle.getCommands().find((c: any) => c.id === id);
  if (!found) throw new Error(`命令未注册: ${id}`);
  return found.callback;
}

/**
 * 让 `void asyncFn()` 那类"发射后不管"的调用跑完（导出报告就是这样被触发的）。
 * 多跑几轮宏任务：导出链上有 `await vault.create`，单次 `setTimeout(0)` 不够稳。
 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

/** 取弹窗页脚里的按钮组件（含 `disabled` / `trigger()`，且按弹窗作用域取，互不串扰）。 */
function footerButtons(modal: any, footerCls: string): any[] {
  const footer = modal.contentEl.querySelectorAll(`.${footerCls}`)[0];
  return footer ? footer.buttons : [];
}
const buttonByText = (modal: any, footerCls: string, text: string): any =>
  footerButtons(modal, footerCls).find((b: any) => b.text === text);

beforeEach(() => {
  obsidian = (globalThis as any).__OBSIDIAN_TEST;
  resetVault(VAULT_ROOT);
});

describe('候选弹窗：未选中候选时「以此修复」必须置灰（审计遗留 ②）', () => {
  /** 一条最简断链 + 一个候选，够走完"选 → 修"的路径。 */
  function makeModal(): { modal: any; done: Array<Map<string, Map<string, string>>> } {
    const done: Array<Map<string, Map<string, string>>> = [];
    const modal: any = new CandidateSelectModal(handle.app as any, {
      title: '修复断链',
      choices: [
        {
          sourcePath: 'n.md',
          linkText: '![x](pic.png)',
          kind: 'fuzzy',
          candidates: [{ path: 'assets/pic.png', score: 0.9, matchedBy: 'fuzzy' }],
        },
      ],
      onDone: (result) => {
        done.push(result);
      },
    });
    modal.onOpen();
    return { modal, done };
  }

  const fixButtonOf = (modal: any): any => buttonByText(modal, 'iap-confirm-footer', '以此修复');
  const candidateItems = (modal: any): any[] => modal.contentEl.querySelectorAll('.iap-candidate-item');

  it('刚打开时按钮是灰的，并提示"先选一个"', async () => {
    await boot('silent');
    const { modal } = makeModal();
    expect(
      fixButtonOf(modal)?.disabled,
      '未选中候选时「以此修复」可点——点下去什么也不发生，正是那条"点了没反应"的缺陷',
    ).toBe(true);
    const hints = modal.contentEl.querySelectorAll('.iap-candidate-hint');
    expect(hints.length, '没有"请先选择候选"的提示，用户只知道按钮不能用、不知道为什么').toBe(1);
    expect(hints[0].text).toContain('选一个');
  });

  it('选中候选后按钮点亮、提示消失', async () => {
    await boot('silent');
    const { modal } = makeModal();
    const items = candidateItems(modal);
    expect(items.length, '夹具前提不成立：候选列表为空').toBe(1);
    items[0].click();

    expect(fixButtonOf(modal)?.disabled, '选中候先后按钮仍然是灰的——用户无法修复').toBe(false);
    expect(
      modal.contentEl.querySelectorAll('.iap-candidate-hint').length,
      '已经选了候选，"请先选择"的提示还挂着',
    ).toBe(0);
    expect(items[0].hasClass('iap-candidate-item-selected'), '选中项没有可视反馈').toBe(true);
  });

  it('第二层防御：置灰态下即使被触发，也不得改动任何东西', async () => {
    // 真实按钮 disable 后点击不会回调；替身的 `trigger()` 保持了同一语义
    // （见 infrastructure 的 ButtonComponent.onClick 包装），所以这里能验到"真的不会动"。
    await boot('silent');
    const { modal, done } = makeModal();
    fixButtonOf(modal).trigger();
    expect(done.length, '未选中候选却完成了修复').toBe(0);
    expect(
      modal.contentEl.querySelectorAll('.iap-confirm-count')[0].text,
      '未选中却推进到了下一条',
    ).toBe('1/1');
  });

  it('对照组：选中后触发，确实完成修复并回调', async () => {
    // 只有"灰着不动"的断言是不够的——一个永远禁用的按钮也能过。
    await boot('silent');
    const { modal, done } = makeModal();
    candidateItems(modal)[0].click();
    fixButtonOf(modal).trigger();
    // 完成后走的是 `runConfirmed`（`Promise.resolve().then(...)`），回调不是同步发生的。
    await settle();

    expect(done.length, '选中候选后"以此修复"没有产生任何结果').toBe(1);
    expect(done[0].get('n.md')?.get('![x](pic.png)')).toBe('assets/pic.png');
  });
});

describe('ReportModal：sections 为空不得抛错（审计遗留 ③）', () => {
  function openReport(sections: any[]): any {
    const modal: any = new ReportModal(handle.app as any, {
      title: '库一致性报告',
      sections,
      getNotificationLevel: () => 'verbose',
    });
    modal.onOpen();
    return modal;
  }

  it('传空数组时不抛错，走兜底文案', async () => {
    // 缺陷原型：`sections.every((s) => s.emptyText) ? sections[0].emptyText : …`
    // —— `[].every` 恒真，于是读 `[0].emptyText` 直接抛 undefined 的错。
    await boot('silent');
    let modal: any;
    expect(() => {
      modal = openReport([]);
    }, '空 sections 把报告弹窗整个炸掉了').not.toThrow();
    const empty = modal.contentEl.querySelectorAll('.iap-report-empty');
    expect(empty.length).toBe(1);
    expect(empty[0].text).toContain('未发现需要关注的问题');
  });

  it('有声明 emptyText 时仍用它自己的文案（别把兜底当默认）', async () => {
    await boot('silent');
    const modal = openReport([{ title: '未用附件', count: 0, items: [], emptyText: '无未用附件' }]);
    expect(modal.contentEl.querySelectorAll('.iap-report-empty')[0].text).toContain('无未用附件');
  });
});

describe('弹窗内的提示必须与「通知级别」「分级时长」同一口径（审计遗留 ④）', () => {
  /** 打开一致性报告弹窗（命令总是开它），取其中「导出 .md 报告」按钮组件。 */
  async function openReportAndGetExport(): Promise<any> {
    writeText(VAULT_ROOT, 'C.md', '# c\n');
    handle.open('C.md');
    await command('attachment:check-consistency')();
    const modals = (handle.app as any)._modals;
    const modal = modals[modals.length - 1];
    expect(modal?.opts?.exportable, '一致性命令没有打开可导出的报告弹窗，用例前提不成立').toBe(true);
    const btn = buttonByText(modal, 'iap-report-footer', '导出 .md 报告');
    expect(btn, '报告弹窗里没有「导出 .md 报告」按钮').toBeTruthy();
    return btn;
  }

  it('静默档：导出成功不弹提示（承诺是「只出错时提示」）', async () => {
    await boot('silent');
    const btn = await openReportAndGetExport();
    btn.trigger();
    await settle();

    expect(
      notices().map((n) => n.message).join('\n'),
      '静默档下"导出成功"仍弹了提示——弹窗内的成功提示绕过了自己声明的分级',
    ).not.toMatch(/已导出报告/);
  });

  it('静默档：导出失败仍必须弹（错误任何级别都可见）', async () => {
    await boot('silent');
    const btn = await openReportAndGetExport();
    const orig = handle.app.vault.create;
    handle.app.vault.create = async () => {
      throw new Error('EACCES: 库目录只读');
    };
    try {
      btn.trigger();
      await settle();
    } finally {
      handle.app.vault.create = orig;
    }

    const msgs = notices().map((n) => n.message).join('\n');
    expect(msgs, '静默档把"导出失败"吞了——失败是最不能静默的一类信息').toMatch(/导出报告失败/);
    expect(msgs).toMatch(/EACCES/);
  });

  it('对照组：摘要档下导出成功有提示，且时长由 effectiveDuration 算出（不是硬编码）', async () => {
    await boot('summary');
    const btn = await openReportAndGetExport();
    btn.trigger();
    await settle();

    const exported = notices().find((n) => /已导出报告/.test(n.message));
    expect(exported, '摘要档下导出成功没有提示——这一条才把"成功该弹"钉住').toBeTruthy();
    expect(
      exported!.duration,
      '时长不是 effectiveDuration 算出来的——设置页承诺的"按级别分级时长"在这里失效了',
    ).toBe(effectiveDuration('summary', exported!.message));
  });
});

/**
 * ④ 的源码级补充。
 *
 * **变体测试实测的教训**：只靠上面的行为断言抓不住"硬编码的时长恰好等于算出来的值"——
 * 把实现改回 `new Notice(msg, 3000)` 之后，`effectiveDuration('summary', 短消息)` 同样
 * 返回 3000，那条断言**照样全绿**。所以再加一条源码级守卫：
 * `modals.ts` 里所有 `Notice` 的停留时长都必须来自 `effectiveDuration`，不得写字面数字。
 */
describe('modals.ts：提示时长不得硬编码（审计遗留 ④）', () => {
  const SRC = nodeFs.readFileSync(
    nodePath.join(fileURLToPath(new URL('../..', import.meta.url)), 'src', 'modals.ts'),
    'utf8',
  );

  it('没有把毫秒数直接写进 Notice 调用', () => {
    const hardcoded = [...SRC.matchAll(/new Notice\([^;]*?,\s*(\d{3,})\s*[,)]/g)].map((m) => m[0]);
    expect(
      hardcoded,
      `弹窗里的提示时长被硬编码了：${hardcoded.join(' | ')}——设置页承诺的是"按级别分级时长"，`
        + '必须由 effectiveDuration 算出，否则两处数字迟早漂移',
    ).toEqual([]);
  });

  it('反向确认：文件里确实用到了 effectiveDuration（否则上一条会因"一处都没有"而空转）', () => {
    expect(SRC).toContain('effectiveDuration(');
  });
});
