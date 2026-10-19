import { describe, expect, it } from 'vitest';
import { isViolation, repairName, type AttachmentEntry, type AttachmentIndexSnapshot } from '../../../src/core';
import {
  buildName,
  checkAlreadyRenamed,
  formatTimestamp,
  namingParts,
  parseRenamed,
  planForSnapshot,
} from '../../../src/features/name-formatter-core';
import type { NamingSettings } from '../../../src/settings';

const naming: NamingSettings = {
  enabled: true,
  connector: '_',
  addTime: false,
  addPathHash: false,
  honorCategory: true,
  showSubType: false,
  folderByCategory: false,
  categoryWords: { image: 'image', video: 'video', pdf: 'pdf', misc: 'misc' },
};

function entry(path: string, category: AttachmentEntry['category'], note: string): AttachmentEntry {
  return {
    path,
    category,
    mime: '',
    animated: false,
    size: 0,
    mtime: 0,
    references: [{ sourcePath: note, kind: 'embed', raw: '', linkText: path, status: 'resolved' }],
  };
}

function snapshot(entries: AttachmentEntry[]): AttachmentIndexSnapshot {
  return {
    entries: new Map(entries.map((e) => [e.path, e])),
    brokenRefs: [],
    orphanCandidates: [],
  };
}

describe('name-formatter', () => {
  it('buildName 输出 笔记_类别_序号.扩展名', () => {
    const name = buildName({
      noteName: '我的笔记',
      typeField: 'video',
      honorCategory: true,
      index: 1,
      connector: '_',
      includeNoteName: true,
      addTime: false,
      timeStr: '',
      addPathHash: false,
      hashSuffix: '',
      ext: 'mp4',
    });
    expect(name).toBe('我的笔记_video_001.mp4');
  });

  it('buildName 关闭 honorCategory 时省略类别段', () => {
    const name = buildName({
      noteName: '我的笔记',
      typeField: 'video',
      honorCategory: false,
      index: 1,
      connector: '_',
      includeNoteName: true,
      addTime: false,
      timeStr: '',
      addPathHash: false,
      hashSuffix: '',
      ext: 'mp4',
    });
    expect(name).toBe('我的笔记_001.mp4');
  });

  it('namingParts 支持序号补零与扩展字段', () => {
    const parts = namingParts({
      noteName: 'n', typeField: 'pdf', honorCategory: true, index: 12, connector: '_', includeNoteName: true,
      addTime: true, timeStr: '20260909', addPathHash: true, hashSuffix: 'abcdef12',
    });
    expect(parts).toEqual(['n', 'pdf', '012', '20260909', 'abcdef12']);
  });

  it('checkAlreadyRenamed 识别 / 拒绝', () => {
    expect(checkAlreadyRenamed('我的笔记_video_001', '我的笔记', true, '_', true)).toBe(true);
    expect(checkAlreadyRenamed('other_video_001', '我的笔记', true, '_', true)).toBe(false);
    expect(checkAlreadyRenamed('video_001', '我的笔记', false, '_', true)).toBe(true);
    expect(checkAlreadyRenamed('randomname', '我的笔记', true, '_', true)).toBe(false);
    // 不带类别段也能识别（honorCategory=false 时生成的 笔记_序号）
    expect(checkAlreadyRenamed('我的笔记_001', '我的笔记', true, '_', false)).toBe(true);
    expect(checkAlreadyRenamed('我的笔记_001', '我的笔记', true, '_', true)).toBe(false);
  });

  it('冲突避让后缀 " (N)" 仍被识别为已命名（避免反复复制副本）', () => {
    // SafeMoveEngine / 共享附件副本在目标占用时会产出 `笔记_image_002 (1).png`；
    // 若不识别，每次运行都会把它当成"未命名"再规划一次 → 复制副本无限增长。
    expect(checkAlreadyRenamed('我的笔记_image_002 (1)', '我的笔记', true, '_', true)).toBe(true);
    expect(parseRenamed('我的笔记_image_002 (1)', '我的笔记', true, '_', true)?.number).toBe(2);
    expect(parseRenamed('我的笔记_image_002 (12)', '我的笔记', true, '_', true)?.number).toBe(2);
  });

  it('planForSnapshot 为当前笔记每个附件规划命名', () => {
    const snap = snapshot([
      entry('assets/a.png', 'image', 'note.md'),
      entry('assets/b.mp4', 'video', 'note.md'),
      entry('assets/c.jpg', 'image', 'other.md'), // 其他笔记，忽略
    ]);
    const items = planForSnapshot(snap, 'note.md', 'note', naming);
    expect(items).toHaveLength(2);
    expect(items.some((i) => i.to === 'assets/note_image_001.png')).toBe(true);
    expect(items.some((i) => i.to === 'assets/note_video_001.mp4')).toBe(true);
  });

  it('planForSnapshot 跳过已命名附件（幂等）', () => {
    const snap = snapshot([entry('assets/note_image_001.png', 'image', 'note.md')]);
    const items = planForSnapshot(snap, 'note.md', 'note', naming);
    expect(items.length).toBe(0); // 已命名 → 无需处理
  });

  it('已命名但缺时间/哈希段时，二次重命名可补齐（修复不生效）', () => {
    // 场景等价于开启 时间+哈希：以下是 checkAlreadyRenamed 的显式入参
    // 现状只是 笔记_image_001，缺两段 → 应认为“未按当前方案命名”
    expect(checkAlreadyRenamed('note_image_001', 'note', true, '_', true, true, true)).toBe(false);
    // 已含时间+哈希 → 视为已命名，幂等
    const stem = buildName({
      noteName: 'note', typeField: 'image', honorCategory: true, index: 1,
      connector: '_', includeNoteName: true, addTime: true, timeStr: '20260909120000',
      addPathHash: true, hashSuffix: 'abcdef12', ext: 'png',
    }).replace(/\.png$/, '');
    expect(checkAlreadyRenamed(stem, 'note', true, '_', true, true, true)).toBe(true);

    // 只开时间、缺时间段 → 可补齐
    expect(checkAlreadyRenamed('note_image_001', 'note', true, '_', true, true, false)).toBe(false);
    expect(checkAlreadyRenamed('note_image_001_20260909120000', 'note', true, '_', true, true, false)).toBe(true);
  });

  it('二次重命名会为已命名附件补上时间与路径哈希段', () => {
    const namingFull: NamingSettings = { ...naming, addTime: true, addPathHash: true };
    const snap = snapshot([entry('assets/note_image_001.png', 'image', 'note.md')]);
    const items = planForSnapshot(snap, 'note.md', 'note', namingFull);
    expect(items).toHaveLength(1);
    // 目标应含 时间(14位) + 哈希(8位)
    expect(/^assets\/note_image_001_\d{14}_[0-9a-f]{8}\.png$/.test(items[0].to)).toBe(true);
  });

  it('folderByCategory 时按类别放入 <附件根>/<类型>/ 子目录', () => {
    const snap = snapshot([entry('img/a.png', 'image', 'note.md'), entry('doc/b.pdf', 'pdf', 'note.md')]);
    const items = planForSnapshot(snap, 'note.md', 'note', naming, true, 'assets');
    expect(items.some((i) => i.to === 'assets/image/note_image_001.png')).toBe(true);
    expect(items.some((i) => i.to === 'assets/pdf/note_pdf_001.pdf')).toBe(true);
  });

  it('folderByCategory 且未给根目录时，库根文件归一化不带 ./ 或前导 /', () => {
    const snap = snapshot([entry('a.png', 'image', 'note.md')]);
    const items = planForSnapshot(snap, 'note.md', 'note', naming, true, '');
    expect(items[0].to).toBe('image/note_image_001.png');
  });

  it('formatTimestamp 输出 YYYYMMDDHHmmss 补零', () => {
    expect(formatTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102030405');
    expect(formatTimestamp(new Date(2026, 11, 31, 23, 59, 59))).toBe('20261231235959');
  });

  it('buildName 关闭 includeNoteName 时省略笔记名', () => {
    const name = buildName({
      noteName: '我的笔记',
      typeField: 'image',
      honorCategory: true,
      index: 1,
      connector: '_',
      includeNoteName: false,
      addTime: false,
      timeStr: '',
      addPathHash: false,
      hashSuffix: '',
      ext: 'png',
    });
    expect(name).toBe('image_001.png');
  });

  it('planForSnapshot 开启 showSubType 时 typeField 含具体扩展名', () => {
    const namingSub: NamingSettings = { ...naming, showSubType: true };
    const snap = snapshot([entry('assets/a.mp4', 'video', 'note.md')]);
    const items = planForSnapshot(snap, 'note.md', 'note', namingSub);
    expect(items[0].to).toBe('assets/note_video_mp4_001.mp4');
  });

  it('checkAlreadyRenamed 支持两位及以上序号', () => {
    expect(checkAlreadyRenamed('note_image_012', 'note', true, '_', true)).toBe(true);
    expect(checkAlreadyRenamed('note_image_1', 'note', true, '_', true)).toBe(false); // 一位序号视为未命名
  });

  it('checkAlreadyRenamed 空连接符时直接拒绝（避免误判）', () => {
    expect(checkAlreadyRenamed('note_image_001', 'note', true, '', true)).toBe(false);
  });

  it('已命名附件占用序号段：新附件接续编号不碰撞（幂等关键）', () => {
    const snap = snapshot([
      entry('assets/note_image_001.png', 'image', 'note.md'), // 已按方案命名
      entry('assets/raw.png', 'image', 'note.md'), // 新到的原始附件
    ]);
    const items = planForSnapshot(snap, 'note.md', 'note', naming);
    // 新附件应接续为 002；若规划到 001 会与既有文件重名 → SafeMoveEngine 追加 (1) → 二次命名不幂等
    expect(items.map((i) => i.to)).toEqual(['assets/note_image_002.png']);
  });

  it('已命名附件占位 + showSubType：同类别新附件接续该子类型计数', () => {
    const namingSub: NamingSettings = { ...naming, showSubType: true };
    const snap = snapshot([
      entry('assets/note_video_mp4_001.mp4', 'video', 'note.md'), // 已命名（子类型 video_mp4）
      entry('assets/raw.mp4', 'video', 'note.md'), // 新原始视频
      entry('assets/raw.png', 'image', 'note.md'), // 新原始图片（不同子类型）
    ]);
    const items = planForSnapshot(snap, 'note.md', 'note', namingSub);
    expect(items.map((i) => i.to).sort()).toEqual([
      'assets/note_image_png_001.png',
      'assets/note_video_mp4_002.mp4',
    ]);
  });

  it('笔记名含连接符时仍能识别已命名并幂等（修复“重复执行同一批”）', () => {
    const noteName = 'C_C++_编程环境部署'; // 笔记名自身含连接符 `_`
    // 已按方案命名的附件应被识别为“已命名”→ 二次不再规划
    expect(checkAlreadyRenamed(`${noteName}_image_001`, noteName, true, '_', true)).toBe(true);
    const snap = snapshot([entry(`assets/${noteName}_image_001.png`, 'image', `${noteName}.md`)]);
    expect(planForSnapshot(snap, `${noteName}.md`, noteName, naming)).toHaveLength(0);

    // 序号接续：已命名占 001，新原始附件应规划为 002（而非重命名已命名的 001）
    const snap2 = snapshot([
      entry(`assets/${noteName}_image_001.png`, 'image', `${noteName}.md`),
      entry('assets/raw.png', 'image', `${noteName}.md`),
    ]);
    expect(planForSnapshot(snap2, `${noteName}.md`, noteName, naming).map((i) => i.to)).toEqual([
      `assets/${noteName}_image_002.png`,
    ]);
  });

  it('连接符 / 命名用词含路径分隔符或为空时被归一化（不写进嵌套子目录、不破坏幂等）', () => {
    // 回归：连接符是直接 join 进文件名的。填 `/` 会产出 `笔记/image/001.png` —— 与目录拼接后
    // 就把附件写进了意外子目录；填空串则 parseRenamed 恒返回 null，已命名附件永远识别不出来，
    // 每次运行都重新规划同一批（幂等被破坏）。二者都在配置被外部改写时也能兜住。
    const once = (connector: string, categoryWords: NamingSettings['categoryWords']): string[] => {
      const s: NamingSettings = { ...naming, connector, categoryWords };
      const snap = snapshot([entry('assets/raw.png', 'image', 'note.md')]);
      return planForSnapshot(snap, 'note.md', 'note', s).map((i) => i.to);
    };

    // 含 `/`：写在名字里的分隔符被剔除，路径仍落在 assets/ 下，不产生新层级
    expect(once('/', { image: 'image' })).toEqual(['assets/note_image_001.png']);
    // 空串：回退为默认下划线，命名依旧可解析（幂等）
    expect(once('', { image: 'image' })).toEqual(['assets/note_image_001.png']);
    // 命名用词含 `/`：同样被剔除
    expect(once('_', { image: 'img/sub' })).toEqual(['assets/note_imgsub_001.png']);

    // 空串连接符下，已命名的附件仍能被识别为已命名 → 二次执行不重复规划
    const sEmpty: NamingSettings = { ...naming, connector: '' };
    const renamed = snapshot([entry('assets/note_image_001.png', 'image', 'note.md')]);
    expect(planForSnapshot(renamed, 'note.md', 'note', sEmpty)).toHaveLength(0);
  });

  it('showSubType 的产出能被自己认回：类别段占两段也不破坏幂等', () => {
    const namingSub: NamingSettings = { ...naming, showSubType: true };
    // 单独开：产出 `note_video_mp4_001`，必须被认成"已命名"（旧实现只把类别段当一段 → 认不回）
    expect(checkAlreadyRenamed('note_video_mp4_001', 'note', true, '_', true)).toBe(true);
    // 与时间/哈希组合 —— 这正是真实宿主上"每轮改名、6 轮不收敛"的那个组合
    expect(
      checkAlreadyRenamed('note_video_mp4_001_20261014120000_77d88c7d', 'note', true, '_', true, true, true),
    ).toBe(true);
    // 再叠加"笔记名自身含连接符"
    expect(checkAlreadyRenamed('C_C++_环境_video_mp4_001', 'C_C++_环境', true, '_', true)).toBe(true);
    // 不能因"放宽类别段段数"而误判：前缀对不上、或不该有类别段时，仍须拒绝
    expect(checkAlreadyRenamed('other_video_mp4_001', 'note', true, '_', true)).toBe(false);
    expect(checkAlreadyRenamed('note_video_mp4_001', 'note', true, '_', false)).toBe(false);
    // 直接判据：已按 showSubType 命名的附件不再被规划（真宿主"每轮重新命名同一批"的根因）
    const snap = snapshot([entry('assets/note_video_mp4_001.mp4', 'video', 'note.md')]);
    expect(planForSnapshot(snap, 'note.md', 'note', namingSub)).toHaveLength(0);
    // 序号占位仍正确：已命名的 001 占位后，新原始附件接续为 002
    const snap2 = snapshot([
      entry('assets/note_video_mp4_001.mp4', 'video', 'note.md'),
      entry('assets/raw.mp4', 'video', 'note.md'),
    ]);
    expect(planForSnapshot(snap2, 'note.md', 'note', namingSub).map((i) => i.to)).toEqual([
      'assets/note_video_mp4_002.mp4',
    ]);
  });

  it('超长笔记名：生成的名字不越长度上限，且能被自己认回（往返幂等）', () => {
    // 80 个 CJK 字符 = 240 字节；再叠加「类别_扩展名_序号_时间戳_哈希」就越过了底层 255 字节的
    // 文件名上限。越限的后果不是"报错"，而是**被 repair-incompatible-paths 从尾部截断** →
    // 时间戳/哈希段被切掉 → parseRenamed 认不回 → 每轮重新命名（真宿主上表现为永不收敛）。
    const long = '长'.repeat(80);
    const built = buildName({
      noteName: long,
      typeField: 'audio_mp3',
      honorCategory: true,
      index: 1,
      connector: '_',
      includeNoteName: true,
      addTime: true,
      timeStr: '20261016191500',
      addPathHash: true,
      hashSuffix: '675d83cb',
      ext: 'mp3',
    });
    // ① 生成侧就必须合规：否则「路径修复」会动它，而它又认不回被修复后的名字 → 死循环
    expect(isViolation(built), `生成的名字越限：${built.length} 字符`).toBe(false);
    // ② 生成的名字必须能被解析器认回（钉子：这一条就是"写出的名字认不回"的直接判据）
    expect(checkAlreadyRenamed(built.replace(/\.mp3$/, ''), long, true, '_', true, true, true)).toBe(true);
    // ③ 再规划不应产出任何改名项（真宿主"每轮都在动"的正面反例）
    const snap = snapshot([entry(`notes/assets/audio/${built}`, 'audio', `${long}.md`)]);
    expect(planForSnapshot(snap, `${long}.md`, long, { ...naming, addTime: true, addPathHash: true, showSubType: true }, true, 'notes/assets')).toHaveLength(0);
    // ④ 与「路径修复」同口径：它认这个名字合规 → 不会去动它。循环的另一半（repair 改一次、
    //    rename 再改回去）也就无从成立。
    expect(repairName(built.replace(/\.mp3$/, ''), 'mp3')).toBe(built);
  });
});