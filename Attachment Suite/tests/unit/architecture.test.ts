/**
 * 架构守卫：把分层约定与"唯一实现"约定变成可执行的断言。
 *
 * 为什么需要它：本仓库最贵的一类缺陷（4 次误删级）全部源自"同一件事有两份实现，后来只改了一份"，
 * 或"某个 feature 被当成共享模块、悄悄长出反向依赖"。这类问题**不会立刻报错**，只能靠约定守住——
 * 而只写在文档里的约定会在几个月内漂移回去。所以用测试锁住，随 `npm test` 一起跑。
 *
 * 四条不变式：
 * 1. `src/core/**` 完全自包含：不 import `obsidian`，也不 import core 之外的任何模块；
 * 2. `src/features/**` 禁止横向共享（借别人当工具用），允许纵向编排（批量/自动化 → 单篇执行层）
 *    与纯逻辑复用；纵向边需显式登记在白名单里，新增一条就必须有人在这里写清楚"为什么"；
 * 3. 已归位的通用工具函数不得再出现第二份实现；
 * 4. 已修掉的旧写法不得复活（按域界定，见对应用例的说明）。
 *
 * 注：本文件只扫描 `src/`。`tests/e2e/infrastructure.ts` 里的同名小工具属于测试替身（独立实现
 * Obsidian 的路径语义），**故意不共用 src 的实现**，否则测试会跟着被测代码一起错。
 */

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** 插件源码根（tests/unit/ → ../../src）。 */
const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/**
 * 剥掉注释，避免"文档里引用旧写法"被误判成"代码里又用上了"。
 * 行注释的正则要求 `//` 前不是 `:`，以免把 `https://…` 这类字面量截断。
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of nodeFs.readdirSync(dir, { withFileTypes: true })) {
    const abs = nodePath.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listTsFiles(abs));
    else if (ent.name.endsWith('.ts')) out.push(abs);
  }
  return out;
}

interface SrcFile {
  /** 相对插件根的路径（统一 `/`）。 */
  rel: string;
  /** 模块名（去目录与 `.ts`）。 */
  name: string;
  /** 剥注释后的源码。 */
  code: string;
}

function allSrcFiles(): SrcFile[] {
  return listTsFiles(SRC).map((abs) => {
    const raw = nodeFs.readFileSync(abs, 'utf8');
    return {
      rel: nodePath.relative(nodePath.dirname(SRC), abs).split(nodePath.sep).join('/'),
      name: nodePath.basename(abs, '.ts'),
      code: stripComments(raw),
    };
  });
}

/** 取源码里所有 `from '<spec>'` 的模块说明符（含 import / export * from）。 */
function importSpecifiersOf(code: string): string[] {
  return Array.from(code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)).map((m) => m[1]);
}

/** 模块说明符 → 同目录模块名（`./link-fixer-core` → `link-fixer-core`；非相对返回 null）。 */
function localTargetOf(spec: string): string | null {
  if (!spec.startsWith('./')) return null;
  return spec.replace(/^\.\//, '').replace(/\.ts$/, '');
}

const CORE_FILES = (): SrcFile[] => allSrcFiles().filter((f) => f.rel.startsWith('src/core/'));
const FEATURE_FILES = (): SrcFile[] => allSrcFiles().filter((f) => f.rel.startsWith('src/features/'));

describe('架构守卫 · core 必须完全自包含', () => {
  it('扫描到的源文件数量合理（防空转：文件枚举失效时先红，而不是"零 offender 全绿"）', () => {
    expect(allSrcFiles().length, 'src/ 下一个 .ts 都没扫到——枚举规则失效，本文件所有断言都会空转').toBeGreaterThanOrEqual(40);
    expect(CORE_FILES().length, 'src/core 没扫到文件').toBeGreaterThanOrEqual(8);
    expect(FEATURE_FILES().length, 'src/features 没扫到文件').toBeGreaterThanOrEqual(20);
  });

  it('src/core 不 import obsidian，也不 import core 之外的模块', () => {
    const offenders: string[] = [];
    for (const f of CORE_FILES()) {
      const specs = importSpecifiersOf(f.code);
      if (specs.includes('obsidian')) offenders.push(`${f.rel} → import 'obsidian'`);
      for (const spec of specs) {
        // 只允许同目录相对导入；出现 `../xxx` 说明 core 反向依赖了上层，会直接构成循环
        if (!spec.startsWith('./')) offenders.push(`${f.rel} → 非 core 内部导入 '${spec}'`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('src/features 下的 *-core 模块保持纯逻辑（不 import obsidian）', () => {
    const offenders = FEATURE_FILES()
      .filter((f) => f.name.endsWith('-core'))
      .filter((f) => importSpecifiersOf(f.code).includes('obsidian'))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});

/**
 * 允许的跨 feature 依赖：**纵向编排**（上层批处理/自动化驱动下层单篇执行）。
 * 每条都必须写清理由；出现未登记的新边时测试会失败，逼着人重新判断它是编排，还是"又被当工具用了"。
 * 横向共享（某个 feature 作为通用工具被多方 import）**不允许**——那正是历史上 `link-fixer` 的形态。
 *
 * 说明：`*-core`（纯逻辑）不在本规则约束内，可自由复用——它不碰 App，不存在"共享执行体"的耦合风险。
 */
const ALLOWED_CROSS_FEATURE: ReadonlyArray<{ from: string; to: string; why: string }> = [
  {
    from: 'automation',
    to: 'localize-media',
    why: '自动处理编排单篇本地化（纵向：它决定"哪篇、何时"，本地化决定"怎么做"）',
  },
  {
    from: 'automation',
    to: 'name-formatter',
    why: '自动处理在本地化之后编排单篇命名（同上）',
  },
  {
    from: 'bulk-rename',
    to: 'name-formatter',
    why: '全库命名逐篇复用单篇命名执行体（纵向编排；批量层不重复实现单篇逻辑）',
  },
  {
    from: 'bulk-localize',
    to: 'localize-media',
    why: '全库本地化逐篇复用单篇本地化执行体（纵向编排）',
  },
];

/** 执行层（非 `*-core`）之间的实际依赖边。 */
function crossFeatureEdges(): Set<string> {
  const edges = new Set<string>();
  for (const f of FEATURE_FILES()) {
    if (f.name.endsWith('-core')) continue;
    for (const spec of importSpecifiersOf(f.code)) {
      const target = localTargetOf(spec);
      if (!target || target === f.name) continue;
      if (target.endsWith('-core')) continue; // 纯逻辑复用放行
      edges.add(`${f.name} -> ${target}`);
    }
  }
  return edges;
}

describe('架构守卫 · features 只允许纵向编排', () => {
  it('未登记的跨 feature 执行层依赖必须判失败', () => {
    const allowed = new Set(ALLOWED_CROSS_FEATURE.map((e) => `${e.from} -> ${e.to}`));
    const unexpected = Array.from(crossFeatureEdges()).filter((e) => !allowed.has(e));
    expect(unexpected).toEqual([]);
  });

  it('白名单里已不存在的边必须清理（防止白名单腐烂）', () => {
    const actual = crossFeatureEdges();
    const stale = ALLOWED_CROSS_FEATURE.map((e) => `${e.from} -> ${e.to}`).filter((e) => !actual.has(e));
    expect(stale).toEqual([]);
  });
});

/** 通用工具的**唯一**归属。新增重复实现会让测试失败——请改成从这里的家 import。 */
const CANONICAL_HELPERS: ReadonlyArray<{ fn: string; home: string }> = [
  { fn: 'basenameOf', home: 'src/core/types.ts' },
  { fn: 'dirOf', home: 'src/core/types.ts' },
  { fn: 'extOf', home: 'src/core/types.ts' },
  { fn: 'decodePercentEncoded', home: 'src/core/link-resolver.ts' },
  { fn: 'normalizeInVault', home: 'src/core/path-compatibility.ts' },
  { fn: 'normalizeLocal', home: 'src/core/path-compatibility.ts' },
];

describe('架构守卫 · 通用工具只允许一处实现', () => {
  it('核心路径/解码工具不得在别处二次实现', () => {
    const files = allSrcFiles();
    const offenders: string[] = [];
    for (const { fn, home } of CANONICAL_HELPERS) {
      // 同时挡 function 声明与 const 箭头函数两种写法
      const decl = new RegExp(`(?:^|\\s)(?:export\\s+)?(?:function\\s+${fn}\\b|const\\s+${fn}\\s*=)`);
      for (const f of files) {
        if (f.rel === home) continue;
        if (decl.test(f.code)) offenders.push(`${f.rel} 重复实现了 ${fn}（唯一归属：${home}）`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * 已修掉的旧写法不得复活。**按域界定**，不做全仓一刀切：
 *
 * - **空白截断链接目标**（`([^)\s]+)` 之类）：危害是"含空格的**库内路径**被读成半截、扩展名丢失 →
 *   引用不进在用集合 → 被清理误删"。最初这里只扫 `src/core/**`，把 `features/localize-media-core.ts`
 *   排除在外，理由是"它解析的是外部 URL，URL 不含字面空格，截到空白正好用来剥 `![x](url "标题")` 的标题段"。
 *
 *   **该豁免已于 2026-09-28 撤销**：前提本身不成立——标题段不是"空白截断"的唯一反例。
 *   真实后果有三条：① `![alt](url "标题")` 因"目标后面接不到 `)`"而**整条漏掉**（外链永远不本地化）；
 *   ② `<http://a/b.png>` 尖括号写法连 `<>` 一起当 URL，判定失败同样漏掉；
 *   ③ 目标含 `)` 时被截断，**下载与改写都作用在半截路径上**，还可能把正文改成
 *   `...local.png).png)` 这种坏形态。现在它复用 `core/link-resolver` 的 `parseMdTarget`
 *   （全仓唯一的目标/标题解析），并纳入本守卫。
 *
 * - **自制百分号解码**：只扫 core。core 里解析链接目标必须走 `decodePercentEncoded`，
 *   以保证"原始写法与 %xx 解码写法都纳入"的口径只有一处。features 里另有解析 URL 末段
 *   （`nameHintOf`）、data-URI 载荷（`decodeDataUri`）的 `decodeURIComponent`，域不同、
 *   且回退语义不同（前者失败回退 `alt/image`），故意不纳入。
 */
describe('架构守卫 · 已修掉的旧写法不得复活（仅在 core 域）', () => {
  it('core 内不得再按空白截断链接目标', () => {
    const offenders = CORE_FILES()
      .filter((f) => /\(\[\^\)\\s\]\+\)/.test(f.code))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('本地化的 markdown 目标解析也不得按空白截断（豁免已撤销，见上方说明）', () => {
    const f = allSrcFiles().find((x) => x.rel === 'src/features/localize-media-core.ts');
    expect(f, 'localize-media-core.ts 不存在（路径变了就要同步本条守卫）').toBeTruthy();
    expect(/\(\[\^\)\\s\]\+\)/.test(f!.code), '又出现了按空白截断的 markdown 目标解析').toBe(false);
  });

  it('core 内不得自行调用 decodeURIComponent（应走 decodePercentEncoded）', () => {
    const offenders = CORE_FILES()
      .filter((f) => f.rel !== 'src/core/link-resolver.ts' && /decodeURIComponent\(/.test(f.code))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
