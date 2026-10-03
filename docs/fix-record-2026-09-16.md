# Attachment Suite 修复记录（2026-09-16）

对应审计报告：`docs/audit-2026-09-16.md`。
用户圈定范围：**批次 A+B+C+D**（不含批次 E 的 features 分层重构、死代码清理、tsconfig 加严）。
修复档位：标准档（修确定性缺陷 + 必要的可维护性改造，不改用户可见行为）。
验证档位：只跑关联测试 + typecheck（未跑全量 `npm test`）。

---

## 0. 修复前的交叉验证（剔除了一个 P0 误报、纠正了一个漏检）

| 项 | 裁决 |
|---|---|
| R1 报「`manifest.json` 缺 `main` → 插件装不上」 | **误报，未改**。官方 Manifest schema 无 `main` 字段，入口固定 `main.js` |
| R1 报「features 存在互引」vs R4 报「无互引」 | **R1 对**（实测 10 处）。属批次 E，本轮未改，已在报告中留档 |
| R1 报「`TaskQueue.enqueue` 返回值未接 catch」 | 成立，但**改法取"修调用方"而非改契约**——见 §2.3 |

`desktopOnly` 死字段与 `core/result.ts` 整套死代码属批次 E，本轮**未删除**。

---

## 1. 批次 A：3 个 P0

### A1 命令级异常不再静默（P0-2）
`src/commands.ts` 重写命令登记方式：

- 命令先以 `{ id, name, run }` 定义，再统一包一层 `traceCommand`。**开始提示的名字与命令面板名由同一个 `name` 派生**，从结构上消除"内部代号与面板名不一致"（原实现给每条命令手写内部名，7 处对不上）。
- `traceCommand` 补 `catch`：失败走 `error` 级提示（**任何通知级别都显示**）+ `logger.error`，提示里给出下一步动作。
- 开始提示改走 `info` 级：它本就是过程信息，只在「详细」档出现——这同时让设置项「详细：显示更多过程信息」的承诺成立（此前 `info` 通道零调用，那一档与「仅摘要」完全等价）。
- 原实现的两条 `console.log`（自称"调试"）改为走 `logger`。

### A2 弹窗回调异常不再被丢弃（P0-1）
`src/modals.ts` 新增 `runConfirmed(label, cb)`，替换 3 处 `void cb()`：

- `ConfirmChangesModal` 的确认按钮；
- `ReportModal` 的「去修复可确定断链」；
- `CandidateSelectModal` 的 `onDone`。

并新增 `rewriteRefsSafely()`（`src/features/link-fixer.ts`），把"改完文件之后的引用改写"包住。**这是本次最危险的一条**：`consistency.ts` 先 `moveMany` 改名全部路径、再 `rewriteRefsInAllNotes`；中间抛错会一路冒到弹窗回调被吞掉，结果是"路径已改、引用没跟上（真实断链）、用户零反馈"。现在该步骤失败会明确告知"已改名 N 个但引用改写未完成，请运行「修复断链」"，同时照常报告移动统计。

`consistency.ts` / `name-formatter.ts` / `collect.ts` 三处同步处理（含单篇↔全库不对称，P1-9）。

### A3 frontmatter 引用口径统一（P0-3）
- `src/core/link-resolver.ts` 新增 `listFrontmatterResourceTokens(text)`，与 `rewriteFrontmatter` **共用同一个 `FM_RESOURCE_TOKEN`**。
- `src/core/attachment-index.ts` 的 `managedBasenamesFromFrontmatter` 删除自带的窄正则（`[A-Za-z0-9_.\-/]` + 硬编码扩展名），改用上面的共享解析 + `isManagedAttachment` 门槛；原始写法与 `%xx` 解码写法都纳入。
- 影响：含空格/中文名的 frontmatter 引用（如 `cover: assets/我的 图片.png`）此前既不被认作"在用"、Obsidian 的 `resolvedLinks` 又不收录裸路径 → 会被「清理未用附件」当孤儿删掉。现已消除。
- **补了回归用例**（此前该路径零覆盖）：`tests/unit/core/attachment-index.test.ts` 新增「frontmatter 引用含空格/中文名的附件同样不判为孤儿」。

顺带在同一主题下修掉两处同族写法（原报告 P2-13 / P2-16）：
- `attachment-index.ts` 的 `scanNoteText` 删除按空白截断目标的 `embedRegex`，改走 `listMatches`（保持原有语义：只认嵌入形态）；
- `link-resolver.ts` 的 `rewriteFrontmatter` 末尾改用函数式替换，避免新目标含 `$&`/`$1` 时被当成替换模式展开。

---

## 2. 批次 B：反馈体系（P1-1/2/3/9/10/11）

### 2.1 失败不再被「静默」吞掉
`src/notify.ts` 新增 `reportFailures(toast, count, what)`：失败数 > 0 时补一条 `error` 级提示。
此前破坏性命令一律把"失败 N"混在 `summary` 文本里报，而 `shouldNotify('silent','summary') === false` —— 用户在「静默」档下对失败一无所知，与 `notify-core` "错误任何级别都提示"的承诺直接相悖。

接入点：清理未用 / 清理空目录 / 命名（单篇+全库）/ 收集（单篇+全库）/ 路径修复 / 断链修复 / 本地化（单篇+全库）/ 导出。

### 2.2 「无确认的删除」必定有一次可见结果
`unused-cleaner.ts` / `empty-folder-cleaner.ts`：当「删除前确认」被关闭时，完成结果额外发一条**不受通知级别影响**的提示。否则"通知级别=静默" + "关闭删除前确认"叠加 = 一次完全无人知晓的数据删除。
两个清理弹窗的 `async onClick` 也补了 try/catch（Obsidian 不 await 按钮回调，异常同样会变成未处理 rejection）。

### 2.3 后台队列任务失败可见
`src/main.ts` 新增 `reportBackgroundError()`，接到 `sweepAuto`（自动处理）与 `onRename`（笔记移动跟随附件）两处 `queue.enqueue(...)` 的 `.catch` 上。
**未改 `TaskQueue.enqueue` 的返回契约**：`tests/unit/core/task-queue.test.ts` 有一条用例显式断言 `await expect(bad).rejects.toThrow('fail')`，即"失败要能被调用方观察到"是既有设计意图；真正的缺陷是调用方一律 `void` 丢弃。故选择修调用方 + 在 `enqueue` 上补文档化警告。

### 2.4 导出失败可见（P1-10）
`src/features/exporter.ts` 两条导出链路的 `saveZip` 包 try/catch，失败发 `error` 级提示（含可行动建议）。

### 2.5 「详细」档不再是死档（P1-11）
`src/notify.ts` 新增 `reportProgress(toast, done, total, what)`：步骤取 `max(10, 总数/10)`，一条长任务最多约 11 条进度提示。接入全库命名 / 全库收集 / 全库本地化 / 断链修复四个串行循环。
配合 §1 的开始提示改走 `info`，三档语义现在是真实的：静默=只出错；仅摘要=结果；详细=结果+过程。

---

## 3. 批次 C：配置界面（P1-5/6/7/8 + 若干 P2 文案）

### 3.1 连接符与命名用词的片段清洗（P1-5）
`src/features/name-formatter-core.ts` 新增 `sanitizeNameFragment(raw, fallback)`（剔除路径分隔符、Windows 保留字符、控制字符），并在 `planForSnapshot` 里对 connector 与类别用词统一归一化。
这是**最后一道防线**：即使配置被外部改写（手工改 `data.json`、旧配置迁移），命名也不会做出越界的事 —— 原实现下把连接符填成 `/` 会把附件写进嵌套子目录，填成空串则 `parseRenamed` 恒返回 null，已命名附件永远识别不出来、每次运行都重新规划（幂等被破坏）。
设置页另有一层输入清洗，把纠正后的值**当场回写输入框**，让用户立刻看到实际生效值。
**补了用例**：`tests/unit/features/name-formatter-core.test.ts` 新增「连接符/命名用词含路径分隔符或为空时被归一化」。

### 3.2 父开关联动（P1-6）
`src/settings-tab.ts` 新增 `gatedSection(host, enabled)` + `applyGates()`：父开关关闭时统一禁用其下控件并降低不透明度（`styles.css` 新增 `.iap-settings-gated-off`）。
覆盖 6 个联动区：自定义附件目录、自动化、命名、本地化、一致性、清理。父开关自身不在联动区内，因此始终可编辑（用户能把它开回来）。
连带把「自定义附件目录」从"条件渲染"改为"始终渲染 + 按来源禁用"——比隐藏更易被发现。

### 3.3 数字输入「看到的 = 生效的」（P1-7）
`src/settings-tab.ts` 新增 `bindNumber()`：输入过程不打断（避免边打边跳），**失焦时把实际生效值回写到输入框**。
同时补上「最小文件大小」缺失的负数钳制（原实现把负数直接存进配置，只靠消费侧兜底）。
各数字项的归一化规则与改动前一致，未改变生效行为；每条描述都补充了越界处理说明。

### 3.4 文案订正
- 「排除目录」描述与子开关行为矛盾（P1-8）：原文案暗示含子目录，实际 `excludeSubfolders=false` 时**不豁免子目录** → 用户会误以为 `assets/keep/sub/x.png` 安全，实际会被删。已改为明确写出"默认只豁免列出的目录本身"并指向下方开关。
- 「名称带类型类别」示例 `pdf（文档）` 与独立类别 `document` 撞名 → 改为 `pdf（PDF）`（P2-23）。
- 「本地化网络 URL」「扩展扫描」的"第一步/第二步/第三步"序数与界面排列顺序相反 → 改为按名称描述链路（P2-22）。
- 「扩展扫描」补注：frontmatter 里的媒体外链**始终**会被识别，不受该开关影响（P2-21）。
- 「路径修复的目标系统」说明「仅当前系统」等价于下方对应平台项（P2-20）。
- 通知级别描述补充"失败提示在任何级别都会出现"。
- 设置页顶部补一段总览说明（P2-19 的前半；"恢复默认值"按钮属新增能力，本轮未做，留待批次 E 或后续）。
- 术语统一（P2-18）：用户可见处一律用「未用」（与命令名「清理未用附件」「导出未用附件」一致），不再混用「未使用 / 孤儿」。

---

## 4. 批次 D：文档（P1-12 / P1-13 + P2 文档类）

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

## 5. 新增测试覆盖

| 文件 | 内容 |
|---|---|
| `tests/e2e/settings-tab.test.ts`（新） | 设置页此前**零覆盖**。10 条用例锁定：渲染不抛错、6 个联动区、父开关联动（含"父开关自身仍可编辑"与"重开后恢复"）、连接符/命名用词清洗与回写、数字越界失焦回写、负数钳制、间隔留空回退 |
| `tests/e2e/infrastructure.ts` | 测试替身升级以支撑上述用例：`FakeEl.toggleClass/hasClass/dispatch`、`querySelectorAll` 同时支持类名与标签名、`Setting.addText/addToggle/addDropdown/addSlider` **按真实 Obsidian 语义回调组件**（此前回调被丢弃）、`PluginSettingTab.containerEl`、`registry.textInputs` |
| `tests/unit/core/attachment-index.test.ts` | 新增 frontmatter 含空格/中文名的防误删回归 |
| `tests/unit/features/name-formatter-core.test.ts` | 新增连接符/命名用词清洗与幂等回归 |

---

## 6. 验证结果

- `npm run typecheck`：**0 错误**。
- 关联测试（全部单测 + real-suite / report-accuracy / safety-suite / acceptance / scale / settings-tab）：
  **29 个文件、373 个用例全部通过**（原 363 + 新增 10）。
- 未执行：全量 `npm test`（含 `seed-acceptance`，会重写本地验收库）、`npm run build`、真实 Obsidian CDP 验收。

## 7. 本轮明确未做（留档）

- 批次 E：`features` 之间互引（10 处）的分层重构、重复逻辑收敛（`broken-link-core` 自造 `extOf`/`basenameOf`）、死代码删除（`core/result.ts`、`isCategory`、`settings.localize.desktopOnly`）、`tsconfig` 加严（`noUncheckedIndexedAccess` 等）、生产 `console.log` 清理（`main.ts`/`automation.ts`）。
- 设置页「恢复默认值」入口。
- 长任务可取消。
- `ReportModal` 导出报告走裸 `Notice`（未接入 `Noticer` 体系）。

---

# 批次 E（同日追加，用户圈定 1–6 项 + 删除 `result.ts`）

依据 `batch-e-assessment.md` 的实测结论执行。4 次提交，各自自洽：

| commit | 主题 |
|---|---|
| `16845cc` | refactor: 收敛 features 横向互引与重复实现，修正 extOf 语义分歧（E1 + E2） |
| `680a747` | chore: 清理运行时零引用的死代码与死配置（E3） |
| `38d66e6` | chore: 开启两项零成本严格选项，并把生产 console 归口到 logger（E4a/E4b + E5） |
| `31e8344` | test: 新增架构守卫（§5 的配套件） |

## E1 · features 横向互引收敛

实测 8 条跨 feature 边，其中 **5 条指向同一个 `link-fixer`**（唯一被当"共享执行模块"用的 feature）。按性质拆分归位：

| 内容 | 性质 | 归位到 |
|---|---|---|
| `refMapForMoves`（纯函数） | core | `core/link-resolver.ts` |
| `rewriteRefsSafely` / `rewriteRefsInNote` / `rewriteRefsInAllNotes`（依赖 `App`） | infra | `obsidian-domain.ts` |

删除 `features/link-fixer.ts` 与 `features/link-fixer-core.ts` 两个文件，5 个引用点（`collect`/`consistency`/`bulk-collect`/`note-relocator`/`name-formatter`）改向。

跨 feature 边 8 → **3**；剩下的 3 条（`automation`/`bulk-rename`/`bulk-localize` → 单篇执行层）属**纵向编排**，按评估结论不消灭。实测零循环，本次不修也不会坏——价值是掐掉"共享模块长大→长出环"的路径。

## E2 · 重复实现收敛（含一处实现分歧）

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

## E3 · 死代码清理

| 项 | 实测 | 处置 |
|---|---|---|
| `core/result.ts`（`Result`/`PluginError`/`ok`/`err`…，52 行） | 运行时零引用 | 删除（含自身单测、`core/index.ts` 的 re-export） |
| `type-classifier.ts` 的 `isCategory` | 生产零引用，仅自测 | 删除 |
| `settings.localize.desktopOnly` | 运行时零读取 | 删除（含 3 处测试夹具） |

README 的「错误模型」条目同步改写为**实际做法**（异常承载 + `traceCommand`/`runConfirmed`/`reportBackgroundError` 三处统一收口，失败提示不受通知级别影响）。

## E4 / E5 · 严格选项与日志归口

- `noImplicitOverride`：实测 **14 处**，全部补齐（`Modal.onOpen/onClose` 10、`Plugin.settings/onload/onunload` 3、`PluginSettingTab.display` 1）。价值：Obsidian 基类方法改名/消失时，没有 `override` 会静默变成普通方法。
- `noFallthroughCasesInSwitch`：实测 0 处，免费开启。
- **`noUncheckedIndexedAccess` 明确不开**：实测 187 处，大量集中在 `hasher`/`zip`/`type-classifier` 这类下标访问本质不受检的位置，加了只会刷 `!` 并掩盖真正需要判空的少数位置。
- 生产 `console.*` 11 处（`main.ts` 8、`automation.ts` 3）→ **归口 `logger`，不删除**。其中 onload 的开始/完成/失败是作者刻意留的"排查代码是否真的加载"手段；按噪音分级（高频事件走 `debug`，加载结果与失败走 `info`/`error`），保留能力且受 `setLogLevel` 门控。`src/` 内现除 `logger.ts` 的 sink 外无 `console` 调用。

## §5 配套件 · 架构守卫（`tests/unit/architecture.test.ts`）

四条不变式（详见文件头注释）：core 完全自包含 / features 的 `*-core` 保持纯逻辑 / 跨 feature **执行层**依赖逐条白名单（横向共享不许，纵向编排放行）/ 通用工具只允许一处实现 + core 内不得复活两种旧写法。

**守卫自己抓出了 3 处需要定性的问题**，其中两处证明"按域界定"优于一刀切：

1. `localize-media-core` 的 `MD_IMG`/`MD_LINK` 也是 `([^)\s]+)` 形态 —— 但它解析的是**外部 URL**，URL 不含字面空格，而"截到空白为止"正是用来剥掉 `![x](url "标题")` 标题段的，属该域的刻意选择；
2. 同文件的 `nameHintOf`/`decodeDataUri` 也调 `decodeURIComponent` —— 解的是 URL 末段与 data-URI 载荷，且 `nameHintOf` 失败回退 `alt/image` 的语义与 `decodePercentEncoded` 不同，强行合并会改行为；
3. `attachment-index` 被命中是因为**注释里引用了旧正则**。

故：旧写法检查**按域收窄到 `core/**`**，并加注释剥离（避免误伤文档性引用）。排除理由都写进了用例注释——否则守卫会因误报被关掉，反而失去意义。

**反向验证**：注入一条跨 feature 依赖 + 一份 `basenameOf` 重复实现，确认 2 条用例如期失败；清理后恢复通过。不会失败的守卫没有价值。

## 验证

- `npm run typecheck`：**0 错误**（且在新开启的严格选项下）。
- 关联测试（全部单测 + real-suite / report-accuracy / safety-suite / acceptance / scale / settings-tab）：
  **28 个文件、368 个用例全部通过**。
- 未执行：全量 `npm test`（含 `seed-acceptance`）、`npm run build`、真实 Obsidian CDP 验收。

## ⚠️ 过程中的两次工作树事故（务必留档）

本批次实施期间，`src/` 两次整体从工作树消失（第一次 `src` + `tests` 共 84 个文件，第二次 `src` 46 个文件），两次**都紧跟在 `git rm` 命令之后**：

- 已排除的仓库侧原因：无 hooks（仅 `.sample`）、无 alias、`.gitignore` 不涉及 `src`/`tests`；
- 已排除的通用 git 行为：单独执行 `git status` 等命令不会触发；
- 现象：`git rm <显式路径>` 返回 0 并正确暂存了目标文件的删除，但同目录下的**其它**文件（乃至同级目录整体）也从工作树消失，`ls` 确认物理不存在。

**恢复方式**：两次 HEAD 均完好，`git checkout HEAD -- "<path>"` 即可无损恢复（无未跟踪文件、无 stash，故无内容被覆盖）。损失仅为当次未提交的编辑，已重做。

**规避措施（已执行）**：改用普通 `rm` 删除文件，交付时由 `git add -A` 记录删除；并且**每完成一组就立即提交**，把再次发生的爆炸半径压到最小。后续在本环境操作仓库时，建议继续遵守这两条。

（原因未定位到文件系统层以下的确定性证据；若再次出现，建议排查该目录是否被同步盘/杀软/沙箱接管。）
