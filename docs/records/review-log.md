# 逐轮复查记录（2026-10-02 → 2026-10-18）

> **性质：逐轮记录**——记的是"那一轮查了什么、改了哪几处、为什么"。其中的用例数、产物哈希、
> 文件数等**数字属当时**，**现状以 `Attachment Suite/tests/README.md` 第 8 行为唯一权威来源**。
> 本文由原先四份独立文档（`review-2026-10-02` / `-10-03` / `-10-07` / `-10-13`）折入，
> 原文见 git 历史（**末节 `2026-10-14` 为新增记录，非折入件**）。
> **各轮的完整发现与修复保留在对应小节里，未作删改**；
> 只把四篇里**逐字重复**的公共口径提到下面写一次。

## 公共口径（四轮共用，原文在各轮里各写一遍）

- **范围**：功能实现完整性、文档与实现一致性、代码注释准确性、配置界面内容正确性、
  测试齐全有效性、真实宿主运行验证。四轮口径一致，便于横向比较。
- **方法**：**先跑既有机器守卫、再补它们够不到的地方**。凡已由守卫覆盖的（规模数字、默认值表、
  命令 id 集合、宿主标签、`.ts`/`.mjs` 引用是否存在）不重复人工比对，只验证守卫本身有效；
  人力集中在守卫够不到处。
- **闭环证据的口径**：`npm run typecheck` + `npm run build` 通过；
  `dist/attachment-suite/main.js` 的 sha256 与改动前比对（**逐字一致 = 运行期行为零变化**）；
  关联守卫单跑 + 全量测试；真实宿主变体运行的问题数。

> ⚠️ 本机（WorkBuddy 沙箱）跑 `npm test` 会有两类**已知假失败**，**不是插件缺陷**（CI 无此 shim）：
> ① `[safe-delete] SAFE_DELETE_BULK_CONFIRM_REQUIRED` 拦下 `seed-acceptance` 的 `resetContent()`；
> ② `EPERM … ssr/<hash>` 导致测试文件被静默丢弃。判据是"有没有 `FAIL` 行"。

## 各轮速览

| 轮次 | 触发 | 结论 | 改动规模 |
|---|---|---|---|
| 2026-10-02 | 准备推送代码 | 只产出结论、**未改源码**；抓出 6 处文档性内容与遗漏项（D1–D6） | 0 源文件 |
| 2026-10-03 | 一次性全面检查 | 修 **16 处**文档/注释与实现的偏差 + 3 处测试有效性缺口 | 24 文件 / +129 −69 |
| 2026-10-07 | 一次性全面检查 | 修 **6 处**文档 / 注释 / 测试有效性偏差；**运行期行为零变化** | 6 文件；真实宿主三变体问题 0 |
| 2026-10-13 | 一次性全面检查 | 修 **4 处**文档与事实不符 + 补 **1 条守卫**；运行期行为零变化 | 7 文件；真实宿主三变体问题 0 |
| 2026-10-13（第二轮） | 一次性全面检查 | 修 **1 处**悬空引用 + 补 **1 条守卫**（`docs/` 路径存在性）+ 加固 **1 处**诊断脚本；运行期行为零变化 | 6 文件；真实宿主两变体问题 0 |
| 2026-10-14 | 一次性全面检查 | **未发现功能缺陷**；修 **7 处**文档/测试有效性/注释偏差 + 补 **1 份**缺失单测（+8 用例）；运行期行为零变化 | 7 文件；真实宿主 3 次运行问题 0 |

> 上表只到 2026-10-14 的第一轮；**其后各轮（10-14 第二～九轮、10-16 六节、10-18 两节）
> 以小节形式逐条追加在下方，标题即索引**——不再回头补表（补表又要跟着数字漂移）。

---


## 2026-10-02 · 推送前复查（文档性内容 + 遗漏项）

> 源文件：`docs/review-2026-10-02.md`（原文见 git 历史）

> 触发：准备做几轮复查后推送代码。
> 方法：以**可对账的事实**为准——不靠通读，而是把文档里的每条数字、路径、默认值、
> 符号引用、清单项逐一拉出来与代码/仓库实测值对账；对"可能没有"的东西（缺失功能、
> 未处理错误）用脚本扫面而不是凭印象。
> 本次**未修改任何源码**，只产出结论。

### 0. 检查范围

| 层 | 对象 | 数量 |
| --- | --- | --- |
| 文档 | 根 `README.md`、`docs/*.md`、`Attachment Suite/tests/README.md` | 1 + 15 + 1 |
| 代码注释 | `Attachment Suite/src/**/*.ts`、`scripts/**` | 46 + 6 |
| 对账口径 | 命令注册数、设置叶子键、用例数（实测）、验收用例/机器校验、版本号、文件路径、白名单 | — |

严重度定义：

- **P0** 会导致数据损失或功能不可用；
- **P1** 会误导使用者或掩盖缺陷（照着文档做会做错）；
- **P2** 一致性与整洁问题（不影响运行，但削弱文档可信度与可维护性）。

---

### 1. 检查 A：文档性内容（完整性 / 准确性 / 一致性 / 时效性）

#### 1.1 任务清单

| # | 检查项 | 方法 |
| --- | --- | --- |
| A1 | 根 README 与 `docs/` 的事实性陈述 | 逐条与代码/仓库实测对账 |
| A2 | `tests/README` 的规模、目录树、套件表、运行说明 | 用 vitest JSON reporter 取**每个文件的真实用例数**逐行比对 |
| A3 | 代码注释的有效性 | 扫遗留标记、被引用的文件/符号是否仍存在、注释里的默认值是否与 `DEFAULT_SETTINGS` 一致 |
| A4 | 跨文档一致性与时效性 | 同一事实多处出现时是否互相矛盾；状态标记与日期是否仍成立；交叉引用章节是否存在 |

#### 1.2 发现的问题

| # | 严重度 | 位置 | 问题 | 修改建议 |
| --- | --- | --- | --- | --- |
| **D1** | **P1** | `README.md:148` | 引用 Obsidian 标签写成「文件与链接 → **默认附件文件夹**」。宿主 zh-CN 实际是**「附件默认存放路径」**（`option-new-attachment-location`）。**设置页上一轮刚修掉同一个错误、并加了 `HOST_LABELS` 守卫**，README 却还留着——照它去找在设置里找不到该项 | 改为「设置 → 文件与链接 → 附件默认存放路径」 |
| **D2** | **P1** | `docs/default-settings.md:46` | 同上（同一假标签） | 同上 |
| **D3** | **P1** | `docs/command-inventory.md:90 / 96 / 147` | 三处标 `exporter.enabled`「默认 false」；**实际默认 true**（2026-09-30 起） | 改为 true，并在该行注明"导出默认开启"的理由 |
| **D4** | **P1** | `docs/command-inventory.md:131` | 标 `consistency.followNoteMove`（**false**）；**实际 true** | 改为 true（并注明"仅对笔记相对型目录生效"） |
| **D5** | **P1** | `src/features/note-relocator.ts:1` | 文件头注释写「（默认关闭，见 ConsistencySettings.followNoteMove）」；**实际默认开启**。注释与代码相反，最易误导维护者 | 改为"默认开启（仅对笔记相对型目录生效）" |
| **D6** | **P1** | `README.md:218 / 237` | 投放路径写成 `for-test/.obsidian/plugins/attachment-suite/`；**实际结构是 `for-test/acceptance/.obsidian/plugins/attachment-suite/`**（`for-test/` 下只有 `acceptance/` 与 `acceptance-reports/`）。照抄会在错误位置建目录、白忙一场 | 补上 `acceptance/`，或写成"以 `seed-acceptance` 生成的实际库为准" |
| **D7** | **P1** | `tests/README.md:149 / 201 / 203 / 297` | 四处写「**77** 用例」，实际 **82**——而同一文档第 21 行与第 407 行写的是 82。**文档内部自相矛盾**，且 77 是两轮前的旧值 | 四处统一为 82 |
| **D8** | **P2** | `tests/README.md` 套件表 | **7 个套件的用例数与实测不符**（实测来自 `vitest --reporter=json`）：safety-suite 15→**18**、architecture 7→**8**、attachment-index 26→**27**、link-resolver 32→**40**、broken-link-core 26→**30**、localize-media-core 44→**50**、name-formatter-core 19→**20** | 按实测值逐行校正；建议加一条守卫把总数与分项之和钉住 |
| **D9** | **P2** | `tests/README.md:155` | 标题写「3.1 real-suite.test.ts — 主套件（**17 组 / 43 例**）」，同文档表格却写 **52** | 统一为实测值 |
| **D10** | **P2** | `README.md:93-111`，`tests/README.md:17/21/142/150`，`docs/command-inventory.md:11` | 「**13 条命令**」口径未声明。实际注册 **14 条**（13 条业务 + 1 条诊断开关 `toggle-debug-logging`）。README 的「命令一览」表只列 13 条，而它自称"所有命令" | 统一表述为"13 条业务命令（另有 1 条诊断开关）"，并把诊断命令补进 README 命令表 |
| **D11** | **P2** | `tests/README.md:159` | 写「onload 不抛错且注册全部 **13 条**命令」，而 real-suite 实际断言 `toHaveLength(14)` | 与 D10 一并统一 |
| **D12** | **P2** | `docs/review-phase1.md` / `review-phase2.md` | 标题与状态栏仍写「（**进行中**）」，实为 2026-09-14 的一次性阶段报告，后续已被 phase3 / round4 / impl-round5 取代 | 改为「已完成（历史归档）」 |
| **D13** | **P2** | `docs/`（15 篇） | **没有索引文件**；10 篇是 09-14 ~ 09-28 的历史报告，均无"已归档 / 已被取代"标记。读者无法判断哪篇是当前权威 | 新增 `docs/README.md`：列每篇的**日期 / 性质（当前有效 vs 历史归档）/ 一句话结论**，并指明当前权威文档 |
| **D14** | **P2** | `scripts/cdp-probe.mjs` | 该脚本存在但**未被任何文档提及**（README / tests/README / docs 全无） | 在 tests/README 的脚本清单里补一行说明用途 |
| **D15** | **P2** | `tests/e2e/vault-config.test.ts:5` | 注释里用假标签「默认附件文件夹」描述被测行为 | 顺手改为真实标签 |
| **D16** | **P2** | `docs/default-settings.md:19 / 40` | 引用设置项名「**名称带类型类别**」；界面上上一轮已改名为「**名称带类别**」 | 同步改名 |
| **D17** | **P2** | `README.md:235`，`tests/README.md:17/142` | 称 real-suite「**实体执行全部 13 条命令**」；实测该文件只驱动 **12 条**（缺 `attachment:bulk-collect`，它只在 `acceptance.test.ts` 的 `ALL_COMMANDS` 里被驱动） | 表述改为"驱动 12 条命令，第 13 条由验收 harness 覆盖"，或补上该命令的 E2E 用例 |

#### 1.3 检查 A 中**未发现问题**的部分（已查，结论为干净）

- **代码注释**：无 `TODO/FIXME/XXX/HACK` 遗留标记；注释里引用的**文件与函数全部真实存在**
  （唯二"疑似失效"的 `features/link-fixer-core.ts` 与 `app.json` 经上下文确认是**有意保留的历史说明**
  与**宿主配置文件**，不是坏引用）。
- **注释里的默认值**：除 D5 外，其余（`folderByCategory` 默认关、`blockPrivateHosts` 默认开、
  `debugLogging` 默认关、`exporter` 默认开）全部与 `DEFAULT_SETTINGS` 一致。
- **版本号**：`package.json` / `manifest.json` / `versions.json` / README 声明**四处一致**（1.0.0 / 1.6.7）。
- **文档承诺的脚本与产物**：`npm run version` → `version-bump.mjs` 存在且 `versions.json` 存在；
  `.github/workflows/release.yml` 存在（与插件 `.gitignore` 里"由 CI 重建 dist"的说明相符）；
  `scripts/` 下 5 个被文档提及的文件**全部存在**。
- **测试文件清单**：实际 37 个测试文件，`tests/README` **全部提及**，无遗漏、无幽灵条目
  （唯二"文档有而实际无"的 `foo-core.test.ts` / `-core.test.ts` 是命名规范示例，属正常）。

---

### 2. 检查 B：遗漏项（缺失功能 / 未覆盖边界 / 未处理错误 / 未同步更新）

#### 2.1 任务清单

| # | 检查项 | 方法 |
| --- | --- | --- |
| B1 | 功能缺口 | 命令声明 vs 注册；设置叶子键 vs 界面控件与**真实消费方**（含解构取值与动态查表） |
| B2 | 边界与错误处理 | 扫浮空 Promise（`void` 丢弃）、未处理 async 回调、空 `catch`、越界索引、除零、是否有全局 rejection 兜底 |
| B3 | 未同步的清单 | `normalizeFields` 顶层键白名单、`ALLOWED_CROSS_FEATURE`、`ACCEPTANCE_ASSERTS` 的 id、目录树/套件表、harness 与 CDP 脚本的解析口径 |

#### 2.2 发现的问题

| # | 严重度 | 位置 | 问题 | 修改建议 |
| --- | --- | --- | --- | --- |
| **E1** | **P2** | `src/settings-tab.ts:73-75` | `private save(): void { void this.plugin.saveSettings(); }` —— **没有 catch**，而 `saveSettings()` 内部只有 `await this.saveData(...)`，本身也不兜。插件**没有全局 `unhandledrejection` 兜底**（已确认 `src/` 内无任何全局处理器）→ 保存失败时产生无人处理的 rejection，**用户零感知**：表现为"改了设置没保存，重启变回旧值" | 包一层 `.catch()`，走 `createNoticer` 出 error 级提示（"设置保存失败：…"）。设置保存失败属"必须可见"的一类 |
| **E2** | **P2** | `src/settings-tab.ts:236` | `void this.plugin.setDebugLogging(v)` —— 同 E1，`setDebugLogging` 内部 `await this.saveSettings()` 也无兜底。**失败时开关看起来打开了、实际没落盘**，正是本仓库反复出现的「显示值 ≠ 生效值」形态 | 同上 |
| **E3** | **P2** | `src/reveal-ref.ts:29` | 报告/预览里点击条目定位失败时**完全静默**（笔记不存在 / 非 Markdown / 文本里找不到该引用都直接 `return`）。JSDoc 声明是"最佳努力语义"，但**连 `logger.debug` 都没有**——与上一轮刚修的 ② 按钮"点了没反应"属同一族；排查时"为什么点了没跳"在控制台里也没有线索 | 保留不打扰用户的行为，但补一行 `logger.debug`（含 `sourcePath` 与原因），使"去向没内容"这条判据成立 |
| **E4** | **P2** | `src/main.ts:349` | `void this.sweepAuto()` 无外层 `try`。内部逐篇入队已各自 `.catch`，**残余风险低**；但一旦同步段抛错就是未处理 rejection | 给 `sweepAuto` 加外层 try/catch，走 `reportBackgroundError` 或 `logger.error` |
| **E5** | **P2** | `src/main.ts:340` | 剪贴板读取失败静默跳过（有注释说明理由，可接受） | 建议补 `logger.debug`，便于排查"粘贴没触发" |
| **E6** | **P2** | 全局 | **没有 ribbon 图标 / 状态栏入口**（`docs/coverage-audit` §11.5 第 6 条，已登记未做）。入口目前只有命令面板、设置页、文件右键菜单 | 需产品决策：ribbon 建议只放「检查库一致性」一个图标；若不做，在 README 里明确"入口只有这三种"，别让人以为是遗漏 |
| **E7** | **P2** | `tests/e2e/real-suite.test.ts` | `attachment:bulk-collect` **在 real-suite 里从未被驱动**（只出现在期望 id 数组里）。它确实被 `acceptance.test.ts` 的 `ALL_COMMANDS` 覆盖，所以不算零覆盖——但 real-suite 才是写精确断言的地方 | 与 D17 一并处理：要么补一条 bulk-collect 的 real-suite 用例，要么把文档表述改准确 |

#### 2.3 检查 B 中**未发现问题**的部分（已查，结论为干净）

- **无死设置**：`DEFAULT_SETTINGS` 的全部叶子键**逐个反查过消费方**——含解构取值
  （`localize-media.ts:51` 一次解构 5 个数字项）与动态查表（`name-formatter-core.ts:169`
  的 `categoryWords[category]`），**没有任何"有值、有界面、无消费方"的键**。
- **无越界/除零**：未发现 `arr[0]` 式的裸下标取值风险，也未发现分母可能为 0 的除法；
  未发现 `forEach(async …)` / `map(async …)`（会产生无人 await 的 Promise）。
- **空 catch 均有理由**：7 处空 `catch` 全部带注释，其中 5 处内部有 `logger.error` 或等价上报；
  真正"静默"的只有 `main.ts:340`（E5）与 `reveal-ref.ts:29`（E3），已单列。
- **后台队列的失败可见性完好**：`main.ts:419`（自动处理）与 `main.ts:439`（笔记移动跟随）
  都挂了 `.catch(reportBackgroundError)`；`main.ts:466` 的空任务有注释说明为何无需 catch。
- **清单同步全部通过**：
  - `ACCEPTANCE_ASSERTS` **43 条**，其 id **全部存在于** `ACCEPTANCE_CASES`（82 条）中；
    未设校验的正是 `X01` / `X02` / `P02` 三条已在源码注明理由的用例；
  - `ACCEPTANCE_CASES` 的**9 类分布（20/16/18/7/5/6/2/6/2）与文档一致**；
  - `ALLOWED_CROSS_FEATURE` 有反向断言（白名单不腐烂），测试全绿；
  - `settings-migration` 的顶层键白名单有往返断言守卫，测试全绿；
  - 测试文件清单与文档完全对齐（37 个，无遗漏无幽灵）。
- **命令全部可达**：14 条命令全部注册且有实现，4 条笔记级命令都有文件右键菜单第二入口。

---

### 3. 建议的修复顺序（当日已全部执行，见 §4）

当时给出的顺序是：**① 先修 P1 的四处"照着做会做错"**（纯文本、成本极低，但留着会在推送后被外部读者踩到）
→ **② 修 `tests/README` 的 77/82 自相矛盾**（最伤可信度）→ **③ 批量校正用例数与命令数口径**
（顺手加一条守卫把实测数与文档表格对账）→ **④ 修两处 `void` 无兜底的静默失败**
→ **⑤ 结构性收尾**（`docs/` 索引、历史文档标注）。

实际执行与之一致，并把 ⑤ 提前与 ③ 并行完成——因为 `docs/` 索引与"日期 ≠ 内容时效"这条警告，
正是防止本轮这类"文档跨过某次改造后失效"问题复发的手段。

### 4. 修复实施与验证（2026-10-02 当日完成）

上表 24 项**已全部修复**（D1–D17、E1–E7），逐项重查通过。修复要点：

#### 4.1 源码

| 项 | 改法 |
| --- | --- |
| E1/E2 | 新增 `AttachmentSettingsTab.persist(label, op)`：`op.catch(...)` → `createNoticer(level).error(...)`。`save()` 与「详细诊断日志」开关都改走它。**判据**：保存失败属"必须无条件可见"，故走 error 级（`shouldNotify` 对 error 在任何档位放行，含「静默」）。 |
| E3 | `reveal-ref.ts` 由"四处静默 return + 空 catch"改为统一的 `why(reason)` → `logger.debug`，四个分支各自带上原因（笔记不存在 / 不是 Markdown 视图 / 文本里找不到该引用 / 抛错）。用户仍不会被弹窗打扰，但排查时控制台答得出来。 |
| E4 | `sweepAuto` 拆为 `sweepAuto()`（外层 try/catch + error 级提示）与 `sweepAutoInner()`（原逻辑）。它由 `setInterval` 里的 `void` 调用，没有调用方 await，外层兜底是唯一防线。 |
| E5 | 剪贴板 `catch` 补 `logger.debug`（失败仍不打扰用户，但留痕）。 |

#### 4.2 测试

| 项 | 改法 |
| --- | --- |
| E7 | real-suite 新增 `P1-7 收集全库散落附件（bulk-collect）`：两篇笔记各引用一张落在**库根**的图（**文件名故意不同**——同名会被判成"被多篇共用"而按设计跳过），断言各归其位、原位无残留、引用跟着改写。**至此 real-suite 驱动全部 13 条业务命令**，README 的原有说法成立。 |
| E1/E2 | settings-tab 新增 3 条守卫（`makeTab({ failSave: true })` 让替身落盘抛 `EACCES`）：普通设置项失败有提示且带原因、诊断开关失败同样可见、**对照组：保存成功不得弹任何提示**。三条都刻意把 `notificationLevel` 设为 `silent`——若实现改成 summary/info 会当场变红。 |
| D8 | 新增 `tests/unit/docs-consistency.test.ts`（7 条）：套件表分项之和必须等于第 8 行声明的总数、单列文件数必须等于实际文件数、**每个实际测试文件都必须被登记**；另断言四份对外文档不得再写出已核实为错的宿主标签。**它自己也被登记进套件表**（否则第三条会红）。 |

#### 4.3 文档

- **数字与口径**：`tests/README` 四处「77 用例」→ 82；7 个套件的用例数按 `vitest --reporter=json` 的**实测值**校正；`§3.1` 补上漏登记的 18/19/20 组；「13 条命令」统一为"**13 条业务命令**（另有 1 条诊断开关）"，README 命令表补上第 14 条并写明口径。
- **事实性错误**：README / `default-settings` / `vault-config.test.ts` 注释的假标签 → 宿主真实标签；`command-inventory` 三处 `exporter.enabled` 与一处 `followNoteMove` 的默认值；`note-relocator.ts` 文件头注释（**与代码相反**那句）；README 的 `for-test` 投放路径补 `acceptance/`。
- **结构与时效**：新增 `docs/README.md` 索引（逐篇标日期/性质/"什么时候读"，并把"日期 ≠ 内容时效"写成显式警告）；`review-phase1/2` 的「进行中」改为「已完成（历史归档）」并在原地标注"当时的数字勿引用"；README 补"入口只有三处、无 ribbon 是刻意的"，消除"是不是漏了"的疑问；`cdp-probe.mjs` 补登记。

#### 4.4 验证方式与结果

| 验证 | 方式 | 结果 |
| --- | --- | --- |
| 类型 | `npm run typecheck` | 通过 |
| 全量 | `npm test` | **38 文件 / 496 用例全绿**（修复前 37 / 485） |
| 逐项对账 | 脚本重查上表 24 项（标签/路径/默认值/口径/文件存在性/源码特征） | **24/24 通过** |
| 变体测试 | ① 去掉 `persist` 兜底 ② 把声明总数改成 999 ③ 把假标签写回 README → 各自转红并给出准确原因；随后**逐条还原**，`grep` 确认无残留 | 3/3 按预期转红 |
| 回归 | 重扫全 `src/` 的浮空 Promise（`void ...`）——每一处都能指向内部 catch（`persist` / `reportBackgroundError` / `exportReport` 内 try / 有注释的空任务） | 无新增无兜底 |
| 文档自洽 | `docs-consistency.test.ts` | 通过（496 = 496，38 = 38） |

> 数字含义：修复前 `37 文件 / 485 用例` → 修复后 `38 文件 / 496 用例`
> （real-suite +1、settings-tab +3、新增 docs-consistency +7）。

#### 4.5 仍然未做（需产品决策，非遗漏）

- **⑥ ribbon 图标 / 状态栏项**：`coverage-audit` §11.5 第 6 条。本轮**未实现**，改为在 README 明确写清"入口只有命令面板 / 设置页 / 文件右键菜单，没有 ribbon 与状态栏项是刻意的"——让"是不是漏了"这个疑问不再存在。要做的话建议 ribbon 只放「检查库一致性」一个图标。

### 5. 增量复查（同日 10:22–10:30）：修复本身又带出 4 处滞后

**为什么还要再做一次**：§4 的修复是"改文档"，而**改文档也在写新内容**——那些新文字没经过审查；
更要紧的是**源码改动会创造新事实**（新增了收口点），文档不会自动跟上。所以判据不是"改过了"，而是
"**审查之后还有没有变更**"。答案是：9 份文档 + 4 个源文件。

**关键结论：这三处滞后，现有的 `docs-consistency.test.ts` 一处都没挡住**——它当时只覆盖
`tests/README` 的数字自洽与 4 份文档的标签。于是本轮把守卫**扩成索引驱动 + 四类对账**。

#### 5.1 查到的 5 处（第 4 处由守卫在我修正时当场抓出）

| # | 位置 | 问题 |
| --- | --- | --- |
| 1 | `README.md:203` | 「错误模型」只列了三处收口（`traceCommand`/`runConfirmed`/`reportBackgroundError`），而本轮新增了 `settings-tab` 的 `persist` 与 `sweepAuto` 的外层 try——**源码变更创造的新事实**，守卫覆盖不到 |
| 2 | `coverage-audit` §8「规模」 | 写 `35 文件 / 471 用例`，实际已是 `38 / 502` |
| 3 | `command-inventory:4/:11` | 仍写「全部 **13 条命令**」「总览（13 条）」——**§4 的 D10 我只改了 README 与 tests/README，漏了这一份** |
| 4 | 我在修第 2 处时 | 顺手写成 `38 文件 / 496 用例`，**被新守卫当场判红**（权威值因新增 6 条已是 502）——守卫价值的直接证明 |
| 5 | `security-threat-model` | 4 处批次验收的 `24 个文件 / N 个用例` 未标时间限定，而该文档在索引里属「当前有效」，易被误读为当前规模 |

**明确不改**：历史归档文档里的旧数字（`fix-record` 的 29 文件/373 用例、`impl-round5` 的 31/403 等）——
它们记的是"当时的事实"，改新反而破坏记录价值。守卫通过**读索引表确定"当前有效"清单**，
天然把它们排除在外。

#### 5.2 守卫扩成四类（`docs-consistency.test.ts`，7 → 13 条）

| 类 | 断言 | 反空转 |
| --- | --- | --- |
| ① 规模自洽 | 套件表分项之和 = 第 8 行声明总数；单列文件数 = 实际文件数；每个测试文件都被登记 | 已有 |
| ② **索引驱动** | 从 `docs/README.md` 的「当前有效」表解析文档清单；清单里每个路径必须真实存在 | 断言解析出 >3 份 |
| ③ **单源规模 + 命令口径** | 各文档「规模」小节的数字必须等于 `tests/README` 第 8 行；「全量命令声明」必须等于 `commands.ts` 注册数（**带「业务」限定者比业务数 13，不带者比总数 14**） | 各断言"至少命中一处" |
| ④ 宿主标签 | 四份对外文档不得写出已核实为错的标签 | 已有 |

**设计上的两个要点**：
- **命令口径不能一刀切**。破坏性用法是**加粗的清单式声明**（`全部 **N 条命令**`、`总览（N 条）`）；
  而"实体执行全部 13 条命令"是叙述性用法（说的是某条链路驱动的 13 条业务命令），强行纳入只会制造误报。
  规则因此按"有没有「业务」限定词"分流。
- **索引兼作机器可读清单**。守卫读 `docs/README.md` 的索引表来决定查哪些文档——
  索引本来就要维护，等于把"两份实现"合成一份：新文档登记进索引即自动纳入对账，
  历史文档天然豁免。

#### 5.3 验证

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | **38 文件 / 502 用例全绿**（+6：守卫扩出来的 6 条） |
| 变体测试 | 三类各改坏一处 → 3 条按预期转红、报错精确 → **逐条还原**，复跑全绿 |
| 守卫自证 | 修第 2 处时我自己写错成 496，**被守卫当场判红**（第 4 处） |

---

### 6. 第二轮增量检验（同日 11:32–11:45）：确认与最新实现是否一致

#### 6.1 判据：这一轮又改了什么

触发检验的是**当日第二轮改动**（CI 与发布链路）：

| 改动 | 是否创造新事实 |
| --- | --- |
| 新增 `.github/workflows/ci.yml` | 是——"推送到 `main` 现在会跑 CI" |
| `release.yml`：发布标签改为**不带 `v` 前缀** | 是——标签格式变了 |
| `release.yml`：加 `actions/attest`、pin 到 commit SHA、权限收紧 | 是 |
| 新增 `docs/invariants.md` | 是——新文档自身也要被检验 |
| README 补「从 Release 安装」与「发版」 | 是 |

所以**需要**一次增量检验；但**不需要**重跑全量（§5 刚刚做过）。

#### 6.2 方法与结果

沿用 §5 的"对账"法：把可能过时的**口径**拉出来与实现实测值比对。扫描范围限于
`docs/README.md` 索引里「规范与事实」那几份 + 仓库根 README。

| 检查项 | 方法 | 结果 |
| --- | --- | --- |
| 发布标签格式 | 在文档里搜 `v1.0.0` / `v 前缀` / `v$VERSION` | **无滞后**——仅 `command-inventory` 与 `security-threat-model` 开头出现 `v1.0.0`，那是**插件版本号**而非标签格式 |
| 有没有"没有 CI"这类结论 | 搜「不跑 CI / 没有 CI / 测试必须本地」 | **无匹配**：没有任何文档下过这种结论 |
| action 引用方式 | 搜 `actions/*@` | 只在两个 workflow 中出现，且**全部已 pin 到 SHA**；文档里不含 action 版本 |
| 附件规范（三件套 vs zip） | 搜 `main.js` + `manifest.json` + `styles.css` 同现 | `invariants.md` / README 均正确；`test-repair-plan.md`（历史归档）讲的是构建产物，不是发布附件 |
| **新文档的引用有效性** | 提取 `invariants.md` 里全部 `.ts` 路径与 `symbol()`，逐一在源码/测试中查找 | 15 个路径 + 4 个符号**全部存在**（`core/result.ts` 命中"缺失"属**误报**——文中正是写它"已删除、不要复活"） |
| 新文档声称的代码事实 | 与源码实测比对 | `ALLOWED_CROSS_FEATURE` 实测 **4 条**（文中说 4 条）✓；五处收口符号 `traceCommand` / `runConfirmed` / `reportBackgroundError` / `persist` / `sweepAuto` 全部存在 ✓ |
| README 发版小节的承诺 vs 实现 | 逐条对照 `release.yml` 的实际行为（并结合桩执行的 19 个场景） | **10 条承诺与实现一致** |
| 历史记录里的"未做项" | 查 §4.5 与 `coverage-audit` §11.5 | 唯一未做项仍是 ribbon / 状态栏入口（本轮未涉及）✓ 记录仍准确 |

#### 6.3 结论

**本轮改动没有带出文档滞后。** 原因有二：

1. 这一轮的三份文档（`README`、`docs/README.md`、`invariants.md`）是**与代码同步改**的；
2. §5 建立的守卫已机械看守住最容易漂移的三类（规模数字、命令口径、宿主标签）。

**唯一实质缺口**（是覆盖空白、不是滞后）：`security-threat-model.md` 只覆盖**运行时**安全
（下载链路），没有**供应链**视角——而本轮刚引入的 pin SHA 与 `actions/attest` 正属于这一类。

#### 6.4 这次检验暴露的流程问题

"文档引用的 `.ts` 路径 / 符号是否仍然存在"这一项**目前只能人工查**（§1.3 与本次都是手工做的），
而它恰是最容易随重构漂移的一类——删掉一个 core 模块、改个函数名，文档里的引用就成了坏的，
且不会有任何东西报警。**建议固化为守卫**：按 `docs/README.md` 索引取出「规范与事实」类文档，
提取其中的文件路径与函数名，逐一验证存在性。

---


## 2026-10-03 · 一次性全面检查与验证

> 源文件：`docs/review-2026-10-03.md`（原文见 git 历史）

> 对象：`attachment-suite` v1.0.0（`Attachment Suite/`）
> 性质：**逐轮记录**——本文记的是"这一轮查了什么、改了哪几处、为什么"，其中的用例数等数字属**当时**，
> 现状以 `tests/README.md` 第 8 行为唯一权威来源。
> 结论：**基线全绿；共修 16 处文档/注释与实现的偏差 + 3 处测试有效性缺口；改动 24 个文件、+129/−69 行。**

---

### 2. 基线

- `npm run typecheck` 通过；`npm test`：**40 个测试文件 / 527 个运行时用例全绿**，与 `tests/README.md` 第 8 行逐字一致。
- ⚠️ 在本机 WorkBuddy 沙箱里直接跑会看到一类**假失败**：`seed-acceptance.test.ts` 报
  `[safe-delete] SAFE_DELETE_BULK_CONFIRM_REQUIRED`（一次 `rmSync` 删除 58～61 个文件，超过本机 CLI 注入的
  批量删除阈值 50），另有一条 `EPERM`（CLI 拦截 vitest 在 Temp 写转换缓存）。两者都是**本机工具链注入的
  shim** 所致，不是插件缺陷：把验收目录移开后该用例即通过。CI（ubuntu / windows runner）无此 shim。

### 3. 发现与修复

#### 3.1 文档 / 注释与实现不符（改文档或注释，不改行为）

| # | 位置 | 原表述 | 实际 |
|---|---|---|---|
| 1 | `docs/command-inventory.md`（第 14 条说明） | 诊断日志命令是"**会话级**"切换 | `setDebugLogging` 内部 `await saveSettings()`，**会写盘**，重启后仍保持；同处还写着"与设置页同一状态"，自相矛盾 |
| 2 | `docs/command-inventory.md`（非命令入口表 + 门禁矩阵） | "下载即命名"属**两条**本地化命令 | 只有 `attachment:localize-note` 接续命名（`commands.ts` 的 `localizeNote`）；`bulk-localize` 全程不调 `runRenameNote` |
| 3 | `docs/command-inventory.md`、`README.md` | 自动化"粘贴触发**读编辑器实时内容**" | 粘贴只把笔记标脏，处理时一律 `app.vault.read`（读磁盘）；`runLocalizeNote` 的 `overrideText` 形参**无任何调用方**，是死代码 |
| 4 | `README.md`（一致性小节） | 一致性报告"按全局排除目录过滤" | 只有**未用附件与坏链接明细**被过滤；"附件数 / 可修复路径"仍按全库统计（`commands.ts` 未对 `planPathFixes` 过滤） |
| 5 | `README.md`（路径修复）／`settings.ts` 注释／`settings-tab.ts` 说明 | "默认只按当前系统判定，`? * "` 在 macOS/Linux 上仍视为合法" | `isViolation` 的非法字符表（`< > : " / \ | ? *`）与长度上限**不随平台变化**；平台开关只影响两项 Windows 专属规则（盘符前缀、`CON`/`PRN` 保留名）。此行为由 `path-compatibility.test.ts` 显式钉住，故按**有意行为**处理，改文案 |
| 6 | `README.md`（通用分组） | 未列「详细诊断日志」 | 该分组实为 5 项（附件目录来源 / 自定义附件目录 / 通知级别 / 详细诊断日志 / 全局排除目录） |
| 7 | `docs/security-threat-model.md` T2 | 纯文本 / JSON 通道"仍开、会落盘" | 落盘前有 `isManagedAttachment()` 闭合校验，`txt`/`bin`/`zip` 均不落盘（网络请求仍发出）；残余仅 Office 文档（docx/xlsx/pptx）。同文件 §4 表格本已写明该闭合校验，两处自相矛盾 |
| 8 | `docs/security-threat-model.md` §4 | 拦截实施点写作 `isBlockedUrl` | 真正生效的是 `isBlockedHost`（经 `evaluateHostPolicy`）；`isBlockedUrl` 仅被单测引用，运行期无调用方 |
| 9 | `docs/invariants.md` §2 | 裸 `Notice`"目前只有 `modals.ts` 的 `runConfirmed` 一处" | 实为三处：`unused-cleaner.ts` 与 `empty-folder-cleaner.ts` 的确认按钮 `catch` 也是同一形态 |
| 10 | `settings-tab.ts`（体积上限说明） | "小于 1 按 1 处理" | 归一化函数是 `n >= 1 ? n : 100`，<1 回写成**默认 100** |
| 11 | `settings-tab.ts`（命名说明） | 「笔记名**-**类别-序号」 | 默认连接符是 `_`，产物形如 `笔记_image_001`（同仓库其它四处均写 `_`） |
| 12 | `src/core/type-classifier.ts` | `zipFirstEntry` 注释"前端 **256B**" | 代码扫描 **4096B**；`classify` 的 `@param` 也据此修正 |
| 13 | `src/main.ts` 注释 | 启动期批量事件"**1 秒后**逐篇自动处理" | 处理周期取 `automation.interval`（默认 **5 秒**） |
| 14 | `src/commands.ts` 注释 | 诊断命令"是临时状态、**重启宿主即复位**""真需要持久化时…加个设置项是十几行的事" | 持久化已存在（`settings.debugLogging` + 设置页开关），注释所述机制从未成立 |
| 15 | `src/notify.ts` 注释 | 进度提示"最多约 **11 条**" | 步长含 `ceil`，上限为 **10 条** |
| 16 | `src/features/bulk-rename-core.ts` | `@param folderByCategory` | 该函数无此形参（属 `planForSnapshot` 的说明） |

另：`src/features/localize-media.ts` 的 `overrideText` 形参、`tests/e2e/fixture.ts` 的
`@param withRepairFixture` 均为**无调用方的死代码/死注释**，已删除；`automation.ts` 与 `bulk-localize.ts`
的调用点随之调整。

#### 3.2 配置界面内容

- **「本地化 其他」是一个永不生效的死开关**：`misc` 只对应 `classify()` 的 `bin` / `zip` 兜底分支，
  两者都不在受管扩展名白名单里，落盘前必被 `isManagedAttachment()` 挡下。这与本文件自身对
  `webpage` 的处理（不提供开关，避免"勾了却永不生效"）是同一判据。**已从白名单开关列表移除
  「其他」**（`LOCALIZE_CATEGORY_OPTIONS`），并同步 `settings` 说明、`README`、`docs/default-settings.md`。
  默认值里仍保留 `misc`（不迁移），使这类下载继续走"跳过非受管类型"这条更具体的计数与日志。

#### 3.3 错误反馈口径

- `unused-cleaner.ts` 与 `empty-folder-cleaner.ts` 的确认回调 `catch` 里仍有
  `new Notice(msg, 8000)`——**硬编码时长**，绕过了设置页承诺的"错误 5 秒起、消息越长越久"，
  也正是 `docs/invariants.md` 明令禁止的形态（"允许裸 Notice ≠ 允许裸时长"）。两处已改为
  `effectiveDuration('error', msg)`，与 `modals.ts` 的 `runConfirmed` 完全同口径。

#### 3.4 测试齐全性与有效性

- **空转用例**：`safety-suite.test.ts` 的"唯一同名候选"用例在 `text === body` 时直接 `return`，
  实测必然走该分支 → **整条用例不执行任何断言**。已改为无条件断言（目标要么保持原值，要么真实存在）。
- **守卫缺防空转断言**：`architecture.test.ts` 全部断言都是 `expect(offenders).toEqual([])`，
  文件枚举一旦失效就会"零 offender 全绿"。已补"扫到的源文件数 ≥ N"的前置断言。
- **守卫可被注释喂饱**：`acceptance-tooling.test.ts` 的解析能力标记在**未剥注释**的原文上判断
  （该文件末尾自己记过这条教训）。已改为在剥注释后的代码上判断。
- **覆盖缺口：`repair-incompatible-paths` 的执行路径此前零覆盖**（唯一用例是"无非法路径时优雅无操作"），
  `runRepairPaths` 的"改名 + 全库改写引用"整条链路从未被驱动。已补 E2E：夹具用 `a..png`
  （**全平台可创建、全平台判违规**，故无需按平台分支），断言改名发生、引用被改写、且改写目标真实存在。
- **文档过度声明**：`tests/README.md` 曾称导出用例覆盖"超过体积上限时中止"，
  实际 `checkExportSize` 无用例覆盖。已改为如实标注"当前无用例覆盖"。

### 4. 未修 / 残余（已明确记录，非静默放过）

- `checkExportSize` / `MAX_EXPORT_BYTES`（512MB 中止）仍无用例：需伪造 `stat.size > 512MB`，
  现有夹具不提供该能力。已在 `tests/README.md` 明示，不假装已覆盖。
- `src/logger.ts` 的 `getLogLevel` / `setSink` 无生产与测试调用方（历史扩展点）。
  不构成文档↔实现矛盾，未动（避免无关改动）。
- `docs/security-threat-model.md` 的行号引用普遍漂移（文件与符号都存在，只是行号偏了）。
  该文未像 `command-inventory.md` 那样声明"行号会漂移"；未逐条改行号（改完还会再漂）。

### 5. 真实宿主验证（本环境可达范围）

- **宿主原生标签逐字核对**：在 `%LOCALAPPDATA%\Programs\obsidian\resources\obsidian.asar` 的 zh-CN 段
  实测，「附件默认存放路径」「当前文件所在的文件夹」「当前文件所在文件夹下指定的子文件夹」「子文件夹名称」
  「文件与链接」**全部存在**；两个历史误写的名字（「默认附件文件夹」「与当前文件同名的文件夹」）不存在。
  即 `settings-tab.ts` 引用的宿主标签都可被用户照字面找到。
- **构建与投放**：`npm run build` 通过，产出 `dist/attachment-suite/` 三件套；
  `seed-acceptance.test.ts` 可重建本地验收库并把构建产物投放进去。
- **未做**：真实 Obsidian 会话内的端到端点击（本环境无可用 GUI 宿主，Obsidian 未运行、无调试端口）。
  需要时由使用者在装有 Obsidian 的机器上跑 `scripts/obsidian-cdp-trace.mjs` / `obsidian-cdp-acceptance.mjs`。
  → **已于同日补做，见 §7。**

### 6. 闭环证据

- `npm run typecheck` 通过；`npm run build` 通过。
- `npm test`：**40 个测试文件 / 529 个运行时用例全绿**（含本轮新增 2 条与文档对账守卫）。
  ⚠️ 在本机重复跑时，有几率退化成"39 文件 / 497 用例"或"38 / 501"——日志里**没有 `FAIL`**，只有
  §2 那条 `EPERM`（vitest 转换缓存写不进 Temp），即**有测试文件被静默丢弃**而非失败。
  判定方法：看有没有 `FAIL` 行；同时 `npx vitest run <受影响的文件>` 单跑即可确认。
- `tests/README.md` 第 8 行与套件表已同步到 529；`docs-consistency.test.ts` 的对账全绿。
- `git diff --stat`：24 个文件、+129 / −69 行；无新增源文件，无格式化噪声，无无关改动。

---

### 7. 补充：真实宿主运行（同日 12:14–12:20，Obsidian 1.10.6）

**前置**：`launch-obsidian-debug.cmd` 人工拉起（带 `--remote-debugging-port=9222`）——
自动化会话里**必须**由人启动：实测从本会话 `spawn` Obsidian 时子进程**立刻以 0 退出**
（被已在运行的实例按单实例锁接管），端口永不出现。这是脚本注释里写明的已知限制，已再次证实。

#### 7.1 全量验收（`obsidian-cdp-acceptance.mjs`）

```
库索引 71 个 / 磁盘 71 个      ← 前置校验：索引与磁盘一致
按 basePath 精确命中验收库 → 启用插件 → 4 个当前笔记级命令 ×4 篇 + 全部 13 条命令
第 1 轮 71 → 91，第 2 轮 91 → 93，第 3 轮 0 项（已收敛）
完成：文件 71 → 91 → 93 → 93（第 3 轮收敛），问题 0
```

**结论：问题 0，第 3 轮收敛。** 报告落验收报告目录（脚本会打印绝对路径）。

#### 7.2 控制台三通道分析（`obsidian-cdp-trace.mjs --debug`）

三条通道 + `.notice` DOM 观察器（插件的失败提示走 Notice 而非 console）：

| 通道 | 计数 | 判读 |
|---|---|---|
| `console.debug` | 177 | `[IAP] [索引] …`、各命令的计划明细（诊断日志生效） |
| `console.info` | 38 | 命令开始/完成、导出完成 |
| `NOTICE` | 83 | 用户可见提示（含"开始执行「…」"与结果汇总） |
| `console.warning` | 3 | **全部是文档列明的预期负向用例**：网页不落存 / 非受管 `.txt` 不落盘 / `:1/blocked.png` 的 `ERR_UNSAFE_PORT` |
| `exceptionThrown` / 未处理 rejection | **0** | 无 |

索引重建行数值稳定（`文件 91，受管附件 36，断链 6，孤儿候选 1`），未出现计划基于过期快照的迹象。

#### 7.3 由此发现并修掉的一个工具链缺陷（已修）

**`--debug` 不可重复使用**：它走的是「切换诊断日志（排查用）」命令（这是刻意的——顺带验证用户那条路径可达），
但命令是 **toggle**，而 `debugLogging` 是**持久**设置（`setDebugLogging` 会落盘）。于是：

| 运行 | 控制台输出 | 结果 |
|---|---|---|
| 第 1 次 `--debug` | `诊断日志级别切换为：debug` | 打开，`console.debug` 79 行 |
| 第 2 次 `--debug` | `诊断日志级别切换为：info` | **被关掉**，`console.debug` 只剩 **2** 行 |

脚本当时只打印"已开启诊断日志"（读的是通知文案，**没有回读生效值**），于是第二次排查会
**静默失去全部详细日志**，而排查者会误以为"插件没有输出"——正是本仓库最忌讳的
「承诺了却不生效」。**修法**（`scripts/obsidian-cdp-trace.mjs`）：执行后**回读
`settings.debugLogging`**，不是 `true` 就再切一次，仍不是就**直接报错**；日志文案改为回读结果。
既保留"走用户命令那条路径"，又让结果确定。**实测连跑两次**：A 次 177 行 debug、B 次 99 行，均为开启态。

> 顺带记一条**排查经验**：想看到"启动期就绪门挡下 N 个 changed"，必须在**打开库之前**
> 就把 `debugLogging` 设为 true（或依赖 `--startup-check` 直接读 `getAutomationDiagnostics()` 计数）。
> 因为那几行在插件 `onload` 时就已输出，而 CDP 是**连上之后**才开始收事件的——晚连就永远看不到。

#### 7.4 启动哨兵 + 自动化阶段（`--startup-check --automation`）

**前提修正**：这一步必须由**脚本自己拉起宿主**（哨兵文件与基线要在宿主启动**之前**落好）。
原先 `launch-obsidian-debug.cmd` 的注释把原因写成"agent 会话留不住 GUI 进程（Obsidian 会以
0x80000003 退出）"——**实测不成立**：把已有实例完全退出后，脚本自己 `spawn` 的宿主**正常存活到整轮结束**
（结束时 0 个 `Obsidian.exe`、端口已释放）。**真正的阻塞是 Obsidian 的单实例锁**（有实例在跑时，
新进程立刻 exit 0 并把请求转交给旧实例，端口永不打开）。该注释已按实测改写。

```
库索引 73 个 / 磁盘 73 个 → 哨兵：全程不触碰库，等待 13000ms
启动哨兵结果：笔记改写 0 篇 / 哨兵附件仍在原处；
             就绪信号 = metadataCache.resolved，启动期被就绪门挡下 84 个 changed，批量护栏拒绝 0 次
自动化阶段：assets/automation-probe.png → assets/AutomationProbe_image_001.png（531ms）
完成：文件 73 → 93 → 95 → 95（第 3 轮收敛），问题 0
```

`getAutomationDiagnostics()` 的原始计数：`suppressedNotSettled = 84`、`suppressedQuiet = 11`、
`sweepRefused = 0`、`settleSource = metadataCache.resolved`（宿主**确实发**了就绪信号，没走兜底超时）。

**这组数据为什么有价值**：它是一对**非空洞**证据——
① 自动化阶段 531ms 就完成了改名，证明"自动处理确实能在库里干活"；
② 同一轮启动期却 **0 篇笔记被改写**，而就绪门**真的挡下了 84 个**启动期 changed。
两者合起来才说明"打开库不静默批量改写"是**门在挡**，而不是"功能压根没生效"。

---

### 8. 第二轮：文档 / 注释 / 配置项 / 设置界面文案的再对账

§7 跑完后再做了一遍**全面一致性检查**，重点查两件事：① §3 那一轮修复**有没有只改一半**；
② 那一轮**自己有没有引入**新的不一致。结论：**共订正 11 处**——5 处是"同一事实只改了一半"的遗留（§8.1）、
4 处是这一轮**自己引入**的（§8.2）、2 处是顺带核实到的注释枚举错误（§8.3）。
全量 `npm test` 仍为 **40 文件 / 529 用例全绿**、typecheck 通过；`docs-consistency` 与 `architecture` 两个守卫单跑亦绿。

#### 8.1 §3 的遗留（只改了一半）

| # | 位置 | 问题 |
|---|---|---|
| 1 | `docs/default-settings.md` §3.4「路径修复的目标系统」 | §3 已把"平台只影响盘符前缀与保留名"这一口径在 README / `settings.ts` / 设置页文案三处改正，**漏了这里**，仍写"在 macOS/Linux 上**不会**误按 Windows 规则批量改名" |
| 2 | `docs/default-settings.md` §7 场景 A | "粘贴 → 自动命名（**约 1 秒内**）"：粘贴只标脏，处理在下一次轮询周期（默认 **5 秒**）。§3 改了 `main.ts` 注释却漏了这里 |
| 3 | `docs/security-threat-model.md` 文件头速览 | §3 已把 §4 表格的实施点从 `isBlockedUrl` 改成 `isBlockedHost`，**速览句没跟上**，仍把无运行期调用方的 `isBlockedUrl` 列为拦截实现 |
| 4 | `docs/security-threat-model.md` 附录 C | `RunSummary` 增 `blocked`：该字段后细化为 `blockedPrivate` / `blockedByPolicy` |
| 5 | `src/core/type-classifier.ts` `@param data` | §3 改这行时只想到 ZIP，漏了 **GIF 分支同样读到 4096B**（`:105` 的 `offset > 4096`） |

#### 8.2 这一轮**自己引入**的不一致（重点记）

| # | 位置 | 自己怎么引入的 | 现在怎么写的 |
|---|---|---|---|
| 6 | `src/settings-tab.ts` 的 `CATEGORY_OPTIONS` 注释 | 为去掉「其他」死开关引入了 `LOCALIZE_CATEGORY_OPTIONS`，但**没改** `CATEGORY_OPTIONS` 上"这份列表**只用于本地化白名单**"的旧注释——它其实已变成两份裁剪列表的共同基底 | 改写成"基础标签集 + 两份按用途裁剪（本地化去「其他」/ 命名加「网页」），改它会同时影响两处" |
| 7 | 三处文案 vs `DEFAULT_SETTINGS` | 我把「其他」从**界面**移除、却在**默认值**里保留 `misc`（为了保住"跳过非受管类型"那条更具体的计数），于是设置页提示 / `README` / `default-settings.md` 里"**不含「其他」**"与代码里的默认值**直接矛盾** | 统一为「界面 5 类；默认值另含 `misc` 兜底」，并在 `default-settings.md` 写明保留它的**理由** |
| 8 | `docs/invariants.md` §2 | 我把裸 `Notice` 写成"目前共三处"，实际是 **6 处、分三类**（还漏了「删除前确认关闭时的那一次结果提示」与「诊断开关状态提示」） | 按实枚举三类，并注明 `automation.ts` 自行用 `shouldNotify()` 门禁 |
| 9 | `README.md` 开发与测试 | 原写"`for-test/` 下**只有** `acceptance/` 与 `acceptance-reports/`"——**对一个不入版本控制的本地运行目录断言其当前内容**，任何一次本地运行（例如抓一份控制台日志）就会让它失真 | 删掉这句断言，只保留"验收库是 `for-test/acceptance/`"这一**用途**说明 |

#### 8.3 顺带核实的另外两处注释枚举

- `src/obsidian-domain.ts`：「**5 个 feature 都要用它**（命名、收集、路径修复、笔记跟随、全库收集）」——
  实际**路径修复走的是 `rewriteRefsInAllNotes`**，且枚举漏了修复断链。已改为"改引用那一族 feature 都要经由这一层
  （命名、收集、路径修复、笔记跟随、全库收集、修复断链；单篇走 `rewriteRefsInNote`，路径修复走 `rewriteRefsInAllNotes`）"。
- `src/core/link-resolver.ts` `refMapForMoves`：「5 个 feature 都要用它」——实际**4 个**直接调用
  （命名 / 收集 / 全库收集 / 笔记跟随），另有 infra 层的 `rewriteRefsInAllNotes`。已按实列名。

#### 8.4 清扫过但**确认无问题**的（避免下次重复怀疑）

- `settings-tab.ts` 两处「**小于 1 按 1 处理**」（下载重试次数、并发下载数）**属实**——只有"单文件体积上限"
  那处曾经写错，已在 §3 修掉。
- `isBlockedUrl` 的其余提及都在附录「实施记录 / 回归测试」语境里，属**历史陈述且属实**（它确实是当轮新增、
  且单测确实覆盖它），只有"运行期拦截实施点"那一句会误导——已改。
- `docs/coverage-audit` 的「`DEFAULT_SETTINGS` 共 45 个叶子键 / 44 个可配置项」：按"`naming.categoryWords`
  记 1 个键"的口径**自洽**（实测：展开其 7 个类别为 51 / 50，不展开即 45 / 44），属**口径选择而非错误**。
- `docs/security-threat-model.md` 的**行号引用漂移**：§4 已登记为已知残余，本次只登记不逐条改（改完还会再漂）。

---

### 9. 文档不再引用「本地运行态」路径（2026-10-03 追加）

起因：README 曾写「`for-test/` 下只有 `acceptance/` 与 `acceptance-reports/`」——**对一个不入版本控制、
按设计就是用来攒本地产物的目录，断言其当前内容**。这种断言天然站不住：任何一次本地运行都会让它失真
（本轮抓控制台日志时当场撞上）。

**处理原则：该路径交给脚本的默认值承担，文档不再出现。** 据此改了：

- `README.md`（面向克隆者）：两处提及全部去掉——投放步骤改成"跑 `seed-acceptance` 一步到位，库的位置由脚本决定"，
  说明段改成不点名该目录。
- `Attachment Suite/tests/README.md`（维护者操作正本）：**17 处提及**改为路径无关表述；控制台排查的示例命令
  **直接省略 `--vault`**（脚本本就有默认值——比在文档里写死一个本地路径更耐用，换机器也不用改）。
- `docs/` 的「规范与事实」类：`docs/README.md`、`command-inventory.md`、`coverage-audit` 三处的沿革/对象描述去名。
- 本文件的操作性表述去名（§8.2 里那一行是**引用被修掉的原文**，按本仓惯例保留）。

**有意保留**：`docs/` 的**记录类**文档（各轮 `review-phase*.md`、`test-repair-plan.md`、
`real-host-run-2026-09-28.md`、`review-2026-10-02.md`）**不改**——它们记的是"当时发生了什么"，
索引也声明其表述属"当时"、不得当作现状引用；改写它们等于篡改记录。规则因此是：
**新写的文档遵守新规则，旧记录不改写历史。**

> 一条可复用的判据：**文档里不要断言"某个（不入版本控制的）目录现在只有什么"**。
> 要么描述**用途**，要么干脆交给代码里的默认值——凡"会随本地运行变化的事实"，写进文档就是负债。

---


## 2026-10-07 · 一次性全面检查与验证

> 源文件：`docs/review-2026-10-07.md`（原文见 git 历史）

> 对象：`attachment-suite` v1.0.0（`Attachment Suite/`），基线提交 `9009ba4`（在单条根提交 `5dcff05` 之上）
> 性质：**逐轮记录**——本文记的是"这一轮查了什么、改了哪几处、为什么"。其中的用例数等数字属**当时**，
> 现状以 `Attachment Suite/tests/README.md` 第 8 行为唯一权威来源。
> 结论：**基线全绿；共修 6 处文档 / 注释 / 测试有效性的偏差**。**未改动任何运行期行为**——
> 重建产物 `dist/attachment-suite/main.js` 的 sha256 与改动前**逐字一致**。真实宿主三个变体全部**问题 0**。

---

### 2. 基线

- `npm run typecheck` 通过；全量测试 40 个文件 / 529 个运行时用例（逐个 / 分组单跑全绿），
  与 `tests/README.md` 第 8 行逐字一致。
- ⚠️ 本机（WorkBuddy 沙箱）仍会看到两类**假失败**，与 2026-10-03 记录同源，都**不是插件缺陷**：
  ① `seed-acceptance` 报 `[safe-delete] SAFE_DELETE_BULK_CONFIRM_REQUIRED`；
  ② `EPERM … ssr/<hash>` 导致**测试文件被静默丢弃**（本轮见过 37/451、37/438 等退化，日志里没有 `FAIL` 行）。
- **本轮新观察到的一条机制**（对 ① 的补充）：该拦截是**按"轮"累计**的（`"scope":"turn"`），
  不是"单个 `rmSync` 超过 50 个"。于是 seed 生成器的 `resetContent()` 在**第 3 个内容目录**上就可能被拦，
  留下一个**半成品验收库**（`notes/`、`assets/` 不存在）。后果很隐蔽：其后 `--startup-check`
  会以 `ENOENT … notes/20-启动哨兵.md` 失败，看起来像脚本坏了。
  处置：**先逐个子目录删干净**（每个子目录都远小于 50 个文件）再跑 seed，并核对生成文件数 = **71**。

---

### 3. 发现与修复

#### 3.1 文档 ↔ 实现

| # | 位置 | 原表述 | 实际 | 处置 |
|---|---|---|---|---|
| 1 | `README.md`（开发与测试 · 真实宿主验收） | "想换成自己准备的库，可用**脚本的** `--vault` 参数指定"（紧接 `seed-acceptance.test.ts` 那句） | seed 生成器把库写死在**一个固定位置**，**没有** `--vault`；`--vault` 是 **CDP 脚本**的参数（`obsidian-cdp-acceptance.mjs` / `obsidian-cdp-trace.mjs` / `cdp-probe.mjs`） | 改写归因（"生成器固定写这一个库；想换库可在随后的 CDP 验收脚本上加 `--vault <路径>`"），并指向 `tests/README` §5.4 |
| 2 | `docs/coverage-audit-2026-09-28.md` §2–§7 | 以**现状**口吻列缺口与数字：§3"只有 **30** 条被机器校验 / 其余 52 条"、§4"与默认值不同的是这 **12** 处"、§2 矩阵里三行"**全仓库零用例**"（`reveal-ref`、`system-trash`、`permanent`）、§2 `fix-broken-links`"**选定并修复**这条路径未验" | 均已被 §8 补齐：机器校验 **43/82**；`reveal-ref` 有 `real-suite` 第 18 组；三种删除方式有 `safety-suite` F 组；`--fix-candidates` 已验。且 **2026-09-30 的默认值改造**又让"12 处不同"再少两项（`exporter.enabled` / `scanHtmlAndLinks` 现与默认值相同） | **加"范围声明"**（§2 之前）：明确 §2–§7 属 **2026-09-28 当时**，判断"某功能现在测没测"看 §8 起。本仓惯例：历史数字须带时间限定 |
| 3 | `docs/security-threat-model.md` | 正文与附录含大量 `文件:行` 引用，**行号已普遍漂移**（如 §4「SVG 拒绝」写作 `localize-media.ts:137`、T5 的 `53-56`、T10 的 `link-resolver.ts:182-190`），而文件头**没有任何漂移声明** | 文件与符号都在，只是行号偏了 | 文件头加"行号说明"（**与姊妹文档 `command-inventory.md` 同一口径**）。不逐条改行号——改完还会再漂 |

#### 3.2 代码注释

| # | 位置 | 原表述 | 实际 | 处置 |
|---|---|---|---|---|
| 4 | `src/logger.ts` `getLogLevel` 的 JSDoc | "存在的意义：级别必须是**可读**的，否则…无法向用户/脚本如实回报状态…见 `commands.ts` 的「切换诊断日志」命令" | 该函数**无任何调用方**；诊断开关的状态一切以**设置**为准（`settings.debugLogging`），`commands.ts` / `main.ts` 都不读它 | 改写为如实描述（**保留函数**，公共面与行为不变）；`setSink` 的"用于测试捕获"标注为"预留：当前无调用方" |
| 5 | `src/core/path-compatibility.ts` `repairName` 步骤注释 | 编号 `1) 2) 3) 5)` ——**缺 4)** | 代码里确无第 4 步 | `5)` → `4)` |

#### 3.3 测试有效性

| # | 位置 | 问题 | 处置 |
|---|---|---|---|
| 6 | `tests/unit/acceptance-tooling.test.ts`「两侧都把 `.canvas` 纳入被扫描的文本集合」 | 在**未剥注释**的原文上判断，与同文件其它断言、以及本仓 §7.4.2 的教训相悖：说明性注释里出现 `.canvas` / `endsWith('.canvas')` 就能把它喂饱 | 改为 `stripComments(...)`；并做**变体测试**：把脚本里真正的 `.canvas` 改坏、只在注释里留串 → **旧写法会全绿、新写法转红**（实测红 + 明确报错文本），随后还原并核对 sha256 **逐字一致** |

#### 3.4 查过且**干净**的（避免下次重复怀疑）

- **三处入口与 14 条命令**：命令面板 / 设置页 / 文件右键菜单与 `commands.ts` 的 id、名称、门禁、
  确认方式逐条对得上；`runForNote` 只挂 4 个笔记级命令且都经同一层 `traceCommand`；无 ribbon 与状态栏项（刻意）。
- **配置界面**：`DEFAULT_SETTINGS` 的每个叶子键**都有对应控件**（含命名用词的 7 个类别）；
  文本自报的默认值 / 数值 / 开关方向由 `settings-tab` 与 `docs-consistency` 对账全绿；
  「本地化 其他 / 网页」不提供开关（死选项）的判据仍然成立。
- **宿主原生标签**：5 个（「附件默认存放路径」「当前文件所在的文件夹」「当前文件所在文件夹下指定的子文件夹」
  「子文件夹名称」「文件与链接」）已在本机 `obsidian.asar` 的 zh-CN 段**逐字复核存在**；
  两个历史误写名（「默认附件文件夹」「与当前文件同名的文件夹」）不存在。
- **错误模型**：五处收口、裸 `Notice` **6 处分三类**（另 `automation.ts` 2 处自用 `shouldNotify` 门禁）、
  跨 feature 白名单 **4 条**——与 `invariants.md` §2 / §5 逐条对得上。
- **守卫自身**：`architecture` / `acceptance-tooling` / `docs-consistency` 都带"至少扫到 N 处"的防空转断言；
  三份解析型守卫都先归一化行尾。
- **产物与清单**：`dist/` 三件套与源码 `cmp` **逐字一致**，`main.js` 不陈旧；
  `manifest.json` / `versions.json` / `package.json` / `.nvmrc` / `.npmrc` 彼此自洽。
- **死代码**：仅 `logger.getLogLevel` / `setSink`（本轮已把注释改真）与
  `localize-media-core.isBlockedUrl`（只被单测引用，运行期无调用方——2026-10-03 已登记）。

---

### 4. 未修 / 残余（明确登记，非静默放过）

- `security-threat-model.md` 的行号**内容**未逐条修正（只加了漂移声明）：改完还会再漂。
- `docs/coverage-audit` §2–§7 的矩阵**内容**未逐格更新（只加了范围声明）。若将来需要"逐格现状"，
  应以 §8 为起点另写一节，而不是回头改 §2——那一节的价值恰在于它是当时的现场。
- `checkExportSize` / `MAX_EXPORT_BYTES` 仍无用例（需伪造 `stat.size > 512MB`，现有夹具不提供；
  `tests/README.md` 已明示，不假装已覆盖）。
- `logger.getLogLevel` / `setSink` 仍无调用方：本轮**只把注释改真、未删除**（保持公共面不变、避免无关改动）。
- 本机无法验证 `EPERM` 丢文件这一类；CI（ubuntu / windows runner）无该 shim。

---

### 5. 真实宿主验证（Obsidian，本机）

前置：先 `npm run build`（产物与源码逐字一致），再 `npx vitest run tests/e2e/seed-acceptance.test.ts`
把生成器建出的验收库重置为干净初始态（**71 个文件**，核对过）；宿主**由脚本自己以子进程拉起**，
无需人工启动（本机确认无实例在跑，脚本 spawn 的宿主活到整轮结束）。

| 运行 | 结果 |
|---|---|
| 全量验收（`custom` 配置） | 文件 **71 → 91 → 93 → 93**，**第 3 轮收敛**，**问题 0** |
| 启动哨兵 + 自动化（`--startup-check --automation`） | 文件 **73 → 94 → 95 → 95**，第 3 轮收敛，**问题 0**；**笔记改写 0 篇 / 哨兵附件完好**；**启动期被就绪门挡下 71 个 changed**；就绪信号 = `metadataCache.resolved`（宿主**确实发**了）；护栏拒绝 **0** 次；自动化阶段 **1065ms** 完成 `automation-probe.png → AutomationProbe_image_001.png` |
| 默认模式变体（`--variant obsidian-root`） | 文件 **71 → 90 → 93 → 93**，第 3 轮收敛，**问题 0**；附件落**库根**，无 `notes/assets`（与「跟随 Obsidian + 库根」的预期一致） |
| 控制台三通道（`--console-only --debug`） | `console.debug 410` / `console.info 74` / `NOTICE 165` / `console.warning **6**` / **异常 0**。6 条 warning **全部**是文档列明的**预期负向用例**：`.txt` 非受管类型不落盘、HTML 不落存、`:1` 不安全端口。`--debug` 的**回读**修复有效（debug 通道确实处于打开态） |

**为什么启动哨兵那组是非空洞证据**：它同时给出两条互相印证的事实——① 自动化阶段 1065ms 就完成了
改名，证明"自动处理确实能在库里干活"；② 同一轮启动期却 **0 篇笔记被改写**，而就绪门**真的挡下了 71 个**
启动期 changed。两者合起来才说明"打开库不静默批量改写"是**门在挡**，而不是"功能压根没生效"。

---

### 6. 闭环证据

- `npm run typecheck` 通过；`npm run build` 通过。
- **`dist/attachment-suite/main.js` 的 sha256 与改动前逐字一致**（`e51e27bb5a2499cccdb4117f90832ba76d643e3d6ffa7fb151d3cb3d9a2ce693`）
  ——本轮改的全是注释与文档，**运行期行为零变化**（esbuild 不保留注释）。
- 全量测试：**40 文件 / 529 用例**（本机 shim 会随机丢文件，判据是"有没有 `FAIL` 行"；被丢的文件逐个单跑均绿）。
- 关联守卫单跑：`docs-consistency` 22、`acceptance-tooling` 7、`path-compatibility` 22、
  `architecture` 9、`settings-tab` 32 —— 全绿。
- 变体测试：1 处（§3.3 #6），已还原并核对 sha256。
- `git diff --stat`：**6 个文件**（README、2 篇 docs、2 个 src 注释、1 个测试），
  无新增源文件、无格式化噪声、无无关改动。

---

### 7. 一条可复用的判据

**"以现状口吻写下的数字与清单，必须在写下的那一刻就带上时间限定。"**
本轮的 #2 正是"初始审计"与"补齐结果"同处一篇、前者没带限定：它当时是对的，
半年后读起来就是错的，而**没有任何机器守卫会变红**（守卫只管规模数字、命令口径、宿主标签与文档引用）。

若一篇文档同时承担"当时的现场"与"现在的事实"两种职责，就在职责切换处放一句**范围声明**，
并指明"现状以哪一节为准"——这比事后逐格回改更耐用。

---


## 2026-10-13 · 一次性全面检查与验证

> 源文件：`docs/review-2026-10-13.md`（原文见 git 历史）

> 对象：`attachment-suite` v1.0.0（`Attachment Suite/`），基线提交 `5f897a9`（单条根提交，工作区干净）
> 性质：**逐轮记录**——本文记的是"这一轮查了什么、改了哪几处、为什么"。其中的用例数等数字属**当时**，
> 现状以 `Attachment Suite/tests/README.md` 第 8 行为唯一权威来源。
> 结论：**基线全绿；共修 4 处文档与事实不符，并补 1 条守卫**。**未改动任何运行期行为**——
> 重建产物 `dist/attachment-suite/main.js` 的 sha256 与改动前**逐字一致**。真实宿主三个变体全部**问题 0**。

---

### 2. 基线

- `npm run typecheck` 通过；`npm run build` 通过；`dist/attachment-suite/main.js` 的 sha256
  = `e51e27bb5a2499cccdb4117f90832ba76d643e3d6ffa7fb151d3cb3d9a2ce693`
  ——与 **2026-10-07 的闭环证据逐字相同**，也与**远端 Release `1.0.0` 的 `main.js` 附件逐字相同**
  （GitHub API 读回的 `digest` 一致）。三份互证：本地源码 = 本地产物 = 已发布产物。
- 全量测试：**40 个文件 / 531 个运行时用例**（530 绿 + 1 红）。
- ⚠️ 唯一红的是本机（WorkBuddy 沙箱）Node 层 shim 的**已知假失败**：
  `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]` 拦下 `seed-acceptance` 的 `resetContent()`
  （按"轮"累计，`"scope":"turn"`）。**不是插件缺陷**，CI 无此 shim；可靠绕法见 §6 前置步骤。
- 远端状态更正：项目记忆里"远端已无任何 tag / Releases 页为空"**已过期**——现在远端有
  `refs/tags/1.0.0` 与**已发布**的 Release `1.0.0`（2026-10-07 发布，4 个附件 + 来源证明）。
  README 的「从 Release 安装（推荐）」路径**有效**。

---

### 3. 发现与修复

每条先列**可选方案与取舍**，再记**采纳的那一个**（本仓惯例：修复尽量小、不引入无关变更）。

#### 3.1 文档引用了**仓库里不存在**的项目记忆 [采为 A]

- **位置**：`docs/default-settings.md` 开头、`docs/coverage-audit-2026-09-28.md` §11 的方法段。
  两处都写「判据 = `MEMORY.md` 的形态」。
- **事实**：`MEMORY.md` **不在版本控制内**（`git ls-files` 无此文件）；它只存在于本机的
  `.workbuddy/memory/` 下。外部读者在仓库里根本查不到，引用等于失效。而它指的内容
  （「承诺了却不生效」的形态清单）早已迁入 `docs/invariants.md` §3。
- **为何守卫没抓**：`docs-consistency` 的"文档引用的文件必须存在"只匹配 `.ts` / `.mjs`，**漏掉 `.md`**。
- **方案**：
  - **A（采纳）**：把两处引用改指向 `docs/invariants.md` §3（内容实际所在），并**补一条窄口径守卫**
    防复发（见 §3.5）。
  - B：只改文字、不加守卫。改动最小，但同类引用会再次悄悄漂移。
  - C：把项目记忆纳入版本控制并在仓库根放一份。**与"`.workbuddy/` 不入库"的既有决策冲突**，
    且会引入"两份记忆"的维护负担，不采纳。
- **取舍理由**：A 根治且成本可控（守卫是 denylist 风格、零误报）；C 违背既有分层约定，代价最大。

#### 3.2 威胁模型**误述工作流权限** [采为 A]

- **位置**：`docs/security-threat-model.md` §9.1 的表。
- **原文**：`build-release` 单独声明 `contents: write` / **`actions: write`** / `id-token: write` /
  `attestations: write`。
- **事实**：`release.yml` 的 `build-release` **刻意不声明 `actions: write`**
  （该文件里有大段注释说明"给一个只上传产物的作业能取消工作流运行的权限属于过权"），
  且 `tests/unit/workflow-config.test.ts:257` 有专门一条守卫**禁止它复活**。
  文档写的与实际正好相反。
- **方案**：
  - **A（采纳）**：改这一行——去掉 `actions: write`，并补一句"刻意不声明 + 守卫禁止"。
  - B：再加一条"文档里列的权限集合 = 工作流实际权限集合"的守卫。但该表是**自然语言**，
    判定需要解析中文，脆弱且易误报，收益有限。
- **取舍理由**：A 精准、零风险；B 的判定面不清，属"为守卫而守卫"。

#### 3.3 威胁模型的 README 结论**已失效** [采为 A]

- **位置**：`docs/security-threat-model.md` §2 末句。
- **原文**："README 的「SSRF 防护」属借用词，**应改述为「外部 URL 抓取安全措施」**。"
- **事实**：README **早已不含**"SSRF 防护"一词（全仓 `grep SSRF` 只命中本威胁模型自身）；
  同一篇的 §7「README 措辞修正（已完成）」记录了实际改法是
  "下载具备安全措施：**拦截本机/内网/保留地址**……"，**并非**"外部 URL 抓取安全措施"。
  即：前提已假、建议也与实际改法对不上。
- **方案**：
  - **A（采纳）**：改写为"README 曾用该词，已按 §7 改写、现全文不再出现"。
  - B：不动。但它处在规范类文档的**现状陈述**段落，留着会误导维护者。
- **取舍理由**：A 精准；B 会让同一篇文档自相矛盾（§2 说"应改"，§7 说"已改"）。

#### 3.4 `default-settings.md` 的"**尚未发布**"已不符事实 [采为 A]

- **位置**：`docs/default-settings.md` 开头的"适用前提"。
- **事实**：`1.0.0` 已有 GitHub Release（未上社区市场）。
- **方案**：
  - **A（采纳）**：改为"桌面专用；`1.0.0` 是首个版本（GitHub 已发布、未上社区市场），存量用户极少，
    故改默认值暂不需要配置迁移"。
  - B：不动。属最小影响，但它正是本仓反复点名的"以现状口吻写下、随后自然失真"的那一类。
- **取舍理由**：A 顺手且必要——把"未发布"当成长期前提，会让后续默认值决策的依据失真。

#### 3.5 补一条守卫：规范类文档不得引用未入库的项目记忆 [新增]

- **动机**：§3.1 暴露的是一**类**缺陷（"引用了读者查不到的文件"），而现有守卫漏掉 `.md`。
- **做法**：在 `tests/unit/docs-consistency.test.ts` 加一条 **denylist** 守卫（与既有"不得写出错误的
  宿主标签"同一口径），扫描 `normativeDocs()`，禁止出现 `MEMORY.md`。
- **为什么不把既有守卫直接扩展成"连 `.md` 一起查"**：`tests/README.md` 里**合规地**引用了测试夹具与
  生成物路径（`Auto.md`、`EXPECTED.md` 等），它们本就**不该**在仓库里；通用规则需要一份会不断增长的
  豁免名单，还要额外区分"仓库视角 vs 文件系统视角"（本机 `.workbuddy/` 下确实存在同名文件，
  按 fs 枚举会把它误判成"存在" → 守卫静默失效）。**denylist 反而更精确、零误报。**
- **变体测试（§7.4.2 要求）**：临时在 `docs/default-settings.md` 插一行含 `MEMORY.md` 的引用
  → 用例**转红并报出具体行号** → 还原。非空洞证据成立。

---

### 4. 查过且**干净**的（避免下次重复怀疑）

- **功能与命令**：14 条命令（13 业务 + 1 诊断）与三处入口逐条对得上；`runForNote` 只挂 4 个笔记级命令
  且都经同一层 `traceCommand`；`FILE_MENU_ICONS` 只覆盖那 4 条；无 ribbon / 状态栏项（刻意）。
- **设置项无"死设置"**：`DEFAULT_SETTINGS` 的每个叶子键**都有真实消费方**（逐个反查：网络细项
  `minSizeKb`/`timeoutMs`/`tryCount`/`maxDownloadMb`/`perHostIntervalMs` 经 `localize-media.ts:51`
  的解构消费，其余见 `settings-tab.test.ts` 与 `docs-consistency` 的默认值对账）。
- **设置界面引用的宿主原生标签**：5 个标签（「附件默认存放路径」「当前文件所在的文件夹」
  「当前文件所在文件夹下指定的子文件夹」「子文件夹名称」「文件与链接」）已在本机
  `obsidian.asar` 的 zh-CN 段**逐字复核存在**；两个历史误写名**确认不存在**
  （`grep -a` 于 asar 二进制内检索）。`settings-tab.test.ts` 的 `HOST_LABELS` 白名单与之一致。
- **错误模型**：五处收口（`traceCommand` / `runConfirmed` / `reportBackgroundError` / `settings-tab.persist`
  / `sweepAuto` 外层 catch）、裸 `Notice` **6 处分三类** + `automation.ts` 2 处自用 `shouldNotify` 门禁
  ——与 `invariants.md` §2 逐条对得上（`grep -n "new Notice("` 与手工分类一致）。
- **注释**：`logger.getLogLevel` / `setSink`（上轮改成"无调用方"）、`note-relocator.ts` 文件头
  （"默认开启"）、`path-compatibility.repairName` 步骤编号、`exporter` 的 512MB 上限、
  `empty-folder-cleaner` 的"回查真实文件系统"——均与代码一致。
- **分层与不变式**：`src/core` 自包含、4 条跨 feature 白名单、通用工具唯一实现、
  `MD_DEST = ((?:[^()]|\([^()]*\))*)` 仍在；`core/result.ts` / `isCategory` / `desktopOnly`
  确认**未复活**；`.gitattributes` 的 LF/CRLF 策略未变。
- **守卫自身**：`architecture` / `acceptance-tooling` / `docs-consistency` 都带"至少扫到 N 处"的防空转断言；
  解析型守卫先归一化行尾；`acceptance-tooling` 的"剥注释再断言"（上轮修复）仍在位。
- **远端与产物**：tag / Release / 产物 sha256 三处互证一致；README 的两处仓库 URL 与 `git remote` 一致。

---

### 5. 未修 / 残余（明确登记，非静默放过）

- `security-threat-model.md` 的 `文件:行` 行号**仍未逐条修正**（文件头已有漂移声明）——改完还会再漂。
- `coverage-audit` §2–§7 的矩阵**内容**未逐格更新（已有范围声明，判断现状以 §8 起为准）。
- `checkExportSize` / `MAX_EXPORT_BYTES`（512MB 上限）仍**无用例**（需伪造 `stat.size > 512MB`，
  现有夹具不提供；`tests/README.md` 已明示，不假装已覆盖）。
- `logger.getLogLevel` / `setSink` 仍无调用方（注释已改真、公共面保持不变）。
- **`MEMORY.md` 这一类的通用守卫未做**：只钉了这一个名字（理由见 §3.5）；
  若将来要覆盖"所有未入库 `.md` 引用"，须一并设计豁免名单与"仓库视角"判定。

---

### 6. 真实宿主验证（Obsidian，本机）

前置：`npm run build`（产物与源码逐字一致，sha256 同 §2）；**先把已存在的验收库整体 `mv` 走**
（不要 `rm`——本机 shim 会按"轮"拦批量删除并留下半成品库），再
`npx vitest run tests/e2e/seed-acceptance.test.ts` 从零重建（**72 个内容文件** = 71 + `EXPECTED.md`，
另 6 个 `.obsidian` 配置）。宿主**由脚本自己以子进程拉起**（本机确认无实例在跑）。

| 运行 | 结果 |
|---|---|
| 全量验收（`custom` 配置） | 文件 **71 → 91 → 93 → 93**，**第 3 轮收敛**，**问题 0** |
| 启动哨兵 + 自动化（`--startup-check --automation`） | 文件 **73 → 93 → 95 → 95**，第 3 轮收敛，**问题 0**；**笔记改写 0 篇 / 哨兵附件完好**；**启动期被就绪门挡下 49 个 changed**；就绪信号 = `metadataCache.resolved`（宿主**确实发**了）；护栏拒绝 **0** 次；自动化 **1058ms** 完成 `automation-probe.png → AutomationProbe_image_001.png` |
| 默认模式变体（`--variant obsidian-root`） | 文件 **71 → 90 → 93 → 93**，第 3 轮收敛，**问题 0**；附件落**库根** |
| 控制台三通道（`--console-only --debug`） | `console.debug 95` / `console.info 40` / `NOTICE 67` / `console.warning **3**` / **error 0 / 异常 0**。3 条 warning **全部**是文档列明的**预期负向用例**：`.txt` 非受管类型不落盘、HTML 不落存、`:1` 不安全端口 |

**为什么启动哨兵那组是非空洞证据**：它同时给出两条互相印证的事实——① 自动化阶段 1058ms 就完成了改名，
证明"自动处理确实能在库里干活"；② 同一轮启动期却 **0 篇笔记被改写**，而就绪门**真的挡下了 49 个**
启动期 changed。两者合起来才说明"打开库不静默批量改写"是**门在挡**，而不是"功能压根没生效"。

**报告落点**：`for-test/acceptance-reports/`（每次运行 1 份 JSON + 1 份控制台日志；脚本会打印绝对路径）。

---

### 7. 闭环证据

- `npm run typecheck` 通过；`npm run build` 通过。
- **`dist/attachment-suite/main.js` 的 sha256 与改动前逐字一致**（`e51e27bb…`）——本轮改的全是
  **文档、测试与守卫注释**，**运行期行为零变化**（esbuild 不保留注释；`src/` 未动）。
- 全量测试：**40 文件 / 531 用例**（本机 shim 会随机丢文件，判据是"有没有 `FAIL` 行"；本轮判红的是
  已知的 `seed-acceptance` shim 假失败，与前几轮同源）。
- 关联守卫单跑：`docs-consistency` **24**（新增 2 条）、`architecture` 9、`acceptance-tooling` 7、
  `workflow-config` 10、`settings-tab` 32、`defaults` 4 —— 全绿。
- 变体测试：1 处（§3.5），已还原并复跑全绿。
- `git diff --stat`：见提交记录——**5 个文件**（3 篇 docs + `tests/README.md` + `docs-consistency.test.ts`），
  无新增源文件、无格式化噪声、无无关改动。

---

### 8. 一条可复用的判据

**"文档里的引用，只查 `.ts`/`.mjs` 是查不全的——`.md` 引用同样会悬空，而且更隐蔽。"**

§3.1 正是这一类：守卫忠实地检查了"引用的源文件还在不在"，却对"引用的文档在不在"视而不见，
于是两处指向**本机独有文件**的引用长期无人发现。补法上也有取舍：**通用豁免规则会引蛇出洞**
（要为测试夹具/生成物维护名单），**denylist 反而精确**。

对应地：**"以现状口吻写下的、关于别的文档或远端状态的事实，也必须带上时间限定或改述为行为描述。"**
§3.2（权限）、§3.3（README 措辞）、§3.4（发布状态）三条同源——它们当年写下时都是对的，
后来被代码或事实**单方面**改写，而**没有任何机器守卫会因此变红**。

---


## 2026-10-13 · 第二轮：文档重排后的独立全面检查

> 触发：首轮（同日）之后再做一轮独立检查——此时 `docs/` 刚重组为三层，是最"新"的改动、也最可能有残留。
> 性质：**逐轮记录**。基线提交 `471dafa`（工作区干净）。
> 结论：基线全绿；共修 **1 处悬空引用** + 补 **1 条守卫** + 加固 **1 处诊断脚本**；**未改动任何运行期行为**。

### 1. 基线

- `npm run typecheck` 通过；`npm test` **40 文件 / 533 用例**（本机 shim 对 `seed-acceptance` 的假失败重跑即消失；判据是"有没有 `FAIL` 行"）。
- `npm run build` 通过；`dist/attachment-suite/main.js` 的 sha256 = `e51e27bb…`，与首轮及**已发布产物逐字一致**。
- 用 `vitest --reporter=json` 取逐文件真实用例数，与 `tests/README.md` 套件表**逐行对齐**（守卫只管总和，单套件是否漂移此前无人查）。

### 2. 发现与修复

每条先列可选方案与取舍，再记采纳的那一个。

#### 2.1 `docs/` 重组留下一处**悬空引用** [采 A]

- **位置**：`docs/specs/default-settings.md` §8（"默认不做的事"）。
- **原文**：``见 `docs/coverage-audit` §10``。
- **事实**：重组后该路径不存在（现在是 `docs/records/coverage-audit-2026-09-28.md`）；而且该句是**现状陈述**（属 `specs/`），该议题的现状权威早已是 `docs/specs/coverage-matrix.md` §3。
- **为何守卫没抓**：`docs-consistency` 的"引用必须存在"只匹配 `.ts` / `.mjs`，**漏掉无扩展名的 `docs/…` 路径**。
- **方案**：**A（采纳）** 改指 `docs/specs/coverage-matrix.md` §3，并补一条守卫（见 2.2）｜B 只改成 records 里的历史件｜C 不改。
- **取舍**：B 会诱导读者读"当时"的口径，与索引"现状看 `specs/`"的约定相悖；C 照它找不到文件。A 同时修好**指向**与**缺口**。

#### 2.2 补守卫：`docs/` 仓库路径的存在性 [新增]

- 把反引号包裹的 `docs/<…>` 纳入既有的"引用必须存在"这一组（新增 kind `文档路径`，一律从**仓库根**解析），**不**泛化成"所有 `.md` 引用"——后者会牵出测试夹具与生成物路径（`Auto.md`/`EXPECTED.md`），需要不断增长的豁免名单与"仓库视角 vs 文件系统视角"判定，反而更脆弱（理由与既有 `MEMORY.md` denylist 同源）。
- **变体测试（§7.4.2）**：把错误引用写回 → 守卫**转红**并报出 `docs\specs\default-settings.md:196 → docs/coverage-audit` → 还原。非空洞成立。守卫用例 **24 → 26**（另带"至少扫到 1 处"的防空转断言）。

#### 2.3 诊断脚本：连接时序抖动加固 [采 A]

- **现象**：`obsidian-cdp-trace.mjs` 首次运行报 `TypeError: Cannot read properties of undefined (reading 'setEnable')`，**紧接着重跑即通**（358 行控制台、清理 8 失败 0）。
- **根因**：宿主刚启动时 `window.app.plugins` 可能尚未挂上；该处是**裸求值、无重试**（验收脚本则有 `waitUntil`）。
- **方案**：**A（采纳）** 轮询到 `window.app.plugins` 出现再启用、超时给出可辨认原因｜B 维持现状靠人工重跑。
- **取舍**："诊断工具自己制造的假失败"正是本仓反复要防的形态（曾因追踪脚本未起本地服务而每轮打印假的"下载失败"），A 成本极低。

### 3. 查过且**干净**的（避免下次重复怀疑）

- **文档 ↔ 实现**：根 README 的功能断言（HTML 标签集 `<img>/<audio>/<video>/<source>/<a>`、512MB 导出上限、五处收口、4 个文件菜单项、14 条命令与三处入口）逐条与源码对得上；`specs/` 的宿主标签、默认值表、命令 id 集合由守卫全绿。
- **注释**：`logger.getLogLevel/setSink`（无调用方）、`note-relocator` 文件头（默认开启）、`repairName` 步骤编号、`notify` 的"最多 10 条"、`main.ts` 的剪贴板/轮询注释——均与代码一致；全仓无 `TODO/FIXME`。
- **配置界面**：`settings-tab.ts` 的说明文字（自报默认值、数值范围与钳制、名单通配语义、`misc`/`webpage` 无开关的理由）与 `DEFAULT_SETTINGS` / `evaluateHostPolicy` / `sanitizeNameFragment` 逐条一致；无死选项。
- **测试**：逐套件用例数与文档一致；三份解析型守卫都带防空转断言且先归一化行尾；空缺（`checkExportSize`）在 `tests/README` 如实登记。
- **索引自洽**：`docs/README.md` 声明的 18 篇 = 实测；`records` 各节号引用（覆盖率审计 §1–§14、真宿主 §1–§11）均成立。

### 4. 残余 / 未修（登记，非静默放过）

- `docs/records/*` 里对本轮之前"当时文件名"的引用（如 `review-2026-10-02.md`）**未改**——记录类文档不改写历史（沿用既有规则）。
- `security-threat-model.md` 的 `文件:行` 行号仍普遍漂移（文件头已有漂移声明，改完还会再漂）。
- `checkExportSize` / `MAX_EXPORT_BYTES`（512MB 上限）仍无用例（需伪造 `stat.size > 512MB`，现有夹具不提供）。

### 5. 真实宿主验证（Obsidian，本机）

前置：`npm run build`；**先把已存在的验收库整体 `mv` 走**（本机 shim 会按"轮"拦批量删除并留下半成品库），再 `seed-acceptance` 从零重建。宿主由脚本自己以子进程拉起（本机确认无实例在跑）。

| 运行 | 结果 |
|---|---|
| 全量验收（`custom`） | 文件 **73 → 94 → 96 → 96**，**第 3 轮收敛**，**问题 0** |
| 默认落盘变体（`--variant obsidian-root`） | 文件 **73 → 93 → 96 → 96**，**第 3 轮收敛**，**问题 0** |
| 启动哨兵（两轮均含 `--startup-check`） | **笔记改写 0 篇 / 哨兵附件完好**；就绪信号 = `metadataCache.resolved`；启动期挡下 **49** 个 changed；护栏拒绝 **0** |
| 正对照（`--automation --fix-candidates`） | 自动化 **548ms** 生效；候选修复悬空 **11 → 10** |
| 控制台三通道（`--console-only --debug`） | debug 233 / info 40 / NOTICE 84 / warning **3** / **error 0、异常 0**；3 条 warning 全是文档列明的预期负向用例 |

### 6. 闭环证据

- `npm run typecheck` 通过；`npm run build` 通过；`dist/attachment-suite/main.js` 的 sha256 = `e51e27bb…`（**运行期行为零变化**——本轮只动文档、测试与脚本）。
- 全量测试 **40 文件 / 533 用例**；`docs-consistency` 单跑 **26** 条全绿。
- 变体测试 1 处（§2.2），已还原。
- `git diff --stat`：**6 文件**（`docs/specs/default-settings.md`、`tests/unit/docs-consistency.test.ts`、`tests/README.md`、根 `.gitignore`、`scripts/obsidian-cdp-trace.mjs`、本文件）——无源文件改动、无无关变更。

### 7. 一条可复用的判据

**"文档重排（搬家）与代码重构一样会制造悬空引用——而既有守卫只查了代码引用，没查文档路径。"**
`docs/` 三层化的当天，`docs/coverage-audit` 这类**无扩展名的仓库路径引用**没有任何断言看守，失效了也无人报警。
补法仍取"精确"而非"通用"：**只盯 `docs/` 这一族路径**，不泛化成所有 `.md`（后者会引蛇出洞）。

---

## 2026-10-14 · 六维审计（本轮）

> 范围与口径同上文「公共口径」。方法：**先跑既有守卫与全量用例建立基线，再把人力投到机器守卫够不到的地方**。
> 结论：**未发现功能性缺陷**；共修 7 处（文档 3 · 测试有效性 3 · 注释 1），并补 1 份缺失的 core 单测。

### 1. 基线（先证明既有防线仍然有效）

- `npm run typecheck` 通过；逐套件用例数与 `tests/README` 套件表**逐格相符**。
- 机器守卫逐个单跑全绿：`docs-consistency` 26、`architecture` 9、`manifest` 3、`format-matrix` 5、`workflow-config` 10。
- 本机全量跑出现"少收集文件"（39/41），缺失文件单跑全绿——这是**已知现象**，已收集 + 缺失 = 目标总数。
- 已知假失败 1 条（`seed-acceptance` 的 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`），非插件缺陷。

### 2. 发现与修复（每处先给可选方案与取舍，再取最优）

| # | 位置 | 问题 | 可选方案与取舍 | 采纳 |
|---|---|---|---|---|
| D1 | `tests/README.md` §3 正文 | 写「共 12 个套件、**160 个用例**」，而逐套件之和实为 **161**（374 单元 + 161 E2E） | ① 改成 161（最小改动，但仍是会漂移的"派生数字"复制）；② **删掉正文合计**，只留指向 `npm test` 的说明（与"规模数字只留一个权威来源、不得复制"的纪律一致） | **②** |
| T1 | `tests/e2e/settings-tab.test.ts` 宿主标签守卫 | 正向断言读**未剥注释**的源码；`附件默认存放路径`/`当前文件所在的文件夹` 也出现在 `settings-tab.ts` 的说明性注释里 → 删掉真实 UI 文案断言仍绿（① 恒真） | ① 剥注释后再断言（与 `acceptance-tooling.test.ts` 既有手法一致）；② 断言具体提示串（更精确但更脆） | **①**（已做**变体测试**：删 UI 文案 → 转红 → 还原） |
| T2 | `src/core/types.ts` | core 里唯一自带逻辑却**无单测文件**的模块；`extOf` 历史上曾有两份**不等价**实现 | ① 新增 `tests/unit/core/types.test.ts` 并同步规模数字（成本：改两处）；② 认为已被间接覆盖、不补 | **①**（+8 用例，含"目录名含点不得污染 `extOf`"回归） |
| T3 | `tests/e2e/file-menu.test.ts` | 用例名"追加**四条**"，断言只 `length > 0` | ① 断言恰 4 条（与名一致、能抓第 5 个入口）；② 仅改用例名 | **①** |
| T4 | `tests/unit/acceptance-tooling.test.ts` + `tests/README.md`×2 | 写"**四项**解析能力"，守卫 `MARKERS` 实为 **5** 项 | ① 三处改为"五项"并补齐第 5 项描述；② 去掉数字 | **①** |
| D2 | `tests/README.md` §3.2 | 用例名"七种"而正文"八种"（第 8 条含空格路径在紧随其后的用例里） | ① 正文补一句交叉引用；② 不动（可读合） | **①** |
| C1 | `src/features/note-relocator.ts` 注释 | 例子漏列 `${parentpath}`（模板实为 4 个变量） | ① 补齐；② 不动 | **①** |

已核实为**准确、无需改动**的项（抽样）：`path-compatibility.ts` 注释引用的英文宿主标签
「Default location for new attachments → Vault folder」——已从 `obsidian.asar` 取证
（`option-new-attachment-location` / `option-choice-vault-root`）确认存在且映射正确。

### 3. 真实宿主运行验证

前置：`npm run build`（`dist` 与 `src` 比对一致、投放产物 sha 逐字相同）；已存在的验收库整体
`mv` 走（沙箱 shim 会拦批量删除并留下半成品库）后 `seed-acceptance` 从零重建；宿主由脚本自己
以子进程拉起（本机确认无实例在跑）。

| 运行 | 结果 |
|---|---|
| 全量验收（`custom`） | 文件 **71 → 91 → 93 → 93**，**第 3 轮收敛**，**问题 0**；索引 71 == 磁盘 71 |
| 启动哨兵（`--startup-check --automation`） | **笔记改写 0 篇 / 哨兵附件完好**；就绪信号 = `metadataCache.resolved`；启动期挡下 **49** 个 changed；护栏拒绝 **0**；自动化 **1063ms** 生效 |
| 默认落盘变体（`--variant obsidian-root`） | 文件 **71 → 90 → 93 → 93**，**第 3 轮收敛**，**问题 0** |
| 控制台三通道（`--console-only`） | NOTICE 82 / info 38 / warning **3** / **异常 0、失败 0**；3 条 warning 全是文档列明的预期负向用例（`.txt` 非受管 / HTML 不落存 / `:1` 不安全端口） |

### 4. 闭环证据

- `npm run typecheck` 通过；`npm run build` 通过；`dist/attachment-suite/main.js` 的 sha256 构建前后**逐字一致**
  （`053aef70…`）——**运行期行为零变化**（本轮只动注释、文档与测试）。
- 全量测试 **41 文件 / 543 用例**（`docs-consistency` 单跑 26 条全绿）；唯一失败仍是本机 shim 假失败。
- 变体测试 1 处（T1），已还原；工作区 6 改 + 1 新增，行尾全部 `w/lf`。

---

## 2026-10-14（第二轮）· 六维审计

> 范围与口径同上文「公共口径」，与上一节同日、仍是**一次性全面检查**，故另起一节（上一节结论保留不动）。
> 方法：先跑既有守卫与逐套件用例建立基线（§1），再把人力投到**机器守卫够不到的地方**——注释、
> 界面文案、文档叙述性断言、以及真实宿主的控制台三通道。
> 结论：**功能实现未发现致命缺陷，但抓到一处检测/修复口径分叉的潜在缺陷**（C2）；
> 共修 **12 处**（注释 8 · 界面文案 1 · 文档 2 · 测试有效性 1），另补 1 处实现修正与 2 处变体测试。

### 1. 基线

- `npm run typecheck` 通过。
- 机器守卫逐个单跑全绿：`docs-consistency` 26、`architecture` 9、`manifest` 3、`format-matrix` 5、
  `workflow-config` 10、`acceptance-tooling` 7、`types` 8。
- `unit/core` **10 个文件逐个单跑**全绿，且用例数与 `tests/README` §2.1 表格**逐格相符**
  （7/40/22/8/5/20/4/27/5/8 = 146）。整目录一次跑只收集到 7 个文件（本机已知"少收集"现象），
  故一律逐个单跑。
- 设置项"有无消费方"反查：`minSizeKb`/`tryCount`/`perHostIntervalMs` 虽不以 `.字段` 形式出现，
  但经 `localize-media.ts` 的解构读取——**无死设置**。

### 2. 发现与修复（每处先给可选方案与取舍，再取最优）

| # | 维度 | 位置 | 问题 | 可选方案与取舍 | 采纳 |
|---|---|---|---|---|---|
| C1 | 注释 | `src/core/task-queue.ts` | 文档注释写"队列是否**空闲**（无在途任务）"，而 `isProcessing()` 返回 `pending > 0`（**忙**）——语义写反 | ① 改注释为"正在处理"；② 改函数名（波及调用方） | **①** |
| C2 | 实现 | `src/core/path-compatibility.ts` · `cutByUnits` | 注释/函数名/`isViolation` 三处都称"按 **UTF-16 单元**截断（NTFS）"，实现却是 `Array.from(s).slice(...)`（按**码点**）。星面字符（emoji）下截出的名字仍可能超 `maxUnits` → **"修复"后依旧违规**（检测与修复口径分叉，正是本仓库最忌的形态） | ① 只改注释（承认按码点）——但名字/`isViolation`/测试名都指向 UTF-16，注释就成了"与事实不符"；② **改实现**真正按 UTF-16 单元切且不拆代理对（与 `isViolation` 的 `name.length` 同口径） | **②**（补 3 条断言 + **变体测试**：改回按码点 → 转红 → 还原） |
| C3 | 注释 | `src/core/types.ts` | 注释称"可进一步由 `isNoteEx` 排除 Excalidraw"——全仓 grep `isNoteEx`/`Excalidraw` **零命中**，纯属残留 | ① 删去幻影引用、改为如实描述（`.md`/`.canvas`）；② 保留 | **①** |
| C4 | 注释 | `src/core/attachment-index.ts` | `scanNoteText` 的注释首句"用于判定 embed/**broken**"，而同段下文已写明断链判定不在这里（`broken` 数组是已删的重构残留） | ① 首句去掉 `/broken`、只留 `embed`；② 不动 | **①** |
| C5 | 注释 | `src/core/type-classifier.ts` | GIF 动画判定注释称"读**逻辑屏幕宽度/高度**"，实际代码读的是 LSD 的 packed 字节（`data[10]`）算全局色彩表并数 GCE 个数 | ① 改为如实描述；② 不动 | **①** |
| C6 | 注释 | `src/core/link-resolver.ts`（2 处） | ① 称 `decodePercentEncoded` 是"**全仓唯一**的百分号解码实现"，而 `localize-media-core` 另有 `decodeURIComponent`（架构守卫本就只扫 core、并注明该差异）→ 全称断言过宽；② `rewriteCanvasFileFields` 称"需要它的有**两处**"，实为只经 `obsidian-domain.rewriteRefsInNote` 一处（canvas 改写"归位"到 core 后 feature 不再直接调用） | ① 收窄为"链接目标解析里全仓唯一"并补一句边界说明；② 改为"只经 infra 的改写总入口" | **① / ②** |
| C7 | 注释 | `src/features/name-formatter-core.ts` | 称 `sanitizeNameFragment` 与 `sanitizeFilename`"**同一口径**"；实则前者**删除**分隔符/保留字符并清控制字符，后者**拒绝**分隔符、**替换**保留字符为 `_`、不处理控制字符 | ① 改为如实对比；② 不动 | **①** |
| C8 | 注释 | `src/features/localize-media-core.ts` | `decodeHtmlEntity` 注释列的实体是 `&amp; &quot; &#39; &#47;`，代码实际处理的是 `&lt; &gt;`（`&#47;` 根本没被解码）——既多列又少列 | ① 按代码改正；② 不动 | **①** |
| C9 | 注释 | `src/features/unused-cleaner.ts` | "本仓库已经因为'两层口径不一致'栽过 **5 次**"，而 records 最新记到**第 6 次**（`real-host-log` §3.3）——手写计数漂移 | ① 同步为 6（仍会再漂）；② 去掉数字、改为"反复栽过"并指向 `invariants.md` §0（不再漂移） | **②** |
| D1 | 界面文案 | `src/settings-tab.ts` | 「自定义附件目录」说明只列 `\${notename}、\${parent}、\${date} 等`三个模板变量，而实现与根 README 都是**四个**（含 `\${parentpath}`） | ① 列全四个（与 README/`path-compatibility` 一致）；② 保留"等" | **①** |
| D2 | 文档 | `tests/README.md` §2.2/§2.3 | `automation-core.test.ts` 的链接指向 `features/`（属 `unit/features`），却被列在标题为"`unit/`（src 顶层纯逻辑）"的表下——表内自相矛盾 | ① 把该行并入 §2.2、并把 §2.3 标题改为"`unit/` 根目录（src 顶层纯逻辑 + 仓库级守卫）"；② 只改标题 | **①** |
| T1 | 测试有效性 | `tests/e2e/modals.test.ts` | 源码级守卫用**未剥注释**的原文断言 `toContain('effectiveDuration(')`——注释里出现同串即被喂饱（§7.4.2 的"① 恒真"，与上一节 T1 同类） | ① 剥注释后再断言（与 `settings-tab`/`acceptance-tooling` 同一手法）；② 不动 | **①**（**变体测试**：把真实调用换成别的名字、只在注释留该串 → 反向断言转红 → 还原） |

已核实为**准确、无需改动**的抽样：根 README 称"没有 ribbon 与状态栏项"（`grep addRibbonIcon/addStatusBarItem` 零命中）；
README 称坏链接报告覆盖 `<img>/<audio>/<video>/<source>/<a>`（`link-resolver` 的 `HTML_ATTR` 正含这五个标签）；
`docs/README` 的"18 = 5+4+8+1"文件数（实测相符）；威胁模型按"文件·符号"引用的 14 个符号全部存在。

### 3. 真实宿主运行验证

前置：`npm run build`；已存在的验收库整体 `mv` 走（沙箱 shim 拦批量删除并留半成品库——第二次 seed 已复现）
后 `seed-acceptance` 从零重建；宿主由脚本自己以子进程拉起（本机确认无实例在跑）。

| 运行 | 结果 |
|---|---|
| 全量验收（`custom`） | 文件 **71 → 91 → 93 → 93**，**第 3 轮收敛**，**问题 0**；索引 71 == 磁盘 71 |
| 启动哨兵（`--startup-check --automation`） | `noteChanges` **0** / `canaryIntact` **true**；就绪信号 = `metadataCache.resolved`；启动期挡下 **63** 个 changed；护栏拒绝 **0**；自动化探针 **1044ms** 生效 |
| 默认落盘变体（`--variant obsidian-root`） | 文件 **71 → 90 → 93 → 93**，**第 3 轮收敛**，**问题 0** |
| 控制台三通道（`--console-only`） | 共 **106** 行；**异常 0、失败 0**、`ERR_CONNECTION_REFUSED` **0**；warning **3** 条，全是文档列明的预期负向用例（`.txt` 非受管 / HTML 不落存 / `:1` 不安全端口） |

### 4. 闭环证据

- `npm run typecheck` 通过；`unit/core` 十个文件逐个单跑全绿；改动相关套件（`modals` 11 / `settings-tab` 33 /
  `docs-consistency` 26）全绿；两处变体测试均已还原（`git diff` 核对无残留）。
- 工作区改动：源码 8 改（7 处注释 + 1 处 `cutByUnits` 实现）、界面文案 1、`tests/README` 1、`modals.test.ts` 1、
  `path-compatibility.test.ts` 1；行尾逐个复核为 `w/lf`（其中 `path-compatibility.test.ts` 编辑后一度变 CRLF，已修回）。
- 顺手清理：仓库根误建的 `node_modules/`、`for-test/` 下的三个验收库残留目录。

---

## 2026-10-14（第三轮）· 六维审计（**执行上一轮元分析的"重点 + 降频"结论**）

> 范围与口径同上文「公共口径」。本轮**按项目记忆「审计策略」一节的结论组织**：
> 重点投到"注释维度"（唯一零机器守卫的维度）与"读源码文本做断言"的守卫；
> 对"已被守卫钉住且连续 ≥3 轮零发现"的 6 类**不做人工全查**，只确认守卫绿（见 §3）。
> 结论：**未发现功能性缺陷**；共修 **12 处**（注释 9 · 测试有效性 1 · 文档/约定 2），
> 其中 1 处是**实证的"断言恒真"**（`sort -V` 可被一条注释喂饱）。运行期行为零变化。

### 1. 基线

- `npm run typecheck` 通过；`unit/core` 十个文件逐个单跑全绿、与 `tests/README` §2.1 表格逐格相符
  （7/40/22/8/5/20/4/27/5/8 = 146）。
- 机器守卫单跑全绿：`docs-consistency` 26 / `architecture` 9 / `manifest` 3 / `format-matrix` 5 /
  `workflow-config` 10 / `acceptance-tooling` 7 / `types` 8。

### 2. 发现与修复

| # | 维度 | 位置 | 问题 | 可选方案与取舍 | 采纳 |
|---|---|---|---|---|---|
| C1 | 注释 | `type-classifier.ts` ZIP 分支 | 注释写"ZIP 系…（**查看第一目录条目名**）"，实则只在前端 4096B 里找 `word/` `xl/` `ppt/` 关键字 | ①改注释如实；②改实现去真解析条目名（成本高、收益低） | ① |
| C2 | 注释 | `type-classifier.ts` `zipFirstEntry` 文档 | 写"**读取 ZIP 本地文件头中的第一个条目名**"，实现不解析任何条目名 | 同上 | ① |
| C3 | 注释 | `link-resolver.ts` `stripCodeBlocks` 文档 | 称"被剥离部分替换为**等长空格**，保持行长"，实则围栏与围栏内**整行置空**（只有行内代码 / HTML 注释才等长填充） | ①改注释，并点明"**行数**保持"才是真契约；②改实现补齐行长（无调用方依赖，纯增负担） | ① |
| C4 | 注释 | `link-resolver.ts` `listMatches` 的 `@returns` | 写"**不含 frontmatter**"，实则本函数不剥 frontmatter（`cover: "![[a.png]]"` 这类也会被匹配） | ①改为"含 frontmatter 行内写法；裸路径资源另见 `listFrontmatterLinks`"；②改实现去剥 frontmatter（会动行为） | ① |
| C5 | 注释 | `attachment-index.ts` `resolvesInVault` 文档 | 称"精确路径或**唯一** basename"，实则 `basenameMap` 是多值索引、`has()` 只判存在 | ①去掉"唯一"，并说明"比 Obsidian 宽松、取'宁可漏报断链'的保守面"；②改判定为要求唯一（会新增误报，与该函数"消误报"的用途相反） | ① |
| C6 | 注释 | `attachment-index.ts` frontmatter 兜底注释 | 称"解析器与改写层共用 **`listFrontmatterResourceTokens`**"，实则共用的是 `FM_RESOURCE_TOKEN` **正则常量** | ①改为"共用同一个 `FM_RESOURCE_TOKEN`"；②不动 | ① |
| C7 | 注释 | `exporter.ts` 排除目录注释 | 称"与「清理未用附件」**口径一致**"，实则只取全局 `paths.exclude`、**不含** `cleanup.excludedFolders`，匹配语义也不同 | ①改为"同源但不完全相同：只取全局排除目录"；②改实现去合并清理专属名单（与 `command-inventory` §4.2 的既定设计相悖） | ① |
| C8 | 注释 | `localize-media-core.ts` frontmatter 外链说明 | 写"（或 **data:image**）"，实则接受 `data:` 的图片 / 音频 / 视频三类 | ①按代码补全；②不动 | ① |
| C9 | 注释 | `localize-media.ts` 白名单闭合处 | 注释带一个**孤儿标记（M6）**——全仓无任何 `M6` 定义（旧清单残留） | ①删标记并把原句说清；②保留 | ① |
| T1 | 测试有效性 | `tests/unit/workflow-config.test.ts` | `runScripts` 返回的脚本**含整行注释**，`expect(script).toContain('sort -V')` 于是可被注释喂饱——**实证**：`release.yml` 的 `sort -V` 恰好也出现在一条说明注释里，把真命令改坏、断言仍绿（这是第 4 个"读文本断言未剥注释"的守卫；前三个已在 10-03 / 10-13 / 10-14 各修一次） | ①`runScripts` 里把**整行注释置空**（保留行数；行内尾注释不动——pin 行的 `# vX.Y.Z` 正是被断言的字符串的一部分）；②全文件通用剥 `#` 注释（会破坏 pin 行断言，**不可行**） | ①（**变体测试**：把真命令的 `sort -V` 改成 `sort`、注释保留 → 断言转红 → 还原） |
| D1 | 文档/约定 | `docs/specs/invariants.md` §4 | 历轮注释类问题**过半**出自"全称 / 枚举 / 计数"断言（唯一 / 两处 / 共 N 处），这类句子不会随代码变动自动更新——属**可预防**的形态，却没有一条写下来的约定 | ①在文案规范里补一条"源码注释不要下全称 / 枚举 / 计数断言"；②不写（靠每轮人工再抓） | ① |
| D2 | 文档 | `tests/README.md` 的 `workflow-config` 行 | 该守卫新增"整行注释置空"后，逐文件清单未反映 | ①补一句；②不动 | ① |

### 3. 按上一轮结论执行的"降频"（本轮**未做人工全查**，只确认守卫绿）

| 降频项 | 依据（守卫 + 连续零发现轮次） | 本轮如何确认 |
|---|---|---|
| 功能完整性 / 命令与入口 / 门禁 | 连续 5 轮 0 发现 | `docs-consistency` ⑦（命令 id 集合 = 源码注册）绿 |
| 死设置 / 自报默认值 | 连续 4 轮 0 | `docs-consistency` ⑥ 默认值对账 + `settings-tab` 守卫绿 |
| 宿主原生标签 | 连续 4 轮 0 | `settings-tab` 的 `HOST_LABELS` 守卫绿 |
| 规模数字 / 命令口径 / 悬空引用 | 连续 3 轮 0 | `docs-consistency` ①②③⑤ 绿 |
| 错误模型五处收口 / 裸 `Notice` | 连续 4 轮 0 | `notify-contract` + `modals` 守卫绿 |
| 架构分层 / 唯一实现 / 白名单 | 连续 4 轮 0 | `architecture` 9 条绿 |

### 4. 真实宿主运行验证（四件套）

| 运行 | 结果 |
|---|---|
| 全量验收（`custom`） | 文件 **71 → 91 → 93 → 93**，**第 3 轮收敛**，**问题 0** |
| 启动哨兵（`--startup-check --automation`） | **笔记改写 0 篇 / 哨兵附件仍在原处**；就绪信号 = `metadataCache.resolved`；启动期挡下 **68** 个 changed；护栏拒绝 **0**；文件 73 → 93 → 95 → 95，第 3 轮收敛，**问题 0** |
| 默认落盘变体（`--variant obsidian-root`） | 文件 **71 → 90 → 93 → 93**，**第 3 轮收敛**，**问题 0** |
| 控制台三通道（`--console-only`） | 共 **106** 行；**异常 0**；warning **3** 条，全是文档列明的预期负向用例（`.txt` 非受管 / HTML 不落存 / `:1` 不安全端口）；所有摘要均为"失败 0" |

### 5. 关于"给注释加守卫"的结论（上一轮的点名项）

- **不做**通用守卫。理由：本轮 9 处注释问题里，**只有"引用的标识符 / 文件不存在"这一类**可机器判定，
  而它在 `src/` 注释里**几乎全是有意的历史说明**（`features/link-fixer-core.ts`＝"原本住在"、
  `STARTUP_SUPPRESS_MS` / `isTestEnv`＝"旧实现"、`VaultAdapter` 的 `exists/read/readHead`＝"此前还声明了"、
  `ANF`＝外部插件）——要放行它们就得维护一份不断增长的豁免名单，正是本仓库"通用规则会引蛇出洞、
  denylist 才精确"那条教训的反面。
- 其余 8 处是**语义**不符（"口径一致"其实不一致、"唯一"其实不唯一、"读条目名"其实读关键字），
  **没有任何守卫能判定**。
- 故改为**约定侧收口**（D1）：把"不要在注释里下全称 / 枚举 / 计数断言"写进 `invariants.md` §4，
  把这类漂移从"每轮人工再抓"降为"写的时候就不产生"。**可机械化的那一条**（孤儿标记如 `M6`）本轮已清除；
  若再现，再考虑窄口径 denylist。

### 6. 闭环证据

- `npm run typecheck` 通过；`docs-consistency` 26 / `workflow-config` 10 / `architecture` 9 全绿；`unit/core` 逐文件全绿。
- 变体测试 1 处（T1），已还原（`git diff` 核对 `.github/workflows/release.yml` 无残留）。
- 工作区改动：源码注释 6 文件（`type-classifier` / `link-resolver` / `attachment-index` / `exporter` /
  `localize-media-core` / `localize-media`）、守卫 1（`workflow-config.test.ts`）、`invariants.md`、`tests/README.md`；
  行尾逐个复核 `w/lf`。
- 顺手清理：`for-test/` 下三个验收库残留目录。

---

## 2026-10-14（第四轮）· 六维审计（**先立规程，再按规程执行**）

> 与前几轮不同：本轮**先把"为什么会反复发现问题"的根因固化成规程**（`docs/specs/invariants.md` 新增 §8），
> 再**按该规程**执行审计——重点补上以往缺失的两个动作：**一次修全部同类**（§8.3）与**防线自审**（§8.4）。
> 结论：**未发现功能性缺陷**；规程 1 份（新增 §8） + 修复 **1 处**（同类病灶的第 4 个实例，一次修全）；
> 运行期行为零变化。

### 1. 修正方案（对应前一轮识别的四处疏漏）

| 疏漏 | 规程条款 | 落点 |
|---|---|---|
| ① 改动不同步（"只改了一半"） | **§8.2**：能加守卫的优先加守卫；**不要在注释/文档里下"唯一 / 共 N 处 / 两处消费方"这类全称、枚举、计数断言**；改完一处事实当场扫"哪里还写着它"，并写下扫到的处数 | `invariants.md` §8.2（+ §4 末条） |
| ② 守卫覆盖不均（注释零守卫） | **§8.1 + §8.5**：判据看**复发**不看发现；被守卫钉住且连续若干轮零发现的类**不再逐轮人工全查** | `invariants.md` §8.1 / §8.5 |
| ③ 同类问题逐个打补丁 | **§8.3**：修一处同类 → 当场全仓扫同类 → 一次修完；记录里写明"**扫到 N 处、缺口 M 处**" | `invariants.md` §8.3 |
| ④ 防线自身也会恒真 | **§8.4**：守卫必须带**防空转断言**与**防喂饱**（剥整行注释）；新建/改守卫必须做**变体测试**并留痕 | `invariants.md` §8.4 |

### 2. 按 §8.3「一次修全部同类」：守卫的"读文本断言"

**扫到 8 个读源码 / 配置文本做断言的站点**（此前是分四轮逐个打补丁的），逐个判定：

| 站点 | 是否剥注释 | 防空转 | 判定 |
|---|---|---|---|
| `architecture.test.ts` | ✅ `stripComments` | ✅ | 合规 |
| `acceptance-tooling.test.ts` | ✅ `codeOnly` | ✅ | 合规 |
| `modals.test.ts` | ✅ `CODE` | ✅ | 合规 |
| `settings-tab.test.ts`（宿主标签块） | ✅ `SRC_CODE` | ✅ | 合规 |
| `settings-tab.test.ts`（默认值块） | — | ✅ | **不属同类**：它是"结构抽取 + 与 `DEFAULT_SETTINGS` **值比对**"，不是存在性扫描 |
| `acceptance.test.ts`（读夹具源码） | — | ✅（`marks.length < 9` 先红） | **不属同类**：它以**注释为目标**（校验分节小计），"剥注释"不适用 |
| `docs-consistency.test.ts` / `manifest.test.ts` | — | ✅ | **不适用**：前者读 `.md`、后者读 JSON，都没有注释概念 |
| **`workflow-config.test.ts`** | ⚠️ 上轮只修了 `runScripts` | ✅ | **缺口** → 本轮一次修全（见下） |

**缺口处置（一次修全，而非再打一次补丁）**：把"整行注释置空"从 `runScripts` 提到**文件级的 `read()`**，
于是 `RELEASE` / `VERIFY` / `COMPOSITE` / `ESBUILD` 四个文本的**所有** raw-text 断言统一生效——
顺带覆盖了 `ESBUILD`（`.mjs`）里的 `//` 注释（原先只处理 YAML 的 `#`）。行内尾注释仍不动，
因为 pin 行的 `# vX.Y.Z` 本身就是被断言的字符串。**变体测试**：重构后再把真命令的 `sort -V` 改成 `sort`
→ 断言**仍转红** → 还原（非空洞成立）。

### 3. 按 §8.4「防线自审」与 §8.2「联动抽查」

- **防线自审**：抽查的守卫均带防空转断言、解析型均先归一化行尾；无新增缺口。
- **联动抽查**：对上一轮改动过的四处措辞（ZIP 判定说明、`唯一 basename`、`data:image` 括注、exporter 排除口径）
  反向 `grep` "哪里还写着它" → **无遗留**（不存在"只改一半"）。
- **注释维度的存量扫描**（新 §4 约定针对的正是"全称/枚举/计数"断言）：全仓 `src` 注释扫描结果为
  **0 处需要修正**——仅 2 处"准确但含计数"的表述（`bulk-collect` 的"共用 `isSharedEntry`，两处口径一致"、
  `link-resolver` 的"链接目标解析里全仓唯一"），二者当下均为真，按"新写的遵守新规则"保留。

### 4. 真实宿主运行验证（四件套）

| 运行 | 结果 |
|---|---|
| 全量验收（`custom`） | 文件 **71 → 91 → 93 → 93**，**第 3 轮收敛**，**问题 0** |
| 启动哨兵（`--startup-check --automation`） | **笔记改写 0 篇 / 哨兵附件仍在原处**；就绪信号 = `metadataCache.resolved`；启动期挡下 **59** 个 changed；护栏拒绝 **0**；文件 73 → 93 → 95 → 95，第 3 轮收敛，**问题 0** |
| 默认落盘变体（`--variant obsidian-root`） | 文件 **71 → 90 → 93 → 93**，**第 3 轮收敛**，**问题 0** |
| 控制台三通道（`--console-only`） | 共 **106** 行；**异常 0**；warning **3** 条，全是文档列明的预期负向用例（`.txt` 非受管 / HTML 不落存 / `:1` 不安全端口）；无任何非零失败 |

### 5. 按 §8.5 的降频确认（只跑守卫，不做人工全查）

`docs-consistency` 26 / `architecture` 9 / `manifest` 3 / `format-matrix` 5 / `workflow-config` 10 /
`acceptance-tooling` 7 / `types` 8 / `notify-contract` 10 / `settings-tab` 33 / `defaults` 4 —— **全绿**，
覆盖"功能完整性 / 死设置与自报默认值 / 宿主原生标签 / 规模数字与命令口径 / 错误模型收口 / 架构分层"六类。

### 6. 闭环证据

- `npm run typecheck` 通过；`npm run build` 通过；上述守卫与 `unit/core` 全绿。
- 变体测试 1 处（§2，重构后复测仍转红），已还原（`git diff` 核对 `release.yml` 无残留）。
- 工作区改动：`docs/specs/invariants.md`（新增 §8）、`tests/unit/workflow-config.test.ts`、本文件；行尾 `w/lf`。
- 顺手清理：`for-test/` 下三个验收库残留目录。

---

## 2026-10-14（第五轮）· 六维审计（**按 §8 规程，补两个此前从未扫过的角度**）

> 本轮沿用上一轮立的规程，重点补两个**历轮没扫过**的角度：
> ①「**零 offender 断言是否都带防空转/正对照**」（§8.4）；②「**空集合恒真**」（tests/README §7.4.3 的 ①③）。
> 结论：**未发现功能性缺陷**；同类病灶 **2 处、按 §8.3 一次修完**；运行期行为零变化。

### 1. 基线

`npm run typecheck` 通过；守卫逐个单跑全绿（`docs-consistency` 26 / `architecture` 9 / `manifest` 3 /
`format-matrix` 5 / `workflow-config` 10 / `acceptance-tooling` 7 / `types` 8 / `automation-core` 10）。

### 2. §8.3 一次扫全：零 offender 断言的"防空转 / 正对照"

**扫到约 20 处**形如 `expect(<扫描结果>).toEqual([])` 的断言（跨 9 个文件），逐处判定"输入为空时会不会静默通过"：

| 判定 | 处数 | 处置 |
|---|---|---|
| 已带**非空/计数**前置断言（`architecture`、`format-matrix` 的 `toBeGreaterThan`、`docs-consistency` 的"至少 100 处 / 至少 1 处"…） | 多数 | 合规 |
| 由**兄弟断言**保护（输入为空则邻近的肯定式断言先红：`workflow-config` 的 `keys`、`notify-contract`/`file-menu`/`real-suite` 的正反两向） | 若干 | 合规 |
| 带**正对照/变体**（`seed-acceptance` 的"273 字节应判超限"） | 1 | 合规 |
| **缺口** | **2** | 见下 |

**两处缺口（一次修完，不再逐个打补丁）**：

| # | 位置 | 问题 | 可选方案与取舍 | 采纳 |
|---|---|---|---|---|
| F1 | `tests/unit/acceptance-tooling.test.ts` | `MARKERS` 是**手写字面量表**，用例名写着"全部**五项**解析能力"，但没有任何断言约束它的大小——表被清空/残缺时 `filter` 恒为空，**"守卫已失效"与"确实没问题"分不开** | ①补 `toBeGreaterThanOrEqual(5)` 前置断言（与 `format-matrix` 的矩阵行数同一手法）；②断言恰为 5（更紧，但加第 6 项时会误红、还得同步用例名） | ①（**变体测试**：把表砍到 2 项 → 转红 → 还原） |
| F2 | `tests/e2e/modals.test.ts` | 源码级守卫用一条**内联正则**扫"硬编码毫秒数"，正则一旦写坏就恒为空集；唯一的"反向确认"只证明 `modals.ts` 里有 `effectiveDuration(`，**证明不了那条正则还活着** | ①把正则**抽成常量并与正对照共用同一份**（用已知硬编码串 `new Notice(msg, 3000)` 做正对照）；②另写一条正则做正对照（证明不了扫描用的是哪条） | ①（**变体测试**：把正则改成永不匹配 → 正对照**转红** → 还原） |

> **复发率（§8.1）**：这一类（"零 offender 断言缺防空转"）是**第 2 次出现**——
> 首次是 2026-10-03 给 `architecture.test.ts` 补"至少扫到 N 处"；此后 3 轮未复发，本轮一次扫全后清完 2 处。

### 3. §8.3 一次扫全：空集合恒真（§7.4.3 ①③）

扫"集合可能为空却在其上断言/循环"的形态（`every` / `some` / `forEach` 内断言）：

- `real-suite.test.ts` 的 `broken.items.every(i => typeof i.onClick === 'function')`——**紧邻的前一条**断言已用
  `sorted(...)` 精确锁定该列表的两个元素，列表非空已被证明 → 非恒真；
- `docs-consistency.test.ts` 两处 `forEach((line, i) => …)`——遍历的是**已 `existsSync` 的文件行**，
  且该守卫另带"至少提取到 100 处引用 / 至少 1 处 `docs/` 路径"的防空转断言 → 合规；
- `modals.test.ts` 注释里记的 `[].every(...)` 恒真陷阱——**代码里已用 `sections.length > 0 &&` 修好**，属已闭环项。

**结论：0 缺口**（不是"没扫"，而是扫到 3 类形态后逐处核到保护措施）。

### 4. §8.2 联动抽查与文档散文

- 本轮只改测试断言、未改任何"事实"，联动检查无对象；反向抽查上一轮改过的措辞仍**无遗留**。
- 顺带核实一处**文档声称的覆盖**是否属实：`tests/README` 与 `coverage-matrix` 都称"导出体积上限（512MB）已由
  `real-suite` 第 6 组用替身伪造 `stat.size` 覆盖"——前几轮曾登记为"未覆盖"，本轮核对**确实存在**
  （`real-suite.test.ts` 第 6 组内的伪造说明与用例）→ 文档声明准确，**0 发现**。

### 5. 真实宿主运行验证（四件套）

| 运行 | 结果 |
|---|---|
| 全量验收（`custom`） | 文件 **71 → 91 → 93 → 93**，**第 3 轮收敛**，**问题 0** |
| 启动哨兵（`--startup-check --automation`） | **笔记改写 0 篇 / 哨兵附件仍在原处**；就绪信号 = `metadataCache.resolved`；启动期挡下 **69** 个 changed；护栏拒绝 **0**；文件 73 → 95 → 95 → 95，第 3 轮收敛，**问题 0** |
| 默认落盘变体（`--variant obsidian-root`） | 文件 **71 → 90 → 93 → 93**，**第 3 轮收敛**，**问题 0** |
| 控制台三通道（`--console-only`） | 共 **106** 行；**异常 0**；warning **3** 条，全是文档列明的预期负向用例（`.txt` 非受管 / HTML 不落存 / `:1` 不安全端口）；无非零失败 |

### 6. §8.5 降频确认（只跑守卫）

`docs-consistency` 26 / `architecture` 9 / `manifest` 3 / `format-matrix` 5 / `workflow-config` 10 /
`acceptance-tooling` 7 / `types` 8 / `notify-contract` 10 / `settings-tab` 33 / `defaults` 4 —— **全绿**。
连续零复发轮次：**功能完整性/命令与入口 6 轮**、**宿主标签 5 轮**、**架构分层与错误模型收口 5 轮**、
**规模数字与命令口径 4 轮**、**注释（本轮 0 发现，上一轮 9 处已清）**。

### 7. 闭环证据

- `npm run typecheck` 通过；两处变体测试（F1 / F2）均已还原（`git diff` 核对无残留）。
- 工作区改动：`tests/unit/acceptance-tooling.test.ts`、`tests/e2e/modals.test.ts`、本文件；行尾 `w/lf`。
- 顺手清理：`for-test/` 下三个验收库残留目录。

---

## 2026-10-14（第六轮）· 定向审查（按上一轮推荐：**放宽口径重扫注释** + **§7.4.3 的②③**）

> 上一轮的结论是"文档/注释不再单独设轮"，但留了两个**便宜的定向项**：
> ① 复核"注释计数断言存量 0"这个结论的**口径宽度**（上轮用的是窄正则）；② 系统扫 `tests/README` §7.4.3 的
> 第②级（无断言、只受不变式）与第③级（**路径不可达**）。本轮只做这两项 + 按新节奏的真宿主验证。
> 结论：**未发现功能性缺陷**；修 **3 处**（注释 1 · 测试前提 1 · 文档登记 1），其中 1 处是**安全相关用例的无效前置**。

### 1. 放宽口径重扫注释里的"计数 / 全称"断言

上轮用的是窄正则（只匹配"全仓唯一 / 共 N 处 / 两处 / 三处…"），本轮把词表放宽到
"唯一 / 全部 / 全都 / 均 / 一律 / 所有 / 任何 / 每一 / 共 N 处 / 两三四五六七八九十处 / N 种条类次"
并排除豁免词（已删除 / 勿复活 / 原本 / 此前 / 旧实现 / 参照 / 例如 / 示例 / 占位）。

**扫到约 50 条**含此类措辞的注释，逐条核实后：**1 处过宽、1 处准确但易误读**。

| # | 位置 | 问题 | 可选方案与取舍 | 采纳 |
|---|---|---|---|---|
| C1 | `src/core/link-resolver.ts`　`parseMdTarget` 文档 | 写"**全仓唯一**的 markdown 目标解析"，但验收 harness 与 CDP 脚本因 TS↔mjs 无法共用代码、**各自另有一份等价解析**（这正是 `acceptance-tooling.test.ts` 存在的理由）→ 全称断言过宽 | ①限定为"**插件运行时代码里**唯一"，并点明另两份由哪条守卫看守（与上一轮给"全仓唯一解码"收窄的同一手法）；②不改（读者会以为只有一份） | ① |
| — | `src/core/link-resolver.ts`　`refMapForMoves` 的"（唯一被横向依赖的 feature）" | 读起来与 `ALLOWED_CROSS_FEATURE` 的 4 条冲突；但同句已有"被当成**共享执行模块**"这一限定，指的是"共享工具式横向依赖"而非白名单里的**纵向编排** | ①加限定词（更清楚但动到历史陈述）；②保留 | **②保留并登记**（与上一轮对"准确但含计数"的两处同一处置） |

**其余 48 条**均为**准确描述**（抽样核对：`addRefKeys` 的"三种引用写法"＝完整路径 / basename / 主名**恰三项**；
`settings-tab` 的"两份按用途裁剪过的列表"＝本地化去「其他」/ 命名加「网页」；`settings.ts` 的"三种写法"＝
md 图片 / 普通链接 / HTML 媒体标签；以及大量"两种解释 / 两类误报 / 两条路径"之类**描述当前逻辑**的措辞）。

### 2. §7.4.3 ③：路径不可达

- **成因排查**：历史上的成因是"环境开关把分支在测试里关掉"（`isTestEnv ? 0 : 1500`）。全仓 `src` 已**无任何**
  `process.env` / `isTestEnv` 之类的测试开关（只剩注释里的历史说明）；`scripts` 里 `process.env` 只用于
  `LOCALAPPDATA` / `GITHUB_TOKEN` 这类真实取值，不构成开关。
- **但扫出一处实质问题（安全相关）**：

| # | 位置 | 问题 | 可选方案与取舍 | 采纳 |
|---|---|---|---|---|
| T1 | `tests/e2e/real-suite.test.ts` 的「库索引未就绪时的 changed 不得触发自动改写」 | 该用例用 `armAutomation({ settleDeadlineMs: 600000 })` 想"把兜底窗口给足"，**但那行是无效的**——就绪兜底定时器只在 `onload` 时按**默认值**装一次，而 `armAutomation` 只改 `automationGuard` 并重装**轮询**定时器，**不会重装兜底定时器**。用例过去只是因为"等待 2.4s < 默认 8s"才恰好没被兜底放行——**一旦默认窗口被调小，这条用例会静默失去意义**（它保护的正是"打开库不静默批量改写"这条头号风险） | ①把前提**断言**出来（`getAutomationDiagnostics().settled === false`）——即使将来前提被破坏也会**响亮地红**，且符合 `tests/README` §7.4.4 的"夹具前提必须与 expect 对得上"；②给插件加"重装兜底定时器"的公开入口，让覆盖真的生效（要动 `main.ts` 这一安全机制，风险与范围都更大） | **①**（**变体测试**：把默认 `settleDeadlineMs` 改成 100 → 兜底放行 → 前提断言**转红并给出准确提示** → 还原） |

- **顺带登记（不静默放过）**：那个"兜底放行"分支本身**在测试里不可达**（同上原因），已写入
  `docs/specs/coverage-matrix.md` §5「仍未覆盖」，并注明**只影响可用性、不影响安全性**（批量护栏仍在），
  以及"要覆盖需先给插件加重装入口"。

### 3. §7.4.3 ②：只受全局不变式保护的覆盖面

核实 `acceptance-fixture` 里三条**不设机器校验**的用例（`X01` 粘贴即处理 / `X02` 启动不批量处理 /
`P02` 保留名与非法字符）：其登记理由（"表只拿得到最终状态、改不了设置也发不出事件"、"属时序性质"、
"Windows 无法落地此类文件，由单测覆盖"）**仍然准确**，且 `P02` 指向的单测确实存在 → **0 发现**。

### 4. 真实宿主运行验证（按新节奏：本轮跑**全量 + 哨兵**，变体与三通道轮换）

| 运行 | 结果 |
|---|---|
| 全量验收（`custom`） | 文件 **71 → 91 → 93 → 93**，**第 3 轮收敛**，**问题 0** |
| 启动哨兵（`--startup-check --automation`） | **笔记改写 0 篇 / 哨兵附件仍在原处**；就绪信号 = `metadataCache.resolved`；启动期挡下 **49** 个 changed；护栏拒绝 **0**；文件 73 → 95 → 95 → 95，第 3 轮收敛，**问题 0** |

### 5. 复发率（§8.1）

- **"注释里的全称断言过宽"＝第 2 次同族出现**（第三轮修过 2 处：`decodePercentEncoded` 的"全仓唯一"、
  `rewriteCanvasFileFields` 的"需要它的有两处"；本轮 1 处）。同族累计 3 处，**均集中在 `core/link-resolver.ts`**
  ——下一轮若再动这个文件，优先复查它的全称断言。
- **"测试前提与 `expect` 对不上"（§7.4.4）**：本轮 1 处，是该规则立规后的**首例落地**。
- 连续零发现：功能完整性/命令与入口 **7 轮**、宿主标签 / 架构分层 / 错误模型收口 **6 轮**、规模数字与命令口径 **5 轮**。

### 6. 闭环证据

- `npm run typecheck` 通过；`link-resolver` 40 / `docs-consistency` 26 / 目标用例（`real-suite` 单跑 1 通过、
  55 skipped）全绿；变体测试 1 处已还原（`git diff` 核对 `automation-core.ts` 无残留）。
- 工作区改动：`src/core/link-resolver.ts`（注释）、`tests/e2e/real-suite.test.ts`（前提断言）、
  `docs/specs/coverage-matrix.md`（登记）、本文件；行尾 `w/lf`。
- 顺手清理：`for-test/` 下两个验收库残留目录。

---

## 2026-10-14（第七轮）· **台账式**审查（产物 × 六维度 × 依据）

> 起因：用户追问"为什么每次都还能查出问题、怎样才能不反复"。本轮不再"扫一圈报发现"，而是先把**审计面完整枚举**
> 成一张台账（每一格标注**依据**：哪条守卫 / 哪一轮人工核过 / 不适用），**只有"无依据"的格才新做人工检查**。
> 这样"0 发现"与"根本没扫到"才可区分，也让"还剩哪些格没依据"变成一份有限、可清空的清单。
> 结论：台账首次定位出一个**此前六轮从未查过的格**——`scripts/` 里未被守卫覆盖的脚本 → 修 **1 处**。

### 1. 台账（产物 × 维度 → 依据）

| 产物 | 功能完整性 | 文档一致性 | 注释 | 界面文案 | 测试有效性 | 真宿主 |
|---|---|---|---|---|---|---|
| **src**（46 个 .ts） | 守卫 + harness 行为用例 | — | **R3 逐文件核过**；R3 之后改动过的本轮复核 | `settings-tab` 守卫 + `docs-consistency` ⑥ | — | 四件套（本轮跑全量+哨兵+变体） |
| **tests**（45 个 .ts） | — | 套件表/规模由 `docs-consistency` ①② | — | — | R5 扫"防空转/正对照"＋R6 扫"空集合/循环"＋本轮抽查 | 两个 CDP 脚本由 `acceptance-tooling` 看守 |
| **docs**（18 篇） | — | `specs/` 由守卫 ①–⑧ 逐条对账；`records/`、`archive/` **按约定不纳入**（记"当时"） | — | — | — | — |
| **scripts**（8 个文件） | — | ← **本轮首次逐文件核** | ← 同上 | — | 2 个 CDP 脚本有守卫；其余 4 个**无守卫** ← 本轮补 | 由脚本自身执行 |
| **.github**（3 个文件） | — | — | — | — | `workflow-config` 守卫 | 发布链路 |
| **根 README** | — | 守卫 ⑦（命令口径）+ 多轮人工核散文 | — | — | — | — |

**无依据格清单**：只有 **`scripts/` 里未被守卫覆盖的 4 个**（`check-action-pins.mjs` / `cdp-eval.mjs` /
`cdp-probe.mjs` / `launch-obsidian-debug.cmd`）。其余格要么有守卫、要么在 R3/R5/R6 已人工核过。

### 2. 补格结果（`scripts/` 4 个）

逐文件读完后核到：`cdp-eval.mjs`、`cdp-probe.mjs` 的用法说明与实现**一致**；
`launch-obsidian-debug.cmd` 的 "see tests/README.md sec. 5" 经核**属实**（§5 = 运行与使用，其中正是启动器那段）；
`.cmd` 行尾 `w/crlf` 与 `.gitattributes` 的 `*.cmd text eol=crlf` **相符**，且正文仍 **ASCII-only**。
**1 处发现**：

| # | 位置 | 问题 | 可选方案与取舍 | 采纳 |
|---|---|---|---|---|
| S1 | `scripts/check-action-pins.mjs` 头部 | ① 用引号**直引**了 README 的一句原话（"需要定期手动核对各 action 的新版本，并改 SHA 与行尾注释"）——而 README 改版后**已无此句**（现文是"都靠手动核对"）；② 写"**5 个 action 共 10 次请求**"——`5` 是**当前**的钉扎仓库数，加一个 action 就漂（实测当前确为 5 个仓库、10 次请求，属"当下对、必漂"） | ① 去掉引号、改述为"README 要求**手动**核对 action 版本"（不再声称是原文）；② 计数改为**不漂**的表述"每个 action 请求 2 次"；③ 保留（但两处都会随 README/工作流漂） | **①②**（同一处，一次改完） |

### 3. 其余维度的抽查（补台账的"依据"列）

- **注释**：只复核 R3 之后改动过的文件，并对 R3 改过的措辞做反向 `grep`（防"只改一半"）→ **无残留**
  （唯一命中在 `docs/archive/` 的 2026-09 计划件，按"不改写历史"保留）。
- **测试有效性**：新角度扫"循环内断言但循环体可能不执行"——103 处 `for` 循环里，遍历**派生集合**的 4 处
  全部带非空前置断言或遍历字面量（`file-menu` 的 `items.length > 0`、`settings-tab` 的 `quoted.length > 0`、
  `real-suite` 的 3 元素字面量）→ **0 缺口**。
- **文档散文**：核 `docs/README` 的三层与"四个容易踩的点"、以及**本轮新增的 `invariants` §8 自身**是否自洽
  （§8.3 举的"同族分四轮才清完"与 §8.5 的降频清单都与实际执行一致）→ **0 发现**。

### 4. 真实宿主运行验证（本轮跑**全量 + 哨兵 + 落盘变体**，三通道下轮轮换）

| 运行 | 结果 |
|---|---|
| 全量验收（`custom`） | 文件 **71 → 91 → 93 → 93**，**第 3 轮收敛**，**问题 0** |
| 启动哨兵（`--startup-check --automation`） | **笔记改写 0 篇 / 哨兵附件仍在原处**；就绪信号 = `metadataCache.resolved`；启动期挡下 **65** 个 changed；护栏拒绝 **0**；文件 73 → 93 → 95 → 95，第 3 轮收敛，**问题 0** |
| 默认落盘变体（`--variant obsidian-root`） | 文件 **71 → 90 → 93 → 93**，**第 3 轮收敛**，**问题 0** |

### 5. 复发率（§8.1）与"为什么会一直有问题"

- **同族（"引用了别处的原文/当时状态而不随更新"）＝第 2 次出现**：首次是 2026-10-13 的三处
  （工作流权限、README 措辞、发布状态），本轮 1 处（脚本头部直引 README 原句）。同族累计 4 处。
- **"脆计数"（写死"当前是 N 个"）＝第 3 次**：此前是注释里的"N 次/N 处"、"全仓唯一/两处"，本轮"5 个 action"。
  已在 §4/§8.2 立约定，但**存量仍在**——这是"表数字必漂"的可重复产物。
- **关于"为什么每次都能查出问题"**：台账给出的答案是——**产出下限不是 0，而是"该轮新补的格 × 每格的偏差率"**。
  本轮新补的格只有 `scripts/` 那 4 个，产出就是 1；前几轮补的格多（整库注释、测试有效性），产出就多。
  **要让"查出问题"归零，只有两条路**：把格交给守卫（已在做），或把格清空（本轮 `scripts/` 已清）。
- 连续零复发：功能完整性/命令与入口 **8 轮**、宿主标签 / 架构分层 / 错误模型收口 **7 轮**、
  规模数字与命令口径 **6 轮**、注释（R3 后每轮 0–1 处且均已清）。

### 6. 闭环证据

- `npm run typecheck` 通过；`docs-consistency` 26 全绿（本轮未动被对账文档的口径）。
- 工作区改动：`scripts/check-action-pins.mjs`（注释两处）、本文件；行尾 `w/lf`。
- 顺手清理：`for-test/` 下三个验收库残留目录。

---

## 2026-10-14（第八轮）· 真实宿主「非默认分支」变体验收（**命名富化**）

> 按上一轮台账的结论：唯一还"有肉"的格是**真实宿主的非默认分支覆盖**，且做法已定——
> "把它变成可重复执行的变体验收，那本身就是守卫：一次写、每轮跑、退化即红"。
> 本轮照此执行，**第一次跑就抓到两个真缺陷**。

### 1. 新增的守卫：`--variant naming-rich`

- **验什么**：`naming.folderByCategory` / `addTime` / `addPathHash` / `showSubType` 四个开关
  （验收库基线全是 `false`，故这四个分支在真实宿主上**从未执行过**）。四个一起开而不是逐个开——
  它们共同决定"一个文件名长什么样"：分开只能验"片段存在"，一起才能验**片段顺序与整体可解析**。
- **怎么改**：只动命名这四个轴（"其余字段保持验收库基线"的既有纪律）。**同时把"库必须是刚 seed"
  的前提守卫从 `obsidian-root` 推广到全部变体**：上一轮的产物会让命名/落盘断言误报，而假红比不报更贵。
- **断言按变体分叉**（不放大成模糊匹配）：`notes/assets/image/` 下必须出现
  `01-正文图片_image_png_<3 位>_<14 位时间戳>_<8 位哈希>.png`；类别子目录（image/video/audio/pdf）
  要在**多个笔记目录**下被真正建立；反向断言"不该仍落在 `notes/assets` 根"。
- **顺带修掉同类一处**：自动化探针的期望名也必须按变体分叉，否则组合
  `--variant naming-rich --automation` 会把"已经生效"误报成"链路未生效"。

### 2. 抓到的两个真缺陷（均已修 + 补钉子 + 变体测试）

| # | 缺陷 | 为什么历轮没发现 |
|---|---|---|
| ① | `parseRenamed` 把"类别段"写死为**一段**，而 `showSubType` 让类别段占**两段**（`image_png`）→ 已命名附件**认不回来**。单独开 `showSubType` 还有"重算出的 `to` 与原路径相同"兜着，与 `addTime`（时间戳每轮都变）**组合**就每轮重新命名 → **6 轮不收敛** | 两个开关在夹具里都是 `false`；**单独**开任一个都不出问题，只有组合才暴露 |
| ② | 「收集」的目标目录**不含类别段**，与「重命名」（`folderByCategory`）的落点互相矛盾 → 两条命令**每轮互相搬运** | 同理，`folderByCategory` 在夹具里是 `false` |

- **①的修法**：类别段边界改由"剩余前缀须等于笔记名"反推，不再写死段数（笔记名含连接符的旧场景不受影响）。
- **②的修法**：新增 `collectTargetDir`，与 `planForSnapshot` **同口径**；**含"归属目录为空＝库根时
  回退到附件当前目录"这一条**——少了它，"按类别分目录 + 默认库根"（即**用户开箱即用的组合**）
  会以另一种方式互搬，这是同类缺陷的**第二个实例**，一并修掉（§8.3）。
- **证据**：修 ① 后"最后一轮变化"从 **68 项 → 2 项**；custom 变体回归 **71→91→93→93，第 3 轮收敛，问题 0**。

### 3. 另外发现两项**既有**不收敛（已具名登记，未修）

两项都是**既有行为、与变体无关**：`custom` 下同样发生，只是副本名固定、"删旧建新"后快照里同名，
收敛判定看不出来；`addTime` 让名字每轮都变，才把它们显形。

1. **11-断链-大小写 的孤儿副本**：索引按大小写**不敏感**把 `PIC.png` 解析到共享附件 `pic.png` →
   「重命名」为它复制副本；但引用改写是大小写**敏感**的 → 副本无引用 → 「清理未用附件」删掉 →
   下一轮重建。**证据**：两个变体的回收站里分别能数出 3 份 / 6 份同名副本。
2. **超长笔记名（N16，80 个"长"）的共享音频副本每轮换时间戳**，且其引用被写成**裸文件名**（丢了目录）。
   **已确认**：`checkAlreadyRenamed` 对该名字返回**真**（解析器没问题）、磁盘名与笔记名前缀**逐字一致**
   （**不是截断**）；**同一轮的普通笔记（如 18）拿到的是完整路径**——裸名是 Obsidian 原生改链接的特征。
   **完整机理未确认**，已写明下一步诊断手段（打印每轮 `planForSnapshot` 的 from→to 与 copy/rename 计数）。

**登记方式**：脚本里 `KNOWN_CHURN` **具名豁免**（两条正则）、**不静默**（每次命中都打印命中项与数量）；
`coverage-matrix` §5 记两条并给出方案取舍。**为什么不修**：两项都不产生数据损失，修法则涉及产品语义
决策（引用改写的大小写口径、副本复用规则），**需要专门的诊断与设计，不宜在一轮末尾仓促改**。

### 4. 复发率（§8.1）

- **"开关组合才暴露"的缺陷＝首次记录**，这正是新变体的产出，也印证"变体作为守卫"的价值：
  它不是"再审一遍已知的格"，而是**第一次执行从未执行过的分支**。
- **"同类缺陷的第二个实例"（§8.3）**：修 collect 的目标目录时，顺带查出"库根模式"下的同族问题并一次修掉。
- 连续零复发：功能完整性/命令与入口 **9 轮**、宿主标签 / 架构分层 / 错误模型收口 **8 轮**、规模数字与命令口径 **7 轮**。

### 5. 闭环证据

- `npm run typecheck` 通过；`docs-consistency` 26 绿；`name-formatter-core` 21、`collect-core` 5、
  `bulk-collect-core` 5 全绿（规模 **41 文件 / 546 用例**，已同步 `tests/README` 第 8 行与套件表）。
- **两处变体测试**均已做并还原：`parseRenamed` 改回"单段类别"→ 新用例转红；`collectTargetDir` 去掉
  类别段 → 两个收集套件各转红。
- 真宿主：**custom 71→91→93→93（第 3 轮收敛，问题 0）**；**naming-rich 71→91→93→93（第 3 轮收敛，问题 0）**
  ——后者的收敛是**豁免两项已登记既有震荡之后**的结论，且豁免**每次命中都打印**（第 2 轮原始 28 项 → 未豁免 26；
  第 3 轮原始 2 项 → 未豁免 0）。
- 行尾逐个复核 `w/lf`（三处编辑后曾变 CRLF，已修回）。

---

## 2026-10-14（第九轮）· 对两项既有不收敛做"专门设计"（**诊断 → 定方案 → 未实施修复**）

> 按上一轮的结论执行"专门设计"，**第一步是诊断**——因为不知病因就改代码等于猜。
> 结果：**第 ② 项的根因彻底查清**（此前几轮只是症状描述），并**修掉了本轮自己引入的诊断工具缺陷**。

### 1. 设计目标、适用范围与取舍原则

- **目标**：消除两项既有不收敛；**不改变用户可见行为**；**不新增"会自动删文件"的路径**（数据风险优先）。
- **适用范围**：只触及"命名 ↔ 路径修复 ↔ 清理"三条命令的交互；单条命令的既有语义不变。
- **关键步骤**：① 诊断（拿事实）→ ② 定方案（列取舍）→ ③ 实施 + 补钉子 → ④ 撤豁免 + 复跑。
- **取舍原则**：优先"根因型、一处覆盖两项"的修法；避免"改口径"这类改变产品语义的方案。

### 2. 诊断（新增两件可复用的诊断能力）

- **`--trace-commands`**：每条命令后采一次**轻量快照**，打印"`命令 id` 改了 N 项"→ 回答"**是哪条命令**"。
- **`--plugin-log`**：打开插件诊断日志 + 在宿主里包一层 `console`，把 `planForSnapshot` 的
  `from → to` 与改名/复制计数取回 → 回答"**它为什么这么改**"。
- 两者**配合**才够用：一个给"谁改的"，一个给"为什么"。

### 3. 根因（第 ② 项，**已确认**）

`notes/<80 个"长">.md` 引用的共享音频，副本每轮换名字。计划级证据：

| 轮次 | 计划输出 |
|---|---|
| 第 1 轮 | `改名 0，复制 1`：`assets/mp3/song.mp3` → `…_audio_mp3_001_<ts>_<hash>.mp3`（**完整名**） |
| 第 2 轮 | `改名 1`：`…_audio_mp3_001_.mp3` → `…_audio_mp3_001_<ts>_<hash>.mp3`（**从被截断的名字改回完整名**） |

**链路**：`rename` 生成的完整名约 **366 字节**，而 NTFS 按 **UTF-16 单元**算（122 < 255）故**允许落盘**；
紧随其后的 `repair-incompatible-paths` 按 **255 字节**判它违规 → `repairName` **从尾部截断**、
把「时间戳/哈希」段切掉 → 下一轮 `rename` 因 `parseRenamed` 认不出该名字而改回完整名 → 又被截断 → **永久循环**。
`custom` 下同一个名字是 **254 字节**、刚好不越界，**所以只有命名富化会触发**。

**这就是项目自己反复记录的那种"两层口径不一致"**——生成侧不看长度限制，修复侧按字节截断，
两者对"合法名字"的定义不同。

### 4. 本轮实际做的修正

- ✅ **修掉诊断工具自身的侵入性**：早期 `--plugin-log` 用 `JSON.stringify` 序列化 log 参数，把宿主拖慢到
  **改变被测行为**（实测：开它之后连 `notes/assets` 都没建出来）。改为**只收字符串 + 限条数 + 只留计划类行**
  （且避开"模板字符串里的正则字面量"这个坑），复跑确认 `notes/assets` 正常建立。
- ❌ **未实施第 ② 项的产品代码修复**：修法方向已明确（让"生成"与"修复"共用**同一套长度口径**，且
  **截断笔记名片段、而不是尾部**以保住「类别_序号_时间戳_哈希」后缀，解析侧同步用同一规则比较前缀），
  但它动的是**核心命名与解析口径**，**必须单独一轮实现 + 补钉子 + 真宿主复验**——
  不在一段已极长的会话末尾仓促改它（这正是上一轮刚定下的纪律）。
- 第 ① 项（11 的孤儿副本）维持具名登记。

### 5. 验证结果与剩余风险

- **已验**：`docs-consistency` 26 绿；三处改动行尾 `w/lf`；`--plugin-log` 不再侵入（`notes/assets` 正常建立）；
  临时探针文件已删（**守卫抓到了它**——`docs-consistency` 的"每个测试文件都要登记"那条）。
- **未验（因未实施修复）**：第 ② 项仍在 `KNOWN_CHURN` 豁免名单里，`naming-rich` 的"问题 0"仍以"豁免两项"为前提。
- **风险**：修第 ② 项时若截断规则与解析规则**没做到逐字一致**，会从"每轮改名"退化成"名字对不上、直接断链"——
  **比现在更坏**。故必须先补"生成 → 解析"往返的单测（对超长名断言 `checkAlreadyRenamed(buildName(...)) === true`），
  再动真宿主。

---

## 2026-10-16（第十轮）· 按"建议的下一步"执行修复（**② 已闭环；① 未闭环**）

> 任务拆成 T1–T9（含优先级与依赖），逐项执行、逐项验证。**② 修好并撤掉全部豁免**；
> **① 的修法已实施且在 harness 层通过，但真宿主未生效**——如实留未完成。

### 1. 任务表与状态

| # | 优先级 | 任务 | 状态 |
|---|---|---|---|
| T1 | P0 | 补"生成→解析"往返钉子（超长名）——先让它红 | ✅（红："生成的名字越限：122 字符"） |
| T2 | P1 | 生成侧：超限时截断**笔记名片段**（保住后缀） | ✅ |
| T3 | P1 | 解析侧：`parseRenamed` 用**同一函数**反推期望前缀 | ✅ |
| T4 | P1 | 验证：不越限 + 能认回 + 再规划为 0 + `repairName` 幂等 | ✅（四条全绿） |
| — | P1 | **撤掉 ② 的豁免 → 真宿主复跑** | ✅（见 §3） |
| T5 | P2 | 修 ①（11 的孤儿副本）：改写侧与解析侧大小写同口径 | ⚠️ **未闭环**（见 §4） |
| T6 | P2 | 撤掉 `KNOWN_CHURN` 两条豁免 | ✅（数组已清空） |
| T7 | P3 | 真宿主 `naming-rich`（零豁免） | ✅ |
| T8 | P3 | 真宿主 `custom`（回归） | ✅ |
| T9 | P4 | 文档 + 提交 | ✅ |

### 2. ② 的修法（超长笔记名的副本循环）

**根因**（第九轮已确认）：`rename` 生成完整名 ~366 字节（NTFS 按 UTF-16 单元算 122<255，**允许落盘**），
而 `repair-incompatible-paths` 按 **255 字节**判违规、`repairName` **从尾部截断**把「时间戳/哈希」切掉 →
下轮 `rename` 认不出 → 改回完整名 → 再截断 → **永久循环**。

**修法（"口径统一"）**：新增 **`clipNoteName`**，**生成侧与解析侧共用**：
- 生成：`buildName` 超限时**只裁笔记名片段**（后段原样保留），保证"写出的名字"能被认回；
- 解析：`parseRenamed` 的两处前缀比较（类别段反推循环 + 末尾校验）都改用同一函数反推期望前缀。

**关键取舍**：**裁笔记名而不是从尾部截断**——后缀是解析器判定"已命名"的依据，切了它必然认不回。
这也解释了为什么不能简单复用 `repairName`（它就是尾部截断）。

**验证**：单测四条全绿 + 变体测试（把类别段改回单段/去掉裁剪即转红）。

### 3. 真宿主结果（**零豁免**）

| 变体 | 结果 |
|---|---|
| `naming-rich` | **71 → 92 → 94 → 94**（第 3 轮收敛），**问题 0**；第 3 轮变化 **0 项（未豁免）** |
| `custom`（回归） | **71 → 92 → 94 → 94**（第 3 轮收敛），**问题 0** |

文件数 **93 → 94**：正是"11 的副本不再被删"的预期变化（在 `custom` 下已确认库内保留 1 份、回收站 0 份）。

### 4. ① 的进展与未闭环之处（如实记录）

**已实施**：`lookupMapping`——引用改写先精确命中，未命中再退化为**大小写不敏感**匹配
（`rewrite` 与 `rewriteFrontmatter` 同口径），让**改写侧**与**解析侧**一致。
harness 层：钉子 + 变体测试均通过（改回精确匹配即转红）。

**真宿主未生效**：`notes/11-断链-大小写.md` 的引用 `![x](assets/png/PIC.png)` **仍是原样**，
副本依旧每轮重建（回收站 3 份）。**已排除**：
- 改写抛错 → 报告 `notices` 为 0 条、无"引用改写失败"日志；
- `map` 为空 → 同轮其它笔记（01、中文笔记等）的引用**确实被改写了**；
- 函数本身 → 钉子直接证明了它在"引用写 `PIC.png`、目标 `pic.png`"时能改写。

**结论**：根因不在改写函数，而在**为什么这条路径没有把该键带进 map**（或该笔记的改写未被触发）。
已在 `coverage-matrix` §5 登记"已排除项 + 下一步"，**不臆测**。

### 5. 闭环证据

- `npm run typecheck` 通过；`docs-consistency` 26 绿；`link-resolver` 41、`name-formatter-core` 22 全绿
  （规模 **41 文件 / 548 用例**，同步了 `tests/README` 第 8 行与套件表两行）。
- 工作区仅 7 个有意改动文件；行尾全部 `w/lf`（`link-resolver.test.ts` 编辑后曾变 CRLF，已修回）。
- 诊断期间临时插入产品代码的日志**已用 `git checkout HEAD --` 还原并确认无残留**。

---

## 2026-10-16（续）：复查纠正——① 实为**已闭环**；另发现收敛判定的一处盲区

**触发**：上一节与 `coverage-matrix` §5 都写着"① 根因待查、本项未闭环"。本轮先核实，再决定是否动手。

### 1. 纠正：上一节的"未闭环"是**方法错误**导致的误判

上节检查库状态时看的是 `mv` 走掉的**上一轮库**（`_v2_*` 之类的备份目录），而**当次跑出的结果始终在**
脚本当场 `seed` 的那个库里——**看错了对象**，于是把"更早、未修版本留下的状态"当成了"修后的状态"。

**正确查法下的结论（独立复跑 `--variant naming-rich`，无任何诊断开关）**：

| 观测点 | 结果 |
|---|---|
| 11 的引用 | `![x](notes/assets/image/11-断链-大小写_image_png_001_<时间戳>_9046ef72.png)` —— **已改写** |
| 副本是否在库内 | **在**（1 份） |
| 回收站里的 11 副本 | **0 份**（修前每轮进一份） |

**⇒ `lookupMapping` 的修复在真宿主上是生效的，① 已闭环。**

### 2. 为什么上一节会误判——值得记的教训

- 脚本的 `mv "$V" <备份> && seed && 跑` 这个习惯，使"**当次产物**"与"**上一轮备份**"只差一个目录名；
  检查时若不锁定"脚本刚 seed 出来的那个库"，极易看错（本轮亲历）。
- `mv` 走的备份目录**时间戳更新**（是刚生成的），`ls -t` 反而把它排在前面 —— 用"取最新目录"的
  习惯去挑，**必然挑中错的**。

### 3. 新发现（真隐患）：收敛判定看不见"轮内创建 → 销毁"

**证据链**：
- core 层往返**已由临时探针证实成立**（`addRefKeys` 出的三键齐全，`rewrite` 对 `PIC.png`
  正确改写；探针用后即删）——排除"改写函数/键口径"；
- 逐命令追踪里，11 的副本**只在第 1 轮出现**（`bulk-rename` 的 26 项里），此后无踪影；
- 而收敛判定只比较**轮末**快照：若某附件每轮"建一份、删一份"，轮末快照恒定 → **判为收敛**。

**⇒ 这是盲区，不是某个具体缺陷**：任何"轮内创建 → 轮末前销毁"的循环都会被判绿。
现有 `KNOWN_CHURN` 具名豁免正是为这类循环准备的，但它**依赖人先发现**。
**修法方向**：把 `.trash` 的条目列表并入每轮快照（轮末可查、零额外开销）——`.trash` 每轮是否
新增，就是"轮内发生删除"的直接症状。已登记进 `coverage-matrix` §5。

### 4. 本轮改动（**只改文档与注释，未动产品代码**）

- `coverage-matrix` §5：① 从"仍未覆盖"移入"**已闭环**"（附根因、修法与验证证据）；
  新增一行登记"**收敛判定看不见轮内创建→销毁**"这一盲区与修法方向。
- `obsidian-cdp-acceptance.mjs`：`KNOWN_CHURN` 上方的注释**已自相矛盾**（正文仍写"两项既有震荡…"
  而数组已空、两条都已修）——重写为"当前为空 + 两条的根因与修法 + 豁免纪律 + 盲区提示"。
- **产品代码一行未改**：① 已经修好，若照着上一节的"建议的下一步"继续改，就是**修一个不存在的问题**。

### 5. 闭环证据

- 真宿主：`naming-rich` 独立复跑 **71 → 92 → 94 → 94（第 3 轮收敛，问题 0）**。
- `docs-consistency` 绿；行尾复核 `w/lf`；工作区只含上述两个文档/注释文件。

---

## 2026-10-16（三）：闭合"收敛判定看不见轮内创建 → 销毁"的盲区（T1–T6）

**背景**：上一节发现收敛判定只比较**轮末**快照，"轮内创建 → 轮末前销毁"完全不可见（**假绿**）。
本轮按"建议的下一步"建了 T1–T6 清单并逐项执行。

### 1. 方案前提当场被推翻、再修正（本轮最值得记的一段）

初版设计直接读 **Obsidian 的** `trashOption` 判断"库内回收站可不可查"。第一次跑就报
`trashOption = system`，于是脚本按**防空转**约定**显式打印降级提示**："非 local，无库内目录可查"。

**这个提示立刻暴露了前提不成立——库里明明有 27 条 `.trash`。** 查 `unused-cleaner` 才明白：
删除走的**不是** Obsidian 的设置，而是**插件自己的** `cleanup.deleteMode`（默认 `.trash` →
`vault.trash(f, false)` 落库内 `.trash`）。**探测侧与删除侧不是一个口径**——又是本项目那类
"两层口径不一致"。修正为取插件设置，并把两个值都打进输出与报告备查。

> **防空转断言的价值在这一次就兑现了**：它没让"没采到"变成"没发生删除"。

### 2. T1–T6 执行与验证

| # | 任务 | 状态 |
|---|---|---|
| T1 | P0 把 `.trash` 纳入快照与收敛判定（含防空转） | ✅ 第 2 轮变化 26 → **27**（多出的正是回收站新增） |
| T2 | P0 变体测试：注入"轮内创建 → 销毁"必须转红 | ✅ **修复前绿（第 3 轮 0 项）→ 修复后红（第 3 轮 1 项 + "未在 6 轮内收敛" + 报出 `+.trash/__probe_passN.png`）→ 还原后绿** |
| T3 | P0 真宿主两变体 | ✅ `naming-rich` 与 `custom` 均 **71→92→94→94、第 3 轮 0 项、问题 0** |
| T4 | P1 收尾打印"当次产物"路径 | ✅ 已打印，并提示开场 `mv` 备份目录是**上一轮**的库 |
| T5 | P1 README 写 `mv` 约定与 `.trash` 判据 | ✅ |
| T6 | P3 文档闭环 + 提交 | ✅ 本节 |

### 3. 判据为什么这么定

- **与删除侧同口径**：取插件 `cleanup.deleteMode`；宿主的 `trashOption` 只作对照打印
  （实测两者不一致，照后者判定会得出**相反**结论）。
- **只认回收站新增、不认减少**：清空回收站（用户行为或命令副作用）不该被判成"未收敛"。
- **`lightFiles()` 也带上回收站**：`--trace-commands` 因此能显示"哪条命令把什么删进了回收站"。
- **防空转**：删除模式非 `.trash` 时显式打印"该项未闭合"，不静默返回空数组冒充"没发生删除"。

### 4. 剩余风险（如实登记）

- 删除模式为**系统回收站 / 永久删除**时，"轮内创建 → 销毁"**仍不可见**（那些模式下没有库内痕迹
  可查）。验收库当前是 `.trash`，故已闭合；将来若加"非默认删除模式"的变体，需另想办法
  （如在轮内多采一次中间快照，而不是依赖回收站）。
- `empty-folder-cleaner` 里 `vault.trash(f, false)` 是**硬编码** `false`（固定落库内回收站），
  不随 `deleteMode` 走，与 `unused-cleaner` 的口径不一致。**本轮未动**（不属本盲区，且改它要动
  产品代码与产品语义），登记备查。

---

## 2026-10-16（四）：空目录清理对齐 `deleteMode`（上一节登记的"硬编码"已修）

**触发**：上一节末尾登记的"`empty-folder-cleaner` 硬编码 `vault.trash(f, false)`，与 `deleteMode`
口径不一致"——**用户拍板要与「清理未用附件」保持一致**，本轮执行。

### 1. 改了什么

- `empty-folder-cleaner`：`performEmptyFolderDelete` 接受 `mode: DeleteMode`，三分支与
  `unused-cleaner` **逐字同口径**；两条调用路径（确认窗、免确认静默路径）都传 `cleanup.deleteMode`；
  弹窗说明由硬编码的"移入 Obsidian 回收站"改为**随 mode 显示**。
- 新增 `settings.ts` 的 `deleteModeLabel()` 作**唯一实现**，两处弹窗共用——**从前各写一份三元表达式，
  正是这种分叉让空目录那侧的"硬编码"活了下来**。设置页下拉的选项名**未动**（与
  `default-settings.md` 的表格逐字对账，动了会红）。
- 设置页「删除方式」的描述改为覆盖**文件与空目录**。
- `safety-suite` 新增 **F2 组**（三条不可逆分支各一支；`permanent` 那支走**确认窗路径**，顺带覆盖
  另一个调用点）。规模 **548 → 551**。

### 2. 验证

- 变体测试三态齐全：**改回硬编码 → `system-trash` 与 `permanent` 当场转红**（报出"很可能把 system
  参数传成了 false"与"永久删除却进了库内回收站"）→ 还原后 3 条全绿。
- `safety-suite` 全量 **21 通过**；`docs-consistency` 26 绿；`typecheck` 通过。
- 真宿主 **`custom` 回归**（`deleteMode` 为默认 `.trash`，行为**不应变**）：`71 → 92 → 94 → 94`
  （第 3 轮收敛、问题 0），与改动前逐项一致——确认这条改动只是"接上设置"，没有动默认路径的语义。

### 3. 过程中踩到的一个坑（值得留）

F2 用例初版把目录名写死成 `empty-dir`，结果**后两支读到了第一支留在 `.trash` 的同名残留** → 两条假红。
根因：替身的回收站**按 basename 落盘**（重名追加 `(N)`），而 **`.trash` 在用例之间不清空**。F 组一直用
`seq` 保证唯一，这一步我漏了 → 目录名改为逐次唯一，并把原因写进测试注释。
**教训**：在共享库根、且回收站带跨用例残留的套件里，**凡断言"某处不该有某文件"，被测对象的命名必须唯一**。

### 4. 剩余风险

- **仍未验真宿主上的非默认删除模式**（验收库 `deleteMode` 是默认 `.trash`）：本轮改的是"连接线"，
  真宿主只做了默认模式回归。已在 `coverage-matrix` §5 如实标注。
- `permanent` 下空目录会被**不可逆删除**——这正是"与设置保持一致"的代价，已让弹窗显示实际删除方式。

---

## 2026-10-16（五）：把上一轮登记的两条"剩余风险"验掉（真宿主非默认删除模式）

**触发**：上一轮末尾登记了两条剩余风险——① 真宿主上的**非默认删除模式从未跑过**；② `permanent` 下
空目录会被**不可逆删除**。用户要求把它们验掉。

### 1. 做法：给验收脚本加一个**正交**参数 `--delete-mode`

`--variant` 管的是"库布局 / 命名方案"，删除去向是**另一个轴**，故新增独立参数（只切这一个轴，
其余保持基线）：

```powershell
node scripts/obsidian-cdp-acceptance.mjs --delete-mode system-trash
node scripts/obsidian-cdp-acceptance.mjs --delete-mode permanent
```

- **强断言**：非默认模式下**库内回收站必须全程为空**——走系统回收站或永久删除的，库内不该留痕。
  这条直接对应"设置没接下去"那类缺陷（某命令仍硬编码 `vault.trash(f, false)`）。
- **防空转**：同一断言只有"确实删过东西"时才有意义，故额外断言夹具的真孤儿（O01/O02）**确已消失**；
  否则"回收站为空"是**空洞的绿**（比红更坏）。
- ⚠️ **取值必须校验**：非法值会一路传到插件的 `if / else if / else`，被 `else` 吃掉当成**永久删除**
  ——脚本当场拒绝并退出（不启动宿主），不因一个拼写错误把夹具删干净。

### 2. 结果

| 模式 | 结果 | 库内回收站（强断言） |
|---|---|---|
| `system-trash` | `71→93→93→94→94`，第 4 轮收敛，**问题 0** | **累计 0 项** ✓ |
| `permanent` | `71→92→92→94→94`，第 4 轮收敛，**问题 0** | **累计 0 项** ✓ |

- 逐命令追踪给出**接线正确的正面证据**：`cleanup-unused` 在默认模式下变化项是 **`+.trash/…`**，
  在 `permanent` 下是 **`-assets/…`**（从库内消失、且**无 `.trash/` 项**）——两条路径确实不同。
- 终态文件数 **94**，与默认模式一致：删除去向不影响最终库形态。

### 3. 顺带澄清一件事（避免把现象记错）

非默认模式头一次跑出"第 4 轮收敛"，看着像"多了一轮"。**做对照后确认与删除模式无关**：同一次对照里
**默认模式也是 4 轮**（`71→92→93→94→94`）。轮数取决于**外链本地化的时序**（下载快 3 轮、慢 4 轮）——
第 2、3 轮的变化集中在 `externals/**`（本地化下载产物）及随之解锁的收集/命名。

### 4. 剩余

- 风险 ① ② 均**已验**（② 即上表 `permanent` 那一跑：空目录与孤儿都被确实永久删除，库内回收站为空）。
- **仍未覆盖**：真宿主上的**设置页与通知文案**（脚本不读弹窗/提示文案，由 harness 覆盖）——
  §5 里剩下的那一格，本轮未触及。

---

## 2026-10-16（六）：把剩余验证项做掉（三格转绿 + 两个"我自己的错" + 一个真发现）

**触发**：上一轮称"§5 只剩设置页与通知文案一格"，用户要求"把剩余未做的验证项也做了"。
实际清点（§2 矩阵 + §5 表）剩余约 **10 项**。本轮做完**能一次跑覆盖的 3 项**，其余按成本与性质如实登记。

### 1. 做完的三项（都在命令流程之后，独立于收敛判定）

| 项 | 做法 | 实测 |
|---|---|---|
| **导出产物内容** | 脚本内联 zip 中央目录解析；在 `export-*` **之后趁热**采条目名 | ✅ 第 1 轮 `Unused_Attachments.zip` **8~9 个条目**（`manifest.json` + 孤儿） |
| **设置页渲染** | `app.setting.open()` + `openTabById` → 读 `.vertical-tab-content` 文本 | ✅ **4989 字符、关键项 4/4** |
| **通知级别三档** | 逐档切换 → 触发"必然产出摘要提示且不弹确认窗"的操作 | ✅ **DOM 0 / 1 / 2 条**（silent / summary / verbose） |

**顺带跑的一趟**：`--platforms-all`（`consistency.platforms` 设为全平台）。3 次中 2 次问题 0、文件数与
默认一致；**1 次**出现 `notes/03-HTML标签.md` 的 `pic.gif` **每轮持续断链**（该附件随后被当孤儿清掉）
→ 登记为"**时序敏感、待定位**"：是**真发现**，但未复现，不当作结论。

### 2. 过程中的两个"我自己的错"（都是断言接线，不是产品缺陷）

1. **命令 id 格式**：`REAL_IDS` 来自 `resolveCommandIds()`，是**带插件前缀的真实 id**
   （`attachment-suite:attachment:…`）。第一版用简写 id 比对/执行 → 钩子永不命中、`executeCommandById`
   找不到命令 → **zip 一条没采到、三档全 0**。改用**后缀匹配** + `realId()` 后解决。
2. **通知采集通道本身就坏**（**既有脚本缺陷，本轮才发现**）：脚本靠包装 `window.Notice` 采集，而
   **插件在加载时就绑定了它自己的 `Notice` 引用**，事后包装改不到它 → 采集数组**永远采不到插件弹的
   通知**。第一版据此报了"产品没提示"——**假红**。加**正对照**（主动弹一条）后当场分辨：
   同一时刻 **页面 DOM 1 条 / 包装采集 0 条**。判据已改为**页面 DOM**。
   ⇒ **更正历史推理**：此前曾用"报告 `notices` 为 0"排除"引用改写抛错"——该依据**不成立**
   （当时的结论另有直接证据、仍然成立，但推理链的这一环是坏的）。

### 3. 如实登记：本轮**没做**的（连同成本/性质）

| 项 | 为什么没做 |
|---|---|
| `check-consistency` 的**报告内容**（真宿主） | 要读报告窗口 DOM，与"报告准确性"的断言设计耦合，值得单独一轮 |
| `followNoteMove`（真宿主） | 需脚本主动移动笔记并等待跟随，属新机制 |
| schema 迁移（真宿主） | 需"写旧版 `data.json` → 重载插件"机制 |
| `reveal-ref` 定位（真宿主） | 需点击报告窗口内的按钮（UI 交互） |
| **就绪门"兜底放行"分支** | **真宿主天然不可达**（宿主通常会发 `resolved`）；要覆盖只能给产品代码加"重装入口"——维持"不可测"结论 |

### 4. 验证

- 真宿主共 5 趟（默认 ×3、`--platforms-all` ×2，其中 1 趟带 trace）：最后一趟 **问题 0**，
  三项新断言全绿且**非空洞**（zip 条目 8~9、设置页 4989 字符、三档 DOM 0/1/2）。
- 守卫 `docs-consistency` 绿；**`src` 未改**（本轮只动验收脚本与文档）；行尾 `w/lf`。

---

## 2026-10-18：把"剩余未做"的验证项做掉（四格转绿 + 两个既有脚本缺陷）

**触发**：10-16 结束时登记了 5 项"本轮未做"，用户要求"除发版外其余都做"。

### 1. 做完的四格（都在命令流程之后，独立于收敛判定）

| 格 | 怎么验的 | 实测 |
|---|---|---|
| **一致性报告内容** | `executeCommandById` 后**不点掉窗口**，读 `.iap-report-modal` | ✅ 233 字符；汇总「附件 39 · 坏链接 4 · 未用 0 · 可修复路径 0」；**应有分组 1、缺 0** |
| **报告内定位** | 在报告里点那条永久断链 → 看活动文件 | ✅ 活动文件 = `notes/13-断链-无候选.md` |
| **笔记移动跟随** | 造**独占探针**（笔记 + 相对型 `assets/`）→ 移动 → 看附件 | ✅ 已移动、**附件跟随**、旧位置无残留 |
| **schema 迁移** | 写缺字段旧 `data.json` → **重载插件** | ✅ 补全 cleanup/naming/platforms；**用户值 `silent` 被保留** |

**第一版红了一条**（"报告缺少分组"）：`ReportModal` **只给有内容的分组渲染标题**（空段直接 `continue`），
而主流程跑完时孤儿已清空、默认平台下也无不兼容路径 → 只有"需修复的引用"一段。断言改成
"**汇总里计数 > 0 的分组，标题必须出现**"后转绿——是**断言口径过严**，不是产品缺陷。

### 2. `--platforms-all` 偶发断链：按"未复现"结案

10-18 连跑 3 次（含 1 次带 `--trace-commands`）：全部 `71→92→94→94`、问题 0、**无断链**。
**累计 6 次跑仅 1 次复现**（10-16 首次）→ 判为**偶发**，按"未复现"结案，并写清"若再现怎么抓"
（`--platforms-all --trace-commands`，重点看 `localize-note` 搬家与紧邻改名之间是否漏一拍）。

### 3. 两个既有脚本缺陷（本轮才发现）

1. **报告窗被误点「去修复可确定断链」**：`CLICK_CONFIRM` 的 CTA 正则含 `确定`，而该按钮名里
   "可**确定**断链"含"确定" → **每一轮验收都在报告窗静默触发一次真实的修复**，而不是关闭窗口。
   已改为"报告窗只点关闭"。**影响**：此前"断链变少"里混入了这份额外修复，会掩盖"修复命令是否真生效"。
   ⚠️ 修时还栽一次：报告窗的 class 在 `modalEl`（`.modal`）上、**不在** `.modal-container` 上，
   只查后者 → 分支不命中，日志仍打印"去修复"。
2. **`notices` 采集恒空**（10-16 发现）：字段保留，但四处注释标注"只含脚本自弹的通知、采不到插件的"，
   避免下一个人再拿它当"产品没弹提示"的证据。

### 4. 顺带修掉的两处用户文档漂移

- 根 `README.md` 的「清理空附件目录……**移入回收站**」是 `a16fa40` **之前**的口径，且与同节
  "三种删除方式"**自相矛盾** → 改为"去向与上一项共用同一套删除方式"。
- `docs/README.md` 的 records 描述停在"10-02 → 10-13" → 同步到 10-18。

### 5. 验证与闭环

- 真宿主最后一趟：**问题 0**，七项断言全绿且**非空洞**（报告 233 字符 / 定位成功 / 附件跟随 /
  迁移补全 + 保留用户值）。
- 守卫 `docs-consistency` 26 绿；**`src` 未改**（46 个 ts）；行尾 `w/lf`。

---

## 2026-10-18（第二轮）· 六维审计：功能 / 文档 / 注释 / 界面 / 测试 / 真宿主

**触发**：用户要求"再做一次全面审计，逐项闭环"。方法照 `invariants` §8：**先跑守卫，人力只投守卫够不到处**。

**结论**：修 **1 处数据安全口径**、**2 处界面文案**、**1 处脚本静默失效**、**4 处文档/注释偏差**；
新增 **4 条断言**（单测 1 + 守卫 3）与 **1 处 E2E 加固**；规模 551 → **555**（41 文件，全绿）。
运行期行为**只有一处变化，且方向是"更保守"**（宁可漏清，不误删）。

### 1. 【数据安全】「清理未用附件」对全局排除目录只豁免本层

- **现象**：`paths.exclude` 被并进「清理」的排除名单后**按 `excludeSubfolders` 处理**（默认 `false` ＝ 只豁免本层）。
  于是 `keep/sub/orphan.png` 这种**子树里的孤儿**：一致性报告按前缀把它**过滤掉**（用户看不到），
  「清理未用附件」却按"仅本层"把它**删掉**。用户在设置里写"这块不要动"，实际只保住了一层。
- **这是 invariant §0 的同类**：同一个 `paths.exclude`，报告 / 本地化 / 全库批量 / 导出都按前缀（整棵子树），
  只有清理按本层——**两层口径不一致**。
- **方案对比**：
  - A（采用）**清理侧对 `paths.exclude` 走前缀**，`cleanup.excludedFolders` 保持 `excludeSubfolders` 语义。
    与其它所有入口同口径、与设置页"这块不动"的承诺一致、失败方向是"多留一个文件"。代价：一处行为变化。
  - B 把报告改成"仅本层"：会让报告多列一批**马上要删**的孤儿，等于把口径不一致推到用户面前，且更危险。
  - C 只改文案：报告里看不见、清理时被删——**不一致本身没解决**，不可接受。
- **修法**：`shouldExclude` 增第 4 个参数 `recursiveExcludes`（先判 `isPathExcluded`，即前缀），
  `planCleanup` 透传；调用侧**不再合并两个数组**，而是分开传（合并正是口径混同的来源）。
- **变体测试**：把调用侧改回"合并名单"→ 新 E2E 断言转红（`全局排除目录的子目录被误清`）→ 还原转绿。
- **测试**：`unused-cleaner-core` 新增 1 条（子树豁免 / 不误伤 `kept` / 两条名单互不干扰 / `planCleanup` 端到端）；
  `safety-suite` 的"含全局排除目录"用例加一个**嵌套文件**（原先只放在目录本层，所以一直没暴露）。

### 2. 【界面文案】清理确认窗写死"按回收站策略处理"

`unused-cleaner` 的确认窗同时显示「删除方式：永久删除（不可恢复）」和「删除后将按**回收站策略**处理」——
上一轮把空目录那条改成 `deleteModeLabel` 时，**这一处漏了**（同一形态的老问题：两处各写一份文案）。
改为"将按此方式处置以下文件"，与空目录那条一致。

### 3. 【脚本】`--variant` 拼错会静默按基线跑

`VARIANT === 'obsidian-root'` / `=== 'naming-rich'` 两个分支都不成立时，脚本**照常按 `custom` 跑完** →
"我以为在验命名富化、实际验的是基线"，产出一份**假绿**（比红更贵：要另花一轮证伪）。
已与 `--delete-mode` 同一条纪律：非法取值**当场退出码 2** 并列出可选值。
**顺带修掉同类的第二种写法**：`arg()` 原先只认 `--name value`，`--variant=obsidian-root` 会**静默取默认值**——
现在两种写法都支持（并用"`--variant=拼错值` 也应退出码 2"这条断言把等号写法钉住）。

### 4. 【文档 / 注释】四处偏差

| 处 | 原写法 | 事实 |
|---|---|---|
| `coverage-matrix` §4 | `followNoteMove`「❌ 未验（真宿主上未被显式触发）」 | 10-18 已用独占探针在真宿主上验过 `true`；只有 `false` 分支未验（与 §2 自相矛盾） |
| `settings-tab.ts` ×2、`default-settings.md` | 「40 多个选项平铺」 | 实际 **54** 行设置项（44 处 `new Setting` − 2 循环体 + 7 命名用词 + 5 类别开关）→ 改为**不写数字**（计数断言本就不该留在注释/文档里） |
| `tests/README` §1 目录树 | 漏 `types.test.ts` | §2.1 已登记该文件，树里没有（树与表不一致） |
| `review-log` 标题 / 速览表 | 「→ 2026-10-14」、表只到 10-14 | 正文已追加到 10-18；标题同步，表后加一句"其后各轮见小节" |

另修一处措辞：设置页「通知级别」原写"消息越长（**换行越多**）停留越久"，而 `effectiveDuration`
是按**字符数**估算行数（`ceil(len/40)`）——改为"按长度估算行数逐行加时"，不再暗示数换行。

### 5. 【测试】新增守卫与一次自我约束

- `acceptance-tooling` 新增 3 条：`--variant` 非法 / `--delete-mode` 非法 / **`--variant=` 等号写法也必须生效**。
  后者直接防"给了参数但没读到"这一类静默失效。
- 变体测试：把校验改成 `if (false)` → 断言转红（代价是该坏状态下脚本会继续往下跑、耗时 ~56s，
  故给 `spawnSync` 加了 `timeout`）→ 还原转绿。
- ⚠️ 教训（写给自己）：**新增一条用例要同步 `tests/README` 两处**（第 8 行总数 + 套件行分项），
  否则 `docs-consistency` 立刻红——本轮改了三次数字，都是加用例的必然结果。

### 6. 【真宿主】验证结果（默认变体 `custom`）

`seed` → 全量验收 → 控制台三通道：

- 全量验收：**问题 0**，`71 → 92 → 94 → 94`，**第 3 轮收敛**；七项必做断言全绿且非空洞
  （导出 8 条目含 `manifest.json`；设置页 5045 字符、关键项 4/4；通知三档 DOM 0/1/2；
  报告 233 字符、应有分组 1/缺 0；报告内定位切到 `notes/13-断链-无候选.md`；移动探针附件跟随且无残留；
  schema 迁移补全且用户值 `silent` 保留）。
- 控制台（`--console-only`，106 行）：**0 条** `error` / `exception` / `unhandled`；
  只有三条**预期负向** warning（`.txt` 非受管、HTML 不落盘、`:1` 不安全端口）。
- 顺带取证：追踪里 `cleanup-unused` 报「没有可清理项（1 个被排除目录保留）」——
  全局排除目录在真实宿主上确实生效。

**闭环**：`typecheck` 通过；全量 **41 文件 / 555 用例全绿**（含 `docs-consistency` 26）；
`dist` 比 `src` 新；行尾 `w/lf`；`src` 46 个 ts 不变。

### 7. 补记：同轮的"改一处漏一处"（第二次提交 `adbbb34`）

收尾做**残留扫描**（`grep` 本轮每个改动点的**原表述**）时抓到 **4 处**同类漏改——都是"同一句话还有第二份副本"：

| 漏改处 | 情况 |
|---|---|
| `notify-core.ts` 的 `effectiveDuration` 注释 | 仍写"（换行越多）"；第一次提交只改了**设置页文案**与 `default-settings` |
| `notify-core.test.ts` 的用例名 | 同上，名字里带着错误的解释口径 |
| `settings-tab.test.ts` 的注释 | 仍写"40 多个选项平铺"（引用了已改掉的旧文案） |
| `command-inventory` #5 的"口径与 #4 相同" | #4 改成两条名单分开后这句不再准确（#5 两条都是前缀；#4 的 cleanup 名单受开关控制） |

这正是 `invariants` §8.2 说的形态：**改一处事实要当场问"还有谁写着它"**。本轮把它当成一次实例记录下来——
"残留扫描"这一步不能省，且必须扫**原表述**（不是扫新表述）。

---

## 2026-10-18（第三轮）· 按"下一轮推荐清单"执行（8 项：6 闭环 + 2 登记未做）

**触发**：上一轮给出的推荐清单（①补齐真宿主四件套 ②打开 §4 剩余格 ③威胁模型两条 TODO
④real-host-log 断档 ⑤单套件用例数守卫 ⑥就绪门兜底可测 ⑦platforms-all 复跑 ⑧发版决策）。

| # | 项 | 结果 |
|---|---|---|
| ① | 真宿主四件套补齐 | ✅ 跑了 **6 趟**（`--startup-check` / `obsidian-root` / `custom` / `abilities-off` / `follow-off` / `--platforms-all`×2），**全部问题 0** |
| ② | §4「四个能力总开关」+「`followNoteMove`」两格 | ✅ 新增 `--variant abilities-off` 与 `--variant follow-off`，两格转 ✅ |
| ③ | 威胁模型 P2-9 / P2-10 | ⏸ **登记未做**（见下「未做与理由」） |
| ④ | `real-host-log` 断档 | ✅ 新增 §12（收拢表 + 两次假红教训），`docs/README` 同步 §1–§12 |
| ⑤ | 单套件用例数守卫 | ⏸ **评估后不做**（理由见下） |
| ⑥ | 就绪门「兜底放行」可测 | ✅ 抽 `armSettleTimer()` + 新增公开 `rearmSettleWatch(ms)` + `real-suite` 1 条用例 |
| ⑦ | `--platforms-all` 复跑 | ✅ 2 趟均 `71→92→94→94`、问题 0；累计 **8 次 1 现** |
| ⑧ | 发版决策 | ✅ 产出 1.0.1 检查单（**等用户拍板**，本轮不推标签） |

### 1. 两个新变体（② ）
- **`abilities-off`**：命名/本地化/一致性/清理/导出 + 自动化全关。断言分两处：
  ① `checkResults` 整段分叉——五件"不该发生"的事（不得出现已命名文件 / 不得生成 zip /
  真孤儿仍在 / 回收站不增 / 外链未改写 / 可修断链原样保留）；
  ② 新增 `runAbilitiesOffGateCheck`——**11 条受门禁的命令逐条**执行，必须各自提示
  「X 能力已关闭」且**不弹窗**。实测 **11/11**、`71→71→71`、第 2 轮收敛、问题 0。
  ⚠️ 实测发现一个**设计事实**：两条**没有开关**的收集命令仍会跑（设计如此），所以库里仍会"搬家"——
  已写进 README 的变体说明，避免下一个人把"搬家"当成门禁失效。
- **`follow-off`**：只关 `consistency.followNoteMove`。实测 `新目录附件=0 / 旧目录残留=1`——
  **关闭后真的不动**；`custom` 与 `--startup-check` 下同一条探针是 `1 / 0`（跟随），两条分支齐了。

### 2. 脚本自身的两个断言缺陷（这次才暴露）
补跑 `--startup-check` 与 `obsidian-root` 时各红一次，**都是断言的问题，不是产品**：
1. **探针绑定了具体文件名**：`--startup-check` 下自动化开着，探针附件会被统一命名
   （`probe.png` → `Probe_image_001.png`）→ 写死 `probe.png` 必报"附件没跟过去"。已改为**按目录计数**。
2. **探针在库根落盘模式下前提不成立**：`'/'`＝库根时附件本就不在"笔记相对目录"里，
   跟随按设计是空操作 → 硬跑必然假红。已在入口**显式跳过并打印原因**（不放大成模糊匹配）。

> **教训（已写进 real-host-log §12）**：新加的断言只在自己那个变体上跑过，换一个**布局不同**的变体就露馅。
> 今后给脚本加断言，**至少跑两个布局不同的变体**才算验过。

### 3. 就绪门兜底放行（⑥）
`armSettleWatch` 里的定时器抽成 `armSettleTimer()`（唯一实现），并新增公开
`rearmSettleWatch(ms)`：复位就绪态 + 按给定窗口重装，**只影响这一个定时器**，默认行为不变。
用例断言 `settled` 由 false → true 且 `settleSource === '兜底超时'`（来源可区分"宿主发事件"与"超时兜底"）。
`coverage-matrix` §5 那一格随之移入「已闭环」。

### 4. 未做与理由（诚实登记）
- **③ 威胁模型 P2-9 / P2-10**：合并成"安全摘要"是最小可行的实现（类型不一致只**计数 + 可见**、
  不跳过；把内网拦截 / 超时 / 超限 / 非受管并入本地化摘要）。**不在本轮做**的理由：它会改下载链路的
  语义与用户可见文案，而本轮已同时改了验收脚本与装载时序；混在一起会让回归归因变难。
  下一轮单独做，配套 1 条 E2E + `notify-contract` 断言。
- **⑤ 单套件用例数守卫**：评估后**不加**。原因：15 个测试文件用 `for (const … of […])` **循环生成用例**，
  静态 `it(` 计数必然对不上，需要一张"哪些文件有循环、各乘几"的豁免名单——那是**新的漂移源**
  （§8.2 的判据是"口径能否收敛到有限可枚举集合"，这里收敛不了）。替代：`tests/README` 第 8 行
  已写明"以 `npm test` 输出为准"，本轮三次改数字也都是靠它核对。
- **`net-strict` 变体**：方案已写进 `coverage-matrix` §4（`blockPrivateHosts=true` + `hostAllowlistOnly=true`
  + 白名单只列 `127.0.0.1`），未实施——需先确认"白名单显式列出的域覆盖内网拦截"在本机回环上成立，
  否则整个夹具的外链会被拦、断言全红且无法归因。

### 5. ⑧ 发版检查单（1.0.1，等拍板）
- 动机：1.0.0 的 Release 里没有 10-18 修掉的「全局排除目录子树被误清」。
- 前置：`npm run typecheck && npm test && npm run build` 全绿（本轮已满足）；
  `npm run version -- 1.0.1` 同步四处；`git tag 1.0.1 && git push origin 1.0.1`（**推标签需网络**，
  沙箱内到 GitHub 不通）。
- 判断依据：若短期内没有别的使用者，可先不发；**一旦决定上架社区市场，这一步是硬前置**。
- 未做原因：发版是不可逆的对外动作，且需要用户决定（是否上架、版本号取多少）。

### 6. 闭环证据
`typecheck` 通过；全量 **41 文件 / 556 用例**（新增 1 条兜底放行用例）；
`docs-consistency` 26 绿；`dist` 比 `src` 新；真宿主 6 趟问题 0。

---

## 2026-10-18（第四轮）· 安全摘要落地（威胁模型 **P2-9 + P2-10** 合并）

**触发**：上一轮登记为"下轮单独做"的那一条，用户要求直接开工。

### 1. 先定口径：对账，不改落盘决策

P2-9 原文是"内容类型二次校验，不一致时按更保守处理（必要时跳过）"。实施时把"更保守"解释清楚：

- **落盘决策仍以内容魔数为准**（`classify`）。信声明会制造两类新问题：服务器回错类型时
  文件被**存成错误类型**，或合法文件被**误杀**；而"伪装成图片的 HTML 存成 .html"这条通道
  早已被 `webpage` 硬跳过堵死（T6）。所以"更保守"在这里不等于"信声明"。
- 因此本项落地的是**对账 + 可见**（也正是 P2-10 要的审计能力）：不一致 → `logger.warn` + 摘要计数。

### 2. 代码

- **接口**：`MediaDownloader.download()` 由 `Promise<Uint8Array | null>` 改为 `Promise<DownloadOutcome>`：
  成功 `{ ok:true, bytes, declaredType }`；失败 `{ ok:false, reason }`（7 类：
  `oversize` / `too-small` / `timeout` / `http` / `empty` / `decode` / `network`）。
  实现只有 `ObsidianDownloader` 一处，调用点只有 `runLocalizeNote` 一处（**无测试替身**，故改动面可控）。
- **`fetchHttp`** 返回 `{ status, type, bytes } | { timeout }`，让"声明类型"和"失败原因"都能上浮；
  重试语义**保持原样**（超时 / 非 2xx / 空响应不重试，只有抛错才走 `tryCount`）。
- **纯函数**（`localize-media-core.ts`）：`declaredCategoryOf`（MIME→类别，`octet-stream` 一律不判）、
  `isTypeMismatch`、`dataUriMime`（`data:` 自带 MIME 也参与对账）。
- **摘要分项**（都为 0 时一个字都不多）：`类型与声明不符 N`、`超限 N`、`超时 N`、`HTTP 失败 N`；
  自动化的结果通知带上「类型与声明不符」，plog 额外打出 `skipReasons` 全量分项。

### 3. 测试

- 单测 5 条：MIME 折算 / 带参数与大小写归一 / 不能判的一律不判（含 `octet-stream`）/
  只有"能确定且不同"才算 / `data:` MIME。
- `real-suite` 1 条：测试服务器对 `declared-html.png` 返回 **PNG 字节但声明 `text/html`** →
  断言 ① 仍按内容落盘并改写引用 ② 摘要出现「类型与声明不符 1」。
- **变体测试**：把计数条件改成 `if (false && isTypeMismatch(…))` → 该条当场转红（`类型与声明不符 1` 消失）→ 还原转绿。
- 规模 **556 → 562**（单测 50→55、主套件 57→58）。

### 4. 文档

- `security-threat-model`：P2-9 / P2-10 打勾并写清"对账而非改变决策"的理由与守卫位置；
  §4 防护盘点加一行「声明类型 vs 内容对账」。
- **仍未做（诚实登记）**：把上述分项汇总进**一致性报告**。目前它们只出现在命令/自动化的提示与
  控制台日志里；报告要加一节"下载安全摘要"属体验增强，不影响判定正确性。

### 5. 闭环证据

`typecheck` 通过；全量 **41 文件 / 562 用例全绿**；`docs-consistency` 26；`dist` 比 `src` 新；
真宿主 `custom` 变体复跑 **71→92→94→94、第 3 轮、问题 0**（下载器接口改动无回归）。

---

## 2026-10-18（第五轮）· 下载安全摘要进一致性报告（P2-10 收尾）

**触发**：上一轮记的"仍未做：把分项汇总进一致性报告"，用户要求按推荐执行。

### 1. 数据源的选择（这轮最关键的决定）

两个方案：
- **A（采用）读下载器自己的计数器**：`ObsidianDownloader` 在 `download()` 的**唯一出口**记账
  （尝试/成功/失败/7 类原因/类型不符）。本地化、全库本地化、自动化三条路径最终都经过这里，
  **天然全覆盖**，不需要各命令"记得上报"。
- B 让各命令把摘要交给插件聚合：等于再加一份"谁用了下载器"的清单——本仓库历史上
  "手写清单最容易漏"栽过多次（设置迁移白名单、`ALLOWED_CROSS_FEATURE`）。

选 A。代价是计数器只存内存（**重载插件归零**），所以标题里写明口径「本次会话累计」，
并在末行写「重载后归零」——不让读者把"会话累计"误读成"历史账本"。

### 2. 代码

- `DownloaderStats` + `stats()`（深拷贝，调用方改不到内部计数）+ `tally`（内存）；
  原 `download()` 主体改名为 `attempt()`，记账在 `download()` 里做一次，**不散落在各个 return 前**。
- `CommandContext` 增 `getDownloadStats`（`main.ts` 传 `() => this.downloader.stats()`）。
- 报告新增一节，**没有下载时整节不出现**（条件展开，不是"空标题占位"）：
  首行 `下载尝试 N：成功 X · 失败 Y（超限 a · 超时 b · HTTP 失败 c …）`（只列非零项），
  次行（有才出现）`类型与声明不符 N`，末行写口径。
- 失败原因的中文标签抽成 `DOWNLOAD_FAILURE_LABELS`（命令摘要与报告共用，避免两处各写一份映射）。

### 3. 守卫与变体测试

- `real-suite` 1 条，两段断言：① **空态**——本次会话没下载过时，报告里**不存在**该分区（防空转）；
  ② 下载一次后 `count === 1` 且首行含「下载尝试 1：成功 1」。
- **变体测试**：把 `this.tally.attempted++` 注释掉 → 该条转红（"下载过之后仍没有该分区"）→ 还原转绿。

### 4. 文档

- 威胁模型 P2-10 的"仍未做"改写为**已补完**，并写清数据源与守卫位置。
- `command-inventory` #1 增加"报告另附下载摘要"；根 `README` 的一致性小节同步一句。
- 规模 **562 → 563**（`real-suite` 58→59）。

### 5. 闭环证据

`typecheck` 通过；全量 **41 文件 / 563 用例全绿**；`docs-consistency` 26；`dist` 比 `src` 新；
真宿主 `custom`：**问题 0、71→92→94→94、第 3 轮**；报告文本长度 **233 → 333 字符**
（多出来的正是新增的下载摘要节——真宿主上确实渲染了）。

---

## 2026-10-18（第六轮）· `net-strict` 变体：覆盖矩阵最后一格

**触发**：这是推荐清单里唯一还开着的技术债（"仅白名单 / 体积 / 限速非默认"），用户要求直接做掉。

### 1. 先核实前提（不做假设）

`evaluateHostPolicy` 的判定顺序是 **deny → allow（命中即放行）→ private → allowlistOnly**。
所以"白名单里显式列出的域覆盖内网拦截"**成立**——这是整个变体可行的前提：
验收库的外链全指向 `127.0.0.1`，若顺序反了，`blockPrivateHosts=true` 会把它们全拦下，主流程直接崩。

### 2. 变体与断言

`--variant net-strict`：`blockPrivateHosts=true` + `hostAllowlistOnly=true` + `allowHosts=['127.0.0.1']`
+ `maxDownloadMb=50`（非默认 100）+ `perHostIntervalMs=20`（非默认 0）；其余全部保持基线。

探针笔记一条 `127.0.0.1` 外链 + 一条 `blocked.invalid` 外链，跑一次「本地化当前笔记附件」，断言：

| 断言 | 为什么必须两条都要 |
|---|---|
| 白名单域**仍被下载**并改写为本地引用 | 只验"被拦"会漏掉"白名单被误伤 / allow 未覆盖 private"——那会让正常库一夜之间全下不动 |
| 非白名单域**原文保留**且摘要含「名单 1」 | 只验"能下"会漏掉"默认拒绝没生效"——那等于 `hostAllowlistOnly` 是死开关 |
| 落盘文件确实存在 | 防空转：文本改写了但文件没落，等于留下悬空引用 |
| 探针笔记必须建成 | 防空转：建不成时**报错而不是判绿** |

`blocked.invalid` 选 `.invalid` 的理由：判定失灵时也只是一次 DNS 失败，**不会真的打到外网**。

### 3. 变体测试（三态齐全）

绿（问题 0）→ 把 `hostAllowlistOnly` 改成 `false` → **转红**（`.invalid` 被尝试下载，摘要变「跳过 1」、
不再有「名单 1」）→ 还原 → **转绿**（问题 0）。

### 4. 顺带修掉一处夹具描述漂移

`acceptance-fixture` 的 E08（`externals/仅白名单.md`）原先写"仅白名单模式下非白名单域被拦截"，
但**基线 `hostAllowlistOnly=false`、`allowHosts=[]`**，这条外链在基线下会被正常下载——
描述与事实不符。已改为如实说明：基线会正常下载，拦截行为由单测 + `net-strict` 探针覆盖。

### 5. 明确不覆盖的轴（诚实登记）

`minSizeKb` 仍保持默认 0：夹具文件只有十几字节，任何正阈值都会把它们全部跳过——
那样测到的是"过滤生效"，代价是主流程失去全部下载样本。该轴继续由 `localize-media-core` 单测覆盖。
`maxConcurrent` 保持基线的 2（本变体不切这个轴）。

### 6. 闭环证据

真宿主 `net-strict`：**问题 0**、`71→92→94→94`、第 3 轮；
探针三项全绿（白名单域已落盘 / 非白名单域保留原文 / 摘要含「名单 1」）。
全量 **41 文件 / 563 用例全绿**（本轮未新增用例：改的是验收脚本与夹具描述）。

---

## 2026-10-18（第七轮）· 六维审计：1 处文档漂移 + 2 处"同一件事两份实现"

**方法**：照 §8 —— 先跑守卫（typecheck / `docs-consistency` / 全量），人力只投守卫够不到处：
本轮把重点放在**最近三轮新写的代码与文档**上（守卫化的老内容连续多轮零发现，不再整库通读）。

**结论**：修 3 处，其中 1 处是**同一批中文的两份实现**——与历史上 `deleteModeLabel` 分叉同一形态。

### 1. 【文档】覆盖矩阵 §1 对真实宿主的描述已经反了

`coverage-matrix` §1 写着真实宿主"断言面比 harness 窄：断言库没被改坏，**不断言功能按预期生效
（不读弹窗与通知文案）**"。但同一篇 §2 里明明白白列着：报告内容（读 `.iap-report-modal` 文本）、
通知三档（读 `.notice-container` DOM）、能力门禁（读提示文案）。这句话停在**加这些断言之前**。

- 方案 A（采用）**改描述并补上现在真验的东西**；
- 方案 B 删掉那一列 —— 丢信息，读者更不知道两层差在哪；
- 方案 C 给它加守卫 —— "脚本验了什么"是散文，口径收不住（§8.2 的判据过不了）。

改法：`验的是` 一列补上"报告内容与定位、设置页渲染、通知三档、schema 迁移、能力门禁、网络策略探针"；
`盲区性质` 改为"仍比 harness 窄（纯逻辑与输入形态矩阵只在单测/harness），但**已经会读界面**"。

### 2. 【实现口径】失败原因的中文在两处各写一份

`runLocalizeNote` 的摘要里手写了三条三元表达式（`，超限 …` / `，超时 …` / `，HTTP 失败 …`），
而 `DOWNLOAD_FAILURE_LABELS` 里躺着同一批中文——**同一件事两份实现**，
正是 10-16 那轮 `deleteModeLabel` 被分叉、硬编码活下来的成因。

- 方案 A（采用）抽 `reasonNotes(skipReasons)` 作**唯一入口**：标签只在映射里出现一次，
  增减原因也不会漏改摘要；顺带把它放进 `localize-media-core`（纯逻辑），单测直接覆盖。
- 方案 B 只删三元表达式、改成读映射三次 —— 仍然是三段手写拼接，下次加原因照样漏。
- 方案 C 给摘要文案加守卫 —— 文案本就会变，守卫会变成噪声。

### 3. 【文案】报告里的「成功」会被读成「落盘成功」

下载器的 `ok` 语义是"取到了响应内容"，而网页文档与非受管类型**随后仍会被跳过**。
报告里只写「成功 N」会让读者拿它跟"附件数"对不上。

- 方案 A（采用）在**口径行**里写清「成功＝取到了响应内容，不等于落盘」——不动数据结构，不改计数语义；
- 方案 B 把 `ok` 拆成"取到/落盘"两个计数器 —— 需要下载器知道类别白名单（那是 `runLocalizeNote` 的职责），
  会把两层职责搅在一起；
- 方案 C 改标题为「下载尝试」，把"成功"删掉 —— 丢掉了"有多少真的拿到了"这个有用信息。

### 4. 闭环证据

`typecheck` 通过；全量 **41 文件 / 564 用例全绿**（新增 1 条 `reasonNotes` 用例）；
`docs-consistency` 26；`dist` 比 `src` 新；真宿主 `custom`：**问题 0、71→92→94→94、第 3 轮**，
报告文本 333 → **368 字符**（口径行加长后在真机确实渲染）。

---

## 2026-10-19（第八轮）· R1：BOM 证伪 → frontmatter 块切分收成唯一入口

### 1. 先证伪：R1 的假设不成立

假设是"BOM 开头的笔记 → `^---` 失配 → frontmatter 里的引用不进'在用'集合 → 附件被判孤儿"。
在验收库建两份笔记（一份 BOM + CRLF，一份对照），真宿主三种读法实测：

| 读法 | 首字符 | 长度 | `^---` 是否匹配 |
|---|---|---|---|
| `vault.read` | 45（`-`） | 89 | ✅ |
| `vault.cachedRead` | 45（`-`） | 89 | ✅ |
| `vault.adapter.read` | 65279（`\uFEFF`） | 90 | ❌ |

插件读**笔记文本**的 5 处（`bulk-localize` / `localize-media` / `note-relocator` /
`obsidian-domain` 两处）全部走前两者，另两处 `readBinary` 读的是二进制。
⇒ **不存在数据损失**，R1 按"未成立"结案。**没有先跑这个探针就改代码，会修一个不存在的 bug。**

### 2. 但探针暴露了两个真实问题

- **解析层依赖宿主行为**：一旦有人为了拿原始字节改用 `adapter.read`，同一个 bug 立刻复发；
- **同一段 frontmatter 匹配正则被抄了 4 份**：`link-resolver` 两处、`attachment-index` 的断链扫描、
  `localize-media-core` 的外链扫描（其中一份还多写了 `\r?`，等于第四种口径）。

### 3. 方案对比

| 方案 | 取舍 |
|---|---|
| A 两处各加 BOM 容错 | 改动最小，但 4 份副本仍在——下次改口径还会漏 |
| **B 抽 `frontmatterBlock()` 唯一入口 + BOM 容错** | **采用**：一次改动同时消灭副本与对宿主行为的依赖；4 个调用点全部收敛 |
| C 在读出口统一剥 BOM | 冗余（宿主已剥）；且 core 单测直接传文本时仍会踩，兜不住 |

### 4. 落地

- `core/link-resolver.frontmatterBlock()`：`^\uFEFF?---\s*\n…`，注释写清三条口径（BOM / CRLF / 尾随空白）；
- 4 处调用点改用它；顺带删掉 `localize-media-core` 里一句位置错误的注释（原文说"含 `---` 行本身"，实际不含）；
- 单测 **+2**：BOM 文本的 token 提取与改写（并断言 **BOM 字节不被吞**）、BOM 文本的外链扫描；
- **刻意不加 E2E**：宿主已经剥 BOM，真宿主上这条用例**恒真**——它只会制造"看着覆盖了"的假证据。
  判别力在 core 单测（直接喂原始 `adapter.read` 文本）。

### 5. 变体测试

去掉 `\uFEFF?` → 两条新用例**同时转红**（token 列表为空、外链列表为空）→ 还原后转绿。

### 6. 顺带定位"全量随机少收集文件"的根因

三次全量分别少 1 / 1 / 2 个文件，`success:true` 但 exit 1。日志里是
`EPERM: operation not permitted, open '…\Temp\…\ssr\<hash>'`——Vitest 把 SSR 缓存写进系统临时目录时
被环境的文件代理拒绝。把 `TEMP` / `TMP` / `TMPDIR` 指到项目内后：**41 文件 / 566 用例 / exit 0**。
⇒ 这是**环境问题，不是产品缺陷**；以后遇到"少收集"先看有没有这个 EPERM，不要据此改代码。

### 7. 闭环证据

`typecheck` 通过；全量 **41 文件 / 566 用例全绿**（新增 2 条）；`docs-consistency` 26；
`dist` 比 `src` 新；真宿主 `custom`：**问题 0、71→92→94→94、第 3 轮**；
行尾 `w/lf`；`src` 仍 46 个 ts。

---

## 2026-10-19（第九轮）· R2：ZIP 条目数在 uint16 处静默截断

### 1. 问题（代码事实，非推测）

- `core/zip.ts` 把 `files.length` 直接写进 EOCD 的**条目数字段**，而 ZIP 规范里它是 **uint16**；
  实现没有 ZIP64 扩展 → **65536 条会被写成 0**；
- `exporter.ts` 的安全上限只卡 **512MB 字节**，**不卡条目数**；
- 触发路径：在 6.5 万+ 孤儿的库上跑「导出未用附件」→ 得到一个"能打开但条目为空 / 被截断"的坏包，
  **全程没有任何提示**。旧实现连抛错都没有，只是安静地写出损坏归档。

### 2. 方案对比

| 方案 | 取舍 |
|---|---|
| **A 立条目数上限 + 快速失败** | **采用**：这是格式硬限制，6.5 万条附件的库极罕见，不值得为它上 ZIP64 |
| B 实现 ZIP64 | 正确但工程量大（要自写 EOCD64 / 定位器），收益场景几乎不存在，风险高于收益 |
| C 分卷导出 | 改变产品语义，用户还得自己合并——把一个格式细节变成用户负担 |

**只靠 `createZip` 抛错不够**：那时调用方已经把几万个附件逐个读进内存；而且两条导出函数只 catch 了
**写盘**。所以同时在导出侧**提前**判断——注意归档里固定附带 `manifest.json`，
判据是 `paths.length + 1 > MAX_ZIP_ENTRIES`。

### 3. 落地

- `core/zip.ts` 新增 `MAX_ZIP_ENTRIES = 0xffff`，`createZip` 超限抛 `RangeError`（**在构造任何条目之前**）；
- `exporter.checkExportSize` → `checkExportLimits`（现在同时管条目数与体积），两条导出命令共用；
- 文案给出可行动建议：「加上清单共 N 项，超过单次导出的条目上限 65535（ZIP 格式限制），已中止。请分批导出。」

### 4. 守卫

- 单测 **+1**：65536 条 → 抛错；**变体测试**：把条件改成 `false &&` → 用例转红
  （那一刻它真的开始构造那个约 5MB 的坏包，耗时 328ms）→ 还原转绿；
- 导出侧的条目分支**不做 E2E**：要造 6.5 万个夹具文件，成本与收益不成比例；
  且该分支的失败方向是**可见的 error 提示**（`traceCommand` 兜底展示），不是静默坏包。
  核心保证（不产出损坏归档）已由 `createZip` 的单测钉住。

### 5. 闭环证据

`typecheck` 通过；全量 **41 文件 / 567 用例全绿**（新增 1 条）；
`docs-consistency` 26；`dist` 比 `src` 新；真宿主 `custom`：**问题 0、71→92→94→94、第 3 轮**；
行尾 `w/lf`；`src` 仍 46 个 ts。

---

## 2026-10-19（第十轮）· R3：版本号的四处副本没有守卫

### 1. 问题

`version-bump.mjs` 一次写四处（`package.json` / `package-lock.json` 的顶层与根包 / `manifest.json` /
`versions.json` 的映射），但**没有任何断言保证它们同步**：`manifest.test.ts` 只校验 `x.y.z` 格式。
手工改一处（或只改 manifest）不会被发现，要等到发版时 `detect-version` 才报——属于"越晚发现越贵"的漂移。
`versions.json` 少了当前版本更隐蔽：Obsidian 查不到该版本该配哪个 `minAppVersion`。

### 2. 方案对比

| 方案 | 取舍 |
|---|---|
| **A 三条单测比对四个文件** | **采用**：最便宜、失败信息直接指向"哪个文件与 manifest 不一致" |
| B 构建时校验 | 太晚（本地改完就 build 才报），且本仓库推 main 不跑 CI；仍不覆盖"根本没构建"的情况 |
| C 把版本做成单一来源（由脚本生成 manifest / versions） | 改动大，且 Obsidian 要求仓库里存在 `manifest.json` 实体文件，收益不抵风险 |

### 3. 落地（只改测试）

`manifest.test.ts` **+3**：
1. `package.json` / `package-lock.json` 顶层 / `package-lock.json` 根包 / `manifest.json` 四者相等——
   先逐项断言"是 `x.y.z` 字符串"，否则相等断言会退化成 `undefined === undefined` 的空转；
2. `versions.json` 为**当前版本**登记了 `minAppVersion` 且与 manifest 一致；
3. `versions.json` 的每个键都是合法版本号（手写时容易打错）。

### 4. 变体测试（两处独立触发）

- 把 `package.json` 改成 `1.0.1` → 第 1 条转红（`expected '1.0.1' to be '1.0.0'`）→ 还原转绿；
- 从 `versions.json` 删掉 `1.0.0` → 第 2 条转红（"缺少当前版本 1.0.0"）→ 还原转绿。

### 5. 闭环证据

`typecheck` 通过；全量 **41 文件 / 570 用例全绿**；
`docs-consistency` 26；行尾 `w/lf`；**`src` 未改**（仍 46 个 ts）→ 产物无变化，
`dist` 无需重建、真宿主结论沿用上一轮（纯测试改动）。

---

## 2026-10-19（第十一轮）· R5：文件系统失败时的可见性与"半完成"

### 1. 先梳理现状（避免为不存在的问题改代码）

逐条读失败路径，结论先写清：

| 路径 | 现状 |
|---|---|
| 全库命名 / 全库收集 | ✅ 逐篇 `try/catch`、`moveMany` 的 `errors` 逐条带出、`reportFailures` 兜底 |
| 本地化 | ✅ 写盘失败计 `errors`；笔记改写失败 → 明确的 `toast.error`（"引用可能仍指向外链"） |
| 导出 | ✅ 写盘失败 catch 后给可行动提示 |
| **笔记移动跟随** | ❌ `moveMany` 的 `errors` **被整个丢掉**（只读 `results`）；引用改写失败直接冒泡成后台失败 |

真实缺陷只有第 4 行：附件没跟过去时，日志与提示都只说"迁移 N 个"，用户会以为搬全了。
（失败方向是"附件留在原目录、引用也没改"，**不会悬空**，所以不是数据损失，是"沉默的部分成功"。）

### 2. 方案对比

| 方案 | 取舍 |
|---|---|
| **A 修跟随的两处 + 给已正确路径补用例锁住** | **采用**：最小改动，且把"现状是对的"也变成可回归的事实 |
| B 给所有写操作加事务 / 回滚 | Obsidian 没有事务原语；失败方向多为"多留一个文件"，回滚反而可能删掉别人也引用的副本 |
| C 只记日志不加提示 | 用户零感知，违反 §2「失败必须可见」 |

### 3. 落地

- 跟随：`out.errors` 逐条 `logger.warn`，并 `toast.error("笔记已移动，但有 N 个附件未能跟随（仍在原目录）…")`；
- 跟随：引用改写改为就地 `try/catch` → `toast.error("附件已迁移，但「X」的引用改写未完成…请运行「修复断链」")`，
  不再冒泡成一句笼统的后台失败；
- 其它路径**不改**，只补用例。

### 4. 守卫与一个"测试前提不成立"的教训

`real-suite` 第 8 组 **+2**：① 桩掉 `mover.move` → 断言"未能跟随"提示且附件仍在原目录；
② 让 `vault.modify` 对目标笔记抛错 → 断言"引用改写未完成"的可行动提示。

⚠️ 第 ② 条第一版用的是普通 md 链接，**测试前提不成立**：Obsidian 的 `fileManager.renameFile`
会自动改写 md/wiki 链接，等到 `rewriteRefsInNote` 时正文已经是对的 → 永远不会走到失败分支。
改用 **HTML `<img src>`**（自动改写不覆盖的形态）才真正触发。**这正是"先跑一遍再相信断言"的价值。**

**变体测试**：分别关掉两处提示 → 对应用例转红 → 还原转绿。

### 5. 闭环证据

`typecheck` 通过；全量 **41 文件 / 572 用例全绿**；`docs-consistency` 26；
`dist` 比 `src` 新；真宿主 `custom`：**问题 0、71→92→94→94、第 3 轮**；行尾 `w/lf`。

---

## 2026-10-19（第十二轮）· R4 / R6 / R8 / R9 收束

### 1. R4 并发/重入：不改代码，补一条"终态"用例

- **现状**：批量命令刻意不进 `TaskQueue`（确认弹窗是同步 Promise，入队会挂起队列），
  靠 `checkAlreadyRenamed` / `exists` 幂等兜底——注释给了理由，但没有任何用例证明它成立。
- **用例**（`safety-suite` 第 G 组）：同时跑两次 `runBulkRename(confirm=false)`，断言
  ① 附件**内容一份不丢**（按 MD5 比对，笔记正文因改写合法变化故排除）；
  ② 不产生新的 `(N)` 兜底名（说明两次计划没有互相踩）；
  ③ 随后串行两轮内**收敛**（最后一轮 `renamed === 0`）。
- **观察**：抢输的一方会报"源文件不存在"（预期，计入 `errors`），**没有内容损失**。
- **变体测试**：把 `checkAlreadyRenamed` 的 `continue` 停掉 → 每轮仍有 4 项改名 → 收敛断言转红。
- **结论**：不需要互斥；"幂等兜底"成立——但从今天起它是**有守卫的性质**，不再是口头承诺。

### 2. R6 规模：第一次测量测到的是"替身自己"

- 1000 篇 × 全库命名端到端 = **276 秒**（约 277ms/篇）。追查后确认：
  替身的 `fileManager.renameFile` **每次都会全库重写链接**（O(N)，见 `infrastructure.ts`），
  1000 次改名 = 约 100 万次读写——**测到的是测量工具，不是产品**。
- 改为只测**纯计算 + 索引构建**（1000 篇 / 1000 附件）：

| 阶段 | 实测 | 备注 |
|---|---|---|
| 索引构建 | 961ms | 含读 2000 个文件；真实宿主用内存元数据，此为**上界** |
| 全库命名计划 | 73ms | 1000 项，纯 CPU |
| zip 5000 × 4KB | 85ms / 20.0MB | store 模式，内存内拼装 |
| 单篇 200 条引用改写 | 1ms | 纯 CPU |
| RSS | 68 → 89 → 134MB | 索引后 +21MB；再建 20MB 归档 +45MB（≈2.3×） |

- **结论**：CPU 侧没有规模问题；唯一值得盯的是**导出内存放大**——20MB 归档让 RSS +45MB，
  按 512MB 上限外推可能到 ~1.2GB。**建议**（决策项，本轮未改）：把上限降到 256MB，
  或按实测给出"本次约需 X MB 内存"的提示。
- ⚠️ **方法结论**：端到端改名耗时**不能**用本 harness 当性能基线，以后别再用它测吞吐。

### 3. R8 不上架：把决定写进规范

- `invariants` §6 新增产品决策：**暂不上架社区市场**；因此 `description` 是中文、没有 `CHANGELOG`
  是**有意**而非遗漏。将来上架需同时改 `manifest.test.ts` 的"必须含中文"断言（让改语言成为显式决定）。
- 代码零改动。

### 4. R9 可访问性：可点击的 `div` 键盘够不着

- **发现**：确认弹窗的行、报告里的条目都是 `div` + 仅 `click`——没有 `role`、没有 `tabindex`，
  Tab 跳不过去、Enter 没反应。鼠标用户完全无感，键盘/读屏用户完全用不了。
- **修法**：抽 `makeClickable()`（`role=button` + `tabindex=0` + Enter/空格），确认窗与报告**共用**；
  `styles.css` 加 `:focus-visible` 焦点环（能聚焦但看不出焦点等于没有）。
- **守卫 +3**：报告可点击项（属性 + Enter/空格均触发）、非可点击项不得被误标成按钮、
  确认窗可点击行同样可达。**变体测试**：去掉 `role/tabindex` → 前两条转红 → 还原转绿。

### 5. 闭环证据

`typecheck` 通过；全量 **41 文件 / 576 用例全绿**；`docs-consistency` 26；
`dist` 比 `src` 新；真宿主 `custom`：**问题 0、71→92→94→94、第 3 轮**；行尾 `w/lf`。

---

## 2026-10-19（第十三轮）· R6 收尾：导出前按实测给出内存估算

### 1. 决策与口径

R6 实测到导出内存放大 ≈2.3×（20MB 归档 → RSS +45MB）。用户选择**不降上限**，改为
"**在开始前告诉用户这次大概要多少内存**"。于是口径定为：

- 估算峰值 = 合计体积 × **2.3**（常量 `EXPORT_PEAK_FACTOR`，注释写明实测来源）；
- **峰值 ≥128MB 才打扰**（再小的导出多一次点击不值），低于阈值保持一键导出；
- 估算写在**确认窗的说明里**（"合计约 X MB……按实测峰值估算，约需 Y MB 内存"），
  用户点「继续导出」才开始读文件——**确认前不读任何附件内容**；
- 超过 512MB 硬上限时，中止提示里也带上峰值估算（"按实测峰值约需…MB"）。

### 2. 方案对比

| 方案 | 取舍 |
|---|---|
| **A 新增加确认（仅大体量）+ 估算写进说明** | **采用**：不改变小导出的手感，大导出前有知情权 |
| B 降上限到 256MB | 会直接砍掉"能导出 300MB 备份"的能力，用户明确不选 |
| C 只在超限时提示 | 超限已中止，提示"需要多少"没有意义——用户要的是**开始前**知道 |

### 3. 落地

- `modals.ts` 新增 `ConfirmModal`（标题 / 说明 / 继续 / 取消），复用 `ConfirmChangesModal`
  的样式与 `runConfirmed` 的异常兜底，**不另造一套 UI**；
- `exporter.ts`：`estimateExport()` 产出 `{entryCount,totalBytes,peakBytes}`；
  `checkExportLimits()` 收这个结构（条目数 / 体积）；`confirmIfHeavy()` 决定是否先确认；
  两条导出命令都把"执行体"包成 `execute()`，确认后由 `runConfirmed` 调用——与仓库其它确认路径同形态
  （命令立即返回，不把用户思考时间算进 `traceCommand` 的耗时）。

### 4. 守卫

`real-suite` 第 6 组 **+1**：伪造 100MB 的 `stat.size` → 断言 ① 弹出「确认导出」且说明含
`约需 N.N MB 内存`；② 确认前**没有** zip；③ 点「取消」后仍没有；④ 再次执行并确认后**确实产出**
（防空转：不能只是"永远不导出"）。
**变体测试**：把 `confirmIfHeavy` 改成直接 `return false` → 用例转红（"弹出的不是导出确认窗"）→ 还原转绿。

### 5. 闭环证据

`typecheck` 通过；全量 **41 文件 / 577 用例全绿**；`docs-consistency` 26；
`dist` 比 `src` 新；真宿主 `custom`：**问题 0、71→92→94→94、第 3 轮**；行尾 `w/lf`。

### 6. R7 前置发现（尚未执行）

读 `release.yml` 的 `detect-version` 时发现：**`dry_run` 在"当前版本已发布"时什么都不会跑**。
该步骤先做幂等判定（`GET /releases/tags/<version>` → 200 即 `exists=true` 并 `exit 0`），
而 `verify` 与 `build-release` 都带 `if: needs.detect-version.outputs.exists == 'false'`。
当前 `manifest` 是 `1.0.0`（已发布）→ 手动 dispatch + `dry_run` 会把整条链路**跳过**，
看起来"跑成功了"，实际什么也没验。

⇒ **R7 必须先有一个未发布的版本号**（推荐 `npm run version -- 1.0.1` 后提交推送，再 dispatch `dry_run`）。
若希望 `dry_run` 在任意版本上都能验链，需改 `detect-version`：手动 + `dry_run` 时绕过幂等短路
（`build-release` 的发布两步已被 `inputs.dry_run != true` 跳过，安全）。**此项待决策，本轮未改。**

**2026-10-19 更新（用户操作后）**：远端 1.0.0 的 Release 已删除 → 该接口现在返回 404，
`exists=false`，**可以直接用 1.0.0 跑 `dry_run`，不必改版本号**。其它前置复核：
本机 `git tag` 为空（单调性检查不会被更旧的版本卡住）、`versions.json` 含 `1.0.0` 映射（必需）。
⚠️ 但**正式发版仍建议用 1.0.1**：1.0.0 已装用户不会因为"同版本重发"而收到更新
（本仓库此后修的全局排除子树等改动就送不到他们手上）；`dry_run` 不受此影响。

### 7. R7 执行结果（dry_run 实测通过）

运行：[`actions/runs/39204140124`](https://github.com/CHNLM/obsidian-attachment-suite/actions/runs/39204140124)
（`workflow_dispatch`，main，`head_sha=1234242`，attempt 1，耗时约 2 分钟）。

| 检查点 | 实测 |
|---|---|
| `detect-version` | ✅ 通过（1.0.0 的 Release 已删 → 404 `exists=false`，前置校验全过） |
| `verify`（ubuntu-latest） | ✅ Test / Build 全绿 |
| `verify`（windows-latest） | ✅ Test / Build 全绿 |
| `build-release` | ✅ 构建成功；**Attest build provenance = skipped、Create GitHub Release = skipped** |
| Releases | **0 条**（未创建，dry_run 语义成立） |
| 标签 | **0 个**（未被创建/移动） |
| Actions artifact | 1 个：`attachment-suite-1.0.0`（71,253 B）——**这是工作流 artifact，不是 Release**，别误读成"已发布" |

- **结论**：发布链路（版本解析 → 双平台校验 → 构建 → 三件套齐全）**可正常执行**；
  `dry_run` 确实不会对外留痕。
- **一处需要记住的细节**：`dry_run` **会留下一个 Actions artifact**（"其余照跑"的一部分），
  它不是 Release、也不会被安装器取到；但看 Actions 页时容易误以为"发出去了"。
- **当前仓库状态**：Releases 为 **0**（1.0.0 已被用户删除、dry_run 不重建）。
  正式发布需要更高版本号（推荐 `1.0.1`）：同版本重发不会推送给已装 1.0.0 的用户。

---





