/** 断链修复 · 纯计算（不依赖 obsidian，可脱离 App 单测）。执行层见 broken-link.ts。 */

import {
  MANAGED_ATTACHMENT_EXTENSIONS,
  basenameOf,
  decodePercentEncoded,
  dirOf,
  extOf,
  normalizeInVault,
  type AttachmentEntry,
  type BrokenRef,
  type ReferenceKind,
} from '../core';

/** 交互候选的匹配方式：普通命中（精确/归一化/多候选）/ 大小写差异 / 相似度推荐。 */
export type MatchKind = 'exact' | 'case' | 'fuzzy';

/** 待用户交互选择的断链及其候选（L5–L7）。 */
export interface BrokenLinkChoice {
  sourcePath: string;
  linkText: string;
  kind: ReferenceKind;
  /** 排序后的候选（得分高在前）。 */
  candidates: Array<{ path: string; score: number; matchedBy: MatchKind }>;
}

export interface BrokenLinkPlan {
  /** 自动修复（L1–L4，唯一命中且大小写敏感）：来源笔记 → {断链原始引用 → 新路径}。 */
  fixes: Map<string, Map<string, string>>;
  /** 待交互选择（L5–L7）。 */
  choices: BrokenLinkChoice[];
  /** 无候选且无相似（L8），保持报告。 */
  skipped: BrokenRef[];
  /** 自动修复条数。 */
  total: number;
}

/** 相似度推荐参数（来自设置）。 */
export interface FuzzyOptions {
  suggest: boolean;
  threshold: number;
  topN: number;
}

/**
 * 层级匹配用归一化：仅去除空格/连字符/下划线，**保留大小写**。
 * 大小写保持敏感：大小写不同的候选不参与自动修复（走 L5 交互）。
 */
function normalizeChars(s: string): string {
  return s.replace(/[\s_\-]+/g, '');
}

/** 相似度用归一化：再去小写（仅用于交互推荐，由用户确认）。 */
function normalizeFuzzy(s: string): string {
  return normalizeChars(s).toLowerCase();
}

function addIndex(idx: Map<string, Set<string>>, key: string, value: string): void {
  let s = idx.get(key);
  if (!s) {
    s = new Set<string>();
    idx.set(key, s);
  }
  s.add(value);
}

/** 把 `fromDir + '/' + rel` 归一化为库内路径（处理 `./`、`../`），脱离库根返回 null。 */
function normalizeJoin(fromDir: string, rel: string): string | null {
  return normalizeInVault(`${fromDir}/${rel}`);
}

/**
 * 相对路径：从来源笔记所在目录 `fromDir`（'' 表示库根）到 `toPath` 的正确相对路径。
 * 输出经反向解析校验（fromDir 解析回结果应恰好得到 toPath），校验失败时兜底返回库内路径。
 */
export function relativePath(fromDir: string, toPath: string): string {
  const from = fromDir ? fromDir.split('/').filter((s) => s && s !== '.') : [];
  const to = toPath.split('/').filter((s) => s && s !== '.');
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common++;
  const parts: string[] = [];
  for (let i = common; i < from.length; i++) parts.push('..');
  for (let i = common; i < to.length; i++) parts.push(to[i]);
  const rel = parts.join('/');
  if (normalizeJoin(fromDir, rel) === toPath) return rel;
  return toPath; // 兜底：无法可靠表达相对路径时用库内路径
}

/** 引用是否含路径成分（相对/绝对路径形式），用于决定新目标用相对路径还是库内路径。 */
function hasPathComponent(t: string): boolean {
  return t.includes('/') || t.startsWith('./') || t.startsWith('../');
}

/** Levenshtein 编辑距离（动态规划，行滚动）。 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** 名称相似度：归一化（忽略大小写）后编辑距离得分 + 公共前缀加成，范围 0~1+。 */
export function similarity(a: string, b: string): number {
  const na = normalizeFuzzy(a);
  const nb = normalizeFuzzy(b);
  if (!na || !nb) return 0;
  const maxLen = Math.max(na.length, nb.length);
  const dist = levenshtein(na, nb);
  let score = 1 - dist / maxLen;
  let prefix = 0;
  while (prefix < na.length && prefix < nb.length && na[prefix] === nb[prefix]) prefix++;
  score += (prefix / maxLen) * 0.1;
  return score;
}

/**
 * 相似候选推荐（L7）：同扩展名预过滤候选池后计算相似度，阈值过滤、得分降序取 top-N。
 */
export function suggestCandidates(
  brokenBase: string,
  brokenExt: string,
  entries: Iterable<AttachmentEntry>,
  opts: FuzzyOptions,
): Array<{ path: string; score: number }> {
  if (!opts.suggest || opts.topN <= 0) return [];
  const out: Array<{ path: string; score: number }> = [];
  for (const e of entries) {
    if (extOf(e.path) !== brokenExt) continue;
    const score = similarity(brokenBase, basenameOf(e.path));
    if (score >= opts.threshold) out.push({ path: e.path, score });
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, opts.topN);
}

/**
 * 规划「候选式安全断链修复」（纯计算，可测）。
 *
 * 对每条断链，取引用文件名（basename，含 URL 解码解释）到全库真实附件里找候选，按强度分层：
 * - L1 精确唯一 / L2 归一化（去空格/连字符/下划线）唯一 / L3 URL 解码命中（并入前两层候选池）
 *   → 自动修复；引用为相对路径形式时改写为正确相对路径（L4），否则改写为库内路径。
 * - L5 大小写不同但唯一 / L6 多候选 / L7 相似度推荐 → 交互候选，由用户选择确认。
 * - L8 无候选且无相似 → 保持报告，绝不乱改。
 *
 * 自动修复保持保守原则（唯一命中 + 大小写敏感），避免把链接指向错误文件。
 */
export function planBrokenLinkFixes(
  brokenRefs: readonly BrokenRef[],
  entries: Iterable<AttachmentEntry>,
  fuzzy: FuzzyOptions,
): BrokenLinkPlan {
  const entryList = Array.from(entries);
  const byExact = new Map<string, Set<string>>();
  const byNorm = new Map<string, Set<string>>();
  const byLower = new Map<string, Set<string>>();
  for (const e of entryList) {
    const base = basenameOf(e.path);
    addIndex(byExact, base, e.path);
    addIndex(byNorm, normalizeChars(base), e.path);
    addIndex(byLower, base.toLowerCase(), e.path);
  }

  const fixes = new Map<string, Map<string, string>>();
  const choices: BrokenLinkChoice[] = [];
  const skipped: BrokenRef[] = [];
  let total = 0;

  const addFix = (r: BrokenRef, to: string): void => {
    let m = fixes.get(r.sourcePath);
    if (!m) {
      m = new Map<string, string>();
      fixes.set(r.sourcePath, m);
    }
    m.set(r.linkText, to);
    total++;
  };

  for (const r of brokenRefs) {
    const rawBase = basenameOf(r.linkText);
    const decBase = basenameOf(decodePercentEncoded(r.linkText));
    const fromDir = dirOf(r.sourcePath);

    // 原始 + URL 解码两种解释都纳入各层候选池（并集去重）；
    // 无扩展名引用（如 [[pic]] 断链）补充受管扩展名组合（pic.png / pic.jpg …）参与匹配
    const baseKeys = new Set<string>([rawBase, decBase]);
    if (!extOf(r.linkText)) {
      for (const ext of MANAGED_ATTACHMENT_EXTENSIONS) {
        baseKeys.add(`${rawBase}.${ext}`);
        baseKeys.add(`${decBase}.${ext}`);
      }
    }
    const exact = new Set<string>();
    const norm = new Set<string>();
    const lower = new Set<string>();
    for (const b of baseKeys) {
      for (const p of byExact.get(b) ?? []) exact.add(p);
      for (const p of byNorm.get(normalizeChars(b)) ?? []) norm.add(p);
      for (const p of byLower.get(b.toLowerCase()) ?? []) lower.add(p);
    }

    // L1 精确唯一 → 自动
    if (exact.size === 1) {
      const to = exact.values().next().value as string;
      addFix(r, hasPathComponent(r.linkText) ? relativePath(fromDir, to) : to);
      continue;
    }
    // L2 归一化唯一（排除精确候选）→ 自动
    if (norm.size === 1) {
      const to = norm.values().next().value as string;
      addFix(r, hasPathComponent(r.linkText) ? relativePath(fromDir, to) : to);
      continue;
    }
    // L6 多候选（精确/归一化/大小写三层并集 ≥2）→ 交互
    const all = new Set<string>([...exact, ...norm, ...lower]);
    if (all.size >= 2) {
      choices.push({
        sourcePath: r.sourcePath,
        linkText: r.linkText,
        kind: r.kind,
        candidates: Array.from(all).map((p) => ({ path: p, score: 1, matchedBy: 'exact' as MatchKind })),
      });
      continue;
    }
    // L5 大小写不同但唯一 → 交互（大小写保持敏感，不自动修复）
    if (lower.size === 1) {
      choices.push({
        sourcePath: r.sourcePath,
        linkText: r.linkText,
        kind: r.kind,
        candidates: Array.from(lower).map((p) => ({ path: p, score: 1, matchedBy: 'case' as MatchKind })),
      });
      continue;
    }
    // L7 相似度推荐 → 交互
    const fuzzyCands = suggestCandidates(rawBase, extOf(r.linkText), entryList, fuzzy);
    if (fuzzyCands.length > 0) {
      choices.push({
        sourcePath: r.sourcePath,
        linkText: r.linkText,
        kind: r.kind,
        candidates: fuzzyCands.map((c) => ({ path: c.path, score: c.score, matchedBy: 'fuzzy' as MatchKind })),
      });
      continue;
    }
    // L8 保持报告
    skipped.push(r);
  }

  return { fixes, choices, skipped, total };
}

/**
 * canvas `file` 字段的改写已归位到 `core/link-resolver.ts`（`rewriteCanvasFileFields`），
 * 并由 `obsidian-domain.rewriteRefsInNote` 统一承担"按文件类型选改写器"的判断。
 *
 * 原先它住在这里，结果是"只有断链修复会改写 canvas 引用"——而「收集」把 canvas 引用的附件
 * 搬走、「全库命名」把它改名时，通用兜底改写并不处理 canvas 的 `file` 字段，
 * 于是引用悬空、附件随后被当孤儿清理删除（真实数据损失）。
 */
