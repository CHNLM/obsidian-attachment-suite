/** 媒体本地化：下载 / 分类 / 去重 / 写盘 / 改写。桌面优先。 */

import { TFile, requestUrl, type App } from 'obsidian';
import { classify, isPathExcluded } from '../core';
import type { AttachmentIndex } from '../core';
import type { PluginSettings } from '../settings';
import { resolveAttachmentDirForNote, ensureFolder } from '../obsidian-domain';
import { logger } from '../logger';
import { createNoticer } from '../notify';
import {
  applyRefReplacements,
  bytesMd5,
  decodeDataUri,
  findExternalRefs,
  localName,
  type MediaDownloader,
} from './localize-media-core';

export * from './localize-media-core';

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100MB 单文件上限

/** fetch 实现的下载器（桌面 Electron 环境）。 */
export class ObsidianDownloader implements MediaDownloader {
  constructor(
    private readonly getSettings: () => PluginSettings,
  ) {}

  async download(url: string): Promise<Uint8Array | null> {
    const { timeoutMs, tryCount, minSizeKb } = this.getSettings().localize;
    let last: unknown;
    for (let i = 0; i < Math.max(1, tryCount); i++) {
      try {
        const data = url.startsWith('data:')
          ? decodeDataUri(url)
          : await fetchHttp(url, timeoutMs);
        if (data === null) return null;
        if (data.byteLength < minSizeKb * 1024) return null;
        if (data.byteLength > MAX_DOWNLOAD_BYTES) return null;
        return data;
      } catch (e) {
        last = e;
      }
    }
    logger.warn(`下载失败：${url}（${last instanceof Error ? last.message : String(last)}）`);
    return null;
  }
}

async function fetchHttp(url: string, timeoutMs: number): Promise<Uint8Array | null> {
  // 用 Obsidian 的 requestUrl（走主进程、不受浏览器 CORS 限制），不能直接用原生 fetch：
  // 渲染进程的 fetch 会被目标站的 CORS 策略拦截（如 app://obsidian.md 无跨域头时）。
  const res = await Promise.race([
    requestUrl({ url, method: 'GET', throw: false }),
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
  ]);
  if (!res) return null;
  if (res.status < 200 || res.status >= 300) return null;
  const ab = res.arrayBuffer;
  if (!ab || ab.byteLength === 0) return null;
  return new Uint8Array(ab);
}

export interface RunSummary {
  downloaded: number;
  skipped: number;
  errors: number;
  /** 本次扫描检测到的外部引用总数（供自动化判断“有外链但全部失败”）。 */
  found: number;
}

/**
 * 本地化指定笔记正文中的外部媒体引用。
 * @param notePath 显式指定要处理的笔记路径（用于自动化后台处理，不依赖“当前活动笔记”）。
 *                 省略时回退到当前打开的笔记（手动命令场景）。
 * @param overrideText 直接用给的文本扫描（粘贴触发时读编辑器实时内容，避免磁盘旧文件）。
 */
export async function runLocalizeNote(
  app: App,
  index: AttachmentIndex,
  getSettings: () => PluginSettings,
  downloader: MediaDownloader,
  notePath?: string,
  overrideText?: string,
  notify = true,
): Promise<RunSummary> {
  const toast = createNoticer(() => getSettings().notificationLevel);
  const note = notePath
    ? (app.vault.getAbstractFileByPath(notePath) as TFile | null)
    : (app.workspace.getActiveFile() as TFile | null);
  if (!note || !(note instanceof TFile)) {
    if (notify) toast.error('请先打开一个笔记。');
    return { downloaded: 0, skipped: 0, errors: 0, found: 0 };
  }
  const localize = getSettings().localize;
  if (!localize.enabled) {
    if (notify) toast.summary('本地化能力已关闭。');
    return { downloaded: 0, skipped: 0, errors: 0, found: 0 };
  }
  // 排除目录内的笔记不做本地化
  if (isPathExcluded(note.path, getSettings().paths?.exclude ?? [])) {
    if (notify) toast.summary('该笔记位于排除目录，已跳过本地化。');
    return { downloaded: 0, skipped: 0, errors: 0, found: 0 };
  }

  const text = overrideText !== undefined ? overrideText : await app.vault.read(note);
  const allRefs = findExternalRefs(text, localize.scanHtmlAndLinks);
  // 关闭“本地化网络 URL”时仅处理内嵌 data 图片，不发起任何网络请求
  const refs = localize.localizeWebUrls ? allRefs : allRefs.filter((r) => r.kind === 'data');
  if (refs.length === 0) {
    if (notify) {
      if (!localize.localizeWebUrls && allRefs.length > 0) {
        toast.summary('已关闭网络 URL 本地化，当前只有外链需要处理。');
      } else {
        toast.summary('当前笔记没有可本地化的外部引用。');
      }
    }
    return { downloaded: 0, skipped: 0, errors: 0, found: refs.length };
  }

  const dir = resolveAttachmentDirForNote(app, getSettings(), note);
  await ensureFolder(app, dir);
  // App 类型未暴露 getConfig，这里对已知键做白名单读取
  const vaultCfg = app.vault as unknown as { getConfig?: (k: string) => unknown };
  const useMarkdown = vaultCfg.getConfig?.('useMarkdownLinks') === true;

  const map = new Map<string, string>();
  let downloaded = 0;
  let skipped = 0;
  for (const ref of refs) {
    const data = await downloader.download(ref.url);
    if (data === null) {
      skipped++;
      continue;
    }
    const result = classify(data);
    if (result.isSvg || !localize.allowedCategories.includes(result.category)) {
      skipped++;
      continue;
    }
    const md5 = bytesMd5(data);
    const name = localName(md5, ref.nameHint, localize.useMd5ForNew, result.ext);
    const relPath = dir ? `${dir}/${name}` : name;

    try {
      if (!(await app.vault.adapter.exists(relPath))) {
        await app.vault.createBinary(relPath, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      }
      map.set(ref.url, relPath);
      downloaded++;
    } catch (e) {
      logger.error(`写盘失败 ${relPath}: ${e instanceof Error ? e.message : String(e)}`);
      skipped++;
    }
  }

  if (map.size === 0) {
    if (notify) toast.summary(`本地化完成：无成功项（下载 ${downloaded}，跳过 ${skipped}）。`);
    return { downloaded: 0, skipped, errors: 0, found: refs.length };
  }

  const newText = applyRefReplacements(text, refs, map, useMarkdown ? 'markdown' : 'wiki');
  if (newText !== text) {
    await app.vault.modify(note, newText);
  }
  index.markDirty();
  if (notify) toast.summary(`本地化完成：下载 ${downloaded}，跳过 ${skipped}。`);
  return { downloaded, skipped, errors: 0, found: refs.length };
}