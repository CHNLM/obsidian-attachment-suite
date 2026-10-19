/**
 * 验收 / 追踪脚本共用的**本地 HTTP 服务**——外链用例的被测目标。
 *
 * 为什么必须共用（不是"顺手抽个函数"）：
 * `obsidian-cdp-acceptance.mjs`（真实验收）与 `obsidian-cdp-trace.mjs`（逐步追踪）驱动的是
 * 同一批外链用例。追踪脚本起初**没有**起这个服务，于是每一次追踪的宿主控制台里都会出现
 * `[IAP] 下载失败：http://127.0.0.1:45999/…（net::ERR_CONNECTION_REFUSED）`——
 * 那是**诊断工具自己制造的假失败**：看日志的人会去追一个根本不存在的缺陷，
 * 而外链本地化那条链路在追踪里也根本跑不到，"是哪一步把附件写坏的"无从定位。
 *
 * 端点约定必须与 `tests/e2e/acceptance-fixture.ts` 的 `ACCEPTANCE_HTTP` 保持一致
 * （`tests/unit/acceptance-tooling.test.ts` 有守卫）：
 *
 * | 路径 | 响应 | 对应用例意图 |
 * |---|---|---|
 * | `/404.png` | 404 | 失败可见性（下载失败必须能被用户看到） |
 * | `/redirect.png` | 302 → `/img.png` | 重定向（`RequestUrlParam` 无最终 URL 可用，逐跳校验做不了） |
 * | `*.html` | `text/html` | 非媒体，不应被本地化 |
 * | `*.svg` | `image/svg+xml` | **按内容**识别类型；否则会被当 png 落盘，用例结论失真 |
 * | `*.txt` | `text/plain` | 非受管类型，应由落盘前的白名单闭合校验挡下 |
 * | `*.mp3` / `*.mp4` / `*.pdf` | 对应类型的最小合法字节 | 多媒体外链本地化 |
 * | 其余 | `image/png`，正文含**请求路径** | 便于区分不同 URL 落盘出的文件 |
 */

import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** PNG 文件头（12 字节）。也是"内容原样"基准，启动哨兵写探针附件时复用。 */
export const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

const MP3 = Buffer.from('ID3\x03\x00\x00\x00\0\0\0\0', 'binary');
const MP4 = Buffer.from('\0\0\0\x18ftypmp42\0\0\0\0', 'binary');
const PDF = Buffer.from('%PDF-1.4\n', 'ascii');

/**
 * 在 127.0.0.1:port 上启动服务，resolve 出 http.Server（调用方负责 close）。
 * 只绑回环地址：插件的默认配置会拦截内网/回环目标，故验收库需显式放开（见 `ACCEPTANCE_SETTINGS`）。
 */
export function startAcceptanceHttpServer(port) {
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0];
    if (url === '/404.png') {
      res.writeHead(404).end('not found');
      return;
    }
    if (url === '/redirect.png') {
      res.writeHead(302, { Location: '/img.png' }).end('');
      return;
    }
    if (url.endsWith('.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html><html><body>hi</body></html>');
      return;
    }
    // E17：SVG 必须按**内容**被识别（否则会被当 png 落盘，用例结论会失真）
    if (url.endsWith('.svg')) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
      return;
    }
    // E18：非受管类型（纯文本）→ 应由落盘前的白名单闭合校验挡下
    if (url.endsWith('.txt')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('just plain text, not a managed attachment');
      return;
    }
    if (url.endsWith('.mp3')) return void res.writeHead(200, { 'Content-Type': 'audio/mpeg' }).end(MP3);
    if (url.endsWith('.mp4')) return void res.writeHead(200, { 'Content-Type': 'video/mp4' }).end(MP4);
    if (url.endsWith('.pdf')) return void res.writeHead(200, { 'Content-Type': 'application/pdf' }).end(PDF);
    // 其余一律返回 PNG（内容随路径变化，便于区分不同 URL 的落盘文件）
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.concat([PNG_HEADER, Buffer.from(url, 'utf8')]));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

/**
 * 直接运行本文件即启动服务：`node scripts/lib/acceptance-http-server.mjs [port]`。
 *
 * 为什么需要这个入口：验收库里的 `externals/` 与 `notes/07-外链本地化.md` 等用例，
 * 外链**全部指向 `http://127.0.0.1:45999/`**——那是这两个 CDP 脚本临时拉起的服务。
 * 人工在验收库里手动跑「本地化」时若没有它，这些外链会成片下载失败
 * （`net::ERR_CONNECTION_REFUSED`），看起来像插件坏了，其实是缺被测目标。
 */
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const port = Number(process.argv[2] ?? 45999);
  startAcceptanceHttpServer(port)
    .then(() => console.log(`[acceptance-http] 本地服务已启动 http://127.0.0.1:${port}（Ctrl+C 结束）`))
    .catch((e) => {
      console.error(`[acceptance-http] 启动失败：${e?.code ?? e?.message}`);
      process.exit(1);
    });
}
