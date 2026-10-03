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
  裸 `new Notice(msg, 毫秒)` 只允许用在"**必须无条件可见**且写明理由"的地方。目前共 6 处，分三类：
  ① **弹窗确认回调的兜底**——回调不会被 `await`，异常会变成无人处理的 rejection，而弹窗已关，
  用户必须知道"哪一步没做成"：`modals.ts` 的 `runConfirmed`、`unused-cleaner.ts` 与
  `empty-folder-cleaner.ts` 确认按钮回调里的 `catch`；
  ② **「删除前确认」关闭时的那一次结果提示**（`unused-cleaner.ts` / `empty-folder-cleaner.ts` 的
  `unconfirmed` 分支）——否则「静默 + 无确认」叠加就是一次无人知晓的删除；
  ③ **诊断日志开关的状态提示**（`commands.ts`）——用户必须知道它是开是关。
  另：`features/automation.ts` 的两处自行用 `shouldNotify()` 门禁（与 `createNoticer` 等价，但没走它）。
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
| 文件名字段清洗 | `features/name-formatter-core.sanitizeNameFragment(raw, fallback)` |

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
- 守卫要按域界定，不要一刀切：`localize-media-core` 的 `MD_IMG` / `MD_LINK` **故意**在
  目标含未转义括号时整条跳过（宁可漏本地化，也不改坏正文），已被用例 E16 钉住，
  **不要"顺手统一"**。
- 已删除、不要复活：`core/result.ts`、`type-classifier.isCategory`、
  `settings.localize.desktopOnly`。错误模型是"异常承载 + 五处收口"，不做类型化 `Result`。

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
