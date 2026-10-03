# 第 4 轮复查：代码结构 / 文档 / 功能 / 逻辑（2026-09-28）

> 对象：Obsidian 插件 **Attachment Suite**（`attachment-suite` v1.0.0）
> 范围：代码质量与结构、文档完整性与准确性、功能实现正确性、逻辑合理性；四维交叉
> 方法：静态审计（源码逐文件阅读）+ 两个只读子审计（文档一致性、测试有效性）+ **变体测试**验证新守卫是否真的会红
> 基线：`npm run typecheck` 通过、架构守卫 7/7、全部 E2E 套件绿

---

## 0. 结论

本轮**未发现新的 P0（数据损坏 / 静默失败）缺陷**——前三轮（`review-phase1/2/3.md`）
把数据安全类的坑基本填平了。本轮的价值集中在三处：

1. **测试安全网存在"守卫失效"**：最关键的几条守卫（HTML 引用的改写责任、设置页联动）
   因替身比真实 Obsidian 更强而**不可证伪**。已修替身 + 补用例，并用变体测试证明会红。
2. **两处"设置项承诺了却不生效"**：改「自动处理刷新间隔」必须重载插件才生效；
   路径修复的目标下拉会把界面表达不出的组合谎报为「全平台」。
3. **四份文档与实际实现不一致**（其中两处是同文档内部自相矛盾，会误导安全评审）。

另清理了两处死代码，修正了一处返回值失真与一处计数失真。

---

## 1. 问题清单与分级

### P1 — 功能缺陷 / 安全网失效

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| P1-1 | **E2E 依赖公网**：用例直接写死第三方站点 `https://www.acofork.com/...` | `tests/e2e/real-suite.test.ts` 第 4 组 | 离线 / CI 必然红；目标站改版或返回 HTML 时结论漂移。**实测在本机已红**（`fetch failed`）。测试套件不可复现 |
| P1-2 | **替身代插件干了活**：`fileManager.renameFile` 复用插件的 `rewrite()`，连 HTML 标签一起改写 | `tests/e2e/infrastructure.ts` | 真实 Obsidian 的联动改写**不认识** `<img src>`。替身替它改对 → 插件即便完全不处理 HTML 引用，`safety-suite` 的守卫用例照样绿。**这正是本仓库第 4 次误删级缺陷的守卫点** |
| P1-3 | **设置页三联动控件不可驱动**：`addToggle/addDropdown/addSlider` 的 `onChange` 是空实现 | `tests/e2e/infrastructure.ts` | `settings-tab.ts` 里所有 `.onChange(...)` 回调体（含 `this.save()`、`this.applyGates()`）**一次都没被执行过**；"父开关联动""改设置不落盘"无法被测出。`settings-tab.test.ts` 的 `savedCount` 被构造却从未断言 |
| P1-4 | **改「自动处理刷新间隔」不生效**：`setInterval` 周期在创建时固定，改设置不重装定时器 | `src/main.ts`、`src/settings-tab.ts` | 用户改完不见任何变化，需重载插件——典型的"设置项承诺了却不生效" |

### P2 — 正确性 / 一致性 / 可维护性

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| P2-1 | 路径修复下拉按"长度≠1 就当全平台"取值 | `src/settings-tab.ts` | 存量配置为 `['windows','mac']` 时显示为「全平台」，但实际只按两平台判定 → "看到的 ≠ 生效的" |
| P2-2 | `runRepairPaths` 静默路径返回 `errors: 0` 硬编码 | `src/features/consistency.ts` | 改名失败也报零错误，与"失败必须可见"的承诺相悖 |
| P2-3 | `performEmptyFolderDelete` 的 `skippedNotEmpty` 逐轮累加 | `src/features/empty-folder-cleaner.ts` | 只含 `.DS_Store` 的 1 个目录会被迭代重规划反复带回 pool，报成 N 个，用户以为漏删是 bug |
| P2-4 | 死代码：`VaultAdapter.readHead` / `exists` / `read` | `src/core/types.ts`、`src/obsidian-domain.ts` | `src/` 内零调用。`readHead` 的实现是"整文件读完再切片"，却容易被当成"流式读取"（下载前体积预探实际走 HEAD 请求） |
| P2-5 | 死字段：`ScanResult.broken` 恒为空 | `src/core/attachment-index.ts` | 重构残留；消费点 `if (scan.broken.length)` 是永不进入的分支 |
| P2-6 | README 架构树仍写 `core/ # Result 错误模型` | `README.md` | 与**同一文档**第 193 行「`Result`/`PluginError` 已作为死代码删除」直接矛盾 |
| P2-7 | 威胁模型 4 处过时且自相矛盾 | `security-threat-model.md` | ① `:6` 速览称"实现也未包含私网 IP 拦截"，与 §4/§5 及代码（`isBlockedHost` 默认开）相反；② `:24` 数据流写"100MB 上限（事后）"，与 §4/§5 记载的下载前 HEAD 预探矛盾；③ `:145` 加固表称类别白名单"默认含 document/webpage"，实际 `webpage` 已从默认值与面板移除；④ `P2-11`/`P2-12` 已完成却仍标 `[ ]` |
| P2-8 | 命令清单写错平台默认值 | `command-inventory.md:52` | 写"默认 windows/mac/linux"，实际是 `[currentPlatform()]`（仅当前系统）——该文件自称"源码依据"，错误数值直接误导 |
| P2-9 | 验收用例类别表行和 87 ≠ 合计 77，且有两个类别名不存在 | `review-phase3.md:28-38` | 实际 kind 分布：笔记形态 20 / 附件形态 16 / 外链 13 / 孤儿 7 / 目录布局 6 / 幂等 6 / 空目录 5 / 路径 2 / 自动化 2 = 77。表里多了一个不存在的「断链 8」，`路径问题` 记 6（实为 2）、`幂等` 记 4（实为 6） |
| P2-10 | `tests/README.md` 规模数字未随迭代同步 | `tests/README.md` | 369→375（`it()`）、E2E 76→82、两套件用例数 |

### P3 — 已识别、本轮**不修**（附理由）

| # | 问题 | 为什么不修 |
|---|---|---|
| P3-1 | `vault.getConfig('attachmentFolderPath')` 替身恒返回 `''`（真实默认 `'/'`＝库根）→ **默认配置下附件落库根还是 `./assets`，E2E 覆盖不到**；`useMarkdownLinks` 同理恒 `false` | 修改替身默认值会让**存量用例的期望落盘位置整体改变**（从 `./assets` 变库根），属测试夹具重构级别的改动，收益/风险比不适合塞进本轮。已在 `tests/README.md` 的"保真度注意"里**如实登记为已知盲区**，并注明由真实 Obsidian 那一遍验收兜底 |
| P3-2 | `localize-media-core.ts` 的 `MD_IMG`/`MD_LINK` 用 `([^)\s]+)`：`![alt](url "标题")` 不被识别；URL 含 `)` 时会被截断 | 该文件解析的是**外部 URL**，"截到空白"是用来剥标题段的，架构守卫已**故意**把它排除在"禁止空白截断"规则之外（见 `architecture.test.ts` 的按域界定原则）。改它要同时重做 URL 与标题的解析与回写，属独立课题；当前风险低（截断后的 URL 通常下载失败 → 不写回，不会改坏正文） |
| P3-3 | `unused-cleaner.performDelete` 的删除前复检只用 `resolvedLinks`（不认识 HTML 标签），与孤儿判定层口径不完全一致 | 能进入待删集合的文件在快照时两层口径都判为零引用；要"快照后新增 HTML 引用"这一极窄竞态才会踩到。修它需要在删除前重跑全库文本扫描，代价与收益不匹配 |
| P3-4 | `modals.ts` 的 `ReportModal` 同时给「去修复可确定断链」与「关闭」设了 `setCta()` | 纯视觉主次问题 |

---

## 2. 修复实施

### 2.1 代码

| 文件 | 改动 |
|---|---|
| `src/main.ts` | 新增 `restartAutomationSweep()`：先清旧句柄再按当前设置重建轮询定时器（幂等，重复调用不叠加） |
| `src/settings-tab.ts` | ① `bindNumber` 增可选 `onCommit`，只在**失焦**时触发（避免逐位输入反复重装定时器）；自动处理间隔的 `onCommit` 调 `restartAutomationSweep()`；② 路径修复下拉改为**精确集合匹配**：恰为三平台 → `all`；单平台 → 该平台；界面表达不出的组合 → 追加 `__other__` 占位项**原样列出**，绝不谎报（选中占位项为 no-op） |
| `src/features/consistency.ts` | `execute()` 把真实 `{fixed, errors}` 写入 `lastResult`，静默路径返回它，不再硬编码 `errors: 0` |
| `src/features/empty-folder-cleaner.ts` | 新增 `notEmptySeen: Set`，`skippedNotEmpty` 每个目录只计一次 |
| `src/core/types.ts` | `VaultAdapter` 收敛为只保留 `listFiles()`（唯一被消费的成员），并写明为何删（含 `readHead` 的误导性） |
| `src/obsidian-domain.ts` | `ObsidianVaultAdapter` 同步删除 `exists`/`read`/`readHead` |
| `src/core/attachment-index.ts` | 删除恒为空的 `ScanResult.broken` 与其消费分支，注释说明断链判定归 `scanUnresolvedBreaks` 等 |

### 2.2 测试（含"让守卫变得可证伪"）

| 文件 | 改动 |
|---|---|
| `tests/e2e/infrastructure.ts` | ① `renameFile` 改为**与真实宿主同强度**：先把 HTML 标签换成唯一哨兵再调改写器（重复标签逐个消费），使 Obsidian"不认识 HTML"这一事实在替身里成立；② 新增 `makeControlComp()`，`addToggle/addDropdown/addSlider` 的 `onChange` **真正保存**并暴露 `trigger(v)`，同时记录 `setValue` 值与 `addOption` 列表；③ `Registry` 增 `settingControls` |
| `tests/e2e/safety-suite.test.ts` | 新增「当前笔记的 HTML 引用：附件改名后引用必须由插件自己跟上」——用**条件不变式**（改了名就必须把引用跟过去）表达，不会因命名细节变化而假红 |
| `tests/e2e/settings-tab.test.ts` | 新增 5 条：点开关当场生效（写盘 + 联动）、间隔失焦后重装定时器（且输入过程中不重装）、下拉三平台判为 `all`、两平台不谎报为 `all`、单平台精确显示；`makeTab` 补 `restartAutomationSweep` 计数 |
| `tests/e2e/real-suite.test.ts` | 「对外部页面复制来的笔记执行」改用套件自建本地 HTTP 服务的**多级路径** URL，去掉公网依赖（保留中文目录 + alt 别名 + 自动命名的原始意图） |
| `tests/unit/core/attachment-index.test.ts` | 替身同步删掉 `exists`/`read`/`readHead` |

### 2.3 文档

`README.md`（架构树去 `Result`）、`security-threat-model.md`（速览 / 数据流 / T4 / 加固表 / P2 勾选，共 5 处）、
`command-inventory.md`（平台默认值）、`review-phase3.md`（用例类别表重写 + 附复核命令）、
`tests/README.md`（规模数字 + 保真度注意由"两条"扩为"三条"，如实登记 P3-1 盲区）。

---

## 3. 验证

### 3.1 变体测试（证明新守卫真的会红）

不满足于"用例变绿"，对两条新守卫做了**反向验证**——把被保护的行为改坏，确认用例转红，再还原：

| 变体 | 手法 | 结果 |
|---|---|---|
| 移除 `runRenameNote` 末尾的 `rewriteRefsSafely(() => rewriteRefsInNote(...))` | 临时替换为 `const rewriteErr = null;` | ✅ 转红：`HTML 引用悬空：assets/solo.png`（`safety-suite:209`）→ 证明该用例锚定的正是"插件自己有没有改写 HTML 引用"，替身不再兜底 |
| 移除「启用清理」开关 `onChange` 里的 `this.applyGates()` | 临时删除该行 | ✅ 转红：`关闭父开关后子项未立即禁用: expected [] to have a length of 1 but got +0` → 证明设置页联动逻辑现在真的被执行 |

两次变体后均已 `cp` 还原，`git status` 确认无残留。

### 3.2 回归范围（按仓库约定，只跑与本次改动关联的用例）

| 套件 / 文件 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `tests/unit/architecture.test.ts`（架构守卫） | 7/7 |
| `tests/e2e/real-suite.test.ts` | **43/43**（修复前因公网依赖 42/43） |
| `tests/e2e/safety-suite.test.ts` | **13/13**（新增 1 条；替身加强后其余 12 条仍绿） |
| `tests/e2e/settings-tab.test.ts` | **15/15**（新增 5 条） |
| `tests/e2e/report-accuracy.test.ts` | 8/8 |
| `tests/e2e/scale.test.ts` | 1/1 |
| `tests/e2e/acceptance.test.ts`（77 用例 × 13 命令 × 2 遍 + 10 条不变式） | 1/1 通过 |
| 受改动直接影响的单测：`attachment-index` / `consistency-core` / `empty-folder-core` / `path-compatibility` / `link-resolver` / `notify-core` / `safe-move` / `name-formatter-core` / `localize-media-core` | 全部通过 |

> `real-suite` 中 `127.0.0.1:1/blocked.png` 的 `fetch failed` 与 `page.html 跳过网页文档` 是**夹具刻意构造**的用例（分别验证下载失败与网页不落存），不是异常。

### 3.3 项目规模（本轮后实测）

- `src/`：45 个 `.ts`，约 7 360 行（删死代码后略降）
- `tests/`：29 个测试文件，**375** 个 `it()` 声明（原 369，本轮 +6）
- E2E：7 套件 / **82** 条（原 76）
- 验收用例：**77** 条（未变，与 `acceptance-fixture.ts` 的 `kind` 分布一致）

---

## 4. 遗留与后续建议

1. **P3-1 是当前最大盲区**：`getConfig` 替身恒空，导致"默认配置下附件到底落在库根还是 `./assets`"只能靠真实 Obsidian 那一遍验收。若要补，应单独一轮处理（需同步调整受影响用例的期望路径）。
2. **`acceptance.test.ts` 的 `confirmModal()` 存在 stale CTA 复用**（会重放上一条破坏性命令的确认回调，这也是"需多轮收敛"的部分成因）；`ACCEPTANCE_CASES[].expect` 字段目前只被计数、不被断言消费。两者都属"测试自身可信度"课题，建议与 P3-1 合并成一轮"测试夹具可信度"专项。
3. **失败路径（`errors > 0`）全链路仍零覆盖**：`reportFailures`、`traceCommand` 的 catch、写盘失败等分支在所有套件里都跑不到——而历史缺陷恰好都出在"失败被吞"。建议专门构造必然失败的仓库（只读目录 / 替换 `createBinary` 抛错）来钉住"静默档下失败仍可见"。
4. `localize-media-core` 的 URL/标题解析（P3-2）若要修，应与 `link-resolver` 的 `parseMdTarget` 合并口径，避免出现第 5 次"两层口径不一致"。
