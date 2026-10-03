/** 媒体本地化：下载 / 分类 / 去重 / 写盘 / 改写。桌面优先。 */

import { TFile, requestUrl, type App } from 'obsidian';
import { classify, isManagedAttachment, isPathExcluded } from '../core';
import type { AttachmentIndex } from '../core';
import type { PluginSettings } from '../settings';
import { resolveAttachmentDirForNote, ensureFolder } from '../obsidian-domain';
import { logger } from '../logger';
import { createNoticer, reportFailures } from '../notify';
import {
  applyRefReplacements,
  bytesMd5,
  decodeDataUri,
  estimateDataUriBytes,
  evaluateHostPolicy,
  findExternalRefs,
  hostOf,
  HostRateLimiter,
  localName,
  type ExternalRef,
  type HostPolicy,
  type MediaDownloader,
  type ScanStats,
} from './localize-media-core';

export * from './localize-media-core';

/** 单文件下载上限的兜底值（MB）；实际以设置 maxDownloadMb 为准。 */
const DEFAULT_MAX_DOWNLOAD_MB = 100;

/** 由设置构造域名策略（供本地化与全库本地化共用，保证预览数与实际行为一致）。 */
export function hostPolicyOf(localize: PluginSettings['localize']): HostPolicy {
  return {
    allowHosts: localize.allowHosts ?? [],
    denyHosts: localize.denyHosts ?? [],
    allowlistOnly: localize.hostAllowlistOnly === true,
    blockPrivateHosts: localize.blockPrivateHosts !== false,
  };
}

/** fetch 实现的下载器（桌面 Electron 环境）。 */
export class ObsidianDownloader implements MediaDownloader {
  /** 同主机限速状态跨调用共享（本下载器为插件级单例），故全库本地化也能持续限速。 */
  private readonly limiter = new HostRateLimiter();

  constructor(
    private readonly getSettings: () => PluginSettings,
  ) {}

  async download(url: string): Promise<Uint8Array | null> {
    const { timeoutMs, tryCount, minSizeKb, maxDownloadMb, perHostIntervalMs } = this.getSettings().localize;
    // 限速：同一主机的连续下载之间保持最小间隔（data: 无主机名，天然跳过）
    await this.limiter.wait(hostOf(url), perHostIntervalMs ?? 0);
    const maxBytes = Math.max(1, maxDownloadMb || DEFAULT_MAX_DOWNLOAD_MB) * 1024 * 1024;
    const minBytes = Math.max(0, minSizeKb) * 1024;
    let last: unknown;
    for (let i = 0; i < Math.max(1, tryCount); i++) {
      try {
        if (url.startsWith('data:')) {
          // 解码前预判（base64 可精确预估）：避免为超大载荷产生 atob 中间副本。
          // 预判不出（非 base64）时返回 null，由解码后的 maxBytes 校验兜底。
          const estimated = estimateDataUriBytes(url);
          if (estimated !== null && estimated > maxBytes) {
            logger.warn(`跳过超限 data URI（预估 ${estimated} > ${maxBytes} 字节）`);
            return null;
          }
          const data = decodeDataUri(url);
          if (data === null) return null;
          if (data.byteLength < minBytes) return null;
          if (data.byteLength > maxBytes) return null;
          return data;
        }
        // 下载前限制：先以 HEAD 探明响应声明的体积，超过上限即中止，
        // 避免把超大响应整体读入内存后才发现超限（原实现属「事后校验」）。
        const declared = await probeContentLength(url, timeoutMs);
        if (declared !== null && declared > maxBytes) {
          logger.warn(`跳过超限下载（Content-Length ${declared} > ${maxBytes}）：${url}`);
          return null;
        }
        const data = await fetchHttp(url, timeoutMs);
        if (data === null) return null;
        if (data.byteLength < minBytes) return null;
        if (data.byteLength > maxBytes) return null;
        return data;
      } catch (e) {
        last = e;
      }
    }
    logger.warn(`下载失败：${url}（${last instanceof Error ? last.message : String(last)}）`);
    return null;
  }
}

/** 从响应头读某个字段（兼容 Obsidian 的普通对象与测试环境的 Headers 对象）。 */
function headerValue(headers: unknown, name: string): string | null {
  if (!headers) return null;
  const h = headers as { get?: (k: string) => string | null | undefined } & Record<string, unknown>;
  if (typeof h.get === 'function') {
    const v = h.get(name);
    if (typeof v === 'string') return v;
  }
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(h)) {
    if (k.toLowerCase() === lower && typeof v === 'string') return v;
  }
  return null;
}

/**
 * 以 HEAD 预探响应声明的 Content-Length（供下载前体积限制）。
 * 返回声明的字节数；服务器不支持 HEAD、非 2xx 或未声明长度时返回 null（表示无法预判，继续走 GET）。
 */
async function probeContentLength(url: string, timeoutMs: number): Promise<number | null> {
  try {
    const res = await Promise.race([
      requestUrl({ url, method: 'HEAD', throw: false }),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!res || res.status < 200 || res.status >= 300) return null;
    const raw = headerValue(res.headers, 'content-length');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

async function fetchHttp(url: string, timeoutMs: number): Promise<Uint8Array | null> {
  // 用 Obsidian 的 requestUrl（走主进程、不受浏览器 CORS 限制），不能直接用原生 fetch：
  // 渲染进程的 fetch 会被目标站的 CORS 策略拦截（如 app://obsidian.md 无跨域头时）。
  //
  // 已知局限：requestUrl 的参数不支持 AbortController，也不支持禁用/观测重定向；
  // 因此①超时仅让上层提前放弃，底层连接可能残留；②只能校验初始 URL 的主机，无法逐跳校验跳转目标。
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
  /** 因指向内网/本机/保留地址而被拦截的引用数（未发起请求）。 */
  blockedPrivate: number;
  /** 因域名名单（黑名单命中 / 未命中白名单）而被拦截的引用数。 */
  blockedByPolicy: number;
  /** 因被识别为网页文档（HTML）而被跳过、未落存的引用数。 */
  skippedWebpage: number;
  /** 因内容类型不属于受管附件白名单（如纯文本）而被跳过、未落存的引用数。 */
  skippedUnmanaged: number;
}

/**
 * 有界并发执行器：最多 `limit` 个任务同时在跑；顺序保留在每个 worker 内部。
 * limit === 1 时即为严格串行，行为与顺序调用完全一致。
 */
async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let cursor = 0;
  const lanes = Array.from({ length: width }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      await worker(items[i]);
    }
  });
  await Promise.all(lanes);
}

/** 按 URL 去重（同一 URL 在笔记里出现多次时只下载一次）。 */
function uniqueByUrl(refs: readonly ExternalRef[]): ExternalRef[] {
  const seen = new Set<string>();
  const out: ExternalRef[] = [];
  for (const r of refs) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out;
}

/**
 * 本地化指定笔记正文中的外部媒体引用。
 * @param notePath 显式指定要处理的笔记路径（用于自动化后台处理，不依赖“当前活动笔记”）。
 *                 省略时回退到当前打开的笔记（手动命令场景）。
 * @param notify 是否由本函数自身发提示；批量与自动化路径传 false，改由上层汇总。
 *
 * 正文一律从**磁盘**读取（`app.vault.read`）：粘贴/编辑触发只负责把该笔记标脏，
 * 真正的处理在轮询里按路径读盘执行——读的是已落盘内容，不读编辑器缓冲区。
 */
export async function runLocalizeNote(
  app: App,
  index: AttachmentIndex,
  getSettings: () => PluginSettings,
  downloader: MediaDownloader,
  notePath?: string,
  notify = true,
): Promise<RunSummary> {
  const toast = createNoticer(() => getSettings().notificationLevel);
  const note = notePath
    ? (app.vault.getAbstractFileByPath(notePath) as TFile | null)
    : (app.workspace.getActiveFile() as TFile | null);
  if (!note || !(note instanceof TFile)) {
    if (notify) toast.error('请先打开一个笔记。');
    return emptySummary();
  }
  const localize = getSettings().localize;
  if (!localize.enabled) {
    if (notify) toast.summary('本地化能力已关闭。');
    return emptySummary();
  }
  // 排除目录内的笔记不做本地化
  if (isPathExcluded(note.path, getSettings().paths?.exclude ?? [])) {
    if (notify) toast.summary('该笔记位于排除目录，已跳过本地化。');
    return emptySummary();
  }

  const text = await app.vault.read(note);
  const scanStats: ScanStats = { ambiguousSkipped: 0 };
  const allRefs = findExternalRefs(text, localize.scanHtmlAndLinks, scanStats);
  // 关闭“本地化网络 URL”时仅处理内嵌 data 图片，不发起任何网络请求
  const candidates = localize.localizeWebUrls ? allRefs : allRefs.filter((r) => r.kind === 'data');
  // 域名策略：黑名单 > 白名单 > 内网拦截 > 仅白名单模式（判定顺序见 evaluateHostPolicy）。
  // 仅作用于 http 引用（data: 无主机名、只在本地解码）。
  const policy = hostPolicyOf(localize);
  const refs: ExternalRef[] = [];
  let blockedPrivate = 0;
  let blockedByPolicy = 0;
  for (const r of candidates) {
    // data: 等无主机名的引用在策略内恒为放行，故此处统一走策略判定即可
    const verdict = evaluateHostPolicy(r.url, policy);
    if (!verdict.allowed) {
      if (verdict.reason === 'private-host') {
        blockedPrivate++;
        logger.warn(`拦截内网/本机地址：${r.url}`);
      } else {
        blockedByPolicy++;
        logger.warn(`按域名名单拦截（${verdict.reason}）：${r.url}`);
      }
      continue;
    }
    refs.push(r);
  }
  const blockedTotal = blockedPrivate + blockedByPolicy;
  if (refs.length === 0) {
    if (notify) {
      if (blockedTotal > 0) {
        toast.summary(`已拦截 ${blockedTotal} 处外链${describeBlocks(blockedPrivate, blockedByPolicy)}，未发起请求。`);
      } else if (!localize.localizeWebUrls && allRefs.length > 0) {
        toast.summary('已关闭网络 URL 本地化，当前只有外链需要处理。');
      } else {
        toast.summary('当前笔记没有可本地化的外部引用。');
      }
    }
    return {
      downloaded: 0,
      skipped: 0,
      errors: 0,
      found: refs.length,
      blockedPrivate,
      blockedByPolicy,
      skippedWebpage: 0,
      skippedUnmanaged: 0,
    };
  }

  const dir = resolveAttachmentDirForNote(app, getSettings(), note);
  await ensureFolder(app, dir);
  // App 类型未暴露 getConfig，这里对已知键做白名单读取
  const vaultCfg = app.vault as unknown as { getConfig?: (k: string) => unknown };
  const useMarkdown = vaultCfg.getConfig?.('useMarkdownLinks') === true;

  const map = new Map<string, string>();
  let downloaded = 0;
  let skipped = 0;
  let errors = 0;
  let skippedWebpage = 0;
  let skippedUnmanaged = 0;

  // 同一 URL 在正文出现多次时只下载一次（顺带避免并发下对同一落盘路径的写竞争）
  const work = uniqueByUrl(refs);
  await runPool(work, localize.maxConcurrent ?? 1, async (ref) => {
    const data = await downloader.download(ref.url);
    if (data === null) {
      skipped++;
      return;
    }
    const result = classify(data);
    // 网页（HTML）永不落存：避免把网页脚本存进库（存储型风险）。与 SVG 同属「格式层面不允许」，
    // 故不提供开关；显式计数以便在摘要中如实报告（避免静默丢弃被误认为 bug）。
    if (result.category === 'webpage') {
      skippedWebpage++;
      logger.warn(`跳过网页文档（不落存 HTML）：${ref.url}`);
      return;
    }
    if (result.isSvg || !localize.allowedCategories.includes(result.category)) {
      skipped++;
      return;
    }
    // 白名单闭合：只落盘「受管附件」类型。classify 依据内容给出真实扩展名，而索引/命名/收集/
    // 导出/清理统一按受管扩展名白名单工作；若放行白名单外的类型（如纯文本 .txt），会落下一个
    // "谁都不管"的悬空文件（M6）。此处跳过并单独计数，保证"能落盘的都有人管"。
    if (!isManagedAttachment(result.ext)) {
      skippedUnmanaged++;
      logger.warn(`跳过非受管附件类型（.${result.ext}）不落盘：${ref.url}`);
      return;
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
      // 并发下若同名内容正由另一路径写入（内容相同的不同 URL → 同一 MD5 文件名），
      // 目标此刻已存在即视为成功，避免把「已落盘」误判为失败而留下坏引用。
      if (await app.vault.adapter.exists(relPath)) {
        map.set(ref.url, relPath);
        downloaded++;
      } else {
        // 写盘失败属"失败"而非"按规则跳过"：计入 errors，不再混入 skipped
        logger.error(`写盘失败 ${relPath}: ${e instanceof Error ? e.message : String(e)}`);
        errors++;
      }
    }
  });

  const blockedNote = blockedTotal > 0 ? `，拦截 ${blockedTotal}${describeBlocks(blockedPrivate, blockedByPolicy)}` : '';
  const webpageNote = skippedWebpage > 0 ? `，网页不落存 ${skippedWebpage}` : '';
  const unmanagedNote = skippedUnmanaged > 0 ? `，非受管类型跳过 ${skippedUnmanaged}` : '';
  // 目标含未转义的括号时**主动跳过**（改写会产出坏链接）——如实报出，别让用户以为是漏下了
  const ambiguousNote = scanStats.ambiguousSkipped > 0
    ? `，目标含括号跳过 ${scanStats.ambiguousSkipped}（请改用 <…> 包裹目标）`
    : '';
  const errorNote = errors > 0 ? `，失败 ${errors}` : '';
  if (map.size === 0) {
    if (notify) {
      toast.summary(
        `本地化完成：无成功项（下载 ${downloaded}，跳过 ${skipped}${blockedNote}${webpageNote}${unmanagedNote}${ambiguousNote}${errorNote}）。`,
      );
      reportFailures(toast, errors, '本地化');
    }
    return { downloaded: 0, skipped, errors, found: refs.length, blockedPrivate, blockedByPolicy, skippedWebpage, skippedUnmanaged };
  }

  const newText = applyRefReplacements(text, refs, map, useMarkdown ? 'markdown' : 'wiki');
  if (newText !== text) {
    try {
      await app.vault.modify(note, newText);
    } catch (e) {
      // 附件已落盘但笔记未改写：如实报错并计入 failures（不回滚已写文件——它可能已被其它
      // 引用使用；落单的文件会在后续「清理未用附件」中被识别为未引用，不会造成数据损失）。
      errors++;
      logger.error(`改写笔记失败 ${note.path}: ${e instanceof Error ? e.message : String(e)}`);
      if (notify) toast.error('附件已下载，但改写笔记失败：引用可能仍指向外链，请重试。');
    }
  }
  index.markDirty();
  if (notify) {
    toast.summary(`本地化完成：下载 ${downloaded}，跳过 ${skipped}${blockedNote}${webpageNote}${unmanagedNote}${ambiguousNote}${errorNote}。`);
    reportFailures(toast, errors, '本地化');
  }
  return { downloaded, skipped, errors, found: refs.length, blockedPrivate, blockedByPolicy, skippedWebpage, skippedUnmanaged };
}

/** 全零摘要（各早退分支共用）。 */
function emptySummary(): RunSummary {
  return {
    downloaded: 0,
    skipped: 0,
    errors: 0,
    found: 0,
    blockedPrivate: 0,
    blockedByPolicy: 0,
    skippedWebpage: 0,
    skippedUnmanaged: 0,
  };
}

/** 把拦截数拼成简短括注，如「（内网 2 · 名单 1）」。两者皆为 0 时返回空串。 */
function describeBlocks(blockedPrivate: number, blockedByPolicy: number): string {
  const parts: string[] = [];
  if (blockedPrivate > 0) parts.push(`内网 ${blockedPrivate}`);
  if (blockedByPolicy > 0) parts.push(`名单 ${blockedByPolicy}`);
  return parts.length > 0 ? `（${parts.join(' · ')}）` : '';
}