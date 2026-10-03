# Attachment Suite（附件套件）

> 一个面向 Obsidian 的附件全生命周期管理插件（桌面端）：**本地化**外部资源、**统一命名**、**审计与修复**一致性、**清理**未用附件、**一键导出**。

- 插件 ID：`attachment-suite`
- 当前版本：`1.0.0`
- 最低应用版本：`1.6.7`
- 平台：桌面端（`isDesktopOnly: true`）

---

## 目录

- [功能特性](#功能特性)
- [命令一览](#命令一览)
- [安装](#安装)
- [使用与设置](#使用与设置)
- [架构设计](#架构设计)
- [开发与测试](#开发与测试)
- [贡献指南](#贡献指南)
- [许可](#许可)

---

## 功能特性

### 1. 媒体本地化（Localize）
把笔记中的**外链图片 / 视频 / 音频 / PDF / 文档**下载到本地，并自动改写为本地引用，保证脱机可用。

- 支持 `http(s)` 外链与内嵌 `data:` 图片；覆盖正文的 markdown 图片 / 普通链接 / HTML 媒体标签，以及 **frontmatter 中的资源字段**（`cover:` 标量、列表形式等）
- **保持原语法改写**：普通链接改写后仍是链接、HTML 标签只替换 `src`（不会把 `<audio src=…>` 变成图片嵌入而破坏渲染）
- 落盘目标名含空格时按 `%20` 编码写入（裸空格在 markdown 里不是链接）
- **网页（HTML）永不落存**：识别为网页文档的引用会被跳过，避免把网页脚本存进库
- 不支持/不允许的格式会被安全跳过（如 SVG 这类存在 XSS 风险的文本格式）
- 按**内容 MD5 去重**：同一张图贴多次只保存一份（可关闭，关闭后保留原始文件名）
- 下载具备安全措施：**拦截本机/内网/保留地址**（默认开）、**域名黑白名单 + 仅白名单模式**、**下载前按声明的体积上限中止**（含 `data:` URI 的解码前预判）、**同主机限速与并发上限**、超时与有限重试
- **执行前可核对**：全库本地化会先弹出预览，**逐条列出将被拦截的引用**（原因 · URL → 来源笔记），点击某条可直接定位到笔记中的该处；若所有外链都被拦截，则打开只读清单说明原因
- **下载即命名**：「本地化当前笔记附件」下载成功后，若「命名」已开启，会自动接续统一命名（静默执行、不弹预览；全库本地化不做此接续）

### 2. 统一命名（Name）
把附件规范为「`笔记名_类别_序号`」的格式，便于整理与查找。

- 支持扩展字段：时间戳、路径哈希、类别 / 子类型
- **幂等**：对已按规则命名的附件自动跳过，不会重复处理
- 命名可配置连接符、是否携带类别等

### 3. 一致性（Consistency）
审计并修复全库的附件引用问题。

- **坏链接报告**：列出指向不存在文件的引用，并校验精确路径 / 文件名是否存在；覆盖 markdown 链接、wiki 嵌入、HTML 标签（`<img>/<audio>/<video>/<source>/<a>`）、frontmatter 与 canvas 节点，含无扩展名 wiki 附件引用（`[[pic]]`）；URL 编码（`%20`、中文 `%E4%B8%AD` 等任意百分号编码）先解码再判定，代码块/行内代码中的假链接不误报
- **修复断链**：分层候选式安全重链——唯一命中（精确 / 归一化 / URL 解码 / 相对路径解析）的自动改写，可弹预览确认；大小写差异、多候选、无同名候选（按名称相似度推荐）的弹候选选择窗由你逐条决定；无法处理的保持报告。覆盖正文 / frontmatter / canvas 的 `file` 节点与 HTML 属性
- **路径修复**：把 Windows 等平台的保留名、非法字符、超长文件名安全改名并自动更新引用。**默认只按当前系统判定**（在 macOS/Linux 上不会按 Windows 的保留名 / 盘符前缀规则批量改名；非法字符与超长文件名各平台一视同仁），可在设置里切换为全平台或指定单个平台
- **笔记移动跟随**：笔记移动时，把其相对目录（如 `./assets`）下的附件一并迁移并保持链接。**默认开启**——只对笔记相对型目录生效，而这类目录下不跟随就等于"移动笔记即断链"
- 以上三项与「检查库一致性」同受「一致性」总开关约束；关闭后都不执行
- 「检查库一致性」报告中的**未用附件与坏链接明细**会按**全局排除目录**过滤，并在汇总里注明跳过数量；「附件数 / 可修复路径」仍按全库统计（排除目录只影响展示层，索引与保护层不动）。

### 4. 清理未用（Cleanup）
扫描并删除没有任何笔记引用的未用附件，并支持清理空的附件目录。

- **防误删兜底**：即使 Obsidian 索引未就绪、短名引用未解析，也绝不误删仍被引用的附件
- 删除前**复检**引用，避免因快照延迟误删
- 排除目录过滤（含子目录开关；全局排除目录叠加生效）
- 三种删除方式：Obsidian 回收站 / 系统回收站 / 永久删除，默认回收站且删除前确认
- **清理空附件目录**：把不含任何文件的空目录（含删除后逐层变空的父目录）移入回收站；与「清理未用附件」同样受清理总开关、删除前确认与排除目录（含其各级子目录）约束

### 5. 导出（Export）
把当前笔记的附件或全部未用附件打包为 ZIP 并写入库内，附带 `manifest.json` 清单。

- 同名 ZIP 可重复导出（自动覆盖）
- 导出内容去重、扁平化归档
- 导出未用附件时跳过全局排除目录中的附件，并在通知中说明跳过数量
- **体积体检**：ZIP 在内存内一次性拼装，待打包内容超过 512 MB 时会先中止并提示（避免"点了导出 → Obsidian 卡死"），可先清理未用附件或分批导出

### 6. 收集（Collect）
把当前笔记引用但落在其它目录的散落附件，移入该笔记的归属附件目录，并自动更新引用。

- **共享附件不移动**：被多篇笔记共用的附件没有唯一归属，移动它会改变其它笔记的落点，因此一律跳过并如实告知跳过数量（与「收集全库附件」同口径）

### 7. 批量处理（Bulk）
提供三条全库级命令，一次性处理存量附件：

- **重命名全库附件**：按「笔记名_类别_序号」批量命名全库被引用附件；被多篇笔记共用的附件为每篇复制副本并各自更新链接
- **本地化全库附件**：批量扫描全库 markdown 笔记，把 http/data 外链下载到本地并改写为本地引用；同一外链按内容 MD5 去重仅落盘一份
- **收集全库附件**：把全库被引用但散落在其它目录的附件，移入各笔记的归属附件目录，并自动更新引用

### 8. 自动化（Automation）
编辑中的笔记一旦出现外链图片或新的附件，自动执行本地化与统一命名（默认开启，按发生变更的笔记处理、不依赖当前焦点，焦点切换不影响；处理时从磁盘读取笔记正文）。

---

## 命令一览

所有命令均可在命令面板中按中文关键词搜索（如「清理」「附件」「导出」「收集」「全库」「重命名」「本地化」「一致性」）。

共 **14 条**命令 = **13 条业务命令** + **1 条诊断开关**（「切换诊断日志（排查用）」，只改日志级别、不动库内容）。下文说"13 条命令"时一般指前者。

**入口只有三处**：命令面板、设置页、以及**文件浏览器的右键菜单**（对笔记追加「收集 / 重命名 / 本地化 / 导出当前笔记附件」四项，作用对象是**被右键的那一篇**，无须先打开它）。目前**没有** ribbon 图标与状态栏项——这是刻意的（不占常驻界面），不是遗漏。

下表「命令 ID」列为**插件内 id**；在 Obsidian 里的完整命令 id 需加上插件 id 前缀，即 `attachment-suite:` + 下表值（例如 `attachment-suite:attachment:cleanup-unused`）。在快捷键设置、URI、脚本或其它插件中引用命令时要用完整 id。

| 命令 ID（插件内） | 名称 | 对应功能 |
| --- | --- | --- |
| `attachment:localize-note` | 本地化当前笔记附件 | 本地化 |
| `attachment:rename-note` | 重命名当前笔记附件 | 命名 |
| `attachment:check-consistency` | 检查库一致性（生成报告） | 一致性 |
| `attachment:fix-broken-links` | 修复断链 | 一致性 |
| `attachment:repair-incompatible-paths` | 修复不兼容路径 | 一致性 |
| `attachment:cleanup-unused` | 清理未用附件 | 清理 |
| `attachment:cleanup-empty-folders` | 清理空附件目录 | 清理 |
| `attachment:collect-current-note` | 收集当前笔记附件到归属目录 | 收集 |
| `attachment:bulk-collect` | 收集全库散落附件到归属目录 | 收集 |
| `attachment:export-note` | 导出当前笔记附件（zip） | 导出 |
| `attachment:export-unused` | 导出未用附件（zip） | 导出 |
| `attachment:bulk-rename` | 重命名全库附件 | 命名 |
| `attachment:bulk-localize` | 本地化全库附件 | 本地化 |
| `attachment:toggle-debug-logging` | 切换诊断日志（排查用） | 排查（非业务） |

---

## 安装

### 从 Release 安装（推荐）

1. 打开仓库的 [Releases 页面](https://github.com/CHNLM/obsidian-attachment-suite/releases)，下载最新版本的三个文件：`main.js`、`manifest.json`、`styles.css`。
2. 在你的库中创建目录 `<库路径>/.obsidian/plugins/attachment-suite/`——**目录名必须是 `attachment-suite`**（与插件 id 一致），否则 Obsidian 不会识别。
3. 把下载好的三个文件放进该目录。
4. 在 Obsidian 中：`设置 → 第三方插件 → 已安装的插件`，开启 **Attachment Suite**。

> 每个 Release 另附 `attachment-suite.zip`（内含 `attachment-suite/` 整个目录，可整包解压安装），
> 以及构建来源证明——可用 `gh attestation verify main.js --repo CHNLM/obsidian-attachment-suite`
> 校验该产物确实由本仓库的发布流程构建。

### 手动安装（开发 / 直接使用）

1. 克隆或下载本仓库到本地。
2. 进入插件源码目录并构建（**Node.js 版本精确固定为 24.20.0**——见下）：

   ```bash
   cd "Attachment Suite"
   npm install
   npm run build
   ```

   > 版本由 `.nvmrc`（CI 的 `actions/setup-node` 读它）与 `package.json` 的 `engines.node` 两处逐字固定，
   > 且 `.npmrc` 开了 `engine-strict`——用别的版本 `npm install` / `npm ci` 会直接报
   > `EBADENGINE ... Required: {"node":"24.20.0"}` 而拒绝执行（`nvm use` 一下即可）。
   > 真要换版本，**这两处一起改**（`engines` 精确到补丁号，是刻意的）。

3. 构建后 `Attachment Suite/dist/attachment-suite/` 就是一个**完整的、可直接安装的插件包**（含 `main.js` + `manifest.json` + `styles.css`）。把整个文件夹复制到你的 Obsidian 库插件目录（需替换 `<你的库路径>`）：

   ```powershell
   Copy-Item "Attachment Suite\dist\attachment-suite" "<你的库路径>\.obsidian\plugins\" -Recurse
   ```

   > 目录名必须保持为 `attachment-suite`（与插件 id 一致），Obsidian 才能识别加载；直接改名会失效。

4. 在 Obsidian 中：`设置 → 第三方插件 → 已安装的插件`，开启 **Attachment Suite**。

> 开发者日常迭代建议直接按下文[开发与测试](#开发与测试)的 **npm 脚本**完成依赖、检查、构建与发版。

> 提示：修改源码后需重新执行 `npm run build` 并刷新 `main.js`；Obsidian 对插件有模块缓存，必要时禁用再启用插件或完全重启应用。

---

## 使用与设置

### 附件目录约定

附件目录来源可在「通用 → 附件目录来源」配置：默认「跟随 Obsidian 设置」（采用 Obsidian「设置 → 文件与链接 → 附件默认存放路径」里的位置），也可切换为「自定义目录」并使用下方路径，推荐：

- `./assets` 或 `./attachments`：存放在笔记所在目录下的同名文件夹，移动笔记时更易跟随
- `.`：紧邻笔记
- `assets`：库根下的 `assets`

自定义路径支持模板变量：`${notename}`（笔记名）、`${parent}`（上级目录名）、`${parentpath}`（上级目录路径）、`${date}`（当天日期）。

本地化、命名、笔记移动跟随都会以该有效目录为准。

### 设置项分组

设置面板按能力分区展示，每个选项都带说明与推荐值。

> **开箱即用**：默认值已按常见做笔记习惯配好，装上就能直接用，不必逐项调整；真正需要用户决定的通常只有「附件目录来源」一项。
> 该页会在你的 Obsidian 附件文件夹是**库根**时当场给出提示（附件会和笔记混在一起，并给出两种改法）。
> 「本地化」里"设过一次就不用再碰"的网络细项（体积 / 超时 / 重试 / 域名名单 / 限速 / 并发）收在**可折叠的「高级」**里，折叠不影响它们的默认值生效。
> 各项默认值的取舍与理由见 [`docs/default-settings.md`](docs/default-settings.md)。

- **通用**：附件目录来源（跟随 Obsidian / 自定义）、通知级别（静默 / 仅摘要 / 详细。静默只在出错时提示，仅摘要显示成功/失败/跳过汇总，详细额外显示过程信息与全库任务进度；**失败提示在任何级别都会出现**。提示按级别分级停留时长：错误 5 秒、执行结果 3 秒、过程信息 2 秒，消息越长停留越久）、详细诊断日志（默认关；打开后向开发者控制台输出更详细的过程信息，含库内文件路径）
- **自动化**：自动处理（本地化 + 统一命名）开关（默认开）、轮询间隔（秒，默认 5）
- **命名**：启用（默认开）/ 连接符 / 时间戳 / 路径哈希 / 类别 / 子类型 / 按类别放入子目录 / 类别命名用词（可自定义各类型写入名字的词语）
- **本地化**：启用（默认开）/ 本地化网络 URL / 扩展扫描（**默认开**：md 图片、普通链接、HTML 媒体标签三种写法一并识别）/ MD5 命名 / 拦截内网与本机地址 / 类别白名单（**界面 5 类**：图片 / 视频 / 音频 / PDF / 文档；网页与「其他」不提供开关）；其余细项收在**高级**折叠区
- **一致性**：启用 / 报告坏链接 / 修复不兼容路径 / **路径修复的目标系统**（仅当前系统〔默认〕/ 全平台 / 指定单个平台）/ 笔记移动跟随（**默认开**）/ 断链相似度推荐（开关、阈值、候选上限）
- **清理**：启用 / 删除方式（默认 Obsidian 回收站）/ 排除目录（含子目录开关）/ 删除前确认（默认开）
- **导出**：启用（**默认开**）——导出是只读操作，默认关闭会让命令面板里的两条导出命令按下只得到"能力已关闭"

另有**全局排除目录**（通用下）：这些目录中的笔记不做本地化、其中的附件不会被判为未用而清理；清理未用附件、清理空附件目录（含其各级子目录）与导出未用附件时也会一并视为排除。

---

## 架构设计

项目遵循「**纯逻辑（core）与执行（infra/feature）分离**」的分层结构，保证可测试性与长可维护性：

```
src/
├── core/          # 纯逻辑：MD5、类型识别、路径兼容、
│                  #  链接解析、串行任务队列、附件索引、安全移动引擎、ZIP
├── obsidian-domain.ts  # infra 适配层：把 App 包装为 core 所需接口 (VaultAdapter
│                       #   / MetadataProvider / FileOps)
├── features/      # 功能执行层：本地化、命名、一致性、清理、收集、导出、笔记跟随、自动化、全库批量
├── settings*.ts   # 设置 Schema、版本迁移（支持从旧插件配置导入）
├── modals.ts      # 统一确认 / 报告弹窗
├── commands.ts    # 命令登记
└── main.ts        # 插件入口，组合 core + infra + 命令与事件
```

关键设计决策：

- **错误模型**：以异常承载 + **统一收口到可见反馈**。判据是"**这条异步路径上有没有人接住 rejection**"——目前五处收口点：命令级 `commands.ts` 的 `traceCommand`、弹窗回调 `modals.ts` 的 `runConfirmed`、后台队列 `main.ts` 的 `reportBackgroundError`、设置落盘 `settings-tab.ts` 的 `persist`（`save()` 与「详细诊断日志」开关共用）、以及定时轮询 `main.ts` 的 `sweepAuto` 外层 `try`（它由 `setInterval` 里的 `void` 调用，**没有调用方 await**，外层兜底是唯一防线）。**新增任何"发射后不管"的异步调用时，必须同时指明它归哪个收口点。** 失败提示**不受「通知级别」影响**（含「静默」）。纯逻辑层（`core/`）不做错误类型化——历史上的 `Result`/`PluginError` 类型因运行时零使用已作为死代码删除；若将来需要表达"可预期的失败"，再引入并配套迁移调用方
- **依赖方向**：`core` 不依赖任何 Obsidian 相关模块；`obsidian-domain.ts` 依赖 `core`；`features/` 与入口层依赖两者。即 `core ← obsidian-domain ← features`
- **安全文件操作**：一律经 Obsidian `fileManager.renameFile` 安全改名 / 移动，目标占用时追加 `(1)` 避让，绝不静默覆盖
- **数据安全**：删除前复检引用、短名引用兜底、破坏性操作先预览确认；所有破坏性命令的失败与部分失败都会以 error 级提示送达（不受「通知级别」影响）

---

## 开发与测试

### 快速构建（npm 脚本）

构建与检查统一走 **npm 脚本 + esbuild**（跨平台）：先 `npm install`，再依次 `npm run typecheck`、`npm test`、`npm run build`。

```bash
cd "Attachment Suite"
npm install
npm run typecheck && npm test && npm run build
```

- 产物输出到 `Attachment Suite/dist/attachment-suite/`（完整可安装插件包）
- 若需在真实 Obsidian 里验收：先 `npm run build`，再跑 `npx vitest run tests/e2e/seed-acceptance.test.ts`——它会**从零生成一个本地验收库并把构建产物投放进去**（无需手工建目录；想换成自己准备的库，可用脚本的 `--vault` 参数指定）

### 发版

发布由 `.github/workflows/release.yml` 自动完成——**推送版本标签即触发**，也可在 Actions 页手动触发。
（推送到 `main` 与 PR **不会触发任何校验或构建**：本仓库刻意没有"日常 CI"，校验只在发布链路上跑，见第 4 步。）

1. **更新版本号**（一次同步 `package.json` / `package-lock.json` / `manifest.json` / `versions.json`）：

   ```bash
   cd "Attachment Suite"
   npm run version -- 1.0.1
   ```

   > `--` 不能省：没有它，npm 不会把版本号透传给脚本。

2. **提交并推送**：

   ```bash
   git add "Attachment Suite/package.json" "Attachment Suite/package-lock.json" \
           "Attachment Suite/manifest.json" "Attachment Suite/versions.json"
   git commit -m "chore: 发布 1.0.1"
   git push
   ```

3. **打标签并推送**。标签名与 `manifest.json` 的版本号**逐字一致、不带 `v` 前缀**（Obsidian 官方发布规范）：

   ```bash
   git tag -a 1.0.1 -m "1.0.1"
   git push origin 1.0.1
   ```

4. 推送标签即触发发布工作流。它是一条**串联流水线**，三个作业依次串行：

   | 作业 | 干什么 |
   | --- | --- |
   | `detect-version` | 前置校验（标签版本与 `manifest.json` 一致、标签指向默认分支的最新提交、`versions.json` 含该版本映射）与幂等判定 |
   | `verify` | 校验（`.github/workflows/verify.yml`）：typecheck / test / build，**ubuntu 与 windows 各跑一遍**，并确认产物含三个必需文件 |
   | `build-release` | 生成**构建来源证明** → 创建 Release → 上传 `main.js` / `manifest.json` / `styles.css`（社区安装器与 BRAT 取用的必需文件）与 `attachment-suite.zip`（整包安装用） |

   ⚠️ **校验是产物的前置**：`build-release` 声明了 `needs: [detect-version, verify]`，
   **`verify` 不通过就一个产物都不会生成**（Release 不创建、附件不上传）。此时按下面「失败后重来」删掉标签再重走。
   进度见仓库的 **Actions** 页。

**几条容易踩的**

- **标签必须指向默认分支的最新提交**——工作流会拒绝指向历史提交的标签，防止在旧代码上误发新版本。
- **同一版本只发布一次**：若该版本的 Release **已发布**，工作流识别后直接跳过（幂等）；要重发须先删掉已有的 Release 与标签。
- **draft 例外**：上一次运行中途失败会留下同名的 **draft** Release，工作流把它当作"未发布"、重跑时**就地更新**它
  （`action-gh-release` 按标签找到已有 Release 后发布，不会产生第二个）——所以中途失败不需要人工删 draft，
  否则一次失败会把重跑永久堵死。
- **失败后重来**：若标签已推而工作流失败，先删远端标签再重打——
  `git push --delete origin 1.0.1`、`git tag -d 1.0.1`，修好后重走第 3 步。
  若此时 Release 尚未创建，也可以直接在 Actions 页手动触发一次（版本号取自 `manifest.json`，要求从默认分支触发）。

### 依赖更新（手动）

本仓库没有自动依赖更新的机器人，也没有日常 CI——npm 依赖与工作流里的 action 都靠手动核对：

```bash
cd "Attachment Suite"
npm outdated          # 看哪些有新版本（current / wanted / latest）——注意：只管 npm 依赖
npm update            # 在 package.json 声明的范围（^x.y.z）内升级，并同步 lockfile
npm run check:actions # 另查一遍工作流里钉扎的 action，落后时直接给出可替换的 uses 行
npm run typecheck && npm test && npm run build
```

跨大版本（major）升级要手改 `package.json` 的版本范围再 `npm install`，并单独排期验证——
这里全是构建与测试工具（**运行时零第三方依赖**，发布的 `main.js` 只把 `obsidian` 列为 external），
但 major 跳跃仍可能改变构建与测试的行为。

**工作流里的 action 不会自动升级**：`uses:` 都固定到 40 位 commit SHA（为了可复现性），
上游发版不会自己进来。用 `npm run check:actions`（`scripts/check-action-pins.mjs`）逐个核对——
它比对上游最新稳定版、直接打印可替换的 `uses:` 行，并校验行尾注释与钉扎版本是否一致；
退出码 0 = 全是最新 / 1 = 有需要处理的 / 2 = 没联网、结论不成立。
⚠️ `npm outdated` **看不到 action**——它只管 npm 依赖。

### 命令速查

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 监听模式构建（esbuild，输出 `dist/attachment-suite/main.js`） |
| `npm run build` | 生产构建，产出完整安装包 `dist/attachment-suite/` |
| `npm run typecheck` | TypeScript 严格模式类型检查（`tsc --noEmit`） |
| `npm test` | 运行全部测试（Vitest）：单元测试 + E2E 真实文件系统测试 |
| `npm run test:watch` | 测试监听模式 |
| `npm run check:actions` | 核对工作流里钉扎的 action 是否有新版本，并校验行尾注释 |
| `npm run version -- <版本>` | 发版：同步更新 `package.json` / `package-lock.json` / `manifest.json` / `versions.json` |

### 单元测试
单元测试覆盖 core 与各功能的纯逻辑层：路径兼容、MD5、类型识别、ZIP、链接解析 / 改写、附件索引、安全移动、清理规划、本地化规划、命名规划、笔记跟随、设置迁移、通知分级等。

### 端到端测试
`tests/e2e/`（`real-suite.test.ts`）以**真实文件系统的临时仓库**为后端（`os.tmpdir()` 新建、运行后清理），加载插件源码并实体执行全部 13 条命令，校验真实落盘与链接改写，随 `npm test` 一并运行。

> 说明：构建产物 `Attachment Suite/dist/`、以及端到端测试生成的验收库与运行报告，都属**本地运行态，不在版本控制内**（见 `.gitignore`）。验收库**无需预置**：`npx vitest run tests/e2e/seed-acceptance.test.ts` 会从零重建它并投放构建产物（库的位置由脚本决定，换新机器同样一步到位）。`tests/e2e/` 本身是仓库内的测试代码，正常提交。

> 归档文档（覆盖审计、安全威胁模型、命令清单、真实宿主运行记录、各阶段复查报告）在仓库根 [`docs/`](docs/)，**随仓库提交**。
> 验收库与运行报告属生成物，可由 `npx vitest run tests/e2e/seed-acceptance.test.ts` 重建，故不进版本控制。

> 测试目录结构、逐文件用例清单与扩展说明见 [`tests/README`](Attachment%20Suite/tests/README.md)。

---

## 贡献指南

1. Fork 并 `npm install`
2. 修改源码后：`npm run typecheck` 与 `npm test` 必须通过
3. 涉及文件操作 / 删除等破坏性改动，请补充对应的单元测试
4. 遵循既定分层（core 纯逻辑 / feature 执行 / infra 适配），不引入跨功能依赖

---

## 许可

[MIT](./LICENSE)