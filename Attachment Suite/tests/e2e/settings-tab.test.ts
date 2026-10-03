/**
 * 设置面板渲染与交互测试。
 *
 * 为什么需要：设置页不参与命令链路，功能测试从不打开它，此前**零覆盖**——于是"父开关关掉后
 * 子项仍可编辑""输入 500ms 超时却被静默改成 30000 而输入框还显示 500"这类问题只能靠人肉发现。
 * 这里用 Obsidian 替身把 `display()` 真正跑一遍，锁定六项行为：
 * ① 渲染不抛错；② 父开关联动禁用子项（既测"改设置后重渲染"，也测"用户点开关当场联动"）；
 * ③ 连接符/命名用词的片段清洗；④ 数字输入"看到的 = 生效的"；
 * ⑤ 设置变更确实写盘（saveSettings 被调用）；⑥ 无法用界面表达的下拉取值不被谎报。
 *
 * 说明：`'obsidian'` 经 vitest.config.ts 的 alias 指向 tests/mocks/obsidian-stub.ts，
 * 该 stub 为每个 Setting 在容器里放一个对应的表单控件，使 DOM 级行为可断言。
 * 开关/下拉/滑杆的 `onChange` 必须被替身**真正保存**（见 infrastructure.ts 的
 * `makeControlComp`），否则 `settings-tab.ts` 里这些回调体是"写了却永远跑不到"的死代码，
 * 上述 ②⑤⑥ 三条根本无从验证。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, type PluginSettings } from '../../src/settings';
import { AttachmentSettingTab } from '../../src/settings-tab';
// 触发 stub 初始化（把实例挂到 globalThis，并作为 'obsidian' 的共享单例）
import '../mocks/obsidian-stub';
import type { ObsidianModule } from './infrastructure';

function obsidian(): ObsidianModule {
  return (globalThis as any).__OBSIDIAN_TEST;
}

/** 构造一个只带 settings / saveSettings 的插件替身与设置页。 */
function makeTab(opts: {
  vaultConfig?: Record<string, unknown>;
  /** 附件目录来源；默认 custom（见下方基线说明）。测"跟随 Obsidian"相关的提示时传 'obsidian'。 */
  attachmentFolderMode?: PluginSettings['attachmentFolderMode'];
  /** 让落盘失败（模拟磁盘只读/写满），用于验证"保存失败必须可见"。 */
  failSave?: boolean;
} = {}): {
  tab: any;
  settings: PluginSettings;
  savedCount: () => number;
  sweptCount: () => number;
  debugApplied: () => boolean[];
} {
  const settings: PluginSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  // 基线：让六个联动区的父开关全部处于"开启"状态（附件目录来源默认跟随 Obsidian，
  // 其自定义目录项默认是失效的，会干扰"恰好 N 个区失效"的断言）。
  settings.attachmentFolderMode = opts.attachmentFolderMode ?? 'custom';
  let saved = 0;
  let swept = 0;
  /** 「详细诊断日志」开关必须调用这个入口（与「切换诊断日志」命令共用实现）。 */
  const debugApplied: boolean[] = [];
  const plugin: any = {
    settings,
    saveSettings: async (): Promise<void> => {
      if (opts.failSave) throw new Error('EACCES: 库目录只读');
      saved++;
    },
    setDebugLogging: async (next: boolean): Promise<void> => {
      settings.debugLogging = next;
      debugApplied.push(next);
      // 真实实现是"改字段 → applyLogLevel → await saveSettings()"，落盘失败即整体 reject
      if (opts.failSave) throw new Error('EACCES: 库目录只读');
      saved++;
    },
    // 设置页在「自动处理刷新间隔」失焦后会调用它让新间隔生效（见 main.ts 的同名方法）
    restartAutomationSweep: (): void => {
      swept++;
    },
  };
  const tab: any = new AttachmentSettingTab(
    // app 只需支持 `vault.getConfig`：设置页用它读 Obsidian 的附件文件夹，
    // 从而给出"附件会落在库根"这类**按实际情况**的提示（而不是常驻横幅）。
    { vault: { getConfig: (k: string) => opts.vaultConfig?.[k] } } as any,
    plugin,
  );
  return {
    tab,
    settings,
    savedCount: () => saved,
    sweptCount: () => swept,
    debugApplied: () => debugApplied,
  };
}

/** 取最近一次渲染中、指定名称的文本输入组件。 */
function textInput(name: string): any {
  const all = obsidian()._registry.textInputs.filter((t) => t.name === name);
  return all[all.length - 1]?.comp;
}

/** 取最近一次渲染中、指定名称的开关/下拉/滑杆组件。 */
function settingControl(name: string, kind: 'toggle' | 'dropdown' | 'slider'): any {
  const all = obsidian()._registry.settingControls.filter((t) => t.name === name && t.kind === kind);
  return all[all.length - 1]?.comp;
}

/** 设置页里的"受父开关联动"区容器。 */
function gatedSections(tab: any): any[] {
  return tab.containerEl.querySelectorAll('.iap-settings-gated');
}

/** 当前处于"失效"状态的联动区。 */
function offSections(tab: any): any[] {
  return gatedSections(tab).filter((s: any) => s.hasClass('iap-settings-gated-off'));
}

function controls(root: any): any[] {
  return root.querySelectorAll('input, select');
}

beforeEach(() => {
  obsidian()._registry.textInputs = [];
  obsidian()._registry.settingControls = [];
});

describe('设置面板：渲染', () => {
  it('display() 可完整渲染且不抛错', () => {
    const { tab } = makeTab();
    expect(() => tab.display()).not.toThrow();
    // 各能力区都应渲染出控件（文本/开关/下拉/滑杆）
    expect(controls(tab.containerEl).length).toBeGreaterThan(20);
    // 六个能力区各有一个联动容器：自定义附件目录、自动化、命名、本地化、一致性、清理
    expect(gatedSections(tab)).toHaveLength(6);
  });

  it('全部父开关开启时，没有区处于失效状态', () => {
    const { tab } = makeTab();
    tab.display();
    expect(offSections(tab)).toHaveLength(0);
    for (const c of controls(tab.containerEl)) expect(c.disabled).toBe(false);
  });
});

describe('设置面板：父开关联动', () => {
  it('关闭命名后，仅命名区的子项被禁用，父开关本身仍可编辑', () => {
    const { tab, settings } = makeTab();
    settings.naming.enabled = false;
    tab.display();

    const off = offSections(tab);
    expect(off).toHaveLength(1);
    const inner = controls(off[0]);
    expect(inner.length).toBeGreaterThan(5);
    for (const c of inner) expect(c.disabled).toBe(true);

    // 区外控件（含「启用统一命名」开关本身）不受影响，用户仍能把它开回来
    const outside = controls(tab.containerEl).filter((c: any) => !inner.includes(c));
    expect(outside.length).toBeGreaterThan(0);
    for (const c of outside) expect(c.disabled).toBe(false);
  });

  it('多个父开关关闭时，对应各区分别失效', () => {
    const { tab, settings } = makeTab();
    settings.naming.enabled = false;
    settings.cleanup.enabled = false;
    settings.localize.enabled = false;
    tab.display();
    expect(offSections(tab)).toHaveLength(3);
  });

  it('重新开启父开关后子项恢复可编辑', () => {
    const { tab, settings } = makeTab();
    settings.cleanup.enabled = false;
    tab.display();
    expect(offSections(tab)).toHaveLength(1);

    settings.cleanup.enabled = true;
    tab.display();
    expect(offSections(tab)).toHaveLength(0);
    for (const c of controls(tab.containerEl)) expect(c.disabled).toBe(false);
  });

  it('用户点开关当场生效：写盘 + 立即联动子项（无需重开设置页）', () => {
    // 这条是「替身必须真正保存 onChange 回调」的直接受益者：过去 toggle 的 onChange 是空实现，
    // 于是 settings-tab.ts 里 `this.save(); this.applyGates();` 这两行永远跑不到。
    const { tab, settings, savedCount } = makeTab();
    tab.display();
    expect(offSections(tab)).toHaveLength(0);

    const cleanupToggle = settingControl('启用清理', 'toggle');
    expect(typeof cleanupToggle?.trigger, '开关的 onChange 未被替身保存，联动逻辑不可驱动').toBe('function');

    const before = savedCount();
    cleanupToggle.trigger(false);
    expect(settings.cleanup.enabled).toBe(false);
    expect(savedCount(), '开关变更未写盘——重启后设置会丢').toBeGreaterThan(before);
    expect(offSections(tab), '关闭父开关后子项未立即禁用').toHaveLength(1);

    cleanupToggle.trigger(true);
    expect(settings.cleanup.enabled).toBe(true);
    expect(offSections(tab), '重新开启父开关后子项未恢复').toHaveLength(0);
  });
});

describe('设置面板：输入清洗与回写', () => {
  it('连接符含路径分隔符被剔除、留空回退下划线，并当场回写输入框', () => {
    const { tab, settings } = makeTab();
    tab.display();
    const comp = textInput('连接符');
    expect(comp).toBeTruthy();

    // `/` 会把附件拼进意外子目录，必须剔除并让用户当场看到
    comp.trigger('a/b');
    expect(settings.naming.connector).toBe('ab');
    expect(comp.inputEl.value).toBe('ab');

    // 空串会让已命名附件永远解析不出来（幂等被破坏），回退默认下划线
    comp.trigger('');
    expect(settings.naming.connector).toBe('_');
    expect(comp.inputEl.value).toBe('_');
  });

  it('命名用词含路径分隔符同样被剔除', () => {
    const { tab, settings } = makeTab();
    tab.display();
    const comp = textInput('「图片」命名用词');
    expect(comp).toBeTruthy();
    comp.trigger('img/sub');
    expect(settings.naming.categoryWords.image).toBe('imgsub');
    expect(comp.inputEl.value).toBe('imgsub');
  });

  it('数字越界时失焦回写实际生效值（消除"看到的 ≠ 生效的"）', () => {
    const { tab, settings } = makeTab();
    tab.display();
    const comp = textInput('单文件下载超时（毫秒）');
    expect(comp).toBeTruthy();

    comp.trigger('500');
    // 小于下限 1000 → 按默认 30000 生效（与改动前一致，但这次用户能看见）
    expect(settings.localize.timeoutMs).toBe(30000);

    comp.inputEl.value = '500';
    comp.inputEl.dispatch('blur');
    expect(comp.inputEl.value).toBe('30000');
    expect(settings.localize.timeoutMs).toBe(30000);
  });

  it('最小文件大小的负数被钳制为 0，不再把非法值写进配置', () => {
    const { tab, settings } = makeTab();
    tab.display();
    const comp = textInput('最小文件大小（KB，0 为不限）');
    expect(comp).toBeTruthy();

    comp.trigger('-5');
    expect(settings.localize.minSizeKb).toBe(0);

    comp.inputEl.value = '-5';
    comp.inputEl.dispatch('blur');
    expect(comp.inputEl.value).toBe('0');
  });

  it('自动处理间隔留空时回退默认 5 秒', () => {
    const { tab, settings } = makeTab();
    tab.display();
    const comp = textInput('自动处理刷新间隔（秒）');
    expect(comp).toBeTruthy();
    comp.trigger('');
    expect(settings.automation.interval).toBe(5);
    comp.trigger('0');
    expect(settings.automation.interval).toBe(1); // 下限钳制
  });

  it('自动处理间隔失焦后立即按新间隔重装定时器（否则要重载插件才生效）', () => {
    // setInterval 的周期在创建时就固定了：只写设置不重装定时器 = "改了间隔没反应"。
    const { tab, settings, sweptCount } = makeTab();
    tab.display();
    const comp = textInput('自动处理刷新间隔（秒）');

    const before = sweptCount();
    comp.inputEl.value = '30';
    comp.inputEl.dispatch('blur');
    expect(settings.automation.interval).toBe(30);
    expect(sweptCount(), '失焦后未重装轮询定时器，新间隔不生效').toBe(before + 1);

    // 输入过程中（未失焦）不应反复重装定时器
    comp.trigger('7');
    expect(sweptCount()).toBe(before + 1);
  });
});

describe('设置面板：详细诊断日志开关', () => {
  it('开关必须走插件的生效路径（改设置 + 立即生效 + 落盘），而不是只改一个布尔值', () => {
    // 为什么单独一条：设置页最容易出的问题是"界面动了、实际没生效"（点开关只改了内存里的
    // 一个字段，或回调根本没跑）。这里断言它调用了与「切换诊断日志」命令**共用**的入口——
    // 只改 `settings.debugLogging` 而不调 `setDebugLogging` 会让日志级别原封不动。
    const { tab, settings, debugApplied } = makeTab();
    tab.display();
    const comp = settingControl('详细诊断日志', 'toggle');
    expect(comp, '设置页没有渲染「详细诊断日志」开关').toBeTruthy();
    expect(comp.value, '开关初始值应与设置一致（默认关）').toBe(false);

    comp.trigger(true);

    expect(debugApplied(), '点开关没有走 setDebugLogging——界面显示已开启，日志级别其实没变').toEqual([true]);
    expect(settings.debugLogging).toBe(true);

    // 关回去也必须生效（单向开关同样是"承诺了却不生效"）
    settingControl('详细诊断日志', 'toggle').trigger(false);
    expect(debugApplied()).toEqual([true, false]);
    expect(settings.debugLogging).toBe(false);
  });
});

describe('设置面板：下拉取值不得谎报', () => {
  it('恰好三个平台时显示为「全平台」', () => {
    const { tab, settings } = makeTab();
    settings.consistency.platforms = ['windows', 'mac', 'linux'];
    tab.display();
    const comp = settingControl('路径修复的目标系统', 'dropdown');
    expect(comp.value).toBe('all');
  });

  it('界面表达不出的组合（如仅两平台）原样列出，不谎报为「全平台」', () => {
    // 存量配置可能来自旧版本或手工编辑。旧实现按"长度≠1 就当全平台"取值，
    // 于是 ['windows','mac'] 会被显示成「全平台」——用户看到的与实际生效的不是一回事。
    const { tab, settings } = makeTab();
    settings.consistency.platforms = ['windows', 'mac'];
    tab.display();
    const comp = settingControl('路径修复的目标系统', 'dropdown');
    expect(comp.value).toBe('__other__');
    const labels = comp.options.map((o: any[]) => o[1]);
    expect(labels.some((l: string) => l.includes('windows') && l.includes('mac'))).toBe(true);
  });

  it('单平台时精确显示该平台', () => {
    const { tab, settings } = makeTab();
    settings.consistency.platforms = ['linux'];
    tab.display();
    expect(settingControl('路径修复的目标系统', 'dropdown').value).toBe('linux');
  });
});

describe('设置面板：类别开关必须回写实际生效状态', () => {
  it('只剩一个类别时取消勾选被拒绝，开关必须回到「开」而不是停在「关」', () => {
    // 规则"至少保留一个类别"本身可以接受（全关会让本地化永久空转），
    // 但不能让控件停在"用户以为关掉了"的位置——那就是「界面显示值 ≠ 实际生效值」，
    // 正是本页最不该出现的一类问题（同文件 bindNumber 与连接符都做了回写，这里曾漏掉）。
    const { tab, settings } = makeTab();
    settings.localize.allowedCategories = ['image'];
    tab.display();

    const comp = settingControl('本地化 图片', 'toggle');
    expect(comp, '未渲染「本地化 图片」开关').toBeTruthy();
    expect(comp.value).toBe(true);

    comp.trigger(false);

    expect(settings.localize.allowedCategories).toEqual(['image']);
    expect(
      comp.value,
      '开关停在「关」而配置里仍是「开」——用户以为不再下载该类别，实际照旧',
    ).toBe(true);
  });

  it('对照组：还有别的类别时，取消勾选照常生效（开关与配置同时变为「关」）', () => {
    const { tab, settings } = makeTab();
    settings.localize.allowedCategories = ['image', 'video'];
    tab.display();

    const comp = settingControl('本地化 视频', 'toggle');
    comp.trigger(false);

    expect(settings.localize.allowedCategories).toEqual(['image']);
    expect(comp.value).toBe(false);
  });
});

describe('设置面板：命名用词必须覆盖全部类别', () => {
  it('「网页」也有命名用词输入框，且改动真正写进配置', () => {
    // 命名侧要处理库里已存在的 .html 附件（classify() 仍会产出 webpage），
    // DEFAULT_SETTINGS 里也一直留着 categoryWords.webpage 并被命名逻辑消费。
    // 它此前处于"有值、有用、界面上却没有入口"的状态（复用了本地化的那份类别列表）。
    const { tab, settings } = makeTab();
    tab.display();

    const comp = textInput('「网页」命名用词');
    expect(comp, '命名用词缺少「网页」——该键有值、被消费，却改不了').toBeTruthy();

    comp.trigger('网页存档');
    expect(settings.naming.categoryWords.webpage).toBe('网页存档');
  });

  it('本地化白名单仍然不含「网页」（HTML 永不落存，不能出现死选项）', () => {
    const { tab } = makeTab();
    tab.display();
    expect(
      settingControl('本地化 网页', 'toggle'),
      '本地化侧不该有「网页」开关——勾了也永远不生效',
    ).toBeFalsy();
  });
});

describe('设置面板：开箱即用引导', () => {
  it('页面顶部明确告知「默认值可直接用、不必逐项调整」', () => {
    // 40 多个选项平铺出来，本身就会让人以为"必须先配点什么"。这段话是开箱即用的第一道防线。
    const { tab } = makeTab();
    tab.display();
    const quick = tab.containerEl.querySelectorAll('.iap-settings-quickstart');
    expect(quick, '设置页顶部缺少开箱即用说明').toHaveLength(1);
    expect(quick[0].text).toContain('不必逐项调整');
    expect(quick[0].text, '没有指出唯一真正需要用户决定的那一项').toContain('附件目录来源');
  });

  it('「跟随 Obsidian」且附件文件夹是库根时，当场给出针对性提示', () => {
    // Obsidian 的出厂默认就是库根 —— 新用户的附件会和笔记混在同一层，
    // 而这件事通常要等"库乱了"才被发现。所以要在这里主动说。
    const { tab } = makeTab({
      vaultConfig: { attachmentFolderPath: '/' },
      attachmentFolderMode: 'obsidian',
    });
    tab.display();
    const warn = tab.containerEl.querySelectorAll('.iap-settings-warn');
    expect(warn, '库根这一最容易被忽略的情况没有被提示').toHaveLength(1);
    expect(warn[0].text).toContain('库根');
    expect(warn[0].text, '只说了问题、没给可执行的改法').toContain('./assets');
  });

  it('附件文件夹不是库根时不出提示（提示必须"按实际情况"，不是常驻横幅）', () => {
    const { tab } = makeTab({
      vaultConfig: { attachmentFolderPath: 'attachments' },
      attachmentFolderMode: 'obsidian',
    });
    tab.display();
    expect(tab.containerEl.querySelectorAll('.iap-settings-warn')).toHaveLength(0);
  });

  it('改成「自定义目录」后提示消失（前提已不成立）', () => {
    const { tab, settings } = makeTab({
      vaultConfig: { attachmentFolderPath: '/' },
      attachmentFolderMode: 'obsidian',
    });
    tab.display();
    expect(tab.containerEl.querySelectorAll('.iap-settings-warn')).toHaveLength(1);

    settingControl('附件目录来源', 'dropdown').trigger('custom');

    expect(settings.attachmentFolderMode).toBe('custom');
    expect(
      tab.containerEl.querySelectorAll('.iap-settings-warn'),
      '切到自定义后仍留着"会落在库根"的提示——提示与实际配置不符',
    ).toHaveLength(0);
  });

  it('网络细项收进可折叠区，且没有把常用项一起吞掉', () => {
    const { tab } = makeTab();
    tab.display();
    const details = tab.containerEl.querySelectorAll('details');
    expect(details, '高级细项没有被折叠——设置页会长到让人不想看').toHaveLength(1);

    const folded = details[0].querySelectorAll('input, select').length;
    const total = controls(tab.containerEl).length;
    expect(folded, '折叠区是空的（等于白折）').toBeGreaterThanOrEqual(9);
    expect(folded, '折叠区吞掉了绝大多数选项——常用项该留在外面').toBeLessThan(total);
  });
});

/**
 * 文案自报的默认值必须与代码一致。
 *
 * 为什么需要它：改默认值几乎不会让别的用例报警（大家都在自己的夹具里显式设值），
 * 而设置页的说明文字是**写死的**——上一轮把 3 个默认值由关改成开后，
 * 「扩展扫描」还写着"默认关闭，以限制网络请求范围"、「笔记移动时跟随」还写着
 * "默认关闭以免误平移"，两句都成了假话，而全量用例照样全绿。
 * 这条守卫把"说明里自报的默认值"与 `DEFAULT_SETTINGS` 对着看，
 * 让"改了默认值却忘了改文案"当场变红。
 */
describe('设置面板：说明文字自报的默认值必须与代码一致', () => {
  const SRC = nodeFs.readFileSync(
    nodePath.join(fileURLToPath(new URL('../..', import.meta.url)), 'src', 'settings-tab.ts'),
    'utf8',
  );

  /** 取出某个设置项的说明原文（找不到就红——改名或删项时必须同步本守卫）。 */
  function descOf(name: string): string {
    const at = SRC.indexOf(`.setName('${name}')`);
    expect(at, `找不到设置项「${name}」——它被改名或删掉了，本守卫需要同步`).toBeGreaterThan(-1);
    const m = SRC.slice(at, at + 1500).match(/\.setDesc\(\s*'([\s\S]*?)'\s*,?\s*\)/);
    expect(m, `设置项「${name}」没有可解析的说明文案`).toBeTruthy();
    return m![1];
  }

  it('声明了数值默认值的项，说明里写的数必须等于 DEFAULT_SETTINGS', () => {
    const cases: Array<[string, number]> = [
      ['自动处理刷新间隔（秒）', DEFAULT_SETTINGS.automation.interval],
      ['最小文件大小（KB，0 为不限）', DEFAULT_SETTINGS.localize.minSizeKb],
      ['单文件体积上限（MB）', DEFAULT_SETTINGS.localize.maxDownloadMb],
      ['下载重试次数', DEFAULT_SETTINGS.localize.tryCount],
      ['单文件下载超时（毫秒）', DEFAULT_SETTINGS.localize.timeoutMs],
      ['同主机下载最小间隔（毫秒）', DEFAULT_SETTINGS.localize.perHostIntervalMs],
      ['并发下载数', DEFAULT_SETTINGS.localize.maxConcurrent],
    ];
    for (const [name, value] of cases) {
      expect(
        descOf(name),
        `「${name}」的说明没自报默认值，或报的与 DEFAULT_SETTINGS 不一致（当前默认 ${value}）`,
      ).toContain(`默认 ${value}`);
    }
  });

  it('声明了开/关默认状态的项，方向必须与 DEFAULT_SETTINGS 一致', () => {
    const cases: Array<[string, boolean]> = [
      ['扩展扫描：普通链接与 HTML 标签', DEFAULT_SETTINGS.localize.scanHtmlAndLinks],
      ['笔记移动时跟随移动附件', DEFAULT_SETTINGS.consistency.followNoteMove],
    ];
    for (const [name, on] of cases) {
      // 「默认开启」「默认关闭」「默认开」「默认关」都算自报，方向必须对得上
      expect(
        descOf(name),
        `「${name}」的说明把默认状态写反了（实际默认${on ? '开启' : '关闭'}）`,
      ).toContain(on ? '默认开' : '默认关');
    }
  });
});

/**
 * 设置页里引用的 **Obsidian 自己的标签**必须逐字对上宿主语言包。
 *
 * 曾经的缺陷（2026-10-01 打开宿主语言包取证后抓到）：
 * - 「附件目录来源」的说明写着「文件与链接 → **默认附件文件夹**」，而 Obsidian zh-CN
 *   实际叫「附件默认存放路径」——用户照着这个名字在设置里找，找不到那一项；
 * - 库根提示写「改为『**与当前文件同名的文件夹**』」，真实标签是「当前文件所在的文件夹」，
 *   而且语义完全不同：它是把附件放进**笔记所在的同一个目录**，不是"同名子文件夹"。
 *   照着做得到的不是文案承诺的结果，属于最坏的一类——**指导用户去做但做不成**。
 *
 * 真相来源：Obsidian 安装目录 `resources/obsidian.asar` 的 zh-CN 段，
 * 键名 → 文案对应如下（用 `option-*` 键去 asar 里搜即可复核）：
 *   file.name                            → 文件与链接
 *   option-new-attachment-location       → 附件默认存放路径
 *   option-choice-current-folder         → 当前文件所在的文件夹
 *   option-choice-subdirectory           → 当前文件所在文件夹下指定的子文件夹
 *   option-attachment-subfolder-path     → 子文件夹名称
 *
 * 要引用**新的**宿主标签时，先去 asar 里核一遍再登记进来——
 * 不要凭记忆写，这条守卫就是记忆写错两次之后加的。
 */
const HOST_LABELS: string[] = [
  '设置', // 设置窗口标题（Obsidian 语言包 settings.name）
  '文件与链接', // file.name
  '附件默认存放路径', // option-new-attachment-location
  '当前文件所在的文件夹', // option-choice-current-folder
  '当前文件所在文件夹下指定的子文件夹', // option-choice-subdirectory
  '子文件夹名称', // option-attachment-subfolder-path
];

describe('设置面板：引用的 Obsidian 原生标签必须与宿主语言包一致', () => {
  const SRC = nodeFs.readFileSync(
    nodePath.join(fileURLToPath(new URL('../..', import.meta.url)), 'src', 'settings-tab.ts'),
    'utf8',
  );

  it('以「Obsidian「…」」形式引用的标签路径，每一段都登记在已核对的白名单里', () => {
    const quoted = [...SRC.matchAll(/Obsidian「([^」]+)」/g)].map((m) => m[1]);
    expect(quoted.length, '一条都没匹配到——正则或文案结构变了，本守卫已失效').toBeGreaterThan(0);
    for (const path of quoted) {
      for (const seg of path.split('→').map((s) => s.trim())) {
        expect(
          HOST_LABELS,
          `引用了未经核对的 Obsidian 标签「${seg}」——请先在 obsidian.asar 里确认它的真实文案，再登记进 HOST_LABELS`,
        ).toContain(seg);
      }
    }
  });

  it('指向附件目录的那条提示，用的是真实标签且已不再出现历史误写', () => {
    // 正向：三处路径环节都必须真实存在，否则用户照着点不到
    for (const label of ['附件默认存放路径', '当前文件所在的文件夹', '子文件夹名称']) {
      expect(SRC, `提示里缺少 Obsidian 真实标签「${label}」`).toContain(label);
    }
    // 反向：误写的名字一律不得复活
    for (const wrong of ['默认附件文件夹', '与当前文件同名的文件夹']) {
      expect(SRC, `「${wrong}」不是 Obsidian 的标签，照它去找会找不到`).not.toContain(wrong);
    }
  });
});

/**
 * 设置落盘失败必须可见。
 *
 * 从前 `save()` 就是一句 `void this.plugin.saveSettings()` —— 一个**没有兜底的 Promise**；
 * `setDebugLogging` 的回调同理。而插件**没有全局 `unhandledrejection` 处理器**，
 * 于是落盘失败（磁盘只读 / 写满 / 同步冲突）时用户零感知：界面看着改好了、
 * 重启却变回旧值——正是本仓库反复出现的「界面显示值 ≠ 实际生效值」。
 *
 * 判据：失败走 error 级（`shouldNotify` 对 error 在任何档位都放行，含「静默」），
 * 所以这三条都刻意把 `notificationLevel` 设成 `silent` —— 若实现改成 summary/info，
 * 这里会当场变红。
 */
describe('设置面板：落盘失败必须给出可见提示（不得静默丢弃）', () => {
  /** 让 `.catch` 里的微任务跑完。 */
  const flush = async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 0));
  };
  const noticeText = (): string => obsidian()._registry.notices.map((n) => n.message).join('\n');

  it('普通设置项保存失败 → 提示含"设置保存失败"与具体原因', async () => {
    const { tab, settings } = makeTab({ failSave: true });
    settings.notificationLevel = 'silent';
    tab.display();
    obsidian()._registry.notices = [];

    settingControl('启用清理', 'toggle').trigger(false);
    await flush();

    const msgs = noticeText();
    expect(msgs, '设置保存失败被静默丢弃——用户会以为改好了，重启才发现变回旧值').toMatch(/设置保存失败/);
    expect(msgs, '只说失败不给原因，用户无从判断该怎么办').toMatch(/EACCES/);
  });

  it('诊断日志开关保存失败 → 同样可见（否则开关看着打开了、其实没落盘）', async () => {
    const { tab, settings } = makeTab({ failSave: true });
    settings.notificationLevel = 'silent';
    tab.display();
    obsidian()._registry.notices = [];

    settingControl('详细诊断日志', 'toggle').trigger(true);
    await flush();

    expect(noticeText(), '诊断日志开关保存失败没有任何提示').toMatch(/诊断日志开关保存失败/);
  });

  it('对照组：保存成功时不得产生任何提示（别把"没事"也说成有事）', async () => {
    const { tab } = makeTab();
    tab.display();
    obsidian()._registry.notices = [];

    settingControl('启用清理', 'toggle').trigger(false);
    await flush();

    expect(obsidian()._registry.notices, '保存成功却弹了提示').toHaveLength(0);
  });
});
