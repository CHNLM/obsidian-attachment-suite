# 批次 E 价值与必要性评估（2026-09-16）

前置：`audit-2026-09-16.md`（问题来源）、`fix-record-2026-09-16.md`（A+B+C+D 已实施）。
本文只做**判断**，不改代码。所有结论基于当场实测，数据与命令附在各项下。

---

## 0. 结论速览

| 子项 | 必要性 | 价值 | 成本（实测） | 风险 | 建议 |
|---|---|---|---|---|---|
| **E1** features 互引收敛 | 中 | 中—高 | 低（搬 ~35 行 + 6 处 import） | 低（有验收网） | **做** |
| **E2** 重复工具函数收敛 | 中 | 中—高（含 1 处已存在的实现分歧） | 低—中 | 低—中（有 1 处行为敏感点） | **做** |
| **E3a** 死代码：`result.ts` / `isCategory` | 低 | 低—中 | 极低 | 极低 | 做（`result.ts` 需你拍板，见 §3.1） |
| **E3b** 死配置：`desktopOnly` | 低 | 低 | 极低 | 极低 | 做 |
| **E4a** `noImplicitOverride` | 中 | 中 | 低（14 处机械改） | 极低 | **做** |
| **E4b** `noFallthroughCasesInSwitch` | 低 | 低 | **0（当前 0 错误）** | 无 | 顺手开 |
| **E4c** `noUncheckedIndexedAccess` | 低 | 低 | **极高（187 处）** | 中（大量 `!` 会掩盖真问题） | **不做** |
| **E5** 生产 `console.*`（11 处） | 低 | 低—中 | 极低 | 极低 | 做，但**转 logger 而非删除**（§4.5） |
| **E6** `notify.ts`/`reveal-ref.ts` import obsidian | **不成立** | — | 0 | — | **不改代码**，只订正约定表述（§4.6） |

**总体判断**：批次 E 里真正"必要"的只有一部分；它的价值主要不是修当下的缺陷（**实测当前无任何由这些项引起的活故障**），而是**关掉历史最贵缺陷的复发通道**，并把几条"约定写了但没人守"的规则变成机器可验的。成本比审计报告里的印象低得多——因为 E1 实测只是"搬 35 行 + 改 6 处 import"，不是大重构。

---

## 1. E1 · features 互引（原判 P1）

### 实测：8 条跨 feature 边，但不是均匀分布

```
collect.ts       → link-fixer         (refMapForMoves, rewriteRefsInNote, rewriteRefsSafely)
consistency.ts   → link-fixer         (rewriteRefsInAllNotes, rewriteRefsSafely)
bulk-collect.ts  → link-fixer         (refMapForMoves, rewriteRefsInNote)
note-relocator.ts→ link-fixer         (refMapForMoves, rewriteRefsInNote)
name-formatter.ts→ link-fixer         (refMapForMoves, rewriteRefsInNote, rewriteRefsSafely)
automation.ts    → localize-media, name-formatter
bulk-rename.ts   → name-formatter
bulk-localize.ts → localize-media
```

（另有 12 条 feature → 自己的 `*-core`、2 条 core → 兄弟 core，都正常，不计入。）

### 关键发现：8 条边里有 5 条指向同一个目标

`link-fixer` 是唯一的"被当共享执行工具用"的模块。而它内部其实已经分好了家：

| 内容 | 性质 | 现位置 | 应该在哪 |
|---|---|---|---|
| `refMapForMoves`（8 行，纯函数） | core | `features/link-fixer-core.ts` | `core/link-resolver.ts` |
| `rewriteRefsSafely` / `rewriteRefsInNote` / `rewriteRefsInAllNotes`（~35 行，依赖 `App`） | infra | `features/link-fixer.ts` | `obsidian-domain.ts` |

`obsidian-domain.ts` **已经在**承担这类角色：`ensureFolder`、`effectiveAttachmentFolder`、`resolveAttachmentDirForNote` 就住在那里（features 已经在从它 import）。所以这不是"新建层级"，而是**把放错地方的东西放回已有的家**。

改完的结果：`features/link-fixer.ts` 与 `features/link-fixer-core.ts` 可整体删除，2 个文件消失、6 处 import 改向，跨 feature 边从 8 条降到 3 条。

### 剩下 3 条不该消灭

`automation → 单篇`、`bulk-rename → name-formatter`、`bulk-localize → localize-media` 是**纵向编排**（上层批处理/自动化驱动下层单篇执行），不是横向共享工具。把它们也"消灭"只是换个地方声明同一个依赖，属自欺。

**零循环**：实测无任何 import 环（`link-fixer` 不反向依赖任何 feature），所以今天不存在运行时隐患。

### 必要性判断

- **不是**在修 bug——实测无环、无故障。
- **是**在防一类可预见的退化：`link-fixer` 现在是事实上的"共享执行模块"，继续长大就会变成谁都依赖、谁都不敢改的中心点，而它同时又要 import 兄弟 feature 的具体实现（`safe-move-engine` 语义等），很容易长出环。
- 成本极低（35 行搬家），且被真实验收网覆盖（13 命令 ×2 遍 + 10 条语义不变式），**风险/收益比是批次 E 里最好的**。

---

## 2. E2 · 重复工具函数（原判 P2，实测比报告更严重）

### 实测：`basenameOf` 有 **7 份**实现

```
core/attachment-index.ts:484   |  features/broken-link-core.ts:57
features/bulk-rename-core.ts:66 |  features/unused-cleaner.ts:123
features/link-fixer-core.ts:23 |  features/note-relocator-core.ts:15
features/name-formatter.ts:127
```

逐份比对：**语义完全等价**（只有变量名差异）→ 当前无故障，纯重复。

另有：`decodeLink` ×2（等价）、路径归一化 ×3（`normalizeInVault` / `normalizeJoin` / `normalizeLocal`，等价）。

### 一处例外，而且是这次评估最值得说的发现：`extOf` 两份实现**不等价**

```
core/types.ts:105           const i = path.lastIndexOf('.');          ← 对整条路径找最后一个点
features/broken-link-core.ts:67  先取 basename 再找点
```

实测差异：

| 路径 | core 版 | broken-link 版 |
|---|---|---|
| `assets/a.png` | `"png"` | `"png"` |
| `ARCHIVE.PNG` | `"png"` | `"png"` |
| `docs/v1.2/README` | **`"2/readme"`** | `""` |
| `assets/a.png/file` | **`"png/file"`** | `""` |
| `notes/my.folder/file` | **`"folder/file"`** | `""` |

**core 那份是错的**：目录名里带点、而文件名没有扩展名时，它返回一段垃圾串。

**当前为什么没出事**：所有调用点要么传 basename（`attachment-index.ts:85/351/353`、`:198`），要么传的一定是带扩展名的受管附件路径（`name-formatter-core.ts:180/197`、`localize-media-core.ts:69`）。垃圾串喂给 `isManagedAttachment` 恰好也是 `false`，即"期望的排除结果"蒙对了。

**但有一个行为敏感点，必须点名**：`broken-link-core.ts:223` 是 `if (!extOf(r.linkText))`——用"extOf 为空"来判定"这是无扩展名的短名引用"（`[[pic]]` 那条 wiki 分支）。而 `r.linkText` 可能是**完整相对路径**（`docs/v1.2/README`）。若"去重"时天真地把这里换成 core 版 `extOf`，空串变 `"2/readme"`（真值）→ **该分支不再进入** → wiki 短名处理逻辑被静默改掉。

→ 结论：**E2 不能是"无脑 import core 的版本"**。正确顺序是：先把 core 的 `extOf` 修成 basename 语义（对 core 现有调用点行为中性），再把 7 份副本收敛到它，并对 `broken-link-core.ts:223` 单独核对与补测。

### 必要性判断

- 单看"7 份一模一样的 3 行函数"，很容易判成"纯洁癖，不做"。
- 但这个仓库**历史上 4 次误删级缺陷全部源自"同一件事有两份实现，后来只改了一份"**。`extOf` 已经出现分歧（还没发作而已），`basenameOf` 7 份就是 7 个待发点。
- 所以 E2 的性质是**降低未来最贵那类缺陷的概率**，不是美化代码。这也是它比 E5/E6 更值得做的原因。

---

## 3. E3 · 死代码 / 死配置

### 实测（命令与结果）

| 项 | 引用情况 | 判定 |
|---|---|---|
| `core/result.ts`（`Result`/`PluginError`/`ok`/`err`，52 行） | 除 `core/index.ts` 的 re-export 与自身单测外，**运行时代码 0 引用** | 真死 |
| `type-classifier.ts:222` `isCategory` | 仅被自己的单测使用，生产 0 引用 | 真死 |
| `settings.ts:27,153` `localize.desktopOnly` | 仅声明 + 默认值 + 3 处测试 fixture，**运行时 0 读取** | 真死配置 |

### 3.1 `result.ts` 是本次唯一需要你拍板的项

- **删除的理由**：README 现已如实写明"执行层目前以异常 + 统一反馈处理，迁移到 Result 属后续计划"。既然运行时不使用，留着它会让"文档描述的设计意图"与"代码里的闲置模块"并存，读者仍会误判错误模型已落地；它的单测还会提供**虚假的"错误模型有覆盖"信号**；插件未发布，无兼容负担；真要做迁移时，重写这 52 行比复用更省事（现有类型未必贴合届时需求）。
- **保留的理由**：它是"设计已想清楚"的证据，删了等于丢掉意图；且删除要连带改 README，多一次往返。
- **我的建议：删除**。但因为它涉及"要不要放弃一条既有设计路线"，属判断题而非缺陷题，**留给你决定**。

`isCategory` 与 `desktopOnly` 无争议，直接删（`desktopOnly` 要同步 3 处 fixture：`acceptance-fixture.ts:187`、`fixture.ts:31`、`scale.test.ts:48`）。

### 必要性判断：低

这三项**不修也不会坏**。收益是减少误读与虚假信心，成本极低，属"顺手做掉"。

---

## 4. E4 / E5 / E6

### 4.1 E4a `noImplicitOverride` —— 建议开

实测 **14 处**错误，全部集中在 5 个 `src/` 文件（`modals.ts` 6、`main.ts` 3、`unused-cleaner.ts` 2、`empty-folder-cleaner.ts` 2、`settings-tab.ts` 1），都是 `Modal.onOpen/onClose`、`Plugin.onload/onunload` 的 override。修法是加 `override` 关键字，机械且零语义变化。

价值不在"现在有 bug"，而在于：Obsidian 升级时若基类方法改名/消失，**没有 `override` 时你的方法会静默变成普通方法**（永远不被调用、也不报错）——这正是插件最典型的一类"升级后才炸"的故障。14 处换这个保障，划算。

### 4.2 E4b `noFallthroughCasesInSwitch` —— 顺手开

实测 **0 处**错误。零成本，纯防未来。

### 4.3 E4c `noUncheckedIndexedAccess` —— 建议**不开**

实测 **187 处**错误，分布很散：

```
src/features/localize-media-core.ts  40      tests/unit/**（6 个文件）        51
src/core/link-resolver.ts            12      tests/e2e/**（4 个文件）         18
src/core/attachment-index.ts         13      src/modals.ts                    7
src/core/hasher.ts                   10      src/features/broken-link-core.ts 5
src/core/type-classifier.ts           9      src/features/name-formatter-core.ts 5
src/core/zip.ts                       8      src/settings-tab.ts / localize-media.ts 各 1
```

不开的理由不只是"量大"：

1. **错误的性质决定了修法只能是噪音**。40 处里很大一部分在 `hasher.ts`/`zip.ts`/`type-classifier.ts`——那里按字节/数组下标访问是**本质不受检**的（循环内 `arr[i]` 必然有值），只能加 `!`。187 个 `!` 会把真正需要判空的少数位置一起淹掉，**净效果是降低可读性与信噪比**。
2. **一半错误在 tests/ 里**（69 处）。为迁就类型系统去改断言写法，属于让测试伺候编译器。
3. 现有替代手段已在位：`strict` + `noImplicitAny` + `noImplicitReturns` + `noUnusedLocals/Parameters` 已开，而真正高危的索引访问点（`exact.values().next().value as string` 之类）审计时已单独确认过有 `size === 1` 前置保护。

如果确实想要：可行中间路是**只对 `src/core/**` 单独一份 tsconfig 开启**（约 52 处）。但其中 `hasher`/`zip`/`type-classifier` 占 27 处，同样以噪音为主，**性价比依然不高**，我不推荐。

### 4.4 E5 `console.*` 残留 —— 做了，但方式是"转 logger"而非删除

实测 11 处（`main.ts` 8 处、`automation.ts` 3 处；`logger.ts:12` 那处是 logger 自身的 sink，正常）。

**不建议直接删。** 其中 `main.ts:51/82/85` 的加载诊断是作者为"排查代码到底有没有真的加载"刻意留的（`onload OK, automation=…` 这种），删掉等于拿掉一个真实有用的排查手段。正确做法是**改走 `logger.debug/info`**：保留能力，同时受 `setLogLevel` 门控，默认不再往控制台刷噪音。`automation.ts:41/52` 的高频逐次日志同理。

（顺带说明 `logger.ts` 目前没有把 `minLevel` 跟设置项联动、也没有暴露开关；若要彻底安静，可在该模块补一个"由 `__OBSIDIAN_TEST` 或开发者模式决定"的默认级别——但这属新能力，需你确认是否要。）

### 4.5 E6 `notify.ts` / `reveal-ref.ts` 直接 import obsidian —— **判定为不成立**

实测 **21 个 `src/` 模块**直接 import `obsidian`（`commands.ts`、`modals.ts`、`settings-tab.ts`、`main.ts`、17 个 feature 执行层……）。这不是偏差，**这是执行层的本分**。

把 `obsidian-domain.ts` 描述成"唯一适配层"是**约定表述过严**——它的真实职责是"把 `App` 包装成 `core` 所需接口"（`VaultAdapter`/`MetadataProvider`/`FileOps`），而不是"禁止其它模块 import obsidian"。

真正有意义、且**实测成立**的边界是：**`src/core/` 零 `obsidian` 依赖**（已实测确认 ✓）。README 在批次 D 已订正为"`core` 不依赖任何 Obsidian 相关模块"。

→ 代码不动，把约定表述再收紧一次即可（顺带写进守卫，见 §5）。

---

## 5. 顺手该做的一件"配套件"：架构守卫

E1/E2/E4 都是"把规则落成一次改动"。**如果只改代码不加守卫，几个月后会漂移回去**——这正是本仓库过去的模式。建议配一条测试（放 `tests/unit/`，随 `npm test` 跑，成本约 30 行）：

1. `src/core/**` 不得 import `obsidian`；（实测 0，锁死）
2. `src/features/**` 不得 import 兄弟 feature 的**执行层**（只允许同 `*-core` 与 infra/core）；（E1 后实测 0，锁死）
3. `src/**` 不得再出现自定义的 `basenameOf` / `extOf` / `decodeLink` / 路径归一化实现；（E2 后锁死）

这条守卫是本批次性价比最高的产物——它让"可长期维护性"从"靠自觉"变成"CI 拦住"。

---

## 6. 建议方案

**建议做（按此顺序）**

1. **E1 互引收敛**（搬 35 行 + 6 处 import，删 2 个文件）
2. **E2 重复函数收敛**（先修 core `extOf`，再收敛 7+2+3 份；`broken-link-core.ts:223` 单独补测）
3. **E4a + E4b 严格选项**（14 处 + 0 处）
4. **E5 转 logger**（11 处）
5. **E2b `isCategory` + `desktopOnly` 清理**
6. **架构守卫测试**（§5）
7. **`result.ts` 依你的决定**（§3.1）

**建议不做**

- `noUncheckedIndexedAccess`（187 处，以噪音为主）
- E6 的任何代码改动

**规模预估**：上述 1–6 属"一次改完可验收"的量级，远小于批次 A+B+C+D；`src/` 实际改动约 60 行净增/搬移，其余是删除。

**验收方式**（沿用既定约定）：`npm run typecheck` + 关联测试（单测 + `real-suite` / `report-accuracy` / `safety-suite` / `acceptance` / `scale` / `settings-tab`），不跑全量、不跑真实宿主。
