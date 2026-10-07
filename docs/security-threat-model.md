# Attachment Suite 威胁模型与加固清单

> 对象：Obsidian 插件 **Attachment Suite**（`attachment-suite` v1.0.0，桌面端 `isDesktopOnly`）
> 范围：媒体本地化（下载）链路的网络安全与数据安全；兼及清理 / 导出等破坏性操作的数据安全
> 性质：评估用文档（面向维护者与安全评审）
> 行号说明：文中的 `文件:行` 引用**会随重构漂移，行号未必准**（文件与符号都仍在）；判读请以函数名 /
> 符号为准，不要按行号定位（与 `command-inventory.md` 同一口径）。
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

**判定**：由于缺少「特权服务端」这一环，插件未赋予攻击者任何**超出用户自身网络权限**的能力，故**不构成典型 SSRF**。README 的「SSRF 防护」属借用词，应改述为「外部 URL 抓取安全措施」。

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
- **已实施**：`probeContentLength()`（`localize-media.ts:112`）在 GET 之前先用 `HEAD` 读取 `Content-Length`，超过 `maxDownloadMb` 即中止（`download()` 内 `:74-78`）；`data:` URI 另有 `estimateDataUriBytes()` 在 base64 解码前精确预估；GET 返回后仍按同一上限复核（`:82`）。重试次数由 `tryCount` 封顶。
- **残余风险**：服务器**不声明** `Content-Length`（分块传输 / 流式响应 / 拒绝 HEAD）时无从预判，仍需把响应整体读入后再判断——此时内存峰值由单次响应体决定。缓解手段：调小 `maxDownloadMb`、开启「仅允许白名单」，或把 `maxConcurrent` 保持为 1。

### T5 超时不取消底层请求
- **严重度**：低 ｜ **可利用性**：中 ｜ **状态**：**弱防护**
- **成因**：`localize-media.ts:53-56` 的 `Promise.race([requestUrl, setTimeout(resolve(null))])` 仅让**上层提前返回 `null`**，`requestUrl` 的底层连接/读取 **并未被 abort**。
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
- 说明：`sanitizeFilename`（`core/link-resolver.ts:182-190`）拒绝含分隔符/点穿越/隐藏文件；`localName`（`localize-media-core.ts:141-146`）在其上再兜底 `md5.ext`。

### T11 非 HTTP 协议（`file://`、`ftp://` 等）
- **严重度**：— ｜ **状态**：**已缓解**
- 说明：`pushRef`（`localize-media-core.ts:68`）仅收 `http(s)`/`data`，其余在扫描阶段即被丢弃。

### T12 扩展名与内容不符（伪装文件）
- **严重度**：— ｜ **状态**：**已缓解（较好）**
- 说明：落盘扩展名由 `classify()` 按**内容魔数**决定，不信任 URL 后缀；SVG 被显式拒绝。

---

## 4. 现状防护盘点（实测）

| 措施 | 位置 | 评价 |
|---|---|---|
| 协议白名单（仅 http/https/data） | `localize-media-core.ts:68` | ✅ 有效 |
| SVG 拒绝（防 XSS 文本格式） | `localize-media.ts:137` | ✅ 有效 |
| 内容魔数（不信任扩展名） | `core/type-classifier.ts` | ✅ 有效 |
| 类别白名单 | `localize-media.ts:302`、`settings.ts`（`allowedCategories`） | ⚠️ 默认含 image/video/audio/pdf/document（另含 `misc` 兜底，**已移除 webpage**）；落盘前还有 `isManagedAttachment` 白名单闭合校验，故 `misc`（bin/zip）与纯文本均不落盘；`.html` 文档与 SVG 在更早一步即被硬跳过 |
| 单文件体积上限 | `localize-media.ts`（`maxDownloadMb`，默认 100MB） | ✅ 已改为**下载前** HEAD 预探 + 事后复核 |
| 超时 | `localize-media.ts` | ⚠️ 仍不取消底层请求（`requestUrl` 不支持 abort） |
| 重试上限 `tryCount` | `localize-media.ts:32` | ✅ 防止无限重试 |
| 最小体积 `minSizeKb` | `localize-media.ts` | ✅（默认 0 = 不过滤） |
| 文件名防穿越 | `core/link-resolver.ts:182-190` | ✅ 有效 |
| 排除目录 | `localize-media.ts`、`bulk-localize.ts:43` | ✅ 可作运维缓解 |
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

- [ ] **P2-9 下载内容类型二次校验**：以响应 `Content-Type` 与魔数**双重**判定，不一致时按「更保守」的类别处理（必要时跳过）。
- [ ] **P2-10 安全日志与审计**：把「跳过的内网地址 / 超时 / 超限 / 类型不符」写入可见报告，便于用户发现被植入的恶意链接。
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

原表述（README「本地化」小节）：

> 下载具备安全措施：SSRF 防护、大小上限、超时与重试

**已改为与实现一致的表述（含网页不落存与内网拦截）：**

> - **网页（HTML）永不落存**：识别为网页文档的引用会被跳过，避免把网页脚本存进库
> - 下载具备安全措施：**拦截本机/内网/保留地址**（默认开）、**下载前按声明的体积上限中止**、超时与有限重试

同时已把「本地化」设置清单补充为「…… / 拦截内网与本机地址 / 单文件体积上限 / 类别白名单（不含网页）」。

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
| `.github/workflows/release.yml` | **唯一入口**：推送版本标签、手动触发 | `detect-version`（前置校验 + 幂等）→ `verify` → `build-release`（构建 → 签名 → 创建 Release 并上传附件） | 工作流级基线 `contents: read`；只有 `build-release` 单独声明 `contents: write` / `actions: write` / `id-token: write` / `attestations: write` |
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

| 关注点 | 文件:行 |
|---|---|
| 下载器与重试/上限 | `src/features/localize-media.ts:21,29-47` |
| HTTP 请求与超时 | `src/features/localize-media.ts:50-62` |
| 类别白名单与 SVG 拒绝 | `src/features/localize-media.ts:137-140` |
| 写盘 | `src/features/localize-media.ts:146-148` |
| 引用提取（协议过滤） | `src/features/localize-media-core.ts:25-31,68` |
| 文件名生成/防穿越 | `src/features/localize-media-core.ts:141-146`；`src/core/link-resolver.ts:182-190` |
| data URI 解码 | `src/features/localize-media-core.ts:149-170` |
| 自动处理触发 | `src/features/automation.ts:26-76`；`src/main.ts:114-130,175-203` |
| 全库本地化 | `src/features/bulk-localize.ts:26-102` |
| 默认设置 | `src/settings.ts:101-162` |
| 内容魔数识别 | `src/core/type-classifier.ts` |

## 附录 B：一页版结论

- **不是典型 SSRF**：缺特权服务端与结果外传通道。
- **真实风险三类**：隐私泄露（追踪像素）、内网可达（LAN 副作用/探测）、资源耗尽（下载前大小校验 + 超时不取消）。
- **已完成**：私网/保留地址拦截、下载前体积限制、域名黑白名单与仅白名单模式、同主机限速与并发上限、HTML 永不落存、`data:` 解码前预判、预览中可查看并定位被拦截项、README 措辞修正。
- **残留（受 `requestUrl` API 限制）**：重定向不可逐跳校验、超时不可取消、DNS 重绑定不可预判 —— 三条均可由**「仅允许白名单」模式**整体规避。
- **已知并接受**：Office 文档（`document` 类别中的 docx/xlsx/pptx）可落盘（T2 残余，可用白名单模式规避）；纯文本 / JSON 已由受管扩展名白名单挡下。

## 附录 C：实施记录（2026-09-14）

本次已完成 P0 中**可实施**的全部内容，并保留了两处**受 Obsidian API 能力限制而无法实施**的项。

### 变更清单

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

### 验证结果

- `npm run typecheck`：通过
- `npm test`：**24 个文件 / 291 个用例全部通过**（**当时的规模**；当前规模见 `tests/README.md` 第 8 行）
- `npm run build`：已重新产出 `dist/attachment-suite/main.js`

### 残留风险（受 API 限制，未消除）

1. **重定向不可拦截**：`requestUrl` 无法禁用/观测 3xx 跳转。外部允许域 302 指向内网时，仍会命中内网。
   - 缓解建议：P1 引入 `allowHosts` 白名单模式，或改用可逐跳校验的传输实现。
2. **超时不可取消**：`requestUrl` 无 `signal` 参数，超时仅放弃上层等待，底层连接可能残留。
3. **DNS 重绑定不在覆盖内**：纯函数无法在下载前解析 DNS，`192.168.1.1.nip.io` 之类字面域名、以及解析到内网的普通域名均不会被拦截。

> 以上三条均已在源码注释中标注，避免后续维护者误以为已完全覆盖。

## 附录 D：第二批实施记录（2026-09-14 · P1-4）

决策：采纳「**彻底移除 `webpage` 类别**」——HTML 永不落存，且不提供开关。因插件**尚未发布**，不存在老用户，故**跳过** SCHEMA_VERSION 迁移。

### 变更清单

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

### 验证结果

- `npm run typecheck`：通过
- `npm test`：**24 个文件 / 293 个用例全部通过**（**当时的规模**；当前规模见 `tests/README.md` 第 8 行）
- `npm run build`：已重新产出 `dist/attachment-suite/main.js`

### 设计说明（为何保留 `webpage` 这个枚举值）

`AttachmentCategory` 中的 `'webpage'` **未删除**，因为它是 `classify()` 对 HTML 的**真实识别结果**：
- 留着它，才能明确报告「识别为网页，按设计不落存」，而不是把 HTML 伪装成 `misc`；
- `attachment-index` 的 `categoryFromExt('html')` 与命名用 `categoryWords` 仍需要它，以便整理**库内已存在**的 `.html` 文件。

即：移除的是**用户侧的能力与开关**，保留的是**内容识别的保真度**。

## 附录 E：第三批实施记录（2026-09-14 · P1-5 / P1-6）

内容：**域名 allow/deny 白名单模式** + **速率与并发限制**。

### 域名名单策略

- 新增纯函数（`src/features/localize-media-core.ts`）：`hostMatches`、`matchesAnyHost`、`evaluateHostPolicy`，以及类型 `HostPolicy` / `HostVerdict` / `HostDenyReason`。
- 判定顺序（先匹配先生效）：
  1. `denyHosts` 命中 → 拒绝（**优先级最高，可覆盖白名单**）
  2. `allowHosts` 命中 → 允许（**显式白名单可覆盖内网拦截**，便于自建内网图床）
  3. `blockPrivateHosts` 且命中私网/本机/保留地址 → 拒绝
  4. `hostAllowlistOnly` 且未命中白名单 → 拒绝
  5. 其余 → 允许
- 通配规则：`*.example.com` 匹配 `example.com` **及其所有子域**；`*` 匹配任意；模式与主机均忽略大小写、端口与末尾根点。
- 新增设置：`allowHosts`、`denyHosts`、`hostAllowlistOnly`（均默认关闭/空）。

### 速率与并发

- `HostRateLimiter`（`localize-media-core.ts`）：**先预留时间槽、后等待**，因此并发数 > 1 时对同一主机的请求仍按最小间隔排开。
- 限速器实例挂在 `ObsidianDownloader` 上（插件级单例），故**全库本地化跨笔记持续生效**。
- `runPool`（`localize-media.ts`）：有界并发执行器，`maxConcurrent === 1` 时即严格串行（与改动前行为一致）。
- 附带修复：**同一 URL 在笔记中重复引用只下载一次**（此前会重复发起网络请求）；并处理并发下「不同 URL → 同内容 → 同一 MD5 文件名」的写竞争（目标已存在即视为成功，避免留下坏引用）。
- 新增设置：`perHostIntervalMs`（默认 0）、`maxConcurrent`（默认 1）。

### 默认值说明（有意保持保守）

`perHostIntervalMs = 0`、`maxConcurrent = 1`。理由是**不改变既有行为**：默认即为「完全串行」这一最稳妥形态，限速间隔需显式开启才有意义；若希望默认更严格或更快，可直接调整这两个默认值。

### 文档与测试

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

### 验证结果

- `npm run typecheck`：通过
- `npm test`：**24 个文件 / 306 个用例全部通过**（**当时的规模**；当前规模见 `tests/README.md` 第 8 行）
- `npm run build`：已重新产出 `dist/attachment-suite/main.js`

### 顺带修复：`typecheck` 未覆盖测试代码（已处理）

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

## 附录 F：第四批实施记录（2026-09-14 · P1-7 / P1-8）

### P1-7 · `data:` URI 解码前尺寸预判

- 新增 `estimateDataUriBytes(uri)`（`localize-media-core.ts`）：base64 形式按「4 字符 → 3 字节，减填充」**精确**预估；非 base64（百分号编码文本）无法在不解码的前提下给出可靠上界，返回 `null` 表示「无法预判」。
- `download()` 的 `data:` 分支在 `decodeDataUri` **之前**调用它，超限直接跳过；解码后的 `maxBytes` 校验保留为兜底。
- **设计取舍**：非 base64 形式不预判，是因为要拦「过大」就得给出**上界**，而 UTF-8 文本的上界（3 字节/字符）会把 40MB 的 ASCII 载荷误判为 120MB。宁可放弃这一侧的优化，也不误杀合法载荷。

### P1-8 · 预览中可查看并定位被拦截的引用

**起因**：原方案（预览里列出待访问的域名）经评估属**过度设计**——域名可能数十上百个、用户看完唯一动作是取消、且与已实现的 `hostAllowlistOnly` 功能重叠。

**改为**：如实列出**被拦截的每一条引用**，并让它可点击定位。

| 文件 | 变更 |
|---|---|
| `src/modals.ts` | `ConfirmChangeRow` 增 `onClick?`；`ConfirmChangesOptions` 增只读分区 `blocked?: { title, items }`；行渲染抽为 `renderRows()` 并支持可点击行 |
| `src/reveal-ref.ts` | **新增**：`revealRefInNote` 从 `commands.ts` 抽出，供命令报告与预览弹窗共用（同时消除 features→commands 的循环依赖风险） |
| `src/features/bulk-localize.ts` | 预览阶段逐条记录被拦截项（`BlockedRef`：原因/URL/来源笔记），存入确认弹窗的 `blocked` 分区；**全部外链都被拦截时改开只读清单**，修正原先误报「没有可本地化的引用」 |
| `styles.css` | 新增 `.iap-confirm-row-clickable` / `.iap-confirm-section-title` / `.iap-confirm-list-blocked`（虚线边框暗示「这些不会被改动」） |

**顺带修正的体验缺陷**：原先若所有外链都被拦截，预览只显示「全库没有可本地化的外部引用」——用户完全不知道是设置拦掉了。现在会打开只读清单逐条列出，与全项目「不静默丢弃」的原则一致。

### 测试与验证

| 文件 | 变更 |
|---|---|
| `tests/unit/features/localize-media-core.test.ts` | 新增「data URI 尺寸预判」4 例，含**预估值 == 实际解码字节数**的对照断言、非 base64 返回 `null`、畸形输入不抛错 |
| `tests/e2e/real-suite.test.ts` | 新增 2 例：①预览列出被拦截项且**点击行真的打开了来源笔记**；②全部被拦截时打开只读清单 |
| `tests/e2e/infrastructure.ts` | 测试替身补 `MarkdownView`、`workspace.getLeaf()`（记录被打开的笔记路径 `openedNotePaths`）；`FakeEl` 增 `setAttribute`/`getAttribute`，并让 `addClass` **按空白拆分**（否则 `"a b"` 形式的多类名无法被 `querySelectorAll` 匹配） |

- `npm run typecheck`：通过（已覆盖 tests/）
- `npm test`：**24 个文件 / 312 个用例全部通过**（**当时的规模**；当前规模见 `tests/README.md` 第 8 行）
- `npm run build`：已重新产出 `dist/attachment-suite/main.js`

> 说明：「点击定位」在 E2E 中通过**替身记录被打开的笔记路径**来断言（已实测通过）；在真实 Obsidian 中打开标签页并滚动到引用处，建议实机确认一次。
