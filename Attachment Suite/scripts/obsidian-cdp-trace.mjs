/**
 * 真实 Obsidian 逐步追踪（CDP）。
 *
 * 用途：`obsidian-cdp-acceptance.mjs` 只给"一轮结束后的结论"；当结论是"引用悬空/附件丢失"时，
 * 必须知道**是哪一条命令、在哪一步**让状态发生了分叉。本脚本按固定顺序逐条执行命令，
 * 每条之后打印指定笔记的正文与相关附件的位置，从而把"谁没跟上"钉死。
 *
 * 与验收脚本共用同一套宿主启动/连接方式（Obsidian 作为本脚本的子进程，脚本结束时收干净），
 * 并共用同一份**本地 HTTP 服务**（`lib/acceptance-http-server.mjs`）。少了那份服务，每一轮
 * 外链用例都会以 `ERR_CONNECTION_REFUSED` 失败，控制台里全是**工具自己造的假失败**——
 *
 * 同时采集**宿主控制台**（CDP 的 `Runtime.consoleAPICalled` / `Runtime.exceptionThrown` /
 * `Log.entryAdded`，外加 `.notice` 元素的 DOM 观察器——插件的失败提示走 Notice 而非 console）。
 * 磁盘状态只告诉你"结果坏了"，控制台才告诉你"哪一步抛了异常 / 哪条日志没出现"。
 *
 * 用法：
 *   node scripts/obsidian-cdp-trace.mjs --vault "D:\...\for-test\acceptance" [--passes 2]
 *   # 只看控制台（不看磁盘状态）：--console-only
 *   # 只看关注的日志：--filter "IAP|失败|EXCEPTION|NOTICE"
 *   # 先经命令打开诊断日志（更详细的过程输出：索引重建 + 各命令的计划明细）：--debug
 *   # 放大每条命令后的等待，用于判别"节奏问题"还是"逻辑问题"：--step-delay 2500
 *   # 只跑当前笔记级命令，压掉无关变量做最小复现：--note-only
 *
 * 已知局限：脚本只等固定时长（默认 500ms，可用 `--step-delay` 调）就切窗口，故某条命令末尾
 * 打出的日志可能落到**下一步**的窗口里（"失败 N 项"的 NOTICE 与 `[IAP] 失败：…` 常错开一步）。
 * 跨步骤定位时以日志内容为准，不要以它落在哪一步为准；完整时间线落在
 * `for-test/acceptance-reports/obsidian-console-<时间戳>.log`。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { startAcceptanceHttpServer } from './lib/acceptance-http-server.mjs';

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
const WATCH_NOTES = String(arg('notes', 'notes/02-wiki嵌入.md,notes/14-短名无扩展名.md')).split(',').map((s) => s.trim()).filter(Boolean);
/** 按**内容**关注的原始附件（文件名会被改名，只有内容稳定，故不能按名字追）。 */
const WATCH_FILES = String(arg('watch', 'assets/jpg/pic.jpg,assets/mp3/song.mp3')).split(',').map((s) => s.trim()).filter(Boolean);
/** 当前笔记级命令的宿主笔记（与验收脚本一致：每轮轮换，这是缺陷出现的关键条件之一）。 */
const HOST_NOTES = ['notes/01-正文图片.md', 'notes/12-断链-多候选.md', 'deep/多级/深层笔记.md', 'externals/图片.md'];
const NOTE_COMMANDS = [
  'attachment:localize-note',
  'attachment:rename-note',
  'attachment:collect-current-note',
  'attachment:export-note',
];
const PASSES = Number(arg('passes', '2'));
/** 只看控制台输出（跳过每步的磁盘状态；文件状态已由验收脚本与 grep 覆盖）。 */
const CONSOLE_ONLY = process.argv.includes('--console-only');
/** 控制台输出的过滤正则（如 `--filter "IAP|失败|EXCEPTION|Notice"`）；缺省全部打印。 */
const CONSOLE_FILTER = arg('filter', '') ? new RegExp(arg('filter', ''), 'i') : null;
/** 开始时先经命令打开诊断日志（插件内的「切换诊断日志（排查用）」），拿到更详细的过程输出。 */
const DEBUG_LOG = process.argv.includes('--debug');
/**
 * 每条命令之后的等待时长。
 *
 * ⚠️ 必须知道的事实：**命令的 `run()` 在打开确认弹窗后就返回了**，真正的移动/改名发生在弹窗回调里，
 * 也就是脚本点完"确认"之后仍在后台跑。因此过短的等待会让下一步在"上一步还没做完"时开始，
 * 从而制造出计划与磁盘不符（真实表现就是 `ENOENT: no such file or directory, rename`）。
 * 排查"到底是竞态还是逻辑错"时，用 `--step-delay 2500` 把节奏放慢即可判别。
 */
const STEP_DELAY = Number(arg('stepDelay', '500'));
/** 只跑"当前笔记级"命令并跳过全库命令：做最小复现时用（把变量压到最少）。 */
const NOTE_ONLY = process.argv.includes('--note-only');
/** 只跑"当前笔记级"命令并跳过全库命令：做最小复现时用（把变量压到最少）。 */
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ 库状态（直接读磁盘，不经宿主） ------------------------------ */

function listAll(root, { includeDot = false } = {}) {
  const out = [];
  if (!fs.existsSync(root)) return out; // 目录还不存在（如尚未产生回收站）
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!includeDot && e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else out.push(r);
    }
  };
  walk(root, '');
  return out.sort();
}

function noteText(rel) {
  try {
    return fs.readFileSync(path.join(VAULT, rel), 'utf8').trim().replace(/\n+/g, ' ⏎ ');
  } catch {
    return '(不存在)';
  }
}

function fingerprintOf(rel) {
  try {
    return fs.readFileSync(path.join(VAULT, rel)).toString('base64');
  } catch {
    return null;
  }
}

/** 在整库（含 .trash）里找"这份内容现在在哪"。 */
function locate(fp) {
  if (!fp) return ['(初始就不存在)'];
  const found = [];
  const walk = (dir, rel) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs, r);
      else if (fs.readFileSync(abs).toString('base64') === fp) found.push(r);
    }
  };
  walk(VAULT, '');
  return found.length ? found : ['⚠ 内容已不在库中（可能被删或被改写）'];
}

function reportState(step, watchFp) {
  console.log(`\n─── ${step} ───`);
  for (const n of WATCH_NOTES) {
    const text = noteText(n);
    console.log(`   ${n}\n      ${text}`);
    const refs = [];
    for (const m of text.matchAll(/!?\[\[([^\]#|]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) refs.push(m[1]);
    for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)]+))\)/g)) refs.push(m[1] ?? m[2]);
    for (const t of refs) {
      if (/^(https?:|data:)/i.test(t)) continue;
      const norm = decodeURIComponent(t).replace(/^\.\//, '');
      const base = norm.slice(norm.lastIndexOf('/') + 1);
      const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
      const live = listAll(VAULT);
      const ok = live.includes(norm) || live.some((f) => {
        const b = f.slice(f.lastIndexOf('/') + 1);
        const i = b.lastIndexOf('.');
        return b === base || (i > 0 ? b.slice(0, i) : b) === stem;
      });
      if (!ok) console.log(`      ✗ 悬空引用：${t}`);
    }
  }
  for (const w of WATCH_FILES) {
    console.log(`   [内容追踪] ${w} → ${locate(watchFp.get(w)).join(' , ')}`);
  }
  console.log(`   文件总数：${listAll(VAULT).length}`);
}

/* --------------------------------- CDP --------------------------------- */

async function fetchJson(url, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await (await fetch(url, { signal: ctrl.signal })).json();
  } finally {
    clearTimeout(timer);
  }
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    /** 事件订阅表：CDP 的 `Runtime.consoleAPICalled` 之类通知没有 id，走这里分发。 */
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
        }
        return;
      }
      if (msg.method) {
        for (const fn of this.handlers.get(msg.method) ?? []) {
          // 捕获回调自身的异常：日志采集出错绝不能带崩驱动流程
          try {
            fn(msg.params);
          } catch {
            /* ignore */
          }
        }
      }
    });
    ws.addEventListener('close', () => this.failAll('CDP 已关闭'));
    ws.addEventListener('error', () => this.failAll('CDP 错误'));
  }
  on(method, fn) {
    const list = this.handlers.get(method) ?? [];
    list.push(fn);
    this.handlers.set(method, list);
  }
  failAll(m) {
    for (const [, p] of this.pending) p.reject(new Error(m));
    this.pending.clear();
  }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('CDP 连接失败')), { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}, timeoutMs = 120000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr, timeoutMs = 120000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: timeoutMs });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  }
}

/* --------------------------- 宿主控制台日志采集 --------------------------- */

/**
 * 采集真实宿主的控制台输出。**这是定位"为什么会分叉"的主要证据来源**：
 * 磁盘状态只告诉你"结果坏了"，控制台才告诉你"哪一步抛了异常 / 哪条日志没出现"。
 *
 * 三条通道，缺一不可：
 * 1. `Runtime.consoleAPICalled` —— 插件 `logger.*` 的实际落点（`[IAP]` 前缀），
 *    以及 Obsidian 本体与第三方代码的 console 输出。
 * 2. `Runtime.exceptionThrown` —— 未捕获异常与未处理的 Promise reject（异步链路最容易静默失败的地方）。
 * 3. `Log.entryAdded` —— 浏览器级错误（资源加载失败、脚本语法错误等，不会走 console）。
 *
 * 还有一条 CDP 看不到的：**插件对用户的失败提示走 Notice 而不是 console**
 * （见 `src/notify.ts`：`toast.error` 在静默档也必须送达）。故额外用 DOM 观察器抓 `.notice` 文本，
 * 否则"命令报错了"这件事在控制台里完全不可见。
 */

/** 时间线：脚本自己打的标记与宿主输出共用一个数组，才能按步骤切片。 */
const TIMELINE = [];
let consoleLines = 0;

function note(kind, text) {
  TIMELINE.push({ kind, text: String(text) });
  if (kind !== 'MARK') consoleLines++;
}

function fmtArg(a) {
  if (!a) return '';
  if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
  if (a.unserializableValue !== undefined) return String(a.unserializableValue);
  if (a.description) return a.description;
  if (a.preview) {
    const props = (a.preview.properties ?? []).map((p) => `${p.name}: ${p.value}`).join(', ');
    return `${a.preview.description ?? a.preview.subtype ?? 'Object'}${props ? ` { ${props} }` : ''}`;
  }
  return String(a.type ?? '?');
}

/** 订阅三条通道并注入 Notice 观察器。 */
async function attachConsole(cdp) {
  await cdp.send('Log.enable');
  cdp.on('Runtime.consoleAPICalled', (p) => {
    note(`console.${p.type ?? 'log'}`, (p.args ?? []).map(fmtArg).join(' '));
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails ?? {};
    const where = d.url ? ` @${d.url}:${(d.lineNumber ?? 0) + 1}` : '';
    note('EXCEPTION', `${d.exception?.description ?? d.text ?? '(无描述)'}${where}`);
  });
  cdp.on('Log.entryAdded', (p) => {
    const e = p.entry ?? {};
    if (e.level === 'verbose') return; // 噪音
    note(`log.${e.level}`, `${e.text}${e.url ? ` @${e.url}:${(e.lineNumber ?? 0) + 1}` : ''}`);
  });
  // Notice 不在 console 里：Obsidian 把提示渲染成 .notice 元素，直接观察 DOM。
  await cdp.eval(`(() => {
    if (window.__iapNoticeObs) return 1;
    window.__iapNoticeObs = 1;
    const rec = (t) => window.__iapNotice.push(String(t).trim());
    window.__iapNotice = [];
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('notice')) rec(n.textContent ?? '');
      }
    }).observe(document.body, { childList: true, subtree: true });
    return 1;
  })()`);
}

/** 取回 DOM 观察器抓到的 Notice（CDP 拿不到的那部分）。 */
async function drainNotices(cdp) {
  if (!cdp) return;
  const got = await cdp.eval(`(() => window.__iapNotice ? window.__iapNotice.splice(0) : [])()`).catch(() => []);
  for (const t of got ?? []) note('NOTICE', t);
}

/** 打印自上个标记以来的宿主输出（带筛选项）。 */
function dumpConsole(since, { filter = null, indent = '     | ' } = {}) {
  const lines = TIMELINE.slice(since).filter((e) => e.kind !== 'MARK');
  const kept = filter ? lines.filter((e) => filter.test(`${e.kind} ${e.text}`)) : lines;
  if (!kept.length) {
    console.log(`${indent}(宿主控制台无输出)`);
    return;
  }
  for (const e of kept) console.log(`${indent}[${e.kind}] ${e.text.replace(/\n/g, ' ⏎ ').slice(0, 400)}`);
}

const CLICK_CONFIRM = `(() => {
  const modal = document.querySelector('.modal-container');
  if (!modal) return null;
  const btns = Array.from(modal.querySelectorAll('button'));
  const find = (re) => btns.find((b) => re.test((b.textContent ?? '').trim()));
  const native = find(/^总是更新$/) ?? find(/^仅此一次$/);
  if (native) { native.click(); return native.textContent.trim() + '(原生)'; }
  if (modal.querySelector('.iap-candidate-item')) {
    const skip = find(/^跳过$/) ?? find(/全部跳过/);
    if (skip) { skip.click(); return '跳过(候选)'; }
  }
  const cta = find(/确认|以此修复|继续|应用|确定/);
  if (cta) { cta.click(); return cta.textContent.trim(); }
  const close = find(/^关闭$/);
  if (close) { close.click(); return '关闭(报告)'; }
  return null;
})()`;

async function runCommand(cdp, id) {
  for (let i = 0; i < 20; i++) {
    const open = await cdp.eval(`document.querySelectorAll('.modal-container').length`);
    if (open === 0) break;
    const clicked = await cdp.eval(CLICK_CONFIRM);
    if (!clicked) {
      await cdp.eval(`(document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),1)`);
    }
    await sleep(200);
  }
  await cdp.eval(`window.app.commands.executeCommandById(${JSON.stringify(id)}), 1`);
  const clicks = [];
  for (let i = 0; i < 40; i++) {
    await sleep(350);
    const open = await cdp.eval(`document.querySelectorAll('.modal-container').length`);
    if (open === 0) break;
    const clicked = await cdp.eval(CLICK_CONFIRM);
    if (clicked) clicks.push(clicked);
    else break;
  }
  return clicks;
}

function killObsidian(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
}

/** 执行一条命令，并打印"该步之后的磁盘状态 + 该步期间的宿主控制台输出"。 */
async function stepRun(cdp, bySuffix, base, label, watchFp) {
  const since = TIMELINE.length;
  note('MARK', `${label} ${base}`);
  const clicks = await runCommand(cdp, bySuffix.get(base.split(':').pop()));
  await sleep(STEP_DELAY);
  await drainNotices(cdp); // Notice 不在 console 里，必须单独取回
  const clickNote = clicks.length ? `（点击：${clicks.join(' / ')}）` : '';
  if (CONSOLE_ONLY) {
    console.log(`\n─── ${label} ${base}${clickNote} ───`);
  } else {
    reportState(`${label} ${base}${clickNote}`, watchFp);
  }
  console.log('   宿主控制台：');
  dumpConsole(since, { filter: CONSOLE_FILTER });
  return clicks;
}

async function main() {
  if (!fs.existsSync(OBSIDIAN)) throw new Error(`未找到 Obsidian：${OBSIDIAN}`);
  console.log(`[trace] 验收库：${VAULT}`);
  console.log(`[trace] 关注笔记：${WATCH_NOTES.join(' , ')}`);
  const watchFp = new Map(WATCH_FILES.map((rel) => [rel, fingerprintOf(rel)]));
  if (!CONSOLE_ONLY) reportState('初始状态', watchFp);

  // 外链用例的被测目标：与验收脚本共用同一实现（见 lib/acceptance-http-server.mjs）。
  // 端口被占时只告警、不中断——本轮会看到外链下载失败，那是环境问题而非插件缺陷。
  let httpServer = null;
  try {
    httpServer = await startAcceptanceHttpServer(HTTP_PORT);
    console.log(`[trace] 本地服务已启动 http://127.0.0.1:${HTTP_PORT}（外链用例的目标）`);
  } catch (e) {
    console.log(
      `[trace] 警告：本地服务未启动（${e?.code ?? e?.message}）——`
        + '本轮外链下载会失败，属环境问题（端口被占），不是插件缺陷。',
    );
  }

  const child = spawn(OBSIDIAN, [VAULT, `--remote-debugging-port=${CDP_PORT}`], { stdio: 'ignore' });
  const cleanup = () => {
    try {
      httpServer?.close();
    } catch {
      /* ignore */
    }
    killObsidian(child);
  };
  process.on('exit', cleanup);

  // 等 CDP 起来并连上验收库页面
  let cdp = null;
  const until = Date.now() + 90000;
  while (Date.now() < until && !cdp) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
      for (const t of list ?? []) {
        if (t.type !== 'page' || !t.webSocketDebuggerUrl) continue;
        try {
          const c = await Cdp.connect(t.webSocketDebuggerUrl);
          await c.send('Runtime.enable');
          const base = await c.eval(
            `(() => { const a = window.app?.vault?.adapter; return (a && (a.basePath || (a.getBasePath && a.getBasePath()) || '')) || ''; })()`,
            15000,
          );
          const norm = (p) => path.resolve(String(p || '')).replace(/\\/g, '/').toLowerCase();
          if (base && norm(base) === norm(VAULT)) {
            cdp = c;
            break;
          }
          c.ws.close();
        } catch {
          /* 页面还没就绪 */
        }
      }
    } catch {
      /* 端口还没开 */
    }
    if (!cdp) await sleep(1000);
  }
  if (!cdp) {
    console.log('[trace] 无法连接 CDP —— Obsidian 可能未成功启动（见验收脚本说明：需人工启动）。');
    killObsidian(child);
    process.exit(2);
  }
  console.log('[trace] 已连接；启用插件…');
  await attachConsole(cdp); // 越早订阅越好：插件启用期的日志也要收
  await cdp.eval(`(async () => { window.app.plugins.setEnable(true); return 1; })()`);
  await sleep(1500);
  await cdp.eval(`(async () => { if (!window.app.plugins.plugins['${PLUGIN_ID}']) await window.app.plugins.enablePlugin('${PLUGIN_ID}'); return 1; })()`);
  await sleep(1500);
  const ok = await cdp.eval(`!!window.app.plugins.plugins['${PLUGIN_ID}']`);
  if (!ok) throw new Error('插件未加载');

  const all = await cdp.eval(`Object.keys(window.app.commands.commands)`);
  const bySuffix = new Map(all.map((id) => [String(id).split(':').pop(), id]));

  // `--debug`：经**用户那条路径**（命令）打开诊断日志，而不是绕过它去改内部状态。
  // 这样"排查模式下可达"这件事本身也一并被验证了——命令没注册、或打开后不生效，这里立刻看得出来。
  //
  // ⚠️ 但这条命令是**切换**（toggle），而「详细诊断日志」是**持久**设置（`setDebugLogging` 会落盘、
  // 重启后仍在）。于是**连续跑第二次时它会把它关掉**——第二次的整份控制台日志会静默失去所有
  // `[console.debug]`，而脚本仍打印"已开启"，排查者据此会以为"插件没输出"。所以执行后必须
  // **回读实际生效值**，不是 ON 就再切一次，仍不 ON 就直接报错。
  if (DEBUG_LOG) {
    const id = bySuffix.get('toggle-debug-logging');
    if (!id) throw new Error('诊断日志命令未注册（命令面板里搜「诊断日志」应有）');
    const readOn = () =>
      cdp.eval(`!!(window.app.plugins.plugins['${PLUGIN_ID}']?.settings?.debugLogging)`);
    const toggle = async () => {
      await cdp.eval(`window.app.commands.executeCommandById(${JSON.stringify(id)}), 1`);
      await sleep(600);
    };
    await toggle();
    if (!(await readOn())) await toggle(); // 上一轮已开着 → 这次反而关掉了，再切回来
    if (!(await readOn())) throw new Error('诊断日志开关未能打开（命令执行了，但设置 debugLogging 仍不为 true）');
    const level = await cdp.eval(`(() => {
      return window.__iapNotice ? window.__iapNotice.slice(-2).join(' | ') : '';
    })()`);
    console.log(`[trace] 诊断日志已开启（回读 settings.debugLogging = true；宿主提示：${level || '(未捕获到通知)'}）`);
  }

  let step = 0;
  for (let pass = 1; pass <= PASSES; pass++) {
    for (const host of HOST_NOTES) {
      await cdp.eval(`(async () => { await window.app.workspace.openLinkText(${JSON.stringify(host)}, '', false); return 1; })()`);
      await sleep(400);
      for (const base of NOTE_COMMANDS) {
        step++;
        await stepRun(cdp, bySuffix, base, `[${step}] 第${pass}轮 当前笔记级 @${host}`, watchFp);
      }
    }
    if (NOTE_ONLY) continue;
    for (const base of COMMANDS) {
      step++;
      await stepRun(cdp, bySuffix, base, `[${step}] 第${pass}轮 全库`, watchFp);
    }
  }

  // 全量时间线落盘：控制台噪音多，留在文件里便于事后 grep（尤其是跨步骤的相关性）
  const outDir = path.join(VAULT, '..', 'acceptance-reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `obsidian-console-${stamp()}.log`);
  fs.writeFileSync(
    outFile,
    TIMELINE.map((e) => (e.kind === 'MARK' ? `\n===== ${e.text} =====` : `[${e.kind}] ${e.text}`)).join('\n'),
    'utf8',
  );
  console.log(`\n[trace] 完成；宿主控制台共 ${consoleLines} 行，已写入 ${outFile}`);
  cleanup();
  process.exit(0);
}

main().catch((e) => {
  console.error(`[trace] 失败：${e.message}`);
  process.exit(3);
});
