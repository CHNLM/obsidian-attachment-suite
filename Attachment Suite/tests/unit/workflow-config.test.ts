/**
 * 工作流配置对账守卫。
 *
 * 为什么需要它：`.github/workflows/` 与 `.github/actions/` 是**唯一没有任何守卫覆盖**的一角——
 * `docs-consistency.test.ts` 只对账文档与源码符号，而这里改错的代价极高（发布停摆、或发出坏产物），
 * 且恰恰最容易犯本仓库反复踩过的那类错：**同一份事实写在多处，改一处漏一处**。
 * 例如插件目录名 `Attachment Suite` 在两份工作流里出现 8 处，还有三件套清单、被签名的附件集合……
 * 这些漏改都不会让任何测试变红，只会让发布在那一刻失败、或静默发出不完整的产物。
 *
 * 本守卫**刻意不引入 YAML 依赖**（仓库里没有 yaml 库，也不值得为此加依赖），
 * 改用按缩进的文本解析。代价是解析规则与这两份文件当前的写法绑定——所以每条断言都配了
 * 防空转断言（"至少扫到 N 处"）。结构大改时它们会先红，提示"解析规则要跟着改"，
 * 而不是让守卫静默失效。
 */

import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url)); // …/obsidian-attachment
const GH = nodePath.join(REPO_ROOT, '.github');

/**
 * 读文本并**归一化行尾**。
 *
 * 不归一化的话，这个文件在 Windows 的 CI 上会整片失败（实测于 run 37089281509）：
 * 下面的解析器靠"行内容逐字相等"来定位 `jobs:` / `build-release:` / `permissions:` 这些锚点，
 * 而 Windows 检出（`core.autocrlf=true`）会把文本换成 CRLF，于是 `'env:'` 永远不等于 `'env:\r'`，
 * 所有解析结果静默变成空数组——ubuntu 绿、windows 红。
 * 注意本文件**刻意不做 YAML 解析**（见文件头），所以这条读取口是唯一该设防的地方。
 *
 * ⚠️ 之所以只归一化、不假设某种行尾：`.gitattributes` 现在把文本统一钉成 LF（`* text=auto eol=lf`），
 * 但守卫不该依赖"检出配置恰好正确"——配置被改、或有人在别的平台上跑，都得照样成立。
 * 万一将来解析规则再失效，各条断言里的"至少扫到 N 处"防空转断言会先红，不会静默假绿。
 */
const read = (p: string): string => nodeFs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');

const RELEASE = read(nodePath.join(GH, 'workflows', 'release.yml'));
const VERIFY = read(nodePath.join(GH, 'workflows', 'verify.yml'));
const COMPOSITE = read(nodePath.join(GH, 'actions', 'verify-plugin-dist', 'action.yml'));
const ESBUILD = read(nodePath.join(REPO_ROOT, 'Attachment Suite', 'esbuild.config.mjs'));

/** 取某个**顶格**键（`env:` / `jobs:`）之后、下一个顶格键之前的整段。 */
function topLevelBlock(text: string, key: string): string {
  const ls = text.split('\n');
  const start = ls.findIndex((l) => l === `${key}:`);
  if (start < 0) return '';
  const out: string[] = [];
  for (let i = start + 1; i < ls.length; i++) {
    const l = ls[i];
    if (l.trim() !== '' && l.search(/\S/) === 0) break;
    out.push(l);
  }
  return out.join('\n');
}

/** 取 `header:`（缩进 headerIndent）之下、缩进 keyIndent 的赋值键。注释行不算——
 *  本仓库的注释里会**提到**这些名字（例如"GH_TOKEN 刻意不放在这里"），按文本包含判断会误报。 */
function keysUnder(block: string, headerIndent: number, header: string, keyIndent: number): string[] {
  const ls = block.split('\n');
  const i = ls.findIndex((l) => l === `${' '.repeat(headerIndent)}${header}:`);
  if (i < 0) return [];
  const out: string[] = [];
  // 键名允许连字符——权限名（id-token / attestations）就带连字符，第一版漏了它，
  // 于是"id-token 存在"这条断言被静默跳过成了假绿。
  const re = new RegExp(`^ {${keyIndent}}([A-Za-z_][A-Za-z0-9_.-]*):`);
  for (let j = i + 1; j < ls.length; j++) {
    const l = ls[j];
    if (l.trim() !== '' && l.search(/\S/) < keyIndent) break;
    if (l.trimStart().startsWith('#')) continue;
    const m = re.exec(l);
    if (m) out.push(m[1]);
  }
  return out;
}

/** jobs 下的作业 id。 */
function jobIds(text: string): string[] {
  return [...topLevelBlock(text, 'jobs').matchAll(/^ {2}([a-zA-Z0-9_-]+):\s*$/gm)].map((m) => m[1]);
}

/** 某个作业的整段。 */
function jobSlice(text: string, jobId: string): string {
  const ls = text.split('\n');
  const start = ls.findIndex((l) => l === `  ${jobId}:`);
  if (start < 0) return '';
  const end = ls.findIndex((l, i) => i > start && /^ {2}[a-zA-Z0-9_-]+:\s*$/.test(l));
  return ls.slice(start, end < 0 ? ls.length : end).join('\n');
}

/** 作业下的 step 列表（`      - ` 起头）。 */
function stepsOf(jobText: string): string[] {
  const out: string[] = [];
  let cur: string[] | null = null;
  for (const l of jobText.split('\n')) {
    if (/^ {6}- /.test(l)) {
      if (cur) out.push(cur.join('\n'));
      cur = [l];
    } else if (cur) cur.push(l);
  }
  if (cur) out.push(cur.join('\n'));
  return out;
}

function stepLabel(step: string): string {
  const n = /^ {6}- name: (.+)$/m.exec(step);
  if (n) return n[1].trim();
  const u = /^ {6}- uses: (.+)$/m.exec(step);
  return u ? u[1].trim() : '(未命名)';
}

/** step 里的 run 脚本文本（支持 `run: |` 块与单行）。 */
function runScripts(step: string): string[] {
  const ls = step.split('\n');
  const out: string[] = [];
  for (let i = 0; i < ls.length; i++) {
    const block = /^(\s*)run: \|\s*$/.exec(ls[i]);
    if (block) {
      const pad = block[1].length;
      const body: string[] = [];
      for (let j = i + 1; j < ls.length; j++) {
        const l = ls[j];
        if (l.trim() !== '' && l.search(/\S/) <= pad) break;
        body.push(l);
        i = j;
      }
      out.push(body.join('\n'));
      continue;
    }
    const inline = /^\s*run: (.+)$/.exec(ls[i]);
    if (inline) out.push(inline[1]);
  }
  return out;
}

/** `key: |` 之后的多行清单（去空行、去缩进）。 */
function blockList(step: string, key: string): string[] {
  const ls = step.split('\n');
  const i = ls.findIndex((l) => l.trim() === `${key}: |`);
  if (i < 0) return [];
  const pad = ls[i].search(/\S/);
  const out: string[] = [];
  for (let j = i + 1; j < ls.length; j++) {
    const l = ls[j];
    if (l.trim() !== '' && l.search(/\S/) <= pad) break;
    if (l.trim()) out.push(l.trim());
  }
  return out;
}

/** 脚本里引用的环境变量（大写标识符）。 */
function usedVars(script: string): string[] {
  const out = new Set<string>();
  for (const m of script.matchAll(/\$\{?([A-Z][A-Z0-9_]*)\}?/g)) out.add(m[1]);
  return [...out];
}

/** 脚本自己赋值的变量（含 for 循环变量与 local）。 */
function scriptAssignments(script: string): Set<string> {
  const out = new Set<string>();
  for (const m of script.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/gm)) out.add(m[1]);
  for (const m of script.matchAll(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/g)) out.add(m[1]);
  for (const m of script.matchAll(/\blocal\s+([A-Za-z_][A-Za-z0-9_]*)/g)) out.add(m[1]);
  return out;
}

const RUNTIME_ALLOW = new Set(['HOME', 'PATH', 'PWD', 'SHELL', 'USER', 'TMPDIR']);
const WORKFLOWS: Array<[string, string]> = [
  ['release.yml', RELEASE],
  ['verify.yml', VERIFY],
];

describe('工作流配置守卫：同一份事实不能写在两处', () => {
  it('两个工作流声明的是同一个插件目录名', () => {
    // 注意 keysUnder 是"在给定文本里找表头"，所以要传整份工作流，不能传 topLevelBlock 的结果
    // （那一段已经把表头本身切掉了）。
    const a = keysUnder(RELEASE, 0, 'env', 2);
    const b = keysUnder(VERIFY, 0, 'env', 2);
    expect(a, 'release.yml 的顶层 env 里应有 PLUGIN_DIR').toContain('PLUGIN_DIR');
    expect(b, 'verify.yml 的顶层 env 里应有 PLUGIN_DIR').toContain('PLUGIN_DIR');
    const value = (text: string): string => {
      const m = /^\s*PLUGIN_DIR:\s*(.+)$/m.exec(text);
      expect(m, 'PLUGIN_DIR 的写法变了').toBeTruthy();
      return m![1].trim();
    };
    // GitHub 规定 caller 工作流级 env **不会**传给被调用的工作流，所以 verify.yml 必须自带一份。
    // 两份是必须的，值不一致则是缺陷。
    expect(value(VERIFY)).toBe(value(RELEASE));
  });

  it('每个外部 action 都钉到 40 位 commit SHA 且带行尾版本注释', () => {
    const uses = WORKFLOWS.flatMap(([, text]) =>
      [...text.matchAll(/^ *-? *uses: (.+)$/gm)].map((m) => m[1].trim()),
    );
    const remote = uses.filter((u) => !u.startsWith('./'));
    expect(remote.length, `外部 action 只扫到 ${remote.length} 处——解析规则可能失效了`).toBeGreaterThanOrEqual(7);
    for (const u of remote) {
      expect(u, `未钉到 commit SHA，或缺行尾版本注释：${u}`).toMatch(
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/,
      );
    }
  });

  it('三件套清单只有一份实现，且两个工作流都调用它', () => {
    const m = /for f in ([a-z. ]+);/.exec(COMPOSITE);
    expect(m, '复合 action 里的三件套清单解析失败').toBeTruthy();
    expect(m![1].trim().split(/\s+/)).toEqual(['main.js', 'manifest.json', 'styles.css']);
    for (const [label, text] of WORKFLOWS) {
      expect(text, `${label} 没有调用复合 action`).toContain('uses: ./.github/actions/verify-plugin-dist');
      // 内联的那份属于"第二份实现"：它会在某人只改一处时漂移，且不会再受复合 action 的守卫保护。
      expect(text, `${label} 里还留着内联的第二份实现`).not.toContain('attachment-suite/$f');
    }
  });

  it('复合 action 的产物路径与 esbuild 的 PKG_DIR 一致', () => {
    const pkg = /const PKG_DIR = '([^']+)'/.exec(ESBUILD);
    expect(pkg, 'esbuild.config.mjs 里找不到 PKG_DIR').toBeTruthy();
    expect(COMPOSITE, `复合 action 取的路径与 esbuild 的 PKG_DIR（${pkg![1]}）不一致`).toContain(
      `$PLUGIN_DIR/${pkg![1]}/`,
    );
  });
});

describe('工作流配置守卫：发布链路的顺序与集合关系', () => {
  it('build-release 的步骤顺序：构建 → 三件套检查 → 打包 → 签名 → 发布', () => {
    const steps = stepsOf(jobSlice(RELEASE, 'build-release')).map(stepLabel);
    const order = [
      'Build',
      'Verify build output contains the three required files',
      'Package plugin zip',
      'Attest build provenance',
      'Create GitHub Release',
    ];
    for (const name of order) {
      expect(steps, `缺少步骤「${name}」（实际：${steps.join(' / ')}）`).toContain(name);
    }
    const positions = order.map((n) => steps.indexOf(n));
    expect(positions, `步骤顺序不对：${steps.join(' / ')}`).toEqual([...positions].sort((x, y) => x - y));
  });

  it('被签名的附件集合等于被发布的附件集合，且缺附件会硬失败', () => {
    const steps = stepsOf(jobSlice(RELEASE, 'build-release'));
    const find = (label: string): string => {
      const s = steps.find((x) => stepLabel(x) === label);
      expect(s, `找不到步骤「${label}」`).toBeTruthy();
      return s!;
    };
    const subjects = blockList(find('Attest build provenance'), 'subject-path');
    const files = blockList(find('Create GitHub Release'), 'files');
    expect(subjects.length, `被签名的文件应覆盖全部发布附件（实际 ${subjects.join('、')}）`).toBe(4);
    expect([...subjects].sort()).toEqual([...files].sort());
    // fail_on_unmatched_files 默认 false：缺附件只警告不失败，会发出一个缺文件的 Release 且运行仍绿。
    expect(find('Create GitHub Release')).toMatch(/fail_on_unmatched_files: true/);
  });

  it('build-release 不声明 actions: write，但保留 attest 必需的 id-token 与 attestations', () => {
    const keys = keysUnder(jobSlice(RELEASE, 'build-release'), 4, 'permissions', 6);
    expect(keys).toContain('contents');
    expect(keys, '缺少 id-token 时 actions/attest 会直接抛 "missing id-token permission"').toContain('id-token');
    expect(keys).toContain('attestations');
    expect(keys, 'actions scope 的语义是"能取消工作流运行"，上传产物不需要它').not.toContain('actions');
  });

  it('detect-version 有版本单调性守卫，且排在正常路径写出 outputs 之前', () => {
    const resolve = stepsOf(jobSlice(RELEASE, 'detect-version')).find(
      (s) => stepLabel(s) === 'Resolve & validate version',
    );
    expect(resolve, '找不到 Resolve & validate version 步骤').toBeTruthy();
    const script = runScripts(resolve!).join('\n');
    expect(script, '守卫要用 sort -V：字符串比较会把 1.10.0 判成小于 1.9.0').toContain('sort -V');
    expect(script).toContain('版本回退');
    // 幂等跳过分支里也有一次同样的 echo，所以比的是**最后一次**出现（正常路径的位置）。
    expect(script.indexOf('版本回退')).toBeLessThan(script.lastIndexOf('echo "version=$VERSION"'));
  });

  it('引用 inputs 的 step 级 if 必须兼容 push 事件', () => {
    let checked = 0;
    for (const [label, text] of WORKFLOWS) {
      for (const job of jobIds(text)) {
        for (const step of stepsOf(jobSlice(text, job))) {
          const m = /^ {8}if: (.+)$/m.exec(step);
          if (!m || !m[1].includes('inputs.')) continue;
          checked += 1;
          // push 事件下 inputs 是空对象：`!inputs.dry_run` 恰好也能成立，但语义是"恰好"；
          // 写成 `!= true` 才是"只有显式选了才跳过"，且不会因将来的类型变化翻车。
          expect(m[1], `${label} · ${stepLabel(step)} 的 if 要写成「inputs.xxx != true」`).toMatch(
            /inputs\.\w+ != true/,
          );
        }
      }
    }
    expect(checked, '一条引用 inputs 的 if 都没扫到——守卫等于没查').toBeGreaterThanOrEqual(2);
  });
});

describe('工作流配置守卫：run 脚本引用的变量都必须有来源', () => {
  it('每个 $VAR 都在 env 里、或由脚本自己赋值', () => {
    const problems: string[] = [];
    let scripts = 0;
    for (const [wfLabel, text] of WORKFLOWS) {
      const wfEnv = keysUnder(text, 0, 'env', 2);
      for (const job of jobIds(text)) {
        const slice = jobSlice(text, job);
        const steps = stepsOf(slice);
        if (steps.length === 0) continue; // 调用可复用工作流的作业没有自己的 step
        const jobEnv = keysUnder(slice, 4, 'env', 6);
        for (const step of steps) {
          for (const script of runScripts(step)) {
            scripts += 1;
            const visible = new Set([...wfEnv, ...jobEnv, ...keysUnder(step, 8, 'env', 10)]);
            const assigned = scriptAssignments(script);
            for (const v of usedVars(script)) {
              if (
                visible.has(v) ||
                assigned.has(v) ||
                RUNTIME_ALLOW.has(v) ||
                v.startsWith('GITHUB_') ||
                v.startsWith('RUNNER_')
              ) {
                continue;
              }
              problems.push(`${wfLabel} · ${job} · ${stepLabel(step)}: $${v} 既不在 env 里、也没在脚本里赋值`);
            }
          }
        }
      }
    }
    expect(scripts, '一个 run 脚本都没解析到——解析规则已失效').toBeGreaterThanOrEqual(6);
    // 这条专抓"把某个 env 变量搬到别处却没搬全"：搬漏的引用会在这里现形。
    expect(problems).toEqual([]);
  });
});
