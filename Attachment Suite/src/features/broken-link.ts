/** 断链修复（候选式安全重链）· 执行层。纯规划见 broken-link-core。 */

import { TFile, type App } from 'obsidian';
import type { AttachmentIndex } from '../core';
import type { PluginSettings } from '../settings';
import { createNoticer, reportFailures, reportProgress } from '../notify';
import { CandidateSelectModal, ConfirmChangesModal } from '../modals';
import { rewriteRefsInNote } from '../obsidian-domain';
import { logger } from '../logger';
import { planBrokenLinkFixes, type BrokenLinkPlan } from './broken-link-core';

export * from './broken-link-core';

export interface BrokenLinkSummary {
  fixed: number;
  skipped: number;
  errors: number;
}

/**
 * 修复断链：分层安全重链。
 * - 自动层（L1–L4）：仅当同名真实附件“唯一命中”时才改写对应引用，先弹预览确认；
 * - 交互层（L5–L7）：大小写差异 / 多候选 / 相似度推荐，弹候选选择窗由用户逐条决定；
 * - 无法处理的（L8）保持报告。
 * 支持 md/canvas 笔记的正文 + frontmatter（cover/banner/attachments）引用，以及 canvas 的 `file` 节点。
 */
export async function runFixBrokenLinks(
  app: App,
  index: AttachmentIndex,
  getSettings: () => PluginSettings,
  confirm = true,
): Promise<BrokenLinkSummary> {
  const toast = createNoticer(() => getSettings().notificationLevel);
  const cs = getSettings().consistency;
  // 一致性总开关：与本组其它命令（检查库一致性、修复不兼容路径）保持一致地拒绝执行。
  // 本函数另有一致性报告窗口内的「修复断链」按钮入口，门禁设在此处即可同时覆盖两个入口。
  if (!cs.enabled) {
    toast.summary('一致性能力已关闭。');
    return { fixed: 0, skipped: 0, errors: 0 };
  }
  const snapshot = await index.getSnapshot();
  if (snapshot.brokenRefs.length === 0) {
    toast.summary('库中没有断链，无需修复。');
    return { fixed: 0, skipped: 0, errors: 0 };
  }
  const plan = planBrokenLinkFixes(snapshot.brokenRefs, snapshot.entries.values(), {
    suggest: cs.fuzzySuggest,
    threshold: cs.fuzzyThreshold,
    topN: cs.fuzzyTopN,
  });
  if (plan.total === 0 && plan.choices.length === 0) {
    toast.summary(`库中有 ${snapshot.brokenRefs.length} 条断链，但均无候选可自动修复，保持报告。`);
    return { fixed: 0, skipped: plan.skipped.length, errors: 0 };
  }

  // 自动（L1–L4）与交互（L5–L7）结果合并后统一改写
  const merged: Map<string, Map<string, string>> = new Map(plan.fixes);

  const executeAll = async (skippedCount: number): Promise<BrokenLinkSummary> => {
    let fixed = 0;
    let errors = 0;
    let done = 0;
    const total = merged.size;
    for (const [sourcePath, map] of merged) {
      try {
        const f = app.vault.getAbstractFileByPath(sourcePath);
        if (!(f instanceof TFile)) {
          // 计数必须配一条原因：否则「断链修复失败 N 项」在控制台里没有任何线索
          logger.error(`修复断链失败：笔记不存在或不是文件 ${sourcePath}`);
          errors++;
          continue;
        }
        // 复用基础设施的"按文件类型选改写器"实现（md：链接 + frontmatter；canvas：file 字段），
        // 不再在这里自建一套分支——同一件事两份实现，早晚只改一份。
        if (!(await rewriteRefsInNote(app, sourcePath, map))) continue; // 未实际命中，跳过
        fixed += map.size;
      } catch (e) {
        logger.error(`修复断链单篇失败 ${sourcePath}: ${e instanceof Error ? e.message : String(e)}`);
        errors++;
      } finally {
        reportProgress(toast, ++done, total, '断链修复');
      }
    }
    index.markDirty();
    const skippedNote = skippedCount > 0 ? `，跳过 ${skippedCount} 条` : '';
    toast.summary(`断链修复完成：改写 ${fixed} 处，失败 ${errors}${skippedNote}。`);
    reportFailures(toast, errors, '断链修复');
    return { fixed, skipped: skippedCount, errors };
  };

  const runInteractive = (): void => {
    if (plan.choices.length === 0) {
      void executeAll(0);
      return;
    }
    new CandidateSelectModal(app, {
      title: '修复断链（选择候选）',
      desc: '以下断链无法自动唯一确定，请从候选中选择目标文件修复，或跳过保持报告。',
      choices: plan.choices,
      onDone: (chosen, skippedChoices) => {
        for (const [sourcePath, map] of chosen) {
          let target = merged.get(sourcePath);
          if (!target) {
            target = new Map<string, string>();
            merged.set(sourcePath, target);
          }
          for (const [k, v] of map) target.set(k, v);
        }
        void executeAll(skippedChoices);
      },
    }).open();
  };

  if (plan.total > 0 && confirm) {
    new ConfirmChangesModal(app, {
      title: '修复断链（候选式安全重链）',
      desc:
        plan.choices.length > 0
          ? `另有 ${plan.choices.length} 条断链需选择候选（稍后逐条处理）。`
          : '仅当同名真实附件「唯一命中」时才改写对应引用，不会指向不确定的文件；无法唯一确定的断链保持报告不处理。',
      rows: fixRows(plan),
      confirmText: `确认修复（${plan.total} 处）`,
      onConfirm: () => {
        runInteractive();
      },
    }).open();
  } else {
    runInteractive();
  }
  return { fixed: 0, skipped: plan.skipped.length, errors: 0 };
}

/** 生成确认弹窗行：显示 来源笔记(reason) → 旧引用 → 新路径。 */
function fixRows(plan: BrokenLinkPlan): Array<{ from: string; to: string; reason?: string }> {
  const rows: Array<{ from: string; to: string; reason?: string }> = [];
  for (const [sourcePath, map] of plan.fixes) {
    const noteName = displayName(sourcePath);
    for (const [from, to] of map) rows.push({ from, to, reason: noteName });
  }
  return rows;
}

/** 笔记显示名（去扩展名），供预览 reason 使用。 */
function displayName(path: string): string {
  const slash = path.lastIndexOf('/');
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}
