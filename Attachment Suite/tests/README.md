# Attachment Suite — 测试项说明与使用指导

本文档面向后期使用与维护，说明 `tests/` 目录结构、各测试文件覆盖的测试项清单，以及如何运行、扩展与维护测试。

- 测试框架：Vitest + TypeScript
- 运行命令：项目根（`Attachment Suite/`）下执行 `npm test`（单次运行）或 `npm run test:watch`（监视模式）
- 类型检查：`npm run typecheck`（`tsc --noEmit`，TypeScript 严格模式）
- 当前规模：**22 个测试文件，233 个测试用例，全部通过**

---

## 1. 目录结构清单

```
tests/
├── e2e/                          # 端到端“真实”集成测试
│   ├── real-suite.test.ts        # 全量真实套件：加载插件、驱动全部命令、校验真实落盘
│   ├── infrastructure.ts         # 测试基础设施：Obsidian API mock + TestApp + 夹具工具
│   └── fixture.ts                # 测试夹具：TEST_SETTINGS + seedFixture 铺设真实数据
├── integration/                  # 执行层集成测试（预留，当前仅 .gitkeep）
│   └── .gitkeep
├── mocks/
│   └── obsidian-stub.ts          # bare specifier `obsidian` 的运行时 mock（单例）
└── unit/                         # 纯逻辑单元测试（脱离 Obsidian 运行）
    ├── notify-core.test.ts       # src 顶层纯逻辑
    ├── settings-migration.test.ts
    ├── core/                     # 镜像 src/core（纯逻辑、零依赖）
    │   ├── attachment-index.test.ts
    │   ├── hasher.test.ts
    │   ├── link-resolver.test.ts
    │   ├── path-compatibility.test.ts
    │   ├── result.test.ts
    │   ├── safe-move.test.ts
    │   ├── task-queue.test.ts
    │   ├── type-classifier.test.ts
    │   └── zip.test.ts
    └── features/                 # 镜像 src/features/*-core（纯计算，可单测）
        ├── bulk-rename-core.test.ts
        ├── collect-core.test.ts
        ├── consistency-core.test.ts
        ├── empty-folder-core.test.ts
        ├── export-name-core.test.ts
        ├── link-fixer-core.test.ts
        ├── localize-media-core.test.ts
        ├── name-formatter-core.test.ts
        ├── note-relocator-core.test.ts
        └── unused-cleaner-core.test.ts
```

### 关键约定（导入路径深度）

| 目录 | 相对 `src` 深度 | 示例 |
| --- | --- | --- |
| `unit/core`、`unit/features` | 3 层 | `../../../src/core/...` |
| `unit/`（根） | 2 层 | `../../src/notify-core` |
| `e2e/` | 2 层，另走 Vite alias | `import('../../src/main')` |

> 注意：`e2e` 加载的是**源码** `src/main`（经 Vite + alias），与 esbuild 打包产物逻辑等价。若需验证真实构建产物 main.js，请在 Obsidian 中用 `for-test` 仓库实体运行（见第 5 节）。

---

## 2. 单元测试 — 测试项清单

单元测试全部为**纯逻辑**测试（不依赖 Obsidian 运行时），置于 `unit/` 下，镜像 `src/` 结构。

### 2.1 `unit/core` — 核心纯逻辑

| 文件 | 测试项 | 数量 |
| --- | --- | --- |
| [result.test.ts](core/result.test.ts) | `ok`/`err` 构造、`errFromUnknown` 归一化（Error/字符串/null/对象/数字回退）、自定义 fallbackMessage、`isRetryable` 分类 | 11 |
| [hasher.test.ts](core/hasher.test.ts) | MD5：空串/abc 标准向量、字节与字符串一致、长串稳定、空字节、多字节 UTF-8（中文/emoji）、跨 512 位分块边界（RFC 1321 权威向量） | 7 |
| [link-resolver.test.ts](core/link-resolver.test.ts) | 解析 markdown/wiki/md转包含 链接、`rewrite` 重写保留外壳/锚点/别名、空映射原样返回、普通链接改写、`sanitizeFilename` 防路径穿越、`rewriteFrontmatter` 改写（含单/双引号保留）、`listFrontmatterLinks` 提取资源 | 16 |
| [path-compatibility.test.ts](core/path-compatibility.test.ts) | `isViolation`（保留名/非法字符/尾随点空格/盘符/空名与点目录/字节与单元上限/非 Windows profile）、`repairName` 修复与按字节/单元截断、空扩展名（无 .ext）、控制字符、附件目录模板变量、`normalizeLocal` 解析 `.`/`..`、`resolveAttachmentDir` 根形式、`isPathExcluded` 排除路径 | 21 |
| [safe-move.test.ts](core/safe-move.test.ts) | SafeMoveEngine：目标占用自动避让（单级/多级编号/无扩展名）、无冲突直改、瞬时失败重试成功（P2-8）、持续失败抛错、`moveMany` 批量容错（单项失败记 errors） | 7 |
| [task-queue.test.ts](core/task-queue.test.ts) | 串行顺序、返回值、错误隔离、`isProcessing` 状态、`drain` 等待、取消令牌 | 6 |
| [type-classifier.test.ts](core/type-classifier.test.ts) | PNG/APNG/JPEG/GIF（静/动画）/BMP/WebP（静/动画）/AVIF/MP4/WebM/MP3/FLAC/WAV/OGG/docx/xlsx/pptx/普通 zip/HTML/纯文本、内容识别 + hintPath 回退与无效扩展名回退、空输入、`isCategory` | 21 |
| [zip.test.ts](core/zip.test.ts) | CRC-32 校验、生成含 manifest 的 zip、规范签名（local/central/EOCD）、空列表合法 EOCD | 4 |
| [attachment-index.test.ts](core/attachment-index.test.ts) | 索引构建（条目/孤儿/坏引用）、快照复用与 markDirty 重建、非托管文件不入条目、断链去重、resolvedLinks 缺失时短名防误删、唯一名短名合成引用、同 basename 多文件不冒险、frontmatter 引用不判孤儿（含 markdown 链接格式）、canvas file 引用（含坏 JSON/外链忽略）、frontmatter 断链、`getEntry` | 15 |

### 2.2 `unit/features` — 功能纯计算层（`*-core`）

| 文件 | 测试项 | 数量 |
| --- | --- | --- |
| [bulk-rename-core.test.ts](features/bulk-rename-core.test.ts) | `planBulkRename` 按归属笔记分组并生成真实 from→to、共享附件 `sharedCount` 计数（多篇引用计一份）且每篇各生成带各自笔记名的副本、同类别序号递增、folderByCategory 子目录、addTime/addPathHash 生效、已按方案命名的附件跳过（幂等）、未被引用附件不入计划、空快照空计划、带目录 sourcePath 的笔记名提取、canvas 笔记归属、frontmatter 类引用、同名笔记跨目录按路径区分、跨目录共享副本同源 | 14 |
| [collect-core.test.ts](features/collect-core.test.ts) | `planCollect` 收集散落附件规划、已在目标目录/非本笔记不收集、空目标目录语义（收集到库根） | 3 |
| [consistency-core.test.ts](features/consistency-core.test.ts) | 平台 profile、修复 Windows 保留名/尾随空格、合法名不列入、非 Windows 平台仅修通用违规、根目录文件规划、混合输入 | 8 |
| [empty-folder-core.test.ts](features/empty-folder-core.test.ts) | `planEmptyFolderCleanup` 只清叶子空目录、含文件/子目录不清理 | 2 |
| [export-name-core.test.ts](features/export-name-core.test.ts) | 扁平归档同名去重：原名/时间戳/序号兜底、`tsOf` 格式化、无扩展名冲突 | 5 |
| [link-fixer-core.test.ts](features/link-fixer-core.test.ts) | `refMapForMoves` 完整路径与 basename 映射、basename 跨目录同名不覆盖、rewrite 短名改写 | 3 |
| [localize-media-core.test.ts](features/localize-media-core.test.ts) | `findExternalRefs` 提取 http/data、忽略本地、扩展扫描（普通链接/HTML img/audio/video）、畸形百分号 URL 不抛错、`localLinkText`、`applyRefReplacements`（md/wiki）、MD5 命名、data URI 解码（base64/文本/畸形）、nameHint 回退、`localName` 路径穿越回退 MD5 | 19 |
| [name-formatter-core.test.ts](features/name-formatter-core.test.ts) | `buildName` 命名格式与 includeNoteName/honorCategory 开关、`namingParts` 补零、`formatTimestamp`、`checkAlreadyRenamed` 幂等（含时间/哈希段校验/两位序号/空连接符）、`planForSnapshot` 规划（showSubType/folderByCategory/已命名附件占用序号段接续编号不碰撞） | 17 |
| [note-relocator-core.test.ts](features/note-relocator-core.test.ts) | `resolveAttachmentDir` 归一化（`././assets` 回归）、跟随型判定、`attachmentTargetsFromText` 解析、`planRelocation` 旧→新与同目录跳过 | 5 |
| [unused-cleaner-core.test.ts](features/unused-cleaner-core.test.ts) | `shouldExclude` 精确/含子目录/尾随斜杠/根级文件、`planCleanup` 过滤排除目录 | 6 |

### 2.3 `unit/`（src 顶层纯逻辑）

| 文件 | 测试项 | 数量 |
| --- | --- | --- |
| [notify-core.test.ts](notify-core.test.ts) | `shouldNotify`：silent/summary/verbose 级别门控（error 恒提示）；`effectiveDuration`：分级基础时长（error 5s/summary 3s/info 2s）与长度自适应加长 | 7 |
| [settings-migration.test.ts](settings-migration.test.ts) | `migrateSettings`：默认回退、v0 扁平字段迁移（含嵌套保留）、丢弃未知字段、局部保留、版本一致跳过、附件目录来源（obsidian/custom）判定、数组字段整体覆盖 | 11 |

---

## 3. E2E 真实测试 — 测试项清单

E2E 在 `tests/e2e/real-suite.test.ts`，以**真实文件系统临时仓库**为后端，加载插件并**实体执行全部 11 条命令**，校验真实落盘与链接改写。共 **25 个用例**，分 16 组。

| 组 | 测试项 | 覆盖 |
| --- | --- | --- |
| 1. 插件加载与命令注册 | onload 不抛错且注册全部 11 条命令 | 命令面板注册 |
| 2. 一致性审计 | 正确汇总坏链接（2）与未用附件（4 个孤儿） | 审计报告目录 |
| 3. 统一命名 | 重命名当前笔记附件并同步改写正文与 frontmatter 引用 | `assets/NoteA_image_001/002` |
| 4. 媒体本地化 | ① 下载 http 与 data 引用、写盘并改写为本地引用 ② 对外部真实页面复制笔记执行（中文目录 + 真实 URL） | NoteA + `测试A/网页内容复制.md` |
| 5. 未用清理 | 确认后把未引用附件移入回收站，保留被引用附件 | `.trash` 核对 |
| 6. 导出当前笔记 | 生成 `NoteA_Attachments.zip` | PK 魔数 |
| 7. 导出未用附件 | 生成 `Unused_Attachments.zip` 且含孤儿 | PK 魔数 |
| 8. 笔记移动跟随 | 笔记跨目录移动时迁移相对型附件目录附件 | `AAA/assets` → `CCC/assets` |
| 9. 路径修复 | 在无非法路径的库上优雅无操作并提示 | 通知校验 |
| 10. 自动化 | 粘贴外链后自动下载并统一命名 | `Auto.md` |
| 11. P0 增强 | P0-1 粘贴事件触发本地化+命名 / P0-2 焦点切换不影响（显式路径）/ P0-3 共享附件复制副本再命名 | paste / changed / 共享 |
| 12. P1 增强 | P1-5 收集散落附件 / P1-6 按类型放入子目录 / P1-4 附件目录模板变量 | collect / folderByCategory / `${notename}` |
| 13. P2 增强 | P2-9 清理空附件目录（移入回收站，非空目录保留） | empty-dir |
| 14. 全库统一命名 | 批量命名全库独占与共享附件，共享附件为每篇各复制副本；folderByCategory 时共享附件在类别子目录下为每篇各复制副本；已命名附件占用序号段时新附件接续编号且重复运行幂等（不产生 `(1)`）；排除目录笔记的附件不被全库命名 | `bulk_rename`：`NoteX/NoteY_image_001/002`、`assets/image/` 子目录、`NoteZ_image_002`、`excluded/only-e.png` 保留 |
| 15. 全库本地化 | 全库下载外链：同一外链去重仅落一份 MD5，排除目录笔记不处理 | `bulk_localize`：外链 → 本地 MD5、`excluded/` 保留外链 |
| 16. 批量通知收敛 | 全库命名 60 篇与全库本地化 8 篇时仅产生一条汇总横幅，不逐篇刷屏 | `registry.notices` 数量校验 |

> 说明：E2E 每次在 `os.tmpdir()` 新建临时仓（`mkdtempSync`），`seedFixture` 用 `resetVault` 重建，运行后 `afterAll` 清理。**不会动真实 `for-test` 目录**。

---

## 4. 支撑文件说明

### 4.1 `e2e/infrastructure.ts`

提供构建测试环境的底层工具与 Obsidian mock：

- **工具函数**：`vaultAbs`、`normalizeLocal`、`listVaultFiles`（排除 `.obsidian`/`.trash`）、`listVaultFolders`、`resetVault`（清空保留 `.obsidian`）、`writeText`/`writeBinary`、`tinyImage`/`tinyPdf`/`tinyMp3`（最小合法文件头）。
- **`createObsidianModule()`**：构造 Export 形态的 `obsidian` mock —— `Plugin/TFile/TFolder/Notice/Modal/ButtonComponent/Setting/PluginSettingTab/normalizePath/requestUrl` 及 `_registry`（收集 commands / notices / modals / ctaClickCallbacks）。
- **`buildTestApp(vaultRoot, obsidian)`**：以真实 fs 为后端组装 `app`（`vault.adapter/getFiles/read/createBinary/...`、`metadataCache.resolvedLinks`、`workspace.getActiveFile`、`fileManager.renameFile`），返回 `TestAppHandle`（`open/emitRename/emitChange/emitChanged/emitPaste/getCommands`）用于驱动插件事件。

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

### 5.2 在真实 Obsidian 仓库（`for-test`）做全量验收

`for-test/` 是专门的真实测试库（git 忽略，见根 `.gitignore`），插件的安装目录为 `for-test/.obsidian/plugins/attachment-suite`。全量验收流程：

1. **生产构建**：`npm run build` → 产出完整安装包 `dist/attachment-suite/`（main.js + manifest.json + styles.css）。
2. **清空旧测试记录**：删除 `for-test` 下除 `.obsidian` 外的旧测试数据。
3. **部署插件**：`Copy-Item dist\attachment-suite for-test\.obsidian\plugins\ -Recurse -Force`。
4. **铺设干净夹具**：可复用 `seedFixture`（清空重铺 + 写 `data.json`）。
5. **用 Obsidian 打开 `for-test`** 手动触发各命令验证；Obsidian 缓存 main.js，改动后通常需禁用/启用插件或重启应用。

### 5.3 运行测试文件子集

```powershell
npx vitest run tests/unit/core
npx vitest run tests/e2e/real-suite.test.ts
npx vitest run -t "本地化"            # 按测试名过滤
```

---

## 6. 全库命令使用指南

插件新增两条**全库级**命令，用于一次性批量处理存量附件（区别于「当前笔记」命令的精确处理，以及自动化对"已变更单篇笔记"的处理）。二者在命令面板中分别可用「全库」「批量」等中文关键词搜索。

| 命令 | 用途 | 说明 |
| --- | --- | --- |
| `重命名全库附件（全库统一命名）` | 批量整理存量附件命名 | 按「笔记名_类别_序号」重命名全库所有被引用附件 |
| `本地化全库附件（全库批量下载外链媒体）` | 批量下载存量外链 | 把全库 markdown 笔记的 http/data 外链下载到本地并改写为本地引用 |

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
| 端到端全流程 | `tests/e2e/real-suite.test.ts` | 走真实 fs + 事件驱动 |

### 7.2 命名与约定

- 单元测试文件命名紧跟被测文件：`foo-core.test.ts` → `src/features/foo-core.ts`。
- 依赖方向 `infra ← core ← features`，禁止跨功能互相调用；测试同样不越层。
- E2E 测试**不得直接读写真实 `for-test`**，必须新建临时仓（`mkdtempSync`）并在 `afterAll` 清理，避免误删手写数据。
- 新增能力（P0/P1/P2）时，先在对应 `*-core` 补单元测试，再在 `real-suite.test.ts` 按组追加 E2E 用例。

### 7.3 常见注意点

- **Obsidian stub** 是“内存替身”，只 mock 插件用到的 API 表面；新增 API 调用时需同步扩展 `infrastructure.ts` 的 `app`/`createObsidianModule`。
- **E2E 事件驱动**依赖 `TestAppHandle.emitXxx`。自动化由**定时轮询**驱动：`onVaultFileChange`/`onPaste` 仅把笔记标记为"脏"，由 `startAutomationSweep` 按 `automation.interval` 秒（`TEST_SETTINGS` 为 1s）轮询批量处理；索引失效另用 300ms 去抖（`scheduleDirty`）。测试用固定 `setTimeout`（如 2200/1600ms）等待一个以上的轮询周期，改动轮询间隔/去抖时长需同步调整这些等待。
- **夹具数据**集中维护在 `fixture.ts`，多处用例复用；增删夹具会影响依赖它的用例断言（如孤儿数量、坏链接列表）。
- 修改命名规则（`checkAlreadyRenamed`、序列段格式）后，务必同步 `name-formatter-core.test.ts` 的幂等断言。