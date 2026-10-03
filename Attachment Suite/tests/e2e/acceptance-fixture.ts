/**
 * 验收用例库定义（三阶段）。
 *
 * 一份定义、两种消费：
 *   1. `seed-acceptance.test.ts` → 落成真实文件到 `for-test/acceptance/`（人工 / 真实 Obsidian 验收现场）；
 *   2. `acceptance.test.ts`      → 复制到临时库跑 harness 全量（可进 CI）。
 *
 * 结构：`ACCEPTANCE_CASES` 是**可核对的用例清单**（id / 类别 / 载体 / 预期），
 * `seedAcceptanceVault()` 负责把清单落成真实笔记与附件。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** 最小合法文件头（不依赖 obsidian stub，便于被普通 node 脚本复用）。 */
const HEAD: Record<string, Buffer> = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]),
  jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
  gif: Buffer.from('GIF89a\0\0\0\0', 'binary'),
  webp: Buffer.from('RIFF\0\0\0\0WEBP', 'binary'),
  bmp: Buffer.from('BM\0\0\0\0', 'binary'),
  svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8'),
  mp4: Buffer.from('\0\0\0\x18ftypmp42\0\0\0\0', 'binary'),
  webm: Buffer.from('\x1a\x45\xdf\xa3\0\0\0\0', 'binary'),
  mp3: Buffer.from('ID3\x03\x00\x00\x00\0\0\0\0', 'binary'),
  wav: Buffer.from('RIFF\0\0\0\0WAVE', 'binary'),
  flac: Buffer.from('fLaC\0\0\0\0', 'binary'),
  pdf: Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'binary'),
  docx: Buffer.from('PK\x03\x04\0\0\0\0', 'binary'),
  xlsx: Buffer.from('PK\x03\x04\0\0\0\0', 'binary'),
  pptx: Buffer.from('PK\x03\x04\0\0\0\0', 'binary'),
  zip: Buffer.from('PK\x03\x04\0\0\0\0', 'binary'),
  txt: Buffer.from('plain text payload', 'utf8'),
  csv: Buffer.from('a,b,c\n1,2,3\n', 'utf8'),
};

/**
 * N16 用的「超长名」：**80 个汉字**（3×80 + `.md` = **243 字节**）。
 *
 * ⚠️ **不要再调大**：多数 POSIX 文件系统的单个文件名上限是 **255 字节**（UTF-8 编码后）。
 * 原先写的是 90 个汉字 = 270 字节 + `.md` = 273 字节 → Linux 上 `fs.writeFileSync` 直接
 * `ENAMETOOLONG`；而 NTFS 按 UTF-16 单元计数只算 93，**所以只有 ubuntu 会红**
 * （2026-10-02 校验工作流首次真跑时正是这么暴露的——跨平台矩阵的价值就在这类"只在某个
 * 平台成立"的假设上）。80 个汉字已远超常见文件名，作"超长名"用例足够，且三个平台都能落盘。
 */
export const LONG_NOTE_NAME = '长'.repeat(80);

export function writeFile(rootAbs: string, rel: string, data: string | Buffer): void {
  const abs = path.join(rootAbs, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
}

export function writeBin(rootAbs: string, rel: string, ext: string, times = 1): void {
  const head = HEAD[ext] ?? HEAD.png;
  writeFile(rootAbs, rel, Buffer.concat(Array.from({ length: times }, () => head)));
}

/** 用例条目：用于生成可核对的预期清单。 */
export interface AcceptanceCase {
  id: string;
  /** 类别 */
  kind: string;
  /** 载体（相对路径） */
  at: string;
  /** 预期结果（人工阅读用；机器校验见 `ACCEPTANCE_ASSERTS`） */
  expect: string;
}

/* ===================== 机器校验（验收用例的"预期"必须被执行，而不是只被计数） ===================== */

/**
 * 校验上下文：由 harness 在跑完整轮命令后构造，暴露"库的现状"。
 *
 * 设计要点：上下文**不提供** `beforeFiles` 之外的历史，故断言只能表达"最终状态该怎样"；
 * 需要"与执行前对比"的用例（如断链无候选应零改动）通过 `beforeText` 取原文自行比较。
 */
export interface AcceptanceContext {
  /** 执行前的文件树。 */
  before: string[];
  /** 执行前某个文件的文本（不存在则空串）。 */
  beforeText: (rel: string) => string;
  /** 执行后的文件树。 */
  files: string[];
  read: (rel: string) => string;
  exists: (rel: string) => boolean;
  /** 该文件的字节指纹（base64）；不存在返回 null。 */
  fingerprint: (rel: string) => string | null;
  /**
   * 该文件在**执行前**的字节指纹；运行前就不存在则返回 null。
   *
   * 需要它是因为附件会被改名/移动：想校验"某某附件没被删"，必须拿执行前的指纹去库里找
   * 同内容的文件，而不能假设它还在原路径。
   */
  fingerprintBefore: (rel: string) => string | null;
  /**
   * 库里是否还存在"某个文件的字节"。
   * 附件会被命名功能改名（还会被收集功能移动），因此"没被删"只能按**内容**判断，不能按路径。
   */
  hasContent: (fp: string) => boolean;
  /** 提取某文件里的本地引用（含 canvas 的 file 字段）。 */
  refs: (rel: string) => Array<{ target: string; kind: string }>;
  /** 某条引用当前能否解析。 */
  canResolve: (target: string, kind: string) => boolean;
  /** 某文件里当前**解析不到**的引用。 */
  unresolved: (rel: string) => Array<{ target: string; kind: string }>;
}

/**
 * 用例 id → 机器校验（返回 null 表示通过，返回字符串表示失败原因）。
 *
 * 为什么要单独一张表、而不是把 `assert` 塞进用例对象：
 * ① 一眼能看出"哪些用例还没有机器校验"（`Object.keys().length` 就是已校验条数）；
 * ② 可以加"表里的 id 必须都真实存在"的守卫，避免拼错 id 后**静默永不执行**——
 *    那正是本次复查反复遇到的失效模式（断言看起来在跑，其实什么都没校验）。
 *
 * 未列入的用例只受 harness 的全局不变式保护（无数据损失 / 无新断链 / 有限轮收敛）。
 * 新增用例时请尽量一并补上这里的一条。
 */
export const ACCEPTANCE_ASSERTS: Record<string, (ctx: AcceptanceContext) => string | null> = {
  // ⚠️ 三条用例**故意不设机器校验**，理由逐条写在这里，避免下次有人"顺手补一个"却写成同义反复：
  // - `X01`（粘贴外链即自动处理）：本表只拿得到"最终状态"，既改不了设置也发不出事件，
  //   故表达不出来。其覆盖在别处：harness 的 `real-suite` 第 19 组（`emitPaste` → 自动本地化），
  //   真实宿主则是 `--automation` 阶段（新建笔记 → 断言被自动规范命名）。
  // - `X02`（打开库时不批量处理）：语义是"启动抑制窗口生效"，属于**时序**性质；
  //   在"跑完整轮看最终状态"的上下文里表达不出来（真实宿主上同样由 `--automation` 阶段间接覆盖）。
  // - `P02`：用例自己写明"由单测覆盖"（Windows 无法落地保留名/非法字符文件），
  //   在验收库里**没有可断言的载体**——写一条恒真断言只会虚增覆盖数。
  // —— 笔记形态 ——
  N05: (c) => (c.exists('notes/05-代码块假引用.md') ? null : '笔记消失'),
  N06: (c) => (c.exists('notes/06-行内代码.md') ? null : '笔记消失'),
  N13: (c) =>
    c.read('notes/13-断链-无候选.md') === c.beforeText('notes/13-断链-无候选.md')
      ? null
      : '无候选断链本应零改动，但文件被改写了',
  N14: (c) => {
    // 两类失败都要抓：① 引用没被改写（`![[song]]` 原地不动）；② 内容被删。
    // 2026-09-28 在真实 Obsidian 上抓到的正是这一条：`![[song]]` 未随改名改写 →
    // 文件失去引用者 → 被「清理未用附件」移入回收站（映射里缺"无扩展名主名"这一键）。
    const bad = c.unresolved('notes/14-短名无扩展名.md');
    if (bad.length) return `短名无扩展名引用变成断链：${bad.map((r) => r.target).join(', ')}`;
    const fp = c.fingerprintBefore('assets/mp3/song.mp3');
    return fp && !c.hasContent(fp) ? '短名引用所指向的附件内容在库中消失（被当孤儿清理）' : null;
  },
  N17: (c) => (c.unresolved('canvas/画布用例.canvas').filter((r) => !r.target.includes('canvas-missing')).length === 0
    ? null
    : 'canvas 里除"故意缺失"之外的引用出现断链'),

  // —— 附件形态 ——
  // A09 验证的是「svg 这类受管附件不得被清理」。前提是它**真的被引用**——
  // 未被引用的 svg 是孤儿，被清理才是正确行为（早期夹具里它没被任何笔记引用，
  // 于是"应受管"这个前提根本不成立）。至于"SVG 永不被本地化落存"属本地化侧行为，
  // 由外链用例与单测覆盖。
  A09: (c) => {
    const fp = c.fingerprintBefore('assets/svg/vec.svg');
    if (!fp) return 'svg 夹具附件在运行前就不存在（夹具问题）';
    return c.hasContent(fp) ? null : 'svg 受管附件被删除';
  },
  A10: (c) => (c.exists('assets/noext') ? null : '无扩展名文件被删除'),
  A14: (c) => (c.exists('assets/other/note.txt') ? null : '非受管 txt 被删除'),
  A12: (c) => {
    // 被两篇笔记共享：内容必须还在，且两篇笔记的引用都必须仍能解析
    const fp = c.fingerprintBefore('assets/shared/shared.png');
    if (!fp) return '共享附件在运行前就不存在（夹具问题）';
    if (!c.hasContent(fp)) return '共享附件的内容被删除';
    for (const n of ['notes/21-共享引用A.md', 'notes/22-共享引用B.md']) {
      if (!c.exists(n)) return `引用共享附件的笔记消失：${n}`;
      const bad = c.unresolved(n);
      if (bad.length) return `${n} 出现断链：${bad.map((r) => r.target).join(', ')}`;
    }
    return null;
  },

  // —— 外链 ——
  E05: (c) => (c.read('externals/网页.md').includes('127.0.0.1') ? null : '网页引用被改写（HTML 文档本应跳过、原文保留）'),
  E09: (c) => (c.unresolved('externals/404.md').length === 0 ? null : '404 用例产生了坏引用'),
  E11: (c) => {
    const t = c.read('externals/普通链接.md');
    if (/!\[[^\]]*\]\([^)]*\.pdf/.test(t)) return '普通链接被改写成图片嵌入';
    const bad = c.unresolved('externals/普通链接.md');
    return bad.length ? `普通链接出现断链：${bad.map((r) => r.target).join(', ')}` : null;
  },
  E12: (c) => {
    const t = c.read('externals/html标签.md');
    if (!/<(img|audio|video)\b/i.test(t)) return 'HTML 媒体标签被改写掉了';
    const bad = c.unresolved('externals/html标签.md');
    return bad.length ? `HTML 标签引用出现断链：${bad.map((r) => r.target).join(', ')}` : null;
  },
  E14: (c) => {
    // 旧实现按空白截断目标 → `![x](url "标题")` 整条匹配失败 → 外链永远不本地化
    const t = c.read('externals/带标题.md');
    if (t.includes('127.0.0.1')) return '带标题的外链未被本地化（"目标后接不到 )"的旧缺陷回归）';
    if (!t.includes('图注')) return 'alt / 标题在改写中丢失';
    const bad = c.unresolved('externals/带标题.md');
    return bad.length ? `引用断链：${bad.map((r) => r.target).join(', ')}` : null;
  },
  E15: (c) => {
    const t = c.read('externals/尖括号目标.md');
    if (t.includes('127.0.0.1')) return '<…> 包裹的目标未被本地化';
    const bad = c.unresolved('externals/尖括号目标.md');
    return bad.length ? `<…> 目标改写后断链：${bad.map((r) => r.target).join(', ')}` : null;
  },
  E16: (c) =>
    c.read('externals/含括号目标.md') === c.beforeText('externals/含括号目标.md')
      ? null
      : '含未转义括号的目标本应整条跳过，但文件被改写了（有产出半截链接的风险）',
  E17: (c) => {
    const t = c.read('externals/svg外链.md');
    if (!t.includes('127.0.0.1')) return 'SVG 外链被改写了（本应拒绝落存并保留原文）';
    // 用**数量**而不是"有没有新路径的 svg"：库里本就有 assets/svg/vec.svg，而「统一命名」
    // 会把它改名成 notes/assets/*.svg —— 那会产生"新路径的 svg"却是合法改名，不是落盘。
    const before = c.before.filter((f) => f.endsWith('.svg')).length;
    const now = c.files.filter((f) => f.endsWith('.svg')).length;
    return now > before ? `SVG 被本地化落盘（svg 文件数 ${before} → ${now}）` : null;
  },
  E18: (c) => {
    const t = c.read('externals/非受管外链.md');
    if (!t.includes('127.0.0.1')) return '非受管外链被改写了（本应跳过并保留原文）';
    const before = c.before.filter((f) => f.endsWith('.txt')).length;
    const now = c.files.filter((f) => f.endsWith('.txt')).length;
    return now > before ? `非受管类型被落盘（txt 文件数 ${before} → ${now}）` : null;
  },

  // —— 孤儿 / 保护面 ——
  O01: (c) => (c.exists('orphans/true-orphan.png') ? '真孤儿未被清理' : null),
  O02: (c) => (c.exists('orphans/root-orphan.pdf') ? '库根孤儿未被清理' : null),
  O03: (c) => (c.exists('excluded/orphan-in-excluded.png') ? null : '排除目录内的孤儿被动了'),
  O04: (c) => (c.exists('orphans/zip-orphan.zip') ? null : '非受管 zip 被删除'),
  O05: (c) => (c.exists('orphans/csv-orphan.csv') ? null : '非受管 csv 被删除'),
  O06: (c) => (c.hasContent(c.fingerprintBefore('orphans/only-canvas.png') ?? '') ? null : '仅被 canvas 引用的附件被删除'),
  O07: (c) => (c.hasContent(c.fingerprintBefore('orphans/only-frontmatter.png') ?? '') ? null : '仅被 frontmatter 引用的附件被删除'),

  // —— 空目录 ——
  D01: (c) => (c.exists('empty/leaf/') ? '叶子空目录未被清理' : null),
  D02: (c) => (c.exists('empty/parent/child/') ? '父子空目录未被清理' : null),
  D03: (c) => (c.exists('empty/deep/a/b/c/') ? '深层空目录未被清理' : null),
  D04: (c) => (c.exists('excluded/empty-in-excluded/') ? null : '排除目录内的空目录被清理'),
  D05: (c) => (c.exists('empty/hidden-file/') ? null : '含隐藏文件的目录被误清理'),

  // —— 路径 ——
  // P01 的预期是"**修复不兼容路径**不得改它"，这需要"逐命令观察"才能表达；
  // 而本上下文的语义是"跑完整轮后看最终状态"——此时该附件被「统一命名」合法改名是预期行为，
  // 拿"原路径还在"当断言只会假红。故这里断言**内容仍在库中**（过度修复不得把文件弄丢），
  // 名称层面的保护由 L06 的"引用不得变成断链"承担。
  P01: (c) => {
    const fp = c.fingerprintBefore('path-cases/normal name (1)-ok.png');
    if (!fp) return '前提不成立：夹具里没有 path-cases/normal name (1)-ok.png';
    return c.hasContent(fp) ? null : '含空格/括号的合法文件名所在附件的内容在库中消失（疑似被过度修复弄丢）';
  },

  // —— 目录布局 ——
  // 这一类此前**整类零机器校验**：`expect` 写了"落盘正确"，但没有任何断言执行它。
  L01: (c) =>
    c.files.some((f) => /^notes\/assets\/01-正文图片_image_\d{3}\.png$/.test(f))
      ? null
      : '笔记相对目录 ./assets 未按预期落盘（应在 notes/assets/ 下出现 <笔记名>_image_NNN）',
  L02: (c) =>
    c.files.some((f) => f.startsWith('deep/多级/assets/'))
      ? null
      : '深层目录笔记的归属目录 deep/多级/assets 未生效',
  L03: (c) => {
    if (!c.exists('中文目录/中文笔记.md')) return '中文目录下的笔记消失';
    const bad = c.unresolved('中文目录/中文笔记.md');
    if (bad.length) return `中文目录下笔记出现断链：${bad.map((r) => r.target).join(', ')}`;
    // 注意：它引用的 `assets/png/pic.png` **被多篇笔记共享**（notes/01 与 excluded/排除笔记 也引用），
    // 而「收集」对共享附件是**跳过**的（这是设计语义，不是缺陷）。
    // 故这里断言的是"共享附件没被搬走、其引用仍可解析"，而不是"被收集到 中文目录/assets/"。
    return c.exists('assets/png/pic.png') || c.canResolve('assets/png/pic.png', 'md')
      ? null
      : '中文目录下笔记引用的共享附件被搬走了（共享附件不应被收集）';
  },
  L04: (c) =>
    c.files.some((f) => /^assets\/.+_image_\d{3}\./.test(f))
      ? null
      : '库根 assets 作为归属目录未生效（没有按方案命名的附件落在 assets/）',
  L05: (c) => {
    const before = [...c.before.filter((f) => f.startsWith('excluded/'))].sort();
    const now = [...c.files.filter((f) => f.startsWith('excluded/'))].sort();
    return JSON.stringify(before) === JSON.stringify(now)
      ? null
      : `全局排除目录被改动：${before.length} → ${now.length}`;
  },
  L06: (c) => {
    const bad = c.unresolved('path-cases/合法名字保持.md');
    return bad.length
      ? `合法文件名所在笔记出现断链（疑似被"路径修复"过度改写）：${bad.map((r) => r.target).join(', ')}`
      : null;
  },

  // —— 幂等 ——
  // 这一类此前**整类零机器校验**。"跑两遍"的语义在"最终状态"上下文里等价于：
  // 不得留下兜底名、该清的已清、导出产物形态正确。
  I01: (c) => {
    // `(N)` 兜底名：夹具里本来就合法存在一个（normal name (1)-ok.png），
    // 故只检查**运行后新出现的**，与真实宿主脚本同一口径。
    const bogus = c.files.filter((f) => /\(\d+\)\./.test(f) && !c.before.includes(f));
    return bogus.length ? `全库命名/收集产生兜底名（幂等被破坏）：${bogus.slice(0, 3).join(', ')}` : null;
  },
  I02: (c) => {
    // "清理未用跑两遍"在最终态下等价于：非排除目录内的真孤儿已被清干净
    const left = ['orphans/true-orphan.png', 'orphans/root-orphan.pdf'].filter((p) => c.exists(p));
    return left.length ? `真孤儿未被清理（清理未执行或非幂等）：${left.join(', ')}` : null;
  },
  I03: (c) => {
    // "断链修复跑两遍"：多候选场景**必须保持原样**（不得自动挑一个改写）。
    // 夹具里 12 号笔记指向 gone/pic.png，而库中存在两个 pic.png 同名候选。
    const t = c.read('notes/12-断链-多候选.md');
    if (!t.includes('gone/pic.png')) return `多候选断链被自动改写了（应保持原样）：${t.slice(0, 120)}`;
    return c.unresolved('notes/12-断链-多候选.md').length >= 1 ? null : '多候选断链被"修复"到了某个目标（多候选不得自动改写）';
  },
  I04: (c) =>
    c.files.some((f) => f.startsWith('notes/assets/'))
      ? null
      : '收集未生效：notes/01 引用的独占附件不在其归属目录 notes/assets/（第二遍应无可收集项）',
  I05: (c) => {
    const fp = c.fingerprint('Unused_Attachments.zip');
    if (!fp) return '导出未用附件未生成 Unused_Attachments.zip';
    return fp.length > 100 ? null : 'Unused_Attachments.zip 内容异常（疑似空包）';
  },
  I06: (c) => {
    const fp = c.fingerprint('notes/01-正文图片_Attachments.zip');
    if (!fp) return '导出当前笔记未生成 <笔记名>_Attachments.zip';
    // zip 的本地文件头里文件名是明文（即使条目被压缩），直接按字节找即可
    const raw = Buffer.from(fp, 'base64').toString('latin1');
    return raw.includes('manifest.json') ? null : '导出 zip 内缺少 manifest.json';
  },
};

/** 校验表里的 id 必须都真实存在——拼错的键会静默永不执行，必须挡住。 */
export function assertKeysAreValid(): string[] {
  const known = new Set(ACCEPTANCE_CASES.map((c) => c.id));
  return Object.keys(ACCEPTANCE_ASSERTS).filter((id) => !known.has(id));
}

/**
 * 验收用例清单（82 条）。
 * 说明：Windows 保留名（CON/PRN/NUL/COM1）与非法字符（: * ? " < > |）在 Windows 上**无法落地**，
 * 故本地验收只覆盖"合法的名字不得被改名"这一侧；非法侧的规划逻辑由单测
 * `consistency-core.test.ts` 覆盖。
 */
export const ACCEPTANCE_CASES: AcceptanceCase[] = [
  // —— 笔记形态（12）——
  { id: 'N01', kind: '笔记形态', at: 'notes/01-正文图片.md', expect: '正文 markdown 图片引用被识别并保护，本地化后改写为本地路径' },
  { id: 'N02', kind: '笔记形态', at: 'notes/02-wiki嵌入.md', expect: 'wiki 嵌入引用被识别并保护' },
  { id: 'N03', kind: '笔记形态', at: 'notes/03-HTML标签.md', expect: 'HTML 媒体标签引用被识别并保护（扩展扫描开启后改写只换 src）' },
  { id: 'N04', kind: '笔记形态', at: 'notes/04-frontmatter.md', expect: 'frontmatter cover 的本地引用被保护；外链 frontmatter 参与本地化' },
  { id: 'N05', kind: '笔记形态', at: 'notes/05-代码块假引用.md', expect: '代码块内的假引用不报断链、不参与收集' },
  { id: 'N06', kind: '笔记形态', at: 'notes/06-行内代码.md', expect: '行内代码内的假引用不报断链' },
  { id: 'N07', kind: '笔记形态', at: 'notes/07-外链本地化.md', expect: 'http 外链被下载到归属附件目录并改写（含 data: URI）' },
  { id: 'N08', kind: '笔记形态', at: 'notes/08-data-uri.md', expect: 'data: 图片本地化落盘、引用改写' },
  { id: 'N09', kind: '笔记形态', at: 'notes/09-断链-精确可修.md', expect: '同名唯一候选的断链被修复（或由用户确认），改写目标必须真实存在' },
  { id: 'N10', kind: '笔记形态', at: 'notes/10-断链-编码.md', expect: '%20 编码引用的断链按解码解释修复' },
  { id: 'N11', kind: '笔记形态', at: 'notes/11-断链-大小写.md', expect: '大小写差异引用进入候选交互，不自动改写' },
  { id: 'N12', kind: '笔记形态', at: 'notes/12-断链-多候选.md', expect: '多候选断链不自动改写' },
  { id: 'N13', kind: '笔记形态', at: 'notes/13-断链-无候选.md', expect: '无候选断链零改动、保持报告' },
  { id: 'N14', kind: '笔记形态', at: 'notes/14-短名无扩展名.md', expect: '![[noextname]] 引用的附件不得被判为孤儿（保护层按 stem 反查）' },
  { id: 'N15', kind: '笔记形态', at: 'notes/15-中文 空格 emoji 😀.md', expect: '中文/空格/emoji 文件名笔记处理正常，落盘与改写不失真' },
  { id: 'N16', kind: '笔记形态', at: `notes/${LONG_NOTE_NAME}.md`, expect: '超长名（80 汉字 / 243 字节，贴近各平台文件名上限）笔记正常处理' },
  { id: 'N17', kind: '笔记形态', at: 'canvas/画布用例.canvas', expect: 'canvas 的 file 节点：引用的附件被保护；缺失目标报断链' },

  // —— 附件形态（14）——
  { id: 'A01', kind: '附件形态', at: 'assets/png/pic.png', expect: 'png 受管、可被命名/清理/导出' },
  { id: 'A02', kind: '附件形态', at: 'assets/jpg/pic.jpg', expect: 'jpg 受管' },
  { id: 'A03', kind: '附件形态', at: 'assets/gif/pic.gif', expect: 'gif 受管' },
  { id: 'A04', kind: '附件形态', at: 'assets/webp/pic.webp', expect: 'webp 受管' },
  { id: 'A05', kind: '附件形态', at: 'assets/mp4/clip.mp4', expect: 'mp4 受管' },
  { id: 'A06', kind: '附件形态', at: 'assets/mp3/song.mp3', expect: 'mp3 受管' },
  { id: 'A07', kind: '附件形态', at: 'assets/pdf/doc.pdf', expect: 'pdf 受管' },
  { id: 'A08', kind: '附件形态', at: 'assets/docx/doc.docx', expect: 'docx 受管' },
  { id: 'A09', kind: '附件形态', at: 'assets/svg/vec.svg', expect: 'svg 受管但永不被本地化落存' },
  { id: 'A10', kind: '附件形态', at: 'assets/noext', expect: '无扩展名文件不被判为受管附件（也不会被删除）' },
  { id: 'A11', kind: '附件形态', at: 'assets/dup/pic.png', expect: '跨目录同名（与 A01）不串味：各自被正确引用/保护' },
  { id: 'A12', kind: '附件形态', at: 'assets/shared/shared.png', expect: '被两篇笔记共享的附件不移动、不误删' },
  { id: 'A13', kind: '附件形态', at: 'assets/zero/empty.png', expect: '0 字节附件不被误删（受管类型）' },
  { id: 'A14', kind: '附件形态', at: 'assets/other/note.txt', expect: '非受管类型（txt）不进入索引、不参与清理/导出' },

  // —— 外链（12）——
  { id: 'E01', kind: '外链', at: 'externals/图片.md', expect: 'http 图片外链被下载落盘' },
  { id: 'E02', kind: '外链', at: 'externals/音频.md', expect: 'http 音频外链被下载' },
  { id: 'E03', kind: '外链', at: 'externals/视频.md', expect: 'http 视频外链被下载' },
  { id: 'E04', kind: '外链', at: 'externals/pdf.md', expect: 'http pdf 外链被下载' },
  { id: 'E05', kind: '外链', at: 'externals/网页.md', expect: 'HTML 文档引用被跳过、不落存' },
  { id: 'E06', kind: '外链', at: 'externals/内网.md', expect: '内网地址：开启「拦截内网与本机地址」时被拦截；验收库为使用本机测试服务而关闭该开关，故此例按"不可达 → 跳过并计数"处理（拦截能力由 E2E 专项覆盖）' },
  { id: 'E07', kind: '外链', at: 'externals/黑名单.md', expect: '域名黑名单命中被拦截（不发起请求）' },
  { id: 'E08', kind: '外链', at: 'externals/仅白名单.md', expect: '仅白名单模式下非白名单域被拦截' },
  { id: 'E09', kind: '外链', at: 'externals/404.md', expect: '404 链接跳过并计数，不产生坏引用' },
  { id: 'E10', kind: '外链', at: 'externals/data图片.md', expect: 'data: 图片落盘并改写' },
  { id: 'E11', kind: '外链', at: 'externals/普通链接.md', expect: '普通 markdown 链接改写后仍是链接（不变成图片嵌入）' },
  { id: 'E12', kind: '外链', at: 'externals/html标签.md', expect: 'HTML 标签改写只替换 src，标签与其它属性保留' },

  // —— 孤儿（7）——
  { id: 'O01', kind: '孤儿', at: 'orphans/true-orphan.png', expect: '真孤儿被列入未用、清理时移入回收站' },
  { id: 'O02', kind: '孤儿', at: 'orphans/root-orphan.pdf', expect: '库根孤儿被列入未用' },
  { id: 'O03', kind: '孤儿', at: 'excluded/orphan-in-excluded.png', expect: '排除目录内孤儿：报告过滤、清理/导出不动' },
  { id: 'O04', kind: '孤儿', at: 'orphans/zip-orphan.zip', expect: '非受管扩展名（zip）不进入索引、不被清理' },
  { id: 'O05', kind: '孤儿', at: 'orphans/csv-orphan.csv', expect: '非受管扩展名（csv）不受影响' },
  { id: 'O06', kind: '孤儿', at: 'orphans/only-canvas.png', expect: '仅被 canvas 引用的附件不得被判孤儿' },
  { id: 'O07', kind: '孤儿', at: 'orphans/only-frontmatter.png', expect: '仅被 frontmatter 引用的附件不得被判孤儿' },

  // —— 空目录（5）——
  { id: 'D01', kind: '空目录', at: 'empty/leaf/', expect: '叶子空目录被移入回收站' },
  { id: 'D02', kind: '空目录', at: 'empty/parent/child/', expect: '仅含空子目录的父目录在级联后一并清理' },
  { id: 'D03', kind: '空目录', at: 'empty/deep/a/b/c/', expect: '深层嵌套空目录被逐层清理' },
  { id: 'D04', kind: '空目录', at: 'excluded/empty-in-excluded/', expect: '排除目录内的空目录不被清理' },
  { id: 'D05', kind: '空目录', at: 'empty/hidden-file/', expect: '含隐藏文件（.DS_Store）的目录视为非空、不清理' },

  // —— 目录布局（6）——
  { id: 'L01', kind: '目录布局', at: 'notes/01-正文图片.md → ./assets', expect: '笔记相对目录 ./assets 落盘正确' },
  { id: 'L02', kind: '目录布局', at: 'deep/多级/深层笔记.md → deep/多级/assets', expect: '深层目录下笔记的归属目录正确' },
  { id: 'L03', kind: '目录布局', at: '中文目录/中文笔记.md', expect: '中文目录处理正常' },
  { id: 'L04', kind: '目录布局', at: 'assets/', expect: '库根 assets 作为归属目录可用' },
  { id: 'L05', kind: '目录布局', at: 'excluded/', expect: '全局排除目录整体跳过' },
  { id: 'L06', kind: '目录布局', at: 'path-cases/合法名字保持.md', expect: '合法文件名（含空格、括号、连字符）不得被路径修复改名' },

  // —— 路径问题（2：仅"不应被改"一侧可在 Windows 落地）——
  { id: 'P01', kind: '路径', at: 'path-cases/normal name (1)-ok.png', expect: '合法名字不被改名（防过度修复）' },
  { id: 'P02', kind: '路径', at: 'tests/unit/features/consistency-core.test.ts', expect: '保留名/非法字符/超长的规划逻辑由单测覆盖（Windows 无法落地此类文件）' },

  // —— 幂等与重跑（4）——
  { id: 'I01', kind: '幂等', at: '全库命名 ×2', expect: '第二遍无可重命名项、不弹预览、不产生 (1)' },
  { id: 'I02', kind: '幂等', at: '清理未用 ×2', expect: '第二遍删 0 个' },
  { id: 'I03', kind: '幂等', at: '断链修复 ×2', expect: '第二遍零改动' },
  { id: 'I04', kind: '幂等', at: '收集 ×2', expect: '第二遍无可收集项' },
  { id: 'I05', kind: '幂等', at: '导出未用 ×2', expect: '同名 zip 覆盖，重复导出不报错' },
  { id: 'I06', kind: '幂等', at: '导出当前笔记 ×1', expect: '生成 <笔记名>_Attachments.zip 且含 manifest.json' },
  { id: 'X01', kind: '自动化', at: '粘贴外链', expect: '真实 Obsidian 中粘贴外链即自动本地化 + 命名' },
  { id: 'X02', kind: '自动化', at: '打开库时不批量处理', expect: '启动抑制窗口生效，打开库不会自动改写既有笔记' },
  { id: 'N18', kind: '笔记形态', at: 'notes/18-HTML媒体标签.md', expect: 'HTML audio/video 引用被识别，改写只换 src（不产生 ![](m.mp3)</audio>）' },
  { id: 'N19', kind: '笔记形态', at: 'notes/19-frontmatter列表.md', expect: 'frontmatter 列表形式（images: - 路径）引用被保护' },
  { id: 'N20', kind: '笔记形态', at: 'notes/20-裸URL行.md', expect: 'frontmatter 中的非媒体 URL 不被当作引用' },
  { id: 'A15', kind: '附件形态', at: 'assets/webm/clip.webm', expect: 'webm 受管' },
  { id: 'A16', kind: '附件形态', at: 'assets/dup2/pic.png', expect: '与 pic.png 同名不同内容：互不覆盖、各自独立' },
  { id: 'E13', kind: '外链', at: 'externals/重定向.md', expect: '3xx 重定向按最终响应落盘（已知无法逐跳校验，见文档）' },
  { id: 'E14', kind: '外链', at: 'externals/带标题.md', expect: '带标题的 markdown 图片外链必须被本地化（旧实现按空白截断目标，"目标后接不到 )"→ 整条漏掉）；alt 作为别名保留' },
  { id: 'E15', kind: '外链', at: 'externals/尖括号目标.md', expect: '<…> 包裹的目标被识别并本地化；落盘名含空格的引用按 %20 编码写回' },
  { id: 'E16', kind: '外链', at: 'externals/含括号目标.md', expect: '目标含未转义括号时**整条跳过**、原文一字不改（宁可漏本地化，绝不产出半截链接）' },
  { id: 'E17', kind: '外链', at: 'externals/svg外链.md', expect: 'SVG 外链不被本地化落存（内容识别为 svg 即拒绝，属格式层面的硬跳过）' },
  { id: 'E18', kind: '外链', at: 'externals/非受管外链.md', expect: '非受管类型（txt）不落盘、不改写（落盘前的白名单闭合校验）' },
];

/** 排除目录（写进设置，验收时验证"整块区域都不动"）。 */
export const ACCEPTANCE_EXCLUDES = ['excluded'];

/** 验收端口（seed 与真实 Obsidian 验收脚本共用同一端口，保证外链可达）。 */
export const ACCEPTANCE_HTTP = 'http://127.0.0.1:45999';

/**
 * 验收设置（harness 与真实 Obsidian 共用同一份，避免两处配置漂移）。
 * 相对真实默认值只有三处刻意调整：开启扩展扫描、关闭内网拦截（本机测试服务）、
 * 设置排除目录与域名黑名单（供拦截类用例）。
 */
export const ACCEPTANCE_SETTINGS: Record<string, unknown> = {
  version: 1,
  attachmentFolder: './assets',
  attachmentFolderMode: 'custom',
  naming: {
    enabled: true,
    connector: '_',
    addTime: false,
    addPathHash: false,
    honorCategory: true,
    showSubType: false,
    folderByCategory: false,
    categoryWords: { image: 'image', video: 'video', audio: 'audio', pdf: 'pdf', document: 'document', webpage: 'webpage', misc: 'misc' },
  },
  localize: {
    enabled: true,
    localizeWebUrls: true,
    allowedCategories: ['image', 'video', 'audio', 'pdf', 'document', 'misc'],
    scanHtmlAndLinks: true,
    useMd5ForNew: false,
    minSizeKb: 0,
    tryCount: 1,
    timeoutMs: 5000,
    blockPrivateHosts: false,
    maxDownloadMb: 100,
    allowHosts: [],
    denyHosts: ['blacklisted.invalid'],
    hostAllowlistOnly: false,
    perHostIntervalMs: 0,
    maxConcurrent: 2,
  },
  consistency: {
    enabled: true,
    reportBrokenLinks: true,
    repairIncompatiblePaths: true,
    platforms: ['windows'],
    followNoteMove: false,
    fuzzySuggest: true,
    fuzzyThreshold: 0.6,
    fuzzyTopN: 5,
  },
  cleanup: { enabled: true, deleteMode: '.trash', excludedFolders: [], excludeSubfolders: false, requireConfirm: true },
  exporter: { enabled: true },
  automation: { enabled: false, interval: 5 },
  paths: { exclude: ACCEPTANCE_EXCLUDES },
  notificationLevel: 'verbose',
};

/** 验收库所需的附件与笔记（依据上方清单落成真实文件）。 */
export function seedAcceptanceVault(rootAbs: string, httpBase: string): void {
  // 1) 受管附件（各类扩展名 + 特殊情形）
  writeBin(rootAbs, 'assets/png/pic.png', 'png');
  writeBin(rootAbs, 'assets/jpg/pic.jpg', 'jpg');
  writeBin(rootAbs, 'assets/gif/pic.gif', 'gif');
  writeBin(rootAbs, 'assets/webp/pic.webp', 'webp');
  writeBin(rootAbs, 'assets/mp4/clip.mp4', 'mp4');
  // song.mp3 被三篇笔记引用（notes/14 短名 `![[song]]`、notes/16 路径式、notes/18 HTML src），
  // 因此「全库命名」会为每篇复制副本、原文件随后成为未用被清理——**副本必须承载同样内容**。
  // 这里加唯一标记：否则它与其它 mp3 夹具字节相同，"内容是否还在"的判定会失去意义。
  writeFile(rootAbs, 'assets/mp3/song.mp3', Buffer.concat([HEAD.mp3, Buffer.from('MARKER-SONG')]));
  writeBin(rootAbs, 'assets/pdf/doc.pdf', 'pdf');
  writeBin(rootAbs, 'assets/docx/doc.docx', 'docx');
  writeBin(rootAbs, 'assets/svg/vec.svg', 'svg');
  writeBin(rootAbs, 'assets/dup/pic.png', 'png');
  // A13 的预期是"0 字节附件不被误删"，故这里必须**真的**写 0 字节；
  // 早期用 writeBin 会写入非空内容，与用例预期不符（夹具与预期漂移）。
  writeFile(rootAbs, 'assets/zero/empty.png', Buffer.alloc(0));
  writeBin(rootAbs, 'path-cases/normal name (1)-ok.png', 'png');
  writeFile(rootAbs, 'path-cases/合法名字保持.md', '# P01\n\n![x](path-cases/normal name (1)-ok.png)\n');
  // 非受管类型（应当完全不被插件管理）
  writeFile(rootAbs, 'assets/noext', 'no extension here');
  writeFile(rootAbs, 'assets/other/note.txt', 'plain');
  writeFile(rootAbs, 'orphans/zip-orphan.zip', HEAD.zip);
  writeFile(rootAbs, 'orphans/csv-orphan.csv', HEAD.csv);
  // 孤儿
  writeBin(rootAbs, 'orphans/true-orphan.png', 'png');
  writeBin(rootAbs, 'orphans/root-orphan.pdf', 'pdf');
  // 下面三个附件必须带**唯一尾部标记**：`writeBin` 产生的字节在同类文件间完全相同，
  // 而 harness 要按"字节内容是否仍在库里"判断它们有没有被误删（附件会被命名功能改名，
  // 不能按名字判断）。若字节不唯一，"A 被删但同样字节的 B 还在"就会让断言假绿。
  writeFile(rootAbs, 'orphans/only-canvas.png', Buffer.concat([HEAD.png, Buffer.from('MARKER-ONLY-CANVAS')]));
  writeFile(rootAbs, 'orphans/only-frontmatter.png', Buffer.concat([HEAD.png, Buffer.from('MARKER-ONLY-FRONTMATTER')]));
  writeFile(rootAbs, 'assets/shared/shared.png', Buffer.concat([HEAD.png, Buffer.from('MARKER-SHARED')]));
  writeBin(rootAbs, 'excluded/orphan-in-excluded.png', 'png');
  // A12 的预期是"被两篇笔记**共享**的附件不移动、不误删"，所以必须真的有这两篇笔记引用它。
  // 早期夹具只创建了文件、没有任何笔记引用 —— 它其实是个真孤儿，会被清理正确地删掉，
  // 于是"A12" 这条用例的预期与夹具事实不符（且当时没有机器校验，没人发现）。
  writeFile(rootAbs, 'notes/21-共享引用A.md', '# 21A\n\n![s](assets/shared/shared.png)\n');
  writeFile(rootAbs, 'notes/22-共享引用B.md', '# 21B\n\n<img src="assets/shared/shared.png" alt="s">\n');

  // 2) 笔记（引用形态矩阵）
  writeFile(rootAbs, 'notes/01-正文图片.md', '# 01\n\n![a](assets/png/pic.png)\n\n![b](assets/dup/pic.png)\n');
  // 同时引用 svg：A09 要验证「svg 受管且不得被清理」，前提是它真的被引用（否则它是孤儿、被清理才对）
  writeFile(rootAbs, 'notes/02-wiki嵌入.md', '# 02\n\n![[assets/jpg/pic.jpg]]\n\n![[assets/svg/vec.svg]]\n');
  writeFile(rootAbs, 'notes/03-HTML标签.md', '# 03\n\n<img src="assets/gif/pic.gif" alt="gif">\n');
  writeFile(
    rootAbs,
    'notes/04-frontmatter.md',
    ['---', 'cover: assets/webp/pic.webp', `banner: "${httpBase}/banner.png"`, '---', '', '# 04', ''].join('\n'),
  );
  writeFile(rootAbs, 'notes/05-代码块假引用.md', '# 05\n\n```md\n![x](assets/never-exists.png)\n```\n');
  writeFile(rootAbs, 'notes/06-行内代码.md', '# 06\n\n行内：`![y](assets/never-exists-2.png)`\n');
  writeFile(
    rootAbs,
    'notes/07-外链本地化.md',
    ['# 07', '', `![p](${httpBase}/remote.png)`, '', `![d](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAIhQGAXbM3ZQAAAABJRU5ErkJggg==)`, ''].join('\n'),
  );
  writeFile(rootAbs, 'notes/08-data-uri.md', '# 08\n\n![d2](data:image/gif;base64,R0lGODlhAQABAAAAACw=)\n');
  writeFile(rootAbs, 'notes/09-断链-精确可修.md', '# 09\n\n![x](wrong-dir/pic.png)\n');
  writeFile(rootAbs, 'notes/10-断链-编码.md', '# 10\n\n![x](assets/png/pic%2Epng)\n');
  writeFile(rootAbs, 'notes/11-断链-大小写.md', '# 11\n\n![x](assets/png/PIC.png)\n');
  writeFile(rootAbs, 'notes/12-断链-多候选.md', '# 12\n\n![x](gone/pic.png)\n');
  writeFile(rootAbs, 'notes/13-断链-无候选.md', '# 13\n\n![x](gone/nothing-like-this.png)\n');
  writeFile(rootAbs, 'notes/14-短名无扩展名.md', '# 14\n\n![[song]]\n');
  writeFile(rootAbs, 'notes/15-中文 空格 emoji 😀.md', '# 15\n\n![x](assets/pdf/doc.pdf)\n');
  writeFile(rootAbs, `notes/${LONG_NOTE_NAME}.md`, '# 16\n\n![x](assets/mp3/song.mp3)\n');

  // 3) canvas：一个有效引用 + 一个缺失目标
  writeFile(
    rootAbs,
    'canvas/画布用例.canvas',
    JSON.stringify(
      {
        nodes: [
          { id: 'n1', type: 'file', file: 'orphans/only-canvas.png', x: 0, y: 0, width: 100, height: 100 },
          { id: 'n2', type: 'file', file: 'orphans/canvas-missing.png', x: 200, y: 0, width: 100, height: 100 },
        ],
        edges: [],
      },
      null,
      2,
    ),
  );

  // 4) frontmatter 独占引用
  writeFile(rootAbs, 'orphans/only-frontmatter.md', '---\ncover: orphans/only-frontmatter.png\n---\n\n# fm\n');

  // 5) 外链矩阵
  writeFile(rootAbs, 'externals/图片.md', `# E01\n\n![i](${httpBase}/img.png)\n`);
  writeFile(rootAbs, 'externals/音频.md', `# E02\n\n![a](${httpBase}/audio.mp3)\n`);
  writeFile(rootAbs, 'externals/视频.md', `# E03\n\n![v](${httpBase}/video.mp4)\n`);
  writeFile(rootAbs, 'externals/pdf.md', `# E04\n\n![p](${httpBase}/doc.pdf)\n`);
  writeFile(rootAbs, 'externals/网页.md', `# E05\n\n![h](${httpBase}/page.html)\n`);
  writeFile(rootAbs, 'externals/内网.md', '# E06\n\n![l](http://127.0.0.1:1/blocked.png)\n');
  // 黑名单项只按**主机名**匹配，故用一个不可路由域名做用例（不依赖本机服务）
  writeFile(rootAbs, 'externals/黑名单.md', '# E07\n\n![b](http://blacklisted.invalid/deny.png)\n');
  writeFile(rootAbs, 'externals/仅白名单.md', `# E08\n\n![w](${httpBase}/not-in-allowlist.png)\n`);
  writeFile(rootAbs, 'externals/404.md', `# E09\n\n![n](${httpBase}/404.png)\n`);
  writeFile(rootAbs, 'externals/data图片.md', '# E10\n\n![d](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAIhQGAXbM3ZQAAAABJRU5ErkJggg==)\n');
  writeFile(rootAbs, 'externals/普通链接.md', `# E11\n\n[说明文档](${httpBase}/doc.pdf)\n`);
  writeFile(rootAbs, 'externals/html标签.md', `# E12\n\n<img src="${httpBase}/html.png" alt="封面" width="200">\n`);
  // E14–E18：本地化 markdown 目标解析的边界。
  // 这五条来自 2026-09-28 的实测缺陷——旧实现按空白截断目标，导致
  // ① 带标题的图片**整条漏掉**（永远不本地化）、② `<…>` 写法连尖括号一起当 URL 也漏掉、
  // ③ 目标含 `)` 时被截断（可能把正文改成坏形态）。④⑤ 则是"该跳过的必须真的跳过"。
  writeFile(rootAbs, 'externals/带标题.md', `# E14\n\n![图注](${httpBase}/titled.png "我的图注")\n`);
  writeFile(rootAbs, 'externals/尖括号目标.md', `# E15\n\n![angle](<${httpBase}/angle%20img.png>)\n`);
  writeFile(rootAbs, 'externals/含括号目标.md', `# E16\n\n![paren](${httpBase}/Foo_(bar).png)\n`);
  writeFile(rootAbs, 'externals/svg外链.md', `# E17\n\n![vec](${httpBase}/draw.svg)\n`);
  writeFile(rootAbs, 'externals/非受管外链.md', `# E18\n\n![txt](${httpBase}/plain.txt)\n`);

  // 6) 排除目录内的笔记（整块区域应被跳过）
  writeFile(rootAbs, 'excluded/排除笔记.md', '# ex\n\n![x](assets/png/pic.png)\n\n![miss](excluded/missing.png)\n');
  writeFile(rootAbs, 'excluded/中文排除笔记.md', '# ex2\n\n<img src="excluded/html.png">\n');

  // 7) 深层与中文目录
  writeFile(rootAbs, 'deep/多级/深层笔记.md', `# L02\n\n![x](${httpBase}/deep.png)\n`);
  writeFile(rootAbs, '中文目录/中文笔记.md', '# L03\n\n![x](assets/png/pic.png)\n');

  // 8) 空目录矩阵
  for (const d of ['empty/leaf', 'empty/parent/child', 'empty/deep/a/b/c', 'excluded/empty-in-excluded']) {
    fs.mkdirSync(path.join(rootAbs, d), { recursive: true });
  }
  // 补充载体（N18–N20 / A15 / A16 / E13）
  writeBin(rootAbs, 'assets/webm/clip.webm', 'webm');
  writeBin(rootAbs, 'assets/dup2/pic.png', 'jpg'); // 同名不同内容（jpg 魔数伪装 png 名，验证不互相覆盖）
  writeFile(
    rootAbs,
    'notes/18-HTML媒体标签.md',
    '# 18\n\n<audio src="assets/mp3/song.mp3" controls></audio>\n\n<video src="assets/mp4/clip.mp4" loop></video>\n',
  );
  writeFile(rootAbs, 'notes/19-frontmatter列表.md', ['---', 'images:', '  - assets/dup2/pic.png', '---', '', '# 19', ''].join('\n'));
  writeFile(rootAbs, 'notes/20-裸URL行.md', ['---', 'source: https://example.com/not-media-page', 'tags: [验收, 用例]', '---', '', '# 20', ''].join('\n'));
  writeFile(rootAbs, 'externals/重定向.md', `# E13\n\n![r](${httpBase}/redirect.png)\n`);

  fs.mkdirSync(path.join(rootAbs, 'empty/hidden-file'), { recursive: true });
  writeFile(rootAbs, 'empty/hidden-file/.DS_Store', 'not-empty');
}

/** 生成可核对的预期清单（Markdown），供人工与脚本共用。 */
export function expectedDoc(): string {
  const byKind = new Map<string, AcceptanceCase[]>();
  for (const c of ACCEPTANCE_CASES) {
    const arr = byKind.get(c.kind) ?? [];
    arr.push(c);
    byKind.set(c.kind, arr);
  }
  const lines: string[] = [
    '# 验收用例清单（for-test/acceptance）',
    '',
    `> 共 **${ACCEPTANCE_CASES.length}** 条用例；排除目录：\`${ACCEPTANCE_EXCLUDES.join(', ')}\``,
    '> 用途：① 真实 Obsidian 人工/自动验收；② harness 全量验收（`tests/e2e/acceptance.test.ts`）。',
    '',
  ];
  for (const [kind, arr] of byKind) {
    lines.push(`## ${kind}（${arr.length}）`, '', '| ID | 载体 | 预期 |', '|---|---|---|');
    for (const c of arr) lines.push(`| ${c.id} | \`${c.at}\` | ${c.expect} |`);
    lines.push('');
  }
  return lines.join('\n');
}
