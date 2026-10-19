/**
 * 验收库生成器（三阶段A）：把 `acceptance-fixture.ts` 的用例清单落成**真实文件**
 * 到 `for-test/acceptance/`，供真实 Obsidian 人工/自动验收使用。
 *
 * 运行：`npx vitest run tests/e2e/seed-acceptance.test.ts`
 *
 * 安全设计：
 * - 只写 `for-test/acceptance/` 下的内容与 `.obsidian` 配置；
 * - **不动** `.obsidian/plugins/attachment-suite/` 里已投放的插件，也不动仓库根 `docs/` 下的归档文档；
 * - 幂等：可反复运行，等于"把验收库恢复到干净初始态"（这是破坏性验收的可回滚保证）。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  ACCEPTANCE_CASES,
  ACCEPTANCE_HTTP,
  ACCEPTANCE_SETTINGS,
  expectedDoc,
  seedAcceptanceVault,
  writeFile,
} from './acceptance-fixture';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const VAULT = path.resolve(REPO_ROOT, 'for-test/acceptance');
/**
 * `for-test/` 是被 gitignore 的**本地产物目录**（见仓库根 `.gitignore`）——
 * 干净检出（CI）里并不存在，所以不能被当作前置条件（见下方用例里的说明）。
 */
const FOR_TEST_DIR = path.dirname(VAULT);


/** 清空上一轮验收产生的库内容（保留 .obsidian/plugins 内已投放的插件）。 */
const CONTENT_DIRS = [
  'notes',
  'assets',
  'externals',
  'orphans',
  'excluded',
  'empty',
  'deep',
  '中文目录',
  'canvas',
  'path-cases',
  '.trash',
];

function resetContent(): void {
  for (const d of CONTENT_DIRS) {
    fs.rmSync(path.join(VAULT, d), { recursive: true, force: true });
  }
  for (const f of fs.readdirSync(VAULT)) {
    const p = path.join(VAULT, f);
    if (fs.statSync(p).isFile()) fs.rmSync(p, { force: true });
  }
}

describe('验收库生成器', () => {
  it('把用例清单落成 for-test/acceptance 真实文件与配置（幂等）', () => {
    // 原先这里断言「for-test 目录应存在」。但它是**被 gitignore 的产物目录**，
    // 在 CI 的干净检出里必然不存在——于是这条用例在 CI 里恒定失败
    // （2026-10-02 校验工作流首次真跑时暴露；本文件与 tests/README 都把这条命令
    // 描述为"可重建验收库"，那就应当能从零建起来）。
    // 保留原断言真正想守住的东西：**先确认路径没写错**——否则 mkdir 会在错误位置
    // 凭空造出目录。用受版本控制的锚点确认仓库根，再按需创建产物目录。
    expect(fs.existsSync(path.join(REPO_ROOT, '.gitignore')), '仓库根定位错误：相对层级变了？').toBe(true);
    fs.mkdirSync(FOR_TEST_DIR, { recursive: true });

    fs.mkdirSync(path.join(VAULT, '.obsidian', 'plugins', 'attachment-suite'), { recursive: true });
    resetContent();

    seedAcceptanceVault(VAULT, ACCEPTANCE_HTTP);

    // 配置：插件安装位、启用列表、库设置
    writeFile(VAULT, '.obsidian/community-plugins.json', JSON.stringify(['attachment-suite'], null, 2));
    writeFile(
      VAULT,
      '.obsidian/app.json',
      JSON.stringify(
        {
          attachmentFolderPath: './assets',
          useMarkdownLinks: false,
          newFileLocation: 'root',
          // 对应 Obsidian「设置 → 文件与链接 → 自动更新内部链接」。**默认是关闭的**，
          // 关闭时每次通过 fileManager 改名都会弹原生「更新链接？」对话框（总是更新/仅此一次/不做更新），
          // 批量改名会被这个弹窗打断；验收库显式打开，避免把 UX 弹窗混进功能验收。
          // （该弹窗在测试替身里不存在，是"只有真实 Obsidian 才有"的差异，见 review-phase3.md §4。）
          alwaysUpdateLinks: true,
        },
        null,
        2,
      ),
    );
    writeFile(VAULT, '.obsidian/plugins/attachment-suite/data.json', JSON.stringify(ACCEPTANCE_SETTINGS, null, 2));

    // 预期清单（人工/脚本共用）
    writeFile(VAULT, 'EXPECTED.md', expectedDoc());

    // 若已有构建产物，顺手投放（不构建、不报错）
    const dist = path.resolve(__dirname, '../../dist/attachment-suite');
    let installed = false;
    if (fs.existsSync(dist)) {
      for (const f of ['main.js', 'manifest.json', 'styles.css']) {
        const src = path.join(dist, f);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(VAULT, '.obsidian', 'plugins', 'attachment-suite', f));
          installed = true;
        }
      }
    }

    // 抽查：清单里的关键载体确实存在
    expect(fs.existsSync(path.join(VAULT, 'notes/01-正文图片.md'))).toBe(true);
    expect(fs.existsSync(path.join(VAULT, 'assets/shared/shared.png'))).toBe(true);
    expect(fs.existsSync(path.join(VAULT, 'canvas/画布用例.canvas'))).toBe(true);
    expect(fs.existsSync(path.join(VAULT, 'empty/leaf'))).toBe(true);
    expect(fs.existsSync(path.join(VAULT, 'EXPECTED.md'))).toBe(true);

    console.log(
      `[acceptance] 用例 ${ACCEPTANCE_CASES.length} 条 · 生成于 ${VAULT} · 插件已投放：${installed ? '是' : '否（先 npm run build）'}`,
    );
  }, 60000);

  /**
   * 守卫：用例清单里每个路径分量都必须在**三平台通用**的文件名上限内。
   *
   * 为什么需要它：N16 原先用 90 个汉字（273 字节），在 Windows 上建得出来、在 Linux 上
   * 一律 `ENAMETOOLONG`——"只在某个平台成立"的假设只在 ubuntu 才炸。这属于**最容易漏的
   * 那类约束**：在注释里写"别调大"没用，人不会记得回来读它。
   * 上限取 **255 字节**（多数 POSIX 文件系统的单名上限；NTFS 按 UTF-16 单元计，更宽），
   * 与 `src/core/path-compatibility.ts` 用的是同一个口径。
   */
  it('用例清单里的路径分量都不超过 255 字节（UTF-8）', () => {
    const LIMIT = 255;
    const overLimit = (rel: string): string[] =>
      rel.split('/').filter((seg) => Buffer.byteLength(seg, 'utf8') > LIMIT);

    const bad = ACCEPTANCE_CASES.flatMap((c) =>
      overLimit(c.at).map((seg) => `${c.id} → ${seg}（${Buffer.byteLength(seg, 'utf8')} 字节）`),
    );
    expect(bad, `这些名字超过 255 字节，在 Linux 上会 ENAMETOOLONG：${bad.join('；')}`).toEqual([]);

    // 变体（正对照）：守卫必须真的抓得住——90 个汉字是 273 字节，正是当初炸掉 ubuntu 的那个名字。
    // 少了这一条，"守卫写错了却恒绿"与"确实没问题"就分不开（见 tests/README §7.4.2）。
    expect(
      overLimit(`notes/${'长'.repeat(90)}.md`),
      '变体：273 字节的名字应被判为超限，否则本守卫等于没查',
    ).toHaveLength(1);
  });
});
