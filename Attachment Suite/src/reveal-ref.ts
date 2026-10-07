/** 在笔记中定位某个引用（报告/预览弹窗里的可点击项共用）。 */

import { MarkdownView, TFile, type App } from 'obsidian';
import { logger } from './logger';

/**
 * 打开指定笔记并滚动到包含 `linkText` 的引用附近，便于用户就地查看/手工处理。
 *
 * 最佳努力语义：任一步失败（笔记不存在、非 Markdown 视图、文本中找不到该引用）
 * 都**不打断**调用方的弹窗或流程，也不弹提示（用户只是点了一下条目，不该被弹窗轰炸）。
 *
 * 但**必须逐条留痕**：条目点下去没反应时，"为什么没跳"要能在控制台里答得出来
 * （诊断日志档下可见）。从前这些分支是彻底静默的，于是报告里点击无反应时
 * 既没有提示也没有日志——与"提示承诺了去向、那条路径却没内容"是同一个缺陷形态。
 *
 * @param app Obsidian App。
 * @param sourcePath 引用所在笔记的库内路径。
 * @param linkText 引用的原文（用于在笔记文本中定位）。
 */
export async function revealRefInNote(app: App, sourcePath: string, linkText: string): Promise<void> {
  const why = (reason: string): void => logger.debug(`定位引用未生效（${reason}）：${sourcePath} ← ${linkText}`);
  try {
    const f = app.vault.getAbstractFileByPath(sourcePath);
    if (!(f instanceof TFile)) return why('笔记不存在或不是文件');
    const leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(f);
    if (!(leaf.view instanceof MarkdownView)) return why('打开后不是 Markdown 视图');
    const ed = leaf.view.editor;
    const text = ed.getValue();
    const idx = text.indexOf(linkText);
    if (idx < 0) return why('笔记文本里已找不到该引用（可能已被改写或手工编辑）');
    const pos = ed.offsetToPos(idx);
    ed.setCursor({ line: pos.line, ch: 0 });
    ed.scrollIntoView({ from: { line: pos.line, ch: 0 }, to: { line: pos.line, ch: 0 } }, true);
  } catch (e) {
    why(`打开/定位抛错：${e instanceof Error ? e.message : String(e)}`);
  }
}
