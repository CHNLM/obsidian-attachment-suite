/**
 * 受管名单 × 格式识别的矩阵守卫。
 *
 * 为什么需要它：仓库里有**两套口径**——`types.ts` 的受管附件扩展名（决定"这文件归不归插件管"）
 * 与 `type-classifier.ts` 的魔数识别（决定"它到底是什么类别"）。二者之间原先没有任何对账，
 * 于是"名单里有、但识别不出来"或"识别成另一个类别"这类偏差既不会被测试发现、也不会被决策过。
 * 本轮就查实了两处：`m4a`（ISO-BMFF 里的音频品牌）被判成 **video**、`mkv` 与 `mov` 的
 * `ext` 被归一成别的扩展名（属有意为之，但从未登记）。
 *
 * 本表把"现状"变成"已决策"：每个受管扩展名一个最小魔数样例 + 一行**显式登记的期望值**。
 * 谁要改动识别行为，先在这里改期望值——那时它就不再是"悄悄变了"。
 *
 * 反向那一半同样重要：`classify` 能认出、但**刻意不进**受管名单的格式（zip / html / txt / bin）
 * 必须逐个登记在下面的清单里。以后新增一种可识别格式时，守卫会因为"两边都没登记"而变红，
 * 逼着做一次显式决策：进受管名单，还是进"不受管"清单并说明理由。
 *
 * 为什么样例写在本文件里、而不是从 `type-classifier.test.ts` 抽一份共享表：那个文件是对**格式细节**的
 * 断言（动图标志、PNG 分块…），本文件是**清单级**对账，两者用途不同。样例本身具备自校验性——
 * 若字节写错、`classify` 会返回别的东西，矩阵当场转红，所以这里不存在"两份实现悄悄漂移"的风险。
 */

import { describe, it, expect } from 'vitest';
import { classify } from '../../../src/core/type-classifier';
import { MANAGED_ATTACHMENT_EXTENSIONS } from '../../../src/core/types';

function bytes(...b: number[]): Uint8Array {
  return new Uint8Array(b);
}
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
/** ISO-BMFF 头：`ftyp` + major brand（第 8..11 字节就是品牌，classifier 按它分流）。 */
const ftyp = (brand: string): Uint8Array => bytes(0x00, 0x00, 0x00, 0x14, ...ascii('ftyp'), ...ascii(brand));
/** 一个"像 zip"的头，并在头部塞入指定的条目名（docx/xlsx/pptx 靠它区分）。 */
const zipLike = (marker: string): Uint8Array => bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, ...ascii(marker));

interface Row {
  /** 受管名单里的扩展名（本表的键）。 */
  managed: string;
  /** 最小魔数样例。 */
  sample: Uint8Array;
  /** 期望的类别。 */
  category: string;
  /** 期望的落盘扩展名（classifier 归一后的安全值，可能与被识别文件的原扩展名不同）。 */
  resultExt: string;
  isSvg?: boolean;
  /** 与受管名单里的名字不一致时，说明为什么。 */
  note?: string;
}

/**
 * 受管名单 21 项的期望值。
 * `resultExt` 与 `managed` 不同的四行都是**有意的归一**，理由写在 note 里——
 * 登记它们的意义就是让"归一"成为一个被看见的决定，而不是一次静默改写。
 */
const MANAGED_MATRIX: Row[] = [
  { managed: 'png', sample: bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...ascii('IHDR')), category: 'image', resultExt: 'png' },
  { managed: 'jpg', sample: bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10), category: 'image', resultExt: 'jpg' },
  {
    managed: 'jpeg',
    sample: bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10),
    category: 'image',
    resultExt: 'jpg',
    note: 'jpeg 归一到 jpg：同一个 JPEG 分支只产出一个安全扩展名',
  },
  { managed: 'gif', sample: bytes(...ascii('GIF89a'), 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x3b), category: 'image', resultExt: 'gif' },
  { managed: 'webp', sample: bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8 ')), category: 'image', resultExt: 'webp' },
  { managed: 'bmp', sample: bytes(...ascii('BM'), 0, 0, 0, 0, 0, 0), category: 'image', resultExt: 'bmp' },
  { managed: 'avif', sample: ftyp('avif'), category: 'image', resultExt: 'avif' },
  { managed: 'svg', sample: bytes(...ascii('<svg')), category: 'image', resultExt: 'svg', isSvg: true, note: '识别为图片但带 isSvg —— 本地化侧据此硬跳过（存在 XSS 风险）' },
  { managed: 'mp4', sample: ftyp('isom'), category: 'video', resultExt: 'mp4' },
  {
    managed: 'mov',
    sample: ftyp('qt  '),
    category: 'video',
    resultExt: 'mp4',
    note: 'ISO-BMFF 分支只按品牌分 avif / 其余视频，故 mov 与 mp4 同归 video/mp4',
  },
  { managed: 'webm', sample: bytes(0x1a, 0x45, 0xdf, 0xa3, ...ascii('webm')), category: 'video', resultExt: 'webm' },
  {
    managed: 'mkv',
    sample: bytes(0x1a, 0x45, 0xdf, 0xa3, ...ascii('matroska')),
    category: 'video',
    resultExt: 'webm',
    note: 'EBML 分支不细分 matroska / webm，二者同归 video/webm',
  },
  { managed: 'mp3', sample: bytes(...ascii('ID3'), 3, 0, 0, 0, 0, 0), category: 'audio', resultExt: 'mp3' },
  { managed: 'wav', sample: bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE'), ...ascii('fmt ')), category: 'audio', resultExt: 'wav' },
  { managed: 'ogg', sample: bytes(...ascii('OggS'), 0, 2, 0, 0), category: 'audio', resultExt: 'ogg' },
  {
    managed: 'm4a',
    sample: ftyp('M4A '),
    category: 'audio',
    resultExt: 'm4a',
    note: 'M4A 是 ISO-BMFF 里的音频品牌，必须判成 audio（此前落进"通用视频"→ 按视频命名并改名 .mp4）',
  },
  { managed: 'flac', sample: bytes(...ascii('fLaC'), 0, 0, 0, 0x22), category: 'audio', resultExt: 'flac' },
  { managed: 'pdf', sample: bytes(...ascii('%PDF-1.4')), category: 'pdf', resultExt: 'pdf' },
  { managed: 'docx', sample: zipLike('word/'), category: 'document', resultExt: 'docx' },
  { managed: 'xlsx', sample: zipLike('xl/'), category: 'document', resultExt: 'xlsx' },
  { managed: 'pptx', sample: zipLike('ppt/'), category: 'document', resultExt: 'pptx' },
];

/**
 * `classify` 能认出、但**刻意不**列入受管名单的格式。
 * 每一行都是一次显式决策：这些格式不进"附件管理"范围（zip 是压缩包、html 是网页、
 * txt 太泛、bin 是无法识别内容时的兜底）。
 */
const NOT_MANAGED_MATRIX: Array<{ label: string; sample: Uint8Array; hint: string; category: string; resultExt: string; why: string }> = [
  { label: 'zip', sample: zipLike('nope'), hint: 'a.zip', category: 'misc', resultExt: 'zip', why: '普通压缩包不是附件' },
  { label: 'html', sample: bytes(...ascii('<!DOCTYPE html><html>')), hint: 'a.html', category: 'webpage', resultExt: 'html', why: '网页永不落存（本地化侧硬跳过）；命名侧只为已在库里的 .html 服务' },
  { label: 'txt', sample: bytes(...ascii('hello world\nplain text')), hint: 'a.txt', category: 'document', resultExt: 'txt', why: '纯文本范围太泛，不进受管名单' },
  { label: 'bin', sample: bytes(0x01, 0x02, 0x03), hint: 'a.bin', category: 'misc', resultExt: 'bin', why: '内容与提示都认不出时的兜底' },
];

describe('格式矩阵守卫：受管名单与识别口径必须逐项对得上', () => {
  it('矩阵覆盖受管名单的每一项，且不多不少', () => {
    const inMatrix = MANAGED_MATRIX.map((r) => r.managed).sort();
    expect(MANAGED_MATRIX.length, '矩阵行数太少——本守卫等于没查').toBeGreaterThan(15);
    expect(
      inMatrix,
      '受管名单与矩阵不一致：新增了受管扩展名却忘了登记期望值（或在矩阵里留了一个已移除的扩展名）',
    ).toEqual([...MANAGED_ATTACHMENT_EXTENSIONS].sort());
  });

  it('每个受管扩展名的识别结果都与登记的期望值一致', () => {
    const problems: string[] = [];
    for (const row of MANAGED_MATRIX) {
      const r = classify(row.sample, `a.${row.managed}`);
      if (r.category !== row.category) {
        problems.push(`${row.managed}: 期望类别 ${row.category}，实际 ${r.category}`);
      }
      if (r.ext !== row.resultExt) {
        problems.push(`${row.managed}: 期望扩展名 ${row.resultExt}，实际 ${r.ext}${row.note ? `（登记说明：${row.note}）` : ''}`);
      }
      if (row.isSvg !== undefined && r.isSvg !== row.isSvg) {
        problems.push(`${row.managed}: 期望 isSvg=${row.isSvg}，实际 ${r.isSvg}`);
      }
    }
    expect(problems, `识别口径变了却没更新矩阵：${problems.join('；')}`).toEqual([]);
  });

  it('不受管清单：能识别但不落管的格式必须逐个登记', () => {
    for (const row of NOT_MANAGED_MATRIX) {
      const r = classify(row.sample, row.hint);
      expect(r.category, `${row.label} 的类别变了（${row.why}）`).toBe(row.category);
      expect(r.ext, `${row.label} 的扩展名变了（${row.why}）`).toBe(row.resultExt);
    }
    // 反向：受管名单里的扩展名不得出现在"不受管"清单里（两边都登记 = 决策互相打架）
    const overlap = NOT_MANAGED_MATRIX.map((r) => r.resultExt).filter((e) => MANAGED_ATTACHMENT_EXTENSIONS.includes(e));
    expect(overlap, `这些扩展名同时出现在受管与不受管清单里：${overlap.join('、')}`).toEqual([]);
  });

  it('内容认不出时回落到原扩展名，且类别是 misc（不会假装认得）', () => {
    for (const ext of MANAGED_ATTACHMENT_EXTENSIONS) {
      const r = classify(bytes(0x01, 0x02, 0x03, 0x04), `note.${ext}`);
      expect(r.ext, `未知内容 + 提示 .${ext} 时应保留原扩展名`).toBe(ext);
      expect(r.category, `未知内容 + 提示 .${ext} 时不得猜类别`).toBe('misc');
    }
  });

  it('ISO-BMFF 按品牌精确分流：音频品牌 → audio，视频品牌 → video，图片只认 avif / avis', () => {
    // 为什么单列一条：品牌分流必须**精确匹配**。曾用 `startsWith('av')`，于是 avc1 / av01
    // （都是视频品牌）被判成 AVIF 图片——ext 会一路走到落盘，视频被存成 .avif。
    const cases: Array<[string, string, string]> = [
      ['M4A ', 'audio', 'm4a'],
      ['M4B ', 'audio', 'm4a'],
      ['M4P ', 'audio', 'm4a'],
      ['avif', 'image', 'avif'],
      ['avis', 'image', 'avif'],
      ['isom', 'video', 'mp4'],
      ['mp42', 'video', 'mp4'],
      ['qt  ', 'video', 'mp4'],
      ['avc1', 'video', 'mp4'],
      ['av01', 'video', 'mp4'],
    ];
    const problems: string[] = [];
    for (const [brand, category, ext] of cases) {
      const r = classify(ftyp(brand), 'a.bin');
      if (r.category !== category || r.ext !== ext) {
        problems.push(`品牌「${brand}」：期望 ${category}/${ext}，实际 ${r.category}/${r.ext}`);
      }
    }
    expect(problems, `ISO-BMFF 品牌分流不符：${problems.join('；')}`).toEqual([]);
  });
});
