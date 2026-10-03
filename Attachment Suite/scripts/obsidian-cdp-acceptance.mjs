/**
 * 真实 Obsidian 全量验收（CDP 驱动）。
 *
 * 思路：以 `--remote-debugging-port` 启动 Obsidian 打开验收库，经 CDP（Chrome DevTools Protocol）
 * 连接到渲染进程，在**真实 Obsidian 环境**里启用插件、逐条执行命令、自动点击确认弹窗、
 * 采集通知与最终文件树，最后与预期比对；随后整轮再跑一遍验证幂等。
 *
 * 用法（在插件目录下）：
 *   node scripts/obsidian-cdp-acceptance.mjs
 *   node scripts/obsidian-cdp-acceptance.mjs --vault "D:\\...\\for-test\\acceptance" --port 9222
 *
 * 前置：
 *   1. `npm run build`
 *   2. `npx vitest run tests/e2e/seed-acceptance.test.ts`（生成验收库并投放插件）
 * 说明：脚本自带的本地 HTTP 服务（默认 45999）用于外链用例；Obsidian 需可访问本机回环地址。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { PNG_HEADER, startAcceptanceHttpServer } from './lib/acceptance-http-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const VAULT = path.resolve(arg('vault', path.join(__dirname, '..', '..', 'for-test', 'acceptance')));
const CDP_PORT = Number(arg('port', '9222'));
const HTTP_PORT = Number(arg('httpPort', '45999'));
const OBSIDIAN = arg(
  'obsidian',
  path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'obsidian', 'Obsidian.exe'),
);
const PLUGIN_ID = 'attachment-suite';

/**
 * 配置变体（决定"附件到底落在哪"这一格是否被验证）。
 *
 * - `custom`（默认）：验收库自带配置（`attachmentFolderMode: 'custom'` + `attachmentFolderPath: './assets'`），
 *   附件落在各笔记目录下的 `assets/`。
 * - `obsidian-root`：**插件的默认模式**（跟随 Obsidian）+ Obsidian 的默认
 *   `attachmentFolderPath: '/'`（＝**库根**，不是"笔记同级"）→ 附件应落在库根。
 *   这正是覆盖审计里"真实宿主从未跑过"的那一格：默认配置是用户开箱即用的路径，
 *   而它此前只在 harness（替身 `getConfig`）里被验证过——那一层恰恰是"替身替插件兜底"的重灾区。
 */
const VARIANT = arg('variant', 'custom');
const ROOT_LAYOUT = VARIANT === 'obsidian-root';
/**
 * 是否追加"自动化后台处理"阶段。
 *
 * 为什么必须单独有这一阶段：自动化的链路（库事件 → 标记待处理 → 定时轮询 → 队列 → 处理）
 * 是**只有真实宿主才具备**的——它依赖 `setInterval`、vault/metadataCache 事件与队列。
 * 而验收库基线配置里 `automation.enabled = false`，于是这条链路在真实宿主上一直没被跑过。
 * 覆盖审计把它列为 P1：这类"定时器 + 事件 + 并发"的缺陷恰恰只在真实宿主暴露。
 */
const RUN_AUTOMATION = process.argv.includes('--automation');
/**
 * 是否在候选弹窗上走一次"选中并修复"。
 *
 * 默认行为是**一律跳过**（多候选场景不该替用户做决定，这一点要保持）。
 * 但那样一来"修复"只覆盖了"跳过"那一半，**改写链路（选中 → 写回引用）从未在真实宿主执行过**——
 * 覆盖审计把它列为 P2。开启后仅第一处候选会被选中并点「以此修复」，其余仍跳过。
 */
const FIX_CANDIDATES = process.argv.includes('--fix-candidates');
/** 等待自动处理生效的上限（毫秒）。 */
const AUTOMATION_WAIT_MS = Number(arg('automationWait', '25000'));

/**
 * 启动哨兵阶段：验证**打开库不会静默批量改写**（覆盖审计里的 X02）。
 *
 * 为什么必须单独验：插件唯一一条"不经同意就批量改写整库"的路径就是自动处理
 * （`runAutoProcess` 内部走 `confirm=false` 的命名，不弹确认框）。而它的入口是
 * "启动期 Obsidian 对全库批量触发 metadataCache.changed"。此前的抑制是固定 1500ms
 * 窗口，且测试环境把它置 0 → 该分支在任何测试里一次都不执行。
 *
 * 判定方式是**可观测的端到端事实**，不看日志：启动前记录全库 `.md`/`.canvas` 的内容基线，
 * 带 automation 打开库后**不触碰任何东西**，等过"就绪兜底 + 余震窗口 + 两轮轮询"，
 * 再逐篇比对——任何一篇被改写都算失败。另配一个"哨兵附件"（名字不合规，
 * 一旦被处理就会改名/被搬走）。
 *
 * 非空洞性由两处保证：① 同轮 `--automation` 阶段证明自动处理确实能在库里干活；
 * ② 插件自己的诊断计数会报出"启动期被就绪门挡下多少个 changed"——
 *    > 0 就说明这道门在当前环境里真的在挡东西。
 */
const STARTUP_CHECK = process.argv.includes('--startup-check');
/** 等待时长：需覆盖插件的就绪兜底（8s）+ 余震窗口 + 至少两轮轮询。 */
const STARTUP_WAIT_MS = Number(arg('startupWait', '13000'));
const CANARY_NOTE = 'notes/20-启动哨兵.md';
const CANARY_ATT = 'canary/canary-pic.png';
/** 启动前的笔记内容基线（相对路径 → 内容）；仅 `--startup-check` 时填。 */
let startupBaseline = null;

/**
 * 按变体/开关改写库配置。必须在**启动 Obsidian 之前**调用（Obsidian 启动时才读这些文件）。
 *
 * 纪律：**只改要验的那一个轴**，其余字段必须与验收库基线完全一致。
 * 不要手写一份"精简配置"——其余字段会落到默认值，于是默认的 `blockPrivateHosts=true` 会把
 * 本地回环地址全拦掉、`excludedFolders` 变空，导致几十条与本次变体无关的断言一起爆红（实测 80 条）。
 */
function applyVariantConfig() {
  const dataPath = path.join(VAULT, '.obsidian', 'plugins', PLUGIN_ID, 'data.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const changed = [];

  if (ROOT_LAYOUT) {
    // 前提：这份库必须是刚 seed 出来的。上一轮 custom 变体会建出 notes/assets，
    // 若带着它跑本变体，"不该出现 notes/assets"的断言会因残留而误报——宁可当场说清。
    if (fs.existsSync(path.join(VAULT, 'notes', 'assets'))) {
      console.error('[obsidian-acceptance] 前提不成立：库里已存在 notes/assets（上一轮跑的是 custom 变体）。');
      console.error('[obsidian-acceptance] 请先执行：npx vitest run tests/e2e/seed-acceptance.test.ts');
      process.exit(2);
    }
    const appPath = path.join(VAULT, '.obsidian', 'app.json');
    const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
    app.attachmentFolderPath = '/'; // Obsidian 默认值：'/' 表示**库根**
    fs.writeFileSync(appPath, JSON.stringify(app, null, 2), 'utf8');
    data.attachmentFolderMode = 'obsidian';
    changed.push('attachmentFolderMode=obsidian（app.json 的 attachmentFolderPath 设为 "/"＝库根）');
  }

  if (RUN_AUTOMATION || STARTUP_CHECK) {
    data.automation = { ...(data.automation ?? {}), enabled: true, interval: 1 };
    changed.push(`automation.enabled=true, interval=1${STARTUP_CHECK ? '（启动哨兵需要它在启动时就开着）' : ''}`);
  }

  if (!changed.length) return;
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[obsidian-acceptance] 配置已按需改写（其余保持验收库基线）：${changed.join('；')}`);
}
/**
 * 自动化阶段：在真实宿主上验证「库事件 → 标记待处理 → 定时轮询 → 队列 → 处理」整条链路。
 *
 * 判定标准是**可观测的副作用**，而不是"日志里出现了某行"：
 * 新建一篇引用未命名附件的笔记；若自动处理生效，该附件应被规范命名为
 * `<笔记名>_image_NNN.<ext>`，且笔记引用同步改写、内容原样保留。
 *
 * 这条链路只能在真实宿主验证：它依赖 `setInterval`、vault/metadataCache 事件与队列。
 */
async function runAutomationPhase(cdp, problems) {
  const NOTE = 'AutomationProbe.md';
  const PNG = 'assets/automation-probe.png';
  // 用夹具里现成的 PNG 字节，避免手写 PNG 头；它同时也是"内容原样"的基准
  const beforeB64 = fs.readFileSync(path.join(VAULT, 'assets/png/pic.png')).toString('base64');

  // 清掉上一轮可能留下的探针产物（`vault.create` 对已存在的路径会抛错）
  await cdp.eval(`(async () => {
    for (const p of [${JSON.stringify(NOTE)}, ${JSON.stringify(PNG)}]) {
      const f = window.app.vault.getAbstractFileByPath(p);
      if (f) await window.app.vault.delete(f);
    }
    return 1;
  })()`);

  const t0 = Date.now();
  await cdp.eval(`(async () => {
    const bin = atob(${JSON.stringify(beforeB64)});
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    await window.app.vault.createBinary(${JSON.stringify(PNG)}, arr.buffer);
    await window.app.vault.create(${JSON.stringify(NOTE)}, '# 自动化探针\\n\\n![p](assets/automation-probe.png)\\n');
    await window.app.workspace.openLinkText(${JSON.stringify(NOTE)}, '', false);
    return 1;
  })()`);

  let hit = null;
  const until = Date.now() + AUTOMATION_WAIT_MS;
  while (Date.now() < until && !hit) {
    const files = await cdp.eval(`window.app.vault.getFiles().map((f) => f.path)`);
    hit = (files ?? []).find((f) => /AutomationProbe_image_\d{3}\.png$/.test(f)) ?? null;
    if (!hit) await sleep(500);
  }
  const elapsed = Date.now() - t0;
  if (!hit) {
    problems.push(
      `[自动化] ${AUTOMATION_WAIT_MS}ms 内自动处理未发生：新建笔记引用的附件始终没被规范命名（定时器 / 事件 / 队列链路未生效）`,
    );
    return { ran: false, elapsedMs: elapsed };
  }

  console.log(`   · 自动处理已生效：${PNG} → ${hit}（${elapsed}ms）`);
  const text = fs.readFileSync(path.join(VAULT, NOTE), 'utf8');
  if (!text.includes(path.basename(hit))) {
    problems.push(`[自动化] 自动处理后笔记引用没跟上改名（真实断链）：${text.slice(0, 120)}`);
  }
  if (fs.readFileSync(path.join(VAULT, hit)).toString('base64') !== beforeB64) {
    problems.push('[自动化] 自动改名后附件内容变了（应原样搬移）');
  }
  return { ran: true, renamedTo: hit, elapsedMs: elapsed };
}

/** 命令基名（源码里注册的 `addCommand({id})`）。真实 id 由 Obsidian 加插件前缀，见 resolveCommandIds()。 */
const COMMANDS = [
  'attachment:check-consistency',
  'attachment:fix-broken-links',
  'attachment:repair-incompatible-paths',
  'attachment:cleanup-empty-folders',
  'attachment:collect-current-note',
  'attachment:bulk-collect',
  'attachment:rename-note',
  'attachment:bulk-rename',
  'attachment:localize-note',
  'attachment:bulk-localize',
  'attachment:export-note',
  'attachment:export-unused',
  'attachment:cleanup-unused',
];

/**
 * 把源码里的命令基名解析成**运行时真实 id**。
 *
 * 必要：Obsidian 会给 `addCommand({id})` 自动加插件前缀，所以源码写 `attachment:localize-note`
 * 时，真实 id 是 `attachment-suite:attachment:localize-note`。写死基名调用
 * `executeCommandById` 会静默失败（返回 false、什么都不发生）——第一版脚本就是这么"跑完 13 条命令"
 * 却一个文件都没动。这里按**后缀**匹配（各命令后缀唯一），从而对前缀形式免疫。
 */
async function resolveCommandIds(cdp) {
  const all = await cdp.eval('Object.keys(window.app.commands.commands)');
  const bySuffix = new Map();
  for (const id of all) bySuffix.set(String(id).split(':').pop(), id);
  const resolved = [];
  const missing = [];
  for (const base of COMMANDS) {
    const real = bySuffix.get(base.split(':').pop());
    if (real) resolved.push(real);
    else missing.push(base);
  }
  if (missing.length) throw new Error(`以下命令未在 Obsidian 中注册：${missing.join(', ')}`);
  console.log(`   · 命令 id 已解析（${resolved.length} 条，示例：${resolved[0]}）`);
  return resolved;
}

/* ------------------------------- CDP 客户端 ------------------------------- */

async function fetchJson(url, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function waitForCdp(deadlineMs) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const pages = (list ?? []).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pages.length > 0) return pages;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}

/** 该页面是否就是验收库（按 basePath 精确比对，避免误连到用户其它已打开的库）。 */
async function pageIsVault(page) {
  const probe = `(() => {
    const a = window.app && window.app.vault && window.app.vault.adapter;
    return (a && (a.basePath || (a.getBasePath && a.getBasePath()) || '')) || '';
  })()`;
  let cdp = null;
  try {
    cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    const base = await cdp.eval(probe, { timeoutMs: 15000 });
    const norm = (p) => path.resolve(String(p || '')).replace(/\\/g, '/').toLowerCase();
    return !!base && norm(base) === norm(VAULT);
  } catch {
    return false;
  } finally {
    try { cdp?.ws.close(); } catch { /* ignore */ }
  }
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.closed = null;
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
    });
    // 必须处理 close：Obsidian 若退出（例如应用了版本更新后重启），
    // 未决请求会永远挂着，脚本表现为"无输出卡死"。这里统一 reject 掉。
    ws.addEventListener('close', () => {
      this.closed = 'CDP 连接已关闭';
      this.failAll('CDP 连接已关闭（Obsidian 可能已退出或重启）');
    });
    ws.addEventListener('error', () => {
      this.closed = 'CDP 连接错误';
      this.failAll('CDP 连接错误');
    });
  }

  failAll(msg) {
    for (const [, p] of this.pending) p.reject(new Error(msg));
    this.pending.clear();
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', (e) => reject(new Error(`CDP 连接失败：${e?.message ?? 'unknown'}`)), { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}, timeoutMs = 180000) {
    if (this.closed) return Promise.reject(new Error(this.closed));
    const id = ++this.id;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 响应超时（${timeoutMs}ms）：${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(payload);
    });
  }

  /** 在渲染进程里执行 JS（支持 await）。 */
  async eval(expr, { awaitPromise = true, timeoutMs = 120000 } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise,
      returnByValue: true,
      timeout: timeoutMs,
    });
    if (r.exceptionDetails) {
      throw new Error(`渲染进程异常：${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
    return r.result?.value;
  }
}

/* --------------------------------- 工具 --------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 收尾：连同子进程树一起结束本脚本拉起的 Obsidian（复用别人实例时不动手）。 */
function killObsidian(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    try { child.kill(); } catch { /* ignore */ }
  }
}

/** 轮询直到表达式为真（在渲染进程求值）。连接断开时立刻返回 false，不再空等。 */
async function waitUntil(cdp, expr, label, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (cdp.closed) return false;
    try {
      if (await cdp.eval(`!!(${expr})`)) return true;
    } catch {
      return false;
    }
    await sleep(300);
  }
  console.log(`   ! 等待超时：${label}`);
  return false;
}

/** 摘要：文件树 + 通知（在渲染进程内采集，避免逐个往返）。 */
const SNAPSHOT_EXPR = `(async () => {
  const app = window.app;
  const plugin = app.plugins.plugins['${PLUGIN_ID}'];
  const files = app.vault.getFiles().map((f) => f.path).sort();
  const folders = (app.vault.getAllLoadedFiles?.() ?? [])
    .filter((f) => f.children !== undefined).map((f) => f.path).sort();
  const notes = {};
  // cachedRead 是异步的：必须逐个 await，否则 notes[p] 只是 Promise，returnByValue 会退化成 {}
  // **必须包含 .canvas**：canvas 的 file 字段也是引用，落在扫描范围外就看不见"引用悬空"。
  for (const p of files.filter((f) => f.endsWith('.md') || f.endsWith('.canvas'))) {
    const f = app.vault.getAbstractFileByPath(p);
    try { notes[p] = f ? await app.vault.cachedRead(f) : ''; } catch { notes[p] = ''; }
  }
  return { files, folders, notes, notices: plugin?.__acceptanceNotices ?? [] };
})()`;

/** 采集通知：包装 Notice 记录（幂等，只装一次）。 */
const HOOK_NOTICES = `(() => {
  const app = window.app;
  const plugin = app.plugins.plugins['${PLUGIN_ID}'];
  if (!plugin) return false;
  if (!plugin.__acceptanceNotices) {
    plugin.__acceptanceNotices = [];
    const Orig = window.Notice;
    window.Notice = class extends Orig {
      constructor(message, timeout) {
        super(message, timeout);
        try { plugin.__acceptanceNotices.push(String(message)); } catch {}
      }
    };
  }
  return true;
})()`;

async function collect(cdp) {
  const snap = await cdp.eval(SNAPSHOT_EXPR);
  snap.notices = (await cdp.eval(`(window.app.plugins.plugins['${PLUGIN_ID}']?.__acceptanceNotices ?? []).slice()`)) ?? [];
  return snap;
}

/**
 * 点击当前弹窗里的"推进流程"按钮（本插件自绘 DOM + Obsidian 原生确认框）。
 *
 * 三类弹窗要区别对待：
 * - **Obsidian 原生「更新链接？」框**（`总是更新` / `仅此一次` / `不做更新`）：选 `总是更新`。
 *   它是 `fileManager.renameFile` 在"自动更新内部链接"关闭时弹出的，**会阻塞整条改名流程**；
 *   `总是更新` 会被 Obsidian 记住，后续不再弹。真实 Obsidian 独有（测试替身里没有）。
 * - **候选选择窗**（含 `.iap-candidate-item`）：**必须跳过**——多候选场景下自动挑一个是
 *   "替用户做决定"，验收要求它保持原样。
 *   但"选定并修复"这条路径也必须被验证：加 `--fix-candidates` 后，**第一处**候选会被选中并点
 *   「以此修复」，其余仍跳过。否则"修复"只覆盖了"跳过"那一半，而**改写链路（选中 → 写回引用）
 *   从未在真实宿主执行过**。
 * - **预览/确认窗**：点 `确认`（`ConfirmModal` 的 CTA）；**报告窗**点 `关闭`。
 *
 * 注意**不能点 `取消`/`不做更新`**：那等于放弃执行，会让后续断言全变成"命令没生效"。
 */
const CLICK_CONFIRM = `(() => {
  const modal = document.querySelector('.modal-container');
  if (!modal) return null;
  const btns = Array.from(modal.querySelectorAll('button'));
  const find = (re) => btns.find((b) => re.test((b.textContent ?? '').trim()));
  // 1) Obsidian 原生「更新链接？」——必须"总是更新"，否则改名不改链接
  const native = find(/^总是更新$/) ?? find(/^仅此一次$/);
  if (native) { native.click(); return native.textContent.trim() + '(原生)'; }
  // 2) 本插件的候选选择窗
  if (modal.querySelector('.iap-candidate-item')) {
    // 2a) --fix-candidates：仅第一处走"选中并修复"（一次性标记，避免替用户决定整批断链）
    if (window.__iapFixCandidates && !window.__iapFixCandidatesUsed) {
      const item = modal.querySelector('.iap-candidate-item');
      if (item) {
        item.click();
        const fix = Array.from(modal.querySelectorAll('button'))
          .find((b) => /以此修复/.test((b.textContent ?? '').trim()));
        if (fix && !fix.disabled) {
          window.__iapFixCandidatesUsed = true;
          window.__iapFixPicked = (item.textContent ?? '').trim();
          fix.click();
          return '以此修复(候选)';
        }
      }
    }
    const skip = find(/^跳过$/) ?? find(/全部跳过/);
    if (skip) { skip.click(); return '跳过(候选)'; }
  }
  // 3) 预览 / 确认窗
  const cta = find(/确认|以此修复|继续|应用|确定/);
  if (cta) { cta.click(); return cta.textContent.trim(); }
  // 4) 报告窗
  const close = find(/^关闭$/);
  if (close) { close.click(); return '关闭(报告)'; }
  return null;
})()`;

/** 关闭可能阻塞的第三方弹窗（社区插件信任提示等）。 */
const DISMISS_BLOCKERS = `(() => {
  const btns = Array.from(document.querySelectorAll('.modal-container button, .modal button'));
  const t = btns.find((b) => /启用社区插件|Turn on community plugins|启用插件|信任|Trust/.test(b.textContent ?? ''));
  if (t) { t.click(); return t.textContent.trim(); }
  return null;
})()`;

/** 清掉残留弹窗（含上一轮没答完的原生框），避免它挡住后续命令。 */
async function clearModals(cdp, label) {
  for (let i = 0; i < 20; i++) {
    const open = await cdp.eval(`document.querySelectorAll('.modal-container').length`);
    if (open === 0) return;
    const clicked = await cdp.eval(CLICK_CONFIRM);
    if (clicked) {
      console.log(`   · 清理残留弹窗（${label}）：${clicked}`);
      await sleep(300);
      continue;
    }
    // 认不出的弹窗：按 Esc 收起，避免阻塞
    await cdp.eval(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 1)`);
    await sleep(300);
    const still = await cdp.eval(`document.querySelectorAll('.modal-container').length`);
    if (still === 0) return;
    console.log(`   ! 有弹窗无法自动处理（${label}），共 ${still} 个`);
    return;
  }
}

/** 执行一条命令并处理其弹窗（可多次弹窗的交互层）。 */
async function runCommand(cdp, id) {
  await clearModals(cdp, `执行前 ${id.split(':').pop()}`);
  await cdp.eval(`window.app.commands.executeCommandById(${JSON.stringify(id)}), 1`);
  let clicks = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    const blocker = await cdp.eval(DISMISS_BLOCKERS);
    if (blocker) {
      console.log(`   · 关闭阻塞弹窗：${blocker}`);
      continue;
    }
    const opened = await cdp.eval(`document.querySelectorAll('.modal-container').length`);
    if (opened === 0) break;
    const clicked = await cdp.eval(CLICK_CONFIRM);
    if (clicked) {
      clicks++;
      continue;
    }
    // 弹窗在但没有可点的推进按钮 → 不再空转
    break;
  }
  await clearModals(cdp, `执行后 ${id.split(':').pop()}`);
  return clicks;
}

/* -------------------------------- 断言 -------------------------------- */

/**
 * 从笔记/画布文本提取本地引用目标（跳过外部 URL / data / 锚点 / 邮件），并保留**语法形态**。
 *
 * 与 `tests/e2e/acceptance.test.ts` 同一套解析，三处必须同步（缺一处就会漏掉一整类缺陷）：
 * - **wiki 剥掉 `#锚点` 与 `|别名`**：否则 `[[assets/a.pdf|说明文档]]`（本地化普通链接的产出形态）
 *   会被当成"名字里带 | 的路径"，解析必然失败；
 * - **canvas 的 `file` 字段**：插件的索引层把它算作"在用"，脚本若不解析，则
 *   "canvas 引用悬空 + 附件被当孤儿删掉"这一类**完全在扫描范围外**；
 * - **markdown 的 `<>` 包裹形式**：目标含空格时的合法写法。
 */
function localRefs(text) {
  const out = [];
  const push = (raw, kind) => {
    if (!raw) return;
    const t = raw.split('#')[0].trim();
    if (!t || /^(https?:|data:|mailto:|#)/i.test(t)) return;
    let decoded = t.replace(/^<|>$/g, '');
    try { decoded = decodeURIComponent(decoded); } catch { /* 畸形转义保持原样 */ }
    out.push({ target: decoded, kind });
  };
  for (const m of text.matchAll(/!?\[\[([^\]#|]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) push(m[1], 'wiki');
  // md 目标允许**一层括号嵌套**（`报告 (1).png` 是 Windows 上合法且常见的文件名）。
  // 写成 `([^)]+)` 会在 `(1)` 的 `)` 处收尾 → 截断目标既不进"在用"集合、也无法被改写，
  // 结果就是附件被当孤儿清理 + 笔记留下断链（2026-09-28 验收用例 L06/P01 实测）。
  // 与 `src/core/link-resolver.ts` 的 MD_DEST 保持同一口径（本文件是 .mjs/TS 两套实现，守卫在
  // tests/unit/acceptance-tooling.test.ts）。
  for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>]+)>|((?:[^()]|\([^()]*\))*))\)/g)) {
    push(m[1] ?? m[2], 'md');
  }
  for (const m of text.matchAll(/<(?:img|audio|video|source)\b[^>]*?src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    push(m[1] ?? m[2] ?? m[3], 'html');
  }
  for (const m of text.matchAll(/"file"\s*:\s*"([^"]*)"/g)) push(m[1], 'canvas');
  return out;
}

const basenameOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const stemOf = (p) => {
  const b = basenameOf(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(0, i) : b;
};

/**
 * 引用在当前文件树里能否解析。规则按语法区分：
 * - **路径式**（含 `/`）：wiki 忽略路径、按文件名解析；markdown / HTML / canvas 是路径式的 → 必须精确路径命中；
 * - **纯 basename**：三种写法 Obsidian 都按文件名解析；
 * - **wiki 且无扩展名**（`![[song]]`）：Obsidian 按**主名**解析（命中 `song.mp3`）。
 *
 * 早期实现一律按 basename 兜底，于是"引用被改到另一个同名文件"也算可解析——
 * 那正是最需要被这条不变式抓住的数据级错误指向。
 */
/** 全库"悬空引用"计数（与不变式同一套按语法解析的口径）。 */
function countUnresolved(files, notes) {
  let n = 0;
  for (const text of Object.values(notes ?? {})) {
    for (const ref of localRefs(text)) if (!resolvable(ref, files)) n++;
  }
  return n;
}

function resolvable(ref, files) {
  const target = typeof ref === 'string' ? ref : ref.target;
  const kind = typeof ref === 'string' ? 'md' : ref.kind;
  const norm = target.replace(/^\.\//, '');
  if (files.includes(norm)) return true;
  const base = basenameOf(norm);
  const byStem = () => kind === 'wiki' && !base.includes('.') && files.some((f) => stemOf(f) === base);
  if (norm.includes('/')) {
    if (kind === 'wiki') return files.some((f) => basenameOf(f) === base) || byStem();
    return false;
  }
  return files.some((f) => basenameOf(f) === base) || byStem();
}

/**
 * 结果检查。
 *
 * **用语义不变式，不用"原始路径"**：一轮 13 条命令本来就会连锁改名/移动附件，
 * 断言"`assets/gif/pic.gif` 还在"只会把正常的命名行为误报成"文件消失"
 * （harness 版早已改成不变式，本脚本此处曾漏改）。真正要守住的是四件事：
 * 非受管文件不得被动 · 排除目录整块不动 · **没有制造新断链** · 该清的清了、该留的留了。
 */
function checkResults(snap, phase, before) {
  const problems = [];
  const has = (p) => snap.files.includes(p);
  const noteText = (p) => snap.notes[p] ?? '';

  // 1) 非受管文件必须原样存在（同名同路径）：插件不应管理这些类型
  for (const p of ['assets/noext', 'assets/other/note.txt', 'orphans/zip-orphan.zip', 'orphans/csv-orphan.csv']) {
    if (!has(p)) problems.push(`[${phase}] 非受管文件被移除或改名：${p}`);
  }
  // 2) 排除目录整块不动（文件与空目录都不许动）
  const exclBefore = before.files.filter((f) => f.startsWith('excluded/')).sort();
  const exclAfter = snap.files.filter((f) => f.startsWith('excluded/')).sort();
  if (JSON.stringify(exclBefore) !== JSON.stringify(exclAfter)) {
    problems.push(`[${phase}] 排除目录内容被改动：${exclBefore.length} → ${exclAfter.length}`);
  }
  if (!snap.folders.includes('excluded/empty-in-excluded')) problems.push(`[${phase}] 排除目录内的空目录被清理`);
  // 3) 核心不变式：没有制造新断链（每篇笔记"可解析引用数"不得减少）
  for (const [p, beforeText] of Object.entries(before.notes)) {
    if (!has(p)) {
      problems.push(`[${phase}] 笔记/画布消失：${p}`);
      continue;
    }
    const b = localRefs(beforeText).filter((r) => resolvable(r, before.files)).length;
    const nowRefs = localRefs(noteText(p));
    const a = nowRefs.filter((r) => resolvable(r, snap.files)).length;
    if (a < b) {
      const bad = nowRefs.filter((r) => !resolvable(r, snap.files)).map((r) => `${r.kind}:${r.target}`);
      problems.push(`[${phase}] ${p} 出现新断链：可解析引用 ${b} → ${a}；悬空=[${bad.join(' | ')}]`);
    }
  }
  // 4) canvas 的 file 引用必须仍可解析（2026-09-28 的真实数据损失缺陷：
  //    索引层认 canvas、改写层不认 → 「收集+命名」后引用悬空 → 「清理未用」把附件删掉）。
  const canvas = noteText('canvas/画布用例.canvas');
  if (canvas) {
    for (const m of canvas.matchAll(/"file"\s*:\s*"([^"]*)"/g)) {
      if (m[1].includes('canvas-missing')) continue; // 夹具里"故意缺失"的那一个
      if (!resolvable({ target: m[1], kind: 'canvas' }, snap.files)) {
        problems.push(`[${phase}] canvas 的 file 引用悬空：${m[1]}（改完文件引用没跟上）`);
      }
    }
  }
  // 5) 外链已本地化：只校验"本应本地化"之外的笔记；下面这些是**有意保留**的
  const keepExternal = new Set([
    'externals/网页.md',     // HTML 文档永不落存
    'externals/404.md',      // 下载失败
    'externals/内网.md',     // 不可达（本机 1 端口）
    'externals/黑名单.md',   // 域名黑名单
    'externals/仅白名单.md', // 未命中白名单
    'externals/svg外链.md',  // SVG 格式层面拒绝
    'externals/非受管外链.md', // 非受管类型（txt）
    'externals/含括号目标.md', // 目标含未转义括号 → 主动跳过（宁可漏本地化也不改坏正文）
  ]);
  for (const [p, t] of Object.entries(snap.notes)) {
    if (p.startsWith('excluded/') || keepExternal.has(p)) continue;
    if (/127\.0\.0\.1:45999/.test(t)) problems.push(`[${phase}] ${p} 仍含未本地化的外链`);
  }
  // 6) 保形改写
  if (noteText('notes/18-HTML媒体标签.md').includes('![](')) problems.push(`[${phase}] HTML 媒体标签被改写成图片嵌入`);
  if (noteText('externals/普通链接.md').includes('![说明文档]')) problems.push(`[${phase}] 普通链接被改写成图片嵌入`);
  // 6b) 目标含未转义括号时必须**原文不改**：改写的产物会是半截链接（`...local.png).png)`）
  if (noteText('externals/含括号目标.md') !== (before.notes['externals/含括号目标.md'] ?? '')) {
    problems.push(`[${phase}] 含未转义括号的目标被改写了（可能产出半截链接，属"宁可漏本地化也不改坏正文"的反例）`);
  }
  // 6c) 带标题的外链必须真的被本地化（旧实现整条漏掉），且 alt/图注不得丢失
  const titled = noteText('externals/带标题.md');
  if (titled.includes('127.0.0.1:45999')) problems.push(`[${phase}] 带标题的外链未被本地化（"目标后接不到 )"的旧缺陷回归）`);
  if (!titled.includes('图注')) problems.push(`[${phase}] 带标题外链的 alt/图注在改写中丢失`);
  // 7) 命名生效（引用可解析到 <笔记名>_image_NNN 形态的文件）
  const t01 = noteText('notes/01-正文图片.md');
  if (!/01-正文图片_image_\d{3}\.png/.test(t01)) problems.push(`[${phase}] 01 笔记未按方案命名：${t01.slice(0, 120)}`);
  // 7.5) 落盘位置：**按变体断言**。这是"附件到底落在哪"的唯一真实验证。
  if (ROOT_LAYOUT) {
    if (!snap.files.some((f) => /^01-正文图片_image_\d{3}\.png$/.test(f))) {
      problems.push(`[${phase}] 默认配置（跟随 Obsidian + '/'）下附件未落在库根`);
    }
    if (snap.folders.includes('notes/assets')) {
      problems.push(`[${phase}] 默认配置下不该出现 notes/assets（说明仍按"笔记相对"落盘）`);
    }
  } else if (!noteText('notes/01-正文图片.md').includes('assets/')) {
    problems.push(`[${phase}] custom 变体下 01 笔记的引用不再指向 assets/（落盘位置漂了）`);
  }
  // 8) 该清的清了（真孤儿 / 空目录），该留的留着（含隐藏文件的目录）
  if (has('orphans/true-orphan.png')) problems.push(`[${phase}] 真孤儿未被清理（命令可能未生效）`);
  if (!has('Unused_Attachments.zip')) problems.push(`[${phase}] 导出未用附件未生成 zip`);
  for (const d of ['empty/leaf', 'empty/parent/child', 'empty/deep/a/b/c']) {
    if (snap.folders.includes(d)) problems.push(`[${phase}] 空目录未被清理：${d}`);
  }
  if (!snap.folders.includes('empty/hidden-file')) problems.push(`[${phase}] 含隐藏文件的目录被误清理`);
  return problems;
}

/**
 * 连接并确认可用。
 *
 * 为什么要"按时限轮询 + 每次重新取页面列表"：
 * - Obsidian 打开调试端口后，目标窗口要再等一会才把库加载完（此前 `app.vault` 还不存在），
 *   一次性探一次很容易探到"还没就绪"的页面而误判为不匹配；
 * - 用户可能同时开着别的库（多窗口 = 多 page），必须按 basePath 命中验收库；
 * - 应用若在启动时自我接管（自动更新后重启），端口会断开重开，只看一次会拿到死连接。
 */
async function connectStable(timeoutMs = 120000) {
  const until = Date.now() + timeoutMs;
  let lastLog = 0;
  while (Date.now() < until) {
    const pages = await waitForCdp(5000);
    if (pages) {
      for (const page of pages) {
        if (!(await pageIsVault(page))) continue;
        try {
          const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
          await cdp.send('Runtime.enable');
          const probe = await cdp.eval('1 + 1', { timeoutMs: 15000 });
          if (probe === 2) return cdp;
        } catch (e) {
          console.log(`   · 连接失败：${e.message}`);
        }
      }
      if (Date.now() - lastLog > 15000) {
        lastLog = Date.now();
        console.log(`   · 等待验收库窗口就绪（当前 ${pages.length} 个页面）…`);
      }
    }
    await sleep(1500);
  }
  return null;
}

/** 统计库内真实文件数（与 Obsidian 索引口径一致：跳过点文件与点目录）。 */
function diskFileCount(root) {
  let n = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else n++;
    }
  };
  walk(root);
  return n;
}

/**
 * 库内文件的"内容 ↔ 路径"双向索引。
 *
 * 为什么需要："附件没被删"**不能**按路径判断——13 条命令本来就会连锁改名/移动附件，
 * 甚至把它们搬进各自笔记的归属目录。唯一可靠的判据是"这份内容还在库里"。
 * 跳过点目录（`.trash/` 也算），因为被移进回收站对用户而言就是删除。
 */
function contentIndex(root) {
  const byContent = new Map();
  const byPath = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      const rel = path.relative(root, p).replace(/\\/g, '/');
      const b64 = fs.readFileSync(p).toString('base64');
      byPath.set(rel, b64);
      const list = byContent.get(b64);
      if (list) list.push(rel);
      else byContent.set(b64, [rel]);
    }
  };
  walk(root);
  return { byContent, byPath };
}

/**
 * 必须"内容仍在库里"的夹具附件。
 *
 * - `only-canvas.png` / `only-frontmatter.png`：只被 canvas / frontmatter 引用的附件。
 *   插件索引层认得它们（算作"在用"），改写层一度**不认** canvas，于是
 *   「收集 → 命名 → 清理」能把它们整条吃掉。验收的 O06/O07 正为此设。
 * - `shared.png`：被两篇笔记共享（一篇走 markdown、一篇走 HTML 标签）。
 *   Obsidian 的改名联动不认识 HTML，故共享判定一旦出错就会让 HTML 侧悬空。
 */
const GUARDED_CONTENT = [
  'orphans/only-canvas.png',
  'orphans/only-frontmatter.png',
  'assets/shared/shared.png',
  // 被三篇笔记用**三种不同语法**引用的 mp3（短名 / 路径式 / HTML src）。
  // 2026-09-28 实测：`![[song]]` 未随改名改写 → 原文件被当孤儿移入回收站、笔记留下悬空引用。
  'assets/mp3/song.mp3',
];

/** 受保护附件的内容是否仍在库中（按内容指纹比对，跳过 .trash）。 */
function checkContentSurvival(beforeIndex, afterIndex, phase) {
  const problems = [];
  for (const rel of GUARDED_CONTENT) {
    const fp = beforeIndex.byPath.get(rel);
    if (!fp) continue; // 夹具缺失就不误报
    if (!afterIndex.byContent.has(fp)) problems.push(`[${phase}] 受保护附件的内容在库中消失（原路径 ${rel}）`);
  }
  return problems;
}

/* ---------------------------------- 主流程 ---------------------------------- */

/** 库内 `.md`/`.canvas` 的内容快照（跳过点目录：`.obsidian` / `.trash`）。 */
function snapshotNoteTexts() {
  const out = {};
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs, r);
      else if (/\.(md|canvas)$/i.test(e.name)) out[r] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(VAULT, '');
  return out;
}

/**
 * 启动哨兵的**前置动作**：放哨兵文件 + 记录基线。必须在启动 Obsidian 之前调用——
 * 哨兵必须赶在宿主索引之前存在，否则它自己不会经历启动期的那批事件。
 */
function prepareStartupCheck() {
  if (!STARTUP_CHECK) return;
  const dir = path.join(VAULT, 'canary');
  fs.mkdirSync(dir, { recursive: true });
  // 内容带唯一标记：附件一旦被改名/搬走，按路径即可判定（不必比对字节）
  fs.writeFileSync(path.join(VAULT, CANARY_ATT), Buffer.concat([PNG_HEADER, Buffer.from('MARKER-CANARY')]));
  fs.writeFileSync(
    path.join(VAULT, CANARY_NOTE),
    `# 20 启动哨兵\n\n![x](${CANARY_ATT})\n`,
    'utf8',
  );
  startupBaseline = snapshotNoteTexts();
  console.log(
    `[obsidian-acceptance] 启动哨兵已放置（${CANARY_NOTE} → ${CANARY_ATT}），` +
      `并记录 ${Object.keys(startupBaseline).length} 篇笔记的内容基线`,
  );
}

/**
 * 启动哨兵阶段：等过"就绪兜底 + 余震窗口 + 两轮轮询"，断言打开库没有改写任何笔记。
 * 必须在**任何命令之前**执行，否则分不清"是自动处理改的"还是"命令改的"。
 */
async function runStartupCheck(cdp, problems) {
  if (!STARTUP_CHECK) return null;
  console.log(`   · 启动哨兵：全程不触碰库，等待 ${STARTUP_WAIT_MS}ms（盖过就绪兜底与两轮轮询）…`);
  await sleep(STARTUP_WAIT_MS);

  const diag = await cdp.eval(
    `(() => {
       const p = window.app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
       return typeof p?.getAutomationDiagnostics === 'function' ? p.getAutomationDiagnostics() : null;
     })()`,
  );

  const now = snapshotNoteTexts();
  const changed = [];
  for (const [rel, text] of Object.entries(now)) {
    if (!(rel in startupBaseline)) changed.push(`${rel}（新建）`);
    else if (startupBaseline[rel] !== text) changed.push(rel);
  }
  for (const rel of Object.keys(startupBaseline)) if (!(rel in now)) changed.push(`${rel}（消失）`);

  const canaryNoteOk = String(now[CANARY_NOTE] ?? '').includes(CANARY_ATT);
  const canaryAttOk = fs.existsSync(path.join(VAULT, CANARY_ATT));
  const suppressed = diag?.stats?.suppressedNotSettled ?? 0;
  const refused = diag?.stats?.sweepRefused ?? 0;

  if (changed.length) {
    problems.push(
      `[启动哨兵] 打开库后未做任何操作，却有 ${changed.length} 篇笔记被改写：` +
        `${changed.slice(0, 5).join('、')}${changed.length > 5 ? ` …（共 ${changed.length} 篇）` : ''}`,
    );
  }
  if (!canaryNoteOk) problems.push(`[启动哨兵] 哨兵笔记被自动改写（引用已不再指向 ${CANARY_ATT}）`);
  if (!canaryAttOk) problems.push(`[启动哨兵] 哨兵附件被自动改名/搬走：${CANARY_ATT} 已不在原处`);

  console.log(
    `   · 启动哨兵结果：笔记改写 ${changed.length} 篇 / 哨兵附件${canaryAttOk ? '仍在原处' : '已消失'}；` +
      `就绪信号=${diag?.settleSource || '（无）'}，启动期被就绪门挡下 ${suppressed} 个 changed，` +
      `批量护栏拒绝 ${refused} 次`,
  );
  if (!diag) {
    console.warn('   ! 取不到插件诊断（getAutomationDiagnostics）→ 无法判断"这道门是否真在挡东西"');
  }
  return {
    noteChanges: changed.length,
    changed: changed.slice(0, 20),
    canaryIntact: canaryNoteOk && canaryAttOk,
    suppressedAtStartup: suppressed,
    sweepRefused: refused,
    settleSource: diag?.settleSource ?? null,
    settledAt: diag?.settledAt ?? null,
    diagnostics: diag ?? null,
  };
}

async function main() {
  applyVariantConfig();
  prepareStartupCheck();
  if (!fs.existsSync(OBSIDIAN)) throw new Error(`未找到 Obsidian：${OBSIDIAN}`);
  if (!fs.existsSync(path.join(VAULT, '.obsidian', 'plugins', PLUGIN_ID, 'main.js'))) {
    throw new Error(`验收库未就绪（缺插件）：先 npm run build 并跑 seed-acceptance 测试 —— ${VAULT}`);
  }

  const server = await startAcceptanceHttpServer(HTTP_PORT);
  console.log(`[obsidian-acceptance] 本地服务已启动 http://127.0.0.1:${HTTP_PORT}`);

  // 已有实例（且带着调试端口）则复用，否则拉起一个。
  //
  // 注意：这里**故意不用 detached**。在受限的自动化宿主里，detached 出去的子进程会在
  // 启动它的命令结束时被一并回收（表现为"Obsidian 启动后十几秒自己退出"）。
  // 让 Obsidian 作为本脚本的子进程存活，脚本结束时再 `taskkill /T` 收干净。
  let spawned = null;
  let existing = await waitForCdp(3000);
  if (!existing) {
    console.log(`[obsidian-acceptance] 启动 Obsidian：${OBSIDIAN}`);
    spawned = spawn(OBSIDIAN, [VAULT, `--remote-debugging-port=${CDP_PORT}`], { stdio: 'ignore' });
  } else {
    console.log('[obsidian-acceptance] 复用已运行的 Obsidian 实例');
  }

  const cdp = await connectStable();
  if (!cdp) {
    console.log('[obsidian-acceptance] 无法连接 CDP（Obsidian 可能已在运行但未开放调试端口）。');
    console.log('[obsidian-acceptance] 请改用人工清单模式：按 for-test/acceptance/EXPECTED.md 逐条核对。');
    server.close();
    killObsidian(spawned);
    process.exit(2);
  }
  await sleep(2000); // 等应用把工作区与插件宿主就绪
  process.on('exit', () => killObsidian(spawned));
  // 等待工作区与插件宿主就绪
  await waitUntil(cdp, 'window.app && window.app.workspace && window.app.plugins', 'Obsidian 就绪', 60000);
  console.log('[obsidian-acceptance] 已连接 Obsidian 渲染进程');

  // 关闭受限模式并启用插件（内部 API；真实用户走设置面板）
  await cdp.eval(`(async () => { window.app.plugins.setEnable(true); return 1; })()`);
  for (let i = 0; i < 10; i++) {
    await cdp.eval(DISMISS_BLOCKERS);
    await sleep(500);
  }
  await cdp.eval(
    `(async () => { if (!window.app.plugins.plugins['${PLUGIN_ID}']) { await window.app.plugins.enablePlugin('${PLUGIN_ID}'); } return 1; })()`,
  );
  const ok = await waitUntil(cdp, `window.app.plugins.plugins['${PLUGIN_ID}']`, '插件已加载', 30000);
  if (!ok) throw new Error('插件未能加载，请检查验收库中的 main.js / manifest.json');
  await cdp.eval(HOOK_NOTICES);
  await cdp.eval(`(window.app.plugins.plugins['${PLUGIN_ID}'].__acceptanceNotices = [])`);
  console.log('[obsidian-acceptance] 插件已启用，开始执行命令');

  // 前置校验：库索引必须与磁盘一致。
  // 验收库会被"外部"（seed 生成器）整体重写，而 Obsidian 的文件监听可能跟不上批量删除，
  // 于是索引里会留下磁盘上已不存在的幽灵条目——那时整轮结论都建立在假数据上。
  const onDisk = diskFileCount(VAULT);
  console.log(`   · 库索引 ${(await collect(cdp)).files.length} 个 / 磁盘 ${onDisk} 个`);
  const idxNow = await collect(cdp);
  if (idxNow.files.length !== onDisk) {
    throw new Error(
      `库索引与磁盘不一致（索引 ${idxNow.files.length} / 磁盘 ${onDisk}）：Obsidian 的索引未跟上外部改动。` +
        '请先在 Obsidian 里执行「Reload app without saving」（重载应用）后重跑本脚本。',
    );
  }

  // 真实 id（带插件前缀）——写死基名会静默失败，见 resolveCommandIds()
  const REAL_IDS = await resolveCommandIds(cdp);
  const realId = (base) => REAL_IDS.find((r) => r.split(':').pop() === base.split(':').pop());

  const problems = [];
  // 启动哨兵阶段（可选）：必须在任何命令之前，否则分不清"是自动处理改的"还是"命令改的"
  const startupCheck = await runStartupCheck(cdp, problems);

  console.log('   · 采集初始快照…');
  const before = await collect(cdp);
  // 与快照同一时刻记录"内容指纹"，供"受保护附件是否真的还在库里"的判定
  const beforeContent = contentIndex(VAULT);
  console.log(`   · 初始文件 ${before.files.length} 个`);

  // 先跑"当前笔记级"命令：它们依赖活动笔记，须先打开宿主笔记
  const NOTE_COMMANDS = [
    'attachment:localize-note',
    'attachment:rename-note',
    'attachment:collect-current-note',
    'attachment:export-note',
  ];
  let step = 0;
  for (const note of ['notes/01-正文图片.md', 'notes/12-断链-多候选.md', 'deep/多级/深层笔记.md', 'externals/图片.md']) {
    await cdp.eval(`(async () => { await window.app.workspace.openLinkText(${JSON.stringify(note)}, '', false); return 1; })()`);
    await sleep(400);
    step++;
    console.log(`→ [${step}] 当前笔记级 4 命令 @${note}`);
    for (const id of NOTE_COMMANDS.map(realId)) {
      try {
        const clicks = await runCommand(cdp, id);
        if (clicks === 0) console.log(`   · ${id} 无弹窗`);
      } catch (e) {
        problems.push(`命令异常：${id} @${note} → ${e.message}`);
      }
    }
  }

  // 轮次循环：连跑整套命令直到**收敛**（再跑一轮文件集合不再变化）。
  //
  // 为什么不是"跑一遍就稳定"：13 条命令按固定顺序连跑时，「收集（把附件搬到笔记归属目录）」
  // 排在「重命名（原地改名）」之前——本轮命名出的文件要等下一轮的收集才进笔记目录；
  // 而真实 Obsidian 的库缓存/索引在插件自身改写后也有轻微滞后。两者叠加使状态需要多轮才稳定。
  // 真正要守的是两件事：① **每轮都不许出现数据损失 / 新断链**（用户可能只跑一条就停手）；
  // ② **有限轮内必须收敛**（若不收敛即为震荡型缺陷）。
  const MAX_PASSES = Number(arg('maxPasses', '6'));
  const unresolvedBefore = countUnresolved(before.files, before.notes);
  if (FIX_CANDIDATES) {
    // 一次性标记放在页面里：CLICK_CONFIRM 是注入的字符串，只能通过 window 传参
    await cdp.eval(`(() => {
      window.__iapFixCandidates = true;
      window.__iapFixCandidatesUsed = false;
      window.__iapFixPicked = null;
      return 1;
    })()`);
    console.log('   · 候选修复已开启：第一处候选将被选中并点「以此修复」，其余仍跳过');
  }
  const states = [];
  const deltas = [];
  let convergedAt = 0;
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    console.log(`\n[obsidian-acceptance] 第 ${pass} 轮：执行全部 ${REAL_IDS.length} 条命令`);
    for (const id of REAL_IDS) {
      step++;
      if (pass === 1) console.log(`→ [${step}] ${id}`);
      try {
        const clicks = await runCommand(cdp, id);
        if (clicks === 0 && pass === 1) console.log('   · 无弹窗（可能无需处理）');
      } catch (e) {
        problems.push(`命令异常：${id}（第 ${pass} 轮）→ ${e.message}`);
      }
    }
    const snap = await collect(cdp);
    // 每轮都过一遍不变式：用户可能只跑一条命令就停手，中间态也不该坏
    problems.push(...checkResults(snap, `第 ${pass} 轮`, before));
    // 受保护附件的内容必须仍在库里（按内容指纹，附件被改名/移动都不算丢失）
    problems.push(...checkContentSurvival(beforeContent, contentIndex(VAULT), `第 ${pass} 轮`));
    states.push(snap);
    if (pass > 1) {
      const prev = states[pass - 2];
      const d = [
        ...snap.files.filter((f) => !prev.files.includes(f)).map((f) => `+${f}`),
        ...prev.files.filter((f) => !snap.files.includes(f)).map((f) => `-${f}`),
      ];
      deltas.push(d);
      console.log(`   · 第 ${pass} 轮变化 ${d.length} 项${d.length === 0 ? '（已收敛）' : ''}`);
      if (d.length === 0) {
        convergedAt = pass;
        break;
      }
    }
  }
  if (!convergedAt) {
    problems.push(`未在 ${MAX_PASSES} 轮内收敛：每轮仍在改名/移动（疑似抖动或循环），最后一轮变化 ${deltas[deltas.length - 1]?.length ?? '?'} 项`);
  } else {
    console.log(`   · 已在第 ${convergedAt} 轮收敛`);
  }

  // 自动化阶段（可选）：必须在命令链收敛之后跑，否则"是命令改的"还是"自动处理改的"分不清
  let automation = null;
  if (RUN_AUTOMATION) {
    console.log('   · 自动化阶段：新建探针笔记，等待后台自动处理…');
    automation = await runAutomationPhase(cdp, problems);
  }

  const after = states[0];
  const last = states[states.length - 1];

  // 候选修复阶段（可选）：断言"选中并修复"真的把引用写回去了
  const candidateFix = { enabled: FIX_CANDIDATES, used: false, picked: null, unresolvedBefore, unresolvedAfter: null };
  if (FIX_CANDIDATES) {
    candidateFix.used = (await cdp.eval('window.__iapFixCandidatesUsed === true')) === true;
    candidateFix.picked = await cdp.eval('window.__iapFixPicked ?? null');
    candidateFix.unresolvedAfter = countUnresolved(last.files, last.notes);
    if (!candidateFix.used) {
      problems.push('[候选修复] 已开启 --fix-candidates，但整轮都没有出现可选择的候选弹窗（前提不成立，或候选窗根本没弹出）');
    } else if (candidateFix.unresolvedAfter >= candidateFix.unresolvedBefore) {
      problems.push(
        `[候选修复] 选中候选并点「以此修复」后，悬空引用数没有减少（${candidateFix.unresolvedBefore} → ${candidateFix.unresolvedAfter}）：修复没有真正写回`,
      );
    } else {
      console.log(
        `   · 候选修复已生效：悬空引用 ${candidateFix.unresolvedBefore} → ${candidateFix.unresolvedAfter}（选中 ${candidateFix.picked}）`,
      );
    }
  }
  // `(1)` 兜底名：只算"本轮新出现的"，夹具里本来就有合法含 (1) 的文件名
  const newOnes = last.files.filter((f) => !before.files.includes(f));
  const bogus = newOnes.filter((f) => /\(\d+\)/.test(f));
  if (bogus.length) problems.push(`幂等：本轮新出现 (N) 兜底名：${bogus.slice(0, 5).join(', ')}`);

  // 输出报告
  const report = {
    vault: VAULT,
    variant: VARIANT,
    startupCheck,
    automation,
    candidateFix,
    passes: states.length,
    convergedAt: convergedAt || null,
    filesBefore: before.files.length,
    filesPerPass: states.map((s) => s.files.length),
    filesBeforeList: before.files,
    filesAfterPass1List: states[0].files,
    filesFinalList: last.files,
    notices: after.notices,
    problems,
  };
  const outDir = path.join(VAULT, '..', 'acceptance-reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `obsidian-acceptance-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(outDir, 'obsidian-acceptance-latest.md'),
    [
      '# 真实 Obsidian 验收报告',
      '',
      `- 验收库：${VAULT}`,
      `- 候选修复：${FIX_CANDIDATES ? (candidateFix.used ? `已选中并修复（悬空引用 ${candidateFix.unresolvedBefore} → ${candidateFix.unresolvedAfter}）` : '未出现候选弹窗') : '未运行（加 --fix-candidates 启用）'}`,
      `- 启动哨兵：${
        STARTUP_CHECK
          ? `已运行（笔记改写 ${startupCheck?.noteChanges ?? '?'} 篇，哨兵附件${startupCheck?.canaryIntact ? '完好' : '异常'}，` +
            `启动期被就绪门挡下 ${startupCheck?.suppressedAtStartup ?? '?'} 个 changed，就绪信号 ${startupCheck?.settleSource ?? '（无）'}）`
          : '未运行（加 --startup-check 启用）'
      }`,
      `- 自动化阶段：${RUN_AUTOMATION ? (automation?.ran ? `已生效（${automation.renamedTo}，${automation.elapsedMs}ms）` : '未生效') : '未运行（加 --automation 启用）'}`,
      `- 配置变体：${VARIANT}${ROOT_LAYOUT ? '（跟随 Obsidian + 库根，即插件的默认模式）' : '（验收库自带：自定义 ./assets）'}`,
      `- 文件数：初始 ${before.files.length} → ${states.map((s) => s.files.length).join(' → ')}（共 ${states.length} 轮）`,
      `- 收敛：${convergedAt ? `第 ${convergedAt} 轮收敛` : '未在限定轮数内收敛'}`,
      `- 问题数：${problems.length}`,
      '',
      '## 问题清单',
      ...(problems.length ? problems.map((p) => `- ${p}`) : ['- （无）']),
      '',
      '## 第一轮新增的文件',
      ...states[0].files.filter((f) => !before.files.includes(f)).map((f) => `- +${f}`),
      '',
      '## 第一轮消失的文件',
      ...before.files.filter((f) => !states[0].files.includes(f)).map((f) => `- -${f}`),
      '',
      '## 逐轮变化（收敛过程；命令顺序固有交互，非缺陷）',
      ...deltas.flatMap((d, i) => [`### 第 ${i + 2} 轮（${d.length} 项）`, ...d.map((f) => `- ${f}`)]),
      '',
      '## 通知摘录',
      ...after.notices.slice(-40).map((n) => `- ${n.replace(/\n/g, ' ')}`),
    ].join('\n'),
  );

  console.log(`\n[obsidian-acceptance] 变体：${VARIANT}`);
  console.log(`[obsidian-acceptance] 完成：文件 ${before.files.length} → ${states.map((s) => s.files.length).join(' → ')}（${convergedAt ? `第 ${convergedAt} 轮收敛` : '未收敛'}），问题 ${problems.length}`);
  for (const p of problems) console.log(` ✗ ${p}`);
  if (problems.length) {
    console.log('\n--- 最终文件树 ---');
    for (const f of after.files) console.log(`  ${f}`);
    console.log('\n--- 通知摘录 ---');
    for (const n of after.notices.slice(-40)) console.log(`  ${String(n).replace(/\n/g, ' ')}`);
  }
  console.log(`[obsidian-acceptance] 报告：${outFile}`);
  server.close();
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => {
  console.error(`[obsidian-acceptance] 失败：${e.message}`);
  process.exit(3);
});
