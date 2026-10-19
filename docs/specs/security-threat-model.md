# Attachment Suite 威胁模型与加固清单

> 对象：Obsidian 插件 **Attachment Suite**（`attachment-suite` v1.0.0，桌面端 `isDesktopOnly`）
> 范围：媒体本地化（下载）链路的网络安全与数据安全；兼及清理 / 导出等破坏性操作的数据安全
> 性质：评估用文档（面向维护者与安全评审）
> 定位说明：本文按**文件 + 符号名**定位（如 `localize-media.ts` 的 `probeContentLength`），
> **不写行号**——行号会随重构漂移，写进来就等于留一张长期错的表（2026-10-13 复查时，
> 原附录 A 的十处行号已全部失效）。另注：只有写成**不带 `:行号` 的裸路径**，才会被
> `docs-consistency.test.ts` 的"文件仍然存在"守卫扫到——带行号反而逃过机械对账。
> 结论速览：**整体风险 = 中低**。无远程可利用的 RCE；主要暴露面是「不可信笔记/粘贴内容 → 自动发起 HTTP 请求」带来的 **隐私泄露、内网可达（LAN 副作用）、资源耗尽** 三类。
> 关于「SSRF 防护」：按经典定义（对任意 URL 兜底、含 DNS 解析后校验与逐跳重定向校验）**并不成立**；但已实施**字面主机维度的私网/回环/保留地址拦截**（`isBlockedHost`，经 `evaluateHostPolicy` 生效，默认开，可关闭），并提供了「仅允许白名单」这一从根上收敛的选项。剩余缺口见 T2/T3（DNS 重绑定、重定向逐跳）。

---

## 1. 系统与数据流

### 1.1 运行形态

插件运行在用户桌面上的 Obsidian（Electron）内。网络请求经 `requestUrl` 从 **Obsidian 主进程**发出，即请求源 = 用户本人的网络位置，**不存在多租户的中间服务端**。

### 1.2 关键数据流（本地化）

```
库内笔记（md/canvas）
   │  正文中的 "![]($url)" / （可选）"[t]($url)" / "<img src=$url>"
   ▼
findExternalRefs()            仅接受 http(s) / data
   ▼
ObsidianDownloader.download() HEAD 预探体积 → 重试 tryCount 次；minSizeKb 下限；maxDownloadMb 上限（下载前拦截 + 事后复核）
   ▼
requestUrl({url})             主进程 GET；超时用 Promise.race 兜
   ▼
classify(data)                内容魔数识别；SVG 直接拒；类别白名单过滤
   ▼
vault.createBinary(dir/name)  写盘为附件（name 由 MD5 或 sanitizeFilename 提示名生成）
   ▼
applyRefReplacements()        正文引用改写为本地路径
```

### 1.3 资产

| 资产 | 说明 |
|---|---|
| 用户库内容 | 笔记与附件，含可能的敏感信息 |
| 用户网络位置 | IP、内网拓扑、可达的内网服务 |
| 本机可达端点 | `127.0.0.1` 上的本地服务、局域网设备、云元数据 `169.254.169.254` |
| 库完整性 | 清理 / 导出 / 改名等破坏性操作的目标 |

---

## 2. 信任边界分析：为什么不是经典 SSRF

经典 SSRF 成立需要 **三个角色分离**：攻击者提供 URL → **特权服务端**代请求 → 攻击者读回内网结果。

本插件的角色映射：

| 角色 | 经典 SSRF | Attachment Suite |
|---|---|---|
| 请求发起方 | 有内网特权的服务器 | **用户自己的桌面**（与浏览器同等的网络能力） |
| 结果去向 | 回显给攻击者 | 写到**用户自己的库**，无自动外传 |
| 信任边界 | 公网→内网 | **不存在**（本机访问本机/内网不构成越权） |

**判定**：由于缺少「特权服务端」这一环，插件未赋予攻击者任何**超出用户自身网络权限**的能力，故**不构成典型 SSRF**。README 曾把它称作「SSRF 防护」——那是**借用词**，已按第 7 节改写为如实的中文表述（"下载具备安全措施：拦截本机/内网/保留地址……"），现全文不再出现该词。

但「不是经典 SSRF」≠「无风险」。真正成立的是下面这份威胁清单。

---

## 3. 威胁清单

> 评级说明：**严重度** = 影响×可恢复性；**可利用性** = 触发难度×前置条件。
> 「现状」均基于对 `src/` 源码的实测阅读。

### T1 命中本机 / 内网 / 链路本地端点
- **严重度**：中 ｜ **可利用性**：中 ｜ **状态**：**已缓解**
- **路径**：不可信笔记正文写 `![](http://127.0.0.1:PORT/...)`、`![](http://192.168.1.1/reboot)`、`![](http://169.254.169.254/latest/meta-data/)`；用户编辑该笔记或执行「本地化全库附件」即触发。
- **影响**：向本机/内网/路由器发出 GET。现代设备改状态多需 POST + token，故**直接破坏概率低**；但可造成**内网探测**（按响应差异推断端口/服务存活）与**带副作用的 GET 端点**被误触。
- **现状**：默认开启的**内网/本机/保留地址拦截**（`isBlockedHost`，含进制与简写伪装）已在下载前跳过，不发起请求并计入「内网」拦截数。进一步收敛可用**仅白名单模式**。
- **备注**：`169.254.169.254` 在**云端 Windows/Linux 机器上**运行 Obsidian 时才会返回真实元数据；个人笔电上通常不可达。

### T2 内网响应内容被落盘进库
- **严重度**：中 ｜ **可利用性**：低 ｜ **状态**：**基本闭合**（webpage 通道已硬跳过；纯文本 / JSON 通道被「受管扩展名白名单」挡下；残余仅 Office 文档）
- **路径**：`classify()` 对 `text/html` 归为 `webpage`（下载链路**硬跳过**）；对 `text/plain` 归为 `document`。但落盘前还有 `isManagedAttachment()` 闭合校验——`txt` 不在受管名单内，故纯文本 **不落盘**（网络请求仍会发出，计入「跳过非受管类型」）。
- **影响**：内网接口返回的 **JSON / 纯文本不会被存进库**。能落盘的只剩受管名单内的 **Office 文档**（docx/xlsx/pptx），该通道仍开，随同步/分享/导出被带走——构成一条「内网内容 → 库 → 外带」的读取通道。
- **残余**：`document` 类别同时覆盖 docx/xlsx/pptx，贸然移出类别白名单会误伤 Office 文档，故**不宜用类别白名单解决**。
- **缓解**：开启**「仅允许白名单中的域名」**（`hostAllowlistOnly`）后，未列入白名单的域（含内网主机）根本不会发起请求，该通道即被封堵。

### T3 外部追踪像素泄露隐私
- **严重度**：中 ｜ **可利用性**：中 ｜ **状态**：**部分缓解**（可用黑名单/白名单规避）
- **路径**：笔记含 `![](https://attacker.example/px?u=..)`，自动本地化时用户机器的 **IP、UA、打开时间** 暴露给第三方。
- **影响**：纯隐私泄露；与内网无关，但**最容易真实发生**（共享库/模板/同步笔记场景）。
- **缓解**：`denyHosts` 可屏蔽已知追踪域；**「仅允许白名单」模式**可从根上只放行可信域。

### T4 大响应导致的资源耗尽（下载前预探 + 事后复核）
- **严重度**：中 ｜ **可利用性**：中 ｜ **状态**：**已加固（残余风险见下）**
- **成因**：响应仍由 `requestUrl(...).arrayBuffer` **一次性读进内存**（该 API 不提供流式读取），故无法给出严格的内存上界。
- **已实施**：`probeContentLength()`（`localize-media.ts`）在 GET 之前先用 `HEAD` 读取 `Content-Length`，超过 `maxDownloadMb` 即中止（`ObsidianDownloader.download()` 内）；`data:` URI 另有 `estimateDataUriBytes()` 在 base64 解码前精确预估；GET 返回后仍按同一上限复核。重试次数由 `tryCount` 封顶。
- **残余风险**：服务器**不声明** `Content-Length`（分块传输 / 流式响应 / 拒绝 HEAD）时无从预判，仍需把响应整体读入后再判断——此时内存峰值由单次响应体决定。缓解手段：调小 `maxDownloadMb`、开启「仅允许白名单」，或把 `maxConcurrent` 保持为 1。

### T5 超时不取消底层请求
- **严重度**：低 ｜ **可利用性**：中 ｜ **状态**：**弱防护**
- **成因**：`localize-media.ts` 的 `fetchHttp` / `probeContentLength` 里，`Promise.race([requestUrl, setTimeout(resolve(null))])` 仅让**上层提前返回 `null`**，`requestUrl` 的底层连接/读取 **并未被 abort**。
- **影响**：慢速端点会持续占用 socket/内存；批量处理时并发挂起，表现为「已跳过但仍在跑」。

### T6 下载内容作为 HTML 落盘（存储型风险）
- **严重度**：低-中 ｜ **可利用性**：低 ｜ **状态**：**已消除**
- **路径**：`text/html` 响应曾被存为 `.html` 附件（因默认类别白名单含 `webpage`）。
- **现状**：已**彻底移除**该能力——`webpage` 不再出现在类别白名单与设置面板，识别为 `webpage` 的下载一律**硬跳过**（与 SVG 同级），并计入「网页不落存」计数如实报告，避免静默丢弃。

### T7 重定向绕过（依赖底层行为，待验证）
- **严重度**：中 ｜ **可利用性**：中 ｜ **状态**：**部分缓解**（初始主机受校验；白名单模式可根治）
- **说明**：若 `requestUrl` 自动跟随 3xx（Obsidian 基于 Electron `net`，**大概率跟随**——需实机确认），则「先请求 `https://allowed.example/x`，再 302 跳到 `http://127.0.0.1/...`」可**绕过基于初始 URL 的主机校验**。
- **现状**：`requestUrl` 既不能禁用、也不暴露最终 URL，故跳转链仍不可逐跳校验。**但开启「仅允许白名单中的域名」后，跳转目标内网已无所谓**——初始 URL 必须命中白名单才发起请求，通配白名单可收紧到具体域。
- **结论**：处理来源不可信的库时，建议启用白名单模式；否则该残留风险仍在。

### T8 `data:` URI 巨型载荷本地解码
- **严重度**：低 ｜ **可利用性**：低 ｜ **状态**：**已缓解**
- **成因**：`ObsidianDownloader.download()` 的 `data:` 分支曾**先解码、后判超限**——`decodeDataUri` 对 base64 做全量 `atob`，再逐字节复制出一份 `Uint8Array`；体积校验（`maxDownloadMb`）发生在解码完成之后，故拦不住解码这一步的分配。
- **影响**：巨型内联 data URL 会造成瞬时额外内存占用（约 2 倍载荷）。
- **现状**：已在解码前加入 `estimateDataUriBytes` 预判（base64 精确），超限直接跳过、不再解码；解码后的 `maxBytes` 校验保留为兜底。
- **修正**：体积上限**一直是有的**（`data:` 分支同样走 `maxDownloadMb`），早期表述「无大小上限」不准确。且载荷本身已在内存中（笔记文本为扫描已被整体读入），故放大倍数有限、并非无界。

### T9 无速率限制 / 无主机级并发上限
- **严重度**：低 ｜ **可利用性**：中 ｜ **状态**：**已缓解**
- **路径**：一篇笔记塞 N 个外链，或全库本地化遍历全部 md。
- **影响**：批量打点、对第三方造成请求洪泛、拖慢应用。
- **现状**：新增**同主机最小间隔**（`perHostIntervalMs`）与**并发上限**（`maxConcurrent`，默认 1 即完全串行）；同一 URL 重复引用只下载一次。默认即为最保守（串行、不限速的等待成本为 0），需要更严格礼貌策略时可调高间隔。

### T10 文件名路径穿越
- **严重度**：— ｜ **状态**：**已缓解**
- 说明：`sanitizeFilename`（`core/link-resolver.ts`）拒绝含分隔符/点穿越/隐藏文件；`localName`（`localize-media-core.ts`）在其上再兜底 `md5.ext`。

### T11 非 HTTP 协议（`file://`、`ftp://` 等）
- **严重度**：— ｜ **状态**：**已缓解**
- 说明：`pushRef`（`localize-media-core.ts`）仅收 `http(s)`/`data`，其余在扫描阶段即被丢弃。

### T12 扩展名与内容不符（伪装文件）
- **严重度**：— ｜ **状态**：**已缓解（较好）**
- 说明：落盘扩展名由 `classify()` 按**内容魔数**决定，不信任 URL 后缀；SVG 被显式拒绝。

---

## 4. 现状防护盘点（实测）

| 措施 | 位置 | 评价 |
|---|---|---|
| 协议白名单（仅 http/https/data） | `localize-media-core.ts` · `pushRef` | ✅ 有效 |
| SVG 拒绝（防 XSS 文本格式） | `localize-media.ts` · `runLocalizeNote` 的 `isSvg` 分支 | ✅ 有效 |
| 内容魔数（不信任扩展名） | `core/type-classifier.ts` · `classify` | ✅ 有效 |
| 类别白名单 | `localize-media.ts` · `runLocalizeNote`、`settings.ts`（`allowedCategories`） | ⚠️ 默认含 image/video/audio/pdf/document（另含 `misc` 兜底，**已移除 webpage**）；落盘前还有 `isManagedAttachment` 白名单闭合校验，故 `misc`（bin/zip）与纯文本均不落盘；`.html` 文档与 SVG 在更早一步即被硬跳过 |
| **声明类型 vs 内容对账** | `localize-media-core.ts`（`declaredCategoryOf` / `isTypeMismatch`、`localize-media.ts` 的 `runLocalizeNote`） | ✅ **已实施**（只对账 + 计数 + 摘要可见；**不改变落盘决策**） |
| 单文件体积上限 | `localize-media.ts`（`maxDownloadMb`，默认 100MB） | ✅ 已改为**下载前** HEAD 预探 + 事后复核 |
| 超时 | `localize-media.ts` · `fetchHttp` | ⚠️ 仍不取消底层请求（`requestUrl` 不支持 abort） |
| 重试上限 `tryCount` | `localize-media.ts` · `ObsidianDownloader.download` | ✅ 防止无限重试 |
| 最小体积 `minSizeKb` | `localize-media.ts` | ✅（默认 0 = 不过滤） |
| 文件名防穿越 | `core/link-resolver.ts` · `sanitizeFilename` | ✅ 有效 |
| 排除目录 | `localize-media.ts` · `runLocalizeNote`、`bulk-localize.ts` · `runBulkLocalize` | ✅ 可作运维缓解 |
| 删除类操作安全（复检引用/回收站/确认） | `unused-cleaner*`、`modals.ts` | ✅ 与本议题相邻，已较稳 |
| **私网/回环/链路本地 IP 拦截** | `localize-media-core.ts`（`isBlockedHost`，经 `evaluateHostPolicy` 生效） | ✅ **已实施**（可开关，默认开） |
| **重定向逐跳校验** | — | ❌ **无法实施**（`requestUrl` 不暴露跳转，仅校验初始主机） |
| **下载前大小限制** | `localize-media.ts`（`probeContentLength`） | ✅ **已实施** |
| **请求可取消（abort）** | — | ❌ **无法实施**（`requestUrl` 无 signal 参数） |
| **速率/并发限制** | `localize-media-core.ts`（`HostRateLimiter`）、`localize-media.ts`（有界并发池） | ✅ **已实施**（默认串行 + 可配间隔） |

---

## 5. 加固清单（可勾选）

> 状态说明：`[x]` 已实施并测试通过；`[~]` 部分实施（受 Obsidian `requestUrl` 能力限制）；`[ ]` 待办。
> 实施细节与残留风险见第 9 节。

### P0 — 建议优先（成本低、直接封堵主要暴露面）

- [x] **P0-1 私网/保留地址拦截**
  - 新增纯函数 `hostOf` / `parseIPv4` / `isBlockedIPv4` / `isBlockedIPv6` / `isBlockedHost` / `isBlockedUrl`（`src/features/localize-media-core.ts`）。
  - 覆盖 `0/8`、`10/8`、`100.64/10`、`127/8`、`169.254/16`、`172.16/12`、`192.168/16`、`192.0.0/24`、`192.0.2/24`、`198.18/15`、`198.51.100/24`、`203.0.113/24`、`224/4` 及以上；IPv6 覆盖 `::1`/`::`、`fc00::/7`、`fe80::/10`、`::ffff:` 映射；主机名覆盖 `localhost`/`local`/`*.localhost`/`*.local`/`*.internal`/`*.home.arpa`/`*.lan`。
  - 额外兼容 `inet_aton` 伪装：`2130706433`、`0x7f000001`、`0177.0.0.1`、`127.1`；并容忍大小写与末尾根点（`localhost.`）。
  - 命中即跳过、不发起请求，计入新增的「拦截内网」计数并在通知中体现。
  - 由设置项 **「拦截内网与本机地址」**（`blockPrivateHosts`，默认开）控制。

- [~] **P0-2 重定向校验**
  - 已完成：对**初始 URL** 执行 P0-1 的主机校验。
  - 受限：`requestUrl` 的参数**不支持** `redirect` 控制，响应体也**不暴露最终 URL**，故无法禁用或逐跳观测跳转 → **外部 URL 302 跳到内网仍不可拦截**。属已知残留风险，已在代码注释与本文档标注。

- [~] **P0-3 下载前限制 + 可取消**
  - 已完成：新增 `probeContentLength()`，下载前以 `HEAD` 预探 `Content-Length`，超过上限**中止**（不再整体读入内存）；上限改为可配置的 **「单文件体积上限（MB）」**（`maxDownloadMb`，默认 100）。
  - 受限：`requestUrl` 参数**不支持** `AbortController`/`signal`，无法真正取消底层请求 → 超时仍只是「上层提前放弃」，连接可能残留。属已知残留风险。

### P1 — 建议改进

- [x] **P1-4 移除 `webpage` 能力（HTML 永不落存）**
  - 采取比「只改默认值」更彻底的方式：`webpage` 从类别白名单默认值、设置面板选项中**一并移除**，并在下载链路**硬跳过**（与 SVG 同级，不提供开关）。
  - 新增 `skippedWebpage` 计数，在本地化摘要与自动化通知中如实报告「网页不落存 N」，解决静默丢弃的观感问题。
  - 因插件尚未发布，**无需** SCHEMA_VERSION 迁移（不存在老用户）。
  - 遗留：`document` 类别中的 **Office 文档**（docx/xlsx/pptx）仍可落盘；纯文本 / JSON 已由受管扩展名白名单闭合。详见 T2 状态说明。
- [x] **P1-5 新增「不可信库模式 / 外链安全」设置分组**
  - `blockPrivateHosts`（默认开）、`maxDownloadMb`（默认 100）、`allowHosts`、`denyHosts`、`hostAllowlistOnly` 均已加入「本地化」分区。
  - `allowHosts` 支持 `*.example.com`（含 apex）与 `*`；判定顺序为 **黑名单 > 白名单 > 内网拦截 > 仅白名单**。
  - 白名单中显式列出的域**可覆盖内网拦截**（便于自建内网图床）；黑名单优先级最高。
- [x] **P1-6 速率与并发限制**：`perHostIntervalMs`（同主机最小间隔，默认 0）+ `maxConcurrent`（并发上限，默认 1）；`HostRateLimiter` 采用「先预留后等待」，故并发 > 1 时同主机请求仍按间隔排开。另附带**同一 URL 去重**（重复引用只下载一次）。
- [x] **P1-7 `data:` URI 解码前尺寸预判**：新增 `estimateDataUriBytes`（base64 可**精确**预估：4 字符 → 3 字节，减填充），在 `decodeDataUri` **之前**拦截超限载荷，从而免除 `atob` 中间副本。非 base64（百分号编码文本）无法给出可靠上界，返回 `null` 交给解码后校验兜底——**宁可多分配一次，也不误杀合法载荷**。单元测试含「预估值 == 实际解码字节数」的对照断言。
- [x] **P1-8 预览中可查看被拦截的引用（取代「罗列域名」）**：原方案（列出待访问域名清单）经评估属过度设计——域名可能数十上百个、用户看到后唯一动作是取消、且与已实现的 `hostAllowlistOnly` 功能重叠。改为**如实列出被拦截的每一条引用**：`原因 · URL → 来源笔记`，**可点击定位到笔记中的该引用**（复用 `revealRefInNote`）。同时修正「所有外链都被拦截」时误报「没有可本地化的引用」的体验问题——改为打开只读清单，让用户看清「为什么一个都没下」。

### P2 — 增强与卫生

- [x] **P2-9 下载内容类型二次校验**（2026-10-18）
  - 落盘决策**仍以内容魔数为准**（`classify`）。这是刻意的：信声明会制造两类新问题——
    服务器回错类型时"文件被存成错误类型"，或"合法文件被误杀"；而"伪装成图片的 HTML 被存成 .html"
    这条通道早已由 `webpage` 硬跳过堵死（见 T6）。
  - 因此本项实现的是**对账与可见**：`isTypeMismatch(declaredType, actualCategory)`（`localize-media-core.ts`）
    在每次下载后比较"响应声明的 Content-Type 折算出的类别"与"按内容识别的类别"，不一致时：
    ① `logger.warn` 打出 `声明 → 实际`；② 计入摘要「类型与声明不符 N」。
  - 只认能确定类别的 MIME（`image/*`、`video/*`、`audio/*`、`application/pdf`、`text/html`、
    `text/plain`/`application/json` 归 document、Office 系列归 document）；
    `application/octet-stream` 等一律**不判**——服务器用通用二进制类型是常态，拿它报警只会制造噪音。
  - `data:` URI 自带的 MIME 同样参与对账（`dataUriMime`）。
  - 守卫：`localize-media-core` 单测 5 条（折算/归一/不判/只有"能确定且不同"才算/`data:` MIME）+
    `real-suite` 1 条（测试服务器返回 **PNG 字节但声明 `text/html`** → 必须按内容落盘，
    且摘要出现「类型与声明不符 1」）。**变体测试**：把计数条件改成 `if (false …)` → 该条当场转红。
- [x] **P2-10 安全日志与审计**（2026-10-18，与 P2-9 合并落地）
  - 下载失败**分项计数**：`download()` 改为返回 `DownloadOutcome`（成功给 `bytes` + `declaredType`；
    失败给 `reason`：`oversize` / `too-small` / `timeout` / `http` / `empty` / `decode` / `network`）。
  - 摘要按需拼接（都为 0 时一个字都不多）：`拦截 N（内网 a · 名单 b）`、`网页不落存 N`、
    `非受管类型跳过 N`、`类型与声明不符 N`、`超限 N`、`超时 N`、`HTTP 失败 N`、`失败 N`。
    每一类同时有对应的 `logger.warn/error`，即"提示承诺的详情确实写进控制台"。
  - 自动化的结果通知同步带上「类型与声明不符」，plog 里额外打出 `skipReasons` 全量分项。
  - **汇总进一致性报告**（2026-10-18 第二轮补完）：报告新增一节「本地化下载摘要（本次会话累计）」——
    尝试 / 成功 / 失败（按 7 类原因列非零项）/ 类型与声明不符，并注明"自插件加载起累计、重载归零"。
    数据源是**下载器自己的计数器**（`ObsidianDownloader.stats()`，在 `download()` 的**唯一出口**记账），
    因此本地化 / 全库本地化 / 自动化三条路径天然都被计入，不存在"某条路径忘上报"。
    没有下载时**整节不出现**（不是空标题占位）。守卫：`real-suite` 一条（空态不出现 + 下载后 `count===1` 且
    首行含「下载尝试 1：成功 1」）；变体测试：停掉记账 → 该条转红 → 还原转绿。
- [x] **P2-11 文档修正**：见第 7 节（已完成）。
- [x] **P2-12 回归测试**：`tests/unit/features/localize-media-core.test.ts` 已补 `isBlockedHost`/`isBlockedUrl` 的主机安全策略用例；E2E 已补「指向 127.0.0.1 的外链被跳过且不落盘」用例（已完成）。

---

## 6. 不适用 / 误报澄清

| 说法 | 判定 |
|---|---|
| 「插件存在 SSRF 高危漏洞」 | ❌ 不成立：无特权服务端、结果不外传 |
| 「可从云元数据窃取云凭证」 | ⚠️ 仅在**云主机上运行 Obsidian** 时可能，且需攻击者能植入笔记并读回落盘文件；**现已由 P0-1 拦截 `169.254.169.254`** |
| 「可远程 RCE」 | ❌ 无此路径 |
| 「附件可被静默覆盖」 | ❌ 已有 `SafeMoveEngine` 冲突避让（`(N)`） |
| 「清理会误删在用附件」 | ❌ 已有多重兜底（引用复检、短名兜底、frontmatter/canvas 兜底） |

---

## 7. README 措辞修正（已完成）

原表述（README「本地化」小节）把安全措施写成「SSRF 防护、大小上限、超时与重试」——
其中「SSRF 防护」是**借用词**（理由见第 2 节），已改为如实的中文表述：
**拦截本机/内网/保留地址** + **下载前按声明的体积上限中止** + 超时与有限重试，
并把「网页（HTML）永不落存」写进特性列表。

> 此后 README 的那两处又扩写过（补入域名黑白名单 / 同主机限速 / 并发上限；
> 体积上限与超时、重试等"设过一次就不用再碰"的细项收进了可折叠的「高级」区）。
> **以 README 现文为准**：本章只记"改过什么"，不再复制一份现文——
> 复制即漂移（与规模数字同一条纪律：只指向、不复制）。

> 说明：`README.md` 其他关于架构与命令的描述经比对与源码一致，无需改动。

---

## 8. 验证方法

1. **单测**：为 `isBlockedHost`、尺寸预检、`decodeDataUri` 上限写 `tests/unit/features/localize-media-core.test.ts` 用例。
2. **本地联调**：起一个仅监听 `127.0.0.1` 的 HTTP 服务，笔记写 `![](http://127.0.0.1:PORT/x)`，确认加固后**不发起请求且不落盘**，通知中体现「已跳过内网地址」。
3. **重定向验证**：用可控 httpd 返回 `302 Location: http://127.0.0.1:PORT/...`，观察是否被拦。
4. **体积验证**：返回超大 `Content-Length` 的端点，确认在**下载前**即中止（内存/流量不增长）。
5. **E2E**：在 `tests/e2e/real-suite.test.ts` 第 4 组追加内网跳过断言，保证不回退。

---

## 9. 供应链与发布链路（2026-10-02 补）

> 前 8 节讨论的都是**运行时**安全——插件在用户库里下载外部资源时的暴露面。
> 本节补上**供应链**视角：代码如何从仓库到达用户手里，这条路径上有哪些可信假设。

### 9.1 一条链路，权限按作业分开（2026-10-02 重构）

| 工作流 | 触发 | 做什么 | 权限 |
| --- | --- | --- | --- |
| `.github/workflows/release.yml` | **唯一入口**：推送版本标签、手动触发 | `detect-version`（前置校验 + 幂等）→ `verify` → `build-release`（构建 → 签名 → 创建 Release 并上传附件） | 工作流级基线 `contents: read`；只有 `build-release` 单独声明 `contents: write` / `id-token: write` / `attestations: write`（**刻意不声明 `actions: write`**——该 scope 的语义是"用 GITHUB_TOKEN 操作 GitHub Actions"，上传产物用不到，`release.yml` 的该 job 有注释说明、`workflow-config.test.ts` 有守卫禁止其复活） |
| `.github/workflows/verify.yml` | **无自动触发**：由 `release.yml` 调用（`workflow_call`），另留 `workflow_dispatch` 供手动单跑 | typecheck / test / build（ubuntu + windows 各一遍），并校验构建产物含三个必需文件 | `contents: read`（只读） |

**为什么把校验拆成独立的可复用工作流**：它**不持有写权限**，而发布作业需要 `contents: write` 与
`id-token: write`。拆开之后，会接触网络与执行依赖安装的那部分代码始终跑在只读作业里；
发布作业只做"把已经校验过的源码构建、签名、上传"。作业粒度的 `permissions` 让这个边界是**声明式**的，
不靠约定。

**校验是产物的前置**：`build-release` 声明 `needs: [detect-version, verify]`，
`verify` 不通过则不会构建、不会签名、不会创建 Release。发布链路上**唯一**的校验点就是它，
不存在"先出产物再补校验"的窗口。

⚠️ **本仓库没有"推 main 就跑"的日常校验**：推送 `main` 与 PR 不触发任何作业。
代价是平台相关问题要到发版那一刻才暴露；收益是自动触发面收敛到一处。
**由此推出一条禁令**：不要给默认分支加"要求状态检查通过"的保护规则——那些检查不再在 PR 上运行，
设成必需会让所有 PR 永久卡住。要防误操作只用"禁止强推 / 禁止删除"即可。

### 9.2 已实施的供应链加固

- **action 固定到 commit SHA**：两个工作流里每处 `uses:` 都锚定到 40 位 commit SHA，
  行尾以注释保留可读版本号（如 `# v7.0.1`）。这样上游把大版本标签（`v7`）指向新提交时，
  **本仓库的构建行为不会随之改变**——避免"某天构建结果悄悄变了"。
  升级方式是改 SHA 与注释，并在本地跑一遍 `npm run typecheck && npm test && npm run build` 验证
  ——仓库里**已无自动 CI 兜底**，也没有工具会自动跟进上游新版本。
- **构建来源证明**：`actions/attest` 对将要发布的三个文件生成 attestation，
  把"这个产物由本仓库的这条工作流构建"这一事实签下来。任何人可自行验证：
  `gh attestation verify main.js --repo CHNLM/obsidian-attachment-suite`
- **发布前多重校验**：标签版本必须与 `manifest.json` 逐字一致；标签必须指向默认分支的
  最新提交（防在历史提交上误发）；`versions.json` 必须含该版本映射。
- **双触发去重**：`concurrency` 串行化 + 幂等检查（用 REST 状态码区分"已存在 / 不存在 / 真错误"），
  保证同一版本只会发布一次。

### 9.3 剩余的供应链风险（知情接受）

- **标签指针可被移动**：`git tag -f` 加 `--force` 推送能改写某个版本标签的指向。
  现有防线是"标签必须指向默认分支 HEAD"，它挡住的是"在旧提交上误发"，
  挡不住"先改标签、再走一次正常发版"。不过发布走仓库内的固定工作流、且产物带
  attestation，要篡改需要仓库写权限——那等同于入侵仓库本身。
- **`GITHUB_TOKEN` 的粒度**：工作流用的是 Actions 临时签发的 token（默认仅限本仓库、
  运行结束即失效），比长期 PAT 风险低；但它在发布 job 里持有 `contents: write`——
  能改工作流文件的人可以借它发布。防线是"改工作流须进主流分支"；校验作业（`verify`）本身仍是只读的，
  且发布只能由 `release.yml` 里那条固定流水线发起。
- **依赖树**：`npm ci` 依据锁文件安装，但依赖自身的来源（npm registry）与上游包的安全性
  不在本仓库控制范围内。当前依赖面很小（esbuild、Obsidian 类型包、vitest 等构建与测试工具），
  且**运行时零第三方依赖**——发布的 `main.js` 只把 `obsidian` 列为 external。

### 9.4 与运行时安全的关系

发布链路里的两个环节共同决定"用户装到的代码是什么"：`verify` 保证**被构建的那份源码**经过校验，
`build-release` 保证**用户拿到的产物**可复现、来源可验证。前者防"引入错误"（在产物生成之前就把关，
而不是先出产物再补检查），后者防"产物被替换"。

---

## 附录 A：关键代码位置索引

| 关注点 | 文件 · 符号 |
|---|---|
| 下载器与重试/上限 | `src/features/localize-media.ts` · `ObsidianDownloader.download`（`DEFAULT_MAX_DOWNLOAD_MB`） |
| HTTP 请求与超时 | `src/features/localize-media.ts` · `probeContentLength` / `fetchHttp` |
| 类别白名单与 SVG 拒绝 | `src/features/localize-media.ts` · `runLocalizeNote` 里的 `classify()` 分支 |
| 写盘 | `src/features/localize-media.ts` · `runLocalizeNote` 的 `createBinary` 调用 |
| 引用提取（协议过滤） | `src/features/localize-media-core.ts` · `findExternalRefs` / `pushRef` |
| 文件名生成/防穿越 | `src/features/localize-media-core.ts` · `localName`；`src/core/link-resolver.ts` · `sanitizeFilename` |
| data URI 解码 | `src/features/localize-media-core.ts` · `decodeDataUri`（解码前预判 `estimateDataUriBytes`） |
| 自动处理触发 | `src/features/automation.ts` · `runAutoProcess`；`src/main.ts` · `onVaultFileChange` / `onPaste` / `sweepAuto` |
| 全库本地化 | `src/features/bulk-localize.ts` · `runBulkLocalize` |
| 默认设置 | `src/settings.ts` · `DEFAULT_SETTINGS` |
| 内容魔数识别 | `src/core/type-classifier.ts` · `classify` |

## 附录 B：一页版结论

- **不是典型 SSRF**：缺特权服务端与结果外传通道。
- **真实风险三类**：隐私泄露（追踪像素）、内网可达（LAN 副作用/探测）、资源耗尽（下载前大小校验 + 超时不取消）。
- **已完成**：私网/保留地址拦截、下载前体积限制、域名黑白名单与仅白名单模式、同主机限速与并发上限、HTML 永不落存、`data:` 解码前预判、预览中可查看并定位被拦截项、README 措辞修正。
- **残留（受 `requestUrl` API 限制）**：重定向不可逐跳校验、超时不可取消、DNS 重绑定不可预判 —— 三条均可由**「仅允许白名单」模式**整体规避。
- **已知并接受**：Office 文档（`document` 类别中的 docx/xlsx/pptx）可落盘（T2 残余，可用白名单模式规避）；纯文本 / JSON 已由受管扩展名白名单挡下。
