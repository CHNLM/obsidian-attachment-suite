# 遗留问题的推荐修复方案（2026-09-28）

> 上游：`review-round4-2026-09-28.md` 的「§4 遗留与后续建议」与 P3 表。
> 本文只给**方案**，不含实施。每项都写了：证据 → 根因 → 推荐做法（含代码骨架）→ 影响面 → 验证方式 → 风险与回退。
> 行号以 2026-09-28 提交 `d745580` 后的工作区为准。

## 0. 优先级与依赖

| # | 项目 | 级别 | 依赖 | 为什么排这个位置 |
|---|---|---|---|---|
| L1 | 测试夹具可信度专项（6 个子项） | 最高 | — | 它是**其余所有验证的地基**。地基不可信时，其它"已验证通过"都要打折扣 |
| L2 | 失败可见性契约测试 | 高 | L1.2（确定性确认） | 历史缺陷都出在"失败被吞"，而这条契约目前零覆盖 |
| L3 | 本地化 URL/标题解析口径合并 | 中 | — | 唯一的**真实功能缺口**；分 3 步走，先防损坏再补能力 |
| L4 | 清理未用「删除前复检」口径统一 | 中 | L1.2 | 第 N 次"两层口径不一致"的隐患，修法很便宜 |
| L5 | 低风险顺手项 | 低 | — | 两条独立小改，可随时插入 |

**建议节奏**：L1 单独一轮（它只动 `tests/`，不碰 `src/`，风险最低、收益最大）；
L2 + L4 一轮（都要动 `src/` 少量 + 补测试）；L3 单独一轮（唯一的功能变更）；L5 随手。

---

## L1 测试夹具可信度专项

### L1.1 `getConfig` 恒空导致的落盘位置盲区（原 P3-1）

**证据**

- `tests/e2e/infrastructure.ts:700`：
  ```ts
  getConfig: (key: string): unknown => {
    const cfg = { attachmentFolderPath: '', useMarkdownLinks: false, newFileLocation: 'root' };
    return cfg[key as keyof typeof cfg];
  },
  ```
- 消费点 `src/obsidian-domain.ts:46-50`：`cfg === ''` → 走 `settings.attachmentFolder` 回退。
- `tests/e2e/fixture.ts:18` 的 `TEST_SETTINGS.attachmentFolderMode = 'obsidian'`（**默认模式**），
  所以 real-suite / safety-suite / report-accuracy / scale 四个套件实际测的是"回退分支"，
  却看起来在测"跟随 Obsidian 设置"。
- 真实 Obsidian 的 `attachmentFolderPath` **默认值是 `'/'`**（库根），`resolveAttachmentDir(parent, '/')`
  返回 `''`（= 库根，见 `src/core/path-compatibility.ts:146-154`）。

**结论**：**默认配置下附件到底落在库根还是 `./assets`，E2E 从未验证过**。
（`acceptance-fixture.ts:174` 用的是 `'custom'`，所以验收库不受影响。）

**推荐做法（三步，且不要改动现有断言的期望路径）**

1. `buildTestApp` 增可选的第三参注入库配置：
   ```ts
   export interface TestAppOptions {
     /** Obsidian 库级配置（`vault.getConfig`）。默认 `{}`＝所有键 undefined，与现状等价。 */
     vaultConfig?: Record<string, unknown>;
   }
   export function buildTestApp(vaultRoot: string, obsidian: ObsidianModule, opts: TestAppOptions = {}): TestAppHandle
   ```
   `getConfig` 改为 `(k) => opts.vaultConfig?.[k]`。默认 `{}` 时行为与今天完全一致（仍走回退），
   四个存量套件零改动。
2. `TEST_SETTINGS.attachmentFolderMode` 由 `'obsidian'` 改为 `'custom'`。
   这是**让夹具说实话**：它本来就把落盘位置钉在 `./assets`，不该借"obsidian 模式 + 空回退"来实现。
   因为回退结果同为 `./assets`，**82 处 `assets/` 断言一条都不用改**。
3. 新增一组专项用例（建议放 `tests/e2e/vault-config.test.ts`，或 `real-suite` 里新增一节），
   逐格覆盖"跟随 Obsidian 设置"这个默认模式：

   | 场景 | `vaultConfig` | 期望落盘目录 | 说明 |
   |---|---|---|---|
   | 库根（Obsidian 默认） | `{ attachmentFolderPath: '/' }` | 库根 `''` | **当前完全未覆盖的那一格** |
   | 笔记相对 | `{ attachmentFolderPath: './assets' }` | 笔记同级 `assets/` | |
   | 库根具名 | `{ attachmentFolderPath: 'assets' }` | 库根 `assets/` | |
   | 紧邻笔记 | `{ attachmentFolderPath: '.' }` | 笔记目录 | |
   | 键缺失 | `{}` | 回退 `settings.attachmentFolder` | 明确锁住回退契约 |
   | 自定义模式忽略库配置 | `'custom'` + `{ attachmentFolderPath: '/' }` | `settings.attachmentFolder` | 证明 custom 优先级 |

   断言用「文件落在哪」而不是「目录字符串是什么」——即跑一次 `localize-note` 后断言附件相对路径前缀。
4. 顺带覆盖 `useMarkdownLinks` 的另一分支（同文件同机制）：
   `{ useMarkdownLinks: true }` 时本地化改写应产出 `![alt](assets%20path/x.png)` 形态，
   而不是当前恒走到的 `![[path|alt]]`（消费点 `src/features/localize-media.ts:277`）。

**验证**：新用例在 `useMarkdownLinks:false` / `attachmentFolderPath:'/'` 两种注入下**必须给出不同结果**——
若两者结果相同，说明注入没生效，用例本身要先怀疑。

**风险与回退**：低。默认参数保证存量行为不变；出问题只需删掉新增文件、把 `mode` 改回 `'obsidian'`。

---

### L1.2 `confirmModal()` 会回放上一条命令的确认回调（stale CTA）

**证据** `tests/e2e/acceptance.test.ts:110-119`

```ts
async function confirmModal(): Promise<void> {
  const opts = handle.app._modals[handle.app._modals.length - 1]?.opts;
  if (opts && typeof opts.onConfirm === 'function') { await opts.onConfirm(); return; }
  const reg = obsidian._registry;
  const cb = reg.ctaClickCallbacks[reg.ctaClickCallbacks.length - 1]; // ← 与当前命令无关
  if (cb) await cb();
}
```

`runAllCommands()`（`:128-144`）对**每条命令**无条件调用它。而 `localize-note` / `export-note` /
`check-consistency` 等在不产生操作时不弹确认窗 → 此时它取到的是**上一条命令遗留的回调**，
于是同一批破坏性操作被额外执行一遍。这也是"最多 6 轮才收敛"的部分成因（另一部分是命令顺序固有交互）。

**推荐做法**：把"确认"限定在**本命令期间新开的弹窗/按钮**内，绝不回放旧回调。

```ts
/** 跑一条命令并只确认"它自己开的"弹窗；返回本命令新开的弹窗数（供"必须确认"断言）。 */
async function runCmd(id: string): Promise<number> {
  const m0 = handle.app._modals.length;
  const c0 = obsidian._registry.ctaClickCallbacks.length;
  await cmd(id)();
  const fresh = handle.app._modals.slice(m0);
  const withConfirm = fresh.filter((m: any) => typeof m?.opts?.onConfirm === 'function');
  if (withConfirm.length) {
    await withConfirm[withConfirm.length - 1].opts.onConfirm();
    return fresh.length;
  }
  const cbs = obsidian._registry.ctaClickCallbacks.slice(c0);
  if (cbs.length) await cbs[cbs.length - 1](); // CandidateSelectModal 之类走 CTA
  return fresh.length;
}
```

并把"必须出现确认"变成**显式断言**（现在完全没有）：

```ts
// 破坏性 + 有操作时必须有确认窗；没有操作时不该有。两者都要能说清是哪一种。
const CONFIRM_REQUIRED = new Set(['attachment:bulk-rename', 'attachment:bulk-collect', 'attachment:bulk-localize']);
const opened = await runCmd(id);
LAST_CONFIRM_REPORT.set(id, opened);
```

`bulk-rename` 这一类在验收库里必然有操作，故 `opened > 0`；若某轮变成 0，说明前置状态被改坏了，
应当报出来而不是静默跳过。`repair-incompatible-paths` 在 Windows 上必然 0 次（无法落地非法名），
**允许为 0**——这一点要在断言里写明，不能一刀切。

**顺带修**：`tests/e2e/real-suite.test.ts:143-148` 的 `skipAllCandidates()` 用"倒数第二个 CTA"定位按钮，
同样脆弱。建议改成给 `ButtonComponent` 替身加 `setButtonText` 记录，按**按钮文案**定位
（`infrastructure.ts:300-314` 的 `onClick` 里已经能拿到组件，把 text 一并存进 `Registry.ctaClickCallbacks`）。

**验证**：改造后收敛轮数应下降（不再有重复执行）；把 `runCmd` 换回旧实现，应有用例转红——否则说明这条修复没被测到。

---

### L1.3 77 条验收用例的 `expect` 从不被机器校验（原 P3-1 附带）

**证据**

- `tests/e2e/acceptance.test.ts:174` 只用了 `ACCEPTANCE_CASES.length`（在用例标题里）；
  `grep -rn ACCEPTANCE_CASES` 显示 `expect` 字段无任何消费点。
- 真正生效的是 10 条全局不变式，其中最核心的「无新断链」用 **basename 兜底**（见 L1.4）。

**推荐做法**：给用例加**可选的机器校验函数**，并把"未机器校验"的条数**打印出来**（不许假装全覆盖）。

```ts
// acceptance-fixture.ts
export interface AcceptanceContext {
  before: string[];
  files: string[];
  read: (rel: string) => string;
  exists: (rel: string) => boolean;
  localRefs: (text: string) => Array<{ target: string; kind: 'md' | 'wiki' | 'html' }>;
  resolvable: (target: string, kind: 'md' | 'wiki' | 'html') => boolean;
}

export interface AcceptanceCase {
  id: string; kind: string; at: string; expect: string;
  /** 机器校验：返回 null = 通过，返回字符串 = 失败原因。省略则该用例只受全局不变式保护。 */
  assert?: (ctx: AcceptanceContext) => string | null;
}
```

harness 侧：

```ts
let checked = 0, unchecked = 0;
for (const c of ACCEPTANCE_CASES) {
  if (!c.assert) { unchecked++; continue; }
  checked++;
  const why = c.assert(ctx);
  if (why) problems.push(`[${c.id}] ${why}`);
}
console.log(`[acceptance] 机器校验 ${checked} / ${ACCEPTANCE_CASES.length}（未校验 ${unchecked}）`);
```

**落地建议**：不要一次补 77 条。先补**最便宜的 25 条左右**（存在性 / 是否被删 / 是否被改名 /
是否仍含外链 / 是否保形），把 `unchecked` 压到 50 以下；剩下的按"预期是否可判定"分批补。
关键是**这个数字必须可见且单调下降**——它取代了今天"77 条用例"这种注水式覆盖叙述。

---

### L1.4 「无新断链」不变式的两处过宽

**证据** `tests/e2e/acceptance.test.ts:160-166`、`:203-211`

```ts
function resolvable(target: string, files: string[]): boolean {
  const norm = target.replace(/^\.\//, '');
  if (files.includes(norm)) return true;
  const base = norm.slice(norm.lastIndexOf('/') + 1);
  return files.some((f) => f.slice(f.lastIndexOf('/') + 1) === base); // ← 任意同名即算"可解析"
}
...
for (const [p, beforeText] of beforeTexts) {
  if (!files.includes(p)) continue; // ← 笔记被改名/删除就静默跳过
```

**两个问题**：① 引用被改到**错误的同名文件**也算"可解析"；② 笔记一旦被改名/删除，该篇退出校验。

**推荐做法**

1. **按语法分别解析**（这是关键，不能一刀切）：Obsidian 对 **wiki 链接忽略路径、按 basename 解析**，
   而 **markdown 链接是路径式解析**。所以：
   ```ts
   function resolvable(target: string, kind: 'md' | 'wiki' | 'html', files: string[]): boolean {
     const norm = decodeURIComponent(target.replace(/^\.\//, '').replace(/^<|>$/g, ''));
     if (files.includes(norm)) return true;
     if (kind === 'wiki') return files.some((f) => basename(f) === basename(norm)); // wiki 仍按名
     // md / html：路径式 → 必须精确路径命中
     return false;
   }
   ```
   这需要 `localRefs()` 同时返回 `kind`（它现在只有一个大正则，改成分类收集即可）。
2. **笔记不应被改名/删除**：把 `if (!files.includes(p)) continue;` 改为
   `problems.push(...)`。已核实 13 条命令中没有任何一条会改名笔记
   （`repair-incompatible-paths` 只作用于 `snapshot.entries.keys()`＝附件）。
3. 改完后**必然会转红若干条**——逐条甄别：是真断链（⇒ 记为缺陷另开修复）还是断言过严
   （⇒ 补一条 wiki 例外）。这一步的产出比"全绿"更有价值，务必把甄别结论写回报告。

**风险**：这是本专项里唯一可能暴露**真实产品缺陷**的改动，所以放在 L1.4、留出甄别时间。

---

### L1.5 O06/O07 是彻底的同义反复

**证据** `tests/e2e/acceptance.test.ts:212-217`

```ts
for (const stem of ['only-canvas', 'only-frontmatter']) {
  if (!files.some((f) => f.includes(stem) || f.includes(stem.replace('only-', '')))) {
```
`files` 里必然存在 `canvas/画布用例.canvas`（含 "canvas"）与 `notes/04-frontmatter.md`（含 "frontmatter"），
两条断言恒真 → "仅被 canvas / frontmatter 引用的附件不得被清理"这个验收项**从未被校验**。

**推荐做法**：**按内容身份**判定存活，而不是按名字子串。这要求夹具附件有唯一字节：

```ts
// acceptance-fixture.ts：给这两个夹具加唯一尾部标记（现有 writeBin 是同头重复，多个文件字节相同）
writeFile(rootAbs, 'orphans/only-canvas.png', Buffer.concat([HEAD.png, Buffer.from('MARKER-ONLY-CANVAS')]));
writeFile(rootAbs, 'orphans/only-frontmatter.png', Buffer.concat([HEAD.png, Buffer.from('MARKER-ONLY-FRONTMATTER')]));
```

harness 侧：

```ts
const bytesOf = (rel: string): string => nodeFs.readFileSync(abs(rel)).toString('base64');
// 执行前记录这两个文件的字节指纹
const fingerprints = ['orphans/only-canvas.png', 'orphans/only-frontmatter.png'].map(bytesOf);
// 执行后：允许被改名（命名功能会改），但不允许消失——库里必须仍存在同字节文件
for (const fp of fingerprints) {
  if (!files.some((f) => isManagedBinary(f) && bytesOf(f) === fp)) problems.push('仅特殊引用形态的附件被删除');
}
```

**注意**：`only-canvas.png` / `only-frontmatter.png` 被命名功能改名是**预期行为**，所以只能查字节、不能查名字——
这正是原断言想表达却又写错的地方。同时把 `at` 字段（`:121-122`）的说明与真实断言对齐。

---

### L1.6 `report-accuracy` 的分区缺失即空过

**证据** `tests/e2e/report-accuracy.test.ts:58-64`

```ts
const section = (opts?.sections ?? []).find((s: any) => s.title === '需修复的引用（断链 / URL 编码）');
return (section?.items ?? []).map(...);
```
分区标题一旦改动、或弹窗没开，`brokenItems()` 返回 `[]` → 四条"不误报"断言（`expect(...).toBe(false)`）恒真。

**推荐做法**：**fail loud**，把"环境不对"与"确实没误报"分开：

```ts
async function brokenItems(): Promise<string[]> {
  await command('attachment:check-consistency')();
  const opts = handle.app._modals.at(-1)?.opts;
  if (!opts?.sections) throw new Error('未打开一致性报告弹窗，断言将失去意义');
  const section = opts.sections.find((s: any) => s.title === SECTION_BROKEN);
  if (!section) {
    throw new Error(`报告缺少分区「${SECTION_BROKEN}」；现有分区：${opts.sections.map((s: any) => s.title).join(' / ')}`);
  }
  return section.items.map((i: any) => String(typeof i === 'string' ? i : i.text));
}
```
再加一条**自证用例**：往库里放一个真断链，断言 `brokenItems()` 里**出现**它——
这样"返回空数组"再也不会被当成"没有误报"。漏报方向的 3 条断言已经用 `.toBe(true)` 锁住了漏报，
但同样受"分区为空"影响，一并受益。

---

## L2 失败可见性契约测试（`errors > 0` 路径零覆盖）

**证据**：`grep -rn "reportFailures\|reportProgress" tests/` → 零命中。所有 E2E 都在"全部成功"的世界里跑。
而这三条链路都承诺"失败任何级别都提示"：
`src/notify.ts:57-60`（`reportFailures`）、`src/commands.ts:58-65`（`traceCommand` 的 catch）、
`src/main.ts:228-232`（`reportBackgroundError`）、`src/features/localize-media.ts:356-362`（笔记改写失败）。

**推荐做法**：不依赖 `Notice` 的 level（`createNoticer` 只传 duration，level 只体现在"是否发"这一点上），
而是断言**"静默档下是否出现提示"**这个可观测事实。

```ts
it('静默档下：附件写盘失败必须仍然可见', async () => {
  plugin.settings.notificationLevel = 'silent';
  const orig = handle.app.vault.createBinary;
  handle.app.vault.createBinary = async () => { throw new Error('EACCES: 库目录只读'); };
  try {
    writeText(VAULT_ROOT, 'F.md', `# f\n\n![x](${httpBase}/a.png)\n`);
    handle.open('F.md');
    await command('attachment:localize-note')();
  } finally { handle.app.vault.createBinary = orig; }
  const msgs = notices().join('\n');
  expect(msgs, '静默档把失败吞了').toMatch(/失败/);
});

it('静默档下：纯成功不应产生任何提示（对照组）', async () => {
  plugin.settings.notificationLevel = 'silent';
  writeText(VAULT_ROOT, 'OK.md', `# ok\n\n![x](${httpBase}/b.png)\n`);
  handle.open('OK.md');
  await command('attachment:localize-note')();
  expect(notices().length, '静默档下成功也弹提示＝静默开关没生效').toBe(0);
});

it('命令级异常：任何档位下都必须报出「执行失败」', async () => {
  plugin.settings.notificationLevel = 'silent';
  const orig = handle.app.vault.getFiles;
  handle.app.vault.getFiles = () => { throw new Error('boom'); };
  try { await command('attachment:cleanup-unused')(); }
  finally { handle.app.vault.getFiles = orig; }
  expect(notices().join('\n')).toMatch(/执行失败/);
});
```

**要点**
- **必须配对照组**：只断言"失败有提示"，任何"什么情况都狂弹"的实现也能过。
  对照组（成功 + 静默 → 0 条）才是把契约钉死的那一半。
- `reportBackgroundError` 需要驱动队列：开 `automation.enabled`、把 `vault.read` 改成抛错、
  `handle.emitChange('N.md')`、等过一个轮询周期，断言出现错误提示。**建议标为可选/stretch**，
  因为它要 `await sleep(interval*1000 + 余量)`，容易引入时间脆弱性；若要写，把 interval 设为 1 秒并在
  断言前轮询等待（而非固定 sleep）。
- 顺带把 `infrastructure.ts` 的 `Notice` 替身记录 `duration`（现在是丢弃的），
  这样"错误 5 秒 / 摘要 3 秒 / 过程 2 秒"的承诺也能被断言——但**不要**为此给 Notice 强加 level 概念，
  真实 API 里没有这个信息。

---

## L3 本地化 URL/标题解析：先防损坏，再补能力，最后统一口径（原 P3-2）

**证据** `src/features/localize-media-core.ts:87-89`

```ts
const MD_IMG  = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const MD_LINK = /(?<!!)\[([^\]]*)\]\(([^)\s]+)\)/g;
```

后果（三条，按严重度递减）：

1. **URL 含 `)` 时会被截断**：`![x](https://a.com/Foo_(bar).png)` 匹配到 `raw = "![x](https://a.com/Foo_(bar)"`，
   `url = "https://a.com/Foo_(bar"`。若该 URL 恰好下载成功，`applyRefReplacements` 会把这一截替换成本地链接，
   正文变成 `![x](local.png).png)` ——**改坏正文**。（实际多半因 404 而跳过，所以是"低概率高破坏"。）
2. **带标题的图片不被本地化**：`![alt](url "标题")` 整个不匹配（`([^)\s]+)` 后面接不到 `)`），
   于是这类外链永远不会被下载，笔记无法脱机使用。
3. **`<...>` 尖括号写法不被本地化**：`![x](<http://a/b.png>)` 捕获到 `<http://a/b.png>`，`isHttp()` 判定失败 → 跳过。

**根因**：本文件自建了一套 markdown 目标解析，与 `src/core/link-resolver.ts:35` 的
`MD_LINK = /(!?)\[([^\]]*)\]\(([^)]*)\)/g` + `parseMdTarget`（`:44-54`）是**两份口径**。
架构守卫**故意**把它排除在"禁止空白截断"规则之外（因为它解析的是外部 URL）——
但"外部 URL 不含字面空格"这个前提**推不出**"可以按空白截断"，标题段就是反例。

### 步骤 1（**先做，纯降风险**）：不产出坏链接

最小改动、不改任何能力，只把"可疑目标"识别出来并**跳过**：

```ts
function mdTargetIsAmbiguous(text: string, matchEnd: number): boolean {
  // `)` 紧跟其后 ⇒ 说明目标里本来就含 `)`，本次匹配是被截断的
  return text[matchEnd] === ')';
}
```
命中即**不加入 refs**（不下载、不改写），并计入一个新的 `skippedAmbiguous` 计数，在摘要里如实报出
（`logger.warn` + summary 文案）。**原则：宁可漏本地化，绝不改坏正文。**

### 步骤 2（补能力）：整体捕获 + 复用 `parseMdTarget`

```ts
// src/core/link-resolver.ts：把 parseMdTarget 导出
export function parseMdTarget(inner: string): { target: string; title: string }

// src/features/localize-media-core.ts
const MD_IMG  = /!\[([^\]]*)\]\(([^)]*)\)/g;
const MD_LINK = /(?<!!)\[([^\]]*)\]\(([^)]*)\)/g;

function pushMdRef(refs, raw, alt, inner, syntax): void {
  const { target, title } = parseMdTarget(inner);   // 去 `<...>` 外壳、剥 ` "标题"`
  if (!isHttp(target) && !isDataUrl(target)) return;
  refs.push({ url: target, alt, raw, kind: ..., nameHint: nameHintOf(target, alt), syntax, title });
}
```
`ExternalRef` 增可选 `title?: string`（可选字段，不破坏既有构造点）；
`refReplacement`（`:197-210`）对 `md-image` / `md-link` 保形回写标题：

```ts
const t = ref.title ?? '';
return `![${ref.alt}](${encodeMdTarget(localPath)}${t})`;   // wiki 风格下标题无对应语法，按原样丢弃
```
顺带白拿两条改进：`<...>` 写法可被识别；标题不再丢失。

### 步骤 3（统一口径 + 收编守卫）

- `localize-media-core` 不再自建目标解析，全部走 `parseMdTarget`；
- 在 `tests/unit/architecture.test.ts` 增加断言：`src/features/localize-media-core.ts` 的 markdown 分支
  **不得**再出现 `[^)\s]+`。守卫里那段"按域界定、故意排除本文件"的注释要同步改写为
  "本文件已改为复用 `parseMdTarget`，纳入管辖"——**否则守卫会带着一句过时的豁免理由继续存在**，
  这正是文档与实现漂移的典型形态。
- 仍然无法覆盖的边界（裸 URL 里的未转义 `()`、角括号与标题同时出现）：**保持跳过**，不要试图"猜"。

**验证**：新增单测 3 条（标题保留 / `<...>` 目标 / 含 `)` 的目标必须**跳过且原文不变**）＋
E2E 1 条（笔记里放 `![x](<http://127.0.0.1:PORT/a b.png> "t")`，断言落盘 + 链接含编码空格 + 标题仍在）。

**风险**：`MD_IMG`/`MD_LINK` 放宽后会多识别一些原本被忽略的引用（带标题的、`<...>` 的），
可能让某些 E2E 的"未本地化外链"断言多出命中项。**先跑 `acceptance` + `real-suite` 看是否转红**，
转红则说明那些包里本就有此类引用，属**修复**而非回归。

---

## L4 清理未用：把"删除前复检"统一到同一份口径（原 P3-3）

**证据** `src/features/unused-cleaner.ts:19-26`、`:38-48`

```ts
function collectUsedSet(app: App): Set<string> {
  const resolved = app.metadataCache.resolvedLinks ...   // ← 只认 Obsidian 的解析结果
}
...
if (used.has(path)) { skipped++; continue; }
```
`resolvedLinks` **不认识** HTML 媒体标签与 frontmatter 裸路径；而孤儿判定层（`AttachmentIndex`）
是把 `resolvedLinks` 与文本扫描**合并**后才下结论的。于是"删除前复检"用的是一个**更弱的第三份口径**——
本仓库已经因为"两层口径不一致"栽过 4 次，这是第 5 个温床。

**推荐做法**：不做增量补丁，而是**直接用孤儿判定本身**做复检——一句断言就够：

```ts
async function performDelete(
  app: App,
  index: AttachmentIndex,          // 新增参数
  paths: string[],
  mode: CleanupSettings['deleteMode'],
  toast: Noticer,
): Promise<{ deleted: number; errors: number; skipped: number }> {
  // 复检 = 重跑一次索引，用与"谁是孤儿"完全相同的口径确认"现在仍然没人引用"。
  // 失败时**一律不删**（fail closed）：无法确认安全时，删除是唯一不可逆的动作。
  let stillOrphan: Set<string>;
  try {
    index.markDirty();
    stillOrphan = new Set((await index.getSnapshot()).orphanCandidates);
  } catch (e) {
    logger.error(`清理复检失败，已全部跳过：${e instanceof Error ? e.message : String(e)}`);
    reportFailures(toast, paths.length, '清理（复检失败，未删除任何文件）');
    return { deleted: 0, errors: 0, skipped: paths.length };
  }
  for (const path of paths) {
    if (!stillOrphan.has(path)) { skipped++; continue; }
    ...
  }
}
```

要点：
- `orphanCandidates` 是**未过滤排除目录**的原始集合，作为纯成员判定正合适（排除逻辑已在 `planCleanup` 做过）。
- 两处调用点（`requireConfirm` 的弹窗回调与静默路径）都要传 `index`，
  这样**确认窗与静默路径共用同一份复检**，不会再次分叉（`empty-folder-cleaner` 就是这么做的，可对齐）。
- 代价：删除前多一次全库索引构建。只在"确实有东西要删"时才发生，可接受；
  超大库若在意，可只对 `plan.toDelete` 做定向重扫——但**不建议**现在优化，先要正确性。
- 删掉 `collectUsedSet`（它被替换后即成为死代码）。

**验证**：新增用例——快照建立后往笔记里补一条**HTML 形态**的引用，再触发清理，
断言该附件**被跳过而不是删除**。当前实现在这条用例上会转红（正是要修的点）。

---

## L5 低风险顺手项

1. **`src/modals.ts:194-211`：一个弹窗里有两个 `setCta()`**（「去修复可确定断链」与「关闭」）。
   保留修复按钮为 CTA，「关闭」去掉 `.setCta()`——否则用户视觉上分不清主次，且键盘默认焦点不可预期。
2. **`tests/e2e/real-suite.test.ts:143-148`**：`skipAllCandidates()` 用"倒数第二个 CTA"定位按钮，
   与 L1.2 同源。建议按按钮文案定位（替身已能拿到 `setButtonText`），消除顺序耦合。
3. **核实后不是缺陷、无需改动**：`tests/e2e/seed-acceptance.test.ts:48` 的
   `fs.readdirSync(VAULT)` 曾被怀疑会在目录不存在时抛错，实际 `:47` 的
   `fs.mkdirSync(..., { recursive: true })` 已先建好目录，顺序正确。**记录在案，避免下一轮重复怀疑。**

---

## 6. 明确**不推荐**的做法

| 做法 | 为什么不推荐 |
|---|---|
| 把替身 `getConfig` 的默认 `attachmentFolderPath` 直接改成 `'/'` | 会让 `TEST_SETTINGS`（`mode:'obsidian'`）下所有落盘位置从 `./assets` 变成库根，**82 处断言整体失效**，等于用一次夹具地震换取覆盖；正确姿势是 L1.1 的"注入 + 专项用例" |
| 为 77 条验收用例发明一套声明式 DSL（`mustExist` / `mustNotContain` …） | 用例的预期形态差异很大，DSL 会长成一个半成品语言；`assert?: (ctx) => string \| null` 更直接，且天然允许"这条暂时不校验" |
| 给 `Notice` 替身强加 `level` 字段来测通知分级 | 真实 `new Notice(msg, duration)` 里**没有** level，分级只体现在"发不发"。加 level 是给替身发明 API，会让测试与真实语义再次脱节 |
| 在 L3 里"猜"含 `)` 的裸 URL 边界 | Markdown 本身就在这种写法上歧义；猜错就是改坏正文。跳过并如实计数是唯一安全解 |
| 顺手把 `normalizeInVault` 与 `normalizeLocal` 合并 | 两者契约**故意不同**（`string \| null` vs `string`），见 `src/core/path-compatibility.ts:115-122`。历史上已明确不合并 |

---

## 7. 每项最小验收清单（**已全部完成，见 `impl-round5-2026-09-28.md`**）

- [x] L1.1 新增 `vault-config` 专项用例 10 条全绿；`TEST_SETTINGS` 改 `'custom'` 后四个存量套件**零改动**通过
- [x] L1.2 `runCmd` 替换旧 `confirmModal`；safety-suite 与 real-suite 同步改为"命令水位窗口"+ 按按钮文案定位
- [x] L1.3 `ACCEPTANCE_ASSERTS` 集中断言表上线，日志打印 `机器校验 25 / 77`，并附"id 必须真实存在"的守卫
- [x] L1.4 按语法解析（wiki 按名/主名、md 与 html 按路径）+ 笔记被改名即报错 + 把 `.canvas` 纳入扫描
- [x] L1.5 O06/O07 改为**字节指纹**判定（夹具附件加唯一标记）；顺带修正 A13（真写 0 字节）与 A12（真的被两篇笔记引用）
- [x] L1.6 `brokenItems()` fail loud + 缺分区时报出实际分区名（自证用例已存在）
- [x] L2 五条用例（写盘失败可见 / 静默成功零提示 / 命令级异常 / 静默+关确认 / 摘要带时长）全绿
- [x] L3 单测 6 条 + E2E 1 条；`<…>` 独立分支修正；架构守卫豁免**已撤销**并新增断言
- [x] L4 复检改为 `orphanCandidates` 成员判定 + fail closed；`collectUsedSet` 已删除；新用例先红后绿
- [x] L5 `ReportModal` 双 `setCta` 去一；`skipAllCandidates` 按文案定位；`npm run typecheck` 通过

### 实施期新增的发现（超出本方案范围，已单独修复）

- **P0 真实数据损失**：canvas 引用的附件会被「收集 → 命名 → 清理」整条吃掉
  （索引层认 canvas 的 `file` 字段、改写层不认）。修复见提交 `7efe898`。
  这一条正是**被 O06 的同义反复断言掩盖**的缺陷——把"没在校验"变成"在校验"的直接收益。

### 与方案的偏差

| 原计划 | 实际做法 | 原因 |
|---|---|---|
| L1.3 把 `assert` 塞进 `AcceptanceCase` 对象 | 改为独立的 `ACCEPTANCE_ASSERTS` 表 + id 守卫 | 一眼可见"哪些还没校验"，且拼错 id 会当场报错而不是静默失效 |
| L1.3 目标 ≥25 条机器校验 | 25 条（P01 主动不设） | P01 的预期需要"逐命令观察"才能表达，在"最终状态"上下文里断言只会假红（命名功能会合法改名） |
| L1.5 只修 O06/O07 | 同时修 A12/A13 的夹具与预期不符 | 复核时发现 A12 的共享附件根本没被引用、A13 的"0 字节"实际非空 |
