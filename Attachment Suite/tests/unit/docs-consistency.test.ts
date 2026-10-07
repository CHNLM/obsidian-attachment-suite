/**
 * 文档对账守卫。
 *
 * 为什么需要它：`tests/README.md` 自称是"逐文件用例清单"，而它是**手写的**——
 * 加用例、改套件时没人会记得回来改数字。2026-10-02 的推送前复查就是从这里抓出问题的：
 * 同一份文档里四处写「77 用例」、另两处写 82；7 个套件的用例数与 `vitest` 实测不符。
 * 这类漂移不会让任何测试变红，却直接削弱这份文档作为"清单"的可信度。
 *
 * 它现在钉五类**可机器判定**的事（"当前有效文档"清单由 `docs/README.md` 的索引表驱动）：
 *   ① `tests/README` 套件表的分项用例数之和 = 第 8 行声明的总数（且文件数一致）；
 *   ② 每个实际存在的测试文件都在表格里被单列（避免"加了文件忘了登记"）；
 *   ③ 索引指向的每个文档路径都真实存在；
 *   ④ 当前规模只有一个权威来源——其它文档的「规模」小节必须与第 8 行逐字一致；
 *     外加"全量命令声明必须等于源码注册数"。
 *   ⑤ 文档里引用的**文件与符号仍然存在**（防重构后引用失效，见文件末尾那组用例）。
 * 至于"某个套件的数字是不是它真实的用例数"，本表无法自证——那需要跑一次 vitest 才知道，
 * 故不在这里断言（避免写出一条恒真的假守卫）。
 *
 * 另加一条：几份对外文档不得再写出**已用宿主语言包核实过是错**的 Obsidian 标签。
 */

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import { DEFAULT_SETTINGS } from '../../src/settings';

const TESTS_DIR = fileURLToPath(new URL('..', import.meta.url)); // …/Attachment Suite/tests
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url)); // …/obsidian-attachment

/**
 * 读文本并**归一化行尾**。
 *
 * 本守卫的解析目前对 CRLF 是容忍的（`cellsOf` 先 `trim()`），所以它在 Windows 的 CRLF 检出下
 * 照样通过。但仍然在这里归一化：**"测试解析文本前先归一化行尾"应当是一条统一规则**——
 * 2026-10-03 的 run 37089281509 已经证明，只要有一处按"行内容逐字相等"去定位锚点，
 * 就会 ubuntu 绿、windows 整片红，而那种脆弱是肉眼看不出来的。
 * （`.gitattributes` 也把文本统一钉成了 LF，两边都设防：守卫不该依赖检出配置恰好正确。）
 */
const read = (p: string): string => nodeFs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');

/** 拆一行表格为单元格；`\|` 是转义过的竖线，必须当普通字符处理（有行用它写 `#锚点`/`\|别名`）。 */
function cellsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .replace(/\\\|/g, '\u0000')
    .split('|')
    .map((c) => c.trim().replace(/\u0000/g, '|'));
}

/** 从 `tests/README.md` 的套件表里取出 [文件名, 用例数] 列表。 */
function parseSuiteTable(doc: string): Array<{ file: string; count: number }> {
  const out: Array<{ file: string; count: number }> = [];
  for (const line of doc.split('\n')) {
    if (!line.trim().startsWith('|') || !line.includes('.test.ts)')) continue;
    const cells = cellsOf(line);
    const nums = cells.filter((c) => /^\d+$/.test(c));
    if (cells.length !== 3 || nums.length !== 1) continue;
    const m = /\[([^\]]+)\]/.exec(cells[0]);
    if (!m) continue;
    out.push({ file: m[1], count: Number(nums[0]) });
  }
  return out;
}

/** 递归收集 tests/ 下所有 *.test.ts 的 basename。 */
function actualTestFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
    const abs = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...actualTestFiles(abs));
    else if (entry.name.endsWith('.test.ts')) found.push(entry.name);
  }
  return found.sort();
}

describe('文档对账守卫：tests/README 的规模数字必须自洽', () => {
  const DOC = read(nodePath.join(TESTS_DIR, 'README.md'));
  const rows = parseSuiteTable(DOC);

  it('套件表确实被解析到了（否则下面两条会因"一行都没匹配上"而空转）', () => {
    expect(rows.length, '一套表格行都没解析出来——表格格式变了，本守卫已失效').toBeGreaterThan(20);
  });

  it('分项用例数之和 = 第 8 行声明的总数', () => {
    const m = /\*\*(\d+) 个测试文件，(\d+) 个运行时用例/.exec(DOC);
    expect(m, '找不到第 8 行的规模声明（"当前规模：**N 个测试文件，M 个运行时用例**"）').toBeTruthy();
    const [, files, cases] = m!;
    const sum = rows.reduce((n, r) => n + r.count, 0);
    expect(
      sum,
      `套件表分项之和 ${sum} ≠ 声明的 ${cases}——加/删用例后请同步 tests/README 的表格与第 8 行`,
    ).toBe(Number(cases));
    expect(rows.length, `表内单列的文件数 ${rows.length} ≠ 声明的 ${files}`).toBe(Number(files));
  });

  it('每个实际存在的测试文件都在套件表里被单列', () => {
    const listed = new Set(rows.map((r) => r.file));
    const missing = actualTestFiles(TESTS_DIR).filter((f) => !listed.has(f));
    expect(missing, `这些测试文件没有被登记进 tests/README 的套件表：${missing.join('、')}`).toEqual([]);
  });
});

/**
 * 对外文档不得再写出**已核实为错**的 Obsidian 标签。
 *
 * 「默认附件文件夹」与「与当前文件同名的文件夹」都是凭记忆写的：宿主 zh-CN 实际叫
 * 「附件默认存放路径」与「当前文件所在的文件夹」（键名见 `settings-tab.test.ts` 的
 * `HOST_LABELS`）。用户照错的标签去设置里找会找不到。
 *
 * 注意：`coverage-audit-*.md` 与 `settings-tab.test.ts` 里**故意**保留这两个错名
 * （前者记录缺陷、后者是禁止列表），故不纳入本检查。
 */
describe('文档对账守卫：对外文档不得写出已核实的错误 Obsidian 标签', () => {
  const WRONG = ['默认附件文件夹', '与当前文件同名的文件夹'];
  const targets: Array<[string, string]> = [
    ['根 README.md', nodePath.join(REPO_ROOT, 'README.md')],
    ['docs/default-settings.md', nodePath.join(REPO_ROOT, 'docs', 'default-settings.md')],
    ['docs/command-inventory.md', nodePath.join(REPO_ROOT, 'docs', 'command-inventory.md')],
    ['docs/README.md', nodePath.join(REPO_ROOT, 'docs', 'README.md')],
  ];

  for (const [label, p] of targets) {
    it(`${label} 用的是宿主真实标签`, () => {
      const text = read(p);
      for (const wrong of WRONG) {
        expect(
          text,
          `「${wrong}」不是 Obsidian 的标签（zh-CN 实际叫「附件默认存放路径」/「当前文件所在的文件夹」），` +
            '照它去找会找不到那一项',
        ).not.toContain(wrong);
      }
    });
  }
});

/**
 * 「当前有效」文档清单**由 `docs/README.md` 的索引表驱动**。
 *
 * 为什么让守卫去读索引而不是硬编码一份清单：索引本来就要维护（给人看"哪一篇还作数"），
 * 再手写第二份清单，就等于又造了一个"两份实现"。让索引兼作机器可读的清单之后：
 * - 新增一篇当前有效文档 → 只要登记进索引，它自动进入下面所有对账；
 * - **历史归档文档天然被排除**（它们记的是"当时的事实"，数字本该是旧的）——
 *   这正是上一轮把 `real-host-run` 的历史规模、`fix-record` 的旧用例数误判成"错误"的根源。
 *
 * 索引里用 `../README.md` 与 `%20` 编码的路径也要能解析——所以这里做了 unquote + 归一化。
 */
/** 解析索引里以 `headingPrefix` 开头的那张表，取出其中的文档路径。 */
function indexDocs(headingPrefix: string): string[] {
  const idx = read(nodePath.join(REPO_ROOT, 'docs', 'README.md'));
  const after = idx.split(headingPrefix)[1];
  if (!after) return [];
  const section = after.split(/^## /m)[0];
  const out: string[] = [];
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const m = /\]\(([^)]+)\)/.exec(line);
    if (!m) continue;
    out.push(nodePath.normalize(nodePath.join(REPO_ROOT, 'docs', decodeURIComponent(m[1]))));
  }
  return out;
}

/** 全部「当前有效」文档（规范与事实 + 逐轮记录）——用于"索引指向的文件必须存在"。 */
function allCurrentDocs(): string[] {
  return [...indexDocs('## 当前有效 · 规范与事实'), ...indexDocs('## 当前有效 · 逐轮记录')];
}

/**
 * 只做**事实对账**的文档：索引里「规范与事实」那一类。
 *
 * 为什么把「逐轮记录」排除在外——这是被一次**误报**逼出来的：
 * `review-2026-10-02.md` 复述缺陷时**引用了当时的错误写法**（\"全部 **13 条命令**\"），
 * 于是命令口径断言把它判红。记录类文档的职责就是复述当时的样子，
 * 让它"不能说旧写法"等于逼它失真。**判据不同，就该分表。**
 */
function normativeDocs(): string[] {
  return indexDocs('## 当前有效 · 规范与事实');
}

/** `tests/README.md` 第 8 行是「当前规模」的**唯一权威来源**。 */
function authoritativeScale(): { files: number; cases: number } {
  const m = /当前规模：\*\*(\d+) 个测试文件，(\d+) 个运行时用例/.exec(read(nodePath.join(TESTS_DIR, 'README.md')));
  if (!m) throw new Error('tests/README.md 里找不到「当前规模：**N 个测试文件，M 个运行时用例」');
  return { files: Number(m[1]), cases: Number(m[2]) };
}

/** 源码里的命令数：`total` = 注册总数；`business` = 去掉诊断开关后的业务命令数。 */
function commandCounts(): { total: number; business: number } {
  const src = read(nodePath.join(REPO_ROOT, 'Attachment Suite', 'src', 'commands.ts'));
  const ids = [...src.matchAll(/id: '(attachment:[a-z-]+)'/g)].map((m) => m[1]);
  return { total: ids.length, business: ids.filter((id) => !id.endsWith('toggle-debug-logging')).length };
}

interface TotalityClaim {
  file: string;
  text: string;
  n: number;
  expect: number;
  why: string;
}

/**
 * 取所有「全量命令声明」。
 *
 * 判据是**它会不会被读成"插件的命令就这么多"**，因此只认三类定型写法：
 *   ① 加粗清单式：`全部 **14 条**命令` / `共 **14 条**命令`；
 *   ② 标题式总览：`总览（14 条…）`；
 *   ③ 注册式陈述：`注册全部 14 条命令`。
 *
 * 叙述性用法（"实体执行全部 13 条命令"＝某条链路驱动的范围）**故意不在此列**——
 * 它们说的是"驱动了哪 13 条业务命令"，不是清单，强行纳入只会制造误报。
 *
 * 带「业务」限定的声明比**业务命令数**，不带者比**注册总数**：
 * 两种写法都合法，非法的是"用不加限定的 13 冒充全量"。
 */
function totalityClaims(): TotalityClaim[] {
  const { total, business } = commandCounts();
  const pick = (m: RegExpMatchArray, file: string): TotalityClaim => {
    const hasScope = Boolean(m[2]);
    return {
      file,
      text: m[0],
      n: Number(m[1]),
      expect: hasScope ? business : total,
      why: hasScope
        ? `此处限定了「业务命令」，应与业务命令数 ${business} 一致（源码另有 1 条诊断开关）`
        : `此处未加限定，应与注册总数 ${total} 一致（13 条业务 + 1 条诊断开关）；` +
          '若想说业务命令，请写成「全部 **13 条业务命令**」',
    };
  };
  const patterns = [
    /(?:全部|共)\s*\*\*\s*(\d+)\s*条(业务)?命令/g, // ①
    /总览（(\d+)\s*条(业务)?/g, // ②
    /注册(?:全部\s*)?(\d+)\s*条命令/g, // ③
  ];

  const out: TotalityClaim[] = [];
  for (const p of normativeDocs()) {
    if (!nodeFs.existsSync(p)) continue;
    const body = read(p);
    const file = nodePath.relative(REPO_ROOT, p);
    for (const re of patterns) {
      for (const m of body.matchAll(re)) out.push(pick(m, file));
    }
  }
  return out;
}

describe('文档对账守卫：全量命令声明必须等于源码注册数', () => {
  it('至少能找到一处全量声明（防空转）', () => {
    expect(totalityClaims().length, '没有任何"全量命令"声明，本守卫等于没查').toBeGreaterThan(1);
  });

  it('每一处都与源码自洽（带「业务」限定者比业务数，否则比总数）', () => {
    for (const c of totalityClaims()) {
      expect(c.n, `${c.file} 写「${c.text}」：${c.why}`).toBe(c.expect);
    }
  });
});

describe('文档对账守卫：索引驱动的当前有效文档清单', () => {
  const docs = allCurrentDocs();

  it('能从 docs/README.md 解析出「当前有效」清单（否则下面几条会因空清单而空转）', () => {
    expect(docs.length, '索引里一个当前有效文档都没解析出来——索引表格式变了').toBeGreaterThan(3);
  });

  it('清单里每个路径都真实存在', () => {
    const missing = docs.filter((p) => !nodeFs.existsSync(p));
    expect(missing, `索引指向了不存在的文件：${missing.join('、')}`).toEqual([]);
  });
});

/**
 * 当前规模只能有**一个**权威来源，且其余文档**不得复制**这个数字。
 *
 * 上一轮的教训：规模数字被复制到 `tests/README` 与 `coverage-audit` 两处之后，
 * 加了 11 个用例只同步了一处，`coverage-audit` 的「规模」小节就悄悄落后了两个版本
 * （`35 文件 / 471 用例` 与实际 `38 / 496`）。**复制即漂移**。
 *
 * 规则的演进（2026-10-03）：起初只要求「复制的那份与权威值逐字一致」——但那仍然是复制：
 * 每次加用例都得改两处，而且只有改完才发现不一致（本轮加 6 个用例时又被抓了一次）。
 * 现在改成**禁止复制**：「规模」小节必须**指向** `tests/README.md` 第 8 行。
 * 于是加/删用例只需要改一处、摩擦归零；而"权威值那一行本身还能解析"另由本组第一条守住。
 */
describe('文档对账守卫：当前规模只能有一个权威来源，其余文档不得复制', () => {
  /** 取出每个 `### 规模` 小节的正文。 */
  function scaleSections(): Array<{ file: string; body: string }> {
    const out: Array<{ file: string; body: string }> = [];
    for (const p of normativeDocs()) {
      if (!nodeFs.existsSync(p)) continue;
      const body = read(p).split(/^### 规模\s*$/m)[1]?.split(/^#{2,3} /m)[0] ?? '';
      if (body.trim() === '') continue;
      out.push({ file: nodePath.relative(REPO_ROOT, p), body });
    }
    return out;
  }
  const SECTIONS = scaleSections();

  it('权威来源（tests/README.md 第 8 行）仍可解析', () => {
    const truth = authoritativeScale();
    expect(truth.files, '权威来源那一行的格式变了——所有指向它的文档都会失准').toBeGreaterThan(0);
    expect(truth.cases, '权威来源那一行解析不出用例数').toBeGreaterThan(0);
  });

  it('每个「规模」小节都指向权威来源，且不得再复制数字', () => {
    expect(SECTIONS.length, '一个「规模」小节都没解析到——小节被改名了，或本守卫已失效').toBeGreaterThan(0);
    const copying = SECTIONS.filter((s) => /\d+\s*文件\s*\/\s*\d+\s*用例/.test(s.body));
    expect(
      copying.map((s) => s.file),
      '这些文档的「规模」小节仍在复制数字——请改为指向 `tests/README.md` 第 8 行（复制即漂移）',
    ).toEqual([]);
    const notPointing = SECTIONS.filter((s) => !s.body.includes('tests/README.md')).map((s) => s.file);
    expect(notPointing, '这些「规模」小节既没有数字、也没指向权威来源，读者无从查证').toEqual([]);
  });
});

/**
 * 文档里引用的文件与符号必须仍然存在。
 *
 * 为什么需要它：这类引用最容易随重构失效——删掉一个 core 模块、改个函数名，文档里的
 * `core/xxx.ts` 或 `foo()` 就成了坏引用，而**没有任何东西会报警**。2026-10-02 之前这件事
 * 只能人工查（那天的两次复查）——现在把它机械看守住。
 *
 * 豁免规则刻意写成**通用**的（不针对某个具体文件），并配"至少检查到 N 处"的防空转断言：
 * 否则把规则放宽一格，守卫就会悄悄失效而看不出来。
 *   ① 该行上下文含"已删除 / 勿复活 / 例如 / 示例 / 占位"——文档已明说那是历史或举例；
 *   ② 名字含 `foo`——本仓库用 foo 作占位示例的惯例；
 *   ③ 引用片段以 `-` 或 `.` 开头——`-core.test.ts` 这类后缀示例；
 *   ④ 符号只有一个字母——`O(n)` 这类记号。
 */
describe('文档对账守卫：文档引用的文件与符号必须仍然存在', () => {
  const PLUGIN_ROOT = nodePath.join(REPO_ROOT, 'Attachment Suite');
  const EXEMPT_CTX = ['已删除', '勿复活', '不要复活', '例如', '示例', '占位'];
  const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

  /** 仓库内所有可能被引用的文件名（src / tests / scripts / 插件根）。 */
  function repoFileNames(): Set<string> {
    const names = new Set<string>();
    const walk = (dir: string): void => {
      for (const e of nodeFs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (e.isDirectory()) walk(nodePath.join(dir, e.name));
        else names.add(e.name);
      }
    };
    const roots = ['src', 'tests', 'scripts'].map((r) => nodePath.join(PLUGIN_ROOT, r));
    roots.push(PLUGIN_ROOT);
    for (const r of roots) if (nodeFs.existsSync(r)) walk(r);
    return names;
  }

  /** 全部源码与脚本的文本，用于判断"某个符号还在不在"。 */
  function sourceBlob(): string {
    let blob = '';
    const walk = (dir: string): void => {
      for (const e of nodeFs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(e.name)) continue;
        const abs = nodePath.join(dir, e.name);
        if (e.isDirectory()) walk(abs);
        else if (/\.(ts|mjs)$/.test(e.name)) blob += read(abs);
      }
    };
    for (const rel of ['src', 'tests', 'scripts']) {
      const root = nodePath.join(PLUGIN_ROOT, rel);
      if (nodeFs.existsSync(root)) walk(root);
    }
    return blob;
  }

  interface DocRef {
    file: string;
    line: number;
    ref: string;
    kind: '文件' | '符号';
  }

  function collectRefs(): DocRef[] {
    const out: DocRef[] = [];
    for (const p of normativeDocs()) {
      if (!nodeFs.existsSync(p)) continue;
      const rel = nodePath.relative(REPO_ROOT, p);
      read(p)
        .split('\n')
        .forEach((line, i) => {
          if (EXEMPT_CTX.some((k) => line.includes(k))) return;
          for (const m of line.matchAll(/`([A-Za-z0-9_./-]+\.(?:ts|mjs))`/g)) {
            out.push({ file: rel, line: i + 1, ref: m[1], kind: '文件' });
          }
          // 符号引用允许**路径前缀**：`core/link-resolver.addRefKeys(` 取最后一段作为符号名。
          // （第一版漏了 `/`，于是带路径的调用形式一处都抓不到——由变体测试发现。）
          for (const m of line.matchAll(/`([A-Za-z_][A-Za-z0-9_./-]*)\(/g)) {
            out.push({ file: rel, line: i + 1, ref: m[1].split('.').pop() as string, kind: '符号' });
          }
        });
    }
    return out;
  }

  const FILES = repoFileNames();
  const BLOB = sourceBlob();
  const ALL = collectRefs();
  const isExempt = (r: DocRef): boolean =>
    r.ref.includes('foo') || /^[-.]/.test(r.ref) || /^[A-Za-z]$/.test(r.ref);
  const CHECKED = ALL.filter((r) => !isExempt(r));

  it('确实扫到了足够多的引用（否则说明提取规则失效，或豁免写得太宽）', () => {
    expect(ALL.length, '一处引用都没提取到——提取正则失效了').toBeGreaterThan(100);
    expect(CHECKED.length, '绝大多数引用被豁免掉了——豁免规则太宽，守卫等于没查').toBeGreaterThan(100);
  });

  it('每一个被引用的文件都真实存在', () => {
    const bad = CHECKED.filter((r) => r.kind === '文件' && !FILES.has(nodePath.basename(r.ref))).map(
      (r) => `${r.file}:${r.line} → ${r.ref}`,
    );
    expect(bad, `文档引用了不存在的文件（重构后忘了同步文档？）：${bad.join('；')}`).toEqual([]);
  });

  it('每一个被引用的符号都仍在源码里出现', () => {
    const bad = CHECKED.filter(
      (r) => r.kind === '符号' && !new RegExp(`\\b${r.ref}\\b`).test(BLOB),
    ).map((r) => `${r.file}:${r.line} → ${r.ref}()`);
    expect(bad, `文档引用了源码里找不到的符号：${bad.join('；')}`).toEqual([]);
  });
});

/**
 * `docs/default-settings.md` 的默认值声明必须与 `DEFAULT_SETTINGS` 一致。
 *
 * 为什么需要它：这份文档属「规范与事实」类，逐项列了三十多个默认值，是判断"某能力开箱是否可用"
 * 时最先被读的一份；而在此之前它**没有任何守卫覆盖**——守卫只管规模数字、命令口径、宿主标签
 * 与文档引用是否还存在。于是"改默认值忘了改文档（或反过来）"不会让任何测试变红，
 * 正是本仓库反复栽过的「手写清单是最容易漏的一份实现」。
 *
 * 做法：**值从代码现场读取**、文档侧从三列表格的「默认」列解析，两边在此比对。
 * 映射表里不写期望值、只写"怎么从 DEFAULT_SETTINGS 渲染出文档该有的样子"，
 * 所以代码改了而文档没跟上会当场变红，并指出是哪一行。
 * 另加一条**完备性**规则：默认列写「开 / 关」的行必须都在映射表里——
 * 以后新增一行默认值却忘了纳入对账时，守卫会先红，而不是悄悄漏过去。
 */
describe('文档对账守卫：default-settings.md 的默认值必须与代码一致', () => {
  const DOC = read(nodePath.join(REPO_ROOT, 'docs', 'default-settings.md'));

  /** 解析 `| a | b | c |` 三列表格 → [标签, 第二列]；跳过表头与分隔行。 */
  function docRows(): Array<{ label: string; cell: string }> {
    const out: Array<{ label: string; cell: string }> = [];
    for (const line of DOC.split('\n')) {
      if (!line.trim().startsWith('|')) continue;
      const cells = cellsOf(line);
      if (cells.length !== 3 || cells.every((c) => /^-+$/.test(c))) continue;
      if (cells[0] === '选项' || cells[0] === '能力') continue;
      out.push({
        label: cells[0].replace(/[`*]/g, '').trim(),
        cell: cells[1].replace(/[`*]/g, '').replace(/\s+/g, ' ').trim(),
      });
    }
    return out;
  }
  const ROWS = docRows();

  const onOff = (b: boolean): string => (b ? '开' : '关');
  const empty = (a: readonly unknown[]): string => (a.length === 0 ? '空' : `非空（${a.length}）`);
  const notifyLevel: Record<string, string> = { silent: '静默', summary: '仅摘要', verbose: '详细' };
  const folderMode: Record<string, string> = { obsidian: '跟随 Obsidian', custom: '自定义' };
  const deleteMode: Record<string, string> = {
    '.trash': 'Obsidian 回收站',
    'system-trash': '系统回收站',
    permanent: '永久删除',
  };
  const S = DEFAULT_SETTINGS;

  /** [文档行标签, 由 DEFAULT_SETTINGS 现场渲染出的、文档该写的那一格] */
  const MAP: Array<[string, () => string]> = [
    // §2 能力总开关
    ['统一命名', () => onOff(S.naming.enabled)],
    ['媒体本地化', () => onOff(S.localize.enabled)],
    ['一致性', () => onOff(S.consistency.enabled)],
    ['清理', () => onOff(S.cleanup.enabled)],
    ['导出', () => onOff(S.exporter.enabled)],
    ['自动处理', () => onOff(S.automation.enabled)],
    // §3.1 通用
    ['附件目录来源', () => folderMode[S.attachmentFolderMode]],
    ['自定义附件目录', () => S.attachmentFolder],
    ['通知级别', () => notifyLevel[S.notificationLevel]],
    ['详细诊断日志', () => onOff(S.debugLogging)],
    ['全局排除目录', () => empty(S.paths.exclude)],
    // §3.2 命名
    ['启用统一命名', () => onOff(S.naming.enabled)],
    ['连接符', () => S.naming.connector],
    ['命名加入时间', () => onOff(S.naming.addTime)],
    ['命名加入路径哈希', () => onOff(S.naming.addPathHash)],
    ['名称带类别', () => onOff(S.naming.honorCategory)],
    ['额外带子类型', () => onOff(S.naming.showSubType)],
    ['按类别放入子目录', () => onOff(S.naming.folderByCategory)],
    // §3.3 本地化
    ['启用媒体本地化', () => onOff(S.localize.enabled)],
    ['本地化网络 URL', () => onOff(S.localize.localizeWebUrls)],
    ['扩展扫描（普通链接与 HTML 标签）', () => onOff(S.localize.scanHtmlAndLinks)],
    ['用 MD5 作为新文件名', () => onOff(S.localize.useMd5ForNew)],
    ['拦截内网与本机地址', () => onOff(S.localize.blockPrivateHosts)],
    // §3.4 一致性
    ['报告坏链接', () => onOff(S.consistency.reportBrokenLinks)],
    ['修复不兼容路径', () => onOff(S.consistency.repairIncompatiblePaths)],
    ['路径修复的目标系统', () => (S.consistency.platforms.length === 1 ? '仅当前系统' : '非单平台')],
    ['笔记移动时跟随移动附件', () => onOff(S.consistency.followNoteMove)],
    ['断链修复：相似度推荐', () => onOff(S.consistency.fuzzySuggest)],
    ['相似度阈值 / 候选上限', () => `${S.consistency.fuzzyThreshold} / ${S.consistency.fuzzyTopN}`],
    // §3.5 清理
    ['启用清理', () => onOff(S.cleanup.enabled)],
    ['删除方式', () => deleteMode[S.cleanup.deleteMode]],
    ['排除目录', () => empty(S.cleanup.excludedFolders)],
    ['排除目录含子目录', () => onOff(S.cleanup.excludeSubfolders)],
    ['删除前确认', () => onOff(S.cleanup.requireConfirm)],
    // §3.6 自动化 / 导出
    ['轮询间隔', () => `${S.automation.interval} 秒`],
    ['启用导出', () => onOff(S.exporter.enabled)],
    // §5 有意保持不变的项
    [
      '单文件体积上限 / 超时 / 重试',
      () => `${S.localize.maxDownloadMb}MB / ${S.localize.timeoutMs / 1000}s / ${S.localize.tryCount} 次`,
    ],
    ['并发下载数', () => `${S.localize.maxConcurrent}（串行）`],
    ['同主机最小间隔', () => `${S.localize.perHostIntervalMs}（不限速）`],
    ['域名白/黑名单、仅白名单模式', () => `${empty(S.localize.allowHosts)} / ${onOff(S.localize.hostAllowlistOnly)}`],
  ];

  it('表格与映射表都解析到了足够多的行（防空转）', () => {
    expect(ROWS.length, '一条默认值行都没解析到——表格格式变了，本守卫已失效').toBeGreaterThan(25);
    expect(MAP.length, '映射表太短，守卫等于没查').toBeGreaterThanOrEqual(35);
  });

  it('每一行声明的默认值都与代码一致', () => {
    // 文档允许在值后面用全角括号补一句说明（如「开（本次由关改为开）」）——被比的是**值**，
    // 所以注解不参与比对，但值必须是那一格的前缀（注解不能盖住一个不同的值）。
    const same = (cell: string, want: string): boolean => cell === want || cell.startsWith(`${want}（`);
    const problems: string[] = [];
    for (const [label, render] of MAP) {
      const hits = ROWS.filter((r) => r.label === label);
      if (hits.length === 0) {
        problems.push(`映射表里的「${label}」在文档里找不到对应行（标签改名了？）`);
        continue;
      }
      for (const h of hits) {
        const want = render();
        if (!same(h.cell, want)) problems.push(`「${label}」文档写「${h.cell}」，而代码是「${want}」`);
      }
    }
    expect(problems, `default-settings.md 与 DEFAULT_SETTINGS 不一致：${problems.join('；')}`).toEqual([]);
  });

  it('默认列写「开 / 关」的行必须都在映射表里（新增默认值时先红）', () => {
    const onOffLabels = [...new Set(ROWS.filter((r) => r.cell === '开' || r.cell === '关').map((r) => r.label))];
    expect(onOffLabels.length, '一条开/关行都没解析到——表格格式变了').toBeGreaterThan(10);
    const mapped = new Set(MAP.map(([l]) => l));
    const missing = onOffLabels.filter((l) => !mapped.has(l));
    expect(
      missing,
      `这些行声明了默认开/关却没纳入对账：${missing.join('、')}——请在 MAP 里补一行（值从 DEFAULT_SETTINGS 现场读）`,
    ).toEqual([]);
  });
});

/**
 * 命令清单必须与源码注册一一对应。
 *
 * 为什么需要它：`docs/command-inventory.md` 与根 README 的命令表都是**手写的清单**，
 * 而"加一条命令忘了登记"正是本仓库 §7 点名的形态。守卫只认得"全部 N 条命令"这类总数声明
 * （见上文 totalityClaims），管不了"清单里到底是哪几条"——漏登记一条、或留一条已删命令，
 * 都不会变红。这里补上集合级的对账。
 */
describe('文档对账守卫：命令清单必须覆盖源码注册的每一条命令', () => {
  const COMMANDS_SRC = read(nodePath.join(REPO_ROOT, 'Attachment Suite', 'src', 'commands.ts'));
  const REGISTERED = [...COMMANDS_SRC.matchAll(/id: '(attachment:[a-z-]+)'/g)].map((m) => m[1]);

  it('源码里注册了 14 条命令（13 条业务 + 1 条诊断），且无重复 id', () => {
    expect(REGISTERED.length, `从 commands.ts 解析到 ${REGISTERED.length} 条 id（解析规则可能要跟着改）`).toBe(14);
    expect(new Set(REGISTERED).size, '存在重复的命令 id').toBe(14);
  });

  const targets: Array<[string, string]> = [
    ['docs/command-inventory.md', nodePath.join(REPO_ROOT, 'docs', 'command-inventory.md')],
    ['根 README.md', nodePath.join(REPO_ROOT, 'README.md')],
  ];

  for (const [label, p] of targets) {
    it(`${label} 的命令清单与源码一一对应`, () => {
      const listed = [...new Set([...read(p).matchAll(/`(attachment:[a-z-]+)`/g)].map((m) => m[1]))];
      expect(listed.length, `只从 ${label} 里解析到 ${listed.length} 条命令 id——清单格式变了？`).toBeGreaterThan(10);
      const missing = REGISTERED.filter((id) => !listed.includes(id));
      const extra = listed.filter((id) => !REGISTERED.includes(id));
      expect(missing, `${label} 漏登记了这些命令：${missing.join('、')}`).toEqual([]);
      expect(extra, `${label} 列了源码里不存在的命令：${extra.join('、')}`).toEqual([]);
    });
  }
});
