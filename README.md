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
把笔记中的**外链图片 / 视频 / 音频 / PDF / 网页**下载到本地，并自动改写为本地引用，保证脱机可用。

- 支持 `http(s)` 外链与内嵌 `data:` 图片
- 不支持/不允许的格式会被安全跳过（如 SVG 这类存在 XSS 风险的文本格式）
- 按**内容 MD5 去重**：同一张图贴多次只保存一份（可关闭，关闭后保留原始文件名）
- 下载具备安全措施：SSRF 防护、大小上限、超时与重试

### 2. 统一命名（Name）
把附件规范为「`笔记名_类别_序号`」的格式，便于整理与查找。

- 支持扩展字段：时间戳、路径哈希、类别 / 子类型
- **幂等**：对已按规则命名的附件自动跳过，不会重复处理
- 命名可配置连接符、是否携带类别等

### 3. 一致性（Consistency）
审计并修复全库的附件引用问题。

- **坏链接报告**：列出指向不存在文件的引用，并校验精确路径 / 文件名是否存在
- **路径修复**：把 Windows 等平台的保留名、非法字符、超长文件名安全改名并自动更新引用
- **笔记移动跟随**：笔记移动时，把其相对目录（如 `./assets`）下的附件一并迁移并保持链接（默认关闭）

### 4. 清理未用（Cleanup）
扫描并删除没有任何笔记引用的孤儿附件，并支持清理空的附件目录。

- **防误删兜底**：即使 Obsidian 索引未就绪、短名引用未解析，也绝不误删仍被引用的附件
- 删除前**复检**引用，避免因快照延迟误删
- 排除目录过滤（含子目录开关）
- 三种删除方式：Obsidian 回收站 / 系统回收站 / 永久删除，默认回收站且删除前确认
- **清理空附件目录**：把不含任何文件的空目录（含删除后逐层变空的父目录）移入回收站

### 5. 导出（Export）
把当前笔记的附件或全部未用附件打包为 ZIP 并写入库内，附带 `manifest.json` 清单。

- 同名 ZIP 可重复导出（自动覆盖）
- 导出内容去重、扁平化归档

### 6. 收集（Collect）
把当前笔记引用但落在其它目录的散落附件，移入该笔记的归属附件目录，并自动更新引用。

### 7. 批量处理（Bulk）
提供两条全库级命令，一次性处理存量附件：

- **重命名全库附件**：按「笔记名_类别_序号」批量命名全库被引用附件；被多篇笔记共用的附件为每篇复制副本并各自更新链接
- **本地化全库附件**：批量扫描全库 markdown 笔记，把 http/data 外链下载到本地并改写为本地引用；同一外链按内容 MD5 去重仅落盘一份

### 8. 自动化（Automation）
编辑中的笔记一旦出现外链图片或新的附件，自动执行本地化与统一命名（默认开启，按发生变更的笔记处理、不依赖当前焦点，焦点切换不影响；粘贴触发读编辑器实时内容）。

---

## 命令一览

所有命令均可在命令面板中按中文关键词搜索（如「清理」「附件」「导出」「收集」「全库」「批量」）。

| 命令 ID | 名称 | 对应功能 |
| --- | --- | --- |
| `attachment:localize-note` | 本地化当前笔记附件 | 本地化 |
| `attachment:rename-note` | 重命名当前笔记附件（统一命名） | 命名 |
| `attachment:check-consistency` | 检查库一致性（生成报告） | 一致性 |
| `attachment:repair-incompatible-paths` | 修复不兼容路径 | 一致性 |
| `attachment:cleanup-unused` | 清理未用附件 | 清理 |
| `attachment:cleanup-empty-folders` | 清理空附件目录 | 清理 |
| `attachment:collect-current-note` | 收集当前笔记附件到归属目录 | 收集 |
| `attachment:export-note` | 导出当前笔记附件（zip） | 导出 |
| `attachment:export-unused` | 导出未用附件（zip） | 导出 |
| `attachment:bulk-rename` | 重命名全库附件（全库统一命名） | 命名 |
| `attachment:bulk-localize` | 本地化全库附件（全库批量下载外链媒体） | 本地化 |

---

## 安装

### 手动安装（开发 / 直接使用）

1. 克隆或下载本仓库到本地。
2. 进入插件源码目录并构建（需要 Node.js 与 npm）：

   ```bash
   cd "Attachment Suite"
   npm install
   npm run build
   ```

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

附件目录来源可在「通用 → 附件目录来源」配置：默认「跟随 Obsidian 设置」（采用 Obsidian「文件与链接 → 默认附件文件夹」的位置），也可切换为「自定义目录」并使用下方路径，推荐：

- `./assets` 或 `./attachments`：存放在笔记所在目录下的同名文件夹，移动笔记时更易跟随
- `.`：紧邻笔记
- `assets`：库根下的 `assets`

自定义路径支持模板变量：`${notename}`（笔记名）、`${parent}`（上级目录名）、`${parentpath}`（上级目录路径）、`${date}`（当天日期）。

本地化、命名、笔记移动跟随都会以该有效目录为准。

### 设置项分组

设置面板按能力分区展示，每个选项都带说明与推荐值：

- **通用**：附件目录来源（跟随 Obsidian / 自定义）、通知级别（静默 / 仅摘要 / 详细）
- **自动化**：自动处理（本地化 + 统一命名）开关、轮询间隔（秒，默认 5）
- **命名**：启用 / 连接符 / 时间戳 / 路径哈希 / 类别 / 子类型 / 按类别放入子目录 / 类别命名用词（可自定义各类型写入名字的词语）
- **本地化**：启用 / 本地化网络 URL / 扩展扫描 / MD5 命名 / 最小大小 / 重试与超时 / 类别白名单
- **一致性**：启用 / 报告坏链接 / 修复不兼容路径 / 笔记移动跟随
- **清理**：启用 / 删除方式 / 排除目录（含子目录开关）/ 删除前确认
- **导出**：启用 / 导出命令

另有**全局排除目录**（通用下）：这些目录中的笔记不做本地化、其中的附件不会被判为未使用而清理。

---

## 架构设计

项目遵循「**纯逻辑（core）与执行（infra/feature）分离**」的分层结构，保证可测试性与长可维护性：

```
src/
├── core/          # 纯逻辑：Result 错误模型、MD5、类型识别、路径兼容、
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

- **错误模型**：统一 `Result<T, PluginError>`，错误分类（网络 / 超时 / 冲突 / 路径 / 大小 / 禁止 / 取消 / 未知），支持重试判定
- **依赖方向**：`infra ← core ← features`，禁止跨功能互相调用
- **安全文件操作**：一律经 Obsidian `fileManager.renameFile` 安全改名 / 移动，目标占用时追加 `(1)` 避让，绝不静默覆盖
- **数据安全**：删除前复检引用、短名引用兜底、破坏性操作先预览确认

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
- 若需投放到真实测试库 `for-test` 供验收，手动执行 `Copy-Item dist\attachment-suite\* for-test\.obsidian\plugins\attachment-suite\ -Force`

### 命令速查

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 监听模式构建（esbuild，输出 `dist/attachment-suite/main.js`） |
| `npm run build` | 生产构建，产出完整安装包 `dist/attachment-suite/` |
| `npm run typecheck` | TypeScript 严格模式类型检查（`tsc --noEmit`） |
| `npm test` | 运行全部测试（Vitest）：单元测试 + E2E 真实文件系统测试 |
| `npm run test:watch` | 测试监听模式 |
| `npm run version -- <版本>` | 发版：同步更新 `package.json` / `package-lock.json` / `manifest.json` / `versions.json` |

### 单元测试
单元测试覆盖 core 与各功能的纯逻辑层：路径兼容、MD5、类型识别、ZIP、链接解析 / 改写、附件索引、安全移动、清理规划、本地化规划、命名规划、笔记跟随、设置迁移、通知分级等。

### 端到端测试
`tests/e2e/`（`real-suite.test.ts`）以**真实文件系统的临时仓库**为后端（`os.tmpdir()` 新建、运行后清理），加载插件源码并实体执行全部 11 条命令，校验真实落盘与链接改写，随 `npm test` 一并运行。

> 说明：`e2e/` 与 `for-test/` 为**本地运行态，当前不在版本控制内**（见 `.gitignore`）。`for-test` 是专门的真实测试库；拉取副本后需自行准备测试库，或用 `npm run build` 后把 `dist/attachment-suite/` 内文件投放至 `for-test` 再用 Obsidian 实体验收。

---

## 贡献指南

1. Fork 并 `npm install`
2. 修改源码后：`npm run typecheck` 与 `npm test` 必须通过
3. 涉及文件操作 / 删除等破坏性改动，请补充对应的单元测试
4. 遵循既定分层（core 纯逻辑 / feature 执行 / infra 适配），不引入跨功能依赖

---

## 许可

[MIT](./LICENSE)