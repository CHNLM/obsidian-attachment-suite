/**
 * 连接时序探针（开发期诊断）：观察 Obsidian 启动后 CDP 页面出现的时序，
 * 以及每个页面能否读出所属库的 basePath —— 用于排查"连不上 / 连错窗口 / 读不到库路径"。
 *
 * 用法：
 *   node scripts/cdp-probe.mjs                                   # 自行启动 Obsidian 并观察
 *   node scripts/cdp-probe.mjs --no-spawn                        # 只观察已运行的实例
 *   node scripts/cdp-probe.mjs --vault "D:\\path\\to\\vault"      # 指定要命中的库
 */

import { spawn, spawnSync } from 'node:child_process';
import * as path from 'node:path';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const VAULT = path.resolve(arg('vault', path.join(process.cwd(), '..', 'for-test', 'acceptance')));
const EXE = arg('obsidian', path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'obsidian', 'Obsidian.exe'));
const PORT = Number(arg('port', '9222'));
const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

const NO_SPAWN = process.argv.includes('--no-spawn');
const child = NO_SPAWN
  ? { pid: -1, exitCode: null }
  : spawn(EXE, [VAULT, `--remote-debugging-port=${PORT}`], { stdio: 'ignore' });

const probeOne = async (wsUrl) => {
  const ws = new WebSocket(wsUrl);
  try {
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws-error')), { once: true });
      setTimeout(() => rej(new Error('ws-timeout')), 5000);
    });
    const expr = `(() => {
      const a = window.app && window.app.vault && window.app.vault.adapter;
      return (a && (a.basePath || (a.getBasePath && a.getBasePath()) || '')) || '';
    })()`;
    const r = await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('eval-timeout')), 6000);
      ws.addEventListener('message', (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === 1) { clearTimeout(to); res(m.result); }
      });
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
    });
    return r?.result?.value ?? '';
  } catch (e) {
    return `ERR:${e.message}`;
  } finally {
    try { ws.close(); } catch { /* ignore */ }
  }
};

let hit = false;
for (let i = 1; i <= 70; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  let pages = [];
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    pages = (list ?? []).filter((t) => t.type === 'page');
  } catch {
    if (i % 5 === 1) console.log(`${i}s 端口未就绪  child=${child.exitCode === null ? 'alive' : 'exit' + child.exitCode}`);
    if (child.exitCode !== null) { console.log(`${i}s Obsidian 已退出（${child.exitCode}）`); break; }
    continue;
  }
  const bases = [];
  for (const p of pages) bases.push({ title: p.title, base: await probeOne(p.webSocketDebuggerUrl) });
  const match = bases.some((x) => norm(x.base) === norm(VAULT));
  console.log(`${i}s pages=${pages.length} ${JSON.stringify(bases)} match=${match} child=${child.exitCode === null ? 'alive' : 'exit' + child.exitCode}`);
  if (match) { hit = true; break; }
  if (child.exitCode !== null) { console.log(`${i}s Obsidian 已退出（${child.exitCode}）`); break; }
}

console.log(hit ? '✅ 命中验收库' : '❌ 未命中');
if (!NO_SPAWN) { try { spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* ignore */ } }
