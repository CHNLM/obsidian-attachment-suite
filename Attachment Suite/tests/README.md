# Attachment Suite — 测试项说明与使用指导

本文档面向后期使用与维护，说明 `tests/` 目录结构、各测试文件覆盖的测试项清单，以及如何运行、扩展与维护测试。

- 测试框架：Vitest + TypeScript
- 运行命令：项目根（`Attachment Suite/`）下执行 `npm test`（单次运行）或 `npm run test:watch`（监视模式）
- 类型检查：`npm run typecheck`（`tsc --noEmit`，TypeScript 严格模式，**已覆盖 `tests/`**）
- 当前规模：**40 个测试文件，529 个运行时用例，全部通过**（数字随迭代增长，以 `npm test` 输出为准；**本行与下方套件表由 `docs-consistency.test.ts` 对账**）

---

## 1. 目录结构清单

```
tests/
├── e2e/                          # 端到端“真实”集成测试（多个套件，按风险主题分工）
│   ├── real-suite.test.ts        # 主套件：加载插件、驱动全部 13 条业务命令、校验真实落盘
│   ├── safety-suite.test.ts      # 不可逆风险专项：误删 / 误改写 / 收敛 / HTML 与 canvas 引用归属（15 条）
│   ├── report-accuracy.test.ts   # 报告准确性专项：误报与漏报矩阵（8 条）
│   ├── scale.test.ts             # 规模基线：索引/审计/全库命名的耗时与幂等
│   ├── acceptance.test.ts        # 验收库全量（82 用例 × 13 条业务命令 × 收敛轮次，语义不变式 + 用例级机器校验）
│   ├── vault-config.test.ts      # 「跟随 Obsidian 设置」的落盘位置逐格覆盖（注入式库配置）
│   ├── notify-contract.test.ts    # 失败可见性契约：静默档下失败仍须提示 + 静默档下成功零提示（对照）
│   ├── file-menu.test.ts         # 文件右键菜单入口：只对笔记出现 + 目标必须是"被右键的那一篇" + 卸载即回收
│   ├── defaults.test.ts          # 「开箱即用」契约：默认值决策表 + 13 条业务命令都不报"能力已关闭" + 扩展扫描/移动跟随默认生效
│   ├── modals.test.ts            # 弹窗交互与**弹窗内提示**：候选未选中时「以此修复」置灰 + 空 sections 不抛错 + 弹窗内提示同受通知级别/分级时长约束
│   ├── seed-acceptance.test.ts   # 验收库生成器：落成真实验收库文件（本地生成，不入版本控制）
│   ├── acceptance-fixture.ts     # 验收用例定义（单一事实来源）+ 验收设置 + 库结构生成
│   ├── infrastructure.ts         # 测试基础设施：Obsidian API mock + TestApp + 夹具工具
│   └── fixture.ts                # 主套件夹具：TEST_SETTINGS + seedFixture
├── integration/                  # 执行层集成测试（预留，当前仅 .gitkeep）
│   └── .gitkeep
├── mocks/
│   └── obsidian-stub.ts          # bare specifier `obsidian` 的运行时 mock（单例）
└── unit/                         # 纯逻辑单元测试（脱离 Obsidian 运行）
    ├── architecture.test.ts      # 架构守卫（分层边界与"唯一实现"，扫描 src/ 源码）
    ├── docs-consistency.test.ts  # 文档对账守卫：tests/README 的分项之和 = 规模声明；对外文档不得写出已核实的错误宿主标签
    ├── manifest.test.ts          # manifest.json：id/name 不得随手改 + description 必须与界面语言一致
    ├── notify-core.test.ts       # src 顶层纯逻辑
    ├── settings-migration.test.ts
    ├── workflow-config.test.ts   # 工作流配置守卫：唯一覆盖 .github/ 的一层（钉扎、顺序、集合关系）
    ├── core/                     # 镜像 src/core（纯逻辑、零依赖）
    │   ├── attachment-index.test.ts
    │   ├── format-matrix.test.ts    # 受管名单 × 魔数识别的清单级对账（21 项一个不落，归一必须登记）
    │   ├── hasher.test.ts
    │   ├── link-resolver.test.ts
    │   ├── path-compatibility.test.ts
    │   ├── safe-move.test.ts
    │   ├── task-queue.test.ts
    │   ├── type-classifier.test.ts
    │   └── zip.test.ts
    └── features/                 # 镜像 src/features/*-core（纯计算，可单测）
        ├── broken-link-core.test.ts
        ├── bulk-collect-core.test.ts
        ├── bulk-rename-core.test.ts
        ├── collect-core.test.ts
        ├── consistency-core.test.ts
        ├── empty-folder-core.test.ts
        ├── export-name-core.test.ts
        ├── localize-media-core.test.ts
        ├── name-formatter-core.test.ts
        ├── note-relocator-core.test.ts
        └── unused-cleaner-core.test.ts
```

> 另有 `scripts/obsidian-cdp-acceptance.mjs`（CDP 驱动真实 Obsidian 跑全量验收）、
> `scripts/obsidian-cdp-trace.mjs`（逐步追踪 + 宿主控制台采集，诊断"是哪一步坏的"时用）
> 与 `scripts/cdp-eval.mjs`（对已开调试端口的 Obsidian 单步求值）、
> `scripts/cdp-probe.mjs`（**连接时序探针**：观察 Obsidian 启动后 CDP 页面出现的时序，
> 以及每个页面能否读出所属库的 `basePath`——排查"连不上 / 连错窗口 / 读不到库路径"时用），
> 见第 5.3 节。
> 两个 CDP 脚本共用 `scripts/lib/acceptance-http-server.mjs`——外链用例的**被测目标**必须同源，
> 否则追踪时外链会全部假失败（`ERR_CONNECTION_REFUSED`），日志里全是工具自己造的噪声。
> 该模块也能**单独启动**，供"人工在验收库里手动体验"时使用：
>
> ```bash
> node scripts/lib/acceptance-http-server.mjs        # 默认 45999，Ctrl+C 结束
> ```
>
> 不起它也行，但验收库里 `externals/`、`notes/07-外链本地化.md` 等用例的外链**全部指向
> `http://127.0.0.1:45999/`**，手动跑「本地化」时会成片失败——那是**缺被测目标**，不是插件坏了。

### 关键约定（导入路径深度）

| 目录 | 相对 `src` 深度 | 示例 |
| --- | --- | --- |
| `unit/core`、`unit/features` | 3 层 | `../../../src/core/...` |
| `unit/`（根） | 2 层 | `../../src/notify-core` |
| `e2e/` | 2 层，另走 Vite alias | `import('../../src/main')` |

> 注意：`e2e` 加载的是**源码** `src/main`（经 Vite + alias），与 esbuild 打包产物逻辑等价。若需验证真实构建产物 main.js，请在 Obsidian 中用**本地验收库**实体运行（见第 5 节）。

---

## 2. 单元测试 — 测试项清单

单元测试全部为**纯逻辑**测试（不依赖 Obsidian 运行时），置于 `unit/` 下，镜像 `src/` 结构。

### 2.1 `unit/core` — 核心纯逻辑

| 文件 | 测试项 | 数量 |
| --- | --- | --- |
| [hasher.test.ts](core/hasher.test.ts) | MD5：空串/abc 标准向量、字节与字符串一致、长串稳定、空字节、多字节 UTF-8（中文/emoji）、跨 512 位分块边界（RFC 1321 权威向量） | 7 |
| [link-resolver.test.ts](core/link-resolver.test.ts) | 解析 markdown/wiki/md转包含 链接、`rewrite` 重写保留外壳/锚点/别名、空映射原样返回、普通链接改写、`sanitizeFilename` 防路径穿越、`rewriteFrontmatter` 改写（含单/双引号保留、`%20` 归一、含空格与中文路径、列表形式）、`listFrontmatterLinks` 提取资源；**含空格的 markdown 目标不被空白截断**、`<>` 尖括号写法、` "标题"` 段保留、目标 `%xx` 解码、新目标编码写回（空格/圆括号）、新目标含 `$&`/`$1` 不被当作替换模式展开；`refMapForMoves` 完整路径与 basename 双写映射、跨目录同名时 basename 以首个目标为准 | 40 |
| [path-compatibility.test.ts](core/path-compatibility.test.ts) | `isViolation`（保留名/非法字符/尾随点空格/盘符/空名与点目录/字节与单元上限/非 Windows profile）、`repairName` 修复与按字节/单元截断、空扩展名（无 .ext）、控制字符、附件目录模板变量、`normalizeLocal` 解析 `.`/`..`、`resolveAttachmentDir` 根形式（**`/` 表示库根**，与 Obsidian `attachmentFolderPath` 默认值一致）、`isPathExcluded` 排除路径 | 22 |
| [safe-move.test.ts](core/safe-move.test.ts) | SafeMoveEngine：目标占用自动避让（单级/多级编号/无扩展名）、无冲突直改、瞬时失败重试成功（P2-8）、**源不存在时快速失败（不空等退避）**、持续失败抛错、`moveMany` 批量容错（单项失败记 errors） | 8 |
| [task-queue.test.ts](core/task-queue.test.ts) | 串行顺序、返回值、错误隔离、`isProcessing` 状态、`drain` 等待、取消令牌 | 6 |
| [type-classifier.test.ts](core/type-classifier.test.ts) | PNG/APNG/JPEG/GIF（静/动画）/BMP/WebP（静/动画）/AVIF/MP4/WebM/MP3/FLAC/WAV/OGG/docx/xlsx/pptx/普通 zip/HTML/纯文本、内容识别 + hintPath 回退与无效扩展名回退、空输入 | 20 |
| [zip.test.ts](core/zip.test.ts) | CRC-32 校验、生成含 manifest 的 zip、规范签名（local/central/EOCD）、空列表合法 EOCD | 4 |
| [attachment-index.test.ts](core/attachment-index.test.ts) | 索引构建（条目/孤儿/坏引用）、快照复用与 markDirty 重建、非托管文件不入条目、断链去重、resolvedLinks 缺失时短名防误删、唯一名短名合成引用、同 basename 多文件不冒险、frontmatter 引用不判孤儿（含 markdown 链接格式）、canvas file 引用（含坏 JSON/外链忽略）、frontmatter 断链、`getEntry`；**"在用"保护面必须覆盖插件自己会写出的引用形态**：无扩展名短名（按 stem 反查）、URL 编码双写法、含空格路径；**Obsidian 的解析结果与插件的文本扫描两套口径必须合并**（HTML 媒体标签引用不得被 `resolvedLinks` 挤掉） | 27 |
| [format-matrix.test.ts](core/format-matrix.test.ts) | **格式矩阵守卫**（受管名单 × 魔数识别的**清单级**对账——此前这两套口径之间没有任何守卫）：矩阵必须覆盖 `types.ts` 的 21 个受管扩展名且不多不少（新增受管扩展名却忘登记期望值会红）；每个扩展名一个最小魔数样例，逐行比对类别 / 落盘扩展名 / isSvg——于是 `jpeg→jpg`、`mov→mp4`、`mkv→webm` 这类**有意归一**成为"被看见的决定"而非静默改写（`m4a` 被判成 video 这个缺口正是本表暴露出来的）；`classify` 能认出但**刻意不落管**的 zip / html / txt / bin 必须逐个登记理由，且不得与受管名单重叠；内容认不出时须回落到原扩展名并标 misc，不许假装认得；**ISO-BMFF 品牌必须精确分流**——`avc1` / `av01`（视频品牌）曾被 `startsWith('av')` 判成 AVIF 图片，而 ext 会一路走到落盘，视频会被存成 `.avif` | 5 |

### 2.2 `unit/features` — 功能纯计算层（`*-core`）

| 文件 | 测试项 | 数量 |
| --- | --- | --- |
| [broken-link-core.test.ts](features/broken-link-core.test.ts) | `planBrokenLinkFixes` 分层候选：精确 / 归一化 / URL 解码 / 相对路径解析的自动改写，大小写差异与多候选进入交互层，无候选保持原样，名称相似度推荐（阈值与 top-N），`%20` 编码与无对应文件时的跳过 | 30 |
| [bulk-collect-core.test.ts](features/bulk-collect-core.test.ts) | `planBulkCollect` 全库收集：独占附件按归属笔记归档、**共享附件跳过并计数**（与单篇收集同口径）、已在目标目录跳过 | 4 |
| [bulk-rename-core.test.ts](features/bulk-rename-core.test.ts) | `planBulkRename` 按归属笔记分组并生成真实 from→to、共享附件 `sharedCount` 计数（多篇引用计一份）且每篇各生成带各自笔记名的副本、同类别序号递增、folderByCategory 子目录、addTime/addPathHash 生效、已按方案命名的附件跳过（幂等）、未被引用附件不入计划、空快照空计划、带目录 sourcePath 的笔记名提取、canvas 笔记归属、frontmatter 类引用、同名笔记跨目录按路径区分、跨目录共享副本同源 | 14 |
| [collect-core.test.ts](features/collect-core.test.ts) | `planCollect` 收集散落附件规划、已在目标目录/非本笔记不收集、空目标目录语义（收集到库根）、**共享附件不移动（`isSharedEntry`：同篇多次引用不算共享）** | 4 |
| [consistency-core.test.ts](features/consistency-core.test.ts) | 平台 profile、修复 Windows 保留名/尾随空格、合法名不列入、非 Windows 平台仅修通用违规、根目录文件规划、混合输入 | 8 |
| [empty-folder-core.test.ts](features/empty-folder-core.test.ts) | `planEmptyFolderCleanup` 只清叶子空目录、含文件/子目录不清理；`planEmptyFolderCleanupDetailed` 排除目录（含其各级子目录）跳过并计数、被排除的空目录仍参与父目录判定（父目录不被误删）、空排除名单与旧接口一致 | 5 |
| [export-name-core.test.ts](features/export-name-core.test.ts) | 扁平归档同名去重：原名/时间戳/序号兜底、`tsOf` 格式化、无扩展名冲突 | 5 |
| [localize-media-core.test.ts](features/localize-media-core.test.ts) | `findExternalRefs` 提取 http/data、忽略本地、扩展扫描（普通链接/HTML img/audio/video）、**frontmatter 裸 URL 与列表形式**、畸形百分号 URL 不抛错、`localLinkText`（markdown 目标编码空格）、`applyRefReplacements`（md/wiki/**保形：普通链接仍是链接、HTML 只换 src**）、**新目标含 `$&`/`$1` 不被展开**、MD5 命名、data URI 解码（base64/文本/畸形）、nameHint 回退、`localName` 路径穿越回退 MD5、**名单项按主机名收口（粘贴 URL / `host:port`）** | 50 |
| [name-formatter-core.test.ts](features/name-formatter-core.test.ts) | `buildName` 命名格式与 includeNoteName/honorCategory 开关、`namingParts` 补零、`formatTimestamp`、`checkAlreadyRenamed` 幂等（含时间/哈希段校验/两位序号/空连接符）、`parseRenamed` **兼容避让后缀 ` (N)`**、`planForSnapshot` 规划（showSubType/folderByCategory/已命名附件占用序号段接续编号不碰撞） | 20 |
| [note-relocator-core.test.ts](features/note-relocator-core.test.ts) | `resolveAttachmentDir` 归一化（`././assets` 回归）、跟随型判定、`attachmentTargetsFromText` 解析、`planRelocation` 旧→新与同目录跳过 | 5 |
| [unused-cleaner-core.test.ts](features/unused-cleaner-core.test.ts) | `shouldExclude` 精确/含子目录/尾随斜杠/根级文件、`planCleanup` 过滤排除目录 | 6 |

### 2.3 `unit/`（src 顶层纯逻辑）

| 文件 | 测试项 | 数量 |
| --- | --- | --- |
| [notify-core.test.ts](notify-core.test.ts) | `shouldNotify`：silent/summary/verbose 级别门控（error 恒提示）；`effectiveDuration`：分级基础时长（error 5s/summary 3s/info 2s）与长度自适应加长 | 7 |
| [settings-migration.test.ts](settings-migration.test.ts) | `migrateSettings`：默认回退、v0 扁平字段迁移（含嵌套保留）、丢弃未知字段、局部保留、版本一致跳过、附件目录来源（obsidian/custom）判定、数组字段整体覆盖、**`DEFAULT_SETTINGS` 每个顶层键的往返断言**（`normalizeFields` 的白名单与 `PluginSettings` 是两份实现，漏键会让设置被静默丢弃） | 13 |
| [manifest.test.ts](manifest.test.ts) | **manifest.json 守卫**：`id` / `name` 一字不许改（改了会波及已装用户的命令 id 前缀、快捷键绑定与插件身份）、版本号是合法 `x.y.z`、**`description` 必须含中文**（界面与 README 全中文，描述没有理由是英文——审计 §11.5 的 ⑤） | 3 |
| [docs-consistency.test.ts](docs-consistency.test.ts) | **文档对账守卫**（上一版只覆盖 tests/README 的数字，结果 coverage-audit 与 command-inventory 悄悄漂移，故逐步扩成七类）：① `tests/README` 套件表分项用例数之和 = 第 8 行声明的总数、单列文件数 = 实际文件数、每个实际测试文件都被登记；② **「当前有效」文档清单由 `docs/README.md` 索引表驱动**（索引兼作机器可读清单 → 历史归档文档天然被排除，不会把"当时的事实"误判成错误），清单里的路径必须真实存在；③ **当前规模只能有一个权威来源**（`tests/README` 第 8 行）——其它文档的「规模」小节**不得复制数字**，必须指向它（原先只要求"复制的那份与权威值一致"，仍是复制：本轮加 6 个用例时又被抓了一次）；另含 **全量命令声明必须等于 `commands.ts` 注册数**（只抓"加粗的清单式声明"，叙述性用法不误报）；④ 四份对外文档不得写出已核实的错误宿主标签；⑤ **文档引用的文件与符号必须仍然存在**——这类引用最容易随重构失效（删个 core 模块、改个函数名），而原先只能人工查；豁免规则写成通用的四条并带"至少检查 100 处"的反空转断言。**⑥ `docs/default-settings.md` 的三十多个默认值必须与 `DEFAULT_SETTINGS` 一致**（此前完全没有对账，正属"手写清单最易漂移"那一类）：值从代码**现场读取**、文档侧解析表格，两边比对；另加"默认列写 开 / 关 的行必须都在映射表里"的完备性规则——以后新增默认值却忘了纳入对账，守卫会先红；**⑦ 命令清单必须与源码注册一一对应**：`docs/command-inventory.md` 与根 README 两处的命令 id 集合 = `commands.ts` 注册的 14 条，漏登记一条或留一条已删命令都会红。每条都带反空转断言 | 22 |
| [architecture.test.ts](architecture.test.ts) | **架构守卫**（不测功能，测约定）：`src/core` 完全自包含（零 obsidian、无 `../` 反向依赖）、features 的 `*-core` 保持纯逻辑、跨 feature 执行层依赖必须逐条登记在白名单（并反向断言白名单无腐烂）、通用工具（`basenameOf`/`dirOf`/`extOf`/`decodePercentEncoded`/`normalizeInVault`/`normalizeLocal`）只允许一处实现、core 内不得复活"空白截断链接目标"与"自制百分号解码"）、**并带"扫到的源文件数 ≥ N"的防空转断言**（枚举规则失效时先红，而不是"零 offender 全绿"） | 9 |
| [automation-core.test.ts](features/automation-core.test.ts) | **自动处理的启动门与批量护栏**（纯决策逻辑）：就绪前一律不标记（含"迟到批量事件"——不依赖固定毫秒数）、余震窗口边界、再武装窗口边界与"真实编辑不被永久吞掉"、护栏"等于上限放行 / 超过整批拒绝"、拒绝告知的措辞（含"不得出现 markdown 标记"）。这两道防线保护的是"用户只是打开了 Obsidian，整个库的附件被改名搬走" | 10 |
| [acceptance-tooling.test.ts](acceptance-tooling.test.ts) | **验收工具链口径同步守卫**：harness（`acceptance.test.ts`）与真实宿主脚本（`scripts/obsidian-cdp-acceptance.mjs`）的引用解析必须同时具备四项能力（`<…>` 包裹、wiki 剥 `#锚点`/`\|别名`、canvas 的 `file` 字段、按主名回退），且都不得复活"按空白截断目标"。两侧无法共用代码（TS vs .mjs），只改一边就会漏掉一整类缺陷而脚本仍显示 0 问题。另含**本地 HTTP 服务同源守卫**：两个 CDP 脚本（验收与追踪）必须共用 `scripts/lib/acceptance-http-server.mjs`，且不得内联第二份实现——追踪脚本曾因缺这份服务，每一轮都打印假的"下载失败（`ERR_CONNECTION_REFUSED`）"，把排查带偏 | 7 |
| [workflow-config.test.ts](workflow-config.test.ts) | **工作流配置守卫**（`.github/` 原先没有任何守卫覆盖，而改错的代价是发布停摆或发出坏产物）：两个工作流的 `PLUGIN_DIR` 必须一致（caller 的工作流级 env 不传给被调用者，所以两份是必须的、**不一致**才是缺陷）；每个外部 action 都钉到 40 位 commit SHA 且带行尾版本注释；**三件套清单只有一份实现**（复合 action `verify-plugin-dist`），两处都调用它且路径与 `esbuild.config.mjs` 的 `PKG_DIR` 对得上；build-release 步骤顺序是「构建 → 三件套检查 → 打包 → 签名 → 发布」；**被签名的集合等于被发布的附件集合**、且缺附件要硬失败；权限里不得出现 `actions: write`；版本单调性守卫必须用 `sort -V` 并排在写出 outputs 之前；引用 `inputs` 的 step 级 `if` 必须兼容 push 事件；**run 脚本引用的每个变量都要有来源**（专抓"把 env 变量搬走却搬漏一处"）。刻意不引入 YAML 依赖、按缩进解析，每条都带防空转断言 | 10 |

---

## 3. E2E 真实测试 — 测试项清单

E2E 以**真实文件系统临时仓库**为后端，加载插件并**实体执行命令**，校验真实落盘与链接改写。
共 12 个套件、**158 个用例**（数字随迭代增长，以 `npm test` 输出为准）。按风险主题分工，而非堆在一个文件里：

| 套件 | 用例 | 职责 |
| --- | --- | --- |
| [real-suite.test.ts](e2e/real-suite.test.ts) | 54 | 主套件：全部 13 条业务命令的功能与落盘结果；「9. 路径修复」2 条（无非法路径时优雅无操作 + 存在不兼容名时**真改名并同步改写引用**，改写目标必须真实存在）；另含「20. 启动门与批量护栏」5 条（未就绪不处理 / 对照：就绪后正常处理 / 护栏整批拒绝且在静默档仍可见 / 边界（等于上限正常处理）/ 卸载后事件与定时器不再触发） |
| [safety-suite.test.ts](e2e/safety-suite.test.ts) | 18 | **不可逆风险专项**：误删 / 误改写 / 幂等 / HTML 与 canvas 引用的改写责任归属 / 删除前复检口径 |
| [settings-tab.test.ts](e2e/settings-tab.test.ts) | 32 | 设置页渲染与交互：6 个联动区、父开关联动（含「点开关当场生效」）、连接符/命名用词清洗回写、数字越界失焦回写、间隔变更重装定时器、下拉取值不谎报、**「详细诊断日志」开关必须走插件的生效路径**（只改字段＝界面骗人）；**类别开关必须回写实际生效状态**（只剩一个类别时那次取消会被拒绝，控件不能因此停在「关」）；**命名用词覆盖全部类别**（`webpage` 被命名逻辑消费，就必须有输入框；反之本地化侧不得出现「网页」死开关）；**开箱即用引导**（顶部必须写明"不必逐项调整"并点出唯一的决策项；库根时给针对性提示、**非库根时不得常驻**；切到自定义后提示消失；网络细项收进可折叠区且没吞掉常用项）；**说明文字自报的默认值必须等于 `DEFAULT_SETTINGS`**（7 个数值项 + 2 个开关项，改默认值忘改文案会当场红）；**引用的 Obsidian 原生标签必须与宿主语言包一致**（`HOST_LABELS` 白名单逐段核对路径、并禁止历史误写的名字复活） |
| [report-accuracy.test.ts](e2e/report-accuracy.test.ts) | 8 | 报告准确性：误报与漏报矩阵 |
| [vault-config.test.ts](e2e/vault-config.test.ts) | 10 | **「跟随 Obsidian 设置」的落盘位置逐格覆盖**（库根 / 笔记相对 / 裸名 / 紧邻 / 键缺失回退 / custom 优先）+ `useMarkdownLinks` 两种风格 + 带标题的外链 |
| [notify-contract.test.ts](e2e/notify-contract.test.ts) | 10 | **失败可见性契约**：静默档下写盘失败仍须提示、静默档下纯成功零提示（对照）、命令级异常必报「执行失败」、静默+关闭确认仍提示一次、摘要档带停留时长、**失败提示承诺的「详情见开发者控制台」必须真有原因**、**诊断开关打开后必须真有新输出**、**设置落盘后重载仍生效**；**启动横幅必须受「通知级别」约束**（静默档下 onload 不得弹任何提示 + 摘要档有且仅有一条，对照） |
| [scale.test.ts](e2e/scale.test.ts) | 1 | 规模基线：索引/审计/全库命名耗时与幂等 |
| [acceptance.test.ts](e2e/acceptance.test.ts) | 1 | 验收库全量（内含 82 条验收用例 × 13 条业务命令 × 收敛轮次） |
| [defaults.test.ts](e2e/defaults.test.ts) | 4 | **「开箱即用」契约**（默认值是产品决策，此前无人看守）：默认值决策表（能力总开关、扩展扫描、移动跟随、安全项、通知档）；**13 条业务命令在默认配置下逐条执行、任何一条都不许报「能力已关闭」**；扩展扫描默认认得 `<img src="data:…">` 并落盘改写；笔记移动时附件默认跟随且旧位置不留孤儿 |
| [modals.test.ts](e2e/modals.test.ts) | 11 | **弹窗交互 + 弹窗内提示的契约**（覆盖审计 §11.5 遗留的 ②③④）：未选中候选时「以此修复」必须**置灰**并给出"先选一个"提示、选中后点亮且提示消失、置灰态下触发不得改动任何东西（含"选中后确实能修复"的对照）；`ReportModal` 传空 `sections` 不得抛错（`[].every` 恒真那段）、有声明 `emptyText` 时仍用它自己的文案；静默档下"导出成功"不弹而"导出失败"必弹、摘要档下时长由 `effectiveDuration` 算出；另加**源码级守卫**——`modals.ts` 里所有 `Notice` 时长不得写字面数字（行为断言抓不住"硬编码恰好等于算出来的值"） |
| [file-menu.test.ts](e2e/file-menu.test.ts) | 7 | **文件右键菜单入口**：只对笔记（md/canvas）出现、菜单项名字与命令面板同源、每项都真的挂了点击回调；**目标必须是「被右键的那一篇」**（活动笔记 A、右键 B → 导出与收集都落在 B、A 完全不动；负对照专抓"误用 getActiveFile()"）；卸载后条目不再追加（防重载叠加） |
| [seed-acceptance.test.ts](e2e/seed-acceptance.test.ts) | 2 | 验收库生成器（写本地验收库，幂等；**能从零建起**——该目录被 gitignore，CI 里本就不存在）+ **落盘路径分量的字节数守卫**（≤255 字节；N16 曾用 273 字节的名字，只在 ubuntu 炸） |

### 3.1 real-suite.test.ts — 主套件（20 组 / 54 例）

| 组 | 测试项 | 覆盖 |
| --- | --- | --- |
| 1. 插件加载与命令注册 | onload 不抛错且注册全部 14 条命令（13 条业务 + 1 条诊断开关） | 命令面板注册 |
| 2. 一致性审计 | 正确汇总坏链接（2）与未用附件（4 个孤儿） | 审计报告目录 |
| 3. 统一命名 | 重命名当前笔记附件并同步改写正文与 frontmatter 引用 | `assets/NoteA_image_001/002` |
| 4. 媒体本地化 | ① 下载 http 与 data 引用、写盘并改写为本地引用 ② 对外部真实页面复制笔记执行（中文目录 + 真实 URL） ③ frontmatter 外链（`cover:` 标量/列表）一并本地化并保留引号 | NoteA + `测试A/网页内容复制.md` |
| 5. 未用清理 | 确认后把未引用附件移入回收站，保留被引用附件 | `.trash` 核对 |
| 6. 导出当前笔记 | 生成 `NoteA_Attachments.zip`（PK 魔数校验）；体积上限（512MB 中止，`exporter.ts` 的 `checkExportSize`）**当前无用例覆盖**（需伪造 >512MB 的 `stat.size`，尚无夹具） | PK 魔数 |
| 7. 导出未用附件 | 生成 `Unused_Attachments.zip` 且含孤儿；全局排除目录内的未用附件不导出（全部被排除时不生成 zip） | PK 魔数 / 排除目录 |
| 8. 笔记移动跟随 | 笔记跨目录移动时迁移相对型附件目录附件 | `AAA/assets` → `CCC/assets` |
| 9. 路径修复 | 在无非法路径的库上优雅无操作并提示；存在不兼容名（`a..png`，全平台可建、全平台判违规）时**改名附件并同步改写引用**（改写目标必须真实存在） | 通知校验 / 改名 + 改写引用 |
| 10. 自动化 | 粘贴外链后自动下载并统一命名 | `Auto.md` |
| 11. P0 增强 | P0-1 粘贴事件触发本地化+命名 / P0-2 焦点切换不影响（显式路径）/ P0-3 共享附件复制副本再命名 | paste / changed / 共享 |
| 12. P1 增强 | P1-5 收集散落附件 / P1-6 按类型放入子目录 / P1-4 附件目录模板变量 | collect / folderByCategory / `${notename}` |
| 13. P2 增强 | P2-9 清理空附件目录（移入回收站，非空目录保留）；P2-9b 清理空附件目录受清理总开关、删除前确认与排除目录约束 | empty-dir / `cleanup.enabled`·`requireConfirm`·`excludedFolders` |
| 14. 全库统一命名 | 批量命名全库独占与共享附件，共享附件为每篇各复制副本；folderByCategory 时共享附件在类别子目录下为每篇各复制副本；已命名附件占用序号段时新附件接续编号且重复运行幂等（不产生 `(1)`）；排除目录笔记的附件不被全库命名 | `bulk_rename`：`NoteX/NoteY_image_001/002`、`assets/image/` 子目录、`NoteZ_image_002`、`excluded/only-e.png` 保留 |
| 15. 全库本地化 | 全库下载外链：同一外链去重仅落一份 MD5，排除目录笔记不处理 | `bulk_localize`：外链 → 本地 MD5、`excluded/` 保留外链 |
| 16. 批量通知收敛 | 全库命名 60 篇与全库本地化 8 篇时仅产生一条汇总横幅，不逐篇刷屏 | `registry.notices` 数量校验 |
| 17. 断链修复 | 一致性总开关关闭时命令直接返回、不改写任何笔记；大小写差异候选交互弹窗后改写；多候选全跳过不改文件；`%20` 编码引用不误报；wiki 无扩展名断链无候选时保持原样；HTML `<img>` 断链无候选时保持原样 | `consistency.enabled` 门禁 / 候选分层 |

| 18. 点击定位到断链所在笔记 | 报告条目点击后在编辑器里定位到该引用（**打开 ≠ 定位**：断言 `handle.editorCalls`） | `revealRefInNote` |
| 19. 粘贴即处理 | 粘贴外链后自动本地化 + 统一命名（`emitPaste` 驱动，不依赖当前焦点） | `emitPaste` → 自动处理 |
| 20. 自动处理的启动门与批量护栏 | 未就绪不处理 / 对照：就绪后正常处理 / 护栏整批拒绝且在静默档仍可见 / 边界（恰好等于上限正常处理）/ 卸载后事件与定时器不再触发（防重载叠加） | 库就绪门 / `maxPerSweep` |

### 3.2 safety-suite.test.ts — 不可逆风险专项（18 例）

专打"删错/改错就回不来"的路径。分组：

- **A. 清理未用不得误删"仍被引用"的附件**：八种引用形态逐一验证（正文 md 图 / wiki 嵌入 / 无扩展名短名 `![[pic]]` / URL 编码 `%20` / **含空格路径** / frontmatter / canvas `file` / HTML 标签）；排除目录内的未用附件不被清理；**只含点文件（`.DS_Store`/`.gitkeep`）的目录视为非空、不得当空目录清掉**（库索引看不见点文件，判空须回查真实文件系统）。
- **B. 修复断链不得把引用改到错误目标**：发生改写时必须校验目标**真实存在**；多候选不得自动改写；无候选用**全文比对**证明零改动。
- **C. 重复执行不得产生副作用累积**：全库命名/清理/断链各跑两遍——第二遍必须"**不弹预览、不弹确认**"（比"文件名不变"更强的等价断言），且不产生 `(1)` 兜底名。
- **D. 收集口径一致（单篇 ↔ 全库）**：共享附件不被「收集当前笔记附件」移动，且如实告知跳过数。
- **跨笔记引用保护**：单篇改名/移动后，其它笔记对该附件的引用（含 **HTML 标签**写法——Obsidian 的改名联动不认识它）不得出现新断链。

### 3.3 report-accuracy.test.ts — 报告准确性（8 例）

一致性报告要"不缺不滥"，否则用户不再信任它。

- **不误报**：围栏代码块内的假引用、行内代码、跨章节锚点 `#sec`、外部 http、**HTML 注释**（含跨行注释）。
- **不漏报**：真断链、无扩展名 wiki 断链、canvas 缺失目标。
- **不误报**：URL 编码引用（能解码命中真实文件）。

### 3.4 scale.test.ts — 规模基线（1 例）

以 200 条目 / 60 笔记 / 180 附件为夹具，记录索引构建、一致性审计、全库命名首遍与第二遍的耗时，
并硬断言"第二遍不弹预览（幂等）"。用于发现"随规模放大而爆炸"的实现（曾用它定位到一个
`O(笔记数 × 条目数)` 的规划路径与一处**测试助手复用上一轮弹窗回调**导致的假性 84 秒）。

### 3.5 acceptance.test.ts + seed-acceptance.test.ts — 验收库全量（82 用例）

- `acceptance-fixture.ts` 是**用例的单一事实来源**：82 条用例的 id / 类别 / 载体 / 预期，以及
  验收设置与库结构生成函数。
- `seed-acceptance.test.ts` 把用例库落成**真实验收库文件**（本地生成、不入版本控制；含 `.obsidian`
  配置、插件投放、`EXPECTED.md` 预期清单）。**幂等**——重跑等于"恢复到干净初始态"，这是破坏性验收的回滚保证。
- `acceptance.test.ts` 把同一用例库生成到 **`os.tmpdir()` 的临时副本**（绝不动真实验收库原件），
  依次执行 4 个当前笔记级命令 ×4 篇宿主笔记 + 全部 13 条命令，再用**语义不变式**断言（见下），
  最后整轮二跑验幂等。

断言用 **11 条全局不变式**而不是写死路径（写死路径会被"合法但不同的中间态"大量误报，也证明不了要紧性质）；
另有**用例级机器校验**（`ACCEPTANCE_ASSERTS`，当前 **43/82** 条）把"预期"真正执行起来，并打印未校验条数。
目录布局 6 / 幂等 6 / 路径 1 于 2026-09-29 补齐（此前这四类**整类为零**）；
`X01`/`X02`/`P02` **故意不设**机器校验，理由逐条写在断言表开头的注释里（不写恒真断言充数）：
非受管文件不得被改名/删除 · 排除目录整块不动 · **每篇笔记"可解析引用数"不得减少（无新断链）** ·
仅 canvas / 仅 frontmatter 引用的附件不得消失 · 被引用附件必须存在 · 应本地化笔记不再含外链地址 ·
保形改写（HTML 标签不变成 `![](`、普通链接不变成图片嵌入）· 命名生效 · 真孤儿被清理且 zip 已生成 ·
空目录矩阵（该清的 3 个清掉、含隐藏文件的 1 个保留）。

> 说明：E2E 每次在 `os.tmpdir()` 新建临时仓（`mkdtempSync`），`afterAll` 清理。**不会动真实验收库目录**；
> 唯一会写它的是 `seed-acceptance.test.ts`（它是"生成器"，幂等且可重建）。

---

## 4. 支撑文件说明

### 4.1 `e2e/infrastructure.ts`

提供构建测试环境的底层工具与 Obsidian mock：

- **工具函数**：`vaultAbs`、`normalizeLocal`、`listVaultFiles`（排除 `.obsidian`/`.trash`）、`listVaultFolders`、`resetVault`（清空保留 `.obsidian`）、`writeText`/`writeBinary`、`tinyImage`/`tinyPdf`/`tinyMp3`（最小合法文件头）。
- **`createObsidianModule()`**：构造 Export 形态的 `obsidian` mock —— `Plugin/TFile/TFolder/Notice/Modal/ButtonComponent/Setting/PluginSettingTab/normalizePath/requestUrl` 及 `_registry`（收集 commands / notices / modals / ctaClickCallbacks）。
- **`buildTestApp(vaultRoot, obsidian)`**：以真实 fs 为后端组装 `app`（`vault.adapter/getFiles/read/createBinary/...`、`metadataCache.resolvedLinks`、`workspace.getActiveFile`、`fileManager.renameFile`），返回 `TestAppHandle`（`open/emitRename/emitChange/emitChanged/emitPaste/getCommands`）用于驱动插件事件。

> **保真度注意（四条，都影响结论可信度）**：
> 1. `fileManager.renameFile` 按真实 Obsidian 语义实现——**改名/移动后全库联动改写引用**，
>    但**只认 Obsidian 认识的那几种写法**（markdown 链接/嵌入、wiki 链接、frontmatter 属性），
>    与真实宿主一致地**不认识 HTML 媒体标签**（`<img src>` / `<audio src>` …）。
>    若只做文件移动，会出现"改名让别的笔记变坏"这类**假阳性**；
>    反之若连 HTML 标签也替插件改写，就等于把"插件自己有没有处理 HTML 引用"这个
>    最关键的守卫点替插件做了（插件不作为时用例照样绿）。
>    故这里先把 HTML 标签换成哨兵再调改写器——见 `infrastructure.ts` 的 `renameFile` 注释，
>    以及 `safety-suite` 的「当前笔记的 HTML 引用」用例（该用例已用变体测试确认会红）。
>    同理**也不认识 canvas 的 `file` 字段**（`rewrite()` 不解析 JSON）——插件必须自己处理，
>    否则「收集 → 命名 → 清理」会把 canvas 引用的附件整条吃掉（该缺陷已修，见
>    `safety-suite` E 组与验收套件的 canvas 不变式）。
> 2. `metadataCache.resolvedLinks` 按 **basename** 解析，比真实 Obsidian（markdown 路径式链接按路径解析）
>    **宽松**，因此 E2E 对断链类的结论偏乐观；该差异由真实 Obsidian 那一遍验收兜底（见 5.4）。
> 3. 库级配置（`vault.getConfig`）**必须由用例显式注入**（`buildTestApp(root, obsidian, { vaultConfig })`）。
>    默认 `{}` 表示"所有键都未配置"，与真实 Obsidian 未配置时一致。
>    **不要**再给单个键硬编码假值：早期替身把 `attachmentFolderPath` 恒写成空串，导致
>    `attachmentFolderMode: 'obsidian'`（默认模式）永远只走"回退到自定义目录"这一条分支，
>    "默认配置下附件落在库根还是 `./assets`"从未被验证。现在该模式由 `vault-config.test.ts` 逐格覆盖。
> 4. 「磁盘/权限类失败」不会自然发生，需要用例**主动构造**（替换 `vault.createBinary` 等使其抛错）。
>    失败可见性契约见 `notify-contract.test.ts`。注意真实 `new Notice(message, duration)` **没有 level 概念**，
>    分级只体现在"发不发"，故断言的是"静默档下有没有出现提示"，不要给替身发明 level 字段。

### 4.2 `e2e/fixture.ts`

- **`TEST_SETTINGS`**：插件默认测试配置（命名/本地化/一致性/清理/导出/自动化/路径）。
- **`seedFixture(vaultRoot, httpBase)`**：铺设覆盖全部功能的真实数据——NoteA（wiki/markdown 图/外链/data 图/坏链接/frontmatter）、NoteB、`AAA/move-note`、孤儿、各类附件样例，并写 `data.json`。
- **`listVault`**：返回可读的库内文件清单。

### 4.3 `mocks/obsidian-stub.ts`

把 bare specifier `obsidian` 在测试期解析到一个**真实 fs 后端**的共享单例（`globalThis.__OBSIDIAN_TEST`），并导出运行所需的符号。由 `vitest.config.ts` 的 `resolve.alias` 映射：

```ts
obsidian: fileURLToPath(new URL('./tests/mocks/obsidian-stub.ts', import.meta.url))
```

`requestUrl` 用 Node 原生 `fetch` 顶替（Node 不强制 CORS），`htmlToMarkdown` 为极简实现（抽取 `<img alt src>` 供 paste 检测）。

---

## 5. 运行与使用

### 5.1 运行自动化测试

```powershell
cd "D:\Trae\obsidian-attachment\Attachment Suite"
npm test              # 单次全量运行（含单元 + E2E）
npm run test:watch    # 监视模式，改代码自动重跑
npm run typecheck     # TypeScript 严格模式检查
```

> 说明：`npm test` 包含写 npm 缓存导致的沙箱限制时，可切到非沙箱执行（命令需访问 npm 缓存目录）。

> 说明：`tsconfig.json` 的 `include` 已纳入 `tests/**/*.ts` 与 `vitest.config.ts`，因此 `npm run typecheck` **同时检查源码与测试代码**。新增/修改测试时字段名写错会被立即发现；若测试需要新增对 mock 的接口调用，请同步在 `tests/e2e/infrastructure.ts` 的 `ObsidianModule` / `TestAppHandle` 接口中补上对应成员。

### 5.2 生成验收用例库（本地生成，不入版本控制）

```powershell
npx vitest run tests/e2e/seed-acceptance.test.ts
```

生成 82 条用例的真实文件 + `.obsidian` 配置（含 `attachmentFolderPath: "./assets"`）+ 插件投放 +
`EXPECTED.md` 预期清单。**幂等**：重跑即"恢复到干净初始态"，这是破坏性验收的回滚保证。
需要先 `npm run build`（生成器会顺手把 `dist/attachment-suite/` 投放进验收库；没构建也不报错，只提示）。

### 5.3 全量验收（harness 版，可进 CI）

```powershell
npx vitest run tests/e2e/acceptance.test.ts
```

把同一用例库生成到**临时库**，跑 4 个当前笔记级命令 + 全部 13 条命令 × 收敛轮次，按 11 条语义不变式 + 用例级机器校验断言。
新增用例只需改 `acceptance-fixture.ts` 一处，harness 与真实 Obsidian 两条路径同时生效。

### 5.4 全量验收（真实 Obsidian，CDP 驱动）

**先完全退出 Obsidian**（含托盘），然后直接跑脚本——它会自己以子进程方式拉起宿主并带调试端口：

```powershell
npx vitest run tests/e2e/seed-acceptance.test.ts   # ① 重置验收库到干净初始态（并投放最新插件）
node scripts/obsidian-cdp-acceptance.mjs           # ② 跑验收（约 50 秒）
```

**启动哨兵**（`--startup-check`）：验证**打开库不会静默批量改写**（覆盖审计里的 X02）。

插件唯一一条"不经同意就批量改写整库"的路径就是自动处理（`runAutoProcess` 内部走
`confirm=false` 的命名，**不弹确认框**），而它的入口是"启动期 Obsidian 对全库批量触发
`metadataCache.changed`"。该阶段的做法是：**启动前**记录全库 `.md`/`.canvas` 的内容基线并放一个
"哨兵附件"（名字不合规，一旦被处理就会改名/搬走）；带 automation 打开库后**全程不触碰任何东西**，
等过"就绪兜底 + 余震窗口 + 两轮轮询"，再逐篇比对——任何一篇被改写都算失败。

```
node scripts/obsidian-cdp-acceptance.mjs --startup-check --automation
```

它会报出插件自己的诊断计数（`getAutomationDiagnostics()`）：**启动期被就绪门挡下多少个 changed**
（0 不代表门没用，只代表本次宿主没触发；本机实测为 48~50 个）、就绪信号来源
（`metadataCache.resolved` 还是兜底超时）、批量护栏拒绝次数。

> 实测对照（干净库、全程不做任何操作）：完整实现 = **0 篇改写**；只关就绪门 = 0 篇但**护栏拒绝 1 次**；
> 就绪门与护栏都关 = **31 篇被改写、哨兵附件被搬走**。这就是这道哨兵非空洞的证明。

**配置变体**（`--variant`）：验收库自带的是"自定义 `./assets`"这一套配置，
而插件的**默认模式**是跟随 Obsidian（`attachmentFolderPath` 默认 `'/'` ＝ **库根**）。
两者落盘位置完全不同，故都要跑：

```powershell
node scripts/obsidian-cdp-acceptance.mjs --variant obsidian-root   # 默认模式：附件应落库根
```

变体纪律：**只改要验的那一个轴**（脚本在验收库自带配置上只改 `attachmentFolderMode`，
并额外把 `attachmentFolderPath` 设为 `'/'`）。手写一份"精简配置"会让其余字段落到默认值，
从而引出几十条与本变体无关的假红。跑变体前必须重新 seed——
库里残留的 `notes/assets` 会让"默认配置下不该出现 notes/assets"误报，脚本会当场拒绝启动。

> ⚠️ 启动方式不能换：`cmd /c start` 或 `Start-Process` 拉起的实例会在十几秒后被回收（端口开一瞬即关）。
> 请用已提交的启动器 `scripts/launch-obsidian-debug.cmd [vault] [port]`
> （默认库路径由脚本决定，默认端口 9222）。脚本特意**不用 detached**，让宿主作为自己的
> 子进程存活；代价是**必须先退出已有实例**，否则新进程被单实例逻辑吸收、永不开调试端口。

脚本会：按 `basePath` 精确挑中验收库窗口（多窗口时不会连错）→ **前置校验索引与磁盘一致** →
启用插件 → 执行 4 个当前笔记级命令 + 全部 13 条命令 → **逐轮检查不变式并跑到收敛** →
报告落验收库旁的 `acceptance-reports/`（JSON + Markdown；脚本会打印绝对路径）。

**看宿主控制台**（排查"为什么会失败"时最有用的一步）：

```powershell
# 三条命令都省略 --vault：默认就用生成器建好的那个验收库（想换库再加 --vault <路径>）
node scripts/obsidian-cdp-trace.mjs --passes 1 --console-only
node scripts/obsidian-cdp-trace.mjs --console-only --filter "失败|EXCEPTION|NOTICE"
# 更详细的过程输出：先经命令打开插件内的「切换诊断日志（排查用）」，再复现
node scripts/obsidian-cdp-trace.mjs --debug --console-only --filter "索引|计划|移动|失败"
# 最小复现（只跑当前笔记级命令，压掉无关变量）
node scripts/obsidian-cdp-trace.mjs --note-only --notes "notes/01-正文图片.md" --debug
```

常用开关：`--debug`（经命令打开诊断日志，走的就是用户那条路径；脚本会**回读** `settings.debugLogging`，
必要时补切一次，故**可重复运行**——否则第二次会把上一轮打开的那道开关又关掉）、`--step-delay <ms>`
（每条命令后的等待，默认 500；判别"到底是节奏问题还是逻辑问题"时把它放大）、
`--note-only`（只跑当前笔记级命令）。

> ⚠️ **必须知道**：命令的 `run()` 在**打开确认弹窗后**就返回了，真正的移动/改名发生在弹窗回调里
> （脚本点完"确认"之后仍在后台跑）。所以过短的等待会让下一步在"上一步还没做完"时开始。

它逐条命令驱动真实宿主，并采集**三条通道**：`Runtime.consoleAPICalled`（插件 `[IAP]` 日志与
Obsidian 本体输出）、`Runtime.exceptionThrown`（未捕获异常 / 未处理的 reject）、
`Log.entryAdded`（浏览器级错误）；外加 `.notice` 元素的 DOM 观察器——**插件的失败提示走 Notice
而不是 console**，不观察 DOM 就会漏掉"命令报错了"这件事。完整时间线落
**验收报告目录**下的 `obsidian-console-<时间戳>.log`（脚本会打印绝对路径）。

它同时启动与验收脚本**同一份**本地 HTTP 服务（`scripts/lib/acceptance-http-server.mjs`，
默认端口 45999），外链用例才能真的下载成功。**判读要点**：控制台里出现下列 warning
是**预期的负向用例**，不是缺陷——`跳过非受管附件类型（.txt）不落盘`、
`跳过网页文档（不落存 HTML）`、`下载失败：…:1/blocked.png（net::ERR_UNSAFE_PORT）`。
除此之外若出现 `下载失败`，先看是不是端口被占（脚本会打印"本地服务未启动"的告警）；
**唯一不应该出现的是成片的 `ERR_CONNECTION_REFUSED`**——那说明服务没起来。

> 局限：命令是异步的，脚本只等固定时长就切窗口，某条命令末尾的日志可能落到下一步的窗口里。
> 跨步骤定位时以日志内容为准，不要以它落在哪一步为准。


**四条只有真实宿主才会遇到、务必知道的事**（都已在脚本里处理）：

| 事实 | 为什么重要 |
| --- | --- |
| 命令 id 被插件前缀化成 `attachment-suite:attachment:<name>` | 按源码 id 调 `executeCommandById` **静默失败**：日志像"全跑完了"，实际一个文件没动。脚本按后缀从运行中的实例动态解析 |
| Obsidian 原生「更新链接？」弹窗（`总是更新`/`仅此一次`/`不做更新`） | 「自动更新内部链接」默认关闭时，每次改名都弹它，会**打断批量改名**；用户点「不做更新」则那次改名不改引用。脚本点 `总是更新`；验收库 `app.json` 也写了 `alwaysUpdateLinks: true` |
| 库索引可能滞后于磁盘（外部批量重写后出现**幽灵条目**） | 索引里有磁盘上已不存在的文件时，整轮结论都建立在假数据上。脚本前置校验"索引文件数 === 磁盘文件数"，不一致直接拒绝运行 |
| 一轮跑完不等于稳定 | 「收集」排在「重命名」之前：本轮命名出的文件要等下一轮收集才落位。**幂等的正确表述是"有限轮内收敛"**，脚本默认最多 6 轮并报告收敛轮数 |

为什么必须人工启动：在部分自动化宿主里，由其启动的 GUI 进程会立刻崩溃退出
（退出码 `0x80000003`），与启动方式无关；而人工启动的实例完全正常。这是**环境限制**，不是插件问题。

> 覆盖规模参考：13 条命令 × 收敛轮次、82 条用例（43 条已机器校验），最近一次 harness 版结果为 **0 问题**。

### 5.5 运行测试文件子集

```powershell
npx vitest run tests/unit/core
npx vitest run tests/e2e/real-suite.test.ts
npx vitest run -t "本地化"            # 按测试名过滤
```

---

## 6. 全库命令使用指南

插件新增两条**全库级**命令，用于一次性批量处理存量附件（区别于「当前笔记」命令的精确处理，以及自动化对"已变更单篇笔记"的处理）。二者在命令面板中可用「全库」等中文关键词搜索。

| 命令 | 用途 | 说明 |
| --- | --- | --- |
| `重命名全库附件` | 批量整理存量附件命名 | 按「笔记名_类别_序号」重命名全库所有被引用附件 |
| `本地化全库附件` | 批量下载存量外链 | 把全库 markdown 笔记的 http/data 外链下载到本地并改写为本地引用 |

### 6.1 全库统一命名（`attachment:bulk-rename`）

- **处理范围**：遍历 `md + canvas`（canvas 也会引用附件）；`paths.exclude` 目录内的笔记会跳过。
- **命名归属**：每个被引用附件按其归属笔记生成 `<笔记名>_<类别>_<序号>`。
- **共享附件**（被多篇笔记引用）：为**每篇引用笔记各复制一份**副本并各自命名，**原共享文件保留**。这是复用 `runRenameNote` 内置的 P0-3 复制逻辑得到的语义。
- **幂等**：已符合当前命名方案的附件会自动跳过（依赖 `checkAlreadyRenamed`）。
- **预览**：量小时逐条列出 `from → to`；量大时按笔记折叠为「笔记 → N 个附件」，确认后可核对。

### 6.2 全库本地化（`attachment:bulk-localize`）

- **处理范围**：仅遍历 `md`（canvas 的外链是 JSON `url` 节点，`findExternalRefs` 抓不到）；排除目录内的笔记不处理。
- **去重**：同一外链按内容 MD5 命名，全库多个笔记引用同一图片时**仅落盘一份**，所有笔记链接都改写指向它。
- **耗时**：可能触发大量网络下载，执行前弹窗会提示"量大会耗时"；结果汇总展示 下载/跳过/失败 计数。失败/跳过受下载超时、大小上限、类别白名单（SVG 永不本地化）影响。
- **执行前可核对**：预览弹窗除「笔记 → N 个外链」外，另列出**将被拦截的每一条引用**（原因 · URL → 来源笔记），点击某条即**定位到笔记中的该引用**；若所有外链都被拦截，则打开只读清单说明原因（而非误报"没有可本地化的引用"）。

### 6.3 测试覆盖（E2E 第 14/15 组）

- **14. 全库统一命名**：验证独占附件各生成 `note_image_001`、共享附件为每篇各生成含各自笔记名的副本且原文件保留、每篇正文链接各自改写到自己的副本。
- **15. 全库本地化**：验证同一外链在多个笔记中唯一落盘（两篇指向同一 MD5）、排除目录笔记仍保留外链。

> 补充：由于 Obsidian stub 的 `app.vault` 未暴露 `getMarkdownFiles()`，全库命令的笔记遍历使用 `getFiles().filter(f => f.extension === 'md'/'canvas')`，与真实 Obsidian 行为一致的同时兼容测试环境。

---

## 7. 维护指南

### 7.1 新增测试的放置规范

| 被测对象 | 放置位置 | 说明 |
| --- | --- | --- |
| `src/core/*` 纯逻辑 | `tests/unit/core/` | 零依赖、可直接 import |
| `src/features/*-core` 纯计算 | `tests/unit/features/<name>-core.test.ts` | 与 `*-core.ts` 命名对应 |
| `src` 顶层纯逻辑（notify / settings-migration） | `tests/unit/` 根 | 2 层导入深度 |
| 执行层（依赖 Obsidian） | `tests/integration/` | 使用 obsidian mock（当前预留） |
| 端到端全流程 | `tests/e2e/` | **按风险主题选套件**：功能进 `real-suite`；"删错/改错就回不来"的路径进 `safety-suite`；报告准确性进 `report-accuracy`；性能与规模进 `scale`；用例矩阵进 `acceptance-fixture` |

选套件的判断标准：**这条断言是为了"功能对不对"还是"损失会不会发生"？** 后者一律进 `safety-suite`，
因为它是唯一一类"测试没覆盖到就等于把用户数据交出去"的风险。

### 7.2 命名与约定

- 单元测试文件命名紧跟被测文件：`foo-core.test.ts` → `src/features/foo-core.ts`。
- 依赖方向 `infra ← core ← features`，禁止跨功能互相调用；测试同样不越层。
- E2E 测试**不得直接读写真实验收库**，必须新建临时仓（`mkdtempSync`）并在 `afterAll` 清理；
  **唯一例外**是 `seed-acceptance.test.ts`（它是"生成器"，只写验收库，幂等且可重建）。
- 新增能力（P0/P1/P2）时，先在对应 `*-core` 补单元测试，再在 `real-suite.test.ts` 按组追加 E2E 用例。
- **口径不变式（本仓库最值钱的一条经验）**：*插件自己会写出什么引用形态，"在用"保护层与解析层就必须认什么。*
  历史上三次误删级缺陷全部出自"两层口径不一致"——断链判定层认某形态（无扩展名短名、`%20`、含空格路径），
  而保护层不认。新增任何引用读写能力时，必须两处同时检查，并在 `attachment-index.test.ts` 或
  `safety-suite.test.ts` 留下钉子。

### 7.3 常见注意点

- **Obsidian stub** 是“内存替身”，只 mock 插件用到的 API 表面；新增 API 调用时需同步扩展 `infrastructure.ts` 的 `app`/`createObsidianModule`。
- **替身要区分"库索引视角"与"文件系统视角"**：`getFiles()`/`getAllLoadedFiles()` 隐藏点文件与点目录
  （与 Obsidian 一致），而 `adapter.exists`/`adapter.list` 是文件系统视角、**看得见点文件**。
  这两者混同会让"只含 `.DS_Store` 的目录"这类缺陷在 E2E 里隐形（真实 Obsidian 会把它当空目录删掉）。
- **`resolvedLinks` 要按真实口径给**：只有 markdown/wiki 链接会被 Obsidian 解析，HTML 媒体标签
  （`<audio src>` 等）**不会**。用它写测试时若把 HTML 引用也放进 `resolvedLinks`，就复现不出
  "两套口径未合并"导致的共享误判。参见 `attachment-index.test.ts` 里"HTML 媒体标签引用的笔记
  不得被 resolvedLinks 挤掉"。
- **链接解析用"整体捕获 + 后处理"，不要按空白截断目标**：`![x](a b.png)` 这类含空格的目标若被
  `[^)\s]+` 截断，扩展名会丢失，引用就此"隐身" → 「清理未用」会删掉它指向的附件。
  正确做法是捕获括号内全部内容，再剥离 `<...>` 与 ` "标题"`，并做 `%xx` 解码/编码。
  同类风险还有：替换时用**函数式**替换（新目标含 `$&`/`$1` 时字符串替换会展开成替换模式而改坏正文）。
- **E2E 事件驱动**依赖 `TestAppHandle.emitXxx`。自动化由**定时轮询**驱动：`onVaultFileChange`/`onPaste` 仅把笔记标记为"脏"，由 `startAutomationSweep` 按 `automation.interval` 秒（`TEST_SETTINGS` 为 1s）轮询批量处理；索引失效另用 300ms 去抖（`scheduleDirty`）。测试用固定 `setTimeout`（如 2200/1600ms）等待一个以上的轮询周期，改动轮询间隔/去抖时长需同步调整这些等待。
- **夹具数据**集中维护在 `fixture.ts`，多处用例复用；增删夹具会影响依赖它的用例断言（如孤儿数量、坏链接列表）。

### 7.4 测试基建的硬规则（改替身 / 加守卫 / 写新入口前必读）

这一节是从历次真实缺陷里反推出来的。每一条都对应一类**曾经真的漏掉过**的问题，
不是风格偏好——违反它，缺陷就会在 CI 里隐身。

#### 7.4.1 替身保真度

每多兜一层，就有一类真实缺陷在 CI 隐身；反过来，少兜一层，**缺陷就无法被测试发现**。

| 替身部件 | 必须做到 | 不这么做会怎样 |
| --- | --- | --- |
| `fileManager.renameFile` | 按真实语义**联动改写引用**，但只认 Obsidian 写法（md / wiki / frontmatter）；**不得建目标父目录**（缺目录即 `ENOENT`）；**绝不能**复用插件自己的 `rewrite()` | 复用插件实现＝自我验证；不报 ENOENT＝掩盖"必须先 `ensureFolder`"这类真实失败 |
| `trash(f, system)` | **必须区分 `system`**：`false` → 库内 `.trash/`；`true` → **库外**目录。同名追加 `(N)` 而不覆盖 | 混为一谈＝"永久删除"与"回收站"的用例失去意义 |
| `Plugin` 生命周期 | `register` / `registerEvent` 非空、`on()` 返 `EventRef`、`runPluginCleanups()` 真实执行 | "事件与定时器是否交给宿主托管"变成不可验证 |
| 编辑器定位 | `setCursor` / `scrollIntoView` 必须**记录调用**（`handle.editorCalls`） | 空实现会让"只打开了文件、没有定位到引用"照样全绿（**打开 ≠ 定位**） |
| `resolvedLinks` | 按 basename 解析，且**只放 Obsidian 会解析的引用**（HTML 媒体标签不进） | 比真实宿主宽松＝复现不出"两套口径未合并"的共享误判 |
| `getConfig` | 只暴露显式注入的 `vaultConfig` | 硬编码假值会掩盖"读不到配置时的回退"分支 |
| `Setting.add*` | 按真实语义回调；`FakeEl.querySelectorAll` 支持 `.cls` / `cls` / 逗号分隔 | 选择器查不到控件，断言静默失效 |
| `Setting` 的 toggle / dropdown / slider | `trigger(v)` 必须**先把 `comp.value` 写成 v、再调回调**（真实控件在回调触发前自身状态已变） | **插件不回写控件**这类缺陷（界面显示值 ≠ 实际生效值）在测试里**不可能被发现**——断言停在旧值上照样绿 |
| `Menu` | `addItem` 真的保存 `onClick` | "菜单项挂上了、点了没反应"照样全绿 |
| `Element.remove()` | 必须**真的从父节点摘除** | 空实现时 `querySelectorAll` 仍找得到它 → "选中候选后『先选一个』提示应消失"这类断言**假通过** |
| `ButtonComponent.setDisabled` | 置位后**点击不得触发回调**（`trigger()` 也走同一判定） | 只记 `disabled` 而不拦点击 = "实现里按钮是灰的、测试却照样把它点响了"，**置灰这件事等于没测** |
| `Vault.create(path, text)`（文本写入） | 必须有；同名抛错，与真实语义一致 | 替身只实现过 `createBinary` → 弹窗「导出 .md 报告」整条路径在测试里抛 `not a function` 被 catch 成"失败"，**成功分支从来跑不到**（第 ③ 级不可达） |
| 网络 | **不得依赖公网**：自建本地 HTTP（`scripts/lib/acceptance-http-server.mjs`）；本地化用例优先 data URI | 外链用例随网络抖动，且在 CI 里静默跳过 |

#### 7.4.2 新增守卫必须做变体测试

把被保护的行为**改坏一次** → 确认用例**真的转红** → 还原（`git status` 确认无残留）。
不做这一步，就无法排除"守卫空转"。

**实测教训**：`toContain('xxx.mjs')` 这类断言会被**说明性注释里出现的同一个串**喂饱——
把导入整行删掉，断言照样全绿（第 ① 级"断言恒真"）。必须**先剥注释再断言**
（见 `acceptance-tooling.test.ts` 的 `codeOnly` 写法）。

#### 7.4.3 "没覆盖"分三级，严重度递增

| 级别 | 表现 | 危险程度 |
| --- | --- | --- |
| ① | 有断言，但恒真（被注释/宽松匹配喂饱） | 中——看起来像被覆盖 |
| ② | 无断言，只受全局不变式保护 | 较高——改坏了不会红 |
| ③ | **代码路径在测试里不可达**（被 `isTestEnv` 之类的环境开关关掉） | **最高**——连"改坏了会红"都没有，却极易被当成已覆盖 |

X02 曾属第 ③ 级（已修复并做过变体验证）。**新增"时序 / 环境相关"的守卫时，先问一句：
它在测试里跑得到吗？**

#### 7.4.4 夹具前提必须与 `expect` 对得上

多次抓到"用例假设的条件其实不成立"：以为 0 字节实际非空、以为被共享实际无人引用、
**两篇笔记的附件写成同一路径**→ 索引按 basename 判成"被多篇共用" → 收集按设计跳过并报
`skippedShared:1`，用例却预期它被移动。**对称夹具最容易踩这个——要故意用不同的文件名。**

**"附件没被删"只能用内容指纹判定**（`hasContent(fingerprintBefore(...))`）：
附件会改名/移动，按原路径判断只会得到假红。

#### 7.4.5 真实宿主（CDP）专属

1. 命令的**真实 id 带插件前缀**——按源码里的 id 调用会**静默失败**（不报错、也不执行）。
2. 原生「更新链接？」弹窗会打断批量改名。
3. 外部重写库之后 Obsidian 索引会滞后（幽灵条目）→ 需要 `app:reload`。
4. 讨论"幂等"时的正确表述是**有限轮内收敛**，不是"第二轮就没变化"。
5. 宿主实例必须**由脚本自己以子进程拉起**（shell `start` 拉起的十几秒后被回收），
   且**先完全退出 Obsidian**。迭代：`seed-acceptance` → `app:reload` → 重载插件
   （`disablePlugin` + `enablePlugin`）→ 跑脚本，**无需重启宿主**。
6. `--variant` 有一条前提守卫：库里已存在 `notes/assets` 即拒绝启动。
   **变体纪律：一次只改要验的那一个轴**——手写精简配置会让其余字段落默认值
   （默认 `blockPrivateHosts=true` 会拦本地回环），一次炸出几十条无关断言。

#### 7.4.6 别让测试自己制造噪声或抖动

- 两个 CDP 脚本**共用** `scripts/lib/acceptance-http-server.mjs`（外链用例的**被测目标**）。
  追踪脚本曾漏起它，于是每轮宿主控制台都打印 4 条假的"下载失败"——
  **诊断工具自己制造的假失败**会把人带去追不存在的缺陷。守卫见 `acceptance-tooling.test.ts`
  （两侧必须导入共享模块、**不得内联 `createServer`**）；端口被占时**只告警不中断**（环境问题≠插件缺陷）。
  人工手动体验时也需要它：`node scripts/lib/acceptance-http-server.mjs [port，默认 45999]`。
- 控制台里这三条 warning 属**预期负向用例**，不是缺陷：`.txt` 非受管类型被白名单挡下、
  HTML 不落盘、故意指向不安全端口 `:1`。
- **单跑很快的用例在全量并发下可能超默认 5s 超时**。`defaults.test.ts` 的"13 条命令串行"用例
  单跑 0.8s、全量下曾超时判红 → 已显式给 30s。超时是资源竞争而非行为问题，
  **不要让它把主守卫变成随机报红源**。
- 修改命名规则（`checkAlreadyRenamed`、序列段格式）后，务必同步 `name-formatter-core.test.ts` 的幂等断言。