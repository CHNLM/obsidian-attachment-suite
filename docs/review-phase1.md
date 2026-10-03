# 一阶段审查报告：当前笔记级（历史归档）

> 范围：`localize-note` / `rename-note` / `collect-current-note` / `export-note` + 其依赖 core
> 时间：2026-09-14 晚（用户离线期间自动执行）
> 状态：**已完成（历史归档）**——当时的 8 项已修复，§4 的遗留项由后续阶段接手。
> 要看**当前**状态请读 `review-2026-10-02.md`（最新复查）与 `coverage-audit-2026-09-28.md`（覆盖矩阵）。
> 验证（**当时的数字，已过期，勿引用**）：`npm run typecheck` 0 错；相关单测 81 全绿；E2E 42 全绿

---

## 1. 已确认并修复的缺陷

| 编号 | 等级 | 缺陷 | 证据 | 修复 |
|---|---|---|---|---|
| **P1-1** | **P1** | **扩展扫描把普通链接与 HTML 媒体标签改写成 markdown 图片嵌入**：`[说明](a.pdf)` → `![说明](a.pdf)`；`<audio src=…></audio>` → `![](m.mp3)</audio>`（还留下孤儿闭合标签）→ 渲染被破坏 | `localize-media-core.ts` `applyRefReplacements` 对任何 ref 都调 `localLinkText`；新增 3 条单测先复现 | 引入 `RefSyntax`（`md-image`/`md-link`/`html`）与 `refReplacement()`：链接保持链接（wiki 风格 `[[path\|text]]`）、HTML 标签**只替换 src**、图片仍为图片嵌入；`localLinkText` 保留兼容 |
| **P1-2** | **P1** | **`'/'` 的附件目录语义错误（影响面最大）**：Obsidian `app.json` 的 `attachmentFolderPath` **默认值就是 `/`**（"Vault folder" = 库根），插件却把 `/` 解析成"笔记同级" → 所有沿用 Obsidian 默认设置的用户，本地化/收集/命名的落盘位置都会跑到笔记旁边而不是库根 | 从 Obsidian 本体 `obsidian.asar` 取证：默认配置 `attachmentFolderPath:"/"`；`getAvailablePathForAttachments` 中只有 `'.'`/`'./'`/`'./x'` 走"笔记相对"，`'/'` 归一化到库根。且 `resolveAttachmentDir` 的**自有注释**已写「`/x` 或 `x` → 库根/x」，与代码行为矛盾（纯属笔误级疏漏） | `resolveAttachmentDir`：`'/'` → 库根（`''`）；`'.'`/`'./'` 仍为笔记相对；补 1 条单测锁死 Obsidian 语义 |
| **P1-3** | **P1** | **受管白名单不闭合**：`classify()` 按内容放行 `document`（含纯文本 `.txt`），而索引/命名/收集/导出/清理统一按**扩展名白名单**工作 → 外链 `.txt` 会被下载落盘，却不会被任何后续功能管理（"下载了却没人管"） | `core/types.ts` 白名单 vs `localize-media.ts` 落盘分支 | 落盘前加 `isManagedAttachment(result.ext)` 闸门；跳过时单独计数 `skippedUnmanaged` 并在通知中如实报告（延续"不静默丢弃"） |
| **P2-1** | **P2** | **正文被 `$` 替换模式改坏**：`String.replace(needle, string)` 会把替换串里的 `$&`/`$1` 展开 → 本地路径含 `$` 时正文被插入匹配原文 | 新增单测复现：`assets/$&$1.png` → `assets/![a](https://x.com/q.png)$1.png` | 改用函数式替换 `replace(raw, () => …)`，参数一律按字面量 |
| **P2-2** | **P2** | **`errors` 恒为 0**：写盘失败被混入 `skipped`；`vault.modify` 失败**未捕获**（异常直接冒泡，用户只看到"好像没反应"） | `localize-media.ts` 尾部 `return { … errors: 0 … }` | 写盘失败计入 `errors`；`modify` 加 try/catch → 计入 `errors` + `toast.error('附件已下载，但改写笔记失败…请重试')`；通知文案增补 `失败 N` |
| **P2-3** | **P2** | **冲突避让后缀 `(N)` 破坏幂等**：`笔记_image_002 (1).png` 无法被 `parseRenamed` 识别 → 每次运行都重新规划 → 反复复制副本（磁盘膨胀 + 引用漂移） | `name-formatter-core.ts` `parseRenamed` 严格按模板分段 | 解析前剥离尾部 ` (\d+)`；补单测（含 `(12)`） |
| **P2-4** | **P2** | **导出无内存上限**：ZIP 为 store 模式、内存内一次拼装（体积≈附件之和），大库导出可能把 Obsidian 卡死/崩溃 | `core/zip.ts` `concat()` 一次性分配总长 buffer | 新增 `MAX_EXPORT_BYTES`（512MB）+ `checkExportSize()`：超限**中止**并给出可行动提示；`export-note` 与 `export-unused` **同一体检**（单篇↔全库等价） |
| **PIN-1** | 加固 | "导出产生的 zip 会被清理误删"这一担忧**经证实不成立**（zip 不在受管白名单），但缺测试保护，未来扩大白名单可能悄悄回归 | — | 新增 E2E 钉子：导出 zip → 跑「清理未用附件」→ 断言 zip 仍在、孤儿已删 |

---

## 2. 已排除的怀疑（反向验证结论，避免重复投入）

| 原怀疑 | 结论 | 依据 |
|---|---|---|
| 同一 URL 出现多次时只改写第一处 | **不成立** | `applyRefReplacements` 收的是**未去重**的完整 refs 列表，逐条替换；去重只用于下载阶段 |
| frontmatter 里的 http 外链会被误报为断链 | **不成立** | `frontmatterBrokenRefs` 显式跳过 `https?:`/`//`/`data:`/锚点 |
| 重命名/收集的兜底改写漏了 frontmatter | **不成立** | `rewriteRefsInNote` 同时调 `rewrite` + `rewriteFrontmatter`；canvas 依赖 Obsidian 自身的 rename 联动 |
| `.trash`/`.obsidian` 内的文件会被当附件清理 | **不成立** | 索引按扩展名白名单 + E2E 夹具已排除这两处 |

---

## 3. 裁定记录（我自行决定、需你复核的取舍）

| 裁定 | 内容 | 理由 |
|---|---|---|
| D1 | 白名单外类型（`.txt` 等）**直接跳过不落盘**，而非扩展受管白名单 | 扩展白名单会把 `.txt/.csv` 纳入清理范围 → 可能删用户文本文件，风险远大于收益 |
| D2 | 导出超限**中止**而非"警告后继续" | 崩溃/卡死的后果不可预期；中止 + 明确提示是可行动且可预期的 |
| D3 | `modify` 失败**不回滚已落盘附件** | 落盘文件可能已被其它引用使用；它未被引用时会被「清理未用附件」识别，不构成数据损失 |
| D4 | `'/' = 库根`（对齐 Obsidian），`''` 仍按"笔记同级"（插件内部语义） | `'/'` 有 Obsidian 本体的硬证据；`''` 被 `effectiveAttachmentFolder` 兜底掉，实际不会出现 |

---

## 4. 一阶段剩余待办（继续推进）

| 项 | 内容 |
|---|---|
| A1 / F-前端 | **frontmatter 外链不参与本地化**（与断链检测口径不对称）：`cover: https://…` 不会被下载。拟按"保守、行级、保引号"的方式补上并同时接入 `bulk-localize`，保持单篇↔全库一致 |
| A4–A11 | 过滤后引用是否保持原样、`minSizeKb` 丢弃提示、`useMarkdownLinks` 回退、笔记在根/附件目录在排除目录的交叉情形、本地化后续命名的竞争、同名不同内容的落盘判定等 → 逐项验证（部分由三阶段真实用例兜底） |
| A14–A17 | 命名幂等的真实库验证、`folderByCategory` 与模板叠加、笔记名极端字符、目标占用避让后的引用一致性 |
| A19–A22 | 收集失败半成品、共享附件跳过稳定性、目标=源目录幂等、排除目录笔记跳过 |
| A25–A27 | zip 内容结构校验（`manifest.json`、同名 `_1`）、无附件/全被排除的提示准确性 |
| A28–A30 | `SafeMoveEngine` 大小写不敏感文件系统的避让、`TaskQueue` 竞争面、通知分级与 error 恒提示 |

---

## 5. 验证记录

- `npm run typecheck` → 0 错误
- `npx vitest run tests/unit/core/path-compatibility.test.ts tests/unit/features/name-formatter-core.test.ts tests/unit/features/localize-media-core.test.ts` → **81 passed**
- `npx vitest run tests/e2e/real-suite.test.ts` → **42 passed**（含新增 zip 安全钉子）
- 未跑全量 `npm test`（按约定留到三阶段统一全量）
