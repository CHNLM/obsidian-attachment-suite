/**
 * 真实 Obsidian 全量验收（CDP 驱动）。
 *
 * 思路：以 `--remote-debugging-port` 启动 Obsidian 打开验收库，经 CDP（Chrome DevTools Protocol）
 * 连接到渲染进程，在**真实 Obsidian 环境**里启用插件、逐条执行命令、自动点击确认弹窗、
 * 采集通知与最终文件树，最后与预期比对；随后整轮再跑一遍验证幂等。
 *
 * 用法（在插件目录下）：
 *   node scripts/obsidian-cdp-acceptance.mjs
 *   node scripts/obsidian-cdp-acceptance.mjs --vault "D:\\...\\for-test\\acceptance" --port 9222
 *
 * 前置：
 *   1. `npm run build`
 *   2. `npx vitest run tests/e2e/seed-acceptance.test.ts`（生成验收库并投放插件）
 * 说明：脚本自带的本地 HTTP 服务（默认 45999）用于外链用例；Obsidian 需可访问本机回环地址。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { PNG_HEADER, startAcceptanceHttpServer } from './lib/acceptance-http-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/**
 * 读一个开关的值。两种写法都支持：`--name value` 与 `--name=value`。
 *
 * 为什么必须支持 `=` 形式：只认空格形式时，`--variant=obsidian-root` 会**静默取默认值**，
 * 于是"我以为换了变体、实际跑的还是基线"——正是下面 `VALID_VARIANTS` 校验要防的那类假绿，
 * 只是从"值拼错"换成了"分隔符写法不对"。
 */
const arg = (name, dflt) => {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) {
    const v = eq.slice(`--${name}=`.length);
    return v || dflt;
  }
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const VAULT = path.resolve(arg('vault', path.join(__dirname, '..', '..', 'for-test', 'acceptance')));
const CDP_PORT = Number(arg('port', '9222'));
const HTTP_PORT = Number(arg('httpPort', '45999'));
const OBSIDIAN = arg(
  'obsidian',
  path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'obsidian', 'Obsidian.exe'),
);
const PLUGIN_ID = 'attachment-suite';

/**
 * 配置变体（决定"附件到底落在哪"这一格是否被验证）。
 *
 * - `custom`（默认）：验收库自带配置（`attachmentFolderMode: 'custom'` + `attachmentFolderPath: './assets'`），
 *   附件落在各笔记目录下的 `assets/`。
 * - `obsidian-root`：**插件的默认模式**（跟随 Obsidian）+ Obsidian 的默认
 *   `attachmentFolderPath: '/'`（＝**库根**，不是"笔记同级"）→ 附件应落在库根。
 *   这正是覆盖审计里"真实宿主从未跑过"的那一格：默认配置是用户开箱即用的路径，
 *   而它此前只在 harness（替身 `getConfig`）里被验证过——那一层恰恰是"替身替插件兜底"的重灾区。
 * - `naming-rich`：验收库基线 + 四个命名富化开关全开，验"按类别分子目录"与富化命名在
 *   **真实文件系统**上的落盘与引用改写（详见下方 `NAMING_RICH`）。
 */
const VARIANT = arg('variant', 'custom');
const ROOT_LAYOUT = VARIANT === 'obsidian-root';
/**
 * 命名富化变体：把四个"只在 harness 里验证过"的命名开关一起打开。
 *
 * 为什么必须单独在真实宿主上验：验收库基线把 `folderByCategory` / `addTime` /
 * `addPathHash` / `showSubType` 全设为 `false`，于是这四个分支在真实宿主上**从未执行过**。
 * 它与 `obsidian-root` 那一格同类，但更危险——因为它们**会改变附件的落盘路径**：
 * `folderByCategory` 把附件从"笔记归属目录"挪进"类别子目录"，这一挪会连带牵动三件
 * 只有真实文件系统才会暴露的事：① 子目录的**建立**（引用指向了不存在的目录吗）；
 * ② 引用改写后**还能否解析**（新的子目录段有没有跟着写进笔记）；③「清理空目录」
 * 会不会把这些**装着附件**的新子目录误判为空。harness 的替身文件系统不建真实目录、
 * 也不真遍历，这三件一件都验不到。
 *
 * 四个一起开（而不是逐个开），是因为它们共同决定"一个文件名长什么样"：分开开只能验证
 * "某个片段存在"，一起开才能验证**片段顺序与整体可解析**——`parseRenamed` 必须能认回
 * 自己刚写出的名字，否则每一轮都会重命名同一批（不收敛，是幂等被破坏的典型症状）。
 */
const NAMING_RICH = VARIANT === 'naming-rich';
/**
 * 能力总开关全关变体（`abilities-off`）：命名 / 本地化 / 一致性 / 清理 / 导出 / 自动化 全部 `false`。
 *
 * 验的是**门禁接线**，而不是功能本身：总开关关掉后，11 条受门禁的命令必须各自早退并**明说**
 * 「X 能力已关闭」（静默早退会让用户以为坏了），且**不得改动库**（不改名、不下载、不删、不生成 zip）。
 * 两条**没有开关**的命令（收集 ×2）不在此列——它们仍会跑，这一点也会被记录下来。
 *
 * 为什么值得单独跑一遍：矩阵里这一格长期只有 harness 覆盖，而"设置没接下去"正是本仓库
 * 反复出过的形态（删除模式、空目录去向都是）。真宿主上一次跑能同时验证 11 条门禁。
 */
const ABILITIES_OFF = VARIANT === 'abilities-off';
/**
 * 笔记移动跟随**关闭**变体（`follow-off`）：`consistency.followNoteMove = false`，其余同基线。
 *
 * 验的是**关闭后真的不动**：笔记搬走后，其相对型附件目录必须**留在原地**。
 * 只验"开着会跟随"是半个证据——若这条分支被硬编码成"总是跟随"，开着的用例照样绿。
 */
const FOLLOW_OFF = VARIANT === 'follow-off';
/**
 * 「网络策略收紧」变体（`net-strict`）：把三条**只在 harness 里验过**的网络设置一起打开——
 * `blockPrivateHosts=true`、`hostAllowlistOnly=true`、`allowHosts=['127.0.0.1']`
 * （另附两个不影响结果成立与否的非默认值：`maxDownloadMb=50`、`perHostIntervalMs=20`）。
 *
 * 要回答的是**只有真宿主才能回答**的两件事：
 * ① 白名单里**显式列出的域覆盖内网拦截**（`evaluateHostPolicy` 里 allow 在 private 之前）。
 *    这一条是整个夹具能继续跑的前提：验收库的外链全指向 `127.0.0.1`，一旦顺序错了，
 *    全部外链会被当"内网"拦下，主流程直接崩——所以它同时也是一条**结构性前提守卫**。
 * ② 未列入白名单的域**在发请求之前**就被拦（`not-allowlisted`），且摘要把它归到「名单」而非「内网」。
 *    ② 用不可路由域名 `.invalid` 做探针：即使判定被改坏，也只是一次 DNS 失败，不会真的打到外网。
 *
 * ⚠️ **不覆盖** `minSizeKb` 非默认：夹具文件只有十几字节，任何正阈值都会把它们全部跳过，
 * 那样测到的是"过滤生效"，代价是主流程失去全部下载样本（得不偿失）。`maxConcurrent` 也保持基线
 * 的 2（本变体不切这个轴）。
 */
const NET_STRICT = VARIANT === 'net-strict';
const VALID_VARIANTS = ['custom', 'obsidian-root', 'naming-rich', 'abilities-off', 'follow-off', 'net-strict'];
// **取值必须校验**（与 `--delete-mode` 同一条纪律）：拼错一个字母时上面两个 `===` 都不成立，
// 脚本会**静默按 `custom` 跑**——于是"我以为在验命名富化、实际验的是基线"，
// 得到一份看着全绿、其实没覆盖目标轴的假证据（比红更贵：要另花一轮去证伪）。
if (!VALID_VARIANTS.includes(VARIANT)) {
  console.error(
    `[obsidian-acceptance] --variant 取值非法：${VARIANT}（应为 ${VALID_VARIANTS.join(' / ')}）`,
  );
  process.exit(2);
}
/**
 * `--delete-mode <.trash|system-trash|permanent>`：把「清理」的删除去向切到**非默认**分支。
 *
 * 与 `--variant` **正交**（只改"删到哪"这一个轴，其余保持验收库基线）。为什么需要它：三条删除路径里
 * 只有 `.trash` 在真实宿主上跑过，另两条（移出库的系统回收站、永久删除）**从未真机验证**——而它们
 * 不可逆，恰恰最该在真机上确认"接线对了"（2026-10-16 修掉的「清理空附件目录硬编码」就是这一类：
 * 设置没传下去，命令仍走库内回收站）。
 *
 * 用法：`node scripts/obsidian-cdp-acceptance.mjs --delete-mode system-trash`
 */
const VALID_DELETE_MODES = ['.trash', 'system-trash', 'permanent'];
const DELETE_MODE = arg('delete-mode', '');
// **取值必须校验**：非法值会一路传到插件的 `if / else if / else`，被 `else` 吃掉当成**永久删除**
// （最不可逆的那一支）。宁可当场拒绝，也不要因为一个拼写错误把夹具删干净。
if (DELETE_MODE && !VALID_DELETE_MODES.includes(DELETE_MODE)) {
  console.error(
    `[obsidian-acceptance] --delete-mode 取值非法：${DELETE_MODE}（应为 ${VALID_DELETE_MODES.join(' / ')}）`,
  );
  process.exit(2);
}
/** 传了非默认值 = 本趟专验"非库内回收站"分支（`.trash` 是库基线，传它等于没切）。 */
const NON_DEFAULT_DELETE = DELETE_MODE !== '' && DELETE_MODE !== '.trash';
/**
 * `--platforms-all`：把「路径修复」的 `consistency.platforms` 设为**全部平台**（最严格的判定）。
 *
 * 验收库基线用 `currentPlatform()`（本机 = 只 `windows`），于是 mac / linux / android / ios 的
 * 路径规则在**真宿主上从未生效**过。跑这一趟要回答的是：**更严格的判定会不会把合法路径误判成违规**
 * 而改动本不该动的文件（那会表现为"文件被改名/移动"→ 收敛判定或"无新断链"变红）。
 */
const PLATFORMS_ALL = process.argv.includes('--platforms-all');
/**
 * **已登记、已定位的既有震荡**：不参与收敛判定，但**绝不静默**（每次命中都打印出来）。
 *
 * **当前为空**——曾经登记的两条都已在 2026-10-16 修掉（根因与修法见 `coverage-matrix` §5）：
 * ① `notes/11-断链-大小写.md` 的孤儿副本：**引用改写与解析侧大小写口径不一致**
 *    （索引按**不敏感**把它解析到共享附件 `assets/png/pic.png`，改写却按**敏感**找不到键）→
 *    副本创建出来没有任何引用指向它 → 被「清理未用附件」删掉 → 下轮重建。修法：`lookupMapping`
 *    让改写侧在精确未命中时退化为大小写不敏感，与解析侧**同一口径**。
 * ② `notes/<80 个"长">.md`（N16）的副本循环：**生成侧不看长度限制、修复侧按 255 字节从尾部截断**
 *    （切掉时间戳/哈希段）→ 下轮 `parseRenamed` 认不回 → 改回完整名 → 再被截断 → 永久循环。
 *    修法：`clipNoteName` 让生成/解析**共用同一长度口径**，且**截断笔记名片段而非尾部**（保住后缀）。
 *
 * **纪律**：豁免的前提是"已登记**且未修**"。修完必须撤掉，否则它就成了永久的瞒报口子；
 * 命中时必须打印——**豁免 ≠ 静默**。
 *
 * ⚠️ **已知盲区（2026-10-16 发现，未修）**：收敛判定只比较**轮末**快照（见下方 `states`），于是
 * "**轮内创建 → 轮末前销毁**"的文件在判定里**完全不可见**：若某轮把同一附件"建一份、删一份"，
 * 轮末快照恒定 → 判为收敛（**假绿**）。上面这套具名豁免正是为这类循环准备的，但它依赖**人先发现**；
 * 而 `.trash` **每轮是否新增**是这类循环的直接症状（轮末可查、零额外开销）。
 * 修法方向：把 `.trash` 条目列表并入每轮快照，让"轮内删除"参与收敛判定。
 */
const KNOWN_CHURN = [
  // 空数组：两条既有震荡都已修（见上方注释）。保留机制以备将来登记——**登记一项的前提是
  // "已定位、已确认与本次改动无关、且暂时不修"**，三者缺一就不该进这里。
];
/**
 * `--trace-commands`：**逐命令**追踪文件集合的变化。
 *
 * 用途：回答"到底是**哪条命令**在动这些文件"。不开这个开关时，报告只能说"本轮变了 N 项"，
 * 排查要点只能靠重跑好几遍去猜；开了之后每条命令后面都会打印"`命令 id` 改了哪几项"。
 * 只在开了开关时才采（每条命令一次轻量快照，整轮会慢若干倍），故默认关闭。
 */
const TRACE_COMMANDS = process.argv.includes('--trace-commands');

/**
 * `--plugin-log`：打开插件的 **debug 日志**并订阅宿主控制台，把插件的计划日志打出来。
 *
 * 用途：`--trace-commands` 能告诉你"**是哪条命令**改的"，但回答不了"**它为什么这么改**"——
 * 那个答案在插件自己的 diagnostic 日志里（`planForSnapshot` 的 `from → to`、改名/复制各多少）。
 * 这两级配合，才够定位"某文件每轮被改名"这类问题。
 */
const PLUGIN_LOG = process.argv.includes('--plugin-log');
/** 采集到的宿主控制台行（仅 `--plugin-log` 时填充）。 */
const pluginLogs = [];

/**
 * 是否追加"自动化后台处理"阶段。
 *
 * 为什么必须单独有这一阶段：自动化的链路（库事件 → 标记待处理 → 定时轮询 → 队列 → 处理）
 * 是**只有真实宿主才具备**的——它依赖 `setInterval`、vault/metadataCache 事件与队列。
 * 而验收库基线配置里 `automation.enabled = false`，于是这条链路在真实宿主上一直没被跑过。
 * 覆盖审计把它列为 P1：这类"定时器 + 事件 + 并发"的缺陷恰恰只在真实宿主暴露。
 */
const RUN_AUTOMATION = process.argv.includes('--automation');
/**
 * 是否在候选弹窗上走一次"选中并修复"。
 *
 * 默认行为是**一律跳过**（多候选场景不该替用户做决定，这一点要保持）。
 * 但那样一来"修复"只覆盖了"跳过"那一半，**改写链路（选中 → 写回引用）从未在真实宿主执行过**——
 * 覆盖审计把它列为 P2。开启后仅第一处候选会被选中并点「以此修复」，其余仍跳过。
 */
const FIX_CANDIDATES = process.argv.includes('--fix-candidates');
/** 等待自动处理生效的上限（毫秒）。 */
const AUTOMATION_WAIT_MS = Number(arg('automationWait', '25000'));

/**
 * 启动哨兵阶段：验证**打开库不会静默批量改写**（覆盖审计里的 X02）。
 *
 * 为什么必须单独验：插件唯一一条"不经同意就批量改写整库"的路径就是自动处理
 * （`runAutoProcess` 内部走 `confirm=false` 的命名，不弹确认框）。而它的入口是
 * "启动期 Obsidian 对全库批量触发 metadataCache.changed"。此前的抑制是固定 1500ms
 * 窗口，且测试环境把它置 0 → 该分支在任何测试里一次都不执行。
 *
 * 判定方式是**可观测的端到端事实**，不看日志：启动前记录全库 `.md`/`.canvas` 的内容基线，
 * 带 automation 打开库后**不触碰任何东西**，等过"就绪兜底 + 余震窗口 + 两轮轮询"，
 * 再逐篇比对——任何一篇被改写都算失败。另配一个"哨兵附件"（名字不合规，
 * 一旦被处理就会改名/被搬走）。
 *
 * 非空洞性由两处保证：① 同轮 `--automation` 阶段证明自动处理确实能在库里干活；
 * ② 插件自己的诊断计数会报出"启动期被就绪门挡下多少个 changed"——
 *    > 0 就说明这道门在当前环境里真的在挡东西。
 */
const STARTUP_CHECK = process.argv.includes('--startup-check');
/** 等待时长：需覆盖插件的就绪兜底（8s）+ 余震窗口 + 至少两轮轮询。 */
const STARTUP_WAIT_MS = Number(arg('startupWait', '13000'));
const CANARY_NOTE = 'notes/20-启动哨兵.md';
const CANARY_ATT = 'canary/canary-pic.png';
/** 启动前的笔记内容基线（相对路径 → 内容）；仅 `--startup-check` 时填。 */
let startupBaseline = null;

/**
 * 按变体/开关改写库配置。必须在**启动 Obsidian 之前**调用（Obsidian 启动时才读这些文件）。
 *
 * 纪律：**只改要验的那一个轴**，其余字段必须与验收库基线完全一致。
 * 不要手写一份"精简配置"——其余字段会落到默认值，于是默认的 `blockPrivateHosts=true` 会把
 * 本地回环地址全拦掉、`excludedFolders` 变空，导致几十条与本次变体无关的断言一起爆红（实测 80 条）。
 */
function applyVariantConfig() {
  const dataPath = path.join(VAULT, '.obsidian', 'plugins', PLUGIN_ID, 'data.json');
  // 前提：库必须是**刚 seed** 的。任何变体跑完都会把附件搬进 notes/assets/ 并改名；
  // 带着这样的库跑下一个变体，「命名 / 落盘」断言会因残留而误报——那种红是假的，
  // 而假红比不报更昂贵（要额外花一轮去证伪）。宁可当场说清，也不要让人对着假红猜。
  if (fs.existsSync(path.join(VAULT, 'notes', 'assets'))) {
    console.error('[obsidian-acceptance] 前提不成立：库里已存在 notes/assets（上一轮变体跑过，未重新 seed）。');
    console.error('[obsidian-acceptance] 请先执行：npx vitest run tests/e2e/seed-acceptance.test.ts');
    process.exit(2);
  }
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const changed = [];

  if (ROOT_LAYOUT) {
    const appPath = path.join(VAULT, '.obsidian', 'app.json');
    const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
    app.attachmentFolderPath = '/'; // Obsidian 默认值：'/' 表示**库根**
    fs.writeFileSync(appPath, JSON.stringify(app, null, 2), 'utf8');
    data.attachmentFolderMode = 'obsidian';
    changed.push('attachmentFolderMode=obsidian（app.json 的 attachmentFolderPath 设为 "/"＝库根）');
  }

  if (NAMING_RICH) {
    // 只改命名这四个轴，其余（含 attachmentFolderMode / attachmentFolder）保持验收库基线——
    // "只改要验的那一个轴"是硬纪律：多改一个轴，爆红时就无法归因到底是谁造成的。
    data.naming = {
      ...(data.naming ?? {}),
      folderByCategory: true,
      addTime: true,
      addPathHash: true,
      showSubType: true,
    };
    changed.push('naming.folderByCategory/addTime/addPathHash/showSubType=true');
  }

  if (ABILITIES_OFF) {
    // 五个能力总开关 + 自动化一起关（导出也关：只有全关，"库不该被改动"才是一条可断言的强不变量）。
    data.naming = { ...(data.naming ?? {}), enabled: false };
    data.localize = { ...(data.localize ?? {}), enabled: false };
    data.consistency = { ...(data.consistency ?? {}), enabled: false };
    data.cleanup = { ...(data.cleanup ?? {}), enabled: false };
    data.exporter = { ...(data.exporter ?? {}), enabled: false };
    data.automation = { ...(data.automation ?? {}), enabled: false };
    changed.push('naming/localize/consistency/cleanup/exporter/automation.enabled=false');
  }

  if (FOLLOW_OFF) {
    data.consistency = { ...(data.consistency ?? {}), followNoteMove: false };
    changed.push('consistency.followNoteMove=false（其余保持基线：consistency.enabled 仍为 true）');
  }

  if (NET_STRICT) {
    // 只改网络策略这一组；断链修复/清理/命名等全部保持基线，否则爆红时无法归因。
    data.localize = {
      ...(data.localize ?? {}),
      blockPrivateHosts: true, // 基线是 false
      hostAllowlistOnly: true, // 基线是 false
      allowHosts: ['127.0.0.1'], // 只放行验收库自己的本地服务
      maxDownloadMb: 50, // 非默认（100），但仍允许全部夹具文件
      perHostIntervalMs: 20, // 非默认（0），20ms 对总时长影响可忽略
    };
    changed.push(
      'localize.blockPrivateHosts=true, hostAllowlistOnly=true, allowHosts=[127.0.0.1], maxDownloadMb=50, perHostIntervalMs=20',
    );
  }

  if (RUN_AUTOMATION || STARTUP_CHECK) {
    data.automation = { ...(data.automation ?? {}), enabled: true, interval: 1 };
    changed.push(`automation.enabled=true, interval=1${STARTUP_CHECK ? '（启动哨兵需要它在启动时就开着）' : ''}`);
  }

  if (DELETE_MODE) {
    data.cleanup = { ...(data.cleanup ?? {}), deleteMode: DELETE_MODE };
    changed.push(`cleanup.deleteMode=${DELETE_MODE}（--delete-mode 指定）`);
  }

  if (PLATFORMS_ALL) {
    data.consistency = {
      ...(data.consistency ?? {}),
      platforms: ['windows', 'mac', 'linux', 'android', 'ios'],
    };
    changed.push('consistency.platforms=[windows,mac,linux,android,ios]（--platforms-all 指定）');
  }

  if (PLUGIN_LOG) {
    // 打开插件的「详细诊断日志」（与设置页同一开关）——否则 plan 日志根本不会输出。
    data.debugLogging = true;
    changed.push('debugLogging=true（--plugin-log 需要）');
  }

  if (!changed.length) return;
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[obsidian-acceptance] 配置已按需改写（其余保持验收库基线）：${changed.join('；')}`);
}
/**
 * 自动化阶段：在真实宿主上验证「库事件 → 标记待处理 → 定时轮询 → 队列 → 处理」整条链路。
 *
 * 判定标准是**可观测的副作用**，而不是"日志里出现了某行"：
 * 新建一篇引用未命名附件的笔记；若自动处理生效，该附件应被规范命名为
 * `<笔记名>_image_NNN.<ext>`，且笔记引用同步改写、内容原样保留。
 *
 * 这条链路只能在真实宿主验证：它依赖 `setInterval`、vault/metadataCache 事件与队列。
 */
async function runAutomationPhase(cdp, problems) {
  const NOTE = 'AutomationProbe.md';
  const PNG = 'assets/automation-probe.png';
  // 用夹具里现成的 PNG 字节，避免手写 PNG 头；它同时也是"内容原样"的基准
  const beforeB64 = fs.readFileSync(path.join(VAULT, 'assets/png/pic.png')).toString('base64');

  // 清掉上一轮可能留下的探针产物（`vault.create` 对已存在的路径会抛错）
  await cdp.eval(`(async () => {
    for (const p of [${JSON.stringify(NOTE)}, ${JSON.stringify(PNG)}]) {
      const f = window.app.vault.getAbstractFileByPath(p);
      if (f) await window.app.vault.delete(f);
    }
    return 1;
  })()`);

  const t0 = Date.now();
  await cdp.eval(`(async () => {
    const bin = atob(${JSON.stringify(beforeB64)});
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    await window.app.vault.createBinary(${JSON.stringify(PNG)}, arr.buffer);
    await window.app.vault.create(${JSON.stringify(NOTE)}, '# 自动化探针\\n\\n![p](assets/automation-probe.png)\\n');
    await window.app.workspace.openLinkText(${JSON.stringify(NOTE)}, '', false);
    return 1;
  })()`);

  let hit = null;
  // 探针的期望名也必须**按变体分叉**：命名方案变了，同一个"自动处理已生效"的事实会产出
  // 不同形态的文件名；用固定正则会把"已经生效"误报成"链路未生效"——那是最容易骗过人的一种假红。
  const PROBE_RE = NAMING_RICH
    ? /AutomationProbe_image_png_\d{3}_\d{14}_[0-9a-f]{8}\.png$/
    : /AutomationProbe_image_\d{3}\.png$/;
  const until = Date.now() + AUTOMATION_WAIT_MS;
  while (Date.now() < until && !hit) {
    const files = await cdp.eval(`window.app.vault.getFiles().map((f) => f.path)`);
    hit = (files ?? []).find((f) => PROBE_RE.test(f)) ?? null;
    if (!hit) await sleep(500);
  }
  const elapsed = Date.now() - t0;
  if (!hit) {
    problems.push(
      `[自动化] ${AUTOMATION_WAIT_MS}ms 内自动处理未发生：新建笔记引用的附件始终没被规范命名（定时器 / 事件 / 队列链路未生效）`,
    );
    return { ran: false, elapsedMs: elapsed };
  }

  console.log(`   · 自动处理已生效：${PNG} → ${hit}（${elapsed}ms）`);
  const text = fs.readFileSync(path.join(VAULT, NOTE), 'utf8');
  if (!text.includes(path.basename(hit))) {
    problems.push(`[自动化] 自动处理后笔记引用没跟上改名（真实断链）：${text.slice(0, 120)}`);
  }
  if (fs.readFileSync(path.join(VAULT, hit)).toString('base64') !== beforeB64) {
    problems.push('[自动化] 自动改名后附件内容变了（应原样搬移）');
  }
  return { ran: true, renamedTo: hit, elapsedMs: elapsed };
}

/** 命令基名（源码里注册的 `addCommand({id})`）。真实 id 由 Obsidian 加插件前缀，见 resolveCommandIds()。 */
const COMMANDS = [
  'attachment:check-consistency',
  'attachment:fix-broken-links',
  'attachment:repair-incompatible-paths',
  'attachment:cleanup-empty-folders',
  'attachment:collect-current-note',
  'attachment:bulk-collect',
  'attachment:rename-note',
  'attachment:bulk-rename',
  'attachment:localize-note',
  'attachment:bulk-localize',
  'attachment:export-note',
  'attachment:export-unused',
  'attachment:cleanup-unused',
];

/**
 * 把源码里的命令基名解析成**运行时真实 id**。
 *
 * 必要：Obsidian 会给 `addCommand({id})` 自动加插件前缀，所以源码写 `attachment:localize-note`
 * 时，真实 id 是 `attachment-suite:attachment:localize-note`。写死基名调用
 * `executeCommandById` 会静默失败（返回 false、什么都不发生）——第一版脚本就是这么"跑完 13 条命令"
 * 却一个文件都没动。这里按**后缀**匹配（各命令后缀唯一），从而对前缀形式免疫。
 */
async function resolveCommandIds(cdp) {
  const all = await cdp.eval('Object.keys(window.app.commands.commands)');
  const bySuffix = new Map();
  for (const id of all) bySuffix.set(String(id).split(':').pop(), id);
  const resolved = [];
  const missing = [];
  for (const base of COMMANDS) {
    const real = bySuffix.get(base.split(':').pop());
    if (real) resolved.push(real);
    else missing.push(base);
  }
  if (missing.length) throw new Error(`以下命令未在 Obsidian 中注册：${missing.join(', ')}`);
  console.log(`   · 命令 id 已解析（${resolved.length} 条，示例：${resolved[0]}）`);
  return resolved;
}

/* ------------------------------- CDP 客户端 ------------------------------- */

async function fetchJson(url, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function waitForCdp(deadlineMs) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const pages = (list ?? []).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pages.length > 0) return pages;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}

/** 该页面是否就是验收库（按 basePath 精确比对，避免误连到用户其它已打开的库）。 */
async function pageIsVault(page) {
  const probe = `(() => {
    const a = window.app && window.app.vault && window.app.vault.adapter;
    return (a && (a.basePath || (a.getBasePath && a.getBasePath()) || '')) || '';
  })()`;
  let cdp = null;
  try {
    cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    const base = await cdp.eval(probe, { timeoutMs: 15000 });
    const norm = (p) => path.resolve(String(p || '')).replace(/\\/g, '/').toLowerCase();
    return !!base && norm(base) === norm(VAULT);
  } catch {
    return false;
  } finally {
    try { cdp?.ws.close(); } catch { /* ignore */ }
  }
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.closed = null;
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
    });
    // 必须处理 close：Obsidian 若退出（例如应用了版本更新后重启），
    // 未决请求会永远挂着，脚本表现为"无输出卡死"。这里统一 reject 掉。
    ws.addEventListener('close', () => {
      this.closed = 'CDP 连接已关闭';
      this.failAll('CDP 连接已关闭（Obsidian 可能已退出或重启）');
    });
    ws.addEventListener('error', () => {
      this.closed = 'CDP 连接错误';
      this.failAll('CDP 连接错误');
    });
  }

  failAll(msg) {
    for (const [, p] of this.pending) p.reject(new Error(msg));
    this.pending.clear();
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', (e) => reject(new Error(`CDP 连接失败：${e?.message ?? 'unknown'}`)), { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}, timeoutMs = 180000) {
    if (this.closed) return Promise.reject(new Error(this.closed));
    const id = ++this.id;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 响应超时（${timeoutMs}ms）：${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(payload);
    });
  }

  /** 在渲染进程里执行 JS（支持 await）。 */
  async eval(expr, { awaitPromise = true, timeoutMs = 120000 } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise,
      returnByValue: true,
      timeout: timeoutMs,
    });
    if (r.exceptionDetails) {
      throw new Error(`渲染进程异常：${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
    return r.result?.value;
  }
}

/* --------------------------------- 工具 --------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 收尾：连同子进程树一起结束本脚本拉起的 Obsidian（复用别人实例时不动手）。 */
function killObsidian(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    try { child.kill(); } catch { /* ignore */ }
  }
}

/** 轮询直到表达式为真（在渲染进程求值）。连接断开时立刻返回 false，不再空等。 */
async function waitUntil(cdp, expr, label, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (cdp.closed) return false;
    try {
      if (await cdp.eval(`!!(${expr})`)) return true;
    } catch {
      return false;
    }
    await sleep(300);
  }
  console.log(`   ! 等待超时：${label}`);
  return false;
}

/** 摘要：文件树 + 通知（在渲染进程内采集，避免逐个往返）。 */
const SNAPSHOT_EXPR = `(async () => {
  const app = window.app;
  const plugin = app.plugins.plugins['${PLUGIN_ID}'];
  const files = app.vault.getFiles().map((f) => f.path).sort();
  const folders = (app.vault.getAllLoadedFiles?.() ?? [])
    .filter((f) => f.children !== undefined).map((f) => f.path).sort();
  const notes = {};
  // cachedRead 是异步的：必须逐个 await，否则 notes[p] 只是 Promise，returnByValue 会退化成 {}
  // **必须包含 .canvas**：canvas 的 file 字段也是引用，落在扫描范围外就看不见"引用悬空"。
  for (const p of files.filter((f) => f.endsWith('.md') || f.endsWith('.canvas'))) {
    const f = app.vault.getAbstractFileByPath(p);
    try { notes[p] = f ? await app.vault.cachedRead(f) : ''; } catch { notes[p] = ''; }
  }
  return { files, folders, notes, notices: plugin?.__acceptanceNotices ?? [] };
})()`;

/** 采集通知：包装 Notice 记录（幂等，只装一次）。 */
const HOOK_NOTICES = `(() => {
  const app = window.app;
  const plugin = app.plugins.plugins['${PLUGIN_ID}'];
  if (!plugin) return false;
  if (!plugin.__acceptanceNotices) {
    plugin.__acceptanceNotices = [];
    const Orig = window.Notice;
    window.Notice = class extends Orig {
      constructor(message, timeout) {
        super(message, timeout);
        try { plugin.__acceptanceNotices.push(String(message)); } catch {}
      }
    };
  }
  return true;
})()`;

/**
 * **回收站内容快照**（宿主侧）。
 *
 * 为什么必须采它：收敛判定原先只比较**轮末**的文件集合，于是"**轮内创建 → 轮末前销毁**"完全
 * 不可见——某附件若每轮"建一份、删一份"，轮末快照恒定 → 被判为**收敛**（假绿）。而**回收站
 * 每轮是否新增**正是"轮内发生过删除"的直接症状：附件被删必然落到这里，且**轮末可查、零额外开销**。
 *
 * **判据必须与"删除侧"同口径**：附件去哪由**插件自己的** `cleanup.deleteMode` 决定——
 * `unused-cleaner` 据此调 `vault.trash(f, false)`（库内 `.trash`）或 `vault.trash(f, true)`
 * （系统回收站）或 `vault.delete`（永久）。它**不是** Obsidian 的 `trashOption`：那管的是
 * 用户按 Delete 键时的行为，与插件无关。两者实测就**不一致**（宿主 `trashOption = system`，
 * 而插件把附件删进了库内 `.trash`）——照 Obsidian 的设置判定会得出**相反**结论，这正是本项目
 * 反复出现的"两层口径不一致"，本脚本在这里踩过一次，故一并把两个值都带出来备查。
 *
 * 非 `.trash` 模式**没有可查的目录**，此时返回空数组并把 `mode` 带出去——调用方会**显式打印
 * 降级提示**，绝不把"没采到"冒充成"没发生删除"（防空转）。
 */
const TRASH_EXPR = `(async () => {
  const app = window.app;
  const plugin = app.plugins.plugins['${PLUGIN_ID}'];
  let mode = 'unknown';
  try { mode = plugin?.settings?.cleanup?.deleteMode ?? 'unknown'; } catch { /* 取不到按 unknown */ }
  let hostOption = 'unknown';
  try { hostOption = app.vault.getConfig('trashOption') ?? 'unknown'; } catch { /* 同上 */ }
  const folder = app.vault.config?.trashFolder || '.trash';
  if (mode !== '.trash') return { mode, hostOption, folder, files: [] };
  const out = [];
  const walk = async (dir) => {
    try {
      const r = await app.vault.adapter.list(dir);
      for (const f of r.files) out.push(f);
      for (const d of r.folders) await walk(d);
    } catch { /* 目录不存在：视为空 */ }
  };
  await walk(folder);
  return { mode, hostOption, folder, files: out.sort() };
})()`;

/** 采集回收站快照；返回 `{ mode, hostOption, folder, files }`（取不到时给保守的缺省值）。 */
async function trashSnapshot(cdp) {
  const r = await cdp.eval(TRASH_EXPR);
  return r ?? { mode: 'unknown', hostOption: 'unknown', folder: '.trash', files: [] };
}

async function collect(cdp) {
  const snap = await cdp.eval(SNAPSHOT_EXPR);
  // ⚠️⚠️ **这个数组采不到"插件弹的通知"**：脚本靠包装 `window.Notice`（见 HOOK_NOTICES）采集，而插件
  // 在**加载时**就绑定了它自己的 `Notice` 引用，事后包装改不到它。实测同一时刻"页面 DOM 1 条 /
  // 采集 0 条"。⇒ 它只含**脚本自己** `new window.Notice` 的那一条。
  // **绝不能拿它当"产品没弹提示"的证据**（2026-10-16 曾据此写过一条错误推理）。
  // 通知类判据一律用**页面 DOM**（`.notice-container .notice`，见 runNotifyLevelCheck）。
  snap.notices = (await cdp.eval(`(window.app.plugins.plugins['${PLUGIN_ID}']?.__acceptanceNotices ?? []).slice()`)) ?? [];
  const trash = await trashSnapshot(cdp);
  snap.trash = trash.files;
  snap.trashMode = `${trash.mode}${trash.mode === '.trash' ? `（目录 ${trash.folder}）` : ''}`;
  snap.trashHostOption = trash.hostOption;
  return snap;
}

/**
 * 点击当前弹窗里的"推进流程"按钮（本插件自绘 DOM + Obsidian 原生确认框）。
 *
 * 三类弹窗要区别对待：
 * - **Obsidian 原生「更新链接？」框**（`总是更新` / `仅此一次` / `不做更新`）：选 `总是更新`。
 *   它是 `fileManager.renameFile` 在"自动更新内部链接"关闭时弹出的，**会阻塞整条改名流程**；
 *   `总是更新` 会被 Obsidian 记住，后续不再弹。真实 Obsidian 独有（测试替身里没有）。
 * - **候选选择窗**（含 `.iap-candidate-item`）：**必须跳过**——多候选场景下自动挑一个是
 *   "替用户做决定"，验收要求它保持原样。
 *   但"选定并修复"这条路径也必须被验证：加 `--fix-candidates` 后，**第一处**候选会被选中并点
 *   「以此修复」，其余仍跳过。否则"修复"只覆盖了"跳过"那一半，而**改写链路（选中 → 写回引用）
 *   从未在真实宿主执行过**。
 * - **预览/确认窗**：点 `确认`（`ConfirmModal` 的 CTA）；**报告窗**点 `关闭`。
 *
 * 注意**不能点 `取消`/`不做更新`**：那等于放弃执行，会让后续断言全变成"命令没生效"。
 */
const CLICK_CONFIRM = `(() => {
  const modal = document.querySelector('.modal-container');
  if (!modal) return null;
  const btns = Array.from(modal.querySelectorAll('button'));
  const find = (re) => btns.find((b) => re.test((b.textContent ?? '').trim()));
  // 0) **报告窗只点「关闭」**。它的 footer 里还有一个「去修复可确定断链」，而下面第 3 条 CTA 正则
  //    \`确认|以此修复|继续|应用|确定\` 会**匹配到它**（"可"确定"断链"里含"确定"）→ 每跑一次都会
  //    静默触发一次**真实的修复动作**（报告内修复本该只在显式开关下发生）。这是脚本自身的缺陷，
  //    2026-10-18 才发现：此前每一轮真宿主验收都在报告窗里"顺手修了一把"，会掩盖"断链是否真的被修"。
  // 注意：报告窗的 class 加在 modalEl（.modal）上，而不是 .modal-container——
  // 所以必须两者都查，只查 container 会漏（本脚本第一次修这里就漏了，仍在点"去修复"）。
  // ⚠️ 本段身处**模板字符串**内：注释里也不能出现反引号（会提前截断字符串）、不能写正则字面量。
  if (modal.classList.contains('iap-report-modal') || modal.querySelector('.iap-report-modal')) {
    const closeOnly = find(/^关闭$/);
    if (closeOnly) { closeOnly.click(); return '关闭(报告窗：只关不修)'; }
    return null;
  }
  // 1) Obsidian 原生「更新链接？」——必须"总是更新"，否则改名不改链接
  const native = find(/^总是更新$/) ?? find(/^仅此一次$/);
  if (native) { native.click(); return native.textContent.trim() + '(原生)'; }
  // 2) 本插件的候选选择窗
  if (modal.querySelector('.iap-candidate-item')) {
    // 2a) --fix-candidates：仅第一处走"选中并修复"（一次性标记，避免替用户决定整批断链）
    if (window.__iapFixCandidates && !window.__iapFixCandidatesUsed) {
      const item = modal.querySelector('.iap-candidate-item');
      if (item) {
        item.click();
        const fix = Array.from(modal.querySelectorAll('button'))
          .find((b) => /以此修复/.test((b.textContent ?? '').trim()));
        if (fix && !fix.disabled) {
          window.__iapFixCandidatesUsed = true;
          window.__iapFixPicked = (item.textContent ?? '').trim();
          fix.click();
          return '以此修复(候选)';
        }
      }
    }
    const skip = find(/^跳过$/) ?? find(/全部跳过/);
    if (skip) { skip.click(); return '跳过(候选)'; }
  }
  // 3) 预览 / 确认窗
  const cta = find(/确认|以此修复|继续|应用|确定/);
  if (cta) { cta.click(); return cta.textContent.trim(); }
  // 4) 报告窗
  const close = find(/^关闭$/);
  if (close) { close.click(); return '关闭(报告)'; }
  return null;
})()`;

/** 关闭可能阻塞的第三方弹窗（社区插件信任提示等）。 */
const DISMISS_BLOCKERS = `(() => {
  const btns = Array.from(document.querySelectorAll('.modal-container button, .modal button'));
  const t = btns.find((b) => /启用社区插件|Turn on community plugins|启用插件|信任|Trust/.test(b.textContent ?? ''));
  if (t) { t.click(); return t.textContent.trim(); }
  return null;
})()`;

/** 清掉残留弹窗（含上一轮没答完的原生框），避免它挡住后续命令。 */
/**
 * 轻量快照：只取文件路径列表（不读笔记内容）。
 * 完整快照 `collect()` 会把整库笔记逐个读一遍——`--trace-commands` 要逐命令采，必须用这个才够快。
 */
async function lightFiles(cdp) {
  const files = (await cdp.eval(`window.app.vault.getFiles().map((f) => f.path)`)) ?? [];
  const trash = await trashSnapshot(cdp);
  // **带上回收站**：轮末快照看不到"轮内创建 → 销毁"，只有逐命令的轻量快照（每条命令后都采）
  // 才能显示"哪条命令把什么删进了回收站"。排序放在 node 侧（两次采集要合并）。
  return [...files, ...trash.files].sort();
}

/**
 * 只读 ZIP 的**条目名列表**（解析中央目录，不解压）；文件不存在/不是 zip 时返回 `null`。
 *
 * 与 `src/core/zip.ts` 的 `listZipEntries` 是同一套解析（脚本不能 import TS，故内联）。
 * **为什么需要它**：`export-note` / `export-unused` 原先只断言"zip 文件存在"——
 * **空归档**（只有 manifest 没有附件）与**漏装附件**都能通过，那两条命令的"验 zip 内容"就名不副实。
 */
function readZipEntries(absPath) {
  if (!fs.existsSync(absPath)) return null;
  const buf = fs.readFileSync(absPath);
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      const cdOffset = buf.readUInt32LE(i + 16);
      const numEntries = buf.readUInt16LE(i + 10);
      const names = [];
      let p = cdOffset;
      for (let n = 0; n < numEntries; n++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) break;
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        names.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
        p += 46 + nameLen + extraLen + commentLen;
      }
      return names;
    }
  }
  return null;
}

/** 库内所有 `*.zip` 的绝对路径（跳过点目录；导出产物可能落在笔记目录，故递归找）。 */
function findZipFiles() {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of items) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs, depth + 1);
      else if (e.name.endsWith('.zip')) out.push(abs);
    }
  };
  walk(VAULT, 0);
  return out;
}

async function clearModals(cdp, label) {
  for (let i = 0; i < 20; i++) {
    const open = await cdp.eval(`document.querySelectorAll('.modal-container').length`);
    if (open === 0) return;
    const clicked = await cdp.eval(CLICK_CONFIRM);
    if (clicked) {
      console.log(`   · 清理残留弹窗（${label}）：${clicked}`);
      await sleep(300);
      continue;
    }
    // 认不出的弹窗：按 Esc 收起，避免阻塞
    await cdp.eval(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 1)`);
    await sleep(300);
    const still = await cdp.eval(`document.querySelectorAll('.modal-container').length`);
    if (still === 0) return;
    console.log(`   ! 有弹窗无法自动处理（${label}），共 ${still} 个`);
    return;
  }
}

/** 执行一条命令并处理其弹窗（可多次弹窗的交互层）。 */
async function runCommand(cdp, id) {
  await clearModals(cdp, `执行前 ${id.split(':').pop()}`);
  await cdp.eval(`window.app.commands.executeCommandById(${JSON.stringify(id)}), 1`);
  let clicks = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    const blocker = await cdp.eval(DISMISS_BLOCKERS);
    if (blocker) {
      console.log(`   · 关闭阻塞弹窗：${blocker}`);
      continue;
    }
    const opened = await cdp.eval(`document.querySelectorAll('.modal-container').length`);
    if (opened === 0) break;
    const clicked = await cdp.eval(CLICK_CONFIRM);
    if (clicked) {
      clicks++;
      continue;
    }
    // 弹窗在但没有可点的推进按钮 → 不再空转
    break;
  }
  await clearModals(cdp, `执行后 ${id.split(':').pop()}`);
  return clicks;
}

/* -------------------------------- 断言 -------------------------------- */

/**
 * 从笔记/画布文本提取本地引用目标（跳过外部 URL / data / 锚点 / 邮件），并保留**语法形态**。
 *
 * 与 `tests/e2e/acceptance.test.ts` 同一套解析，三处必须同步（缺一处就会漏掉一整类缺陷）：
 * - **wiki 剥掉 `#锚点` 与 `|别名`**：否则 `[[assets/a.pdf|说明文档]]`（本地化普通链接的产出形态）
 *   会被当成"名字里带 | 的路径"，解析必然失败；
 * - **canvas 的 `file` 字段**：插件的索引层把它算作"在用"，脚本若不解析，则
 *   "canvas 引用悬空 + 附件被当孤儿删掉"这一类**完全在扫描范围外**；
 * - **markdown 的 `<>` 包裹形式**：目标含空格时的合法写法。
 */
function localRefs(text) {
  const out = [];
  const push = (raw, kind) => {
    if (!raw) return;
    const t = raw.split('#')[0].trim();
    if (!t || /^(https?:|data:|mailto:|#)/i.test(t)) return;
    let decoded = t.replace(/^<|>$/g, '');
    try { decoded = decodeURIComponent(decoded); } catch { /* 畸形转义保持原样 */ }
    out.push({ target: decoded, kind });
  };
  for (const m of text.matchAll(/!?\[\[([^\]#|]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) push(m[1], 'wiki');
  // md 目标允许**一层括号嵌套**（`报告 (1).png` 是 Windows 上合法且常见的文件名）。
  // 写成 `([^)]+)` 会在 `(1)` 的 `)` 处收尾 → 截断目标既不进"在用"集合、也无法被改写，
  // 结果就是附件被当孤儿清理 + 笔记留下断链（2026-09-28 验收用例 L06/P01 实测）。
  // 与 `src/core/link-resolver.ts` 的 MD_DEST 保持同一口径（本文件是 .mjs/TS 两套实现，守卫在
  // tests/unit/acceptance-tooling.test.ts）。
  for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>]+)>|((?:[^()]|\([^()]*\))*))\)/g)) {
    push(m[1] ?? m[2], 'md');
  }
  for (const m of text.matchAll(/<(?:img|audio|video|source)\b[^>]*?src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    push(m[1] ?? m[2] ?? m[3], 'html');
  }
  for (const m of text.matchAll(/"file"\s*:\s*"([^"]*)"/g)) push(m[1], 'canvas');
  return out;
}

const basenameOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const stemOf = (p) => {
  const b = basenameOf(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(0, i) : b;
};

/**
 * 引用在当前文件树里能否解析。规则按语法区分：
 * - **路径式**（含 `/`）：wiki 忽略路径、按文件名解析；markdown / HTML / canvas 是路径式的 → 必须精确路径命中；
 * - **纯 basename**：三种写法 Obsidian 都按文件名解析；
 * - **wiki 且无扩展名**（`![[song]]`）：Obsidian 按**主名**解析（命中 `song.mp3`）。
 *
 * 早期实现一律按 basename 兜底，于是"引用被改到另一个同名文件"也算可解析——
 * 那正是最需要被这条不变式抓住的数据级错误指向。
 */
/** 全库"悬空引用"计数（与不变式同一套按语法解析的口径）。 */
function countUnresolved(files, notes) {
  let n = 0;
  for (const text of Object.values(notes ?? {})) {
    for (const ref of localRefs(text)) if (!resolvable(ref, files)) n++;
  }
  return n;
}

function resolvable(ref, files) {
  const target = typeof ref === 'string' ? ref : ref.target;
  const kind = typeof ref === 'string' ? 'md' : ref.kind;
  const norm = target.replace(/^\.\//, '');
  if (files.includes(norm)) return true;
  const base = basenameOf(norm);
  const byStem = () => kind === 'wiki' && !base.includes('.') && files.some((f) => stemOf(f) === base);
  if (norm.includes('/')) {
    if (kind === 'wiki') return files.some((f) => basenameOf(f) === base) || byStem();
    return false;
  }
  return files.some((f) => basenameOf(f) === base) || byStem();
}

/**
 * 结果检查。
 *
 * **用语义不变式，不用"原始路径"**：一轮 13 条命令本来就会连锁改名/移动附件，
 * 断言"`assets/gif/pic.gif` 还在"只会把正常的命名行为误报成"文件消失"
 * （harness 版早已改成不变式，本脚本此处曾漏改）。真正要守住的是四件事：
 * 非受管文件不得被动 · 排除目录整块不动 · **没有制造新断链** · 该清的清了、该留的留了。
 */
function checkResults(snap, phase, before) {
  const problems = [];
  const has = (p) => snap.files.includes(p);
  const noteText = (p) => snap.notes[p] ?? '';

  // **能力总开关全关**（`abilities-off`）：断言的是"关掉就不动"，与基线断言互斥，必须整段分叉。
  // 只断言**五件"不该发生"的事**（对应五个总开关），不重复断言"该发生的事"——
  // 后者在这里本来就不该发生。
  if (ABILITIES_OFF) {
    // ① 命名关 → 不得出现"已命名"形态（`_image_001` / `_image_png_001_…`）
    const named = snap.files.filter((f) => /_(image|video|audio|pdf|document)(_[a-z0-9]+)?_\d{3}\./.test(f));
    if (named.length) problems.push(`[${phase}] 命名总开关关闭，却出现已命名文件：${named.slice(0, 3).join(' | ')}`);
    // ② 导出关 → 不得生成 zip（`Unused_Attachments.zip` / `*_Attachments.zip`）
    const zips = snap.files.filter((f) => f.endsWith('.zip') && /_Attachments\.zip$|Unused_Attachments\.zip$/.test(f));
    if (zips.length) problems.push(`[${phase}] 导出总开关关闭，却生成了归档：${zips.slice(0, 3).join(' | ')}`);
    // ③ 清理关 → 真孤儿必须还在，且回收站不得新增
    if (!has('orphans/true-orphan.png')) {
      problems.push(`[${phase}] 清理总开关关闭，夹具的真孤儿却被删掉了`);
    }
    const newTrash = (snap.trash ?? []).filter((t) => !(before.trash ?? []).includes(t));
    if (newTrash.length) {
      problems.push(`[${phase}] 清理总开关关闭，库内回收站却新增 ${newTrash.length} 项：${newTrash.slice(0, 3).join(' | ')}`);
    }
    // ④ 本地化关 → 外链必须原样保留（抽查"本应被本地化"的那篇）
    if (!noteText('externals/图片.md').includes('127.0.0.1:45999')) {
      problems.push(`[${phase}] 本地化总开关关闭，\`externals/图片.md\` 的外链却被改写了`);
    }
    // ⑤ 一致性关 → "可确定修复"的断链必须**原样留着**（`notes/09` 的 `wrong-dir/pic.png` 正是
    //    「修复断链」唯一命中时会改掉的那条；没被改＝那条命令确实没干活）
    if (!noteText('notes/09-断链-精确可修.md').includes('wrong-dir/pic.png')) {
      problems.push(`[${phase}] 一致性总开关关闭，\`notes/09-断链-精确可修.md\` 的断链却被改写了`);
    }
    return problems;
  }

  // 1) 非受管文件必须原样存在（同名同路径）：插件不应管理这些类型
  for (const p of ['assets/noext', 'assets/other/note.txt', 'orphans/zip-orphan.zip', 'orphans/csv-orphan.csv']) {
    if (!has(p)) problems.push(`[${phase}] 非受管文件被移除或改名：${p}`);
  }
  // 2) 排除目录整块不动（文件与空目录都不许动）
  const exclBefore = before.files.filter((f) => f.startsWith('excluded/')).sort();
  const exclAfter = snap.files.filter((f) => f.startsWith('excluded/')).sort();
  if (JSON.stringify(exclBefore) !== JSON.stringify(exclAfter)) {
    problems.push(`[${phase}] 排除目录内容被改动：${exclBefore.length} → ${exclAfter.length}`);
  }
  if (!snap.folders.includes('excluded/empty-in-excluded')) problems.push(`[${phase}] 排除目录内的空目录被清理`);
  // 3) 核心不变式：没有制造新断链（每篇笔记"可解析引用数"不得减少）
  for (const [p, beforeText] of Object.entries(before.notes)) {
    if (!has(p)) {
      problems.push(`[${phase}] 笔记/画布消失：${p}`);
      continue;
    }
    const b = localRefs(beforeText).filter((r) => resolvable(r, before.files)).length;
    const nowRefs = localRefs(noteText(p));
    const a = nowRefs.filter((r) => resolvable(r, snap.files)).length;
    if (a < b) {
      const bad = nowRefs.filter((r) => !resolvable(r, snap.files)).map((r) => `${r.kind}:${r.target}`);
      problems.push(`[${phase}] ${p} 出现新断链：可解析引用 ${b} → ${a}；悬空=[${bad.join(' | ')}]`);
    }
  }
  // 4) canvas 的 file 引用必须仍可解析（2026-09-28 的真实数据损失缺陷：
  //    索引层认 canvas、改写层不认 → 「收集+命名」后引用悬空 → 「清理未用」把附件删掉）。
  const canvas = noteText('canvas/画布用例.canvas');
  if (canvas) {
    for (const m of canvas.matchAll(/"file"\s*:\s*"([^"]*)"/g)) {
      if (m[1].includes('canvas-missing')) continue; // 夹具里"故意缺失"的那一个
      if (!resolvable({ target: m[1], kind: 'canvas' }, snap.files)) {
        problems.push(`[${phase}] canvas 的 file 引用悬空：${m[1]}（改完文件引用没跟上）`);
      }
    }
  }
  // 5) 外链已本地化：只校验"本应本地化"之外的笔记；下面这些是**有意保留**的
  const keepExternal = new Set([
    'externals/网页.md',     // HTML 文档永不落存
    'externals/404.md',      // 下载失败
    'externals/内网.md',     // 不可达（本机 1 端口）
    'externals/黑名单.md',   // 域名黑名单
    'externals/仅白名单.md', // 未命中白名单
    'externals/svg外链.md',  // SVG 格式层面拒绝
    'externals/非受管外链.md', // 非受管类型（txt）
    'externals/含括号目标.md', // 目标含未转义括号 → 主动跳过（宁可漏本地化也不改坏正文）
  ]);
  for (const [p, t] of Object.entries(snap.notes)) {
    if (p.startsWith('excluded/') || keepExternal.has(p)) continue;
    if (/127\.0\.0\.1:45999/.test(t)) problems.push(`[${phase}] ${p} 仍含未本地化的外链`);
  }
  // 6) 保形改写
  if (noteText('notes/18-HTML媒体标签.md').includes('![](')) problems.push(`[${phase}] HTML 媒体标签被改写成图片嵌入`);
  if (noteText('externals/普通链接.md').includes('![说明文档]')) problems.push(`[${phase}] 普通链接被改写成图片嵌入`);
  // 6b) 目标含未转义括号时必须**原文不改**：改写的产物会是半截链接（`...local.png).png)`）
  if (noteText('externals/含括号目标.md') !== (before.notes['externals/含括号目标.md'] ?? '')) {
    problems.push(`[${phase}] 含未转义括号的目标被改写了（可能产出半截链接，属"宁可漏本地化也不改坏正文"的反例）`);
  }
  // 6c) 带标题的外链必须真的被本地化（旧实现整条漏掉），且 alt/图注不得丢失
  const titled = noteText('externals/带标题.md');
  if (titled.includes('127.0.0.1:45999')) problems.push(`[${phase}] 带标题的外链未被本地化（"目标后接不到 )"的旧缺陷回归）`);
  if (!titled.includes('图注')) problems.push(`[${phase}] 带标题外链的 alt/图注在改写中丢失`);
  // 7) 命名生效 —— **按变体断言**。命名方案本身就是变体改的轴，期望值必须跟着分叉；
  //    这里绝不放宽成"只要含 assets/ 就算过"——模糊匹配会让"命名方案整体没生效"也拿绿。
  const t01 = noteText('notes/01-正文图片.md');
  if (NAMING_RICH) {
    // 富化方案：<笔记名>_<类别>_<扩展名>_<序号>_<YYYYMMDDHHmmss>_<8 位路径哈希>
    const RICH_01 = /01-正文图片_image_png_\d{3}_\d{14}_[0-9a-f]{8}\.png/;
    if (!RICH_01.test(t01)) {
      problems.push(`[${phase}] 01 笔记未按富化方案命名（应含 类别_扩展名_序号_时间戳_哈希）：${t01.slice(0, 160)}`);
    }
    // folderByCategory 的唯一可观测效果：附件落进**类别子目录**，且该目录真的被建了出来
    if (!snap.files.some((f) => new RegExp(`^notes/assets/image/${RICH_01.source}$`).test(f))) {
      problems.push(`[${phase}] 富化方案下附件未落进类别子目录 notes/assets/image/`);
    }
    if (!snap.folders.includes('notes/assets/image')) {
      problems.push(`[${phase}] 类别子目录 notes/assets/image 未被真正建立（引用指向了不存在的目录）`);
    }
    // 反向：不该还留在 notes/assets 根——否则是"引用里多写了段路径"，而不是真的按类别分流
    if (snap.files.some((f) => /^notes\/assets\/[^/]+_image_png_/.test(f))) {
      problems.push(`[${phase}] 富化方案下附件仍落在 notes/assets 根（folderByCategory 未生效）`);
    }
    // 非图片类别走同一个 `entry.category` 分支但路径不同 → 各验一个代表，
    // 免得"只对图片生效"这种分支不对称悄悄溜过去
    for (const cat of ['video', 'audio', 'pdf']) {
      if (!snap.folders.some((f) => f.endsWith(`/assets/${cat}`))) {
        problems.push(`[${phase}] 未建立 ${cat} 类别子目录（folderByCategory 未按 entry.category 分流）`);
      }
    }
  } else if (!/01-正文图片_image_\d{3}\.png/.test(t01)) {
    problems.push(`[${phase}] 01 笔记未按方案命名：${t01.slice(0, 120)}`);
  }
  // 7.5) 落盘位置：**按变体断言**。这是"附件到底落在哪"的唯一真实验证。
  if (ROOT_LAYOUT) {
    if (!snap.files.some((f) => /^01-正文图片_image_\d{3}\.png$/.test(f))) {
      problems.push(`[${phase}] 默认配置（跟随 Obsidian + '/'）下附件未落在库根`);
    }
    if (snap.folders.includes('notes/assets')) {
      problems.push(`[${phase}] 默认配置下不该出现 notes/assets（说明仍按"笔记相对"落盘）`);
    }
  } else if (NAMING_RICH) {
    // 引用必须跟着落盘一起走：指向**新建的类别子目录**，而不只是 assets/
    if (!t01.includes('assets/image/')) {
      problems.push(`[${phase}] 富化方案下 01 笔记的引用未指向 assets/image/（落盘与改写脱节）`);
    }
  } else if (!noteText('notes/01-正文图片.md').includes('assets/')) {
    problems.push(`[${phase}] custom 变体下 01 笔记的引用不再指向 assets/（落盘位置漂了）`);
  }
  // 8) 该清的清了（真孤儿 / 空目录），该留的留着（含隐藏文件的目录）
  if (has('orphans/true-orphan.png')) problems.push(`[${phase}] 真孤儿未被清理（命令可能未生效）`);
  if (!has('Unused_Attachments.zip')) problems.push(`[${phase}] 导出未用附件未生成 zip`);
  for (const d of ['empty/leaf', 'empty/parent/child', 'empty/deep/a/b/c']) {
    if (snap.folders.includes(d)) problems.push(`[${phase}] 空目录未被清理：${d}`);
  }
  if (!snap.folders.includes('empty/hidden-file')) problems.push(`[${phase}] 含隐藏文件的目录被误清理`);
  return problems;
}

/**
 * 连接并确认可用。
 *
 * 为什么要"按时限轮询 + 每次重新取页面列表"：
 * - Obsidian 打开调试端口后，目标窗口要再等一会才把库加载完（此前 `app.vault` 还不存在），
 *   一次性探一次很容易探到"还没就绪"的页面而误判为不匹配；
 * - 用户可能同时开着别的库（多窗口 = 多 page），必须按 basePath 命中验收库；
 * - 应用若在启动时自我接管（自动更新后重启），端口会断开重开，只看一次会拿到死连接。
 */
async function connectStable(timeoutMs = 120000) {
  const until = Date.now() + timeoutMs;
  let lastLog = 0;
  while (Date.now() < until) {
    const pages = await waitForCdp(5000);
    if (pages) {
      for (const page of pages) {
        if (!(await pageIsVault(page))) continue;
        try {
          const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
          await cdp.send('Runtime.enable');
          const probe = await cdp.eval('1 + 1', { timeoutMs: 15000 });
          if (probe === 2) return cdp;
        } catch (e) {
          console.log(`   · 连接失败：${e.message}`);
        }
      }
      if (Date.now() - lastLog > 15000) {
        lastLog = Date.now();
        console.log(`   · 等待验收库窗口就绪（当前 ${pages.length} 个页面）…`);
      }
    }
    await sleep(1500);
  }
  return null;
}

/** 统计库内真实文件数（与 Obsidian 索引口径一致：跳过点文件与点目录）。 */
function diskFileCount(root) {
  let n = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else n++;
    }
  };
  walk(root);
  return n;
}

/**
 * 库内文件的"内容 ↔ 路径"双向索引。
 *
 * 为什么需要："附件没被删"**不能**按路径判断——13 条命令本来就会连锁改名/移动附件，
 * 甚至把它们搬进各自笔记的归属目录。唯一可靠的判据是"这份内容还在库里"。
 * 跳过点目录（`.trash/` 也算），因为被移进回收站对用户而言就是删除。
 */
function contentIndex(root) {
  const byContent = new Map();
  const byPath = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      const rel = path.relative(root, p).replace(/\\/g, '/');
      const b64 = fs.readFileSync(p).toString('base64');
      byPath.set(rel, b64);
      const list = byContent.get(b64);
      if (list) list.push(rel);
      else byContent.set(b64, [rel]);
    }
  };
  walk(root);
  return { byContent, byPath };
}

/**
 * 必须"内容仍在库里"的夹具附件。
 *
 * - `only-canvas.png` / `only-frontmatter.png`：只被 canvas / frontmatter 引用的附件。
 *   插件索引层认得它们（算作"在用"），改写层一度**不认** canvas，于是
 *   「收集 → 命名 → 清理」能把它们整条吃掉。验收的 O06/O07 正为此设。
 * - `shared.png`：被两篇笔记共享（一篇走 markdown、一篇走 HTML 标签）。
 *   Obsidian 的改名联动不认识 HTML，故共享判定一旦出错就会让 HTML 侧悬空。
 */
const GUARDED_CONTENT = [
  'orphans/only-canvas.png',
  'orphans/only-frontmatter.png',
  'assets/shared/shared.png',
  // 被三篇笔记用**三种不同语法**引用的 mp3（短名 / 路径式 / HTML src）。
  // 2026-09-28 实测：`![[song]]` 未随改名改写 → 原文件被当孤儿移入回收站、笔记留下悬空引用。
  'assets/mp3/song.mp3',
];

/** 受保护附件的内容是否仍在库中（按内容指纹比对，跳过 .trash）。 */
function checkContentSurvival(beforeIndex, afterIndex, phase) {
  const problems = [];
  for (const rel of GUARDED_CONTENT) {
    const fp = beforeIndex.byPath.get(rel);
    if (!fp) continue; // 夹具缺失就不误报
    if (!afterIndex.byContent.has(fp)) problems.push(`[${phase}] 受保护附件的内容在库中消失（原路径 ${rel}）`);
  }
  return problems;
}

/**
 * **设置页确实渲染**（真实宿主）。
 *
 * 为什么单独立一项：`settings-tab` 只在 harness 里验过，而替身**可能比真实宿主更宽松**（已 5 次踩中）。
 * 这里只做一件事——真的打开设置页、切到本插件页签、把文本读出来，断言**关键项确实在**。
 * 刻意**不做逐字全文比对**：文案微调就假红，而这里要验的是"结构与关键项存在"。
 */
async function runSettingsPageCheck(cdp, problems) {
  const text = await cdp.eval(`(async () => {
    const app = window.app;
    app.setting.open();
    app.setting.openTabById('${PLUGIN_ID}');
    await new Promise((r) => setTimeout(r, 400));
    const el = document.querySelector('.vertical-tab-content');
    return el ? el.innerText : '';
  })()`);
  if (!text) {
    problems.push('设置页断言失败：切到插件页签后读不到内容（页签没渲染，或插件没注册设置页）');
  } else {
    // 关键项必须出现在**同一份文本**里：避免"页签渲染了但只渲染了一部分"也能通过
    const required = ['删除方式', 'Obsidian 回收站', '系统回收站', '永久删除'];
    const missing = required.filter((w) => !text.includes(w));
    if (missing.length) {
      problems.push(`设置页缺少关键设置项/选项文案：${missing.join('、')}（读到的文本 ${text.length} 字符）`);
    }
    console.log(
      `   · 设置页：已渲染 ${text.length} 字符，关键项命中 ${required.length - missing.length}/${required.length}`,
    );
  }
  await cdp.eval('(() => { window.app.setting.close(); return 1; })()');
  await sleep(300);
}

/**
 * **通知级别三档语义**（真实宿主）。
 *
 * `notify-contract` 只在 harness 里验过，真实宿主历来只跑 `verbose` 一档。这里逐档切换，再触发一个
 * **确定会产出"摘要级"提示、且不弹确认窗**的操作：把 `requireConfirm` 临时关掉后跑「清理未用附件」
 * ——此时孤儿已在前面几轮清空，会走「没有未用的附件」这条 summary 提示。
 *
 * 断言：`silent` 档**无**通知、`summary` / `verbose` 档**有**通知。跑完恢复原档位与确认开关。
 * ⚠️ 必须在**收敛判定之后**做：改设置若发生在主流程之中，会干扰被判定的行为。
 */
async function runNotifyLevelCheck(cdp, problems, realId) {
  const before = await cdp.eval(`(() => {
    const p = window.app.plugins.plugins['${PLUGIN_ID}'];
    return { level: p.settings.notificationLevel, confirm: p.settings.cleanup.requireConfirm };
  })()`);
  // **判据用页面 DOM，而不是 JS 采集**：插件在**加载时**就绑定了它自己的 `Notice` 引用，事后包装
  // `window.Notice`（见 HOOK_NOTICES）**不会**改到它——所以采集数组对"插件弹的通知"天然采不到
  // （只采得到脚本自己 `new window.Notice` 的那条；本脚本第一版就是据此报了个假的"产品没提示"）。
  // 两条通道都读、都打印：**差异本身就是证据**。
  const CLEAR_NOTICES = `(() => {
    document.querySelectorAll('.notice-container .notice').forEach((el) => el.remove());
    window.app.plugins.plugins['${PLUGIN_ID}'].__acceptanceNotices = [];
    return 1;
  })()`;
  const READ_NOTICES = `(() => {
    const p = window.app.plugins.plugins['${PLUGIN_ID}'];
    return {
      dom: Array.from(document.querySelectorAll('.notice-container .notice')).map((el) => (el.textContent ?? '').trim()),
      hook: (p.__acceptanceNotices ?? []).slice(),
    };
  })()`;

  // **正对照（防空转）**：先证明"页面上的提示确实观测得到"——主动弹一条。
  await cdp.eval(CLEAR_NOTICES);
  await cdp.eval("(() => { new window.Notice('__acceptance_probe__'); return 1; })()");
  await sleep(300);
  const probe = await cdp.eval(READ_NOTICES);
  console.log(
    `   · 通知通道自检（主动弹一条）：页面 DOM ${probe.dom.length} 条，包装采集 ${probe.hook.length} 条` +
      `${probe.dom.length && !probe.hook.length ? '（不一致是预期的：插件用的是加载时绑定的 Notice 引用）' : ''}`,
  );
  if (!probe.dom.length) {
    problems.push('通知通道自检失败：主动弹出的提示在**页面上**也观测不到 → 三档判定不可靠（防空转先于判定）');
  }

  const seen = [];
  for (const [level, expect] of [
    ['silent', false],
    ['summary', true],
    ['verbose', true],
  ]) {
    await cdp.eval(CLEAR_NOTICES);
    await cdp.eval(`(() => {
      const p = window.app.plugins.plugins['${PLUGIN_ID}'];
      p.settings.notificationLevel = ${JSON.stringify(level)};
      p.settings.cleanup.requireConfirm = false;
      return 1;
    })()`);
    try {
      // 必须用**解析过的真实 id**：简写 id 在 `executeCommandById` 里找不到命令 → 命令根本没跑 →
      // 三档都观察不到提示（本脚本红过一次，属断言接线错误，不是产品缺陷）。
      await runCommand(cdp, realId('attachment:cleanup-unused') ?? 'attachment:cleanup-unused');
    } catch (e) {
      problems.push(`通知级别检查：${level} 档触发命令异常 → ${e.message}`);
      continue;
    }
    await sleep(500);
    const got = await cdp.eval(READ_NOTICES);
    seen.push(`${level}: DOM ${got.dom.length} / 采集 ${got.hook.length}`);
    if (expect && got.dom.length === 0) {
      problems.push(`通知级别 ${level} 档应当有提示，页面上一条都没出现`);
    }
    if (!expect && got.dom.length > 0) {
      problems.push(
        `通知级别 silent 档不应有任何提示，页面上出现 ${got.dom.length} 条：${String(got.dom[0]).slice(0, 60)}`,
      );
    }
  }
  await cdp.eval(`(() => {
    const p = window.app.plugins.plugins['${PLUGIN_ID}'];
    const s = ${JSON.stringify(before ?? {})};
    if (s.level) p.settings.notificationLevel = s.level;
    if (typeof s.confirm === 'boolean') p.settings.cleanup.requireConfirm = s.confirm;
    p.__acceptanceNotices = [];
    return 1;
  })()`);
  console.log(`   · 通知级别三档：${seen.join('；')}（判据＝页面 DOM；silent 应为 0）`);
}

/**
 * **一致性报告的内容 + 报告内定位跳转**（真实宿主）。
 *
 * 两件事一起做，因为它们在**同一个报告窗口**里：
 * ① 报告窗口里到底写了什么——脚本历来只跑命令、不看窗口（§2 矩阵那格是「不断言报告内容」）；
 * ② 点报告里的一条断链，**活动文件是否真的变成那篇笔记**（`revealRefInNote`；harness 第 18 组验过
 *    "打开 ≠ 定位"的分界）。
 *
 * ⚠️ **不能用 `runCommand`**：它会一路 `CLICK_CONFIRM` 把报告窗口**点掉**，而这里必须读窗口内容、
 * 还要点里面的条目。故直接 `executeCommandById` 并自己等窗口出现。
 */
/**
 * **能力总开关门禁**（真实宿主，`--variant abilities-off`）。
 *
 * 逐条执行 11 条受门禁的命令，断言每条都**早退并明说**「X 能力已关闭」，且**不弹任何窗口**。
 * 为什么值得单独跑：这一格长期只有 harness 覆盖，而"设置没接下去"是本仓库反复出过的形态
 * （删除模式、空目录去向都是同一类）。11 条门禁一次跑完，成本与本变体的一次普通验收相同。
 *
 * ⚠️ 两条**没有开关**的命令（收集当前笔记 / 收集全库）不在表里：它们本来就该继续跑，
 * 也正因为如此，本变体下库仍会因"收集"发生移动——这是设计如此，不是门禁失效。
 */
async function runAbilitiesOffGateCheck(cdp, problems, realId) {
  const GATES = [
    ['attachment:check-consistency', '一致性能力已关闭'],
    ['attachment:fix-broken-links', '一致性能力已关闭'],
    ['attachment:repair-incompatible-paths', '路径修复能力已关闭'],
    ['attachment:cleanup-unused', '清理能力已关闭'],
    ['attachment:cleanup-empty-folders', '清理能力已关闭'],
    ['attachment:rename-note', '命名能力已关闭'],
    ['attachment:bulk-rename', '命名能力已关闭'],
    ['attachment:localize-note', '本地化能力已关闭'],
    ['attachment:bulk-localize', '本地化能力已关闭'],
    ['attachment:export-note', '导出能力已关闭'],
    ['attachment:export-unused', '导出能力已关闭'],
  ];
  // 笔记级命令先看"有没有打开笔记"，所以必须先开一篇——否则测到的是"请先打开一个笔记"，
  // 门禁那一行根本没走到（会得到一条假红）。
  await cdp.eval(`(async () => { await window.app.workspace.openLinkText('notes/01-正文图片.md', '', false); return 1; })()`);
  await sleep(600);
  let ok = 0;
  for (const [base, expected] of GATES) {
    const id = realId(base) ?? base;
    await cdp.eval(`(() => { document.querySelectorAll('.notice-container .notice').forEach((el) => el.remove()); return 1; })()`);
    await cdp.eval(`(window.app.commands.executeCommandById(${JSON.stringify(id)}), 1)`);
    await sleep(600);
    const text =
      (await cdp.eval(
        `Array.from(document.querySelectorAll('.notice-container .notice')).map((el) => (el.textContent ?? '').trim()).join(' | ')`,
      )) ?? '';
    if (text.includes(expected)) ok++;
    else problems.push(`门禁未生效：${base} 应提示「${expected}」，实际「${text.slice(0, 140) || '（无提示）'}」`);
    const modal = await cdp.eval(`!!document.querySelector('.modal-container')`);
    if (modal) {
      problems.push(`门禁未生效：${base} 在能力关闭时仍弹出了窗口`);
      await clearModals(cdp, base);
    }
  }
  console.log(`   · 能力门禁：${ok}/${GATES.length} 条命令按预期早退并提示「已关闭」`);
}

async function runConsistencyReportCheck(cdp, problems, realId) {
  const id = realId('attachment:check-consistency') ?? 'attachment:check-consistency';
  if (ABILITIES_OFF) {
    // 一致性总开关关闭：**不得**出现报告窗口，且必须明说「已关闭」——静默早退会让用户以为坏了。
    // （这条替代了"报告内容 + 定位"两段断言：它们的前提是能力开着，这里断言的是反过来的事。）
    await cdp.eval(`(() => { document.querySelectorAll('.notice-container .notice').forEach((el) => el.remove()); return 1; })()`);
    await cdp.eval(`(window.app.commands.executeCommandById(${JSON.stringify(id)}), 1)`);
    await sleep(800);
    const opened = await cdp.eval(`!!document.querySelector('.iap-report-modal')`);
    if (opened) problems.push('一致性总开关关闭，却仍打开了报告窗口（门禁未生效）');
    const text =
      (await cdp.eval(
        `Array.from(document.querySelectorAll('.notice-container .notice')).map((el) => (el.textContent ?? '').trim()).join(' | ')`,
      )) ?? '';
    if (!text.includes('一致性能力已关闭')) {
      problems.push(`一致性总开关关闭，但没有提示「一致性能力已关闭」（实际「${text.slice(0, 120) || '（无）'}」）`);
    }
    console.log(`   · 能力关闭：报告窗口未打开=${!opened}；提示「一致性能力已关闭」=${text.includes('一致性能力已关闭')}`);
    await clearModals(cdp, '一致性报告（能力关闭）');
    return;
  }
  await cdp.eval(`(window.app.commands.executeCommandById(${JSON.stringify(id)}), 1)`);
  let text = '';
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    text =
      (await cdp.eval(`(() => { const m = document.querySelector('.iap-report-modal'); return m ? m.innerText : ''; })()`)) ??
      '';
    if (text) break;
  }
  if (!text) {
    problems.push('一致性报告断言：命令跑完但没有出现报告窗口（读不到 `.iap-report-modal`）');
    return;
  }
  const summary =
    (await cdp.eval(`(() => { const e = document.querySelector('.iap-report-summary'); return e ? e.innerText : ''; })()`)) ??
    '';
  const num = (re) => Number((summary.match(re) ?? [])[1] ?? -1);
  const counts = {
    broken: num(/坏链接\s*(\d+)/),
    unused: num(/未用\s*(\d+)/),
    fixable: num(/可修复路径\s*(\d+)/),
  };
  // **断言跟着数据走**：`ReportModal` 只给"有内容"的分组渲染标题（空段直接 `continue` 跳过），
  // 所以不能要求三段标题都在——要求"汇总里计数 > 0 的那几段，标题必须出现"。
  const expected = [];
  if (counts.unused > 0) expected.push('未用附件');
  if (counts.broken > 0) expected.push('需修复的引用');
  if (counts.fixable > 0) expected.push('需修复的不兼容路径');
  const missing = expected.filter((s) => !text.includes(s));
  if (missing.length) {
    problems.push(`报告汇总显示这些分组有内容、却没有出现标题：${missing.join('、')}（读到 ${text.length} 字符）`);
  }
  // **防空转**：夹具里本来就有**永久断链**（`13-断链-无候选`）。若汇总显示 0 条坏链接，说明它生成了
  // 一个"看起来正常、其实什么都没扫到"的结果——那种绿比红更坏。
  if (!(counts.broken > 0)) {
    problems.push(
      `一致性报告汇总里"坏链接"不为正（${counts.broken}）：夹具本含永久断链，报告却没扫到——汇总「${summary.slice(0, 80)}」`,
    );
  }
  if (expected.length === 0) {
    problems.push(
      `一致性报告汇总全为 0（坏链接 ${counts.broken} / 未用 ${counts.unused} / 可修复 ${counts.fixable}）` +
        '——什么都没扫到，内容断言无从谈起',
    );
  }
  console.log(
    `   · 一致性报告：${text.length} 字符；汇总「${summary.slice(0, 60)}」；应有分组 ${expected.length}，缺 ${missing.length}`,
  );

  // ② 点报告里那条永久断链，断言活动文件**真的变成它**
  const clicked = await cdp.eval(`(() => {
    const items = Array.from(document.querySelectorAll('.iap-report-item-clickable'));
    const hit = items.find((el) => (el.textContent ?? '').includes('13-断链'));
    if (!hit) return { total: items.length, ok: false };
    hit.click();
    return { total: items.length, ok: true };
  })()`);
  if (!clicked || !clicked.ok) {
    problems.push(
      `一致性报告里没有可点击的 \`13-断链\` 条目（可点条目共 ${clicked ? clicked.total : 0} 个）——定位无从验证`,
    );
  } else {
    await sleep(900);
    const active = (await cdp.eval(`(window.app.workspace.getActiveFile()?.path) ?? ''`)) ?? '';
    if (!active.includes('13-')) {
      problems.push(`点了报告里的断链条目后，活动文件不是那篇笔记（实际「${active}」）——"定位"没生效`);
    } else {
      console.log(`   · 报告内定位：点击后活动文件 = ${active}`);
    }
  }
  await clearModals(cdp, '一致性报告');
}

/**
 * **网络策略收紧**探针（真实宿主，`--variant net-strict`）。
 *
 * 造一篇含两条外链的探针笔记：
 * - `http://127.0.0.1:PORT/...`：在白名单里 → 必须**仍然被下载**（allow 覆盖 private 的正面证据）；
 * - `http://blocked.invalid/...`：不在白名单、也不是内网 → 必须**在发请求前**被拦、原文保留，
 *   且摘要把它归到「名单」而不是「内网」。
 *
 * 两条都必须断言：只验"能下"无法发现"默认拒绝没生效"，只验"被拦"无法发现"白名单被误伤"。
 */
async function runNetStrictCheck(cdp, problems, realId) {
  const DIR = 'net-strict-probe';
  const ALLOWED = `http://127.0.0.1:${HTTP_PORT}/probe-allowed.png`;
  const NOT_ALLOWED = 'http://blocked.invalid/probe.png';
  const created = await cdp.eval(`(async () => {
    const app = window.app;
    const nl = String.fromCharCode(10);
    try { await app.vault.createFolder('${DIR}'); } catch (e) { /* 已存在 */ }
    const notePath = '${DIR}/Probe.md';
    if (!app.vault.getAbstractFileByPath(notePath)) {
      await app.vault.create(
        notePath,
        '# net-strict' + nl + nl + '![ok](${ALLOWED})' + nl + nl + '![bad](${NOT_ALLOWED})' + nl,
      );
    }
    await window.app.workspace.openLinkText(notePath, '', false);
    return 1;
  })()`);
  if (created !== 1) {
    problems.push('网络策略探针：笔记没建成 → 无从验证（防空转）');
    return;
  }
  await sleep(600);
  await cdp.eval(`(() => { document.querySelectorAll('.notice-container .notice').forEach((el) => el.remove()); return 1; })()`);
  const id = realId('attachment:localize-note') ?? 'attachment:localize-note';
  await cdp.eval(`(window.app.commands.executeCommandById(${JSON.stringify(id)}), 1)`);
  await sleep(1500);
  const res = await cdp.eval(`(async () => {
    const app = window.app;
    const f = app.vault.getAbstractFileByPath('${DIR}/Probe.md');
    if (!f) return null;
    const t = await app.vault.read(f);
    return {
      text: t,
      files: app.vault.getFiles().filter((x) => x.path.startsWith('${DIR}/')).map((x) => x.path),
      notice: Array.from(document.querySelectorAll('.notice-container .notice')).map((el) => (el.textContent ?? '').trim()).join(' | '),
    };
  })()`);
  if (!res) {
    problems.push('网络策略探针：读不到探针笔记（防空转）');
    return;
  }
  // ① 白名单里显式列出的域：必须仍然能下（`evaluateHostPolicy` 里 allow 在 private 之前）
  if (res.text.includes('probe-allowed.png')) {
    problems.push('白名单里显式列出的域没有被本地化（allow 未覆盖内网拦截，或下载被拦）');
  }
  if (!res.files.some((f) => f.endsWith('.png'))) {
    problems.push('白名单域下载后没有落盘文件（收紧策略下本地化链路失效）');
  }
  // ② 非白名单域：必须在发请求前被拦，原文保留，且归到「名单」
  if (!res.text.includes('blocked.invalid')) {
    problems.push('未列入白名单的域反而被改写了（"默认拒绝"没生效）');
  }
  if (!res.notice.includes('名单 1')) {
    problems.push(`摘要没有把「未列入白名单」归到名单拦截（读到「${res.notice.slice(0, 160) || '（无提示）'}」）`);
  }
  console.log(
    `   · 网络策略（仅白名单 + 拦截内网 + 白名单 127.0.0.1）：白名单域已落盘=${!res.text.includes('probe-allowed.png')}，` +
      `非白名单域保留原文=${res.text.includes('blocked.invalid')}，摘要含「名单 1」=${res.notice.includes('名单 1')}`,
  );
}

/**
 * **笔记移动跟随**（`followNoteMove`，真实宿主）。
 *
 * 验收配置下该开关**非默认**，脚本又从不移动笔记 → 这条能力在真宿主从未被触发过。
 * 做法：造一份**独占**探针（一篇笔记 + 它自己的相对型附件目录），把笔记移到另一个目录，断言
 * **附件跟着走**、**旧位置不再有它**。
 * 这里测的是"跟随"，不是"引用改写"：笔记与 `assets/` 一起搬，相对路径 `assets/probe.png` 仍解析得到
 * ——那正是这条能力要保住的"拖完笔记图不会丢"。
 */
async function runFollowNoteMoveCheck(cdp, problems) {
  if (ROOT_LAYOUT) {
    // **库根落盘模式下这条能力按设计就是空操作**：附件不在"笔记相对目录"里（`'/'`＝库根），
    // 笔记搬到哪都不需要动附件。探针在这里没有可断言的事——硬跑会得到一条**假红**
    // （"附件没跟过去"）。本变体此前从未跑过这条探针（10-18 首次加探针只跑了 custom），
    // 首次补跑即撞上，故在此显式跳过并留痕，而不是把断言放宽成模糊匹配。
    console.log('   · 笔记移动跟随：跳过（库根落盘模式，按设计为空操作——附件本就不在笔记相对目录里）');
    return;
  }
  // 期望值**按变体分叉**：`follow-off`（显式关）与 `abilities-off`（一致性总开关关）都应"不跟随"。
  // 只验"开着会跟随"是半个证据——若这条分支被硬编码成"总是跟随"，那些用例照样绿。
  const expectFollow = !FOLLOW_OFF && !ABILITIES_OFF;
  const created = await cdp.eval(`(async () => {
    const app = window.app;
    const p = app.plugins.plugins['${PLUGIN_ID}'];
    p.settings.consistency.followNoteMove = ${expectFollow};
    const mk = async (d) => { try { await app.vault.createFolder(d); } catch { /* 已存在 */ } };
    await mk('follow-probe');
    await mk('follow-probe/assets');
    await mk('follow-probe-moved');
    const src = app.vault.getAbstractFileByPath('assets/png/pic.png');
    if (!src) return { ok: false, why: '找不到夹具 PNG' };
    const buf = await app.vault.readBinary(src);
    try { await app.vault.createBinary('follow-probe/assets/probe.png', buf); } catch { /* 已存在 */ }
    const notePath = 'follow-probe/Probe.md';
    if (!app.vault.getAbstractFileByPath(notePath)) {
      await app.vault.create(notePath, '# probe' + String.fromCharCode(10) + String.fromCharCode(10) + '![x](assets/probe.png)' + String.fromCharCode(10));
    }
    return { ok: true, hasAtt: !!app.vault.getAbstractFileByPath('follow-probe/assets/probe.png') };
  })()`);
  if (!created || !created.ok || !created.hasAtt) {
    problems.push(
      `笔记移动跟随：探针没建成（${created ? created.why ?? '附件缺失' : 'eval 无返回'}）→ 无从验证（防空转）`,
    );
    return;
  }
  await sleep(500);
  await cdp.eval(`(async () => {
    const app = window.app;
    const f = app.vault.getAbstractFileByPath('follow-probe/Probe.md');
    if (f) await app.fileManager.renameFile(f, 'follow-probe-moved/Probe.md');
    return 1;
  })()`);
  await sleep(1500);
  // 断言**按目录计数**，不认具体文件名：`--startup-check` 下自动化是开着的，探针附件可能已被
  // 统一命名（`probe.png` → `Probe_image_001.png`）——写死文件名会得到一条假红（首次补跑就撞上）。
  const after = await cdp.eval(`(() => {
    const app = window.app;
    const has = (p) => !!app.vault.getAbstractFileByPath(p);
    const count = (p) => {
      const f = app.vault.getAbstractFileByPath(p);
      return f && f.children ? f.children.length : 0;
    };
    return {
      note: has('follow-probe-moved/Probe.md'),
      newCount: count('follow-probe-moved/assets'),
      oldCount: count('follow-probe/assets'),
    };
  })()`);
  if (!after || !after.note) {
    problems.push('笔记移动跟随：探针笔记没移动到目标位置（`renameFile` 没生效）→ 无从验证');
    return;
  }
  if (expectFollow) {
    if (after.newCount < 1) {
      problems.push('笔记移动跟随未生效：笔记搬走了，但附件没跟过去（`follow-probe-moved/assets/` 是空的）');
    }
    if (after.oldCount > 0) {
      problems.push(`笔记移动跟随：附件仍留在旧位置（\`follow-probe/assets/\` 还有 ${after.oldCount} 个文件）`);
    }
  } else {
    // 关闭态：附件必须**原地不动**（跟随是"移动笔记"这条路径上唯一会动附件的动作）
    if (after.newCount > 0) {
      problems.push('笔记移动跟随已关闭，附件却仍被搬到了新目录（关闭未生效，或该分支被硬编码成"总是跟随"）');
    }
    if (after.oldCount < 1) {
      problems.push('笔记移动跟随已关闭，旧位置却找不到附件（被误搬或被删）');
    }
  }
  console.log(
    `   · 笔记移动跟随（期望跟随=${expectFollow}）：已移动=${after.note}，新目录附件=${after.newCount}，旧目录残留=${after.oldCount}`,
  );
}

/**
 * **schema 迁移**（真实宿主）。
 *
 * `settings-migration` 只在 harness 里验过。这里走真链路：写一份**缺字段的旧版 `data.json`** →
 * **重载插件**（触发 `loadSettings` + `migrateSettings`）→ 断言 ①缺的字段被补成默认值
 * ②**用户显式写过的值被保留** → 恢复原配置并再重载一次。
 *
 * ⚠️ **必须放在所有阶段之后**：重载插件会重建全部内存状态（索引、通知采集…）。
 */
async function runMigrationCheck(cdp, problems) {
  const dataPath = path.join(VAULT, '.obsidian', 'plugins', PLUGIN_ID, 'data.json');
  let original = null;
  try {
    original = fs.readFileSync(dataPath, 'utf8');
  } catch {
    problems.push('schema 迁移：读不到插件的 `data.json`，无法验证');
    return;
  }
  const reload = async () => {
    await cdp.eval(`(async () => {
      const app = window.app;
      await app.plugins.disablePlugin('${PLUGIN_ID}');
      await app.plugins.enablePlugin('${PLUGIN_ID}');
      return 1;
    })()`);
    await sleep(1500);
  };
  try {
    // 只留 `version` + 一个**用户显式值**（silent），其余全部缺失 → 逼它走迁移补全
    fs.writeFileSync(dataPath, JSON.stringify({ version: '0.0.1', notificationLevel: 'silent' }, null, 2), 'utf8');
    await reload();
    const s = await cdp.eval(`(() => {
      const p = window.app.plugins.plugins['${PLUGIN_ID}'];
      if (!p) return null;
      const st = p.settings;
      return {
        cleanup: !!st.cleanup,
        deleteMode: st.cleanup && st.cleanup.deleteMode,
        naming: !!st.naming,
        platformsIsArray: Array.isArray(st.consistency && st.consistency.platforms),
        level: st.notificationLevel,
      };
    })()`);
    if (!s) {
      problems.push('schema 迁移：重载后插件没加载起来（`app.plugins.plugins[...]` 为空）');
    } else {
      if (!s.cleanup || !s.naming) problems.push('schema 迁移：缺失的分组没被补全（cleanup / naming 为空）');
      if (!['.trash', 'system-trash', 'permanent'].includes(s.deleteMode)) {
        problems.push(`schema 迁移：\`cleanup.deleteMode\` 没被补成合法默认值（实际 ${s.deleteMode}）`);
      }
      if (!s.platformsIsArray) problems.push('schema 迁移：`consistency.platforms` 没被补成数组');
      if (s.level !== 'silent') {
        problems.push(`schema 迁移：用户显式写过的 \`notificationLevel\` 被覆盖（期望 silent，实际 ${s.level}）`);
      }
      console.log(
        `   · schema 迁移：补全 cleanup=${s.cleanup} naming=${s.naming} platforms=${s.platformsIsArray}；` +
          `用户值 level=${s.level}（应保留 silent）`,
      );
    }
  } finally {
    fs.writeFileSync(dataPath, original, 'utf8');
    await reload();
  }
}

/* ---------------------------------- 主流程 ---------------------------------- */

/** 库内 `.md`/`.canvas` 的内容快照（跳过点目录：`.obsidian` / `.trash`）。 */
function snapshotNoteTexts() {
  const out = {};
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs, r);
      else if (/\.(md|canvas)$/i.test(e.name)) out[r] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(VAULT, '');
  return out;
}

/**
 * 启动哨兵的**前置动作**：放哨兵文件 + 记录基线。必须在启动 Obsidian 之前调用——
 * 哨兵必须赶在宿主索引之前存在，否则它自己不会经历启动期的那批事件。
 */
function prepareStartupCheck() {
  if (!STARTUP_CHECK) return;
  const dir = path.join(VAULT, 'canary');
  fs.mkdirSync(dir, { recursive: true });
  // 内容带唯一标记：附件一旦被改名/搬走，按路径即可判定（不必比对字节）
  fs.writeFileSync(path.join(VAULT, CANARY_ATT), Buffer.concat([PNG_HEADER, Buffer.from('MARKER-CANARY')]));
  fs.writeFileSync(
    path.join(VAULT, CANARY_NOTE),
    `# 20 启动哨兵\n\n![x](${CANARY_ATT})\n`,
    'utf8',
  );
  startupBaseline = snapshotNoteTexts();
  console.log(
    `[obsidian-acceptance] 启动哨兵已放置（${CANARY_NOTE} → ${CANARY_ATT}），` +
      `并记录 ${Object.keys(startupBaseline).length} 篇笔记的内容基线`,
  );
}

/**
 * 启动哨兵阶段：等过"就绪兜底 + 余震窗口 + 两轮轮询"，断言打开库没有改写任何笔记。
 * 必须在**任何命令之前**执行，否则分不清"是自动处理改的"还是"命令改的"。
 */
async function runStartupCheck(cdp, problems) {
  if (!STARTUP_CHECK) return null;
  console.log(`   · 启动哨兵：全程不触碰库，等待 ${STARTUP_WAIT_MS}ms（盖过就绪兜底与两轮轮询）…`);
  await sleep(STARTUP_WAIT_MS);

  const diag = await cdp.eval(
    `(() => {
       const p = window.app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
       return typeof p?.getAutomationDiagnostics === 'function' ? p.getAutomationDiagnostics() : null;
     })()`,
  );

  const now = snapshotNoteTexts();
  const changed = [];
  for (const [rel, text] of Object.entries(now)) {
    if (!(rel in startupBaseline)) changed.push(`${rel}（新建）`);
    else if (startupBaseline[rel] !== text) changed.push(rel);
  }
  for (const rel of Object.keys(startupBaseline)) if (!(rel in now)) changed.push(`${rel}（消失）`);

  const canaryNoteOk = String(now[CANARY_NOTE] ?? '').includes(CANARY_ATT);
  const canaryAttOk = fs.existsSync(path.join(VAULT, CANARY_ATT));
  const suppressed = diag?.stats?.suppressedNotSettled ?? 0;
  const refused = diag?.stats?.sweepRefused ?? 0;

  if (changed.length) {
    problems.push(
      `[启动哨兵] 打开库后未做任何操作，却有 ${changed.length} 篇笔记被改写：` +
        `${changed.slice(0, 5).join('、')}${changed.length > 5 ? ` …（共 ${changed.length} 篇）` : ''}`,
    );
  }
  if (!canaryNoteOk) problems.push(`[启动哨兵] 哨兵笔记被自动改写（引用已不再指向 ${CANARY_ATT}）`);
  if (!canaryAttOk) problems.push(`[启动哨兵] 哨兵附件被自动改名/搬走：${CANARY_ATT} 已不在原处`);

  console.log(
    `   · 启动哨兵结果：笔记改写 ${changed.length} 篇 / 哨兵附件${canaryAttOk ? '仍在原处' : '已消失'}；` +
      `就绪信号=${diag?.settleSource || '（无）'}，启动期被就绪门挡下 ${suppressed} 个 changed，` +
      `批量护栏拒绝 ${refused} 次`,
  );
  if (!diag) {
    console.warn('   ! 取不到插件诊断（getAutomationDiagnostics）→ 无法判断"这道门是否真在挡东西"');
  }
  return {
    noteChanges: changed.length,
    changed: changed.slice(0, 20),
    canaryIntact: canaryNoteOk && canaryAttOk,
    suppressedAtStartup: suppressed,
    sweepRefused: refused,
    settleSource: diag?.settleSource ?? null,
    settledAt: diag?.settledAt ?? null,
    diagnostics: diag ?? null,
  };
}

async function main() {
  applyVariantConfig();
  prepareStartupCheck();
  if (!fs.existsSync(OBSIDIAN)) throw new Error(`未找到 Obsidian：${OBSIDIAN}`);
  if (!fs.existsSync(path.join(VAULT, '.obsidian', 'plugins', PLUGIN_ID, 'main.js'))) {
    throw new Error(`验收库未就绪（缺插件）：先 npm run build 并跑 seed-acceptance 测试 —— ${VAULT}`);
  }

  const server = await startAcceptanceHttpServer(HTTP_PORT);
  console.log(`[obsidian-acceptance] 本地服务已启动 http://127.0.0.1:${HTTP_PORT}`);

  // 已有实例（且带着调试端口）则复用，否则拉起一个。
  //
  // 注意：这里**故意不用 detached**。在受限的自动化宿主里，detached 出去的子进程会在
  // 启动它的命令结束时被一并回收（表现为"Obsidian 启动后十几秒自己退出"）。
  // 让 Obsidian 作为本脚本的子进程存活，脚本结束时再 `taskkill /T` 收干净。
  let spawned = null;
  let existing = await waitForCdp(3000);
  if (!existing) {
    console.log(`[obsidian-acceptance] 启动 Obsidian：${OBSIDIAN}`);
    spawned = spawn(OBSIDIAN, [VAULT, `--remote-debugging-port=${CDP_PORT}`], { stdio: 'ignore' });
  } else {
    console.log('[obsidian-acceptance] 复用已运行的 Obsidian 实例');
  }

  const cdp = await connectStable();
  if (!cdp) {
    console.log('[obsidian-acceptance] 无法连接 CDP（Obsidian 可能已在运行但未开放调试端口）。');
    console.log('[obsidian-acceptance] 请改用人工清单模式：按 for-test/acceptance/EXPECTED.md 逐条核对。');
    server.close();
    killObsidian(spawned);
    process.exit(2);
  }
  await sleep(2000); // 等应用把工作区与插件宿主就绪
  if (PLUGIN_LOG) {
    // 采集宿主控制台：本脚本的 cdp 封装**没有事件订阅**（`cdp.on` 不存在），所以改成
    // 在页面里包一层 `console`，把插件的 plan 日志（`logger.debug`）攒进数组，最后一次性取回。
    await cdp.eval(`(() => {
      if (window.__iapPluginLog) return 1;
      window.__iapPluginLog = [];
      // ⚠️ **绝不能 JSON.stringify 参数**：插件会 log 大对象（索引快照），序列化会把宿主
      // 拖慢到**改变被测行为**（实测：开了这层包装后连 notes/assets 都没建出来）。只保留
      // 字符串与原始值，其余一律记成占位；同时限制条数，避免数组无限增长。
      const LIMIT = 500;
      // **只留"计划类"行**：插件每轮都打计划日志，全量采集会被上限截断、看不到后面几轮；
      // 预先过滤既够用又不挤爆数组。用 includes 而非正则——这段代码要经模板字符串送进宿主，
      // 正则字面量在里面会被转义规则啃坏（实测报 "Invalid regular expression: missing /"）。
      const KEEP = ['命名计划', '计划[', '收集计划', '清理', '待处理', '跳过共享', '引用改写', '失败'];
      for (const k of ['log', 'debug', 'info', 'warn', 'error']) {
        const orig = console[k].bind(console);
        console[k] = (...args) => {
          try {
            const s = args.length === 1 && typeof args[0] === 'string' ? args[0] : null;
            if (s && window.__iapPluginLog.length < LIMIT && KEEP.some((kw) => s.indexOf(kw) >= 0)) {
              window.__iapPluginLog.push(k + ' ' + s);
            }
          } catch (e) { /* 采集失败不能影响宿主 */ }
          return orig(...args);
        };
      }
      return 1;
    })()`);
    console.log('[obsidian-acceptance] 已包装宿主 console（--plugin-log）');
  }
  process.on('exit', () => killObsidian(spawned));
  // 等待工作区与插件宿主就绪
  await waitUntil(cdp, 'window.app && window.app.workspace && window.app.plugins', 'Obsidian 就绪', 60000);
  console.log('[obsidian-acceptance] 已连接 Obsidian 渲染进程');

  // 关闭受限模式并启用插件（内部 API；真实用户走设置面板）
  await cdp.eval(`(async () => { window.app.plugins.setEnable(true); return 1; })()`);
  for (let i = 0; i < 10; i++) {
    await cdp.eval(DISMISS_BLOCKERS);
    await sleep(500);
  }
  await cdp.eval(
    `(async () => { if (!window.app.plugins.plugins['${PLUGIN_ID}']) { await window.app.plugins.enablePlugin('${PLUGIN_ID}'); } return 1; })()`,
  );
  const ok = await waitUntil(cdp, `window.app.plugins.plugins['${PLUGIN_ID}']`, '插件已加载', 30000);
  if (!ok) throw new Error('插件未能加载，请检查验收库中的 main.js / manifest.json');
  await cdp.eval(HOOK_NOTICES);
  await cdp.eval(`(window.app.plugins.plugins['${PLUGIN_ID}'].__acceptanceNotices = [])`);
  console.log('[obsidian-acceptance] 插件已启用，开始执行命令');

  // 前置校验：库索引必须与磁盘一致。
  // 验收库会被"外部"（seed 生成器）整体重写，而 Obsidian 的文件监听可能跟不上批量删除，
  // 于是索引里会留下磁盘上已不存在的幽灵条目——那时整轮结论都建立在假数据上。
  const onDisk = diskFileCount(VAULT);
  console.log(`   · 库索引 ${(await collect(cdp)).files.length} 个 / 磁盘 ${onDisk} 个`);
  const idxNow = await collect(cdp);
  if (idxNow.files.length !== onDisk) {
    throw new Error(
      `库索引与磁盘不一致（索引 ${idxNow.files.length} / 磁盘 ${onDisk}）：Obsidian 的索引未跟上外部改动。` +
        '请先在 Obsidian 里执行「Reload app without saving」（重载应用）后重跑本脚本。',
    );
  }

  // 真实 id（带插件前缀）——写死基名会静默失败，见 resolveCommandIds()
  const REAL_IDS = await resolveCommandIds(cdp);
  const realId = (base) => REAL_IDS.find((r) => r.split(':').pop() === base.split(':').pop());

  const problems = [];
  // 启动哨兵阶段（可选）：必须在任何命令之前，否则分不清"是自动处理改的"还是"命令改的"
  const startupCheck = await runStartupCheck(cdp, problems);

  console.log('   · 采集初始快照…');
  const before = await collect(cdp);
  // 与快照同一时刻记录"内容指纹"，供"受保护附件是否真的还在库里"的判定
  const beforeContent = contentIndex(VAULT);
  console.log(`   · 初始文件 ${before.files.length} 个`);
  // **删除模式必须显式报出来**：收敛判定新增了"轮末回收站新增"这条腿，而它只在插件把附件删进
  // **库内** `.trash` 时可用（判据取插件自己的 `cleanup.deleteMode`，与**删除侧**同口径；宿主的
  // `trashOption` 管的是用户按 Delete 键的行为，仅供对照）。非 `.trash` 时**不能静默**——
  // 否则"没采到"会被误读成"没发生删除"（假绿）。
  console.log(
    `   · 删除模式：${before.trashMode}（初始回收站 ${before.trash.length} 条）；` +
      `宿主 trashOption = ${before.trashHostOption}（对照用，插件删除不看它）`,
  );
  if (String(before.trashMode).startsWith('.trash')) {
    console.log('     ↳ 已启用"轮内删除"探测：每轮末比较回收站**新增**项（轮末文件集合看不到的销毁靠它显形）');
  } else {
    console.log('     ↳ ⚠️ 删除模式非 `.trash`：**无库内目录可查**，"轮内创建 → 销毁"仍不可见（本变体下该项未闭合）');
  }

  // 先跑"当前笔记级"命令：它们依赖活动笔记，须先打开宿主笔记
  const NOTE_COMMANDS = [
    'attachment:localize-note',
    'attachment:rename-note',
    'attachment:collect-current-note',
    'attachment:export-note',
  ];
  let step = 0;
  for (const note of ['notes/01-正文图片.md', 'notes/12-断链-多候选.md', 'deep/多级/深层笔记.md', 'externals/图片.md']) {
    await cdp.eval(`(async () => { await window.app.workspace.openLinkText(${JSON.stringify(note)}, '', false); return 1; })()`);
    await sleep(400);
    step++;
    console.log(`→ [${step}] 当前笔记级 4 命令 @${note}`);
    for (const id of NOTE_COMMANDS.map(realId)) {
      try {
        const clicks = await runCommand(cdp, id);
        if (clicks === 0) console.log(`   · ${id} 无弹窗`);
      } catch (e) {
        problems.push(`命令异常：${id} @${note} → ${e.message}`);
      }
    }
  }

  // 轮次循环：连跑整套命令直到**收敛**（再跑一轮文件集合不再变化）。
  //
  // 为什么不是"跑一遍就稳定"：13 条命令按固定顺序连跑时，「收集（把附件搬到笔记归属目录）」
  // 排在「重命名（原地改名）」之前——本轮命名出的文件要等下一轮的收集才进笔记目录；
  // 而真实 Obsidian 的库缓存/索引在插件自身改写后也有轻微滞后。两者叠加使状态需要多轮才稳定。
  // 真正要守的是两件事：① **每轮都不许出现数据损失 / 新断链**（用户可能只跑一条就停手）；
  // ② **有限轮内必须收敛**（若不收敛即为震荡型缺陷）。
  const MAX_PASSES = Number(arg('maxPasses', '6'));
  const unresolvedBefore = countUnresolved(before.files, before.notes);
  if (FIX_CANDIDATES) {
    // 一次性标记放在页面里：CLICK_CONFIRM 是注入的字符串，只能通过 window 传参
    await cdp.eval(`(() => {
      window.__iapFixCandidates = true;
      window.__iapFixCandidatesUsed = false;
      window.__iapFixPicked = null;
      return 1;
    })()`);
    console.log('   · 候选修复已开启：第一处候选将被选中并点「以此修复」，其余仍跳过');
  }
  const states = [];
  const deltas = [];
  /** 导出产物的**逐轮条目快照**（只在 `export-*` 之后采；见循环里的注释）。 */
  const zipSnapshots = [];
  let convergedAt = 0;
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    console.log(`\n[obsidian-acceptance] 第 ${pass} 轮：执行全部 ${REAL_IDS.length} 条命令`);
    // `--trace-commands`：逐命令追踪文件集合的变化，把"某文件每轮都在变"归因到**具体命令**。
    let tracePrev = TRACE_COMMANDS ? await lightFiles(cdp) : null;
    for (const id of REAL_IDS) {
      step++;
      if (pass === 1) console.log(`→ [${step}] ${id}`);
      try {
        const clicks = await runCommand(cdp, id);
        if (clicks === 0 && pass === 1) console.log('   · 无弹窗（可能无需处理）');
      } catch (e) {
        problems.push(`命令异常：${id}（第 ${pass} 轮）→ ${e.message}`);
      }
      // **导出产物要"趁热"采**：`export-unused` 的内容随轮次变化（第 1 轮还有孤儿、后面几轮已清空），
      // 若等到流程末尾统一读，读到的多半是"只剩 manifest"的那一份 → 断言会假红。
      // ⚠️ `REAL_IDS` 里是 `resolveCommandIds()` 解析出的**带插件前缀的真实 id**
      // （如 `attachment-suite:attachment:export-unused`），**不能**用简写比对——否则钩子永不命中，
      // 断言只会得到"一次都没采到"（本轮就是这么红的，属断言自身的接线错误，不是产品缺陷）。
      if (id.endsWith(':export-unused') || id.endsWith(':export-note')) {
        for (const z of findZipFiles()) {
          const names = readZipEntries(z);
          if (names && names.length > 0) zipSnapshots.push({ pass, file: path.basename(z), names });
        }
      }
      if (TRACE_COMMANDS) {
        const now = await lightFiles(cdp);
        const d = [
          ...now.filter((f) => !tracePrev.includes(f)).map((f) => `+${f}`),
          ...tracePrev.filter((f) => !now.includes(f)).map((f) => `-${f}`),
        ];
        if (d.length) {
          console.log(`      ↳ ${id} 改了 ${d.length} 项：${d.slice(0, 8).join(' | ')}${d.length > 8 ? ' …' : ''}`);
        }
        tracePrev = now;
      }
    }
    const snap = await collect(cdp);
    // 每轮都过一遍不变式：用户可能只跑一条命令就停手，中间态也不该坏
    problems.push(...checkResults(snap, `第 ${pass} 轮`, before));
    // 受保护附件的内容必须仍在库里（按内容指纹，附件被改名/移动都不算丢失）
    problems.push(...checkContentSurvival(beforeContent, contentIndex(VAULT), `第 ${pass} 轮`));
    states.push(snap);
    if (pass > 1) {
      const prev = states[pass - 2];
      const d = [
        ...snap.files.filter((f) => !prev.files.includes(f)).map((f) => `+${f}`),
        ...prev.files.filter((f) => !snap.files.includes(f)).map((f) => `-${f}`),
        // **回收站轮末新增** = "轮内发生过删除"的直接症状（轮末文件集合看不到它，见 TRASH_EXPR 注释）。
        // 只认**新增**、不认减少：清空回收站（用户行为或命令副作用）不该被判成"未收敛"。
        ...(snap.trash ?? []).filter((t) => !(prev.trash ?? []).includes(t)).map((t) => `+${t}`),
      ];
      // **具名豁免**：已登记、已定位的既有震荡不参与收敛判定——否则本变体永远红，失去守卫价值
      // （守卫的意义是"新的退化当场变红"，不是"永远重复同一条已知项"）。
      // 豁免绝不静默：命中几项、豁免了几项都要照实打印。
      const known = d.filter((x) => KNOWN_CHURN.some((re) => re.test(x.slice(1))));
      const unknown = d.filter((x) => !KNOWN_CHURN.some((re) => re.test(x.slice(1))));
      deltas.push(unknown);
      if (known.length) {
        console.log(`   · 其中 ${known.length} 项属**已登记的既有震荡**（KNOWN_CHURN，见 coverage-matrix §5），不参与收敛判定：${known.slice(0, 3).join(' | ')}${known.length > 3 ? ' …' : ''}`);
      }
      console.log(`   · 第 ${pass} 轮变化 ${unknown.length} 项（未豁免，原始 ${d.length}）${unknown.length === 0 ? '（已收敛）' : ''}`);
      // 未收敛时必须给出**具体是哪几项**：只说"N 项在变"，排查要重跑一遍才能定位（本脚本曾因此多花一轮）。
      if (unknown.length) console.log(`     ↳ ${unknown.slice(0, 6).join(' | ')}${unknown.length > 6 ? ' …' : ''}`);
      if (unknown.length === 0) {
        convergedAt = pass;
        break;
      }
    }
  }
  if (!convergedAt) {
    problems.push(`未在 ${MAX_PASSES} 轮内收敛：每轮仍在改名/移动（疑似抖动或循环），最后一轮变化 ${deltas[deltas.length - 1]?.length ?? '?'} 项`);
  } else {
    console.log(`   · 已在第 ${convergedAt} 轮收敛`);
  }

  // **非默认删除模式的强断言**（`--delete-mode`）：库内回收站必须**全程为空**。
  // 三条删除路径里只有 `.trash` 会落库内；走了系统回收站或永久删除的，库内不该留痕。这条能抓到
  // "设置没接下去"——某个命令仍硬编码 `vault.trash(f, false)`（2026-10-16 修掉的「清理空附件目录」
  // 正是这一类，而在真机上验证它需要本开关）。
  if (NON_DEFAULT_DELETE) {
    let leaked = 0;
    states.forEach((s, i) => {
      const t = s.trash ?? [];
      leaked += t.length;
      if (t.length > 0) {
        problems.push(
          `[第 ${i + 1} 轮] deleteMode=${DELETE_MODE}（非库内回收站），库内 .trash 却有 ${t.length} 项：` +
            `${t.slice(0, 3).join(' | ')}${t.length > 3 ? ' …' : ''}`,
        );
      }
    });
    console.log(`   · 非默认删除模式（${DELETE_MODE}）：${states.length} 轮内库内回收站累计 ${leaked} 项（应为 0）`);
    // **防空转**：上面那条断言只有"确实删过东西"时才有意义。夹具里的真孤儿（O01/O02）在默认模式下
    // 必被清理；若它们仍留在库里，说明清理根本没跑，则"回收站为空"是**空洞的**——这种绿比红更坏。
    const finalFiles = states[states.length - 1].files;
    for (const p of ['orphans/true-orphan.png', 'orphans/root-orphan.pdf']) {
      if (finalFiles.includes(p)) {
        problems.push(
          `deleteMode=${DELETE_MODE}，但夹具的真孤儿 ${p} 仍在库内——清理未生效，"库内回收站为空"这条断言是空洞的`,
        );
      }
    }
  }

  // **导出产物的内容断言**：原先只验"zip 文件存在"，于是**空归档**（只有 manifest、没有附件）
  // 与**漏装附件**都能通过——那两条命令的"验 zip 内容"名不副实。
  if (ABILITIES_OFF) {
    // 导出总开关关闭时，**一个 zip 都不该出现**——出现了说明门禁没接上
    if (zipSnapshots.length) {
      problems.push(`导出总开关关闭，却读到 ${zipSnapshots.length} 份 export-* 生成的 zip：门禁未生效`);
    }
    console.log('   · 导出产物内容：跳过（导出总开关关闭，断言改为"不得生成 zip"）');
  } else if (zipSnapshots.length === 0) {
    problems.push('导出产物的内容断言无法进行：全程一次都没能读到 `export-*` 生成的 zip（防空转）');
  } else {
    const richest = zipSnapshots.reduce((a, b) => (b.names.length > a.names.length ? b : a));
    const missingManifest = zipSnapshots.filter((z) => !z.names.includes('manifest.json'));
    if (missingManifest.length) {
      problems.push(
        `导出产物缺 manifest.json：${missingManifest.map((z) => `${z.file}(第 ${z.pass} 轮)`).join('、')}`,
      );
    }
    if (richest.names.length < 2) {
      problems.push(
        `导出产物在任何一轮都只有 ${richest.names.length} 个条目（除 manifest 外没有任何附件）` +
          `——空归档：${richest.file}（第 ${richest.pass} 轮）`,
      );
    }
    console.log(
      `   · 导出产物内容：读到 ${zipSnapshots.length} 份快照；条目最多的是 ${richest.file}` +
        `（第 ${richest.pass} 轮，${richest.names.length} 个条目：` +
        `${richest.names.slice(0, 3).join(' | ')}${richest.names.length > 3 ? ' …' : ''}）`,
    );
  }

  if (PLUGIN_LOG) {
    const collected = (await cdp.eval('window.__iapPluginLog ?? []')) ?? [];
    pluginLogs.push(...collected.map(String));
    // 只挑"计划类"日志（命名/收集/清理的计划与执行），否则整份控制台太吵、淹掉要找的东西。
    const interesting = pluginLogs.filter((l) => /命名|收集|清理|计划|跳过|改名/.test(l));
    console.log(`\n[obsidian-acceptance] 插件日志：共采集 ${pluginLogs.length} 行，其中计划类 ${interesting.length} 行`);
    for (const l of interesting.slice(0, 60)) {
      console.log(`   · ${l.replace(/长{5,}/g, '长…').slice(0, 220)}`);
    }
  }

  // 自动化阶段（可选）：必须在命令链收敛之后跑，否则"是命令改的"还是"自动处理改的"分不清
  let automation = null;
  if (RUN_AUTOMATION) {
    console.log('   · 自动化阶段：新建探针笔记，等待后台自动处理…');
    automation = await runAutomationPhase(cdp, problems);
  }

  // **界面与提示**：设置页是否真的渲染、通知级别三档是否各按其语义。
  // 放在最后做——两者都会临时改设置/开面板，若发生在收敛判定之前会干扰被判定的行为。
  await runSettingsPageCheck(cdp, problems);
  await runNotifyLevelCheck(cdp, problems, realId);
  // 能力门禁（仅 abilities-off）：11 条受门禁的命令必须逐条早退并明说「已关闭」
  if (ABILITIES_OFF) await runAbilitiesOffGateCheck(cdp, problems, realId);
  // 一致性报告内容 + 报告内"定位"跳转（同一个报告窗口，合并做）
  await runConsistencyReportCheck(cdp, problems, realId);
  // 网络策略收紧（仅 net-strict）：白名单覆盖内网拦截 + 默认拒绝
  if (NET_STRICT) await runNetStrictCheck(cdp, problems, realId);
  // 笔记移动跟随：会新增探针笔记与目录（不动既有夹具）
  await runFollowNoteMoveCheck(cdp, problems);
  // ⚠️ 必须是最后一个：它会重载插件、重建全部内存状态
  await runMigrationCheck(cdp, problems);

  const after = states[0];
  const last = states[states.length - 1];

  // 候选修复阶段（可选）：断言"选中并修复"真的把引用写回去了
  const candidateFix = { enabled: FIX_CANDIDATES, used: false, picked: null, unresolvedBefore, unresolvedAfter: null };
  if (FIX_CANDIDATES) {
    candidateFix.used = (await cdp.eval('window.__iapFixCandidatesUsed === true')) === true;
    candidateFix.picked = await cdp.eval('window.__iapFixPicked ?? null');
    candidateFix.unresolvedAfter = countUnresolved(last.files, last.notes);
    if (!candidateFix.used) {
      problems.push('[候选修复] 已开启 --fix-candidates，但整轮都没有出现可选择的候选弹窗（前提不成立，或候选窗根本没弹出）');
    } else if (candidateFix.unresolvedAfter >= candidateFix.unresolvedBefore) {
      problems.push(
        `[候选修复] 选中候选并点「以此修复」后，悬空引用数没有减少（${candidateFix.unresolvedBefore} → ${candidateFix.unresolvedAfter}）：修复没有真正写回`,
      );
    } else {
      console.log(
        `   · 候选修复已生效：悬空引用 ${candidateFix.unresolvedBefore} → ${candidateFix.unresolvedAfter}（选中 ${candidateFix.picked}）`,
      );
    }
  }
  // `(1)` 兜底名：只算"本轮新出现的"，夹具里本来就有合法含 (1) 的文件名
  // ⚠️ `abilities-off` 下这条不适用：命名的门禁关着，不可能**造**出兜底名；而「收集」（无开关）
  // 会把夹具里**本来就叫** `normal name (1)-ok.png` 的文件搬到笔记归属目录 → 新路径里带 `(1)`，
  // 那是"搬家"而不是"冲突避让"。按路径判会把搬家误判成冲突。
  if (!ABILITIES_OFF) {
    const newOnes = last.files.filter((f) => !before.files.includes(f));
    const bogus = newOnes.filter((f) => /\(\d+\)/.test(f));
    if (bogus.length) problems.push(`幂等：本轮新出现 (N) 兜底名：${bogus.slice(0, 5).join(', ')}`);
  }

  // 输出报告
  const report = {
    vault: VAULT,
    variant: VARIANT,
    startupCheck,
    automation,
    candidateFix,
    passes: states.length,
    convergedAt: convergedAt || null,
    filesBefore: before.files.length,
    trashMode: before.trashMode,
    deleteMode: DELETE_MODE || '.trash（库基线）',
    filesPerPass: states.map((s) => s.files.length),
    trashPerPass: states.map((s) => (s.trash ?? []).length),
    filesBeforeList: before.files,
    filesAfterPass1List: states[0].files,
    filesFinalList: last.files,
    notices: after.notices, // ⚠️ 只含脚本自弹的通知，**采不到插件弹的**（见 collect() 的注释）
    problems,
  };
  const outDir = path.join(VAULT, '..', 'acceptance-reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `obsidian-acceptance-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(outDir, 'obsidian-acceptance-latest.md'),
    [
      '# 真实 Obsidian 验收报告',
      '',
      `- 验收库：${VAULT}`,
      `- 候选修复：${FIX_CANDIDATES ? (candidateFix.used ? `已选中并修复（悬空引用 ${candidateFix.unresolvedBefore} → ${candidateFix.unresolvedAfter}）` : '未出现候选弹窗') : '未运行（加 --fix-candidates 启用）'}`,
      `- 启动哨兵：${
        STARTUP_CHECK
          ? `已运行（笔记改写 ${startupCheck?.noteChanges ?? '?'} 篇，哨兵附件${startupCheck?.canaryIntact ? '完好' : '异常'}，` +
            `启动期被就绪门挡下 ${startupCheck?.suppressedAtStartup ?? '?'} 个 changed，就绪信号 ${startupCheck?.settleSource ?? '（无）'}）`
          : '未运行（加 --startup-check 启用）'
      }`,
      `- 自动化阶段：${RUN_AUTOMATION ? (automation?.ran ? `已生效（${automation.renamedTo}，${automation.elapsedMs}ms）` : '未生效') : '未运行（加 --automation 启用）'}`,
      `- 配置变体：${VARIANT}${
        ROOT_LAYOUT
          ? '（跟随 Obsidian + 库根，即插件的默认模式）'
          : NAMING_RICH
            ? '（验收库基线 + 命名富化：按类别子目录 + 时间/哈希/子类型）'
            : ABILITIES_OFF
              ? '（五个能力总开关 + 自动化全关：验「关闭即不动」与 11 条门禁）'
              : FOLLOW_OFF
                ? '（仅 consistency.followNoteMove=false：验「关闭后附件原地不动」）'
                : NET_STRICT
                  ? '（网络策略收紧：仅白名单 + 拦截内网 + 白名单列 127.0.0.1）'
                  : '（验收库自带：自定义 ./assets）'
      }`,
      `- 文件数：初始 ${before.files.length} → ${states.map((s) => s.files.length).join(' → ')}（共 ${states.length} 轮）`,
      `- 收敛：${convergedAt ? `第 ${convergedAt} 轮收敛` : '未在限定轮数内收敛'}`,
      `- 回收站：${before.trashMode}；逐轮条数 ${before.trash.length} → ${states.map((s) => (s.trash ?? []).length).join(' → ')}` +
        (String(before.trashMode).startsWith('.trash')
          ? '（收敛判定已含"回收站轮末新增"：轮内创建 → 销毁不再隐形）'
          : '（⚠️ 删除模式非 `.trash`，无库内目录可查：轮内创建 → 销毁仍不可见）'),
      `- 删除方式：${DELETE_MODE || '.trash（验收库基线）'}` +
        (NON_DEFAULT_DELETE ? '（`--delete-mode` 指定：断言库内回收站**全程为空**，且真孤儿确已被清）' : ''),
      `- 问题数：${problems.length}`,
      '',
      '## 问题清单',
      ...(problems.length ? problems.map((p) => `- ${p}`) : ['- （无）']),
      '',
      '## 第一轮新增的文件',
      ...states[0].files.filter((f) => !before.files.includes(f)).map((f) => `- +${f}`),
      '',
      '## 第一轮消失的文件',
      ...before.files.filter((f) => !states[0].files.includes(f)).map((f) => `- -${f}`),
      '',
      '## 逐轮变化（收敛过程；命令顺序固有交互，非缺陷）',
      ...deltas.flatMap((d, i) => [`### 第 ${i + 2} 轮（${d.length} 项）`, ...d.map((f) => `- ${f}`)]),
      '',
      '## 通知摘录',
      // 说明必须**跟着数据走**：这一整段采不到插件弹的通知（见 collect()），否则读者会误以为"没弹过提示"
      '> ⚠️ 本段只含**脚本自己**弹出的通知；**插件弹的通知采集不到**（插件绑定的是加载时的 `Notice` 引用）。',
      ...after.notices.slice(-40).map((n) => `- ${n.replace(/\n/g, ' ')}`),
    ].join('\n'),
  );

  console.log(`\n[obsidian-acceptance] 变体：${VARIANT}`);
  console.log(`[obsidian-acceptance] 完成：文件 ${before.files.length} → ${states.map((s) => s.files.length).join(' → ')}（${convergedAt ? `第 ${convergedAt} 轮收敛` : '未收敛'}），问题 ${problems.length}`);
  for (const p of problems) console.log(` ✗ ${p}`);
  if (problems.length) {
    console.log('\n--- 最终文件树 ---');
    for (const f of after.files) console.log(`  ${f}`);
    console.log('\n--- 通知摘录（⚠️ 只含脚本自弹的；插件弹的采不到，别据此判断"没提示"） ---');
    for (const n of after.notices.slice(-40)) console.log(`  ${String(n).replace(/\n/g, ' ')}`);
  }
  console.log(`[obsidian-acceptance] 报告：${outFile}`);
  // ⚠️ **本次产物就是这个库**：脚本开头的 `mv` 只把**上一轮**的库挪去了备份目录，当次结果永远
  // 在这里。排查时若去看备份目录（它的时间戳反而**更新**），读到的会是上一轮的状态。
  console.log(`[obsidian-acceptance] 本次产物（当次 seed 出的库）：${VAULT}`);
  console.log('   · 提示：开头的 mv 备份目录是**上一轮**的库，排查请认上面这个路径');
  server.close();
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => {
  console.error(`[obsidian-acceptance] 失败：${e.message}`);
  process.exit(3);
});
