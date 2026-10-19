/**
 * version-bump.mjs — 对齐 Obsidian 社区发版规范：
 * 一键把 package.json / manifest.json 的版本号更新为新版本，并把该版本写入
 * versions.json（映射到其 minAppVersion）。
 *
 * 说明：直接编辑三个 JSON 文件，避免依赖 `npm version` 生命周期（它会再次触发
 * package.json 里的 `version` 脚本导致递归）。
 *
 * 用法：npm run version -- 1.1.0
 */

import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('缺少版本号参数：npm run version -- <new-version>');
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}
function writeJson(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

// 1) package.json
const pkg = readJson('package.json');
pkg.version = version;
writeJson('package.json', pkg);

// 2) package-lock.json（顶层与根包两处版本保持一致）
const pkgLock = readJson('package-lock.json');
pkgLock.version = version;
if (pkgLock.packages?.['']) {
  pkgLock.packages[''].version = version;
}
writeJson('package-lock.json', pkgLock);

// 3) manifest.json
const manifest = readJson('manifest.json');
manifest.version = version;
writeJson('manifest.json', manifest);

// 4) versions.json：新版本 → 该版本所需 minAppVersion
const versions = readJson('versions.json');
versions[version] = manifest.minAppVersion;
writeJson('versions.json', versions);

console.log(`已更新版本 ${version}（package.json / package-lock.json / manifest.json / versions.json）`);