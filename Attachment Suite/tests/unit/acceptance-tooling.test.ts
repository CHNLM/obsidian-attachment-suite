/**
 * 验收工具链的"口径同步"守卫。
 *
 * 背景：验收逻辑有两份实现——harness 版（`tests/e2e/acceptance.test.ts`，跑临时库、进 CI）
 * 与真实宿主版（`scripts/obsidian-cdp-acceptance.mjs`，CDP 驱动真 Obsidian）。
 * 它们**无法共用代码**（一个是 TS、一个是独立 .mjs 脚本），于是天然存在"只改一边"的风险。
 *
 * 本仓库已经因为"同一件事两份实现、后来只改了一份"栽过 5 次（最近一次是 canvas：
 * 索引层认 canvas 的 `file` 字段、改写层不认 → 附件被当孤儿删掉）。
 * 所以这里把"两侧的引用解析必须包含同样的四件事"变成可执行断言：
 *
 * 1. markdown 的 `<…>` 包裹形式
 * 2. wiki 剥掉 `#锚点` 与 `|别名`
 * 3. canvas 的 `"file"` 字段
 * 4. 语法感知的解析（wiki 按名/主名、md/html/canvas 按路径）
 *
 * 任一侧退化成"按空白截断 + 一律按 basename 兜底"，这里就会红——
 * 而那正是最容易被漏掉的回归（脚本看起来照常"跑完 13 条命令、0 问题"）。
 */

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const HARNESS = nodePath.join(REPO, 'tests', 'e2e', 'acceptance.test.ts');
const CDP_SCRIPT = nodePath.join(REPO, 'scripts', 'obsidian-cdp-acceptance.mjs');
const TRACE_SCRIPT = nodePath.join(REPO, 'scripts', 'obsidian-cdp-trace.mjs');
const SHARED_HTTP = nodePath.join(REPO, 'scripts', 'lib', 'acceptance-http-server.mjs');

function readOrFail(p: string): string {
  expect(nodeFs.existsSync(p), `验收工具链文件不存在（路径变了就要同步本条守卫）：${p}`).toBe(true);
  return nodeFs.readFileSync(p, 'utf8');
}

/** 两侧都必须具备的解析能力标记（写成字面量，便于一眼核对）。 */
const MARKERS: Array<{ name: string; needle: string; why: string }> = [
  {
    name: 'markdown <…> 包裹形式',
    needle: '<([^>]+)>',
    why: '目标含空格/括号时的合法写法；漏了会把它连尖括号一起当 URL，判定失败而整条跳过',
  },
  {
    name: 'wiki 剥 #锚点 与 |别名',
    needle: '[^\\]#|]+',
    why: '`[[assets/a.pdf|说明文档]]` 是本地化普通链接的产出形态；不剥别名则永远解析失败',
  },
  {
    name: 'canvas 的 file 字段',
    needle: '"file"\\s*:\\s*"([^"]*)"',
    why: '索引层把 canvas 引用算作"在用"；不解析它，则"引用悬空 + 附件被删"整类在扫描范围外',
  },
  {
    name: '语法感知解析（wiki 主名回退）',
    needle: 'stemOf',
    why: '`![[song]]` 按主名解析命中 song.mp3；一律按 basename 兜底会漏掉这一形态',
  },
  {
    name: 'md 目标允许一层括号嵌套',
    needle: '((?:[^()]|\\([^()]*\\))*)',
    why: '`报告 (1).png` 是 Windows 上合法且常见的文件名。写成 `([^)]+)` 会在第一个 `)` 处截断 → '
      + '截断目标既不进"在用"集合、也无法被改写 → **附件被当孤儿清理 + 笔记留下断链**（L06/P01 实测过）',
  },
];

describe('验收工具链：harness 与真实宿主脚本的解析口径必须同步', () => {
  for (const side of [
    { label: 'harness（acceptance.test.ts）', file: HARNESS },
    { label: '真实宿主（obsidian-cdp-acceptance.mjs）', file: CDP_SCRIPT },
  ]) {
    it(`${side.label} 具备全部四项解析能力`, () => {
      // 用**剥注释后**的代码判断：说明性注释里出现同一串会把断言喂饱（本文件末尾记过这条教训）。
      const code = stripComments(readOrFail(side.file));
      const missing = MARKERS.filter((m) => !code.includes(m.needle));
      expect(
        missing.map((m) => `${m.name}（缺标记 ${m.needle}）——${m.why}`),
        '解析口径退化：两侧不同步就会漏掉一整类缺陷，而脚本仍会显示"跑完 0 问题"',
      ).toEqual([]);
    });
  }

  it('两侧都把 .canvas 纳入被扫描的文本集合', () => {
    for (const file of [HARNESS, CDP_SCRIPT]) {
      const code = readOrFail(file);
      expect(
        /\.canvas/.test(code) && /endsWith\('\.canvas'\)|endsWith\("\.canvas"\)/.test(code),
        `${file} 未把 .canvas 纳入扫描（canvas 引用会完全落在不变式之外）`,
      ).toBe(true);
    }
  });

  it('两侧都保留"按空白截断"的旧写法为禁用态（不得复活）', () => {
    for (const file of [HARNESS, CDP_SCRIPT]) {
      const code = readOrFail(file);
      // 只允许出现在注释里说明"这是旧写法"；出现即视为复活
      const codeOnly = code.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(/\(\[\^\)\\s\]\+\)/.test(codeOnly), `${file} 里"按空白截断目标"的旧写法复活了`).toBe(false);
    }
  });
});

/**
 * 本地 HTTP 服务是外链用例的**被测目标**，两个 CDP 脚本必须共用同一份实现。
 *
 * 曾经的缺陷（2026-09-29 实测抓到）：追踪脚本没有起这个服务，于是**每一次**追踪的宿主控制台里
 * 都有 `[IAP] 下载失败：http://127.0.0.1:45999/…（net::ERR_CONNECTION_REFUSED）`。
 * 那是**诊断工具自己制造的假失败**——排查的人会去追一个根本不存在的缺陷，
 * 而且外链本地化那条链路在追踪里根本跑不到，"是哪一步把附件写坏的"无从定位。
 *
 * 判据写成"必须有导入 + 不得内联 createServer"：只要允许内联，就一定会再出现第二份实现。
 */

/**
 * 剥掉注释后的代码文本。
 *
 * 必要性（变体测试实测）：`acceptance-http-server.mjs` 这个串在**说明性注释**里也会出现，
 * 直接对原文 `toContain` 会被注释满足——把导入整行删掉，断言照样全绿（"断言恒真"）。
 */
function stripComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('本地 HTTP 服务：验收与追踪必须共用同一实现', () => {
  it('共享模块存在，并导出启动函数与 PNG 头常量', () => {
    const code = readOrFail(SHARED_HTTP);
    expect(code).toContain('export function startAcceptanceHttpServer');
    expect(code).toContain('export const PNG_HEADER');
  });

  for (const side of [
    { label: '真实宿主验收（obsidian-cdp-acceptance.mjs）', file: CDP_SCRIPT },
    { label: '逐步追踪（obsidian-cdp-trace.mjs）', file: TRACE_SCRIPT },
  ]) {
    it(`${side.label} 通过共享模块启动本地服务，且未内联第二份实现`, () => {
      const codeOnly = stripComments(readOrFail(side.file));
      expect(
        codeOnly,
        '未导入共享服务模块 → 外链用例会以 ERR_CONNECTION_REFUSED 假失败（工具自己造的）',
      ).toContain('acceptance-http-server.mjs');
      expect(codeOnly, '未调用共享启动函数').toContain('startAcceptanceHttpServer(');
      expect(
        /http\.createServer/.test(codeOnly),
        '内联了第二份 HTTP 服务实现：两份终会漂移，追踪结果不再等价于验收环境',
      ).toBe(false);
    });
  }
});
