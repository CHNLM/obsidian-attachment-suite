/**
 * 最小 CDP 求值工具（开发期诊断用）。
 *
 * 用途：对已带 `--remote-debugging-port` 的 Obsidian 渲染进程执行一段 JS，
 * 便于把"验收脚本里的某一步"单独拿出来验证（定位是插件问题还是宿主/交互问题）。
 *
 * 用法：
 *   node scripts/cdp-eval.mjs "1 + 1"
 *   node scripts/cdp-eval.mjs --port 9222 "window.app.vault.getName()"
 */

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? args[portIdx + 1] : '9222';
const expr = args.filter((a, i) => (portIdx >= 0 ? i !== portIdx && i !== portIdx + 1 : true)).join(' ');
if (!expr) {
  console.error('用法：node scripts/cdp-eval.mjs [--port 9222] "<表达式>"');
  process.exit(2);
}

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = (list ?? []).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
if (!page) {
  console.error('未找到可调试的页面');
  process.exit(3);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', () => rej(new Error('WS 连接失败')), { once: true });
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e6);
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Runtime.enable');
try {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 60000,
  });
  if (r.exceptionDetails) {
    console.error('异常：', r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    process.exit(4);
  }
  console.log(JSON.stringify(r.result?.value));
} finally {
  ws.close();
}
