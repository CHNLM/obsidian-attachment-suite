/**
 * 真实测试基础设施：以 for-test 真实文件系统为后端的 Obsidian API mock。
 * 目的是在 Node 环境里加载“真实构建产物 main.js”，驱动全部命令做端到端验证。
 * 这不依赖任何 Obsidian 运行时，只模拟插件真正用到的 API 表面。
 */

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

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
export function listVaultFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (absDir: string, relDir: string): void => {
    // 排序保证遍历顺序确定（与 Obsidian 稳定列出文件一致）
    const entries = nodeFs
      .readdirSync(absDir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of entries) {
      if (ent.name === '.obsidian' || ent.name === '.trash') continue;
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
export function listVaultFolders(root: string): string[] {
  const out: string[] = [];
  const walk = (absDir: string, relDir: string): void => {
    for (const ent of nodeFs.readdirSync(absDir, { withFileTypes: true })) {
      if (ent.name === '.obsidian' || ent.name === '.trash') continue;
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
  notices: Array<{ level: string; message: string }>;
  ctaClickCallbacks: Array<() => void | Promise<void>>;
}

export interface ObsidianModule {
  Plugin: any;
  TFile: any;
  TFolder: any;
  TAbstractFile: any;
  Notice: any;
  Modal: any;
  ButtonComponent: any;
  Setting: any;
  PluginSettingTab: any;
  normalizePath: (p: string) => string;
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
    constructor(message: string) {
      registry.notices.push({ level: 'info', message: String(message) });
    }
  }

  // 极简 DOM 节点替身（仅插件 onOpen 里的创建/取文本/设类）
  class FakeEl {
    buttons: ButtonComponent[] = [];
    private children: FakeEl[] = [];
    private _cls: string[] = [];
    private _text = '';
    constructor(private readonly tag: string) {}
    createDiv(opts?: any): FakeEl {
      const el = new FakeEl('div');
      this.children.push(el);
      if (opts?.cls) el.addClass(opts.cls);
      if (opts?.text) el.setText(opts.text);
      return el;
    }
    createSpan(opts?: any): FakeEl {
      const el = new FakeEl('span');
      this.children.push(el);
      if (opts?.cls) el.addClass(opts.cls);
      if (opts?.text) el.setText(opts.text);
      return el;
    }
    createEl(tag: string, opts?: any): FakeEl {
      const el = new FakeEl(tag);
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
      if (c) this._cls.push(c);
      return this;
    }
  }

  class ButtonComponent {
    constructor(private readonly el: any) {
      el.buttons.push(this);
    }
    setButtonText(_t: string): this {
      return this;
    }
    setCta(): this {
      return this;
    }
    setWarning(): this {
      return this;
    }
    setClass(_c: string): this {
      return this;
    }
    onClick(cb: () => void | Promise<void>): this {
      registry.ctaClickCallbacks.push(cb);
      return this;
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

  // 设置面板所需，功能测试不打开 UI，只保证符号存在
  class PluginSettingTab {
    constructor(public app: any, public plugin: any) {}
  }
  class Setting {
    constructor(public containerEl: any) {}
    setName(): this {
      return this;
    }
    setDesc(): this {
      return this;
    }
    setHeading(): this {
      return this;
    }
    addToggle(): any {
      return { setValue: () => this, onChange: () => this, setDisabled: () => this };
    }
    addDropdown(): any {
      return { addOption: () => this, setValue: () => this, onChange: () => this };
    }
    addText(): any {
      return { setPlaceholder: () => this, setValue: () => this, onChange: () => this };
    }
    addButton(): any {
      return { setButtonText: () => this, setCta: () => this, setClass: () => this, onClick: () => this };
    }
    addMultiSelect(): any {
      return { addOptions: () => this, setValue: () => this, setSelected: () => this, onChange: () => this };
    }
    setDisabled(): this {
      return this;
    }
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
    addCommand(cmd: { id: string; name: string; callback: () => void | Promise<void> }): void {
      throw new Error('Plugin.addCommand: 请使用 obsidian 运行环境注入');
    }
    registerEvent(_evt: any): void {}
    registerInterval(id: any): any { return id; }
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
    Modal,
    ButtonComponent,
    Setting,
    PluginSettingTab,
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
  /** 设置当前“打开的笔记”。 */
  open(relPath: string): void;
  /** 触发一次 vault.rename 事件。 */
  emitRename(newPath: string, oldPath: string): void;
  /** 触发一次 vault.create/delete 事件。 */
  emitChange(): void;
  /** 触发一次 metadataCache.changed（笔记内容/保存），file 对象带 path。 */
  emitChanged(filePath: string): void;
  /** 触发一次 workspace editor-paste（粘贴）；data 传剪贴板 html/plain。 */
  emitPaste(data: { textHtml?: string; textPlain?: string }): void;
}

/** 构建以真实 for-test 为后端的 TestApp。 */
export function buildTestApp(vaultRoot: string, obsidian: ObsidianModule): TestAppHandle {
  const cmds: Array<{ id: string; name: string; callback: () => void | Promise<void> }> = [];

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
  const on = (evt: string, cb: (...a: any[]) => void): void => {
    (eventHandlers[evt] ??= new Set()).add(cb);
  };

  let activePath: string | null = null;

  const allFiles = (): string[] => listVaultFiles(vaultRoot);

  const app: any = {
    _vaultRoot: vaultRoot,
    _modals: [],
    vault: {
      adapter: {
        exists: async (rel: string): Promise<boolean> => className(rel) !== null,
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
      createFolder: async (rel: string): Promise<void> => {
        nodeFs.mkdirSync(vaultAbs(vaultRoot, rel), { recursive: true });
      },
      delete: async (f: any): Promise<void> => {
        nodeFs.rmSync(vaultAbs(vaultRoot, f.path), { recursive: true, force: true });
      },
      trash: async (f: any, _system: boolean): Promise<void> => {
        // 模拟 Obsidian 回收站：移入 .trash 目录
        const rel = f.path;
        const trashRel = `.trash/${basenameOf(rel)}`;
        const src = vaultAbs(vaultRoot, rel);
        const dst = vaultAbs(vaultRoot, trashRel);
        nodeFs.mkdirSync(nodePath.dirname(dst), { recursive: true });
        try {
          nodeFs.renameSync(src, dst);
        } catch {
          nodeFs.rmSync(src, { recursive: true, force: true });
        }
      },
      getConfig: (key: string): unknown => {
        const cfg = { attachmentFolderPath: '', useMarkdownLinks: false, newFileLocation: 'root' };
        return cfg[key as keyof typeof cfg];
      },
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
      on,
    },
    fileManager: {
      async renameFile(f: any, newPath: string): Promise<void> {
        const src = vaultAbs(vaultRoot, f.path);
        const dst = vaultAbs(vaultRoot, newPath);
        nodeFs.mkdirSync(nodePath.dirname(dst), { recursive: true });
        nodeFs.renameSync(src, dst);
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
  };
}

/* ===================== 夹具：在真实 for-test 上铺设测试数据 ===================== */

/** 清空 for-test（保留 .obsidian），随后铺设完整夹具。 */
export function resetVault(vaultRoot: string, keepObsidian = true): void {
  if (!nodeFs.existsSync(vaultRoot)) nodeFs.mkdirSync(vaultRoot, { recursive: true });
  for (const ent of nodeFs.readdirSync(vaultRoot, { withFileTypes: true })) {
    if (keepObsidian && ent.name === '.obsidian') continue;
    if (ent.name === '.trash') continue;
    nodeFs.rmSync(nodePath.join(vaultRoot, ent.name), { recursive: true, force: true });
  }
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