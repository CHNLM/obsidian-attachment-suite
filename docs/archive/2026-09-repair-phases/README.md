# 2026-09 三阶段修复（历史归档）

> **性质：历史归档**——2026-09-14 前后那一轮"测试与修复"的过程记录（总纲 + 逐阶段报告）。
> **只供追溯"某处改动为什么这么做"，不要引用其中的数字与结论**：用例数（77/82）、
> 文件数（29/31）、默认值、行号等**全部是当时的值**，且当时的缺陷**绝大多数已修**。
>
> 要看**现状**，请去：
> - 覆盖情况 → [`../../specs/coverage-matrix.md`](../../specs/coverage-matrix.md)
> - 规则与不变式 → [`../../specs/invariants.md`](../../specs/invariants.md)
> - 后续各轮复查 → [`../../records/review-log.md`](../../records/review-log.md)、
>   [`../../records/round4-5-2026-09-28.md`](../../records/round4-5-2026-09-28.md)
> - 测试正本 → [`Attachment Suite/tests/README.md`](../../../Attachment%20Suite/tests/README.md)

## 本目录内容

| 文件 | 讲什么 | 独有价值 |
|---|---|---|
| [`test-repair-plan.md`](test-repair-plan.md) | 三阶段总纲：目标与门禁、缺陷分级、作业红线（"六种手段"），以及核查项 `A1–A30` / `B1–B34` | **方法论**：那套"逐命令 × 9 维"的核查框架仍可复用 |
| [`review-phase1.md`](review-phase1.md) | 一阶段：当前笔记级 4 命令 + 依赖 core 的审查与修复 | 早期缺陷的形态样本 |
| [`review-phase2.md`](review-phase2.md) | 二阶段：9 条全库级命令 + 自动化 + 索引/性能 | 安全专项矩阵的**初版**（后升级为 `safety-suite`） |
| [`review-phase3.md`](review-phase3.md) | 三阶段：验收用例库 + 生成器 + harness 版与真实 Obsidian 的全量验收 | ⭐ **"只有真实宿主才暴露的差异"**——harness 与真宿主的四处能力差异，是 `tests/README.md` §4.1「保真度注意」的源头 |

## 一句话

这四篇的价值**不在结论**（早被覆盖），而在**方法**与**缺陷形态样本**：
贯穿其中的两条教训——"**两层口径不一致**"与"**替身替插件兜底**"——后来都变成了守卫
（`architecture.test.ts` / `safety-suite` / `acceptance-tooling`）。
