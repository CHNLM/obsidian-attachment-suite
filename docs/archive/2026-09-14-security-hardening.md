# 2026-09-14 安全加固实施记录（第一批 ~ 第四批）

> **性质：历史归档**——四批加固的实施记录（变更清单 / 验证结果 / 残留风险）。
> 原为 `security-threat-model.md` 的**附录 C–F**，2026-10-13 重组时拆出，
> 使威胁模型正文只保留"现状"（§1–§9 + 附录 A/B）。
> 其中的"当时的规模"与行号一概不代表当前状态；**加固现状见
> [`../specs/security-threat-model.md`](../specs/security-threat-model.md)**。

---

### 附录 C：实施记录（2026-09-14）

本次已完成 P0 中**可实施**的全部内容，并保留了两处**受 Obsidian API 能力限制而无法实施**的项。

#### 变更清单

| 文件 | 变更 |
|---|---|
| `src/features/localize-media-core.ts` | 新增 `hostOf` / `parseIPv4` / `isBlockedIPv4` / `isBlockedIPv6` / `isBlockedHost` / `isBlockedUrl` |
| `src/features/localize-media.ts` | 下载前 `HEAD` 预探体积（`probeContentLength` + 头字段兼容读取）；上限改用 `maxDownloadMb`；`runLocalizeNote` 增加内网拦截计数（后细化为 `blockedPrivate` / `blockedByPolicy`，`RunSummary` 同步为这两个字段）；`RunSummary` 增相应字段 |
| `src/features/automation.ts` | 自动化通知增加「拦截内网」提示分支 |
| `src/features/bulk-localize.ts` | 全库本地化预览排除被拦截项，避免「有外链但一个都没下」的误解 |
| `src/settings.ts` | `LocalizeSettings` 增 `blockPrivateHosts`（默认 `true`）、`maxDownloadMb`（默认 `100`） |
| `src/settings-tab.ts` | 「本地化」分区新增两个设置项（拦截内网与本机地址 / 单文件体积上限） |
| `tests/unit/features/localize-media-core.test.ts` | 新增主机安全策略 5 组用例（含进制/简写伪装与大小写、末尾根点） |
| `tests/e2e/fixture.ts` | `TEST_SETTINGS` 增 `blockPrivateHosts: false`（其本地服务为 127.0.0.1），并显式声明 `maxDownloadMb` |
| `tests/e2e/real-suite.test.ts` | 新增用例：开启拦截后指向 127.0.0.1 的外链被跳过且不落盘 |

#### 验证结果

- `npm run typecheck`：通过
- `npm test`：**24 个文件 / 291 个用例全部通过**（**当时的规模**；当前规模见 `tests/README.md` 第 8 行）
- `npm run build`：已重新产出 `dist/attachment-suite/main.js`

#### 残留风险（受 API 限制，未消除）

1. **重定向不可拦截**：`requestUrl` 无法禁用/观测 3xx 跳转。外部允许域 302 指向内网时，仍会命中内网。
   - 缓解建议：P1 引入 `allowHosts` 白名单模式，或改用可逐跳校验的传输实现。
2. **超时不可取消**：`requestUrl` 无 `signal` 参数，超时仅放弃上层等待，底层连接可能残留。
3. **DNS 重绑定不在覆盖内**：纯函数无法在下载前解析 DNS，`192.168.1.1.nip.io` 之类字面域名、以及解析到内网的普通域名均不会被拦截。

> 以上三条均已在源码注释中标注，避免后续维护者误以为已完全覆盖。

### 附录 D：第二批实施记录（2026-09-14 · P1-4）

决策：采纳「**彻底移除 `webpage` 类别**」——HTML 永不落存，且不提供开关。因插件**尚未发布**，不存在老用户，故**跳过** SCHEMA_VERSION 迁移。

#### 变更清单

| 文件 | 变更 |
|---|---|
| `src/settings-tab.ts` | 从 `CATEGORY_OPTIONS` 移除 `webpage`（附注释说明为何不提供死选项）；更新两处描述文案，点明「网页不会被下载保存」 |
| `src/settings.ts` | 默认 `allowedCategories` 移除 `webpage`；`categoryWords.webpage` **保留**并注释（仅供命名/整理库内已存在的 `.html` 附件） |
| `src/features/localize-media.ts` | 下载链路新增 `webpage` **硬跳过**（与 SVG 同级）；`RunSummary` 增 `skippedWebpage`；摘要通知如实报告「网页不落存 N」 |
| `src/features/automation.ts` | 自动化通知增加「网页不落存」分支与计数 |
| `README.md` | 本地化特性与设置清单同步（移除「网页」、补内网拦截与体积上限、修正原「SSRF 防护」措辞） |
| `tests/e2e/fixture.ts` | `TEST_SETTINGS.allowedCategories` 移除 `webpage` |
| `tests/e2e/real-suite.test.ts` | 测试服务器新增 `.html` 路由；新增用例「网页永不落存：引用被跳过、不产生 .html 附件」 |
| `tests/unit/settings-migration.test.ts` | 新增断言：默认白名单不含 `webpage`，且含 `blockPrivateHosts`/`maxDownloadMb` 默认值 |

#### 验证结果

- `npm run typecheck`：通过
- `npm test`：**24 个文件 / 293 个用例全部通过**（**当时的规模**；当前规模见 `tests/README.md` 第 8 行）
- `npm run build`：已重新产出 `dist/attachment-suite/main.js`

#### 设计说明（为何保留 `webpage` 这个枚举值）

`AttachmentCategory` 中的 `'webpage'` **未删除**，因为它是 `classify()` 对 HTML 的**真实识别结果**：
- 留着它，才能明确报告「识别为网页，按设计不落存」，而不是把 HTML 伪装成 `misc`；
- `attachment-index` 的 `categoryFromExt('html')` 与命名用 `categoryWords` 仍需要它，以便整理**库内已存在**的 `.html` 文件。

即：移除的是**用户侧的能力与开关**，保留的是**内容识别的保真度**。

### 附录 E：第三批实施记录（2026-09-14 · P1-5 / P1-6）

内容：**域名 allow/deny 白名单模式** + **速率与并发限制**。

#### 域名名单策略

- 新增纯函数（`src/features/localize-media-core.ts`）：`hostMatches`、`matchesAnyHost`、`evaluateHostPolicy`，以及类型 `HostPolicy` / `HostVerdict` / `HostDenyReason`。
- 判定顺序（先匹配先生效）：
  1. `denyHosts` 命中 → 拒绝（**优先级最高，可覆盖白名单**）
  2. `allowHosts` 命中 → 允许（**显式白名单可覆盖内网拦截**，便于自建内网图床）
  3. `blockPrivateHosts` 且命中私网/本机/保留地址 → 拒绝
  4. `hostAllowlistOnly` 且未命中白名单 → 拒绝
  5. 其余 → 允许
- 通配规则：`*.example.com` 匹配 `example.com` **及其所有子域**；`*` 匹配任意；模式与主机均忽略大小写、端口与末尾根点。
- 新增设置：`allowHosts`、`denyHosts`、`hostAllowlistOnly`（均默认关闭/空）。

#### 速率与并发

- `HostRateLimiter`（`localize-media-core.ts`）：**先预留时间槽、后等待**，因此并发数 > 1 时对同一主机的请求仍按最小间隔排开。
- 限速器实例挂在 `ObsidianDownloader` 上（插件级单例），故**全库本地化跨笔记持续生效**。
- `runPool`（`localize-media.ts`）：有界并发执行器，`maxConcurrent === 1` 时即严格串行（与改动前行为一致）。
- 附带修复：**同一 URL 在笔记中重复引用只下载一次**（此前会重复发起网络请求）；并处理并发下「不同 URL → 同内容 → 同一 MD5 文件名」的写竞争（目标已存在即视为成功，避免留下坏引用）。
- 新增设置：`perHostIntervalMs`（默认 0）、`maxConcurrent`（默认 1）。

#### 默认值说明（有意保持保守）

`perHostIntervalMs = 0`、`maxConcurrent = 1`。理由是**不改变既有行为**：默认即为「完全串行」这一最稳妥形态，限速间隔需显式开启才有意义；若希望默认更严格或更快，可直接调整这两个默认值。

#### 文档与测试

| 文件 | 变更 |
|---|---|
| `src/features/localize-media.ts` | `hostPolicyOf`、限速/并发接入、URL 去重、写竞争兜底、`RunSummary` 拆分 `blockedPrivate` / `blockedByPolicy` |
| `src/features/automation.ts` | 通知文案按「内网 / 名单」拆分 |
| `src/features/bulk-localize.ts` | 预览改用同一策略，避免预览数与实际不符 |
| `src/settings-tab.ts` | 新增 5 个设置项（白名单/黑名单/仅白名单/最小间隔/并发数）+ `splitList` 辅助 |
| `README.md` | 安全措施与设置清单同步 |
| `tests/unit/features/localize-media-core.test.ts` | 新增「域名名单策略」7 例 + 「同主机限速器」2 例 |
| `tests/e2e/real-suite.test.ts` | 测试服务器按路径区分内容；新增黑名单、仅白名单、并发下载、同 URL 去重共 4 例 |
| `tsconfig.json` | `include` 纳入 `tests/**/*.ts` 与 `vitest.config.ts`（见下方「顺带修复」） |
| `src/core/path-compatibility.ts` | `PathCompatProfile.platforms` 放宽为 `readonly Platform[]` |
| `tests/e2e/infrastructure.ts` | 补齐 `ObsidianModule.requestUrl`、`TestAppHandle.getCommands/getEventHandlers`；清理未使用成员 |
| `tests/unit/**` | 补齐夹具字段、显式标注类型、删除未使用变量 |

#### 验证结果

- `npm run typecheck`：通过
- `npm test`：**24 个文件 / 306 个用例全部通过**（**当时的规模**；当前规模见 `tests/README.md` 第 8 行）
- `npm run build`：已重新产出 `dist/attachment-suite/main.js`

#### 顺带修复：`typecheck` 未覆盖测试代码（已处理）

**问题**：`tsconfig.json` 的 `include` 原为 `["src/**/*.ts"]`，故 `npm run typecheck` **完全不检查 `tests/`**——测试里的字段名拼错、类型不匹配都不会被发现（本次实施中即发生过：把 `allowlistOnly` 误写成 `hostAllowlistOnly`，typecheck 通过，靠测试运行失败才发现）。

**处理**：修复全部 24 处既有类型问题后，把 `tests/**/*.ts` 与 `vitest.config.ts` 纳入 `include`。

修的问题分三类：

| 类别 | 具体 | 处理 |
|---|---|---|
| 测试替身的类型定义不完整 | `ObsidianModule` 缺 `requestUrl`；`TestAppHandle` 缺 `getCommands` / `getEventHandlers` | 补齐接口成员（而非加 `any` 掩盖） |
| 源类型过严 | `PathCompatProfile.platforms` 为 `Platform[]`，导致测试传 `as const` 字面量数组不通过 | 改为 `readonly Platform[]`（函数只读消费，类型放宽无破坏性） |
| 测试自身缺陷 | `NamingSettings` 夹具缺 `folderByCategory`；5 处回调参数隐式 `any`（根因是 `items` 被推断为 `any`）；`PluginManifest` 缺必填字段；若干未读变量/参数 | 补齐字段、显式标注 `items: string[]`、删除或改名未使用符号 |

**验证**：把 `allowlistOnly` 改回错误拼写后，`npm run typecheck` 会报
`error TS2561: ... 'hostAllowlistOnly' does not exist in type 'Partial<HostPolicy>'. Did you mean to write 'allowlistOnly'?` —— 缺口确已闭合。

### 附录 F：第四批实施记录（2026-09-14 · P1-7 / P1-8）

#### P1-7 · `data:` URI 解码前尺寸预判

- 新增 `estimateDataUriBytes(uri)`（`localize-media-core.ts`）：base64 形式按「4 字符 → 3 字节，减填充」**精确**预估；非 base64（百分号编码文本）无法在不解码的前提下给出可靠上界，返回 `null` 表示「无法预判」。
- `download()` 的 `data:` 分支在 `decodeDataUri` **之前**调用它，超限直接跳过；解码后的 `maxBytes` 校验保留为兜底。
- **设计取舍**：非 base64 形式不预判，是因为要拦「过大」就得给出**上界**，而 UTF-8 文本的上界（3 字节/字符）会把 40MB 的 ASCII 载荷误判为 120MB。宁可放弃这一侧的优化，也不误杀合法载荷。

#### P1-8 · 预览中可查看并定位被拦截的引用

**起因**：原方案（预览里列出待访问的域名）经评估属**过度设计**——域名可能数十上百个、用户看完唯一动作是取消、且与已实现的 `hostAllowlistOnly` 功能重叠。

**改为**：如实列出**被拦截的每一条引用**，并让它可点击定位。

| 文件 | 变更 |
|---|---|
| `src/modals.ts` | `ConfirmChangeRow` 增 `onClick?`；`ConfirmChangesOptions` 增只读分区 `blocked?: { title, items }`；行渲染抽为 `renderRows()` 并支持可点击行 |
| `src/reveal-ref.ts` | **新增**：`revealRefInNote` 从 `commands.ts` 抽出，供命令报告与预览弹窗共用（同时消除 features→commands 的循环依赖风险） |
| `src/features/bulk-localize.ts` | 预览阶段逐条记录被拦截项（`BlockedRef`：原因/URL/来源笔记），存入确认弹窗的 `blocked` 分区；**全部外链都被拦截时改开只读清单**，修正原先误报「没有可本地化的引用」 |
| `styles.css` | 新增 `.iap-confirm-row-clickable` / `.iap-confirm-section-title` / `.iap-confirm-list-blocked`（虚线边框暗示「这些不会被改动」） |

**顺带修正的体验缺陷**：原先若所有外链都被拦截，预览只显示「全库没有可本地化的外部引用」——用户完全不知道是设置拦掉了。现在会打开只读清单逐条列出，与全项目「不静默丢弃」的原则一致。

#### 测试与验证

| 文件 | 变更 |
|---|---|
| `tests/unit/features/localize-media-core.test.ts` | 新增「data URI 尺寸预判」4 例，含**预估值 == 实际解码字节数**的对照断言、非 base64 返回 `null`、畸形输入不抛错 |
| `tests/e2e/real-suite.test.ts` | 新增 2 例：①预览列出被拦截项且**点击行真的打开了来源笔记**；②全部被拦截时打开只读清单 |
| `tests/e2e/infrastructure.ts` | 测试替身补 `MarkdownView`、`workspace.getLeaf()`（记录被打开的笔记路径 `openedNotePaths`）；`FakeEl` 增 `setAttribute`/`getAttribute`，并让 `addClass` **按空白拆分**（否则 `"a b"` 形式的多类名无法被 `querySelectorAll` 匹配） |

- `npm run typecheck`：通过（已覆盖 tests/）
- `npm test`：**24 个文件 / 312 个用例全部通过**（**当时的规模**；当前规模见 `tests/README.md` 第 8 行）
- `npm run build`：已重新产出 `dist/attachment-suite/main.js`

> 说明：「点击定位」在 E2E 中通过**替身记录被打开的笔记路径**来断言（已实测通过）；在真实 Obsidian 中打开标签页并滚动到引用处，建议实机确认一次。
