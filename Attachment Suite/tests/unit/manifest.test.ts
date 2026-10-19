/**
 * `manifest.json` 与**发布元数据**的守卫。
 *
 * 为什么值得单独看守：这个文件最容易"手滑改坏"却没有任何测试会红——
 * 而其中两个字段一旦改动，**已装用户侧会立刻受影响**：
 *   - `id` 决定命令 id 的前缀（`attachment-suite:…`）；改了它，所有按 id 调用的
 *     脚本、快捷键绑定与提示文案里的命令名一起失效；
 *   - `name` 是插件列表里显示的名字，改了会让用户以为装了另一个插件。
 * 另外本插件的界面、README 全中文，`description` 却是英文（审计登记的 ⑤），
 * 已改为中文——这条断言把"界面语言与商店描述一致"这件事钉住。
 *
 * 还守**版本号的四处副本**（`package.json` / `package-lock.json` 两处 / `manifest.json` /
 * `versions.json` 的映射）：`version-bump.mjs` 一次写四处，但没有任何东西保证它们同步；
 * 手工改一处要等到发版时 `detect-version` 才报，属于"越晚发现越贵"的那类漂移。
 */

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const manifest = JSON.parse(
  nodeFs.readFileSync(nodePath.join(ROOT, 'manifest.json'), 'utf8'),
) as Record<string, unknown>;

describe('manifest.json：标识字段不得随手改动', () => {
  it('id 与 name 保持不变（改了会波及已装用户的命令前缀与插件身份）', () => {
    expect(manifest.id, '插件 id 变了——命令 id 前缀、快捷键绑定、脚本调用会一起失效').toBe('attachment-suite');
    expect(manifest.name, '插件显示名变了——用户会以为装的是另一个插件').toBe('Attachment Suite');
  });

  it('版本号与最低应用版本是合法的 x.y.z', () => {
    for (const key of ['version', 'minAppVersion']) {
      expect(manifest[key], `缺少字段 ${key}`).toBeTypeOf('string');
      expect(manifest[key] as string, `${key} 不是 x.y.z 形式`).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe('manifest.json：description 必须与界面语言一致', () => {
  it('是中文（界面上一切可见文字都是中文，描述没有理由是英文）', () => {
    const desc = manifest.description as string;
    expect(desc, '缺少 description').toBeTypeOf('string');
    expect(
      /[\u4e00-\u9fff]/.test(desc),
      `description 里没有中文：${desc}——插件列表里会显示成英文，与全中文界面不一致`,
    ).toBe(true);
  });
});

/** 读仓库根的 JSON（发布元数据都在根）。 */
function readRootJson(file: string): Record<string, unknown> {
  return JSON.parse(nodeFs.readFileSync(nodePath.join(ROOT, file), 'utf8')) as Record<string, unknown>;
}

describe('版本号：四处副本必须一致', () => {
  const version = manifest.version as string;

  it('package.json / package-lock.json（顶层与根包）/ manifest.json 完全一致', () => {
    const pkg = readRootJson('package.json') as { version?: unknown };
    const lock = readRootJson('package-lock.json') as {
      version?: unknown;
      packages?: Record<string, { version?: unknown }>;
    };
    // 防空转：先确认四个值都是"像版本号"的字符串，否则下面的相等断言可能退化成
    // `undefined === undefined` 而永远为真。
    const copies: Array<[string, unknown]> = [
      ['package.json', pkg.version],
      ['package-lock.json 顶层', lock.version],
      ["package-lock.json 的 packages['']", lock.packages?.['']?.version],
      ['manifest.json', version],
    ];
    for (const [label, v] of copies) {
      expect(v, `${label} 缺少 version 或不是 x.y.z——相等断言会变成空转`).toMatch(/^\d+\.\d+\.\d+$/);
    }
    for (const [label, v] of copies.slice(0, 3)) {
      expect(v, `${label} 与 manifest.json 的 ${version} 不一致——npm run version 漏跑了？`).toBe(version);
    }
  });

  it('versions.json 为当前版本登记了 minAppVersion，且与 manifest 一致', () => {
    const versions = readRootJson('versions.json') as Record<string, unknown>;
    expect(
      Object.keys(versions).length,
      'versions.json 是空的——下面这条断言会空转',
    ).toBeGreaterThan(0);
    expect(
      versions[version],
      `versions.json 缺少当前版本 ${version}：Obsidian 会查不到该版本对应的最低应用版本`,
    ).toBe(manifest.minAppVersion);
  });

  it('versions.json 的每个键都是合法版本号（手写时容易打错）', () => {
    const versions = readRootJson('versions.json') as Record<string, unknown>;
    const bad = Object.keys(versions).filter((k) => !/^\d+\.\d+\.\d+$/.test(k));
    expect(bad, `这些键不是 x.y.z：${bad.join('、')}`).toEqual([]);
  });
});
