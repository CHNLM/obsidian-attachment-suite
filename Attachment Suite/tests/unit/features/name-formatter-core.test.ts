import { describe, expect, it } from 'vitest';
import type { AttachmentEntry, AttachmentIndexSnapshot } from '../../../src/core';
import {
  buildName,
  checkAlreadyRenamed,
  formatTimestamp,
  namingParts,
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
    // 开启 时间+哈希
    const namingFull: NamingSettings = { ...naming, addTime: true, addPathHash: true };
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
});