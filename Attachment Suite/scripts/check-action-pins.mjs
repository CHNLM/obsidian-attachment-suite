#!/usr/bin/env node
/**
 * check-action-pins.mjs — 核对工作流里钉扎的 action 有没有新版本。
 *
 * 为什么需要它：本仓库不使用 Dependabot（`.github/dependabot.yml` 与自动合并工作流都已移除），
 * 而工作流里的 `uses:` 又全部固定到 40 位 commit SHA（为了可复现性）。**钉 SHA 的代价就是
 * 失去了升级通道**——上游发了新版本，这里不会有任何提示。README「依赖更新」里写着
 * "需要定期手动核对各 action 的新版本，并改 SHA 与行尾注释"，这个脚本就是把那句话变成一条命令，
 * 免得"定期"最终等于"永远不"。
 *
 * 用法：npm run check:actions
 *   退出码 0 = 全部是最新且行尾注释正确
 *   退出码 1 = 有 action 落后、或行尾注释与钉扎版本对不上（输出里给出可直接替换的行）
 *   退出码 2 = 没法联网核对（与"发现问题"区分开，免得离线时误判成需要升级）
 *
 * 只读 GitHub 公开 API：5 个 action 共 10 次请求，未认证也够用（60 次/小时）。
 * 若频繁运行触到限流，设 `GITHUB_TOKEN`（只读令牌即可）。
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ghDir = join(repoRoot, '.github');
if (!existsSync(join(ghDir, 'workflows'))) {
  console.error(`找不到 ${join(ghDir, 'workflows')}——本脚本假定自己位于 <仓库根>/Attachment Suite/scripts/ 下`);
  process.exit(2);
}

/** 收集所有 `uses: owner/repo@<40位SHA> # vX.Y.Z` 用法（本地 `./...` 引用跳过）。 */
function collectPins() {
  const files = readdirSync(join(ghDir, 'workflows'))
    .filter((f) => f.endsWith('.yml'))
    .map((f) => join(ghDir, 'workflows', f));
  const actionsDir = join(ghDir, 'actions');
  if (existsSync(actionsDir)) {
    for (const d of readdirSync(actionsDir)) {
      const p = join(actionsDir, d, 'action.yml');
      if (existsSync(p)) files.push(p);
    }
  }

  const pins = [];
  const re = /^\s*(?:-\s*)?uses:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([0-9a-f]{40})\s*(?:#\s*(\S+))?\s*$/;
  for (const file of files) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const m = re.exec(line);
        if (!m) return;
        pins.push({
          file: file.slice(repoRoot.length + 1).replace(/\\/g, '/'),
          line: i + 1,
          repo: m[1],
          sha: m[2],
          comment: m[3] ?? '',
        });
      });
  }
  return pins;
}

async function api(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'check-action-pins' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json();
}

const pins = collectPins();
if (pins.length === 0) {
  console.log('没有找到任何 `uses: owner/repo@<sha>` 钉扎——本脚本的解析规则可能要跟着工作流改。');
  process.exit(2);
}

console.log(`发现 ${pins.length} 处 action 钉扎，逐个核对上游最新稳定版：\n`);

const latest = new Map();
let problems = 0;

for (const pin of pins) {
  let info = latest.get(pin.repo);
  if (!info) {
    try {
      const rel = await api(`/repos/${pin.repo}/releases/latest`);
      const sha = (await api(`/repos/${pin.repo}/commits/${rel.tag_name}`)).sha;
      info = { tag: rel.tag_name, sha, published: (rel.published_at ?? '').slice(0, 10) };
    } catch (err) {
      console.error(`无法核对 ${pin.repo}：${err.message}`);
      console.error('  网络不可用或触到 API 限流（设 GITHUB_TOKEN 可提高上限）——本次结论不成立。');
      process.exit(2);
    }
    latest.set(pin.repo, info);
  }

  const upToDate = info.sha === pin.sha;
  const commentOk = pin.comment === info.tag;
  const label = upToDate && commentOk ? '最新' : '需处理';
  console.log(`- ${pin.repo}  ${pin.file}:${pin.line}`);
  console.log(`    钉扎 ${pin.sha.slice(0, 12)}… ${pin.comment || '(缺行尾版本注释)'}`);
  console.log(`    上游 ${info.sha.slice(0, 12)}… ${info.tag}（${info.published}）→ ${label}`);

  if (!upToDate || !commentOk) {
    problems += 1;
    console.log(`    改为：uses: ${pin.repo}@${info.sha} # ${info.tag}`);
  }
  console.log();
}

if (problems > 0) {
  console.log(`有 ${problems} 处需要处理。改完请跑一次 npm run typecheck && npm test，`);
  console.log('并记住：发布链路只有发版时才会真正跑到这些 action，升级后建议先手动 dispatch 一次 Verify。');
  process.exit(1);
}
console.log('全部是最新稳定版，行尾注释与钉扎版本一致。');
