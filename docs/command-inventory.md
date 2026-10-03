# Attachment Suite 命令清单与作用域

> 对象：Obsidian 插件 **Attachment Suite**（`attachment-suite` v1.0.0，桌面端 `isDesktopOnly`）
> 范围：全部 **13 条业务命令**（另有 1 条诊断开关 `attachment:toggle-debug-logging`，只改日志级别、不动库内容，故不列入下表）的「能力分组 / 作用范围 / 确认方式 / 破坏性 / 前置开关 / 排除目录」
> 性质：维护者速查（**随仓库提交**——2026-09-29 由原先不提交的位置迁入 `docs/`，见 `docs/README.md`）
> 源码依据：`src/commands.ts`（登记）与 `src/features/*`（实现）；行号会漂移，判断以函数体内的门禁与弹窗调用为准
> 结论速览：**全库级 9 条 + 当前笔记级 4 条**。破坏性最强的是「清理未用附件」（删除附件）；**无预览确认**的只有 3 条（本地化当前笔记、导出 ×2）。

---

## 1. 总览（14 条：13 条业务命令 + 1 条诊断开关）

| # | 命令 ID | 命令面板名称 | 能力分组 | 作用范围 | 确认 / 预览 | 破坏性 |
|---|---|---|---|---|---|---|
| 1 | `attachment:check-consistency` | 检查库一致性（生成报告） | 一致性 | **全库** | 报告窗口（可导出） | 只读 |
| 2 | `attachment:fix-broken-links` | 修复断链 | 一致性 | **全库** | 自动层弹预览 + 交互层候选选择窗 | 改写笔记文本 |
| 3 | `attachment:repair-incompatible-paths` | 修复不兼容路径 | 一致性 | **全库** | 预览确认 | 改名附件 + 全库改写引用 |
| 4 | `attachment:cleanup-unused` | 清理未用附件 | 清理 | **全库** | 确认窗（受「删除前确认」，默认开） | **删除附件** |
| 5 | `attachment:cleanup-empty-folders` | 清理空附件目录 | 清理 | **全库** | 确认窗（受「删除前确认」，默认开） | 空目录移入回收站 |
| 6 | `attachment:collect-current-note` | 收集当前笔记附件到归属目录 | 收集 | 当前笔记 | 预览确认（总是） | 移动附件 + 改写笔记 |
| 7 | `attachment:bulk-collect` | 收集全库散落附件到归属目录 | 收集（全库） | **全库** | 预览确认 | 移动独占附件 + 改写各笔记 |
| 8 | `attachment:export-note` | 导出当前笔记附件（zip） | 导出 | 当前笔记 | **无预览** | 写 zip（同名覆盖） |
| 9 | `attachment:export-unused` | 导出未用附件（zip） | 导出 | **全库** | **无预览** | 写 zip（同名覆盖） |
| 10 | `attachment:localize-note` | 本地化当前笔记附件 | 本地化 | 当前笔记 | **无预览** | 新增附件文件 + 改写笔记 |
| 11 | `attachment:rename-note` | 重命名当前笔记附件 | 命名 | 当前笔记 | 预览确认 | 改名（共享附件复制副本） |
| 12 | `attachment:bulk-rename` | 重命名全库附件 | 全库批量（命名） | **全库** | 预览确认 | 改名 + 复制共享副本 |
| 13 | `attachment:bulk-localize` | 本地化全库附件 | 全库批量（本地化） | **全库** | 预览确认（含被拦截项清单，可点击定位） | 新增附件 + 改写笔记 |

> **第 14 条**：`attachment:toggle-debug-logging`「切换诊断日志（排查用）」——切换日志级别，
> **不改动库内容**，故不列入上表的作用域 / 破坏性口径。与设置页「通用 → 详细诊断日志」是
> **同一个状态、同一条实现**（`main.ts` 的 `setDebugLogging`），并且**同样会写盘**：
> 它是持久设置，重启宿主后仍保持（不是"重启即复位"）。
>
> 「全库」在本插件不是一个分组，而是横跨 **一致性 / 清理 / 导出 / 全库批量** 四处的范围属性；`attachment:bulk-*` 只是其中命名最直白的一条线。

---

## 2. 逐条明细

### 2.1 一致性（全库）

**`attachment:check-consistency`｜检查库一致性（生成报告）**
- 只读审计，产出报告窗口：附件数 / 坏链接 / 未用 / 可修复路径，报告可导出。
- 前置开关：`consistency.enabled`（默认开）；`consistency.reportBrokenLinks`（默认开）只控制报告里**是否列出**断链明细，关闭时仍计入汇总计数。
- 报告窗口内含「修复断链」快捷入口（等价于命令 #2）。
- 实现：`src/commands.ts` → `ReportModal`。

**`attachment:fix-broken-links`｜修复断链**
- 分层安全重链：L1–L4 唯一命中弹预览自动改；L5–L7（大小写差异 / 多候选 / 相似度推荐）弹候选窗逐条决定；L8 无法处理保持报告。
- 覆盖正文、frontmatter（cover/banner/attachments）、canvas 的 `file` 节点。
- 相似度推荐参数：`consistency.fuzzySuggest`（开）/ `fuzzyThreshold`（0.6）/ `fuzzyTopN`（5）。
- 前置开关：`consistency.enabled`（默认开）。门禁写在 `runFixBrokenLinks()` 内，故命令入口与报告窗口的「修复断链」按钮**一并受约束**。
- 实现：`src/features/broken-link.ts` + `broken-link-core.ts`。

**`attachment:repair-incompatible-paths`｜修复不兼容路径**
- 把当前目标平台不支持的路径（Windows 保留名、非法字符、超长名）安全改名，并跨库改写引用。
- 前置开关：`consistency.enabled` **且** `consistency.repairIncompatiblePaths`（默认开）；平台取自 `consistency.platforms`（默认**仅当前系统**，即 `[currentPlatform()]`；可在设置里切换为全平台或指定单个平台）。
- 实现：`src/features/consistency.ts` → `SafeMoveEngine` + `rewriteRefsInAllNotes`。

### 2.2 清理（全库）

**`attachment:cleanup-unused`｜清理未用附件**
- 删除无任何笔记引用的孤儿附件；删除方式 `cleanup.deleteMode`（`.trash` 默认 / `system-trash` / `permanent`）。
- 前置开关：`cleanup.enabled`（默认开）；确认窗受 `cleanup.requireConfirm`（默认开）。
- 排除范围 = `cleanup.excludedFolders` **并上** 全局 `paths.exclude`，再按 `cleanup.excludeSubfolders` 决定是否含子目录。
- 防误删：删除前运行时复检引用，快照后新增的引用会让该附件被跳过并计入 `skipped`。
- 实现：`src/features/unused-cleaner.ts`（+ `unused-cleaner-core.ts`）。

**`attachment:cleanup-empty-folders`｜清理空附件目录**
- 把不含任何文件与子目录的空目录移入 Obsidian 回收站，删除后逐层变空的父目录一并清理。
- 前置开关：`cleanup.enabled`（默认开）；确认窗受 `cleanup.requireConfirm`（默认开），关闭时直接执行。
- 排除范围 = `cleanup.excludedFolders` **并上** 全局 `paths.exclude`；口径与「清理未用附件」相同，但**排除目录内的各级空目录一律豁免**（`isPathExcluded` 前缀语义，不受 `cleanup.excludeSubfolders` 影响）。
- 被排除的空目录**仍参与**父目录的「是否有子目录」判定，避免父目录被误判为空而删除（`planEmptyFolderCleanupDetailed` 的 `excludes` 只影响待删集合，不改变判定输入）。
- 被跳过的数量会在确认窗、结果通知与「无可清理项」提示中如实报告，不静默丢弃。
- 只跳过 `.obsidian`（不跳过 `.trash`，其中即便清掉空目录也无内容损失）。
- 实现：`src/features/empty-folder-cleaner.ts`（+ `empty-folder-core.ts`）。

### 2.3 收集

**`attachment:collect-current-note`｜收集当前笔记附件到归属目录**
- 把当前笔记引用、但不在其归属附件目录的**独占**附件移入归属目录，并改写当前笔记引用（含 frontmatter）。
- 无设置开关；确认窗总是弹。
- 实现：`src/features/collect.ts`（+ `collect-core.ts`）。

**`attachment:bulk-collect`｜收集全库散落附件到归属目录**
- 与上条同规则，范围扩到全库；只构建一次快照，逐篇按归属笔记分组执行，通知收敛为单条汇总。
- 排除目录内的笔记跳过；被多篇笔记共用的附件**不移动**（汇总里会提示）。预览确认后执行。
- 实现：`src/features/bulk-collect.ts`（+ `bulk-collect-core.ts`）。

### 2.4 导出

**`attachment:export-note`｜导出当前笔记附件（zip）**
- 归档当前笔记引用的附件 + `manifest.json`（`plugin: attachment-suite`、`exportedAt`、`note`、`count`）。
- 落盘位置：笔记所在目录下 `<笔记名>_Attachments.zip`；同名**自动覆盖**（先删除旧文件）。扁平归档，同名附件按 `_1` 追加序号。
- 前置开关：`exporter.enabled`（**默认 true**，2026-09-30 起——导出是只读操作，默认关会让命令面板里的两条导出命令按下去只得到「导出能力已关闭」）；无预览确认。
- 实现：`src/features/exporter.ts`（+ `core/zip.ts`、`export-name-core.ts`）。

**`attachment:export-unused`｜导出未用附件（zip）**
- 归档全部未用附件 + `manifest.json`（`count`）到**库根** `Unused_Attachments.zip`，同名覆盖。
- 扁平归档冲突处理：追加文件 mtime 时间戳，仍冲突再追加序号。
- 前置开关：`exporter.enabled`（**默认 true**）；无预览确认。
- 排除范围：按 `paths.exclude` 过滤（与 #4 同口径的"排除意图"），但**不含** `cleanup.excludedFolders`——那是清理专属名单。被跳过数会写入日志与通知，全部被排除时提示「均位于排除目录」。

### 2.5 本地化

**`attachment:localize-note`｜本地化当前笔记附件**
- 扫描当前笔记的 http(s) / `data:` 引用，下载到附件目录并改写为本地引用；网页（HTML）永不落存。
- 前置开关：`localize.enabled`（默认开）；`localize.localizeWebUrls` 关闭时只处理内嵌 `data:` 图片、不发网络请求。
- 排除目录内的笔记直接跳过。
- **无预览确认**（直接执行）；下载成功后若 `naming.enabled`，会**静默接续统一命名**（不弹预览）。
- 实现：`src/features/localize-media.ts`（+ `localize-media-core.ts`）。

**`attachment:bulk-localize`｜本地化全库附件**
- 遍历全库 markdown 笔记（排除目录跳过），逐篇下载外链并改写；同一 URL 只下载一次、按内容 MD5 去重落盘一份。
- **有预览确认**：展示「将扫描 N 篇笔记、可下载外链 M 个」，并**逐条列出被拦截的引用**（原因 · URL → 来源笔记，可点击定位到笔记中该处）；若外链全被拦截，则开只读清单而不是误报「没有可替换项」。
- 继承本地化的全部安全策略（内网拦截、域名黑白名单、仅白名单、体积上限、同主机限速、并发上限）。
- 实现：`src/features/bulk-localize.ts`。

### 2.6 命名

**`attachment:rename-note`｜重命名当前笔记附件** / **`attachment:bulk-rename`｜重命名全库附件**
- 命名公式：`笔记名 + 连接符 + [类别] + 连接符 + 序号(3 位) + [14 位时间戳] + [8 位路径哈希] + .扩展名`；两段可选后缀默认关。
- 前置开关：`naming.enabled`（默认开）——关闭时命令直接返回，不弹预览。
- 独占附件直接改名；被多篇笔记共用的附件为每篇引用笔记**复制副本**并各自命名（全库场景会在预览与汇总里报数量）。
- 幂等：`parseRenamed` 从右往左解析（笔记名自身含连接符也不误判），已按当前方案命名的附件跳过；序号按「类型字段」维度接续，跨跳过保持连续。
- 全库场景：排除目录内的笔记跳过；`naming.folderByCategory` 开启时落点为 `<附件原目录>/<类别>/`。
- 实现：`name-formatter.ts` / `bulk-rename.ts`（规划：`name-formatter-core.ts`、`bulk-rename-core.ts`）。

---

## 3. 非命令入口（同样会改动库，但不占用命令面板）

| 入口 | 触发 | 行为 | 开关（默认） |
|---|---|---|---|
| 自动化（自动处理） | 笔记变更事件 + 定时轮询（`automation.interval` 秒，默认 5） | 对**变更笔记**做本地化 + 统一命名；不遍历全库；正文一律从**磁盘**读取（不读编辑器缓冲区） | `automation.enabled`（true） |
| 笔记移动跟随 | 库内笔记 rename 事件 | 把该笔记相对目录（如 `./assets`）下的附件一并迁移并保持链接 | `consistency.followNoteMove`（**true**，2026-09-30 起；仅对笔记相对型目录生效，库根/绝对路径下本项不作用） |
| 下载即命名 | **本地化当前笔记**（`attachment:localize-note`）执行完 | 下载成功且 `naming.enabled` 时静默接续统一命名（无预览）。**全库本地化（#13）不做此接续** | `naming.enabled`（true） |
| 报告内「修复断链」 | 一致性报告窗口按钮 | 等价于命令 #2 | `consistency.enabled`（生效） |

---

## 4. 开关门禁矩阵与排除目录覆盖范围

### 4.1 门禁矩阵

| 设置开关（默认） | 约束的命令 |
|---|---|
| `consistency.enabled`（true） | #1 检查库一致性；#2 修复断链（含报告内按钮）；#3 修复不兼容路径（另需 `repairIncompatiblePaths`） |
| `localize.enabled`（true） | #10 本地化当前笔记；#13 本地化全库 |
| `naming.enabled`（true） | #11 重命名当前笔记；#12 重命名全库；以及 #10 本地化当前笔记的「下载即命名」（全库本地化 #13 不做） |
| `cleanup.enabled`（true） | #4 清理未用附件；#5 清理空附件目录 |
| `cleanup.requireConfirm`（true） | #4 与 #5 的确认窗 |
| `exporter.enabled`（**true**） | #8 导出当前笔记；#9 导出未用 |
| **无开关** | #6/#7 收集 ×2（收集没有设置分组） |

### 4.2 排除目录（`paths.exclude`）覆盖范围

| 命令 | 是否受排除目录影响 |
|---|---|
| #10 / #13 本地化 | ✅ 笔记命中即跳过 |
| #12 重命名全库、#7 收集全库 | ✅ 过滤排除目录内的笔记 |
| #4 清理未用附件 | ✅ 并入清理排除名单（`cleanup.excludedFolders` + `paths.exclude`） |
| #5 清理空附件目录 | ✅ 同上口径；且排除目录内的**各级**空目录一律豁免（前缀语义，不受 `cleanup.excludeSubfolders` 影响） |
| #9 导出未用附件 | ✅ 按附件路径过滤 `paths.exclude`（不含 `cleanup.excludedFolders`，那是清理专属名单） |
| #1 检查库一致性 | ✅ 已按 `paths.exclude` 过滤报告：孤儿与坏链接在**展示层**过滤，索引与保护层不动（`src/commands.ts`，并在汇总注明跳过数）。2026-09-16 修订——此处原标注为「索引不排除 → 报告仍可能列出排除目录内的未用附件」，与代码及 README 均不符 |

### 4.3 修复记录（曾有的三处语义不一致，已于 2026-09-14 统一）

1. **#2 修复断链** —— 原先不读 `consistency.enabled`，现已补门禁（`src/features/broken-link.ts`），命令入口与报告内按钮同时生效。
2. **#5 清理空附件目录** —— 原先不读 `cleanup.enabled`、不读 `cleanup.requireConfirm`（确认窗固定弹）、不读排除目录；现已三项补齐：门禁对齐 #4、免确认路径抽出 `performEmptyFolderDelete()` 供弹窗与静默路径共用、排除名单叠加 `cleanup.excludedFolders + paths.exclude`。
3. **#9 导出未用附件** —— 原先直接取 `snapshot.orphanCandidates`，现按 `paths.exclude` 过滤，并在全部被排除时提示「均位于排除目录」而非误报「没有未使用的附件」。

> 配套：`src/settings-tab.ts` 的「启用一致性 / 启用清理 / 排除目录 / 排除目录含子目录 / 删除前确认」描述已同步；测试新增 `empty-folder-core` 排除用例 3 组、E2E 3 条（`P2-9b`、导出排除、断链门禁）。
