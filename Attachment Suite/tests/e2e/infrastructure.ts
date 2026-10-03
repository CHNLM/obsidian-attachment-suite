/**
 * 真实测试基础设施：以 for-test 真实文件系统为后端的 Obsidian API mock。
 * 目的是在 Node 环境里加载“真实构建产物 main.js”，驱动全部命令做端到端验证。
 * 这不依赖任何 Obsidian 运行时，只模拟插件真正用到的 API 表面。
 */

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
// 复用插件的纯改写器，让替身具备与真实 Obsidian 一致的"改名联动改写链接"能力
import { listMatches, rewrite, rewriteFrontmatter } from '../../src/core';

/* ============================ 工具 ============================ */

export function vaultAbs(root: string, p: string): string {
  return nodePath.join(root, ...p.split('/').filter(Boolean));
}

export function normalizeLocal(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function basenameOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function parentOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
}

function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  return i < 0 ? '' : p.slice(i + 1).toLowerCase();
}

/** 遍历库内相对路径（排除 .obsidian 与 .trash）。 */
/**
 * Obsidian 的库索引**不包含点文件与点目录**（`.DS_Store`、`.gitkeep`、`.git/`、`.obsidian/`、`.trash/` 都看不见）。
 * 替身必须照此实现，否则"只含点文件的目录"会被替身当成非空、而真实 Obsidian 当成空——
 * 这类差异会让 E2E 放行一个真实的误删路径（见 `empty-folder-cleaner.ts` 的 `isReallyEmpty`）。
 *
 * 注意：**只有"库索引"视角要隐藏点项**；`adapter.list` 是底层文件系统视角，必须能看到它们。
 */
function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

/** 列出库内所有文件（相对路径；与 Obsidian 索引一致，隐藏点文件与点目录）。 */
export function listVaultFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (absDir: string, relDir: string): void => {
    // 排序保证遍历顺序确定（与 Obsidian 稳定列出文件一致）
    const entries = nodeFs
      .readdirSync(absDir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of entries) {
      if (isHiddenName(ent.name)) continue;
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      const abs = nodePath.join(absDir, ent.name);
      if (ent.isDirectory()) walk(abs, rel);
      else out.push(rel);
    }
  };
  if (nodeFs.existsSync(root)) walk(root, '');
  return out;
}

/** 列出库内所有目录（相对路径；排除 .obsidian 与 .trash）。 */
/** 列出库内所有目录（相对路径；与 Obsidian 索引一致，隐藏点目录）。 */
export function listVaultFolders(root: string): string[] {
  const out: string[] = [];
  const walk = (absDir: string, relDir: string): void => {
    for (const ent of nodeFs.readdirSync(absDir, { withFileTypes: true })) {
      if (isHiddenName(ent.name)) continue;
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      const abs = nodePath.join(absDir, ent.name);
      if (ent.isDirectory()) {
        out.push(rel);
        walk(abs, rel);
      }
    }
  };
  if (nodeFs.existsSync(root)) walk(root, '');
  return out.sort();
}

/* ============================ Obsidian mock ============================ */

export interface Registry {
  apps: any[];
  commands: Array<{ id: string; name: string; callback: () => void | Promise<void> }>;
  modals: any[];
  notices: Array<{ level: string; message: string; duration?: number }>;
  ctaClickCallbacks: Array<() => void | Promise<void>>;
  /**
   * 与 `ctaClickCallbacks` 同源，但保留按钮文案与是否 CTA。
   *
   * 存在意义：`ctaClickCallbacks` 只有回调、没有身份，测试只能按**创建顺序**定位按钮
   * （如 real-suite 的 `cbs[cbs.length - 2]` 表示"全部跳过"）。按钮顺序一改，用例就静默错位。
   * 有文案后可以按语义定位，顺序不再是契约的一部分。
   */
  ctaButtons: Array<{ text: string; isCta: boolean; isWarning: boolean; onClick: () => void | Promise<void> }>;
  /** 宿主托管的清理回调（见 registry 定义处说明）。 */
  pluginCleanups: Array<() => void>;
  /** 设置页里创建的文本输入组件（按设置项名称索引），供设置页测试驱动输入。 */
  textInputs: Array<{ name: string; comp: any }>;
  /**
   * 设置页里创建的开关/下拉/滑杆组件（按设置项名称索引）。
   *
   * 存在的意义：这三类控件的 `onChange` 过去是空实现，于是 `settings-tab.ts` 里所有
   * `.onChange(...)` 回调体（含 `this.save()` 与 `this.applyGates()`）**一次都没被执行过**——
   * "父开关联动""改设置不落盘"这类回归根本不可能被测出来。现在按真实语义保存回调，
   * 测试可用 `comp.trigger(v)` 驱动。
   */
  settingControls: Array<{ name: string; kind: 'toggle' | 'dropdown' | 'slider'; comp: any }>;
}

export interface ObsidianModule {
  Plugin: any;
  TFile: any;
  TFolder: any;
  TAbstractFile: any;
  Notice: any;
  /** 右键菜单替身（`file-menu` 事件会传入它的实例）。 */
  Menu: any;
  Modal: any;
  ButtonComponent: any;
  Setting: any;
  PluginSettingTab: any;
  /** MarkdownView 替身（供 revealRefInNote 的 instanceof 判定与 editor 调用）。 */
  MarkdownView: new () => { editor: any };
  normalizePath: (p: string) => string;
  /** Obsidian 的 requestUrl（主进程发起，不受浏览器 CORS 限制）；测试里以 Node fetch 顶替。 */
  requestUrl: (opts: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    throw?: boolean;
  }) => Promise<{ status: number; headers: Headers; arrayBuffer: ArrayBuffer }>;
  _registry: Registry;
}

/** 创建（export 形状的）'obsidian' mock 模块，供 vi.mock 使用。 */
export function createObsidianModule(): ObsidianModule {
  const registry: Registry = {
    apps: [],
    commands: [],
    modals: [],
    notices: [],
    ctaClickCallbacks: [],
    ctaButtons: [],
    /**
     * 插件交给宿主托管的清理回调（`register` / `registerEvent` / `registerInterval`）。
     *
     * 为什么必须真的记下来：真实 Obsidian 会在卸载/禁用插件时调用它们。替身此前把
     * `registerEvent` 写成空实现、也**没有 `register`**，于是"插件忘了把事件/定时器交给宿主托管"
     * 这类缺陷在 CI 里完全隐身——真实宿主上的表现是：重载插件后旧的事件处理器仍在，
     * 同一篇笔记被处理两次、定时器越堆越多。用例可 `runPluginCleanups()` 模拟卸载。
     */
    pluginCleanups: [],
    textInputs: [],
    settingControls: [],
  };

  class TAbstractFile {
    path = '';
    stat: any = null;
    constructor(path: string) {
      this.path = normalizeLocal(path);
    }
    get name(): string {
      return basenameOf(this.path);
    }
    get parent(): any {
      const p = parentOf(this.path);
      return p ? { path: p, name: basenameOf(p) } : null;
    }
  }

  class TFile extends TAbstractFile {
    constructor(path: string, mtime = 0, size = 0) {
      super(path);
      this.stat = { mtime, ctime: mtime, size, path: this.path };
    }
    get extension(): string {
      return extOf(this.path);
    }
    get basename(): string {
      const n = this.name;
      const i = n.lastIndexOf('.');
      return i > 0 ? n.slice(0, i) : n;
    }
  }

  class TFolder extends TAbstractFile {}

  class Notice {
    /**
     * 只记录 message 与 duration：真实 `new Notice(message, timeout?)` **没有 level 概念**，
     * 通知分级只体现在"发不发"上（`createNoticer` 用 `shouldNotify` 决定是否构造 Notice）。
     * 所以测试断言"静默档下有没有出现提示"，而不是给替身发明一个 level 字段。
     */
    constructor(message: string, duration?: number) {
      registry.notices.push({ level: 'notice', message: String(message), duration });
    }
  }

  /**
   * 右键菜单替身（`workspace` 的 `file-menu` 事件会把它交给处理器）。
   *
   * 为什么要**记录**而不是空实现：菜单项是新的用户入口，而它在测试里是否可达，
   * 完全取决于 `addItem` 有没有真的保存 `onClick`。空实现会让"菜单项挂上了、
   * 点了却什么都不做"照样全绿——与 `Setting.add*`、编辑器 `setCursor` 是同一个教训。
   */
  class Menu {
    readonly items: Array<{
      title: string;
      icon?: string;
      section?: string;
      disabled: boolean;
      separator?: boolean;
      click?: () => void;
    }> = [];

    addItem(cb: (item: any) => void): Menu {
      const item: any = { title: '', disabled: false };
      item.setTitle = (t: string): any => {
        item.title = t;
        return item;
      };
      item.setIcon = (i: string): any => {
        item.icon = i;
        return item;
      };
      item.setSection = (s: string): any => {
        item.section = s;
        return item;
      };
      item.setDisabled = (d: boolean): any => {
        item.disabled = d;
        return item;
      };
      item.onClick = (fn: () => void): any => {
        item.click = fn;
        return item;
      };
      cb(item);
      this.items.push(item);
      return this;
    }

    addSeparator(): Menu {
      this.items.push({ title: 'separator', disabled: false, separator: true });
      return this;
    }
  }

  // 极简 DOM 节点替身（仅插件 onOpen 里的创建/取文本/设类）
  class FakeEl {
    buttons: ButtonComponent[] = [];
    /** 表单控件的可用状态（设置页父开关联动会置位）。 */
    disabled = false;
    /** 表单控件的当前值（数字输入失焦回写会读它）。 */
    value = '';
    private children: FakeEl[] = [];
    /** 父节点（`remove()` 需要它才能真的把自己摘掉）。 */
    private parent: FakeEl | null = null;
    private _cls: string[] = [];
    private _text = '';
    private readonly _attrs = new Map<string, string>();
    private readonly handlers = new Map<string, () => void>();
    private clickHandler?: () => void;
    constructor(readonly tag: string) {}
    /** 供测试断言节点文本（否则 _text 只写不读）。 */
    get text(): string {
      return this._text;
    }
    /**
     * 真实 DOM 的 `Element.remove()`。
     *
     * **必须真的从父节点摘除**：若只是空实现，`querySelectorAll` 仍会找到它，
     * 于是"选中候选后『先选一个』的提示应消失"这类断言照样全绿（假通过）。
     */
    remove(): void {
      if (this.parent) {
        this.parent.children = this.parent.children.filter((c) => c !== this);
        this.parent = null;
      }
    }
    createDiv(opts?: any): FakeEl {
      const el = new FakeEl('div');
      el.parent = this;
      this.children.push(el);
      if (opts?.cls) el.addClass(opts.cls);
      if (opts?.text) el.setText(opts.text);
      return el;
    }
    createSpan(opts?: any): FakeEl {
      const el = new FakeEl('span');
      el.parent = this;
      this.children.push(el);
      if (opts?.cls) el.addClass(opts.cls);
      if (opts?.text) el.setText(opts.text);
      return el;
    }
    createEl(tag: string, opts?: any): FakeEl {
      const el = new FakeEl(tag);
      el.parent = this;
      this.children.push(el);
      if (opts?.cls) el.addClass(opts.cls);
      if (opts?.text) el.setText(opts.text);
      return el;
    }
    setText(t: string): this {
      this._text = t;
      return this;
    }
    empty(): void {
      this.children = [];
    }
    addClass(c: string): this {
      // 按空白拆分：Obsidian 的 cls 允许传 "a b" 形式的多个类（querySelectorAll 按单类匹配）
      if (c) this._cls.push(...c.split(/\s+/).filter(Boolean));
      return this;
    }
    /** Obsidian 扩展的 toggleClass(cls, value?)：设置页的父开关联动靠它切换"失效"样式。 */
    toggleClass(c: string, value?: boolean): this {
      const has = this._cls.includes(c);
      const on = value === undefined ? !has : value;
      if (on && !has) this._cls.push(c);
      if (!on && has) this._cls = this._cls.filter((x) => x !== c);
      return this;
    }
    /** 是否含指定 class（测试断言用；真实 DOM 走 classList.contains）。 */
    hasClass(c: string): boolean {
      return this._cls.includes(c);
    }
    // 真实 DOM 的 classList；测试替身委托到 _cls
    get classList(): { add: (c: string) => void; remove: (c: string) => void } {
      return {
        add: (c: string) => {
          this.addClass(c);
        },
        remove: (c: string) => {
          this._cls = this._cls.filter((x) => x !== c);
        },
      };
    }
    // 真实 DOM 的 addEventListener；测试替身按事件名记录处理器，便于断言点击/失焦交互
    addEventListener(evt: string, fn: () => void): this {
      this.handlers.set(evt, fn);
      this.clickHandler = fn;
      return this;
    }
    /** 按事件名派发（如 dispatch('blur')）；未注册该事件时不做任何事。 */
    dispatch(evt: string): void {
      this.handlers.get(evt)?.();
    }
    /** 记录属性（如 title 提示），供断言。 */
    setAttribute(name: string, value: string): this {
      this._attrs.set(name, value);
      return this;
    }
    /** 读取已设置属性。 */
    getAttribute(name: string): string | null {
      return this._attrs.get(name) ?? null;
    }
    click(): void {
      // 兼容旧用法：无 'click' 处理器时回退到最后注册的处理器
      if (this.handlers.has('click')) this.handlers.get('click')?.();
      else this.clickHandler?.();
    }
    /**
     * 极简选择器（递归子元素）：对每个逗号分隔的片段（去掉可选的前导 `.`），
     * 命中"类名包含"或"标签名相等"即算匹配。
     * 同时支持两种既有用法：`'.iap-report-item'`（类名，含点）与
     * `'iap-confirm-row-clickable'`（类名，省略点），以及 `'input, select, button'`（标签名）。
     */
    querySelectorAll(sel: string): FakeEl[] {
      const wanted = sel
        .split(',')
        .map((s) => s.trim().replace(/^\./, ''))
        .filter(Boolean);
      const out: FakeEl[] = [];
      const walk = (els: FakeEl[]): void => {
        for (const c of els) {
          if (wanted.some((w) => c._cls.includes(w) || c.tag === w)) out.push(c);
          walk(c.children);
        }
      };
      walk(this.children);
      return out;
    }
  }

  class ButtonComponent {
    private _text = '';
    private _cta = false;
    private _warning = false;
    private _disabled = false;
    constructor(el: any) {
      el.buttons.push(this);
    }
    setButtonText(t: string): this {
      this._text = t;
      return this;
    }
    setCta(): this {
      this._cta = true;
      return this;
    }
    setWarning(): this {
      this._warning = true;
      return this;
    }
    setDisabled(d: boolean): this {
      this._disabled = d;
      return this;
    }
    /** 供断言读取（真实 `ButtonComponent.setDisabled` 同时会置 `buttonEl.disabled`）。 */
    get disabled(): boolean {
      return this._disabled;
    }
    /** 供断言读取按钮文案（真实实现写在 `buttonEl.textContent` 上）。 */
    get text(): string {
      return this._text;
    }
    setClass(_c: string): this {
      return this;
    }
    onClick(cb: () => void | Promise<void>): this {
      // 真实按钮被 disable 后**点了不会触发回调**。测试常直接取注册表里的回调调用，
      // 若不加这一层，就会出现"实现里按钮是灰的、测试却照样把它点响了"的假通过。
      const guarded = (): void | Promise<void> => {
        if (this._disabled) return;
        return cb();
      };
      this._handler = guarded;
      registry.ctaClickCallbacks.push(guarded);
      registry.ctaButtons.push({ text: this._text, isCta: this._cta, isWarning: this._warning, onClick: guarded });
      return this;
    }
    private _handler: (() => void | Promise<void>) | null = null;
    /**
     * 触发点击（供断言使用；真实实现里由 DOM 事件完成）。
     *
     * ⚠️ 不要用 `btn.onClick()` 当探针——`onClick` 是**注册回调的方法**，
     * 无参调用只会把 `undefined` 注册进去，什么都不会发生（用例会假通过）。
     * 本方法的 `guarded` 包装已含 disabled 判定，与真实按钮行为一致。
     */
    trigger(): void | Promise<void> {
      return this._handler?.();
    }
  }

  class Modal {
    app: any;
    contentEl: FakeEl;
    modalEl: FakeEl;
    constructor(app: any) {
      (this as any).app = app;
      this.contentEl = new FakeEl('div');
      this.modalEl = new FakeEl('div');
      if (app) app._modals.push(this);
    }
    open(): void {
      (this as any).onOpen?.();
    }
    close(): void {
      this.contentEl.empty();
      (this as any).onClose?.();
    }
    onOpen(): void {}
    onClose(): void {}
  }

  // 设置面板所需：除保证符号存在外，还为每个设置项在容器里放一个对应的表单控件，
  // 使"父开关联动禁用子项""数字输入失焦回写"这类 DOM 行为也能被测试断言。
  class PluginSettingTab {
    containerEl: FakeEl = new FakeEl('div');
    constructor(public app: any, public plugin: any) {}
  }
  class Setting {
    private _name = '';
    constructor(public containerEl: any) {}
    private makeControl(tag: 'input' | 'select'): FakeEl {
      const host = this.containerEl;
      return typeof host?.createEl === 'function' ? host.createEl(tag) : new FakeEl(tag);
    }
    setName(n: string): this {
      this._name = n;
      return this;
    }
    setDesc(): this {
      return this;
    }
    setHeading(): this {
      return this;
    }
    /**
     * 开关/下拉/滑杆共用：按真实语义保存 `onChange` 回调，并暴露 `trigger(v)` 供测试驱动。
     *
     * 早期这三者是空实现（`onChange: () => comp`），让设置页的所有联动与落盘逻辑成为
     * "写了但永远跑不到"的死代码——测试再怎么写也发现不了"改了不生效"。
     * 注意 `setValue` 只回写显示值、**不**触发 `onChange`：与真实 Obsidian 一致
     * （初始化赋值不应被当成用户操作）。
     */
    private makeControlComp(kind: 'toggle' | 'dropdown' | 'slider'): any {
      const comp: any = {
        value: undefined,
        options: [] as Array<[string, string]>,
        setValue: (v?: any) => {
          comp.value = v;
          return comp;
        },
        setDisabled: () => comp,
        setLimits: () => comp,
        setDynamicTooltip: () => comp,
        addOption: (v: string, label: string) => {
          comp.options.push([v, label]);
          return comp;
        },
        onChange: (fn: (v: any) => void) => {
          // 真实控件在回调触发**之前**自身状态就已经变了（用户拨了开关、选了项）。
          // 替身必须照此建模，否则"插件不回写 → 界面显示值 ≠ 实际生效值"这一类缺陷
          // 在测试里根本不可能被发现：`comp.value` 会停在旧值，断言照样全绿。
          // 受此保护的实现见 settings-tab.ts 的 bindNumber（失焦回写）与本地化类别开关。
          comp.trigger = (v: any) => {
            comp.value = v;
            fn(v);
          };
          registry.settingControls.push({ name: this._name, kind, comp });
          return comp;
        },
      };
      return comp;
    }
    addToggle(cb?: (c: any) => void): this {
      this.makeControl('input');
      const comp = this.makeControlComp('toggle');
      if (cb) cb(comp);
      return this;
    }
    addDropdown(cb?: (c: any) => void): this {
      this.makeControl('select');
      const comp = this.makeControlComp('dropdown');
      if (cb) cb(comp);
      return this;
    }
    addSlider(cb?: (c: any) => void): this {
      this.makeControl('input');
      const comp = this.makeControlComp('slider');
      if (cb) cb(comp);
      return this;
    }
    addText(cb?: (c: any) => void): this {
      const inputEl = this.makeControl('input');
      const comp: any = {
        inputEl,
        setPlaceholder: () => comp,
        setValue: (v: string) => {
          inputEl.value = String(v);
          return comp;
        },
        onChange: (fn: (v: string) => void) => {
          // 测试通过 comp.trigger(raw) 模拟用户输入；inputEl.value 即失焦回写的目标
          comp.trigger = fn;
          registry.textInputs.push({ name: this._name, comp });
          return comp;
        },
      };
      if (cb) cb(comp);
      return this;
    }
    addButton(): this {
      return this;
    }
    addMultiSelect(): this {
      return this;
    }
    setDisabled(): this {
      return this;
    }
  }

  /**
   * MarkdownView 替身：仅用于 `revealRefInNote` 的 `instanceof` 判定与 editor 调用。
   * 真实编辑器能力由 buildTestApp 组装（那里能读到库根）。
   */
  class MarkdownView {
    editor: any = null;
  }

  class Plugin {
    app: any;
    manifest: any;
    constructor(app: any, manifest: any) {
      (this as any).app = app;
      (this as any).manifest = manifest ?? {};
    }
    addSettingTab(tab: any): void {
      (this as any).settingsTabs = (this as any).settingsTabs ?? [];
      (this as any).settingsTabs.push(tab);
    }
    addCommand(_cmd: { id: string; name: string; callback: () => void | Promise<void> }): void {
      throw new Error('Plugin.addCommand: 请使用 obsidian 运行环境注入');
    }
    /** 注册清理回调（真实 API）。此前替身没有它，用到它的插件会在 onload 直接抛错。 */
    register(cb: () => void): void {
      registry.pluginCleanups.push(cb);
    }
    registerEvent(evt: any): void {
      registry.pluginCleanups.push(() => {
        try {
          evt?.off?.();
        } catch {
          /* EventRef 可能没有 off（替身早期返回 undefined），清理失败不应影响测试 */
        }
      });
    }
    registerInterval(id: any): any {
      registry.pluginCleanups.push(() => {
        clearInterval(id);
      });
      return id;
    }
    async loadData(): Promise<any> {
      // 读取真实安装目录下的 data.json
      const root: string | undefined = (this as any).app?._vaultRoot;
      if (!root) return undefined;
      const target = nodePath.join(root, '.obsidian', 'plugins', 'attachment-suite', 'data.json');
      try {
        return JSON.parse(nodeFs.readFileSync(target, 'utf8'));
      } catch {
        return undefined;
      }
    }
    async saveData(data: any): Promise<void> {
      const root: string | undefined = (this as any).app?._vaultRoot;
      if (!root) return;
      const target = nodePath.join(root, '.obsidian', 'plugins', 'attachment-suite', 'data.json');
      nodeFs.mkdirSync(nodePath.dirname(target), { recursive: true });
      nodeFs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
    }
  }

  function normalizePath(p: string): string {
    return normalizeLocal(p);
  }

  return {
    Plugin,
    TFile,
    TFolder,
    TAbstractFile,
    Notice,
    Menu,
    Modal,
    ButtonComponent,
    Setting,
    PluginSettingTab,
    MarkdownView,
    normalizePath,
    // Obsidian 的 requestUrl：主进程发起、不受浏览器 CORS 限制。测试里用 Node 原生 fetch 顶替（Node 不强制 CORS）。
    requestUrl: async (opts: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      throw?: boolean;
    }): Promise<{ status: number; headers: Headers; arrayBuffer: ArrayBuffer }> => {
      const res = await fetch(opts.url, { method: opts.method ?? 'GET', headers: opts.headers });
      const status = res.status;
      if (opts.throw !== false && (status < 200 || status >= 300)) {
        throw new Error(`Request failed: ${status}`);
      }
      return { status, headers: res.headers, arrayBuffer: await res.arrayBuffer() };
    },
    _registry: registry,
  };
}

/* ===================== TestApp 构建：以真实文件系统为后端 ===================== */

const LINK_IMPORTANT = /!\[\[([^\]|#]+)(?:#[^\]|]*)?\]\]|!\[[^\]]*\]\(([^)\s]+)\)/g;

function resolveLinksIn(root: string, allFiles: string[]): Record<string, Record<string, number>> {
  const fileSet = new Set(allFiles);
  // basename -> paths
  const byBase = new Map<string, string[]>();
  for (const f of allFiles) {
    const b = basenameOf(f);
    const arr = byBase.get(b);
    if (arr) arr.push(f);
    else byBase.set(b, [f]);
  }
  const resolve = (target: string): string | null => {
    if (/^(https?:|data:)/.test(target)) return null;
    const t = target.split('#')[0];
    if (fileSet.has(t)) return t;
    const b = basenameOf(t);
    const cands = byBase.get(b);
    if (!cands) return null;
    // 命中多个时按最短路径（接近 Obsidian 的取短路径行为）
    cands.sort((a, b2) => a.length - b2.length);
    return cands[0];
  };
  const resolved: Record<string, Record<string, number>> = {};
  for (const file of allFiles) {
    if (!file.endsWith('.md') && !file.endsWith('.canvas')) continue;
    const abs = vaultAbs(root, file);
    let text = '';
    try {
      text = nodeFs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const counts: Record<string, number> = {};
    for (const m of text.matchAll(LINK_IMPORTANT)) {
      const target = m[1] || m[2];
      if (!target) continue;
      const got = resolve(target);
      if (!got) continue;
      counts[got] = (counts[got] ?? 0) + 1;
    }
    resolved[file] = counts;
  }
  return resolved;
}

export interface TestAppHandle {
  app: any;
  obsidian: ObsidianModule;
  vaultRoot: string;
  /** 被 workspace.getLeaf().openFile 打开过的笔记路径（「点击定位」类断言用）。 */
  openedNotePaths: string[];
  /** 编辑器定位调用（断言"确实滚到了那一行"，而不只是"打开了笔记"）。 */
  editorCalls: Array<{ path: string; kind: 'cursor' | 'scroll'; line: number }>;
  /** 设置当前“打开的笔记”。 */
  open(relPath: string): void;
  /** 触发一次 vault.rename 事件。 */
  emitRename(newPath: string, oldPath: string): void;
  /** 触发一次 vault.create/delete 事件。 */
  emitChange(): void;
  /** 触发一次 metadataCache.changed（笔记内容/保存），file 对象带 path。 */
  emitChanged(filePath: string): void;
  /** 触发一次 metadataCache.resolved（真实宿主在打开库后必然会发它）。 */
  emitMetadataResolved(): void;
  /** 触发一次 workspace editor-paste（粘贴）；data 传剪贴板 html/plain。 */
  emitPaste(data: { textHtml?: string; textPlain?: string }): void;
  /** 取插件已注册的命令（由 addCommand 收集）。 */
  getCommands(): Array<{ id: string; name: string; callback: () => void | Promise<void> }>;
  /** 模拟宿主卸载插件：执行 register/registerEvent/registerInterval 托管的清理。 */
  runPluginCleanups(): void;
  /** 取插件注册的事件处理器（按事件名分组），供需要直接驱动的用例使用。 */
  getEventHandlers(): Record<string, Set<(...a: any[]) => void>>;
}

/**
 * `buildTestApp` 的可选注入项。
 *
 * 存在意义：插件里凡走 `vault.getConfig(...)` 的分支，都需要一个**能说真话**的库配置源。
 * 早期替身把 `attachmentFolderPath` 硬写成空串，于是 `attachmentFolderMode: 'obsidian'`（默认模式）
 * 永远走"回退到自定义目录"这一条分支——**"默认配置下附件落在库根还是 ./assets"从来没被验证过**。
 * 默认 `{}`（所有键 undefined）与既有行为完全一致，存量套件零改动。
 */
export interface TestAppOptions {
  /** Obsidian 库级配置（`app.vault.getConfig`）。例如 `{ attachmentFolderPath: '/', useMarkdownLinks: true }`。 */
  vaultConfig?: Record<string, unknown>;
}

/** 构建以真实 for-test 为后端的 TestApp。 */
export function buildTestApp(
  vaultRoot: string,
  obsidian: ObsidianModule,
  opts: TestAppOptions = {},
): TestAppHandle {
  const cmds: Array<{ id: string; name: string; callback: () => void | Promise<void> }> = [];
  /** 被 workspace.getLeaf().openFile 打开过的笔记路径（供「点击定位」类断言）。 */
  const openedNotePaths: string[] = [];
  /**
   * 编辑器定位调用记录（`setCursor` / `scrollIntoView`）。
   *
   * 为什么要记：只断言"笔记被打开"太弱——**打开 ≠ 定位到引用**。
   * 而"点击定位到断链所在笔记"这个功能的价值恰恰在后半段（滚动到那一行）。
   * 早期替身把这两个方法写成空实现，于是即便插件完全不定位、断言也照样绿。
   */
  const editorCalls: Array<{ path: string; kind: 'cursor' | 'scroll'; line: number }> = [];

  const getFsInfo = (rel: string): { mtime: number; size: number } => {
    try {
      const st = nodeFs.statSync(vaultAbs(vaultRoot, rel));
      return { mtime: st.mtimeMs, size: st.size };
    } catch {
      return { mtime: 0, size: 0 };
    }
  };

  const className = (rel: string): 'TFile' | 'TFolder' | null => {
    try {
      return nodeFs.statSync(vaultAbs(vaultRoot, rel)).isDirectory() ? 'TFolder' : 'TFile';
    } catch {
      return null;
    }
  };

  const makeFile = (rel: string): any => {
    const { mtime, size } = getFsInfo(rel);
    return new obsidian.TFile(rel, mtime, size);
  };

  const makeFolder = (rel: string): any => new obsidian.TFolder(rel);

  const getAbstract = (rel: string): any => {
    const c = className(rel);
    if (c === 'TFile') return makeFile(rel);
    if (c === 'TFolder') return makeFolder(rel);
    return null;
  };

  const eventHandlers: Record<string, Set<(...a: any[]) => void>> = {};
  const on = (evt: string, cb: (...a: any[]) => void): any => {
    (eventHandlers[evt] ??= new Set()).add(cb);
    // 真实 Obsidian 的 on() 返回 EventRef，registerEvent 靠它解绑；返回 undefined 会让
    // "插件有没有把事件交给宿主托管"变成不可验证。
    return {
      off: (): void => {
        eventHandlers[evt]?.delete(cb);
      },
    };
  };

  let activePath: string | null = null;

  const allFiles = (): string[] => listVaultFiles(vaultRoot);

  const app: any = {
    _vaultRoot: vaultRoot,
    _modals: [],
    vault: {
      adapter: {
        // 底层文件系统视角（**与库索引不同**）：点文件/点目录都可见。
        // 真实 Obsidian 的 `adapter.exists` / `adapter.list` 就是直接看文件系统。
        exists: async (rel: string): Promise<boolean> => nodeFs.existsSync(vaultAbs(vaultRoot, rel)),
        list: async (rel: string): Promise<{ files: string[]; folders: string[] }> => {
          const abs = vaultAbs(vaultRoot, rel);
          if (!nodeFs.existsSync(abs)) throw new Error(`ENOENT: ${rel}`);
          const entries = nodeFs.readdirSync(abs, { withFileTypes: true });
          const prefix = rel ? `${rel}/` : '';
          return {
            files: entries.filter((e) => !e.isDirectory()).map((e) => `${prefix}${e.name}`),
            folders: entries.filter((e) => e.isDirectory()).map((e) => `${prefix}${e.name}`),
          };
        },
      },
      getFiles: (): any[] => allFiles().map(makeFile),
      getAllLoadedFiles: (): any[] => [
        ...allFiles().map(makeFile),
        ...listVaultFolders(vaultRoot).map((f) => makeFolder(f)),
      ],
      getAbstractFileByPath: (rel: string): any => getAbstract(rel),
      read: async (f: any): Promise<string> => nodeFs.readFileSync(vaultAbs(vaultRoot, f.path), 'utf8'),
      cachedRead: async (f: any): Promise<string> => nodeFs.readFileSync(vaultAbs(vaultRoot, f.path), 'utf8'),
      readBinary: async (f: any): Promise<ArrayBuffer> => {
        const buf = nodeFs.readFileSync(vaultAbs(vaultRoot, f.path));
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      },
      modify: async (f: any, text: string): Promise<void> => {
        nodeFs.writeFileSync(vaultAbs(vaultRoot, f.path), text, 'utf8');
      },
      createBinary: async (rel: string, data: ArrayBuffer): Promise<void> => {
        const abs = vaultAbs(vaultRoot, rel);
        nodeFs.mkdirSync(nodePath.dirname(abs), { recursive: true });
        nodeFs.writeFileSync(abs, Buffer.from(data));
      },
      /**
       * 真实 `Vault.create(path, text)`：**文本**写入并返回 TFile。
       *
       * 此前替身只有 `createBinary`，而弹窗的「导出 .md 报告」走 `vault.create` ——
       * 于是那条路径在测试里一律抛 `vault.create is not a function`，被 catch 成
       * "导出报告失败"，**成功分支从来跑不到**（覆盖审计第 ③ 级：连"改坏了会红"都没有）。
       * 真实实现遇到同名文件会抛错，这里保持同一语义——否则"覆盖已有报告"这类缺陷会被抹平。
       */
      create: async (rel: string, text: string): Promise<any> => {
        const abs = vaultAbs(vaultRoot, rel);
        if (nodeFs.existsSync(abs)) throw new Error(`File already exists: ${rel}`);
        nodeFs.mkdirSync(nodePath.dirname(abs), { recursive: true });
        nodeFs.writeFileSync(abs, text, 'utf8');
        return { path: rel, name: nodePath.basename(rel) };
      },
      createFolder: async (rel: string): Promise<void> => {
        nodeFs.mkdirSync(vaultAbs(vaultRoot, rel), { recursive: true });
      },
      delete: async (f: any): Promise<void> => {
        nodeFs.rmSync(vaultAbs(vaultRoot, f.path), { recursive: true, force: true });
      },
      /**
       * 模拟 Obsidian 的**两种**回收站语义。必须区分 `system` 参数：
       * 早期实现忽略了它，于是 `deleteMode: 'system-trash'` 与 `'.trash'` 在测试里完全不可区分
       * ——"代码忘了传 system=true"这类缺陷永远看不出来（该分支因此长期零覆盖）。
       *
       * - `system === false`：库内 `.trash/`（用户可在文件管理器里找回）
       * - `system === true`：**移出库**（系统回收站）→ 放到库外的兄弟目录，见 `systemTrashDir()`。
       *   这个区别是有意义的：库内 `.trash/` 仍可能被"空目录清理/索引"看见，系统回收站不会。
       *
       * 目标同名时追加 `(N)`（真实 Obsidian 亦如此）。早期实现用 `catch { rmSync }` 兜底，
       * 会把"回收站里已有同名"**静默变成永久删除**——正好是最不该被抹平的一种差异。
       */
      trash: async (f: any, system: boolean): Promise<void> => {
        const rel: string = f.path;
        const src = vaultAbs(vaultRoot, rel);
        const root = system ? systemTrashDir(vaultRoot) : vaultAbs(vaultRoot, '.trash');
        const base = basenameOf(rel);
        const ext = nodePath.extname(base);
        const stem = ext ? base.slice(0, -ext.length) : base;
        let dst = nodePath.join(root, base);
        let i = 1;
        while (nodeFs.existsSync(dst)) dst = nodePath.join(root, `${stem} (${i++})${ext}`);
        nodeFs.mkdirSync(nodePath.dirname(dst), { recursive: true });
        nodeFs.renameSync(src, dst);
      },
      // 库级配置：只暴露调用方显式注入的键（默认全 undefined，与真实 Obsidian 未配置时一致）。
      // 不要再硬编码单个键的假值——那会让"读配置"的分支永远只走一条路。
      getConfig: (key: string): unknown => opts.vaultConfig?.[key],
      on,
    },
    metadataCache: {
      get resolvedLinks(): Record<string, Record<string, number>> {
        return resolveLinksIn(vaultRoot, allFiles());
      },
      on,
    },
    workspace: {
      getActiveFile: (): any => (activePath ? getAbstract(activePath) : null),
      /**
       * 打开文件的叶子替身：记录被打开的笔记路径（供断言「点击定位」确实跳转），
       * 并把 view 设为 MarkdownView 实例，editor 直接读真实文件内容。
       */
      getLeaf: (_kind?: string): any => {
        const leaf: { view: unknown; openFile: (f: any) => Promise<void> } = {
          view: null,
          openFile: async (f: any): Promise<void> => {
            openedNotePaths.push(f.path);
            const MV = (obsidian as any).MarkdownView;
            const view = new MV();
            view.editor = {
              getValue: (): string => {
                try {
                  return nodeFs.readFileSync(vaultAbs(vaultRoot, f.path), 'utf8');
                } catch {
                  return '';
                }
              },
              offsetToPos: (offset: number): { line: number; ch: number } => {
                const text = view.editor.getValue().slice(0, offset);
                const lines = text.split('\n');
                return { line: lines.length - 1, ch: lines[lines.length - 1].length };
              },
              setCursor: (pos: { line: number; ch: number }): void => {
                editorCalls.push({ path: f.path, kind: 'cursor', line: pos.line });
              },
              scrollIntoView: (range: { from: { line: number } }): void => {
                editorCalls.push({ path: f.path, kind: 'scroll', line: range.from.line });
              },
            };
            leaf.view = view;
          },
        };
        return leaf;
      },
      on,
    },
    fileManager: {
      /**
       * 与真实 Obsidian 对齐：改名/移动后**全库联动改写引用**。
       * 真实 Obsidian 的 fileManager.renameFile 会更新所有笔记里的链接；早期替身只做文件移动，
       * 会让"改名后其它笔记引用变坏"这类问题在 E2E 里表现为假阳性（真实环境并不会坏）。
       *
       * 但**改写范围必须与真实宿主一致**：Obsidian 的联动改写只认它自己的链接写法
       * （markdown 链接/嵌入、wiki 链接、frontmatter 属性），**不认识 HTML 媒体标签**
       * （`<img src="…">` / `<audio src="…">`）。
       *
       * 早期替身直接调用了插件的 `rewrite()`，而它会连 HTML 标签一起改写——等于把
       * "插件自己有没有处理 HTML 引用"这个最关键的守卫点替插件做掉了：
       * 即使插件误把共享附件原地改名（真实环境会让 `<img>` 引用悬空），用例照样是绿的。
       * 这里先把 HTML 标签替换成哨兵（每个占位唯一，重复标签也逐个消费），再调改写器，
       * 从而让替身的行为退到与真实宿主相同的强度。
       */
      async renameFile(f: any, newPath: string): Promise<void> {
        const oldPath: string = f.path;
        const src = vaultAbs(vaultRoot, oldPath);
        const dst = vaultAbs(vaultRoot, newPath);
        // **不要**在这里建父目录：真实宿主不会。Obsidian 的 `fileManager.renameFile` 缺目标目录时
        // 底层直接抛 ENOENT（错误文本同时打印源与目标，极易被误读成"源不存在"）。
        // 早期替身用 `mkdirSync` 兜了这一层，于是"目标目录不存在 → 整批收集失败"这类问题
        // 在 E2E 里**永远看不到**（2026-09-28 真实宿主上正是如此：`notes/assets/` 从未被创建过，
        // 而 harness 全绿）。替身必须比真实宿主**更弱或同等**，绝不能更强。
        if (!nodeFs.existsSync(nodePath.dirname(dst))) {
          throw new Error(
            `ENOENT: no such file or directory, rename '${src}' -> '${dst}'`,
          );
        }
        nodeFs.renameSync(src, dst);
        const map = new Map<string, string>([
          [oldPath, newPath],
          [basenameOf(oldPath), newPath],
        ]);
        for (const rel of allFiles()) {
          if (!/\.(md|canvas)$/i.test(rel)) continue;
          const abs = vaultAbs(vaultRoot, rel);
          let text = '';
          try {
            text = nodeFs.readFileSync(abs, 'utf8');
          } catch {
            continue;
          }
          const sentinels = new Map<string, string>();
          let masked = text;
          let i = 0;
          for (const m of listMatches(text)) {
            if (m.type !== 'html') continue;
            const s = `\u0000HTML${i++}\u0000`;
            sentinels.set(s, m.raw);
            masked = masked.replace(m.raw, s);
          }
          let next = rewriteFrontmatter(rewrite(masked, map), map);
          for (const [s, raw] of sentinels) next = next.replace(s, raw);
          if (next !== text) nodeFs.writeFileSync(abs, next);
        }
      },
    },
  };

  // 覆盖 createObsidianModule 里的 Plugin.addCommand 抛错逻辑：由本 app 收集
  const originalModuleAny = obsidian as any;
  originalModuleAny.Plugin.prototype.addCommand = function (cmd: {
    id: string;
    name: string;
    callback: () => void | Promise<void>;
  }): void {
    cmds.push({ id: cmd.id, name: cmd.name, callback: cmd.callback });
  };

  return {
    app,
    obsidian,
    vaultRoot,
    openedNotePaths,
    editorCalls,
    open: (rel: string): void => {
      activePath = rel;
    },
    emitRename(newPath: string, oldPath: string): void {
      for (const cb of eventHandlers.rename ?? new Set()) cb(getAbstract(newPath), oldPath);
    },
    emitChange(): void {
      for (const cb of eventHandlers.create ?? new Set()) cb();
      for (const cb of eventHandlers.delete ?? new Set()) cb();
    },
    emitChanged(filePath: string): void {
      for (const cb of eventHandlers.changed ?? new Set()) cb({ path: filePath });
    },
    /**
     * 模拟真实宿主"缓存已解析完所有文件"（`metadataCache.on('resolved')`）。
     *
     * 这不是可选项：插件用它判定"库索引就绪"，此前才把启动期批量 changed 当作用户编辑。
     * 真实宿主在打开库后必然会发它；替身若不发，插件的自动处理在测试里就永远走不到
     * 「就绪」分支——即"测试环境把该分支关掉"的老问题换了个形式。
     * 显式暴露是为了让用例能控制时序（先断言"未就绪不处理"，再就绪）。
     */
    emitMetadataResolved(): void {
      for (const cb of eventHandlers.resolved ?? new Set()) cb();
    },
    emitPaste(data: { textHtml?: string; textPlain?: string }): void {
      const items = [
        ...(data.textHtml ? [{ kind: 'string', type: 'text/html' }] : []),
        ...(data.textPlain ? [{ kind: 'string', type: 'text/plain' }] : []),
      ];
      const clipboardData = {
        getData: (t: string): string => (t === 'text/html' ? data.textHtml ?? '' : t === 'text/plain' ? data.textPlain ?? '' : ''),
        items,
      };
      // editor-paste 回调签名是 (evt, editor, view)；这里构造 ClipboardEvent 风格对象
      for (const cb of eventHandlers['editor-paste'] ?? new Set()) cb({ clipboardData });
    },
    getCommands: (): Array<{ id: string; name: string; callback: () => void | Promise<void> }> => cmds,
    getEventHandlers: (): Record<string, Set<(...a: any[]) => void>> => eventHandlers,
    /** 模拟宿主卸载/禁用插件时执行托管清理（验证插件确实把事件与定时器交给了宿主）。 */
    runPluginCleanups(): void {
      const list = obsidian._registry.pluginCleanups;
      for (const cb of list.splice(0, list.length)) cb();
    },
  };
}

/* ===================== 夹具：在真实 for-test 上铺设测试数据 ===================== */

/** 清空 for-test（保留 .obsidian），随后铺设完整夹具。 */
export function resetVault(vaultRoot: string, keepObsidian = true): void {
  if (!nodeFs.existsSync(vaultRoot)) nodeFs.mkdirSync(vaultRoot, { recursive: true });
  // 系统回收站在库外（见 systemTrashDir），不属于库内容，必须单独清，否则用例间会互相污染
  nodeFs.rmSync(systemTrashDir(vaultRoot), { recursive: true, force: true });
  for (const ent of nodeFs.readdirSync(vaultRoot, { withFileTypes: true })) {
    if (keepObsidian && ent.name === '.obsidian') continue;
    if (ent.name === '.trash') continue;
    nodeFs.rmSync(nodePath.join(vaultRoot, ent.name), { recursive: true, force: true });
  }
}

/**
 * 替身里"系统回收站"的位置（库外的兄弟目录）。
 *
 * 真实宿主把文件交给操作系统回收站，文件**离开库**；这里用库外目录模拟同一语义，
 * 使"进了系统回收站"与"被永久删除"在测试里可以被区分开——
 * 这正是 `deleteMode: 'system-trash'` 长期零覆盖所掩盖的东西。
 */
export function systemTrashDir(vaultRoot: string): string {
  return `${vaultRoot}-system-trash`;
}

export function writeText(vaultRoot: string, rel: string, text: string): void {
  const abs = vaultAbs(vaultRoot, rel);
  nodeFs.mkdirSync(nodePath.dirname(abs), { recursive: true });
  nodeFs.writeFileSync(abs, text, 'utf8');
}

export function writeBinary(vaultRoot: string, rel: string, bytes: Uint8Array): void {
  const abs = vaultAbs(vaultRoot, rel);
  nodeFs.mkdirSync(nodePath.dirname(abs), { recursive: true });
  nodeFs.writeFileSync(abs, Buffer.from(bytes));
}

/** 构造各类附件的最小合法头。 */
export function tinyImage(kind: 'png' | 'jpg' | 'gif' | 'webp' = 'png'): Uint8Array {
  if (kind === 'png') return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  if (kind === 'jpg') return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  if (kind === 'gif') return new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3]);
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
}

export function tinyPdf(): Uint8Array {
  return new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46]);
}

export function tinyMp3(): Uint8Array {
  return new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00]);
}