/** 基于内容魔数的附件真实类型识别（纯函数，不信任扩展名）。 */

export type AttachmentCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'document'
  | 'webpage'
  | 'misc';

export interface ClassifyResult {
  category: AttachmentCategory;
  mime: string;
  /** 由魔数决定的安全扩展名（不含点）。 */
  ext: string;
  /** 动画图片标志（GIF 帧>1 / APNG / 动画 WebP）。 */
  animated: boolean;
  /** SVG（文本格式，存在 XSS 风险）。 */
  isSvg: boolean;
}

const EMPTY = (): ClassifyResult => ({
  category: 'misc',
  mime: 'application/octet-stream',
  ext: 'bin',
  animated: false,
  isSvg: false,
});

function isAsciiPrintable(data: Uint8Array, start: number, end: number): boolean {
  for (let i = start; i < end && i < data.length; i++) {
    const b = data[i];
    // 允许常见空白与可打印字符
    if (!(b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126))) return false;
  }
  return true;
}

/**
 * 识别真实附件类型。
 * @param data 文件内容（读取头部即可：多数分支只看前 512B，**GIF 与 ZIP 系最多读到 4096B**）。
 * @param hintPath 提示路径，仅在无法判断时回落到扩展名。
 */
export function classify(data: Uint8Array, hintPath?: string): ClassifyResult {
  if (data.length === 0) return EMPTY();
  const b0 = data[0];
  const b1 = data[1];

  // 静态 / 动画图片
  if (b0 === 0x89 && b1 === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    // PNG；判断 APNG：头部 512B 内出现 "acTL" 块标记
    const animated = hasBytes(data, 512, 0x61, 0x63, 0x54, 0x4c);
    return { category: 'image', mime: 'image/png', ext: 'png', animated, isSvg: false };
  }

  if (b0 === 0xff && b1 === 0xd8 && data[2] === 0xff) {
    return { category: 'image', mime: 'image/jpeg', ext: 'jpg', animated: false, isSvg: false };
  }

  if (b0 === 0x47 && b1 === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
    // GIF；动画判定：读逻辑屏幕宽度/高度，遍历扩展块中的 Graphic Control Extension 数
    let animated = false;
    let offset = 13; // Header(6) + LSD(7)
    if (data.length > offset) {
      const gctFlags = data[10];
      const gctSize = (gctFlags & 0x07) > 0 ? 1 << ((gctFlags & 0x07) + 1) : 0;
      offset += gctSize * 3;
      let seenOne = false;
      while (offset + 1 < data.length) {
        const marker = data[offset];
        if (marker === 0x3b) break; // trailer
        if (marker === 0x21) {
          const label = data[offset + 1];
          if (label === 0xf9) {
            if (seenOne) {
              animated = true;
              break;
            }
            seenOne = true;
          }
          // 跳过子块
          offset += 2;
          while (offset < data.length) {
            const sz = data[offset];
            offset++;
            if (sz === 0) break;
            offset += sz;
          }
        } else if (marker === 0x2c) {
          offset += 10; // image descriptor
          // 跳过 local color table 与 lzw 最小码长 + 数据子块
          if (offset < data.length) {
            const lctSize = data[offset - 3] & 0x07;
            offset += (lctSize > 0 ? 1 << (lctSize + 1) : 0) * 3;
          }
          offset += 1; // lzw min code size
          while (offset < data.length) {
            const sz = data[offset];
            offset++;
            if (sz === 0) break;
            offset += sz;
          }
        }
        if (offset > 4096) break;
      }
    }
    return { category: 'image', mime: 'image/gif', ext: 'gif', animated, isSvg: false };
  }

  if (b0 === 0x42 && b1 === 0x4d) {
    return { category: 'image', mime: 'image/bmp', ext: 'bmp', animated: false, isSvg: false };
  }

  if (b0 === 0x52 && b1 === 0x49 && data[2] === 0x46 && data[3] === 0x46 && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
    // "RIFF" + "WEBP"；动画标志：VP8X 特征字节 bit1（animation）
    let animated = false;
    if (data.length >= 30 && data[12] === 0x56 && data[13] === 0x50 && data[14] === 0x38 && data[15] === 0x58) {
      // VP8X chunk：标志字节在 data[20]
      if ((data[20] & 0x02) === 0x02) animated = true;
    }
    return { category: 'image', mime: 'image/webp', ext: 'webp', animated, isSvg: false };
  }

  if (data.length >= 12 && b0 === 0x00 && b1 === 0x00 && data[2] === 0x00 && data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
    // ISO BMFF（ftyp）：按 major brand 分流。
    // ⚠️ 分流必须**精确**，别用前缀猜：`startsWith('av')` 会同时命中 `avc1` / `av01` 这类
    // **视频**品牌，把它们判成 AVIF 图片——而 ext 会一路走到落盘（`localize-media` 用
    // `result.ext` 命名并校验受管白名单），于是一个视频被存成 `.avif`。
    const brand = String.fromCharCode(data[8], data[9], data[10], data[11]).toLowerCase();
    if (brand === 'avif' || brand === 'avis') {
      // avif = 静态图；avis = 图像序列（同族，按静态处理）
      return { category: 'image', mime: 'image/avif', ext: 'avif', animated: false, isSvg: false };
    }
    if (brand === 'm4a ' || brand === 'm4b ' || brand === 'm4p ') {
      // 音频品牌：M4A（普通音频）/ M4B（有声书）/ M4P（受保护 AAC）。
      // 漏掉这一支的后果很具体：一个下载来的 .m4a 会落进下面的"通用视频"，
      // 于是按**视频**命名（名字里出现 video）并改名成 `.mp4`。
      // 类别按事实给 audio；ext 也归一到 `m4a`——同在受管名单里，属安全扩展名。
      return { category: 'audio', mime: 'audio/mp4', ext: 'm4a', animated: false, isSvg: false };
    }
    // 其余品牌（isom / mp42 / qt  / avc1 / av01 …）统一按容器处理：video/mp4。
    // 这对 mov、mkv 等是**有意的归一**（各自仍只是容器差异），已登记在
    // tests/unit/core/format-matrix.test.ts 的矩阵里。
    return { category: 'video', mime: 'video/mp4', ext: 'mp4', animated: false, isSvg: false };
  }
  if ((b0 === 0x3c && b1 === 0x3f && data[2] === 0x78) || (b0 === 0x3c && b1 === 0x73)) {
    // "<?x" 或 "<s"
    return { category: 'image', mime: 'image/svg+xml', ext: 'svg', animated: false, isSvg: true };
  }

  // PDF
  if (b0 === 0x25 && b1 === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
    return { category: 'pdf', mime: 'application/pdf', ext: 'pdf', animated: false, isSvg: false };
  }

  // 视频 / 音频
  if (b0 === 0x1a && b1 === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
    return { category: 'video', mime: 'video/webm', ext: 'webm', animated: false, isSvg: false };
  }
  if (b0 === 0x49 && b1 === 0x44 && data[2] === 0x33) {
    return { category: 'audio', mime: 'audio/mpeg', ext: 'mp3', animated: false, isSvg: false };
  }
  if (b0 === 0x66 && b1 === 0x4c && data[2] === 0x61 && data[3] === 0x43) {
    return { category: 'audio', mime: 'audio/flac', ext: 'flac', animated: false, isSvg: false };
  }
  if (b0 === 0x52 && b1 === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
    return { category: 'audio', mime: 'audio/wav', ext: 'wav', animated: false, isSvg: false };
  }
  if (b0 === 0x4f && b1 === 0x67 && data[2] === 0x67 && data[3] === 0x53) {
    return { category: 'audio', mime: 'audio/ogg', ext: 'ogg', animated: false, isSvg: false };
  }

  // ZIP 系：docx / xlsx / pptx（查看第一目录条目名）
  if (b0 === 0x50 && b1 === 0x4b && (data[2] === 0x03 || data[2] === 0x05 || data[2] === 0x07)) {
    const inner = zipFirstEntry(data);
    if (inner === 'word/') return { category: 'document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx', animated: false, isSvg: false };
    if (inner === 'xl/') return { category: 'document', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx', animated: false, isSvg: false };
    if (inner === 'ppt/') return { category: 'document', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx', animated: false, isSvg: false };
    return { category: 'misc', mime: 'application/zip', ext: 'zip', animated: false, isSvg: false };
  }

  // HTML
  if (b0 === 0x3c && b1 === 0x21) {
    // "<!DOCTYPE html" / "<!" 后跟注释
    return { category: 'webpage', mime: 'text/html', ext: 'html', animated: false, isSvg: false };
  }
  if (isAsciiPrintable(data, 0, Math.min(data.length, 512))) {
    // 纯文本
    const head = String.fromCharCode(...data.slice(0, Math.min(512, data.length))).toLowerCase();
    if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<body')) {
      return { category: 'webpage', mime: 'text/html', ext: 'html', animated: false, isSvg: false };
    }
    return { category: 'document', mime: 'text/plain', ext: 'txt', animated: false, isSvg: false };
  }

  // 兜底：回落到提示扩展名
  if (hintPath) {
    const hintExt = hintPath.split('.').pop()?.toLowerCase() ?? '';
    if (hintExt && hintExt.length <= 10 && /^[a-z0-9]+$/.test(hintExt)) {
      const r = EMPTY();
      r.ext = hintExt;
      return r;
    }
  }
  return EMPTY();
}

/** 读取 ZIP 本地文件头中的第一个条目名。 */
function zipFirstEntry(data: Uint8Array): string {
  // EOCD 搜索太复杂，P0 从前端 4096B 的 "word/"/"xl/"/"ppt/" 关键字判断
  const window = data.subarray(0, Math.min(data.length, 4096));
  const head = Array.from(window).map((b) => String.fromCharCode(b)).join('');
  if (head.includes('word/')) return 'word/';
  if (head.includes('xl/')) return 'xl/';
  if (head.includes('ppt/')) return 'ppt/';
  return '';
}

/** 在内容头部 [0, limit) 范围内查找一组连续字节。 */
function hasBytes(data: Uint8Array, limit: number, ...pattern: number[]): boolean {
  const n = Math.min(data.length, limit);
  if (n < pattern.length) return false;
  outer: for (let i = 0; i + pattern.length <= n; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (data[i + j] !== pattern[j]) continue outer;
    }
    return true;
  }
  return false;
}
