/**
 * 三阶段B：验收库全量验收（harness 版，可进 CI）。
 *
 * 把 `acceptance-fixture.ts` 的用例库生成到**临时库**（绝不动 for-test 原件），
 * 依次执行全部 13 条命令（含确认弹窗），按预期清单断言；最后整轮再跑一遍验幂等。
 *
 * 与真实 Obsidian 验收（`scripts/obsidian-cdp-acceptance.mjs`）的分工：
 * 本文件覆盖"逻辑正确性"；真实 Obsidian 覆盖"真实 metadataCache / 插件宿主语义"。
 */

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { buildTestApp } from './infrastructure';
import type { TestAppHandle, ObsidianModule } from './infrastructure';
import {
  ACCEPTANCE_ASSERTS,
  ACCEPTANCE_CASES,
  ACCEPTANCE_SETTINGS,
  assertKeysAreValid,
  seedAcceptanceVault,
  type AcceptanceContext,
} from './acceptance-fixture';
import '../mocks/obsidian-stub';

const ALL_COMMANDS = [
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

let VAULT_ROOT = '';
let server: http.Server;
let base = '';

beforeAll(async () => {
  (globalThis as any).window = globalThis;
  VAULT_ROOT = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'iap-acceptance-'));
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  server = http.createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0];
    if (url === '/404.png') return void res.writeHead(404).end('nf');
    if (url === '/redirect.png') return void res.writeHead(302, { Location: '/img.png' }).end('');
    if (url.endsWith('.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return void res.end('<!DOCTYPE html><html><body>x</body></html>');
    }
    // E17：SVG 必须按**内容**被识别出来，故服务端要真的返回 svg 文本（否则会被当 png 落盘，
    // 用例就会以"插件没拒绝 svg"的假象失败）。
    if (url.endsWith('.svg')) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return void res.end('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
    }
    // E18：非受管类型（纯文本）→ 内容识别为 txt，落盘前的白名单闭合校验应把它挡下
    if (url.endsWith('.txt')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return void res.end('just plain text, not a managed attachment');
    }
    if (url.endsWith('.mp3')) return void res.writeHead(200).end(Buffer.from('ID3\x03\x00\x00\x00\0\0\0\0', 'binary'));
    if (url.endsWith('.mp4')) return void res.writeHead(200).end(Buffer.from('\0\0\0\x18ftypmp42\0\0\0\0', 'binary'));
    if (url.endsWith('.pdf')) return void res.writeHead(200).end(Buffer.from('%PDF-1.4\n', 'ascii'));
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.concat([PNG, Buffer.from(url, 'utf8')]));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => {
  if (server) server.close();
  nodeFs.rmSync(VAULT_ROOT, { recursive: true, force: true });
});

let obsidian: ObsidianModule;
let handle: TestAppHandle;
let plugin: any;

async function buildPlugin(): Promise<void> {
  obsidian._registry.notices = [];
  obsidian._registry.ctaClickCallbacks = [];
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
  plugin.settings = JSON.parse(JSON.stringify(ACCEPTANCE_SETTINGS));
}

const abs = (rel: string): string => nodePath.join(VAULT_ROOT, rel);
const exists = (rel: string): boolean => nodeFs.existsSync(abs(rel));
const read = (rel: string): string => nodeFs.readFileSync(abs(rel), 'utf8');
const list = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of nodeFs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(nodePath.join(dir, e.name), r);
      else out.push(r);
    }
  };
  walk(VAULT_ROOT, '');
  return out.filter((f) => !f.startsWith('.obsidian') && !f.startsWith('.trash')).sort();
};

/**
 * 确认助手：只确认**本命令自己开出**的弹窗。
 *
 * 早期实现取"最后一个弹窗/按钮"，而弹窗数组跨命令残留——于是当某条命令无事可做、
 * 没开任何弹窗时，它会去执行**上一条命令**遗留的 `onConfirm`：同一批破坏性操作被额外执行一遍，
 * 且断言结果无法归因（这也是"需要好几轮才收敛"的部分成因）。
 * 现在用命令开始时的水位把范围切出来；`skipped` 会明确告诉调用方"本命令没开确认窗"。
 */
let modalMark = 0;
let ctaMark = 0;

interface ConfirmOutcome {
  /** 本命令新开的弹窗数（含无 onConfirm 的报告类弹窗）。 */
  opened: number;
  /** 是否实际执行了一个确认动作（onConfirm 或确认按钮）。 */
  confirmed: boolean;
}

function cmd(id: string): () => Promise<unknown> {
  const found = handle.getCommands().find((c: any) => c.id === id);
  if (!found) throw new Error(`命令未注册: ${id}`);
  return async () => {
    modalMark = handle.app._modals.length;
    ctaMark = obsidian._registry.ctaButtons.length;
    return found.callback();
  };
}

/** 确认本命令开出的弹窗；无事可做时 `confirmed === false`（正常，不是错误）。 */
async function confirmModal(): Promise<ConfirmOutcome> {
  const fresh = handle.app._modals.slice(modalMark);
  const ctaFresh = obsidian._registry.ctaButtons.slice(ctaMark);
  const opts = fresh[fresh.length - 1]?.opts;
  if (opts && typeof opts.onConfirm === 'function') {
    await opts.onConfirm();
    return { opened: fresh.length, confirmed: true };
  }
  if (ctaFresh.length) {
    await ctaFresh[ctaFresh.length - 1].onClick();
    return { opened: fresh.length, confirmed: true };
  }
  return { opened: fresh.length, confirmed: false };
}

/** 第一遍必须弹出确认窗的命令（验收库必然有活干）。见下方断言。 */
const CONFIRM_REQUIRED_PASS1 = new Set([
  'attachment:bulk-rename',
  'attachment:bulk-collect',
  'attachment:bulk-localize',
  'attachment:cleanup-unused',
  'attachment:cleanup-empty-folders',
  'attachment:fix-broken-links',
]);

/** 打开若干笔记做"当前笔记级"命令的宿主。 */
async function runAllCommands(record?: Map<string, ConfirmOutcome>): Promise<void> {
  const noteCmds = [
    'attachment:localize-note',
    'attachment:rename-note',
    'attachment:collect-current-note',
    'attachment:export-note',
  ];
  for (const note of ['notes/01-正文图片.md', 'notes/12-断链-多候选.md', 'deep/多级/深层笔记.md', 'externals/图片.md']) {
    handle.open(note);
    for (const id of noteCmds) {
      await cmd(id)();
      const out = await confirmModal();
      if (record && out.confirmed) record.set(id, out);
    }
  }
  for (const id of ALL_COMMANDS) {
    await cmd(id)();
    const out = await confirmModal();
    if (record && out.confirmed) record.set(id, out);
  }
}


/** 引用的语法形态：决定 Obsidian 会怎么解析它。 */
type RefKind = 'md' | 'wiki' | 'html' | 'canvas';
interface LocalRef {
  target: string;
  kind: RefKind;
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * 从笔记/画布文本里提取本地引用（跳过外部 URL / data / 锚点 / 邮件），并保留**语法形态**。
 *
 * 为什么要分形态：wiki 链接与 markdown 链接的解析规则不同（见 `resolvable`），
 * 混在一起会让"无新断链"这个核心不变式要么过宽、要么误报。
 *
 * 为什么必须包含 canvas 的 `file` 字段：插件的**索引层**把 canvas 引用算作"在用"
 * （`core/attachment-index` 的 `canvasFileRefs`），但它的**改写层**一度漏掉 canvas，
 * 于是"收集搬走 → 命名改名 → 清理删除"能把 canvas 引用的附件整条吃掉，
 * 而这套不变式因为只扫 `.md` 而完全看不见——真缺陷就这么被放过了。
 */
function localRefs(text: string): LocalRef[] {
  const out: LocalRef[] = [];
  const push = (raw: string | undefined, kind: RefKind): void => {
    if (!raw) return;
    const t = raw.split('#')[0].trim();
    if (!t || /^(https?:|data:|mailto:|#)/i.test(t)) return;
    out.push({ target: decodeSafe(t.replace(/^<|>$/g, '')), kind });
  };
  // 目标允许含空格：Obsidian 对含空格的 md 链接会用 <> 包裹，故两种写法都收。
  // wiki 侧必须**剥掉 `#锚点` 与 `|别名`**：否则 `[[assets/a.pdf|说明文档]]` 会被当成一个
  // 名字里带 `|` 的路径，解析必然失败（本地化改写普通链接时产出的正是这种形态）。
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
  // canvas 的文件节点（path 式解析）
  for (const m of text.matchAll(/"file"\s*:\s*"([^"]*)"/g)) push(m[1], 'canvas');
  return out;
}

const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
/** 去掉最后一个扩展名后的主名（`assets/mp3/song.mp3` → `song`）。 */
const stemOf = (p: string): string => {
  const b = basename(p);
  const dot = b.lastIndexOf('.');
  return dot > 0 ? b.slice(0, dot) : b;
};

/**
 * 引用在当前文件树里能否解析。
 *
 * 规则按语法区分（这是本文件最重要的一处收紧）：
 * - **路径式**引用（含 `/`）：wiki 链接在 Obsidian 里**忽略路径、按文件名解析**，故仍允许按名命中；
 *   而 markdown 链接与 HTML 属性是**路径式**的 → 必须精确路径命中。
 * - **纯 basename** 引用：三种写法 Obsidian 都按文件名解析。
 * - **wiki 且无扩展名**（`![[song]]`）：Obsidian 按**主名**解析（命中 `song.mp3`），
 *   故再放一层 stem 匹配——这正对应插件索引里"无扩展名短名按 stem 反查受管附件"的三态判定。
 *   注意只对 wiki 开这一层：markdown 的 `![](foo)` 不该顺带指向 `foo.png`。
 *
 * 早期实现一律按 basename 兜底，于是"引用被改到另一个同名文件"也算可解析——
 * 那正是最需要被这条不变式抓住的数据级错误指向。
 */
function resolvable(ref: LocalRef, files: string[]): boolean {
  const norm = ref.target.replace(/^\.\//, '');
  if (files.includes(norm)) return true;
  const base = basename(norm);
  const byStem = (): boolean => ref.kind === 'wiki' && !base.includes('.') && files.some((f) => stemOf(f) === base);
  if (norm.includes('/')) {
    if (ref.kind === 'wiki') return files.some((f) => basename(f) === base) || byStem();
    return false;
  }
  return files.some((f) => basename(f) === base) || byStem();
}

/** 笔记中「可解析引用」的数量（用于验证改写没有制造新断链）。 */
function resolvableCount(text: string, files: string[]): number {
  return localRefs(text).filter((r) => resolvable(r, files)).length;
}

/** 文件字节指纹（base64）。用于"内容仍在"判定——附件可能被改名，故不能按名字判断。 */
function fingerprint(rel: string): string {
  return nodeFs.readFileSync(abs(rel)).toString('base64');
}

/** 构造机器校验上下文。 */
function makeContext(
  before: string[],
  beforeTexts: Map<string, string>,
  beforeFingerprints: Map<string, string>,
  files: string[],
): AcceptanceContext {
  const fpOf = (rel: string): string | null => {
    try {
      return fingerprint(rel);
    } catch {
      return null;
    }
  };
  const canResolve = (target: string, kind: string): boolean =>
    resolvable({ target, kind: kind as RefKind }, files);
  const refsOf = (rel: string): Array<{ target: string; kind: string }> => {
    try {
      return localRefs(read(rel));
    } catch {
      return [];
    }
  };
  // 执行前指纹全集：查找"某个内容是否仍在库里"时避免每次重读整库
  const beforeFpSet = new Set(beforeFingerprints.values());
  return {
    before,
    beforeText: (rel) => beforeTexts.get(rel) ?? '',
    files,
    read,
    exists: (rel) => nodeFs.existsSync(abs(rel)),
    fingerprint: fpOf,
    fingerprintBefore: (rel) => beforeFingerprints.get(rel) ?? null,
    hasContent: (fp) => {
      if (fp && beforeFpSet.has(fp)) return true; // 指纹未变，内容必然还在
      return files.some((f) => {
        try {
          return fingerprint(f) === fp;
        } catch {
          return false;
        }
      });
    },
    refs: refsOf,
    canResolve,
    unresolved: (rel) => refsOf(rel).filter((r) => !canResolve(r.target, r.kind)),
  };
}

describe('三阶段：验收库全量（13 命令 × 2 遍）', () => {
  it(`用例库（${ACCEPTANCE_CASES.length} 条）全量执行后无数据损失、无未本地化外链、幂等`, async () => {
    // 前置：禁用自动化（验收库默认关闭），避免与手动命令竞争
    obsidian = (globalThis as any).__OBSIDIAN_TEST;
    seedAcceptanceVault(VAULT_ROOT, base);
    await buildPlugin();

    // ---- 第一遍 ----
    const beforeFiles = list();
    const beforeTexts = new Map<string, string>();
    // **必须包含 .canvas**：canvas 的 file 字段也是引用，且正是"被漏掉的那一侧"（见 localRefs 注释）
    for (const p of beforeFiles.filter((f) => f.endsWith('.md') || f.endsWith('.canvas'))) beforeTexts.set(p, read(p));
    // 破坏性附件的"执行前指纹"：附件会被改名/移动，所以"没被删"只能按内容判断
    const beforeFingerprints = new Map<string, string>();
    for (const f of beforeFiles) {
      try {
        beforeFingerprints.set(f, fingerprint(f));
      } catch {
        /* 读不到就跳过（目录等） */
      }
    }
    const confirmOutcomes = new Map<string, ConfirmOutcome>();
    await runAllCommands(confirmOutcomes);

    const files = list();
    const problems: string[] = [];

    // 0) 该弹确认的必须真的弹出确认窗：否则"命令没跑起来"会被后续断言误判成"没造成损失"
    for (const id of CONFIRM_REQUIRED_PASS1) {
      if (!confirmOutcomes.get(id)?.confirmed) {
        problems.push(`命令「${id}」在第一遍没有弹出确认窗（命令可能未真正执行，后续断言将失去意义）`);
      }
    }
    // 1) 非受管文件必须原封不动（既不被改名也不被删除）：插件不应管理这些类型
    for (const p of ['assets/noext', 'assets/other/note.txt', 'orphans/zip-orphan.zip', 'orphans/csv-orphan.csv']) {
      if (!files.includes(p)) problems.push(`非受管文件被移除或改名：${p}`);
    }
    // 2) 排除目录整块不动（文件与空目录都不许动）
    const exclBefore = beforeFiles.filter((f) => f.startsWith('excluded/'));
    const exclAfter = files.filter((f) => f.startsWith('excluded/'));
    if (JSON.stringify(exclBefore.sort()) !== JSON.stringify(exclAfter.sort())) {
      problems.push(`排除目录内容被改动：${exclBefore.length} → ${exclAfter.length}`);
    }
    for (const d of ['excluded/empty-in-excluded']) {
      if (!nodeFs.existsSync(abs(d))) problems.push(`排除目录内的空目录被清理：${d}`);
    }
    // 3) 核心不变式：没有制造新断链（每篇笔记"可解析引用数"不得减少）
    //    笔记本身也绝不允许被改名/删除——13 条命令没有一条会改名笔记（已核实），
    //    所以"笔记消失了"必须报错，而不是静默跳过（早期写法是 `continue`，等于放行）。
    for (const [p, beforeText] of beforeTexts) {
      if (!files.includes(p)) {
        problems.push(`笔记被改名或删除：${p}`);
        continue;
      }
      const b = resolvableCount(beforeText, beforeFiles);
      const a = resolvableCount(read(p), files);
      if (a < b) {
        const nowRefs = localRefs(read(p)).map((r) => `${r.kind}:${r.target}`).join(' | ');
        problems.push(`${p} 出现新断链：可解析引用 ${b} → ${a}；现有引用=[${nowRefs}]`);
      }
    }
    // 4) 逐条用例的机器校验。
    //    注意：这些断言**必须真的跑**。早期这些用例的 `expect` 只是字符串，唯一的消费点是
    //    用例标题里的 `.length`——"N 条用例"这个数字看起来很有覆盖感，实际一条断言都没执行。
    //    所以这里还要把"未机器校验的条数"打印出来，让它无法被当成已覆盖。
    const badKeys = assertKeysAreValid();
    for (const k of badKeys) problems.push(`校验表里的用例 id 不存在（拼错就会静默永不执行）：${k}`);
    const ctx = makeContext(beforeFiles, beforeTexts, beforeFingerprints, files);
    let checked = 0;
    for (const c of ACCEPTANCE_CASES) {
      const fn = ACCEPTANCE_ASSERTS[c.id];
      if (!fn) continue;
      checked++;
      const why = fn(ctx);
      if (why) problems.push(`[${c.id}] ${why}`);
    }
    console.log(`[acceptance] 机器校验 ${checked} / ${ACCEPTANCE_CASES.length}（未校验 ${ACCEPTANCE_CASES.length - checked}）`);
    // 5) 受管附件总数不得低于"运行后被引用附件数"（真孤儿被清理是预期行为，故用引用数兜底）
    const resolvedRefs = new Set<string>();
    for (const p of files.filter((f) => f.endsWith('.md'))) {
      for (const ref of localRefs(read(p))) {
        const hit = files.find((f) => f === ref.target) ?? files.find((f) => basename(f) === basename(ref.target));
        if (hit) resolvedRefs.add(hit);
      }
    }
    for (const need of resolvedRefs) {
      if (!files.includes(need)) problems.push(`被引用的附件不存在：${need}`);
    }
    // 6) 外链已本地化：只校验"本应本地化"的用例（网页 / 404 / 内网 / 黑名单为有意保留）
    const shouldLocalize = [
      'externals/图片.md',
      'externals/音频.md',
      'externals/视频.md',
      'externals/pdf.md',
      'externals/普通链接.md',
      'externals/html标签.md',
      'externals/data图片.md',
      'externals/重定向.md',
      'deep/多级/深层笔记.md',
      'notes/07-外链本地化.md',
    ];
    for (const p of shouldLocalize) {
      if (!files.includes(p)) {
        problems.push(`笔记消失：${p}`);
        continue;
      }
      if (/127\.0\.0\.1:\d+/.test(read(p))) problems.push(`${p} 仍含未本地化的外链`);
    }
    // 7) 保形改写
    if (read('notes/18-HTML媒体标签.md').includes('![](')) problems.push('HTML 媒体标签被改写成图片嵌入');
    if (/!\[说明文档\]/.test(read('externals/普通链接.md'))) problems.push('普通链接被改写成图片嵌入');
    // 8) 命名生效（笔记相对 ./assets）
    const t01 = read('notes/01-正文图片.md');
    if (!/01-正文图片_image_\d{3}\.png/.test(t01)) problems.push(`命名未生效：${t01.slice(0, 100)}`);
    // 9) 真孤儿被清理；导出的 zip 不是受管附件、不得被清理
    if (exists('orphans/true-orphan.png')) problems.push('真孤儿未被清理');
    if (!exists('Unused_Attachments.zip')) problems.push('导出未用附件未生成 zip');
    // 10) 空目录矩阵
    for (const d of ['empty/leaf', 'empty/parent/child', 'empty/deep/a/b/c']) {
      if (nodeFs.existsSync(abs(d))) problems.push(`空目录未被清理：${d}`);
    }
    if (!nodeFs.existsSync(abs('empty/hidden-file'))) problems.push('含隐藏文件的目录被误清理');

    // ---- 收敛性：连跑整套命令直到文件集合不再变化（最多 6 轮）----
    // 为什么不是"第一遍后就不再变化"：13 条命令按固定顺序连跑时，「收集」（把附件搬到笔记归属目录）
    // 排在「重命名」（原地改名）之前——本轮命名出的文件要等下一轮的收集才进笔记目录。
    // 这是命令顺序固有的交互，不是副作用累积。真正要守的是**有限轮内必须收敛**（不收敛即抖动型缺陷）。
    const MAX_PASSES = 6;
    let prevFiles = files;
    let convergedAt = 0;
    const passSizes = [files.length];
    for (let pass = 2; pass <= MAX_PASSES; pass++) {
      await runAllCommands();
      const cur = list();
      passSizes.push(cur.length);
      const changed = cur.filter((f) => !prevFiles.includes(f)).length + prevFiles.filter((f) => !cur.includes(f)).length;
      if (changed === 0) {
        convergedAt = pass;
        break;
      }
      prevFiles = cur;
    }
    if (!convergedAt) {
      problems.push(`未在 ${MAX_PASSES} 轮内收敛：每轮仍在改名/移动（疑似抖动或循环）`);
    }

    if (problems.length) {
      // 失败时把最终文件树打出来，便于判断是"真损失"还是"断言写错"
      console.log(`[acceptance] 收敛于第 ${convergedAt || '?'} 轮，各轮规模 ${passSizes.join(' → ')}`);
      console.log(`[acceptance] 失败，最终文件树：\n${list().map((f) => `  ${f}`).join('\n')}`);
      console.log(`[acceptance] 问题清单：\n${problems.map((p) => ` ✗ ${p}`).join('\n')}`);
    }
    expect(problems, `验收问题 ${problems.length} 项：\n${problems.join('\n')}`).toEqual([]);
  }, 300000);
});
