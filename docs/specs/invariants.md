# 项目不变式与工程约定

> **性质**：规范与事实类文档——记录**当前仍然成立**的规则，不是某一轮的历史记录。
> **来源**：2026-10-02 自项目记忆（原先只存在于不入库的 `.workbuddy/`）整理入库，
> 使这些资产随仓库长期可维护、外部贡献者也能读到。
> **何时读**：改核心解析/改写逻辑、改通知与错误处理、改设置页文案、加新入口或新分层之前。

---

## 0. 一句话不变式

> **读取层认得的引用形态，改写层必须同样认得；插件自己会写出的形态，保护层必须认。**

这条已经以不同面貌反复出现 7 次，每一次都造成过真实的数据损失或断链。新增任何
"读引用 / 改引用 / 判断引用是否在用"的能力时，先拿它过一遍。

## 1. 引用解析与改写

- **解析绝不能按空白截断目标**。`\(([^)\s]+)` 会把 `![x](a b.png)` 读成 `![x](a)`，
  于是它不进"在用"集合，被「清理未用附件」当孤儿**误删**。
  正确做法：整体捕获括号内容 → 剥掉 `<...>` 与 `"标题"` → 做 `%xx` 解码；
  写回时用 `encodeMdTarget`。
- 同源缺陷分三小类：
  - **只认一边**——`resolvedLinks` 与文本扫描二者只取其一，会漏掉 HTML 写法或 canvas 的
    `file` 字段，进而把"共享附件"误判为独占，原地改名后另一侧悬空；
  - **截断目标**——无扩展名短名 `![[pic]]`、`%20`、含空格路径、嵌套括号 `报告 (1).png`
    （`([^)]*)` 会在第一个 `)` 处截断）；
  - **映射缺键**——无扩展名主名 `![[song]]` 未登记。
  统一修法：`MD_DEST = ((?:[^()]|\([^()]*\))*)`，且 core 解析器与两处测试解析器**必须同步**，
  `tests/unit/acceptance-tooling.test.ts` 里有防退化的标记断言。
- **键构造的唯一入口**是 `core/link-resolver.addRefKeys(map, from, to)`
  （登记完整路径 / basename / 无扩展名主名；同名不覆盖）。
  `refMapForMoves` 与"共享附件复制副本"分支都必须走它——**不要手写 `map.set`**。
- **改写按类型分派**在 `obsidian-domain.rewriteRefsInNote`：markdown 走
  `rewrite` + `rewriteFrontmatter`；canvas 走 `rewriteCanvasFileFields`（只整值匹配 `"file"`
  字段，天然幂等）。infra 层不能 import features，所以 canvas 改写实现在 core。
- 改写一律用**函数式**替换 `text.replace(raw, () => next)`；否则新目标里含 `$&` / `$1`
  时会被当成替换模式展开。
- frontmatter 里的资源 token：首字符不允许空白与 `-`；字符类用 `\p{L}\p{N}` 覆盖中文名。
- **frontmatter 块切分只走 `core/link-resolver.frontmatterBlock()`**：历史上被抄了四份
  （`link-resolver` 两处、`attachment-index` 的断链扫描、`localize-media-core` 的外链扫描）。
  它容忍 **BOM**——真宿主实测 `vault.read()` / `cachedRead()` 会**剥掉** `\uFEFF`，
  而底层 `adapter.read()` **保留**它；解析层不能假设调用方已经清洗，否则同一段 YAML
  在两条读路径上判定相反（最坏后果：仅被 frontmatter 引用的附件被判孤儿）。
- **判「空目录」必须回查真实文件系统**（`adapter.list`）——库索引不含点文件，
  只看索引会把"其实还有 `.DS_Store` 的目录"判成空目录。
- **移动/复制前必须先建目标父目录**：`fileManager.renameFile` **不会创建**目标目录，
  缺目录时 `fs.rename` 抛 `ENOENT`，而错误文本会同时打印源与目标，极易被误读成
  "源不存在"。`ObsidianFileOps.rename` 与 `name-formatter.copyFileTo` 都先
  `ensureFolder(dirOf(target))`。
- **"看起来像竞态" ≠ 竞态**：曾连续 4 轮验收出现不同的悬空项，实际是"目标父目录是否
  存在取决于上一条命令有没有建过"。判别法：加 `--step-delay 2500` 放慢后仍然失败，
  就说明是逻辑问题而不是时序问题。

## 2. 错误模型与反馈体系

三档通知的落点在 `src/commands.ts` 的 `traceCommand`：开始 → `toast.info`（**仅「详细」档**）；
结果 → `toast.summary`（「仅摘要」及以上）；失败 → `toast.error`（**任何级别，含静默**）。

- **所有用户可见提示必须经过 `createNoticer`**（它同时受通知级别与 `effectiveDuration` 约束）。
  裸 `new Notice(msg, 毫秒)` 只允许用在"**必须无条件可见**且写明理由"的地方。
  目前允许的共 **8 处**：下面三类 6 处，另加 `features/automation.ts` 的 2 处（后者自行用
  `shouldNotify()` 门禁，与 `createNoticer` 等价，但没走它）；`notify.ts` 里 `createNoticer`
  **自身**的实现不计入。三类是：
  ① **弹窗确认回调的兜底**——回调不会被 `await`，异常会变成无人处理的 rejection，而弹窗已关，
  用户必须知道"哪一步没做成"：`modals.ts` 的 `runConfirmed`、`unused-cleaner.ts` 与
  `empty-folder-cleaner.ts` 确认按钮回调里的 `catch`；
  ② **「删除前确认」关闭时的那一次结果提示**（`unused-cleaner.ts` / `empty-folder-cleaner.ts` 的
  `unconfirmed` 分支）——否则「静默 + 无确认」叠加就是一次无人知晓的删除；
  ③ **诊断日志开关的状态提示**（`commands.ts`）——用户必须知道它是开是关。
  但**"允许裸 Notice"不等于"允许裸时长"**——上面每一处都走 `effectiveDuration(...)`，
  不得再写死毫秒数（曾硬编码 8000，与设置页承诺的「错误 5 秒起、消息越长越久」对不上）。
- **弹窗内的提示同样受级别约束**：`ReportModal` 导出报告的成/败曾是裸 `Notice(3000/5000)`，
  绕过了"静默＝只出错时提示"；现在走 `createNoticer`，级别由调用方经
  `ReportOptions.getNotificationLevel` 注入（**必填**）。
- **设置落盘失败同理**：`settings-tab` 的 `save()` 与诊断开关回调曾各自 `void` 一个
  **没有兜底的 Promise**，而插件**没有全局 `unhandledrejection` 处理器** →
  落盘失败（磁盘只读 / 写满 / 同步冲突）时用户零感知，表现为"改了设置、重启又变回旧值"。
  现统一走 `persist(label, op)`，error 级。
- **不受级别影响的兜底**是 `reportFailures(toast, count, what, details?)`，用于所有破坏性命令的
  失败 / 部分失败。判据："叠加静默档之后，用户是否会完全无感知"。
  **失败明细必须逐条 `logger.error`**——提示里写了"详情见开发者控制台"却不写，这句承诺就是假的
  （同一形态历史上出现过 6 处）。逐篇静默用 `logFailures(...)`：**逐篇静默不该连日志一起静默**。
- **后台动作的部分失败同样要报**：`SafeMoveEngine.moveMany` 是"逐项失败并继续"，调用方**必须消费
  `errors`**（只读 `results` 就会把"有一半没做成"说成"已完成"）。「笔记移动跟随」曾因此静默漏报
  "附件没跟上"（2026-10-19）；同一分支里"附件已迁移、引用改写失败"也要给出**可行动**的下一步
  （运行「修复断链」），而不是让它冒泡成一句笼统的后台失败。
- **弹窗回调必须兜异常**：Obsidian 不会 await `ButtonComponent.onClick` 的 async 回调，
  所以 `modals.ts` 统一用 `runConfirmed(label, cb)` 包装。
  **改完文件再改写引用要单独兜**——`rewriteRefsSafely()`，因为后半段失败会留下真实断链，
  必须明确告知用户并指向「修复断链」。
- **`TaskQueue.enqueue` 的返回契约不要改**（`task-queue.test.ts` 断言它 `rejects.toThrow`）；
  问题在调用方一律 `void` 丢弃 → 修 `main.ts` 的 `reportBackgroundError`。
- 当前共有**五处收口**：`traceCommand` / `runConfirmed` / `reportBackgroundError` /
  `settings-tab.persist` / `sweepAuto` 外层 catch。**新增任何异步路径时先问：这条路径上
  有没有人接住 rejection？**

### 2.1 必须复用的共用口径

| 用途 | 唯一入口 |
| --- | --- |
| frontmatter 资源 token 列举 | `core/link-resolver.listFrontmatterResourceTokens()` |
| frontmatter 块切分（解析 / 改写 / 断链 / 外链） | `core/link-resolver.frontmatterBlock()`（容忍 BOM 与 CRLF） |
| 文件名字段清洗 | `features/name-formatter-core.sanitizeNameFragment(raw, fallback)` |
| 排除目录判定（全局 / 报告 / 本地化 / 导出） | `core/path-compatibility.isPathExcluded()`（**前缀**语义＝整棵子树） |
| 排除目录判定（「清理」自己的名单） | `features/unused-cleaner-core.shouldExclude()`（受 `excludeSubfolders` 控制；`paths.exclude` 走**前缀**分支） |
| 下载失败原因的中文标签与摘要片段 | `features/localize-media-core.DOWNLOAD_FAILURE_LABELS` / `reasonNotes()`（**不要在命令摘要里另写三元表达式**——2026-10-18 就是两处各写一份，与 `deleteModeLabel` 分叉同型） |

> ⚠️ 排除目录**有两份名单、两种口径**，这是刻意的：`paths.exclude` 是"这块不动"的**作用域**声明
> （整棵子树，与报告 / 本地化 / 导出 / 全库批量一致）；`cleanup.excludedFolders` 是**清理专属过滤条件**
> （由「排除目录含子目录」决定是否连带子目录）。2026-10-18 之前两者被合并成一个数组统一处理，
> 结果是子树里的孤儿**既不出现在报告里、又被清理删掉**——同一个设置被两层按不同口径解释，
> 属于 §0 那类缺陷。**不要把两者再合并成一个数组传。**

### 2.2 命令的第二入口（文件右键菜单）

- 菜单项走 **`runForNote(notePath)`**，不是 `callback`：`file-menu` 事件给的 `file`
  **不等于**当前打开的那一篇，而 `callback` 内部走 `getActiveFile()` → 会出现
  **"右键 A、却改了 B"**。四个笔记级命令都提供 `runForNote`，两个入口最终调**同一个** `run*`，
  并且都包同一层 `traceCommand`。
- **加新入口前必须先让测试替身能记录它**（`Menu` / `addRibbonIcon` 原先在替身里都不存在，
  直接挂上去等于让新代码在测试里不可达）。守卫见 `tests/e2e/file-menu.test.ts`，
  它带负对照（活动笔记 A、右键 B）。

## 3. 「承诺了却不生效」的六种形态

审设置页与文案时逐条对照：

1. 有设置项，但**没有任何代码读它**；
2. 有回调，但那条路径**永远跑不到**（替身丢了 `onChange`）；
3. 写进了配置，运行时**读的是另一处**（例如 `setInterval` 周期在创建时就固定，
   改间隔必须 `restartAutomationSweep()`）；
4. **界面显示值 ≠ 实际生效值**（数字被静默钳制却不回写；下拉曾把 `['windows','mac']`
   谎报成「全平台」；类别开关在"只剩一个、取消被拒"时不回写控件）；
5. 提示**承诺的去向没有内容**（"详情见控制台"而从不写控制台），或提示**绕过了自己声明的分级**；
6. **文案与事实不符**（自报的默认值与 `DEFAULT_SETTINGS` 不一致；引用的**宿主原生标签**是
   凭记忆编的）。

判据：**每条承诺都要能指出「哪段代码读它 / 兑现它」+「以什么路径生效」。**
最快的办法是逐字段反查"界面控件 + 真实消费方"两侧是否都在。
第 6 类的两条守卫在 `tests/e2e/settings-tab.test.ts`（后者用 `HOST_LABELS` 白名单，
并附上宿主语言包的键名便于复核）。

### 3.1 引用宿主原生标签的取真方法

宿主标签的**真相源是 Obsidian 安装目录下的语言包**（`resources/` 内的 asar 归档，
取其中的 zh-CN 段）。**引用任何宿主标签之前必须先去那里核**，不要凭记忆写。

## 4. 文案规范口径

改设置页文案前先读：

- 引用命令名 / 开关名 / 设置项一律用 `「」`（不用成对的 `“”`，更不留裸 ASCII `"`——
  唯一的例外是字面字符表 `? * " < > |`，那里必须保持半角）；
- 范围号统一用半角 `~`；
- 插件自己的用语统一为**目录**；只有引用 Obsidian 原生标签时才跟着它写「文件夹」；
- **类别**（image / video / …）、"子类型"、"类型"是三件不同的事，不要混用。
- **源码注释不要下"全称 / 枚举 / 计数"断言**——"全仓唯一的…"、"共 N 处"、"需要它的有两处"
  这类句子不会随代码变动自动更新：历轮审计在注释维度发现的问题**过半**出自这一形态
  （口径、数量、消费方枚举）。要写就写清"谁在用、在哪一层"，或直接指向代码里的单一事实来源。

## 5. 分层边界与架构守卫

规则由 `tests/unit/architecture.test.ts` 锁死：

- `src/core/**` **完全自包含**（不 import `obsidian`、只允许同目录导入）；
  features 下的 `*-core` 保持纯逻辑。
- **禁止横向共享、允许纵向编排**：跨 feature 的执行层依赖必须逐条登记到
  `ALLOWED_CROSS_FEATURE`（写明理由），并有反向断言防止腐烂。当前 4 条：
  automation → localize-media / name-formatter、bulk-rename → name-formatter、
  bulk-localize → localize-media。**零循环依赖。**
- `obsidian-domain.ts` 是包装 `App` 的地方，并托管共用的 App 级操作。**要共享执行工具
  就放这里，不要再新建 feature 当共享模块。**
- 通用工具的唯一归属（守卫会拦重复实现）：`core/types.ts` 的 basename / dir / ext；
  `core/link-resolver.ts` 的解析与改写各函数；`core/path-compatibility.ts` 的
  `normalizeInVault` 与 `normalizeLocal`（**两者契约不同，故意不合并**）。
  完整清单以 `architecture.test.ts` 为准。
- ⚠️ **"同名 ≠ 等价"——重复实现最危险的地方不是"重复"，而是"两份语义不同"**：
  2026-09-16 的批次评估实测到 `extOf` 曾有**两份实现且不等价**（对无扩展名/多点名的处理不同），
  这正是本仓库四次误删级缺陷的温床。所以"唯一归属"这条规则的理由**不是"少写几行"**，
  而是"**让语义只有一个定义**"。清理重复实现时，先确认两份是否等价——**不等价就必须先决定留哪一份**，
  直接删掉其中一份会把差异静默固化。（评估原文已随本次文档重组删除，结论即本条。）
- 守卫要按域界定，不要一刀切：`localize-media-core` 的 `MD_IMG` / `MD_LINK` **故意**在
  目标含未转义括号时整条跳过（宁可漏本地化，也不改坏正文），已被用例 E16 钉住，
  **不要"顺手统一"**。
- 已删除、不要复活：`core/result.ts`、`type-classifier.isCategory`、
  `settings.localize.desktopOnly`、`logger.getLogLevel` / `logger.setSink`
  （2026-10-13 删：零调用方。诊断日志级别以**设置**为唯一事实来源，测试断言日志走 `console` 捕获，
  两者都不需要注入 sink）。错误模型是"异常承载 + 五处收口"，不做类型化 `Result`。

## 6. 发布与版本

- **只有一条链路**：`.github/workflows/release.yml` 是仓库**唯一的自动化入口**，
  **只在推送版本 tag 或手动 dispatch 时触发**。它按 `detect-version → verify → build-release` 串联，
  且 `build-release` 声明了 `needs: [detect-version, verify]`——**校验是产物的前置**，verify 不过则一个产物都不生成。
- **没有"日常 CI"**：推送到 `main` 与 PR **不会**触发任何校验或构建。校验定义在
  `.github/workflows/verify.yml`，由发布链路以可复用工作流调用（`uses:`），
  另保留 `workflow_dispatch` 供需要时单独跑一遍（只读、不产出发布产物）。
  代价是**平台相关的问题要到发版时才暴露**——这是刻意的取舍，不要再把校验挂回 push / PR。
- ⚠️ **由此推出一条禁令**：**不要给默认分支加"要求状态检查通过"的保护规则**。
  那些检查已不再在 PR 上运行，设成必需会让**所有 PR 永久卡在"等待状态上报"**。
  要防误操作，只用"禁止强推 / 禁止删除"即可。
- **发布 tag 与 `manifest.json` 的版本号一致，不带 `v` 前缀**（如 `1.0.1`）。
- Release 附件必须包含 `main.js` / `manifest.json` / `styles.css` **三个独立文件**：
  社区目录安装器与 BRAT 都是按 `releases/latest/download/<文件名>` 逐个取，
  只提供一个 zip 会让插件装不上。zip 作为手动整包安装的补充一并保留。
- 工作流会生成构建来源证明（`actions/attest`），可用 `gh attestation verify` 校验。
- **Node 精确固定 24.20.0**：权威来源 `.nvmrc`（CI 用 `actions/setup-node` 的 `node-version-file` 读它），
  `package.json` 的 `engines.node` 与之**逐字一致**，`.npmrc` 开 `engine-strict` → 版本不符时
  `npm install` / `npm ci` 直接 `EBADENGINE` 拦下（默认只警告，加了它才真的拦）。**换版本必须同时改这两处。**
- **action 的"保持最新"唯一通道 = `npm run check:actions`**（`scripts/check-action-pins.mjs`）：
  逐个比对上游最新稳定版并直接给出可替换的 `uses:` 行，同时校验行尾注释与钉扎版本是否一致；
  退出码 0 / 1 / 2 = 全最新 / 需处理 / 没联网。action 钉死 SHA 之后就没有自动升级通道了，
  **不跑它等于没有升级通道**（`npm outdated` 看不到 action，那是 npm 依赖的事）。
- **手动 dispatch 可选 `dry_run`**：跳过构建来源证明与创建 Release，其余照跑（含全部前置校验、
  双平台校验与构建），所以想验证发布链路不必真的发一版出来。
- **判据只有一份，落点可以有多处**：三件套（`main.js` / `manifest.json` / `styles.css`）完整性检查定义在
  复合 action `.github/actions/verify-plugin-dist`，`verify.yml` 与 `build-release` 都调用它——
  后者查的是**它自己那次构建**（另一台 runner、另一个时刻），因为被发布的是那份产物。
  另给 `Create GitHub Release` 设了 `fail_on_unmatched_files: true`：该输入**默认 `false`**，
  缺附件只警告不失败，而 `actions/attest` 也**只在 0 个 subject 时才报错**（少一个文件照样签名）
  → 不设它，"构建绿、附件却缺一个"会静默发出坏 Release。
- **发旧版本会被拦**：`detect-version` 用 `sort -V` 比较现有最高标签（同版本重发仍放行），
  因为 GitHub 的 latest 按**发布时间**而非语义版本决定，而社区安装器与 BRAT 都按
  `releases/latest/download/<文件名>` 取产物。Release 侧另有 `make_latest: true` 把行为写死。
- **`GH_TOKEN` 只挂在用得到它的那一个 step 上**，不放工作流级 env：后者会注入每个 step 的环境，
  包括 `build-release` 的 `npm ci`——那里的令牌带 `contents: write` / `id-token: write`，
  而 devDependencies 未钉版本、install 时会执行生命周期脚本。同类口径：`verify` job 的
  `os_matrix` 输入默认仍是双平台，**发布路径的跨平台防线不因为可配而变弱**（见 `verify.yml` 文件头）。
- **规模类数字只有一个权威来源**：`Attachment Suite/tests/README.md` 第 8 行。
  其它文档不要复制具体数字，引用即可——复制即漂移。
  `tests/unit/docs-consistency.test.ts` 会对本目录下"规范与事实"类文档做机械对账——
  含规模数字、命令口径、宿主标签，以及**文档里引用的文件与符号是否仍然存在**。
  也就是说：**删掉一个模块或改个函数名时，文档里的引用会被守卫标出来**（别再靠人工查）。
- **产品决策（2026-10-19）：暂不上架 Obsidian 社区市场。** 因此 `manifest.json` 的 `description`
  保持**中文**（`manifest.test.ts` 把它钉住），仓库也没有 `CHANGELOG`——**这不是遗漏**。
  若将来要上架，需要一起改：`description` 与 README 提供英文版、补 `CHANGELOG`、
  按社区目录要求复核元数据；届时**必须同时改** `manifest.test.ts` 里"必须含中文"的断言，
  否则守卫会先红（这是有意为之：让"改语言"成为一次显式决定，而不是手滑）。

## 7. 工程陷阱（踩过多次）

- **重复执行的补丁**：本项目的开发环境里，`python -c` 形式与
  `cat > f << 'EOF'` 形式的补丁**都会被执行两次**（第二次因锚点已失效而报错，
  但文件其实第一次就改好了；`cat >>` 则会把内容追加两遍）。
  → **不能拿 `assert` 当幂等保护**，一律写成"先判断再改"，输出里的计数也照此读
  （第二次必然为 0）。**给文件写入或追加内容，一律用编辑工具，不要用 heredoc。**
- **heredoc 里的 `${` / `${{` 会被当参数展开**：用 `git commit -F - << 'EOF'` 提交带这类
  文本的说明会报 `Bad substitution`，**但提交其实已经成功**（只是后续命令没跑）。
  → 含这类字符的文本先写到文件，再用 `-F <file>`。
- **临时文件放项目内**：Git Bash 下 `/tmp` 不可靠（写进去随后读不到）。
- **绝不用 `git rm`**：删文件用 `rm` + `git add -A`；误删恢复用
  `git checkout HEAD -- "<path>"`。每完成一小步就提交，之后用
  `ls -R src | grep -c "\.ts$"` 核对源码文件数。
- **手写清单是最容易漏的一份实现**：每加一个字段 / 依赖 / 保护对象，都要问
  "还有哪份清单要同步"——典型的有设置迁移的顶层键白名单、`ALLOWED_CROSS_FEATURE`、
  以及各类守卫覆盖的清单。
- **行尾是平台差异的隐藏来源（2026-10-03 栽过一次）**：windows runner 的 `core.autocrlf=true`
  会把检出内容换成 CRLF，于是**按"行内容逐字相等"定位锚点的解析器会整片落空**——
  表现为 ubuntu 绿、windows 全红（实例：`workflow-config.test.ts` 用 `'env:' === line`
  找锚点，CRLF 下恒为假，7 条断言全灭，run 37089281509）。
  → 两层设防，缺一不可：① **测试里解析文本前一律归一化行尾**
  （`read = (p) => readFileSync(p,'utf8').replace(/\r\n?/g, '\n')`，两个解析型守卫都已这么做）；
  ② `.gitattributes` 用 `* text=auto eol=lf` 把文本钉死在 LF，**不再依赖各机器的 git 配置**
  （`.cmd` 例外，必须 CRLF——它在 `*` 之后单独声明）。
  ③ 各条解析型断言都要配"至少扫到 N 处"的**防空转断言**：这次正是它们把"解析全落空"
  喊成了显式失败，否则守卫会静默变成"什么都没查"却仍显示通过。
  **在本机复现这类问题**：把目标文件临时转成 CRLF 再跑（备份 → 转 → 跑 → 还原并比对 SHA），
  比开 worktree 快得多，也足够忠实。

## 8. 复查与审计的规程

> **为什么单列一节**：历轮"一次性全面检查"暴露出**四类会复发的疏漏**，它们的共同点是
> "**不写下来就一定再犯**"。本节是这四类的收口——**动复查流程、或写复查记录之前先读**。

### 8.1 判据：看"复发"，不看"发现"

"发现了几处"衡量的是**扫描面积**（几十篇文档 + 四十余个源文件的注释 + 四十余项界面文案，
逐条对账必然有产出），不是质量。所以复查的判据是**同一形态是否复发**——
记录里要能读出"这是第 N 次"或"这一类已连续若干轮零复发"。**"零发现"不是目标。**

### 8.2 改动不同步：改一处事实，按"谁还写着它"过一遍

"改了一处、漏了另一处"是历轮最常见的形态（有过一轮十来处里，一半是"只改了一半"、
另一半是那一轮自己引入的）。规则：

- **能由守卫兜住的，优先加守卫**（规模数字、命令口径、宿主标签、默认值、文档路径、符号引用
  均已如此）。守卫的收益不随时间衰减：**清空只保证"此刻干净"，守卫保证"此后改错即红"**。
- **但"能加守卫"不等于"该加守卫"**：守卫的成本表现为**豁免名单**——口径越通用，要放行的
  例外越多，最后守卫自己成了负债。判据是**口径能否收敛**：能压到一个有限、可枚举的精确集合
  （如宿主标签白名单、文档路径一族、命令 id 集合、跨 feature 白名单）就加；不能
  （如"任意被引用的符号是否存在"）就**不加**，改走下面两条。本仓库已按此拒绝过"通用注释守卫"。
- **清空一个格不等于"修完了"**：状态会被下一次改动破坏，单靠"修干净"只是等它复发。
  让它保持干净要两件一起：**源头抑制**（不再产生新的——见 §4 末条）＋ **触发式复查**
  （改到该文件时，连带把这一类存量过一遍）。缺任一件，"清空"就只是一次性的。
- 兜不住的（散文里的"唯一 / 共 N 处 / 两处消费方"这类**全称、枚举、计数**断言）：
  **不要在注释与文档里下这类断言**（见 §4 末条）；确需表达就改述为"谁在用、在哪一层"。
- 改完一处事实，**在当场**把"哪里还写着它"扫一遍（`grep` 关键词即可），
  把**扫到的处数与改动的处数**一并写进记录。

### 8.3 一次修全部同类（不要逐个打补丁）

同一处病灶往往散落在多个文件上；逐个打补丁会让它**分成好几轮各修一次**
（实例：「读源码文本做断言却没剥注释」这一条散在四个守卫上，分了四轮才清完）。规则：

- 修一处同类问题 → **当场全仓扫同类** → 一次修完；
- 记录里写明"**扫到 N 处、缺口 M 处**"，让"没去扫"与"扫了没发现"可区分。

### 8.4 防线自身也要被审（守卫的断言会不会被"喂饱"）

守卫写的断言同样可能恒真、或被**非目标内容**满足——**防线自身也是被审对象**。两级要求：

- **防空转**：凡是"逐文件扫描后断言零 offender"的守卫，都要配"至少扫到 N 处"的前置断言；
  解析文本前先归一化行尾。
- **防喂饱**：读源码 / 配置文本做断言的守卫，先剥掉**注释**再断言——说明性注释里写着同一个串，
  会让断言失去意义。只剥**整行注释**，不动行内尾注释（后者有时本身就是被断言的字符串）。
- 新建或修改守卫时**必须做变体测试**：把被断言的真值改坏 → 确认转红 → 还原，并在记录里留痕。
  对"断言可被喂饱"的排查，与防空转断言同级，属常规抽查项。

### 8.5 检查的时机与降频

- **"改完就查"是刻意的**：判据不是"改过了"，而是"审查之后还有没有变更"；
  所以复查**必然**抓到最新改动留下的滞后——这不是失控。
- **已被守卫钉住、且连续若干轮零发现的类，不再逐轮人工全查**，只跑守卫确认全绿，
  并在记录里写明"依据 + 本轮如何确认"。当前适用：功能完整性 / 命令与入口 / 死设置与自报默认值 /
  宿主原生标签 / 规模数字与命令口径 / 错误模型收口 / 架构分层。
- **不降频**：真实宿主运行验证（全量验收 + 启动哨兵 + 落盘变体 + 控制台三通道）——
  它是"替身骗了我们"那一类的最终防线。

