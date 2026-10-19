# 2026-09-16 全面质量审计与修复（合并件）

> **性质：历史归档**——记的是"当时发现了什么、怎么修的"，结论已被后续轮次覆盖，
> **不要当作现状**。本文由 `audit-2026-09-16.md`（审计发现）与 `fix-record-2026-09-16.md`
> （A+B+C+D 的实施记录）合并而成，原文见 git 历史；只去掉两篇之间重复的交叉验证段。
> 其中的"当时的规模"等数字一概不代表当前状态——现状见 `../specs/` 与测试正本。

> 配套（未并入本文，仍在 `archive/2026-09-repair-phases/`）：三阶段总纲与逐阶段报告。
> 批次 E（features 分层重构）当时评估后**已实施**，其结论现在是
> `Attachment Suite/tests/unit/architecture.test.ts` 的 `ALLOWED_CROSS_FEATURE` /
> `CANONICAL_HELPERS` ——评估原文（`batch-e-assessment.md`）与遗留方案
> （`remaining-fixes-plan-2026-09-28.md`）已在本次重组中删除，二者内容完全被上述守卫与
> `../specs/invariants.md` §5 取代。

---

## 第一部分 · 审计发现（源：`audit-2026-09-16.md`）

- 审计日期：2026-09-16
- 审计对象：`Attachment Suite/`（plugin id `attachment-suite` v1.0.0，桌面端专用，未发布）
- 审计范围：约 5,400 行 src（48 个 .ts）+ 约 5,200 行 tests（29 个 .test.ts）+ README + docs
- 审计方式：4 路子代理并行只读审计（R1 代码质量 / R2 配置界面 / R3 命令反馈 / R4 文档一致性），主代理对高价值结论逐条亲验
- 修复档位（用户已定）：**标准档** —— 修确定性缺陷 + 必要的可维护性改造，不改用户可见行为
- 验证档位（用户已定）：**只跑关联测试 + typecheck**，不跑全量测试

---

### 0. 结论摘要

整体处于**中上水平**，但存在 **3 个必须发布前堵住的 P0**，全部集中在"**异常路径的静默**"与"**两层口径不一致**"两条老病根上。

值得一提的是：`npm run typecheck` 零错误、`core/` 保持零 `obsidian` 依赖、断链/改写/空目录三条主路径的关键不变式都守住了（`listMatches` 未按空白截断、`rewrite` 用函数式替换、`isReallyEmpty` 回查 `adapter.list`、白名单 `MANAGED_ATTACHMENT_EXTENSIONS` 作单一门槛）。**问题不在"写错了"，而在"错了没人知道"**。

| 级别 | 数量 | 性质 |
|---|---|---|
| P0 | 3 | 异常静默导致用户不知情的数据改动 / 误删风险 |
| P1 | 13 | 反馈缺失、分层违反、校验缺失、文案与行为不符 |
| P2 | 25 | 可维护性、死代码、文案规范、文档时效 |

---

### 1. 已剔除的误报（子代理幻觉，勿再采信）

| 原结论 | 裁决 | 依据 |
|---|---|---|
| R1：`manifest.json` 缺 `main` 字段 → 插件装不上（P0 发布阻断） | **误报，剔除** | Obsidian 官方 Manifest schema（docs.obsidian.md/Reference/Manifest）的 plugin 属性为 `id`/`name`/`version`/`minAppVersion`/`description`/`author`/`isDesktopOnly`（+可选 `authorUrl`/`fundingUrl`），**根本没有 `main` 字段**；入口固定为 `main.js`。当前 manifest 完全合规。 |
| R4：`features` 之间无互相 import（"已验证"） | **误报，剔除** | 实测存在 10 处互引，见 P1-4。R1 结论正确、R4 漏检。 |

> 教训：子代理的"已验证"字样不等于真验证。凡涉发布阻断 / 数据安全的高价值结论，一律由主代理回源复核。

---

### 2. P0 缺陷（3 条，均已主代理亲验）

#### P0-1 模态回调 `void cb()` 吞掉异常 —— 路径已改、引用没跟上、用户零感知
- **位置**：`src/modals.ts:74-78`（`void cb()`）、`src/features/consistency.ts:40-44`、`src/features/name-formatter.ts:78,93`、`src/features/collect.ts:57`
- **证据**：
  ```ts
  // modals.ts:74-78
  confirm.onClick(() => { const cb = this.opts.onConfirm; this.close(); void cb(); });
  ```
  ```ts
  // consistency.ts:39-45 —— 先改名，后改写引用，两步之间无保护
  const execute = async (): Promise<void> => {
    const out = await mover.moveMany(items.map((i) => ({ from: i.from, to: i.to })));
    await rewriteRefsInAllNotes(app, out.results);   // ← 若在此抛错
    index.markDirty();
    toast.summary(`路径修复：成功 ${out.results.length}，失败 ${out.errors.length}。`);
  };
  ```
- **影响**：`moveMany` 已经完成文件改名/移动，随后 `rewriteRefsInAllNotes` 抛错（笔记读取失败、权限、磁盘、极端命名等）→ 异常冒泡到 `void cb()` 被静默丢弃 → **库里路径已改、引用没更新（真实断链），且用户完全没有任何提示**。连本该报告的 `toast.summary` 也因异常提前跳出而不会执行。同一形态在 `name-formatter.ts`（改名后 `rewriteRefsInNote`）、`collect.ts`（移动后 `rewriteRefsInNote`）复现。
- **验证状态**：✅ 主代理亲验（已读 `modals.ts:60-99`、`consistency.ts` 全文、`name-formatter.ts:70-116`）
- **建议修法**：① 模态回调统一收口为 `void cb()?.catch(e => new Notice('操作失败：' + e.message, 8000))` 并写 `logger.error`；② 三个执行函数内把 `rewriteRefsIn*` 包进 `try/catch`，改写失败时以 `toast.error` 明确告知"文件已改名/移动，但引用改写失败，请运行「检查库一致性」核对"。

#### P0-2 `traceCommand` 无 `catch` —— 13 条命令异常后完全静默
- **位置**：`src/commands.ts:36-45`
- **证据**：
  ```ts
  async function traceCommand(name: string, fn: () => void | Promise<unknown>): Promise<void> {
    const t0 = Date.now();
    console.log(`[AttachmentSuite] cmd START: ${name} (${t0})`);
    new Notice(`Attachment Suite\n执行命令：${name}`, 2000);
    try {
      await fn();
    } finally {                       // ← 只有 finally，没有 catch
      console.log(`[AttachmentSuite] cmd done: ${name} (${Date.now() - t0}ms)`);
    }
  }
  ```
  13 条命令全部经此包装（`commands.ts:54/123/130/137/144/151/158/171/178/185/192/199/206`）。
- **影响**：`fn()` 抛错 → 成为未捕获 rejection，Obsidian 只在控制台记一行，**用户侧没有任何提示**。用户只会看到 2 秒的「执行命令：X」横幅然后归于平静，无法判断文件是否已被删除/改名/移动。对破坏性命令（清理未用附件、清理空附件目录、全库改名、全库本地化）而言，这是"不知情的数据改动"。
- **验证状态**：✅ 主代理亲验（已读 `commands.ts` 全文）
- **建议修法**：补 `catch(e)`，用 `createNoticer` 发 **error 级**（恒显示，不受通知级别影响）提示，文案含命令显示名与失败原因：
  `命令「${显示名}」执行失败：${msg}。已完成的改动不会被自动回滚，建议运行「检查库一致性」核对。`

#### P0-3 frontmatter 孤儿兜底与正文解析口径不一致 —— 含空格/中文名的附件可能被误删
- **位置**：`src/core/attachment-index.ts:181`
- **证据**：
  ```ts
  // managedBasenamesFromFrontmatter —— 服务于 usedByBasename 的"绝不做成孤儿"兜底（attachment-index.ts:358）
  const tokenRe = /[A-Za-z0-9_.\-/]+\.(?:png|jpe?g|gif|webp|bmp|avif|svg|mp4|mov|webm|mkv|mp3|wav|ogg|m4a|flac|pdf|docx|xlsx|pptx)/gi;
  ```
  字符类 `[A-Za-z0-9_.\-/]` **不含空格、不含非 ASCII**，且**硬编码扩展名列表**；而 `src/core/link-resolver.ts` 的 `FM_RESOURCE_TOKEN` 用 `[\p{L}\p{N}_.\-\/% ]*` 并含中文覆盖。注释自述意图是"保守匹配，**宁可多收**（数据安全）也不漏掉真实引用"，而该正则实际是**宁少收**——与自身意图相反。
- **影响**：`cover: 我的图片 1.png` 这类 frontmatter 引用，正则只能部分命中 `1.png`，真实 basename 不进 `usedByBasename`。而 Obsidian 的 `resolvedLinks` 不收录 frontmatter 裸路径引用（只有 `[[...]]` 语法才进）→ 该附件既不在"在用"集合、也不受索引保护 → **「清理未用附件」会把它当孤儿删除**。这正是项目记忆里"两层口径不一致"的历史误删模式第四次复现，且 `tests/unit/core/attachment-index.test.ts` 的 frontmatter 用例只用了无空格 ASCII 名（`assets/cover.png`），**完全没覆盖这条路径**。
- **验证状态**：✅ 主代理亲验（已读 `attachment-index.ts:170-200`、`:345-375`）
- **建议修法**：删除本地 `tokenRe`，改为复用 `link-resolver` 的 frontmatter 解析并以 `isManagedAttachment()` / `MANAGED_ATTACHMENT_EXTENSIONS` 为唯一门槛；补一条单测（frontmatter 引用含空格与中文名的附件不得判为孤儿）。

---

### 3. P1 缺陷（13 条）

#### P1-1 静默档下 13 条命令的成功/失败/零改动反馈全部消失，且破坏性失败未走 error 通道
- **位置**：`src/notify-core.ts:8-17` + 各 feature 的 `toast.summary(...)`
- **证据**：`shouldNotify('silent','summary') === false`，仅 `error` 恒真。但破坏性命令的失败计数被**并入 summary 文本**而非走 error，例如 `unused-cleaner.ts:145`「清理完成：删除 N，失败 M（排除 X，复检跳过 Y）」、`empty-folder-cleaner.ts:165`、`broken-link.ts:83`、`bulk-localize.ts:162`、`exporter.ts:115/162`。
- **影响**：用户把通知级别设为「静默」后，清理删 5 个失败 3 个也只见到 2 秒的开始横幅 —— 与 `notify-core.ts` 注释承诺的"错误任何级别都提示"直接冲突，因为**代码层面失败根本没走 error 通道**。
- **建议修法**：凡 `errors > 0` / 部分失败，额外发一条 `toast.error`（恒显示）；或在 `Noticer.summary` 内自动升级含"失败 N（N>0）"的汇总。

#### P1-2 `requireConfirm=false` 时清理无确认、且结果反馈可能被静默
- **位置**：`src/features/unused-cleaner.ts:148-155`、`src/features/empty-folder-cleaner.ts:168-171`
- **证据**：`if (cleanup.requireConfirm) { new ConfirmCleanupModal(...).open(); return; } const r = await performDelete(...)`。关闭确认开关后直接删除，且 `finish` 走 `toast.summary`（静默档消失）。两者叠加 = 无弹窗、无提示的数据删除。
- **建议修法**：`requireConfirm=false` 时至少保证结束有反馈，且失败走 error；或直接移除该开关、破坏性删除强制确认。

#### P1-3 `TaskQueue.enqueue` 返回未接 `catch` 的 Promise → 真实未处理 rejection
- **位置**：`src/core/task-queue.ts:11-19`，调用点 `src/main.ts:195/213/227`（均为 `void this.queue.enqueue(...)`）
- **证据**：
  ```ts
  const run = this.chain.then(task);
  this.chain = run.catch(() => undefined).finally(...);  // 只有 chain 接了 catch
  return run;                                            // 返回的 run 无 handler
  ```
- **影响**：`main.ts:213` 入队的是笔记改名后的 `runFollowNoteMove`，其内部 `SafeMoveEngine.move` 失败会 throw → 未处理 rejection（Electron 下会告警/可能崩溃），且用户与后台自动化均无反馈。
- **建议修法**：`return this.chain`（已吞错版）而非 `run`，约 2 行。

#### P1-4 `features` 之间互相调用，违反分层约定（10 处）
- **位置**：`automation.ts:6-8`、`bulk-collect.ts:12`、`bulk-localize.ts:18`、`bulk-rename.ts:11`、`collect.ts:10`、`consistency.ts:9`、`name-formatter.ts:10`、`note-relocator.ts:10`、`bulk-collect-core.ts:4`
- **证据**：`link-fixer.ts` 被 6 个 feature 引用、`localize-media.ts` 与 `name-formatter.ts` 各被 2 个引用（已执行层，自身 import `obsidian`）。实际依赖为 `features → features`，与约定的"features 互不依赖"不符。
- **影响**：`link-fixer` / `name-formatter` / `localize-media` 已事实成为共享执行模块，编译期易成环、重构脆、测试被迫装配 Obsidian。
- **建议修法**：把 `refMapForMoves` / `rewriteRefsInNote` / `rewriteRefsInAllNotes` 等"纯规划 + 受管改写"逻辑下沉到 `core/`（或 `features/shared/`），各 feature 只保留命令入口；并在 typecheck 或脚本里加一条"features 之间除同名 `*-core` 外不得互引"的守卫。**属较大重构，建议单独一批、排在 P0 之后。**

#### P1-5 连接符与命名用词无校验 → 可生成非法/嵌套文件名、破坏幂等
- **位置**：`src/settings-tab.ts:152-154`（连接符）、`:202-212`（6 个命名用词）；消费侧 `src/features/name-formatter-core.ts:35,81,156,173`
- **证据**：仅 `v.trim()` 后直存，无非法字符过滤。输入 `/` 时 `join(connector)` 产出 `笔记/image/001.png`，与目录拼接后**写入嵌套子目录**；输入空串时 `join('')` 无分隔且 `parseRenamed` 恒返回 `null` → **幂等性被破坏，每次运行都重新规划改名**。
- **影响**：用户按"分隔符号"理解随手输入，可能把附件散落到意外目录、或让批量命名反复执行。
- **建议修法**：输入即校验，过滤 `/ \ : * ? " < > |` 与控制字符，空串回退 `_`，非法时内联提示。

#### P1-6 父开关关闭后子设置项仍可编辑且看似生效（联动缺失，5 个能力区）
- **位置**：`src/settings-tab.ts`（各能力区）；门禁位置 `broken-link.ts:37`、`consistency.ts:28`、`note-relocator.ts:27`、`unused-cleaner.ts:129`、`empty-folder-cleaner.ts:140`、`localize-media.ts:215`、`automation.ts:45`、`main.ts:137`
- **父子关系**：启用一致性 → 7 项子设置；启用清理 → 4 项；启用统一命名 → 7 项；启用媒体本地化 → 14 项；自动处理 → 刷新间隔。
- **影响**：父开关关掉后子项仍可改，"改了没反应"，与 Obsidian 设置页惯例不符。
- **建议修法**：父开关 `onChange` 重渲染并对子项 `setDisabled(!parentEnabled)`。

#### P1-7 数字输入静默钳制，用户不知道真实生效值
- **位置**：`settings-tab.ts:279`（`timeoutMs` < 1000 静默变 30000）、`:257`（`minSizeKb` 负数被存为负，仅消费侧 `Math.max(0,·)` 兜底）、`:134`（`interval` 空→5、负数→1）
- **影响**：用户以为设了 500ms 超时，实际 30s；配置里残留非法负值。
- **建议修法**：越界时内联提示并说明回退值；写盘前钳制。

#### P1-8 清理「排除目录」描述与子开关行为冲突（有误删级误导）
- **位置**：`settings-tab.ts:492-493`（文案「这些文件夹下的文件…绝不会被清理」）vs `src/features/unused-cleaner-core.ts:11-28`（`excludeSubfolders=false` 时仅豁免该目录**本身**，子目录**不豁免**）
- **影响**：用户把 `assets/keep` 加进排除目录、误以为 `assets/keep/sub/x.png` 也安全，实际会被删。同页子开关「排除目录含子目录」自己写明"关闭则只豁免列出的目录本身"，**父子文案自相矛盾**。
- **建议修法**：父项描述改为「仅列出的目录本身（不含子目录，除非开启下方「排除目录含子目录」）绝不会被清理」。

#### P1-9 单篇版本异常吞掉，与全库版本不对称
- **位置**：`name-formatter.ts:93`（裸奔）vs `bulk-rename.ts:74-83`（有 try/catch + errors 计数）；`collect.ts:57` vs `bulk-collect.ts:68`
- **影响**：全库改名出错有计数与汇总，单篇改名出错则彻底无声（并触发 P0-1）。
- **建议修法**：单篇与全库对齐，包 try/catch 并 `toast.error`。

#### P1-10 导出失败无 error 提示
- **位置**：`src/features/exporter.ts:27-35`（`saveZip` 无 try），调用 `:113`/`:160`
- **影响**：`vault.createBinary` 失败（磁盘满/权限）→ 冒泡至无 catch 的 `traceCommand` → 用户零反馈。
- **建议修法**：两个导出入口整体 try/catch，失败发 `toast.error('导出失败：' + msg)`。

#### P1-11 「详细」通知档是死档，从未被使用
- **位置**：`src/notify.ts:14-15`（`info` 定义）；全仓 `toast.info(...)` **零调用**
- **影响**：设置页承诺的"详细：显示更多过程信息"落空，`verbose` 与 `summary` 实际等价。
- **建议修法**：在长任务/分批处理处补 `toast.info` 过程提示，或如实改为两档。

#### P1-12 README 命令 ID 缺插件前缀，按表使用会失效
- **位置**：`README.md:97-109`（示例 `attachment:localize-note`）
- **反证**：Obsidian 实际命令 id 为 `attachment-suite:attachment:localize-note`（`main.ts:71` 注册时由插件 id 自动加前缀）。
- **建议修法**：补全前缀或加一行"下表为插件内 id，完整 id = `插件id:` + 该值"。

#### P1-13 docs 两处过时断言，与 README 及代码矛盾
- **位置**：`docs/command-inventory.md:160`（称 #1 检查库一致性"索引不排除 → 报告仍可能列出排除目录内的未用附件"）、`docs/test-repair-plan.md:54`（称 `check-consistency` 索引不读 `paths.exclude`，属"已记录项"）
- **反证**：`src/commands.ts:68-72` 已按 `paths.exclude` 过滤，且 `README.md:55` 明确写"报告会按全局排除目录过滤"。**代码与 README 均已正确，只有这两份工作文档没跟上。**
- **建议修法**：删掉/翻转这两处标注，注"已修复（commands.ts:68）"。

---

### 4. P2 问题（25 条，按主题归并）

**反馈与文案**
1. trace 内部名与命令面板名不一致 7 处（`commands.ts:54/137/158/171/178/199/206`，如面板"重命名当前笔记附件" vs 横幅"统一命名"）→ 用户对不上号。
2. 反馈前缀双轨：横幅与自动化/加载带 `Attachment Suite\n` 前缀，`createNoticer` 生成的不带 → 同会话两种风格，且该前缀在新版 Obsidian 属噪音。
3. `traceCommand` 注释自称"调试"却为所有正式命令必经，且横幅硬编码 2000ms、不走 `effectiveDuration`、不受通知级别控制。
4. `ReportModal` 导出报告走裸 `Notice`（`modals.ts:207/209`），未接入 `Noticer` 体系。
5. 部分失败只报计数不列文件（失败路径仅进 `logger.error`），用户无法定位哪几个失败 → 建议附"详情见控制台"或写入可查看报告。
6. 长任务无进度、不可取消：全库命令在确认前 `getSnapshot() + plan`（大库数秒）期间只有 2 秒横幅；确认后串行循环无中止入口。
7. 内部术语泄漏：`unused-cleaner.ts:145` 的「复检跳过 N」对普通用户不可理解。
8. ReportModal 的"修复断链"快捷入口（`commands.ts:83`）紧接报告关闭触发破坏性操作，建议保留二次确认。

**代码质量**
9. 生产残留调试 `console.log`：`main.ts:50/81/84/146/187/193/199`、`automation.ts:41/52`，与 `logger` 分级体系双轨。
10. 重复实现：`broken-link-core.ts:60-67` 自造 `extOf`/`basenameOf`/`normalizeJoin`，而 `core/types.ts:105`、`attachment-index.ts:471`、`:108` 已有 → 正是口径漂移的温床。
11. 死代码：`core/result.ts` 整套 `Result`/`PluginError`/`ok`/`err` 除定义与自身单测外零使用（设计意图未落地）；`type-classifier.ts:222` `isCategory` 零使用。
12. 死配置：`settings.ts:27,153` 的 `desktopOnly` 字段无任何运行时读取（插件已用 `isDesktopOnly` 声明）→ 建议删除。
13. `attachment-index.ts:44` `embedRegex` 的 markdown 分支仍用 `([^)\s]+)` 空白截断反模式（与 `scanUnresolvedBreaks`、`link-resolver.ts:33` 的 `[^)]*` 不一致）。**仅影响 `Reference.kind` 标注，不进孤儿/断链判定，故非数据风险**，但属明令禁止的写法且无测试。
14. `tsconfig.json` 未开 `noUncheckedIndexedAccess` / `noImplicitOverride`；多处靠 `as string` 掩盖（`broken-link-core.ts:240,246`、`bulk-collect-core.ts:47`，当前均有 `size===1` 前置保护）。
15. `notify.ts` / `reveal-ref.ts` 直接 import `obsidian`，弱化"`obsidian-domain.ts` 是唯一适配层"的约定。
16. `link-resolver.ts:321` `text.replace(block, next)` 未用函数式，若路径含 `$&`/`$1` 会被当替换模式（极罕见）；`:232-241` 逐次 `replace` 在正文存在完全相同的重复链接时可能重复命中首处。
17. 多处 `void` 丢弃 Promise（`broken-link.ts:89,105`、`commands.ts:84,102`）→ 用户触发的动作失败无反馈（与 P0-1/P0-2 同源）。

**配置界面**
18. 术语不统一：「未用」/「未使用」/「孤儿」三词混用（`settings-tab.ts:104`、`commands.ts:80`、`modals` 分区标题）。
19. 缺 Obsidian 惯例元素：设置页无顶部插件说明段落、无「恢复默认值」入口。
20. 「路径修复的目标系统」下拉的 `current` 项与单平台项在对应平台上完全等价，用户困惑（`settings-tab.ts:418-427`）。
21. 「扩展扫描」描述漏说：frontmatter 中的裸外链媒体**始终**会被本地化（`localize-media-core.ts:79` 在 `if (scanExtended)` 之外）。
22. 「本地化网络 URL」「扩展扫描」的"第一步/第二步"编号与 UI 实际顺序相反（`settings-tab.ts:228/238`）。
23. 「名称带类型类别」示例把 pdf 标为「文档」，与独立类别 `document` 撞名（`settings-tab.ts:172`）。
24. 样式核查结论（正面）：`iap-settings-section-hint` 在 `styles.css:331` 有定义且语义一致，无指向不存在 class 的孤立设置页样式。

**文档**
25. 文档时效与措辞：`tests/e2e/acceptance-fixture.ts:60` 注释写"≥74 条"实为 **77 条**；`test-repair-plan.md:49` 写"24 文件/318 用例"而实际 **29 个 .test.ts**；README `:192` 与 `test-repair-plan.md:47` 的架构箭头方向**互相矛盾**；README `:163` 把「下载重试次数」与「单文件下载超时」并为一项而 UI 是两行。

---

### 5. 建议修复批次（待你圈定）

| 批次 | 内容 | 理由 |
|---|---|---|
| **批次 A（必修）** | P0-1、P0-2、P0-3 | 前两条是"异常静默"，第三条是误删风险；三者共用"补错误反馈 + 统一口径"的思路，可一并改 |
| **批次 B（必修）** | P1-1、P1-2、P1-3、P1-9、P1-10、P1-11 | 反馈体系补全，与批次 A 同源，一并做最省事 |
| **批次 C（建议修）** | P1-5、P1-6、P1-7、P1-8 | 配置界面的"会按设置悄悄做错事"，其中 P1-8 有误删级误导 |
| **批次 D（文档）** | P1-12、P1-13 + 全部 P2 文档类 | 零风险、纯文本 |
| **批次 E（重构，可选）** | P1-4 features 分层 + P2 的重复逻辑/死代码/tsconfig 加严 | 收益明确但改动面大，建议单独一批、最后做，或本轮先不做 |

### 6. 待你确认

1. **圈定批次**：A+B（最小必要）？A+B+C+D（推荐）？还是全部含 E（含架构重构）？
2. **P2 是否全做**：P2 有 25 条，其中"文档类"几乎零风险建议做；"代码质量类"（重复逻辑、死代码、tsconfig 加严）改动面较大，是否本轮一并处理？
3. **`desktopOnly` 死字段与 `result.ts` 死代码**：删除（未发布，无迁移负担）还是保留待用？
4. 确认后我按批次执行修复，每批完成后跑关联用例 + `typecheck`，最后统一提交并出修复记录。

---

## 第二部分 · 修复实施记录（源：`fix-record-2026-09-16.md`）

对应审计报告：`docs/audit-2026-09-16.md`。
用户圈定范围：**批次 A+B+C+D**（不含批次 E 的 features 分层重构、死代码清理、tsconfig 加严）。
修复档位：标准档（修确定性缺陷 + 必要的可维护性改造，不改用户可见行为）。
验证档位：只跑关联测试 + typecheck（未跑全量 `npm test`）。

---

### 0. 修复前的交叉验证（剔除了一个 P0 误报、纠正了一个漏检）

| 项 | 裁决 |
|---|---|
| R1 报「`manifest.json` 缺 `main` → 插件装不上」 | **误报，未改**。官方 Manifest schema 无 `main` 字段，入口固定 `main.js` |
| R1 报「features 存在互引」vs R4 报「无互引」 | **R1 对**（实测 10 处）。属批次 E，本轮未改，已在报告中留档 |
| R1 报「`TaskQueue.enqueue` 返回值未接 catch」 | 成立，但**改法取"修调用方"而非改契约**——见 §2.3 |

`desktopOnly` 死字段与 `core/result.ts` 整套死代码属批次 E，本轮**未删除**。

---

### 1. 批次 A：3 个 P0

#### A1 命令级异常不再静默（P0-2）
`src/commands.ts` 重写命令登记方式：

- 命令先以 `{ id, name, run }` 定义，再统一包一层 `traceCommand`。**开始提示的名字与命令面板名由同一个 `name` 派生**，从结构上消除"内部代号与面板名不一致"（原实现给每条命令手写内部名，7 处对不上）。
- `traceCommand` 补 `catch`：失败走 `error` 级提示（**任何通知级别都显示**）+ `logger.error`，提示里给出下一步动作。
- 开始提示改走 `info` 级：它本就是过程信息，只在「详细」档出现——这同时让设置项「详细：显示更多过程信息」的承诺成立（此前 `info` 通道零调用，那一档与「仅摘要」完全等价）。
- 原实现的两条 `console.log`（自称"调试"）改为走 `logger`。

#### A2 弹窗回调异常不再被丢弃（P0-1）
`src/modals.ts` 新增 `runConfirmed(label, cb)`，替换 3 处 `void cb()`：

- `ConfirmChangesModal` 的确认按钮；
- `ReportModal` 的「去修复可确定断链」；
- `CandidateSelectModal` 的 `onDone`。

并新增 `rewriteRefsSafely()`（`src/features/link-fixer.ts`），把"改完文件之后的引用改写"包住。**这是本次最危险的一条**：`consistency.ts` 先 `moveMany` 改名全部路径、再 `rewriteRefsInAllNotes`；中间抛错会一路冒到弹窗回调被吞掉，结果是"路径已改、引用没跟上（真实断链）、用户零反馈"。现在该步骤失败会明确告知"已改名 N 个但引用改写未完成，请运行「修复断链」"，同时照常报告移动统计。

`consistency.ts` / `name-formatter.ts` / `collect.ts` 三处同步处理（含单篇↔全库不对称，P1-9）。

#### A3 frontmatter 引用口径统一（P0-3）
- `src/core/link-resolver.ts` 新增 `listFrontmatterResourceTokens(text)`，与 `rewriteFrontmatter` **共用同一个 `FM_RESOURCE_TOKEN`**。
- `src/core/attachment-index.ts` 的 `managedBasenamesFromFrontmatter` 删除自带的窄正则（`[A-Za-z0-9_.\-/]` + 硬编码扩展名），改用上面的共享解析 + `isManagedAttachment` 门槛；原始写法与 `%xx` 解码写法都纳入。
- 影响：含空格/中文名的 frontmatter 引用（如 `cover: assets/我的 图片.png`）此前既不被认作"在用"、Obsidian 的 `resolvedLinks` 又不收录裸路径 → 会被「清理未用附件」当孤儿删掉。现已消除。
- **补了回归用例**（此前该路径零覆盖）：`tests/unit/core/attachment-index.test.ts` 新增「frontmatter 引用含空格/中文名的附件同样不判为孤儿」。

顺带在同一主题下修掉两处同族写法（原报告 P2-13 / P2-16）：
- `attachment-index.ts` 的 `scanNoteText` 删除按空白截断目标的 `embedRegex`，改走 `listMatches`（保持原有语义：只认嵌入形态）；
- `link-resolver.ts` 的 `rewriteFrontmatter` 末尾改用函数式替换，避免新目标含 `$&`/`$1` 时被当成替换模式展开。

---

### 2. 批次 B：反馈体系（P1-1/2/3/9/10/11）

#### 2.1 失败不再被「静默」吞掉
`src/notify.ts` 新增 `reportFailures(toast, count, what)`：失败数 > 0 时补一条 `error` 级提示。
此前破坏性命令一律把"失败 N"混在 `summary` 文本里报，而 `shouldNotify('silent','summary') === false` —— 用户在「静默」档下对失败一无所知，与 `notify-core` "错误任何级别都提示"的承诺直接相悖。

接入点：清理未用 / 清理空目录 / 命名（单篇+全库）/ 收集（单篇+全库）/ 路径修复 / 断链修复 / 本地化（单篇+全库）/ 导出。

#### 2.2 「无确认的删除」必定有一次可见结果
`unused-cleaner.ts` / `empty-folder-cleaner.ts`：当「删除前确认」被关闭时，完成结果额外发一条**不受通知级别影响**的提示。否则"通知级别=静默" + "关闭删除前确认"叠加 = 一次完全无人知晓的数据删除。
两个清理弹窗的 `async onClick` 也补了 try/catch（Obsidian 不 await 按钮回调，异常同样会变成未处理 rejection）。

#### 2.3 后台队列任务失败可见
`src/main.ts` 新增 `reportBackgroundError()`，接到 `sweepAuto`（自动处理）与 `onRename`（笔记移动跟随附件）两处 `queue.enqueue(...)` 的 `.catch` 上。
**未改 `TaskQueue.enqueue` 的返回契约**：`tests/unit/core/task-queue.test.ts` 有一条用例显式断言 `await expect(bad).rejects.toThrow('fail')`，即"失败要能被调用方观察到"是既有设计意图；真正的缺陷是调用方一律 `void` 丢弃。故选择修调用方 + 在 `enqueue` 上补文档化警告。

#### 2.4 导出失败可见（P1-10）
`src/features/exporter.ts` 两条导出链路的 `saveZip` 包 try/catch，失败发 `error` 级提示（含可行动建议）。

#### 2.5 「详细」档不再是死档（P1-11）
`src/notify.ts` 新增 `reportProgress(toast, done, total, what)`：步骤取 `max(10, 总数/10)`，一条长任务最多约 11 条进度提示。接入全库命名 / 全库收集 / 全库本地化 / 断链修复四个串行循环。
配合 §1 的开始提示改走 `info`，三档语义现在是真实的：静默=只出错；仅摘要=结果；详细=结果+过程。

---

### 3. 批次 C：配置界面（P1-5/6/7/8 + 若干 P2 文案）

#### 3.1 连接符与命名用词的片段清洗（P1-5）
`src/features/name-formatter-core.ts` 新增 `sanitizeNameFragment(raw, fallback)`（剔除路径分隔符、Windows 保留字符、控制字符），并在 `planForSnapshot` 里对 connector 与类别用词统一归一化。
这是**最后一道防线**：即使配置被外部改写（手工改 `data.json`、旧配置迁移），命名也不会做出越界的事 —— 原实现下把连接符填成 `/` 会把附件写进嵌套子目录，填成空串则 `parseRenamed` 恒返回 null，已命名附件永远识别不出来、每次运行都重新规划（幂等被破坏）。
设置页另有一层输入清洗，把纠正后的值**当场回写输入框**，让用户立刻看到实际生效值。
**补了用例**：`tests/unit/features/name-formatter-core.test.ts` 新增「连接符/命名用词含路径分隔符或为空时被归一化」。

#### 3.2 父开关联动（P1-6）
`src/settings-tab.ts` 新增 `gatedSection(host, enabled)` + `applyGates()`：父开关关闭时统一禁用其下控件并降低不透明度（`styles.css` 新增 `.iap-settings-gated-off`）。
覆盖 6 个联动区：自定义附件目录、自动化、命名、本地化、一致性、清理。父开关自身不在联动区内，因此始终可编辑（用户能把它开回来）。
连带把「自定义附件目录」从"条件渲染"改为"始终渲染 + 按来源禁用"——比隐藏更易被发现。

#### 3.3 数字输入「看到的 = 生效的」（P1-7）
`src/settings-tab.ts` 新增 `bindNumber()`：输入过程不打断（避免边打边跳），**失焦时把实际生效值回写到输入框**。
同时补上「最小文件大小」缺失的负数钳制（原实现把负数直接存进配置，只靠消费侧兜底）。
各数字项的归一化规则与改动前一致，未改变生效行为；每条描述都补充了越界处理说明。

#### 3.4 文案订正
- 「排除目录」描述与子开关行为矛盾（P1-8）：原文案暗示含子目录，实际 `excludeSubfolders=false` 时**不豁免子目录** → 用户会误以为 `assets/keep/sub/x.png` 安全，实际会被删。已改为明确写出"默认只豁免列出的目录本身"并指向下方开关。
- 「名称带类型类别」示例 `pdf（文档）` 与独立类别 `document` 撞名 → 改为 `pdf（PDF）`（P2-23）。
- 「本地化网络 URL」「扩展扫描」的"第一步/第二步/第三步"序数与界面排列顺序相反 → 改为按名称描述链路（P2-22）。
- 「扩展扫描」补注：frontmatter 里的媒体外链**始终**会被识别，不受该开关影响（P2-21）。
- 「路径修复的目标系统」说明「仅当前系统」等价于下方对应平台项（P2-20）。
- 通知级别描述补充"失败提示在任何级别都会出现"。
- 设置页顶部补一段总览说明（P2-19 的前半；"恢复默认值"按钮属新增能力，本轮未做，留待批次 E 或后续）。
- 术语统一（P2-18）：用户可见处一律用「未用」（与命令名「清理未用附件」「导出未用附件」一致），不再混用「未使用 / 孤儿」。

---

### 4. 批次 D：文档（P1-12 / P1-13 + P2 文档类）

- `README.md`：
  - 命令一览补全命令 id 使用说明（表内为插件内 id，完整 id = `attachment-suite:` + 该值）；
  - 依赖方向订正为 `core ← obsidian-domain ← features`（原文 `infra ← core ← features` 会读成 core 依赖 infra，与实现相反）；
  - 错误模型表述订正：`core/result.ts` 的 `Result` 是供纯逻辑层表达可恢复失败的设计，**运行时执行层目前以异常 + 统一反馈处理**，迁移到 `Result` 属后续计划（原文写"统一 Result"，与实现不符）；
  - 本地化设置项「重试与超时」拆回「重试次数 / 超时」，与界面两行对应；
  - 术语与通知级别说明同步。
- `docs/command-inventory.md`：删除「#1 检查库一致性 索引不排除 → 报告仍可能列出排除目录内的未用附件」的过时标注（代码已按 `paths.exclude` 过滤，README 亦如此描述）。
- `docs/test-repair-plan.md`：测试规模由「24 文件 / 318 用例」更新为实测「29 文件 / 363 个 `it()` 声明」；「已知已记录项 ①」标注为已核验不成立。
- `tests/e2e/acceptance-fixture.ts`：注释「≥74 条」订正为实测 **77 条**。
- `tests/e2e/real-suite.test.ts`：报告分区标题断言随术语统一更新为「未用附件」。

---

### 5. 新增测试覆盖

| 文件 | 内容 |
|---|---|
| `tests/e2e/settings-tab.test.ts`（新） | 设置页此前**零覆盖**。10 条用例锁定：渲染不抛错、6 个联动区、父开关联动（含"父开关自身仍可编辑"与"重开后恢复"）、连接符/命名用词清洗与回写、数字越界失焦回写、负数钳制、间隔留空回退 |
| `tests/e2e/infrastructure.ts` | 测试替身升级以支撑上述用例：`FakeEl.toggleClass/hasClass/dispatch`、`querySelectorAll` 同时支持类名与标签名、`Setting.addText/addToggle/addDropdown/addSlider` **按真实 Obsidian 语义回调组件**（此前回调被丢弃）、`PluginSettingTab.containerEl`、`registry.textInputs` |
| `tests/unit/core/attachment-index.test.ts` | 新增 frontmatter 含空格/中文名的防误删回归 |
| `tests/unit/features/name-formatter-core.test.ts` | 新增连接符/命名用词清洗与幂等回归 |

---

### 6. 验证结果

- `npm run typecheck`：**0 错误**。
- 关联测试（全部单测 + real-suite / report-accuracy / safety-suite / acceptance / scale / settings-tab）：
  **29 个文件、373 个用例全部通过**（原 363 + 新增 10）。
- 未执行：全量 `npm test`（含 `seed-acceptance`，会重写本地验收库）、`npm run build`、真实 Obsidian CDP 验收。

### 7. 本轮明确未做（留档）

- 批次 E：`features` 之间互引（10 处）的分层重构、重复逻辑收敛（`broken-link-core` 自造 `extOf`/`basenameOf`）、死代码删除（`core/result.ts`、`isCategory`、`settings.localize.desktopOnly`）、`tsconfig` 加严（`noUncheckedIndexedAccess` 等）、生产 `console.log` 清理（`main.ts`/`automation.ts`）。
- 设置页「恢复默认值」入口。
- 长任务可取消。
- `ReportModal` 导出报告走裸 `Notice`（未接入 `Noticer` 体系）。

---

## 批次 E（同日追加，用户圈定 1–6 项 + 删除 `result.ts`）

依据 `batch-e-assessment.md` 的实测结论执行。4 次提交，各自自洽：

| commit | 主题 |
|---|---|
| `16845cc` | refactor: 收敛 features 横向互引与重复实现，修正 extOf 语义分歧（E1 + E2） |
| `680a747` | chore: 清理运行时零引用的死代码与死配置（E3） |
| `38d66e6` | chore: 开启两项零成本严格选项，并把生产 console 归口到 logger（E4a/E4b + E5） |
| `31e8344` | test: 新增架构守卫（§5 的配套件） |

### E1 · features 横向互引收敛

实测 8 条跨 feature 边，其中 **5 条指向同一个 `link-fixer`**（唯一被当"共享执行模块"用的 feature）。按性质拆分归位：

| 内容 | 性质 | 归位到 |
|---|---|---|
| `refMapForMoves`（纯函数） | core | `core/link-resolver.ts` |
| `rewriteRefsSafely` / `rewriteRefsInNote` / `rewriteRefsInAllNotes`（依赖 `App`） | infra | `obsidian-domain.ts` |

删除 `features/link-fixer.ts` 与 `features/link-fixer-core.ts` 两个文件，5 个引用点（`collect`/`consistency`/`bulk-collect`/`note-relocator`/`name-formatter`）改向。

跨 feature 边 8 → **3**；剩下的 3 条（`automation`/`bulk-rename`/`bulk-localize` → 单篇执行层）属**纵向编排**，按评估结论不消灭。实测零循环，本次不修也不会坏——价值是掐掉"共享模块长大→长出环"的路径。

### E2 · 重复实现收敛（含一处实现分歧）

收敛清单（全部落到 core）：`basenameOf` ×7、`decodeLink` ×2、`dirOf`/`parentOf` ×2、路径归一化 ×2。

- `core/types.ts` 新增 `basenameOf` / `dirOf`；
- `decodeMdTarget` 更名为 `decodePercentEncoded` 并导出（全仓唯一百分号解码）；
- `normalizeInVault` 从 `attachment-index` 私有提升到 `path-compatibility`。

**核心发现（不是纯重复）**：`core` 的 `extOf` 在整条路径上取 `lastIndexOf('.')`，`broken-link-core` 那份先取 basename，实测分歧：

| 路径 | core（旧） | broken-link（旧） |
|---|---|---|
| `docs/v1.2/README` | `"2/readme"` | `""` |
| `assets/a.png/file` | `"png/file"` | `""` |

core 那份是错的，当前没出事纯属侥幸（垃圾串喂 `isManagedAttachment` 恰好也是 false）。但 `broken-link-core` 用 `!extOf(t)` 判定"无扩展名短名引用"并据此把 `pic` 扩展成 `pic.png`/`pic.jpg` 参与候选匹配，拿到垃圾串会**静默跳过扩展**。故先按 basename 语义修正 core 版，再收敛，并核对两处行为敏感点后确认行为不变。

另把 `normalizeLocal` 与 `normalizeInVault` 的**契约差异**写成显式注释（前者越界 `..` 静默丢弃、返回 `string`；后者越界返回 `null` 用于路径穿越判定），明确"不要合并"——评估阶段曾误判两者等价，此处纠正。

### E3 · 死代码清理

| 项 | 实测 | 处置 |
|---|---|---|
| `core/result.ts`（`Result`/`PluginError`/`ok`/`err`…，52 行） | 运行时零引用 | 删除（含自身单测、`core/index.ts` 的 re-export） |
| `type-classifier.ts` 的 `isCategory` | 生产零引用，仅自测 | 删除 |
| `settings.localize.desktopOnly` | 运行时零读取 | 删除（含 3 处测试夹具） |

README 的「错误模型」条目同步改写为**实际做法**（异常承载 + `traceCommand`/`runConfirmed`/`reportBackgroundError` 三处统一收口，失败提示不受通知级别影响）。

### E4 / E5 · 严格选项与日志归口

- `noImplicitOverride`：实测 **14 处**，全部补齐（`Modal.onOpen/onClose` 10、`Plugin.settings/onload/onunload` 3、`PluginSettingTab.display` 1）。价值：Obsidian 基类方法改名/消失时，没有 `override` 会静默变成普通方法。
- `noFallthroughCasesInSwitch`：实测 0 处，免费开启。
- **`noUncheckedIndexedAccess` 明确不开**：实测 187 处，大量集中在 `hasher`/`zip`/`type-classifier` 这类下标访问本质不受检的位置，加了只会刷 `!` 并掩盖真正需要判空的少数位置。
- 生产 `console.*` 11 处（`main.ts` 8、`automation.ts` 3）→ **归口 `logger`，不删除**。其中 onload 的开始/完成/失败是作者刻意留的"排查代码是否真的加载"手段；按噪音分级（高频事件走 `debug`，加载结果与失败走 `info`/`error`），保留能力且受 `setLogLevel` 门控。`src/` 内现除 `logger.ts` 的 sink 外无 `console` 调用。

### §5 配套件 · 架构守卫（`tests/unit/architecture.test.ts`）

四条不变式（详见文件头注释）：core 完全自包含 / features 的 `*-core` 保持纯逻辑 / 跨 feature **执行层**依赖逐条白名单（横向共享不许，纵向编排放行）/ 通用工具只允许一处实现 + core 内不得复活两种旧写法。

**守卫自己抓出了 3 处需要定性的问题**，其中两处证明"按域界定"优于一刀切：

1. `localize-media-core` 的 `MD_IMG`/`MD_LINK` 也是 `([^)\s]+)` 形态 —— 但它解析的是**外部 URL**，URL 不含字面空格，而"截到空白为止"正是用来剥掉 `![x](url "标题")` 标题段的，属该域的刻意选择；
2. 同文件的 `nameHintOf`/`decodeDataUri` 也调 `decodeURIComponent` —— 解的是 URL 末段与 data-URI 载荷，且 `nameHintOf` 失败回退 `alt/image` 的语义与 `decodePercentEncoded` 不同，强行合并会改行为；
3. `attachment-index` 被命中是因为**注释里引用了旧正则**。

故：旧写法检查**按域收窄到 `core/**`**，并加注释剥离（避免误伤文档性引用）。排除理由都写进了用例注释——否则守卫会因误报被关掉，反而失去意义。

**反向验证**：注入一条跨 feature 依赖 + 一份 `basenameOf` 重复实现，确认 2 条用例如期失败；清理后恢复通过。不会失败的守卫没有价值。

### 验证

- `npm run typecheck`：**0 错误**（且在新开启的严格选项下）。
- 关联测试（全部单测 + real-suite / report-accuracy / safety-suite / acceptance / scale / settings-tab）：
  **28 个文件、368 个用例全部通过**。
- 未执行：全量 `npm test`（含 `seed-acceptance`）、`npm run build`、真实 Obsidian CDP 验收。

### ⚠️ 过程中的两次工作树事故（务必留档）

本批次实施期间，`src/` 两次整体从工作树消失（第一次 `src` + `tests` 共 84 个文件，第二次 `src` 46 个文件），两次**都紧跟在 `git rm` 命令之后**：

- 已排除的仓库侧原因：无 hooks（仅 `.sample`）、无 alias、`.gitignore` 不涉及 `src`/`tests`；
- 已排除的通用 git 行为：单独执行 `git status` 等命令不会触发；
- 现象：`git rm <显式路径>` 返回 0 并正确暂存了目标文件的删除，但同目录下的**其它**文件（乃至同级目录整体）也从工作树消失，`ls` 确认物理不存在。

**恢复方式**：两次 HEAD 均完好，`git checkout HEAD -- "<path>"` 即可无损恢复（无未跟踪文件、无 stash，故无内容被覆盖）。损失仅为当次未提交的编辑，已重做。

**规避措施（已执行）**：改用普通 `rm` 删除文件，交付时由 `git add -A` 记录删除；并且**每完成一组就立即提交**，把再次发生的爆炸半径压到最小。后续在本环境操作仓库时，建议继续遵守这两条。

（原因未定位到文件系统层以下的确定性证据；若再次出现，建议排查该目录是否被同步盘/杀软/沙箱接管。）
