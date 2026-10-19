# docs/ 索引

> 本目录**随仓库提交**。用途：回答"**遇到 X 该读哪一篇**"与"**这一篇现在还作数吗**"。
>
> 结构按**文档的寿命**分三层，这也是判"是否作数"的**唯一判据**（不是看日期）：
>
> | 层 | 描述什么 | 是否必须与代码一致 |
> | --- | --- | --- |
> | `specs/` | **现在是什么样**（规范与事实） | **是**——由 `tests/unit/docs-consistency.test.ts` 逐条对账 |
> | `records/` | **某一轮发生了什么** | 否——其中的数字与旧表述**属当时**，别当现状引用 |
> | `archive/` | **当时是怎么想的** | 否——只供追溯"某处改动为什么这么做" |
>
> ⚠️ 只有 `specs/` 层的"当前事实"会被机器对账；`records/` 与 `archive/` 里的数字**本来就该是旧的**，
> 看到不一致**不要改它们**（改写历史比数字过期更糟）。

## 目录结构

```text
docs/
├── README.md                          ← 本文件：三层索引（也是守卫的"机器可读清单"）
│
├── specs/                             ① 规范与事实 —— 描述"现在"，由守卫逐条对账
│   ├── invariants.md                    项目不变式与工程约定（改核心逻辑前必读）
│   ├── default-settings.md              默认值的产品决策与理由
│   ├── command-inventory.md             命令清单 / 门禁矩阵 / 排除目录覆盖
│   ├── coverage-matrix.md               能力 × 分支 × 验证层矩阵（现状）
│   └── security-threat-model.md         威胁模型与加固现状（§1–§9 + 附录 A/B）
│
├── records/                           ② 逐轮记录 —— 描述"某一轮"，数字属当时
│   ├── review-log.md                    2026-10-02 → 10-18 逐轮复查（前期四轮为合并件，其后各轮逐条追加）
│   ├── real-host-log.md                 真实 Obsidian 验收记录（跨轮）
│   ├── round4-5-2026-09-28.md           第 4–5 轮：复查 + 遗留方案实施（合并件）
│   └── coverage-audit-2026-09-28.md     覆盖审计的过程（矩阵现状已抽到 specs/coverage-matrix.md）
│
└── archive/                           ③ 历史归档 —— 描述"当时怎么想的"，只供追溯
    ├── 2026-09-repair-phases/           目录：2026-09-14 三阶段修复（4 篇 + 本目录 README 索引）
    │   ├── README.md                     该目录的小索引（这轮做了什么、独有价值在哪）
    │   ├── test-repair-plan.md           三阶段总纲 + 核查项 A1–A30 / B1–B34
    │   ├── review-phase1.md              一阶段：当前笔记级
    │   ├── review-phase2.md              二阶段：全库级 + 自动化 + 索引/性能
    │   └── review-phase3.md              三阶段：验收库 + 真宿主（含"只有真宿主才暴露的差异"）
    ├── 2026-09-16-audit-and-fixes.md     质量审计 + A/B/C/D 批次修复（合并件）
    ├── 2026-09-14-security-hardening.md  安全加固四批实施记录（原威胁模型附录 C–F）
    └── 2026-10-13-docs-reorg.md          本次重组的方案 + 执行记录 + 新旧文件对照表
```

**共 18 个 Markdown 文件**（`specs/` 5 + `records/` 4 + `archive/` 8 + 本文件 1）。
另有 2 条**不在本目录、但被上面的 `specs/` 表索引进来的路径**：仓库根 `README.md` 与
[`Attachment Suite/tests/README.md`](../Attachment%20Suite/tests/README.md)。

**命名约定（"要不要带日期"）**：

| 层 | 带日期？ | 为什么 |
| --- | --- | --- |
| `specs/` | **不带** | 它们描述"现在"；带日期就等于暗示它会过期 |
| `records/`、`archive/` | **带**（文件名或节标题） | 它们的价值就在"当时"——不带日期反而会误导 |

**提交状态**：本目录**全部提交**（`.gitignore` 里明确写了"不要把 `docs/` 加进本文件"）；
不提交的是生成物与本地态：`for-test/`、`.workbuddy/`、`Attachment Suite/dist/`、`node_modules/`。

## specs/ · 规范与事实（**由 `docs-consistency.test.ts` 逐条对账**）

| 文档 | 讲什么 | 什么时候读 |
| --- | --- | --- |
| [`../README.md`](../README.md) | 插件的对外说明：功能、命令、安装、设置 | 第一次接触这个插件 |
| [`../Attachment Suite/tests/README.md`](../Attachment%20Suite/tests/README.md) | 测试体系正本：目录、逐文件用例清单、运行方式、**§7.4 测试基建硬规则** | 改测试 / 改替身 / 加守卫 / 跑验收 |
| [`specs/invariants.md`](specs/invariants.md) | **项目不变式与工程约定**：引用解析/改写的口径、错误模型与五处收口、六种「承诺了却不生效」的形态、文案规范、分层与架构守卫、发布规范、工程陷阱 | 改核心逻辑 / 通知 / 设置页文案 / 分层 / 发版**之前** |
| [`specs/default-settings.md`](specs/default-settings.md) | 默认配置的产品决策：四条判据、逐项默认值与理由、三处引导、常见场景表现 | 动任何默认值**之前** |
| [`specs/command-inventory.md`](specs/command-inventory.md) | 命令总览：作用域、确认/预览、破坏性、门禁矩阵、排除目录覆盖 | 问"这条命令动什么、要不要确认" |
| [`specs/coverage-matrix.md`](specs/coverage-matrix.md) | **能力 × 分支 × 验证层矩阵（现状）**：某功能现在测没测、在哪一层测的、缺口在哪 | 问"某功能测没测" |
| [`specs/security-threat-model.md`](specs/security-threat-model.md) | 威胁模型与加固清单：已实施 / 剩余缺口 | 评估下载链路的安全边界 |

## records/ · 逐轮记录（**按轮追加，里面的数字与旧表述属"当时"**）

| 文档 | 讲什么 | 什么时候读 |
| --- | --- | --- |
| [`records/review-log.md`](records/review-log.md) | 2026-10-02 → 10-18 的**逐轮**记录（前期四轮为合并件，其后各轮逐条追加）：公共口径 + 各轮速览 + 各轮原文 | 想知道"某一轮改了什么、还有什么没做" |
| [`records/real-host-log.md`](records/real-host-log.md) | 真实 Obsidian 上的验收记录与结论（跨轮，§1–§12；§12 是 10-14→10-18 的**收拢索引**，细节仍看 review-log） | 想知道"在真宿主上验到什么程度" |
| [`records/round4-5-2026-09-28.md`](records/round4-5-2026-09-28.md) | 第 4–5 轮：四维复查 + 遗留方案的实施与最终复审 | 追溯 2026-09-28 那轮的修法 |
| [`records/coverage-audit-2026-09-28.md`](records/coverage-audit-2026-09-28.md) | 覆盖审计的**过程**：初始矩阵与缺口清单（§1–§7）、逐轮补齐（§8 起）、X02 专题（§9–§10）、设置界面与文案审计（§11–§14） | 问"这处缺陷以前是怎么修的"（**现状看 `specs/coverage-matrix.md`**） |

## archive/ · 历史归档（**只供追溯，不要引用其中的数字与结论**）

| 文档 | 讲什么 |
| --- | --- |
| [`archive/2026-09-repair-phases/`](archive/2026-09-repair-phases/README.md) | 2026-09-14 三阶段修复：总纲 + 逐阶段报告（含"**只有真实宿主才暴露的差异**"——`tests/README` §4.1「保真度注意」的源头） |
| [`archive/2026-09-16-audit-and-fixes.md`](archive/2026-09-16-audit-and-fixes.md) | 2026-09-16 全面质量审计 + A/B/C/D 批次修复记录（含"剔除的误报"——**子代理幻觉**的教训） |
| [`archive/2026-09-14-security-hardening.md`](archive/2026-09-14-security-hardening.md) | 安全加固四批实施记录（原威胁模型的附录 C–F） |
| [`archive/2026-10-13-docs-reorg.md`](archive/2026-10-13-docs-reorg.md) | 本次 `docs/` 重组的方案与执行记录：逐项决策、**新旧文件对照表**、与原计划的偏差、待触发项 |

## 四个容易踩的点

1. **别用"用例数"推断覆盖**。验收用例衡量的是**输入形态多样性**，不是功能分支矩阵；
   真正的判据在 [`specs/coverage-matrix.md`](specs/coverage-matrix.md) 的矩阵里。
2. **别凭文件时间戳判断内容时效**。同一篇在改动**之后**被追加过章节是常态
   （如 `records/real-host-log.md` 的 §10/§11、`records/coverage-audit` 的 §9–§14），
   时间戳不等于全文写于该日。**判"是否作数"看它在哪一层**（见文首的表）。
3. **当前规模只允许有一个权威来源**：`Attachment Suite/tests/README.md` 第 8 行。别的文档**不要再复制一份数字**——
   复制即漂移（2026-10-02 就是这么落后的：加了 11 个用例只同步了一处）。若确需在「规模」小节里再声明，
   必须**指向**它而非复制——`tests/unit/docs-consistency.test.ts` 会对账。
4. **只有一条链路：校验是发布的前置**。`.github/workflows/release.yml` 是仓库**唯一的自动化入口**
   （推送版本标签或手动触发），它按 `detect-version → verify → build-release` 串联：先做前置校验，
   再跑 `.github/workflows/verify.yml` 的 typecheck / test / build（ubuntu + windows 各一遍），
   **校验通过才**构建、签名并创建 Release。推 `main` 与 PR **不会**触发任何校验或构建——
   ⚠️ 所以**不要**给默认分支加"要求状态检查通过"的保护规则：那些检查不再在 PR 上运行，
   加了会让所有 PR 永久卡在"等待状态上报"。职责与权限的划分见 [`specs/invariants.md`](specs/invariants.md) §6。
   （手动触发时可选 `dry_run`：跑完校验与构建，但跳过签名与建 Release——验证链路不必真发一版。）

> 第 2、3 条与"当前有效文档清单"已由 `docs-consistency.test.ts` 机械看守——
> 它还校验本目录文档里引用的**文件与符号是否仍然存在**（防重构后引用失效）。
> 该守卫正是读**本文件的索引表**（上面 `## specs/` 与 `## records/` 两张）来确定"哪些文档算当前有效"，
> 所以新增 `specs/` 或 `records/` 文档时把它们登记进对应表，就等于把它们纳入了自动对账；
> `archive/` 表**不纳入**对账（历史数字本就该是旧的）。
