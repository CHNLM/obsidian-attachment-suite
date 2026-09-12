"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => AttachmentSuitePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian15 = require("obsidian");

// src/core/hasher.ts
var S = [
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21
];
var K = new Array(64);
for (let i = 0; i < 64; i++) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
}
function rotl(x, c) {
  return (x << c | x >>> 32 - c) >>> 0;
}
function toLittleEndianWords(message) {
  const len = message.length;
  const paddedLen = (len + 8 >> 6) + 1 << 6;
  const words = new Uint32Array(paddedLen >> 2);
  for (let i = 0; i < len; i++) {
    words[i >> 2] |= message[i] << (i % 4 << 3);
  }
  words[len >> 2] |= 128 << (len % 4 << 3);
  const bitLenLo = len << 3 >>> 0;
  const bitLenHi = Math.floor(len / 536870912);
  words[words.length - 2] = bitLenLo;
  words[words.length - 1] = bitLenHi;
  return Array.from(words);
}
function md5Hex(data) {
  const words = toLittleEndianWords(data);
  let a0 = 1732584193;
  let b0 = 4023233417;
  let c0 = 2562383102;
  let d0 = 271733878;
  const chunkCount = words.length / 16;
  for (let chunk = 0; chunk < chunkCount; chunk++) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    const base = chunk * 16;
    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) {
        f = b & c | ~b & d;
        g = i;
      } else if (i < 32) {
        f = d & b | ~d & c;
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = 7 * i % 16;
      }
      f = f + a + K[i] + words[base + g] >>> 0;
      a = d;
      d = c;
      c = b;
      b = b + rotl(f, S[i]) >>> 0;
    }
    a0 = a0 + a >>> 0;
    b0 = b0 + b >>> 0;
    c0 = c0 + c >>> 0;
    d0 = d0 + d >>> 0;
  }
  const bytes = new Uint8Array(16);
  const out = [a0, b0, c0, d0];
  for (let j = 0; j < out.length; j++) {
    bytes[j * 4 + 0] = out[j] & 255;
    bytes[j * 4 + 1] = out[j] >>> 8 & 255;
    bytes[j * 4 + 2] = out[j] >>> 16 & 255;
    bytes[j * 4 + 3] = out[j] >>> 24 & 255;
  }
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}
function md5HexOfString(data) {
  return md5Hex(new TextEncoder().encode(data));
}

// src/core/type-classifier.ts
var EMPTY = () => ({
  category: "misc",
  mime: "application/octet-stream",
  ext: "bin",
  animated: false,
  isSvg: false
});
function isAsciiPrintable(data, start, end) {
  for (let i = start; i < end && i < data.length; i++) {
    const b = data[i];
    if (!(b === 9 || b === 10 || b === 13 || b >= 32 && b <= 126)) return false;
  }
  return true;
}
function classify(data, hintPath) {
  var _a, _b;
  if (data.length === 0) return EMPTY();
  const b0 = data[0];
  const b1 = data[1];
  if (b0 === 137 && b1 === 80 && data[2] === 78 && data[3] === 71) {
    const animated = hasBytes(data, 512, 97, 99, 84, 76);
    return { category: "image", mime: "image/png", ext: "png", animated, isSvg: false };
  }
  if (b0 === 255 && b1 === 216 && data[2] === 255) {
    return { category: "image", mime: "image/jpeg", ext: "jpg", animated: false, isSvg: false };
  }
  if (b0 === 71 && b1 === 73 && data[2] === 70 && data[3] === 56) {
    let animated = false;
    let offset = 13;
    if (data.length > offset) {
      const gctFlags = data[10];
      const gctSize = (gctFlags & 7) > 0 ? 1 << (gctFlags & 7) + 1 : 0;
      offset += gctSize * 3;
      let seenOne = false;
      while (offset + 1 < data.length) {
        const marker = data[offset];
        if (marker === 59) break;
        if (marker === 33) {
          const label = data[offset + 1];
          if (label === 249) {
            if (seenOne) {
              animated = true;
              break;
            }
            seenOne = true;
          }
          offset += 2;
          while (offset < data.length) {
            const sz = data[offset];
            offset++;
            if (sz === 0) break;
            offset += sz;
          }
        } else if (marker === 44) {
          offset += 10;
          if (offset < data.length) {
            const lctSize = data[offset - 3] & 7;
            offset += (lctSize > 0 ? 1 << lctSize + 1 : 0) * 3;
          }
          offset += 1;
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
    return { category: "image", mime: "image/gif", ext: "gif", animated, isSvg: false };
  }
  if (b0 === 66 && b1 === 77) {
    return { category: "image", mime: "image/bmp", ext: "bmp", animated: false, isSvg: false };
  }
  if (b0 === 82 && b1 === 73 && data[2] === 70 && data[3] === 70 && data[8] === 87 && data[9] === 69 && data[10] === 66 && data[11] === 80) {
    let animated = false;
    if (data.length >= 30 && data[12] === 86 && data[13] === 80 && data[14] === 56 && data[15] === 88) {
      if ((data[20] & 2) === 2) animated = true;
    }
    return { category: "image", mime: "image/webp", ext: "webp", animated, isSvg: false };
  }
  if (data.length >= 12 && b0 === 0 && b1 === 0 && data[2] === 0 && data[4] === 102 && data[5] === 116 && data[6] === 121 && data[7] === 112) {
    const brand = String.fromCharCode(data[8], data[9], data[10], data[11]).toLowerCase();
    if (brand.startsWith("av")) {
      return { category: "image", mime: "image/avif", ext: "avif", animated: false, isSvg: false };
    }
    return { category: "video", mime: "video/mp4", ext: "mp4", animated: false, isSvg: false };
  }
  if (b0 === 60 && b1 === 63 && data[2] === 120 || b0 === 60 && b1 === 115) {
    return { category: "image", mime: "image/svg+xml", ext: "svg", animated: false, isSvg: true };
  }
  if (b0 === 37 && b1 === 80 && data[2] === 68 && data[3] === 70) {
    return { category: "pdf", mime: "application/pdf", ext: "pdf", animated: false, isSvg: false };
  }
  if (b0 === 26 && b1 === 69 && data[2] === 223 && data[3] === 163) {
    return { category: "video", mime: "video/webm", ext: "webm", animated: false, isSvg: false };
  }
  if (b0 === 73 && b1 === 68 && data[2] === 51) {
    return { category: "audio", mime: "audio/mpeg", ext: "mp3", animated: false, isSvg: false };
  }
  if (b0 === 102 && b1 === 76 && data[2] === 97 && data[3] === 67) {
    return { category: "audio", mime: "audio/flac", ext: "flac", animated: false, isSvg: false };
  }
  if (b0 === 82 && b1 === 73 && data[2] === 70 && data[3] === 70) {
    return { category: "audio", mime: "audio/wav", ext: "wav", animated: false, isSvg: false };
  }
  if (b0 === 79 && b1 === 103 && data[2] === 103 && data[3] === 83) {
    return { category: "audio", mime: "audio/ogg", ext: "ogg", animated: false, isSvg: false };
  }
  if (b0 === 80 && b1 === 75 && (data[2] === 3 || data[2] === 5 || data[2] === 7)) {
    const inner = zipFirstEntry(data);
    if (inner === "word/") return { category: "document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx", animated: false, isSvg: false };
    if (inner === "xl/") return { category: "document", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx", animated: false, isSvg: false };
    if (inner === "ppt/") return { category: "document", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: "pptx", animated: false, isSvg: false };
    return { category: "misc", mime: "application/zip", ext: "zip", animated: false, isSvg: false };
  }
  if (b0 === 60 && b1 === 33) {
    return { category: "webpage", mime: "text/html", ext: "html", animated: false, isSvg: false };
  }
  if (isAsciiPrintable(data, 0, Math.min(data.length, 512))) {
    const head = String.fromCharCode(...data.slice(0, Math.min(512, data.length))).toLowerCase();
    if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.includes("<body")) {
      return { category: "webpage", mime: "text/html", ext: "html", animated: false, isSvg: false };
    }
    return { category: "document", mime: "text/plain", ext: "txt", animated: false, isSvg: false };
  }
  if (hintPath) {
    const hintExt = (_b = (_a = hintPath.split(".").pop()) == null ? void 0 : _a.toLowerCase()) != null ? _b : "";
    if (hintExt && hintExt.length <= 10 && /^[a-z0-9]+$/.test(hintExt)) {
      const r = EMPTY();
      r.ext = hintExt;
      return r;
    }
  }
  return EMPTY();
}
function zipFirstEntry(data) {
  const window2 = data.subarray(0, Math.min(data.length, 4096));
  const head = Array.from(window2).map((b) => String.fromCharCode(b)).join("");
  if (head.includes("word/")) return "word/";
  if (head.includes("xl/")) return "xl/";
  if (head.includes("ppt/")) return "ppt/";
  return "";
}
function hasBytes(data, limit, ...pattern) {
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

// src/core/path-compatibility.ts
var WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
var DEFAULT_PROFILE = {
  platforms: ["windows", "mac", "linux"],
  maxBytes: 255,
  maxUnits: 255,
  windows: true
};
function repairName(basename, extension, profile = DEFAULT_PROFILE) {
  let name = basename;
  name = name.replace(/[. ]+$/g, "");
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  if (profile.windows) {
    if (WINDOWS_RESERVED.test(name)) {
      name = name + "_";
    }
  }
  if (profile.maxBytes) {
    name = cutByCodepoints(name, profile.maxBytes);
  }
  if (profile.maxUnits) {
    name = cutByUnits(name, profile.maxUnits);
  }
  if (name.length === 0) {
    name = "attachment";
  }
  return extension && extension.length > 0 ? `${name}.${extension}` : name;
}
function byteLength(s) {
  return new TextEncoder().encode(s).length;
}
function cutByCodepoints(s, maxBytes) {
  let out = "";
  for (const ch of s) {
    const candidate = out + ch;
    if (byteLength(candidate) > maxBytes) break;
    out = candidate;
  }
  return out;
}
function cutByUnits(s, maxUnits) {
  return Array.from(s).slice(0, maxUnits).join("");
}
function normalizeLocal(path) {
  const segs = path.replace(/\\/g, "/").split("/");
  const out = [];
  for (const s of segs) {
    if (s === "" || s === ".") continue;
    if (s === "..") {
      out.pop();
      continue;
    }
    out.push(s);
  }
  return out.join("/");
}
function resolveAttachmentDir(parent, setting) {
  const f = setting.trim();
  if (!f || f === "/" || f === ".") return normalizeLocal(parent);
  if (f.startsWith("./")) return normalizeLocal(`${parent}/${f.slice(2)}`);
  if (f.startsWith("/")) return normalizeLocal(f.slice(1));
  return normalizeLocal(f);
}
function isNoteRelativeFolder(setting) {
  const f = setting.trim();
  return f === "" || f === "." || f === "./" || f.startsWith("./");
}
function renderAttachmentFolderTemplate(template, noteName, parentPath, now = /* @__PURE__ */ new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const datePart = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const i = parentPath.lastIndexOf("/");
  const parentBase = parentPath === "" ? "" : i >= 0 ? parentPath.slice(i + 1) : parentPath;
  return template.replace(/\$\{notename\}/g, noteName).replace(/\$\{parent\}/g, parentBase).replace(/\$\{parentpath\}/g, parentPath).replace(/\$\{date\}/g, datePart);
}
function isPathExcluded(path, excludes) {
  if (!excludes || excludes.length === 0) return false;
  const norm = path.replace(/^\/+|\/+$/g, "");
  for (const raw of excludes) {
    const e2 = raw.trim().replace(/\/+$/, "");
    if (!e2) continue;
    if (norm === e2 || norm.startsWith(`${e2}/`)) return true;
  }
  return false;
}

// src/core/link-resolver.ts
var MD_LINK = /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;
var WIKI_LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
function detectTransclusion(type, linkText) {
  if (type === "wiki" && linkText.includes("#")) return "wikiTransclusion";
  if (type === "markdown" && linkText.includes("#")) return "mdTransclusion";
  return type;
}
function listMatches(text) {
  const out = [];
  for (const m of text.matchAll(MD_LINK)) {
    const raw = m[0];
    const linkText = m[2];
    out.push({
      type: detectTransclusion("markdown", linkText),
      raw,
      linkText
    });
  }
  for (const m of text.matchAll(WIKI_LINK)) {
    const raw = m[0];
    const linkText = m[1].trim();
    out.push({
      type: detectTransclusion("wiki", linkText),
      raw,
      linkText
    });
  }
  return out;
}
function rewrite(text, mapping) {
  if (mapping.size === 0) return text;
  let result = text;
  for (const idx of listMatches(text)) {
    const mapped = mapping.get(idx.linkText);
    if (mapped === void 0) continue;
    result = replaceTargetInRaw(result, idx, mapped);
  }
  return result;
}
function replaceTargetInRaw(text, match, newTarget) {
  const raw = match.raw;
  let replaced;
  if (match.type === "markdown" || match.type === "mdTransclusion") {
    replaced = raw.replace(/\([^)\s]+\)/, `(${newTarget})`);
  } else {
    const body = raw.slice(2, -2);
    const pipeIdx = body.indexOf("|");
    const hashIdx = body.indexOf("#");
    const anchor = hashIdx >= 0 ? body.slice(hashIdx, pipeIdx > hashIdx ? pipeIdx : void 0) : "";
    const alias = pipeIdx >= 0 ? body.slice(pipeIdx) : "";
    replaced = `[[${newTarget}${anchor}${alias}]]`;
  }
  return text.replace(raw, replaced);
}
function sanitizeFilename(name) {
  if (name.includes("/") || name.includes("\\")) return "";
  if (name === "." || name === "..") return "";
  if (/^\./.test(name)) return "";
  let cleaned = name.replace(/[*:"?<>|]/g, "_");
  cleaned = cleaned.replace(/\s+$/g, "");
  return cleaned;
}
var FM_RESOURCE_TOKEN = /["']?[A-Za-z0-9_.\-\/]+\.(?:png|jpe?g|gif|webp|bmp|avif|svg|mp4|mov|webm|mkv|mp3|wav|ogg|m4a|flac|pdf|docx|xlsx|pptx)["']?/gi;
function rewriteFrontmatter(text, mapping) {
  if (mapping.size === 0) return text;
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (!fm) return text;
  const block = fm[1];
  const next = block.replace(FM_RESOURCE_TOKEN, (tok) => {
    const clean = tok.trim().replace(/^["']+|["']+$/g, "");
    const mapped = mapping.get(clean);
    if (mapped === void 0) return tok;
    if (tok.startsWith('"') && tok.endsWith('"')) return `"${mapped}"`;
    if (tok.startsWith("'") && tok.endsWith("'")) return `'${mapped}'`;
    return mapped;
  });
  if (next === block) return text;
  return text.replace(block, next);
}

// src/core/types.ts
var IMAGE_EXTENSIONS = /* @__PURE__ */ new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "avif",
  "svg"
]);
var VIDEO_EXTENSIONS = /* @__PURE__ */ new Set(["mp4", "mov", "webm", "mkv"]);
var AUDIO_EXTENSIONS = /* @__PURE__ */ new Set(["mp3", "wav", "ogg", "m4a", "flac"]);
var OTHER_ATTACHMENT_EXTENSIONS = /* @__PURE__ */ new Set(["pdf", "docx", "xlsx", "pptx"]);
function isManagedAttachment(ext) {
  const e2 = ext.toLowerCase();
  return IMAGE_EXTENSIONS.has(e2) || VIDEO_EXTENSIONS.has(e2) || AUDIO_EXTENSIONS.has(e2) || OTHER_ATTACHMENT_EXTENSIONS.has(e2);
}
function extOf(path) {
  const idx = path.lastIndexOf(".");
  if (idx < 0) return "";
  return path.slice(idx + 1).toLowerCase();
}
function isNoteText(path) {
  return path.endsWith(".md") || path.endsWith(".canvas");
}

// src/core/task-queue.ts
var TaskQueue = class {
  constructor() {
    this.chain = Promise.resolve();
    this.pending = 0;
  }
  /** 追加一个任务到队尾串行执行。 */
  enqueue(task) {
    this.pending++;
    const run = this.chain.then(task);
    this.chain = run.catch(() => void 0).finally(() => {
      this.pending--;
    });
    return run;
  }
  /** 队列是否空闲（无在途任务）。 */
  isProcessing() {
    return this.pending > 0;
  }
  /** 等待当前队列清空。 */
  async drain() {
    await this.chain;
  }
};

// src/core/attachment-index.ts
function scanNoteText(text) {
  const embedRegex = /!\[\[([^\]|#]+)(?:#[^\]|]*)?\]\]|!\[[^\]]*\]\(([^)\s]+)\)/g;
  const targets = /* @__PURE__ */ new Map();
  const broken = [];
  for (const m of text.matchAll(embedRegex)) {
    const target = m[1] || m[2] || "";
    if (!target) continue;
    if (/^(https?:|data:)/.test(target)) continue;
    targets.set(target, "embed");
  }
  return { targets, broken };
}
function scanUnresolvedBreaks(text, sourcePath, fileSet, basenameSet) {
  const out = [];
  for (const m of listMatches(text)) {
    const t = m.linkText;
    if (/^(https?:|data:)/.test(t)) continue;
    if (t.endsWith(".md") || t.endsWith(".canvas")) continue;
    if (extOf(t) === "") continue;
    if (fileSet.has(t)) continue;
    const base = t.slice(t.lastIndexOf("/") + 1);
    if (basenameSet.has(base)) continue;
    out.push({ sourcePath, kind: "link", raw: m.raw, linkText: t });
  }
  return out;
}
function dedupeBroken(refs) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const r of refs) {
    const key = `${r.sourcePath}\0${r.linkText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
function managedBasenamesFromFrontmatter(text) {
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (!fm) return [];
  const tokenRe = /[A-Za-z0-9_.\-/]+\.(?:png|jpe?g|gif|webp|bmp|avif|svg|mp4|mov|webm|mkv|mp3|wav|ogg|m4a|flac|pdf|docx|xlsx|pptx)/gi;
  const out = /* @__PURE__ */ new Set();
  for (const m of fm[1].matchAll(tokenRe)) {
    const t = m[0];
    if (extOf(t) === "svg" && /^(https?:\/\/)/i.test(t)) continue;
    if (!/^(https?:|data:)/i.test(t)) out.add(basenameOf(t));
  }
  return Array.from(out);
}
function canvasFileRefs(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    if (!Array.isArray(data.nodes)) return [];
    const out = [];
    for (const n of data.nodes) {
      if (n && n.type === "file" && typeof n.file === "string" && n.file) out.push(n.file);
    }
    return out;
  } catch (e2) {
    return [];
  }
}
function frontmatterBrokenRefs(text) {
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (!fm) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const unquote = (s) => s.trim().replace(/^["']+|["']+$/g, "");
  const add = (raw, candidate) => {
    const t = unquote(candidate);
    if (!t) return;
    if (/^(https?:|\/\/|data:|!\[|#)/i.test(t)) return;
    if (!isManagedAttachment(extOf(t.split("?")[0]))) return;
    if (seen.has(raw)) return;
    seen.add(raw);
    out.push({ raw, linkText: t });
  };
  let lastKey = "";
  for (const line of fm[1].split("\n")) {
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem) {
      if (lastKey) add(`${lastKey}: ${listItem[1]}`, listItem[1]);
      continue;
    }
    const kv = line.match(/^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (kv) {
      lastKey = kv[1];
      const v = kv[2].trim();
      if (!v) continue;
      if (v.startsWith("[") && v.endsWith("]")) {
        for (const item of v.slice(1, -1).split(",")) add(`${lastKey}: ${item}`, item);
      } else {
        add(`${lastKey}: ${v}`, v);
      }
    } else {
      lastKey = "";
    }
  }
  return out;
}
var AttachmentIndex = class {
  constructor(vault, meta) {
    this.vault = vault;
    this.meta = meta;
    this.snapshot = null;
    this.dirty = true;
  }
  /** 触发一次性重建。 */
  markDirty() {
    this.dirty = true;
  }
  /** 惰性取快照：若已 dirty 则重建。 */
  async getSnapshot() {
    if (!this.snapshot || this.dirty) {
      this.snapshot = await this.build();
      this.dirty = false;
    }
    return this.snapshot;
  }
  /** 重建完整快照。 */
  async build() {
    var _a, _b, _c, _d;
    const files = await this.vault.listFiles();
    const fileSet = new Set(files);
    const basenameSet = /* @__PURE__ */ new Set();
    for (const f of files) {
      const i = f.lastIndexOf("/");
      basenameSet.add(i >= 0 ? f.slice(i + 1) : f);
    }
    const noteFiles = files.filter(isNoteText);
    const resolved = this.meta.getResolvedLinks();
    const usedTargets = /* @__PURE__ */ new Map();
    const brokenRefs = [];
    const embedTargets = /* @__PURE__ */ new Set();
    const usedByBasename = /* @__PURE__ */ new Map();
    for (const note of noteFiles) {
      const text = await this.meta.getFileText(note);
      const scan = scanNoteText(text);
      for (const [t] of scan.targets) embedTargets.add(t);
      if (scan.broken.length) brokenRefs.push(...scan.broken);
      brokenRefs.push(...scanUnresolvedBreaks(text, note, fileSet, basenameSet));
      for (const m of listMatches(text)) {
        if (/^(https?:|data:)/.test(m.linkText)) continue;
        if (m.linkText.endsWith(".md") || m.linkText.endsWith(".canvas")) continue;
        if (!isManagedAttachment(extOf(m.linkText))) continue;
        const base = basenameOf(m.linkText);
        let notes = usedByBasename.get(base);
        if (!notes) {
          notes = /* @__PURE__ */ new Set();
          usedByBasename.set(base, notes);
        }
        notes.add(note);
      }
      for (const base of managedBasenamesFromFrontmatter(text)) {
        let notes = usedByBasename.get(base);
        if (!notes) {
          notes = /* @__PURE__ */ new Set();
          usedByBasename.set(base, notes);
        }
        notes.add(note);
      }
      if (note.endsWith(".canvas")) {
        for (const target of canvasFileRefs(text)) {
          if (/^(https?:|data:)/.test(target)) continue;
          const base = basenameOf(target);
          let notes = usedByBasename.get(base);
          if (!notes) {
            notes = /* @__PURE__ */ new Set();
            usedByBasename.set(base, notes);
          }
          notes.add(note);
          if (!fileSet.has(target) && !basenameSet.has(base)) {
            brokenRefs.push({ sourcePath: note, kind: "canvas", raw: target, linkText: target });
          }
        }
      }
      for (const f of frontmatterBrokenRefs(text)) {
        if (fileSet.has(f.linkText)) continue;
        if (basenameSet.has(basenameOf(f.linkText))) continue;
        brokenRefs.push({ sourcePath: note, kind: "frontmatter", raw: f.raw, linkText: f.linkText });
      }
      const noteLinks = (_a = resolved[note]) != null ? _a : {};
      for (const [target] of Object.entries(noteLinks)) {
        if (target.endsWith(".md")) continue;
        if (!fileSet.has(target)) {
          brokenRefs.push({ sourcePath: note, kind: linkOrEmbed(target, embedTargets), raw: target, linkText: target });
          continue;
        }
        const refs = (_b = usedTargets.get(target)) != null ? _b : [];
        refs.push({
          sourcePath: note,
          kind: linkOrEmbed(target, embedTargets),
          raw: target,
          linkText: target,
          status: "resolved"
        });
        usedTargets.set(target, refs);
      }
    }
    const broken = dedupeBroken(brokenRefs);
    const baseCount = /* @__PURE__ */ new Map();
    for (const f of files) {
      if (!isManagedAttachment(extOf(f))) continue;
      const b = basenameOf(f);
      baseCount.set(b, ((_c = baseCount.get(b)) != null ? _c : 0) + 1);
    }
    const entries = /* @__PURE__ */ new Map();
    const orphanCandidates = [];
    for (const f of files) {
      if (!isManagedAttachment(extOf(f))) continue;
      const base = basenameOf(f);
      let references = (_d = usedTargets.get(f)) != null ? _d : [];
      if (references.length === 0 && baseCount.get(base) === 1) {
        const srcs = usedByBasename.get(base);
        if (srcs) {
          references = Array.from(srcs).map((sourcePath) => ({
            sourcePath,
            kind: "embed",
            raw: base,
            linkText: f,
            status: "resolved"
          }));
        }
      }
      entries.set(f, { path: f, category: categoryFromExt(extOf(f)), mime: "", animated: false, size: 0, mtime: 0, references });
      if (references.length === 0 && !usedByBasename.has(base)) orphanCandidates.push(f);
    }
    return { entries, brokenRefs: broken, orphanCandidates };
  }
  /** 单条附件概览（供命名/审计快速取用）。 */
  async getEntry(path) {
    const snap = await this.getSnapshot();
    return snap.entries.get(path);
  }
};
function linkOrEmbed(target, embedTargets) {
  return embedTargets.has(target) ? "embed" : "link";
}
function basenameOf(path) {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}
function categoryFromExt(ext) {
  switch (ext) {
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "bmp":
    case "avif":
    case "svg":
      return "image";
    case "mp4":
    case "mov":
    case "webm":
    case "mkv":
      return "video";
    case "mp3":
    case "wav":
    case "ogg":
    case "m4a":
    case "flac":
      return "audio";
    case "pdf":
      return "pdf";
    case "docx":
    case "xlsx":
    case "pptx":
      return "document";
    default:
      return "misc";
  }
}

// src/core/safe-move-engine.ts
var RENAME_ATTEMPTS = 3;
var RENAME_BACKOFF_MS = 150;
async function delay(ms) {
  await new Promise((r) => setTimeout(r, ms));
}
var SafeMoveEngine = class {
  constructor(ops) {
    this.ops = ops;
  }
  /**
   * 将单个文件移动到目标路径；目标占用则自动避让。
   * @returns 实际落盘路径（可能带避让编号）。
   */
  async move(fromPath, toPath) {
    const target = await this.resolveNoConflict(toPath);
    let lastErr;
    for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt++) {
      try {
        await this.ops.rename(fromPath, target);
        return { from: fromPath, to: target, conflict: target !== toPath };
      } catch (e2) {
        lastErr = e2;
        if (attempt < RENAME_ATTEMPTS - 1) await delay(RENAME_BACKOFF_MS * (attempt + 1));
      }
    }
    throw new Error(`\u6539\u540D\u5931\u8D25 ${fromPath} \u2192 ${target}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }
  /** 批量移动：逐项执行，单项失败记入 errors 并继续。 */
  async moveMany(moves) {
    const results = [];
    const errors = [];
    for (const m of moves) {
      try {
        results.push(await this.move(m.from, m.to));
      } catch (e2) {
        errors.push({
          from: m.from,
          to: m.to,
          message: e2 instanceof Error ? e2.message : String(e2)
        });
      }
    }
    return { results, errors };
  }
  /** 若目标已存在，在扩展名前追加 `(N)` 返回不冲突路径。 */
  async resolveNoConflict(toPath) {
    if (!await this.ops.exists(toPath)) return toPath;
    const dot = toPath.lastIndexOf(".");
    const slash = toPath.lastIndexOf("/");
    if (dot <= slash) {
      let i2 = 1;
      let candidate2 = `${toPath} (${i2})`;
      while (await this.ops.exists(candidate2)) {
        i2++;
        candidate2 = `${toPath} (${i2})`;
      }
      return candidate2;
    }
    const stem = toPath.slice(0, dot);
    const ext = toPath.slice(dot);
    let i = 1;
    let candidate = `${stem} (${i})${ext}`;
    while (await this.ops.exists(candidate)) {
      i++;
      candidate = `${stem} (${i})${ext}`;
    }
    return candidate;
  }
};

// src/core/zip.ts
var CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data) {
  let c = 4294967295;
  for (let i = 0; i < data.length; i++) c = CRC32_TABLE[(c ^ data[i]) & 255] ^ c >>> 8;
  return (c ^ 4294967295) >>> 0;
}
function dosDateTime(d) {
  const time = d.getHours() << 11 | d.getMinutes() << 5 | d.getSeconds() >> 1;
  const date = d.getFullYear() - 1980 << 9 | d.getMonth() + 1 << 5 | d.getDate();
  return { time, date };
}
function concat(parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function createZip(files, date = /* @__PURE__ */ new Date()) {
  const { time, date: ddate } = dosDateTime(date);
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = new TextEncoder().encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 67324752, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0, true);
    lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true);
    lh.setUint16(12, ddate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    localParts.push(new Uint8Array(lh.buffer), nameBytes, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 33639248, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, ddate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    centralParts.push(new Uint8Array(ch.buffer), nameBytes);
    offset += 30 + nameBytes.length + size;
  }
  const cd = concat(centralParts);
  const cdOffset = offset;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 101010256, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cd.length, true);
  eocd.setUint32(16, cdOffset, true);
  eocd.setUint16(20, 0, true);
  return concat([...localParts, cd, new Uint8Array(eocd.buffer)]);
}

// src/obsidian-domain.ts
var import_obsidian = require("obsidian");
async function ensureFolder(app, dir) {
  if (!dir) return;
  if (app.vault.getAbstractFileByPath(dir) instanceof import_obsidian.TFolder) return;
  const parts = dir.split("/").filter(Boolean);
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    if (app.vault.getAbstractFileByPath(acc) instanceof import_obsidian.TFolder) continue;
    try {
      await app.vault.createFolder(acc);
    } catch (e2) {
      if (!(app.vault.getAbstractFileByPath(acc) instanceof import_obsidian.TFolder)) {
        throw new Error(`\u521B\u5EFA\u76EE\u5F55\u5931\u8D25\uFF1A${acc}`);
      }
    }
  }
}
function effectiveAttachmentFolder(app, settings) {
  var _a, _b;
  if (settings.attachmentFolderMode === "custom") return settings.attachmentFolder;
  const cfg = (_b = (_a = app.vault).getConfig) == null ? void 0 : _b.call(_a, "attachmentFolderPath");
  return typeof cfg === "string" && cfg !== "" ? cfg : settings.attachmentFolder;
}
function resolveAttachmentDirForNote(app, settings, note) {
  var _a, _b, _c, _d;
  const folder = effectiveAttachmentFolder(app, settings);
  const rendered = renderAttachmentFolderTemplate(folder, note.basename, (_b = (_a = note.parent) == null ? void 0 : _a.path) != null ? _b : "", /* @__PURE__ */ new Date());
  return resolveAttachmentDir((_d = (_c = note.parent) == null ? void 0 : _c.path) != null ? _d : "", rendered);
}
var ObsidianVaultAdapter = class {
  constructor(app) {
    this.app = app;
  }
  async exists(path) {
    return this.app.vault.adapter.exists(path);
  }
  async read(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof import_obsidian.TFile) {
      return this.app.vault.readBinary(f);
    }
    throw new Error(`Not a file: ${path}`);
  }
  async readHead(path, maxBytes) {
    const buf = await this.read(path);
    return new Uint8Array(buf).subarray(0, maxBytes);
  }
  async listFiles() {
    return this.app.vault.getFiles().map((f) => f.path);
  }
};
var ObsidianMetadataProvider = class {
  constructor(app) {
    this.app = app;
  }
  getResolvedLinks() {
    return this.app.metadataCache.resolvedLinks;
  }
  async getFileText(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof import_obsidian.TFile) {
      return this.app.vault.cachedRead(f);
    }
    return "";
  }
};
var ObsidianFileOps = class {
  constructor(app) {
    this.app = app;
  }
  async exists(path) {
    return this.app.vault.adapter.exists(path);
  }
  async rename(fromPath, toPath) {
    const f = this.app.vault.getAbstractFileByPath(fromPath);
    if (f instanceof import_obsidian.TFile) {
      await this.app.fileManager.renameFile(f, toPath);
      return;
    }
    throw new Error(`Not a file: ${fromPath}`);
  }
};

// src/settings.ts
var SCHEMA_VERSION = 1;
var DEFAULT_SETTINGS = {
  version: SCHEMA_VERSION,
  attachmentFolder: "./assets",
  attachmentFolderMode: "obsidian",
  naming: {
    enabled: true,
    connector: "_",
    addTime: false,
    addPathHash: false,
    honorCategory: true,
    showSubType: false,
    folderByCategory: false,
    categoryWords: {
      image: "image",
      video: "video",
      audio: "audio",
      pdf: "pdf",
      document: "document",
      webpage: "webpage",
      misc: "misc"
    }
  },
  localize: {
    enabled: true,
    desktopOnly: true,
    localizeWebUrls: true,
    allowedCategories: ["image", "video", "audio", "pdf", "document", "webpage", "misc"],
    scanHtmlAndLinks: false,
    useMd5ForNew: true,
    minSizeKb: 0,
    tryCount: 3,
    timeoutMs: 3e4
  },
  consistency: {
    enabled: true,
    reportBrokenLinks: true,
    repairIncompatiblePaths: true,
    platforms: ["windows", "mac", "linux"],
    followNoteMove: false
  },
  cleanup: {
    enabled: true,
    deleteMode: ".trash",
    excludedFolders: [],
    excludeSubfolders: false,
    requireConfirm: true
  },
  exporter: {
    enabled: false
  },
  automation: {
    enabled: true,
    interval: 5
  },
  paths: {
    exclude: []
  },
  notificationLevel: "summary"
};

// src/settings-migration.ts
function migrateSettings(raw) {
  const original = isRecord(raw) ? raw : {};
  let data = original ? { ...original } : {};
  if (typeof original.attachmentFolderMode === "undefined" && typeof original.attachmentFolder === "string" && original.attachmentFolder !== DEFAULT_SETTINGS.attachmentFolder) {
    data = { ...data, attachmentFolderMode: "custom" };
  }
  let fromVersion = typeof data.version === "number" ? data.version : 0;
  while (fromVersion < SCHEMA_VERSION) {
    data = migrateOneStep(data, fromVersion);
    fromVersion++;
  }
  const merged = deepMerge(
    DEFAULT_SETTINGS,
    normalizeFields(data)
  );
  return merged;
}
function migrateOneStep(s, from) {
  if (from === 0) {
    const out = { ...s };
    out.naming = {
      ...isRecord(s.naming) ? s.naming : {},
      ...typeof s.enableAuto === "boolean" ? { enabled: s.enableAuto } : {},
      ...typeof s.connector === "string" ? { connector: s.connector } : {}
    };
    out.localize = {
      ...isRecord(s.localize) ? s.localize : {},
      ...typeof s.useMd5ForNew === "boolean" ? { useMd5ForNew: s.useMd5ForNew } : {},
      ...typeof s.minSizeKb === "number" ? { minSizeKb: s.minSizeKb } : {}
    };
    out.cleanup = {
      ...isRecord(s.cleanup) ? s.cleanup : {},
      ...typeof s.deleteMode === "string" ? { deleteMode: s.deleteMode } : {}
    };
    return out;
  }
  return s;
}
function normalizeFields(s) {
  const known = [
    "version",
    "attachmentFolder",
    "attachmentFolderMode",
    "naming",
    "localize",
    "consistency",
    "cleanup",
    "exporter",
    "automation",
    "paths",
    "notificationLevel"
  ];
  const out = { version: SCHEMA_VERSION };
  for (const k of known) {
    if (k === "version") continue;
    const v = s[k];
    if (v !== void 0) out[k] = v;
  }
  return out;
}
function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && out[k] !== null && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
function isRecord(v) {
  return v !== null && typeof v === "object";
}

// src/logger.ts
var PREFIX = "[IAP]";
var minLevel = "info";
var sink = defaultSink;
function defaultSink(level, msg) {
  var _a;
  const fn = (_a = console[level === "trace" ? "log" : level]) != null ? _a : console.log;
  fn.call(console, `${PREFIX} ${msg}`);
}
var ORDER = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };
function emit(level, msg) {
  if (ORDER[level] < ORDER[minLevel]) return;
  sink(level, msg);
}
var logger = {
  trace: (msg) => emit("trace", msg),
  debug: (msg) => emit("debug", msg),
  info: (msg) => emit("info", msg),
  warn: (msg) => emit("warn", msg),
  error: (msg) => emit("error", msg)
};

// src/settings-tab.ts
var import_obsidian2 = require("obsidian");
var CATEGORY_OPTIONS = [
  { value: "image", label: "\u56FE\u7247" },
  { value: "video", label: "\u89C6\u9891" },
  { value: "audio", label: "\u97F3\u9891" },
  { value: "pdf", label: "PDF" },
  { value: "document", label: "\u6587\u6863" },
  { value: "webpage", label: "\u7F51\u9875" },
  { value: "misc", label: "\u5176\u4ED6" }
];
var AttachmentSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  get s() {
    return this.plugin.settings;
  }
  save() {
    void this.plugin.saveSettings();
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "\u901A\u7528" });
    new import_obsidian2.Setting(containerEl).setName("\u9644\u4EF6\u76EE\u5F55\u6765\u6E90").setDesc(
      "\u8DDF\u968F Obsidian \u8BBE\u7F6E\uFF1A\u91C7\u7528 Obsidian\u300C\u6587\u4EF6\u4E0E\u94FE\u63A5 \u2192 \u9ED8\u8BA4\u9644\u4EF6\u6587\u4EF6\u5939\u300D\u91CC\u7684\u4F4D\u7F6E\uFF0C\u4E0E\u672C\u63D2\u4EF6\u4FDD\u6301\u4E00\u81F4\uFF08\u63A8\u8350\uFF09\u3002\u81EA\u5B9A\u4E49\uFF1A\u4F7F\u7528\u4E0B\u65B9\u586B\u5199\u7684\u76EE\u5F55\uFF0C\u53EF\u8986\u76D6 Obsidian \u7684\u9ED8\u8BA4\u4F4D\u7F6E\u3002"
    ).addDropdown(
      (d) => d.addOption("obsidian", "\u8DDF\u968F Obsidian \u8BBE\u7F6E").addOption("custom", "\u81EA\u5B9A\u4E49\u76EE\u5F55").setValue(this.s.attachmentFolderMode).onChange((v) => {
        this.s.attachmentFolderMode = v;
        this.save();
        this.display();
      })
    );
    if (this.s.attachmentFolderMode === "custom") {
      new import_obsidian2.Setting(containerEl).setName("\u81EA\u5B9A\u4E49\u9644\u4EF6\u76EE\u5F55").setDesc(
        "\u9644\u4EF6\u5B58\u653E\u76EE\u5F55\u3002\u63A8\u8350\u7528 ./assets \u6216 ./attachments\uFF0C\u8868\u793A\u5B58\u653E\u5728\u7B14\u8BB0\u6240\u5728\u76EE\u5F55\u4E0B\u7684\u540C\u540D\u6587\u4EF6\u5939\uFF0C\u8FD9\u6837\u79FB\u52A8\u7B14\u8BB0\u65F6\u66F4\u6613\u8DDF\u968F\uFF1B\u4E5F\u53EF\u4EE5\u7528 . \u8868\u793A\u7D27\u90BB\u7B14\u8BB0\uFF0C\u6216\u7528 assets \u8868\u793A\u5E93\u6839\u4E0B\u7684 assets\u3002\u652F\u6301 ${notename}\u3001${parent}\u3001${date} \u7B49\u6A21\u677F\u53D8\u91CF\u3002\u547D\u540D\u3001\u672C\u5730\u5316\u3001\u7B14\u8BB0\u79FB\u52A8\u8DDF\u968F\u90FD\u4F1A\u4EE5\u8FD9\u91CC\u4E3A\u51C6\u3002"
      ).addText(
        (t) => t.setPlaceholder("./assets \u6216 ./attachments").setValue(this.s.attachmentFolder).onChange((v) => {
          this.s.attachmentFolder = v;
          this.save();
        })
      );
    }
    new import_obsidian2.Setting(containerEl).setName("\u901A\u77E5\u7EA7\u522B").setDesc(
      "\u51B3\u5B9A\u64CD\u4F5C\u5B8C\u6210\u540E\u63D0\u793A\u7684\u8BE6\u7EC6\u7A0B\u5EA6\u3002\u9759\u9ED8\uFF1A\u53EA\u51FA\u9519\u65F6\u63D0\u793A\uFF1B\u4EC5\u6458\u8981\uFF1A\u663E\u793A\u6210\u529F\u3001\u5931\u8D25\u3001\u8DF3\u8FC7\u4E09\u9879\u6C47\u603B\uFF08\u63A8\u8350\uFF09\uFF1B\u8BE6\u7EC6\uFF1A\u663E\u793A\u66F4\u591A\u8FC7\u7A0B\u4FE1\u606F\u3002\u63D0\u793A\u6309\u7EA7\u522B\u5206\u7EA7\u505C\u7559\u65F6\u957F\uFF1A\u9519\u8BEF 5 \u79D2\u3001\u6267\u884C\u7ED3\u679C 3 \u79D2\u3001\u8FC7\u7A0B\u4FE1\u606F 2 \u79D2\uFF1B\u6D88\u606F\u8D8A\u957F\uFF08\u6362\u884C\u8D8A\u591A\uFF09\u505C\u7559\u8D8A\u4E45\uFF0C\u957F\u63D0\u793A\u4E5F\u80FD\u5B8C\u6574\u8BFB\u5B8C\u3002"
    ).addDropdown(
      (d) => d.addOption("silent", "\u9759\u9ED8").addOption("summary", "\u4EC5\u6458\u8981").addOption("verbose", "\u8BE6\u7EC6").setValue(this.s.notificationLevel).onChange((v) => {
        this.s.notificationLevel = v;
        this.save();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u5168\u5C40\u6392\u9664\u76EE\u5F55\uFF08\u9017\u53F7\u5206\u9694\uFF09").setDesc("\u8FD9\u4E9B\u76EE\u5F55\uFF08\u76F8\u5BF9\u5E93\u6839\uFF09\u4E2D\u7684\u7B14\u8BB0\u4E0D\u505A\u672C\u5730\u5316\u3001\u5176\u4E2D\u7684\u9644\u4EF6\u4E0D\u4F1A\u88AB\u5224\u4E3A\u672A\u4F7F\u7528\u800C\u6E05\u7406\uFF1B\u6E05\u7406\u672A\u7528\u9644\u4EF6\u65F6\u4E5F\u4F1A\u4E00\u5E76\u628A\u8FD9\u91CC\u7684\u76EE\u5F55\u89C6\u4E3A\u6392\u9664\uFF08\u4E0E\u300C\u6E05\u7406\u300D\u7684\u6392\u9664\u76EE\u5F55\u53E0\u52A0\u751F\u6548\uFF09\u3002\u591A\u4E2A\u76EE\u5F55\u7528\u82F1\u6587\u9017\u53F7\u5206\u9694\u3002").addText(
      (t) => {
        var _a, _b;
        return t.setValue(((_b = (_a = this.s.paths) == null ? void 0 : _a.exclude) != null ? _b : []).join(", ")).setPlaceholder("_resources, \u7B14\u8BB0\u5F52\u6863").onChange((v) => {
          this.s.paths.exclude = v.split(",").map((x) => x.trim()).filter(Boolean);
          this.save();
        });
      }
    );
    containerEl.createEl("h2", { text: "\u81EA\u52A8\u5316" });
    new import_obsidian2.Setting(containerEl).setName("\u81EA\u52A8\u5904\u7406\uFF08\u672C\u5730\u5316 + \u7EDF\u4E00\u547D\u540D\uFF09").setDesc(
      "\u5F00\u542F\u540E\uFF0C\u5F53\u4F60\u7F16\u8F91\u4E2D\u7684\u7B14\u8BB0\u51FA\u73B0\u65B0\u7684\u5916\u94FE\u56FE\u7247\u6216\u9644\u4EF6\u65F6\uFF0C\u63D2\u4EF6\u4F1A\u81EA\u52A8\u628A\u5916\u94FE\u56FE\u7247\u4E0B\u8F7D\u5230\u672C\u5730\u5E76\u7EDF\u4E00\u547D\u540D\uFF0C\u65E0\u9700\u624B\u52A8\u6267\u884C\u547D\u4EE4\u3002\u9700\u8981\u4E0B\u65B9\u300C\u672C\u5730\u5316\u300D\u5F00\u542F\u624D\u4F1A\u4E0B\u8F7D\uFF0C\u300C\u7EDF\u4E00\u547D\u540D\u300D\u662F\u5426\u6267\u884C\u7531\u4E0B\u65B9\u300C\u547D\u540D\u300D\u5F00\u5173\u51B3\u5B9A\uFF1B\u5904\u7406\u5B8C\u6210\u540E\u4F1A\u5728\u53F3\u4E0A\u89D2\u5F39\u51FA\u4E00\u6761\u7ED3\u679C\u901A\u77E5\u3002"
    ).addToggle((t) => t.setValue(this.s.automation.enabled).onChange((v) => {
      this.s.automation.enabled = v;
      this.save();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u81EA\u52A8\u5904\u7406\u5237\u65B0\u95F4\u9694\uFF08\u79D2\uFF09").setDesc("\u6BCF\u9694 N \u79D2\u626B\u63CF\u4E00\u6B21\u5F85\u5904\u7406\u7B14\u8BB0\u5E76\u6267\u884C\u672C\u5730\u5316\u4E0E\u7EDF\u4E00\u547D\u540D\u3002\u6570\u503C\u8D8A\u5C0F\u53CD\u5E94\u8D8A\u5FEB\uFF0C\u4F46\u5199\u5165\u66F4\u9891\u7E41\uFF1B\u6700\u5C0F 1\uFF0C\u9ED8\u8BA4 5\uFF0C\u65E0\u7279\u6B8A\u9700\u6C42\u5EFA\u8BAE\u4FDD\u6301\u9ED8\u8BA4\u3002").addText(
      (t) => t.setValue(String(this.s.automation.interval)).setPlaceholder("5").onChange((v) => {
        const n = Number.parseInt(v, 10);
        this.s.automation.interval = Number.isNaN(n) ? 5 : Math.max(1, n);
        this.save();
      })
    );
    containerEl.createEl("h2", { text: "\u547D\u540D" });
    new import_obsidian2.Setting(containerEl).setName("\u542F\u7528\u7EDF\u4E00\u547D\u540D").setDesc(
      "\u5F00\u542F\u540E\uFF0C\u672C\u5730\u5316\u7684\u65B0\u9644\u4EF6\u4F1A\u88AB\u81EA\u52A8\u6539\u540D\uFF0C\u4E5F\u53EF\u4EE5\u7528\u201C\u91CD\u547D\u540D\u5F53\u524D\u7B14\u8BB0\u9644\u4EF6\u201D\u547D\u4EE4\uFF0C\u628A\u9644\u4EF6\u7EDF\u4E00\u4E3A\u201C\u7B14\u8BB0\u540D-\u7C7B\u522B-\u5E8F\u53F7\u201D\u7684\u683C\u5F0F\uFF0C\u4FBF\u4E8E\u6574\u7406\u548C\u67E5\u627E\u3002\u5173\u95ED\u5219\u9644\u4EF6\u4FDD\u6301\u539F\u59CB\u6587\u4EF6\u540D\u3002\u63A8\u8350\u5F00\u542F\u3002"
    ).addToggle((t) => t.setValue(this.s.naming.enabled).onChange((v) => {
      this.s.naming.enabled = v;
      this.save();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u8FDE\u63A5\u7B26").setDesc("\u540D\u5B57\u5404\u90E8\u5206\u4E4B\u95F4\u7684\u5206\u9694\u7B26\u53F7\uFF0C\u5EFA\u8BAE\u4FDD\u6301\u9ED8\u8BA4\u4E0B\u5212\u7EBF _\u3002\u4F8B\u5982\u4E0B\u5212\u7EBF\u5F97\u5230 \u7B14\u8BB0_image_001\uFF0C\u77ED\u6A2A\u7EBF\u5F97\u5230 \u7B14\u8BB0-image-001\u3002").addText((t) => t.setValue(this.s.naming.connector).onChange((v) => {
      this.s.naming.connector = v;
      this.save();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u547D\u540D\u52A0\u5165\u65F6\u95F4").setDesc("\u5728\u5E8F\u53F7\u4E4B\u540E\u8FFD\u52A0 14 \u4F4D\u65F6\u95F4\u6233\uFF08\u5E74\u6708\u65E5\u65F6\u5206\u79D2\uFF09\uFF0C\u901A\u5E38\u65E0\u9700\u5F00\u542F\u3002\u9002\u5408\u540C\u4E00\u7B14\u8BB0\u9891\u7E41\u65B0\u589E\u591A\u4E2A\u6587\u4EF6\u3001\u60F3\u6309\u65F6\u95F4\u533A\u5206\u7684\u573A\u666F\u3002").addToggle((t) => t.setValue(this.s.naming.addTime).onChange((v) => {
      this.s.naming.addTime = v;
      this.save();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u547D\u540D\u52A0\u5165\u8DEF\u5F84\u54C8\u5E0C").setDesc("\u5728\u540D\u5B57\u672B\u5C3E\u8FFD\u52A0 8 \u4F4D\u8DEF\u5F84\u54C8\u5E0C\uFF0C\u7528\u4E8E\u533A\u5206\u6765\u81EA\u4E0D\u540C\u76EE\u5F55\u4F46\u540C\u540D\u7B14\u8BB0\u7684\u9644\u4EF6\uFF0C\u964D\u4F4E\u8DE8\u7B14\u8BB0\u540C\u540D\u51B2\u7A81\u3002\u4EC5\u5728\u4E0D\u540C\u76EE\u5F55\u5B58\u5728\u540C\u540D\u7B14\u8BB0\u3001\u6216\u7B14\u8BB0\u4F1A\u79FB\u52A8\u76EE\u5F55\u65F6\u5EFA\u8BAE\u5F00\u542F\u3002").addToggle((t) => t.setValue(this.s.naming.addPathHash).onChange((v) => {
      this.s.naming.addPathHash = v;
      this.save();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u540D\u79F0\u5E26\u7C7B\u578B\u7C7B\u522B").setDesc("\u5728\u540D\u5B57\u4E2D\u5199\u5165\u9644\u4EF6\u7C7B\u522B\uFF0C\u4E00\u773C\u5373\u53EF\u5206\u8FA8\u7C7B\u578B\uFF0C\u4F8B\u5982 image\uFF08\u56FE\u7247\uFF09\u3001video\uFF08\u89C6\u9891\uFF09\u3001pdf\uFF08\u6587\u6863\uFF09\u3002\u63A8\u8350\u5F00\u542F\u3002").addToggle((t) => t.setValue(this.s.naming.honorCategory).onChange((v) => {
      this.s.naming.honorCategory = v;
      this.save();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u989D\u5916\u5E26\u5B50\u7C7B\u578B").setDesc("\u5728\u7C7B\u522B\u4E4B\u540E\u518D\u9644\u4E0A\u5177\u4F53\u683C\u5F0F\uFF0C\u4F8B\u5982 image_png\u3001video_mp4\u3002\u4FE1\u606F\u66F4\u7EC6\u4F46\u540D\u5B57\u66F4\u957F\uFF0C\u6309\u9700\u5F00\u542F\u3002").addToggle((t) => t.setValue(this.s.naming.showSubType).onChange((v) => {
      this.s.naming.showSubType = v;
      this.save();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u6309\u7C7B\u522B\u653E\u5165\u5B50\u76EE\u5F55").setDesc("\u7EDF\u4E00\u547D\u540D\u65F6\uFF0C\u628A\u9644\u4EF6\u653E\u8FDB\u300C\u9644\u4EF6\u76EE\u5F55/\u7C7B\u578B/\u300D\u5B50\u76EE\u5F55\uFF0C\u4F8B\u5982 image/\u3001pdf/\uFF0C\u4FBF\u4E8E\u6309\u7C7B\u578B\u5F52\u6863\u3002").addToggle((t) => t.setValue(this.s.naming.folderByCategory).onChange((v) => {
      this.s.naming.folderByCategory = v;
      this.save();
    }));
    containerEl.createEl("p", {
      text: "\u547D\u540D\u7528\u8BCD\uFF1A\u5404\u7C7B\u522B\u5728\u7EDF\u4E00\u547D\u540D\u65F6\u5199\u5165\u540D\u5B57\u7684\u8BCD\u8BED\u3002\u9ED8\u8BA4\u4F7F\u7528\u82F1\u6587\uFF08image\u3001video \u7B49\uFF09\uFF1B\u53EF\u6539\u6210\u4E2D\u6587\uFF08\u56FE\u7247\u3001\u89C6\u9891\uFF09\uFF0C\u6216\u5E26\u6269\u5C55\u540D\u7684\u5F62\u5F0F\uFF08image_png\uFF09\u4EE5\u589E\u5F3A\u533A\u5206\u3002",
      cls: "iap-settings-section-hint"
    });
    for (const opt of CATEGORY_OPTIONS) {
      new import_obsidian2.Setting(containerEl).setName(`\u300C${opt.label}\u300D\u547D\u540D\u7528\u8BCD`).setDesc(`\u7EDF\u4E00\u547D\u540D\u65F6\u300C${opt.label}\u300D\u7C7B\u522B\u5199\u5165\u7684\u540D\u5B57\u7247\u6BB5\u3002\u6E05\u7A7A\u5219\u56DE\u9000\u4E3A\u9ED8\u8BA4\u82F1\u6587\u8BCD ${opt.value}\u3002`).addText(
        (t) => {
          var _a;
          return t.setPlaceholder(opt.value).setValue((_a = this.s.naming.categoryWords[opt.value]) != null ? _a : "").onChange((v) => {
            const word = v.trim();
            if (word) {
              this.s.naming.categoryWords[opt.value] = word;
            } else {
              delete this.s.naming.categoryWords[opt.value];
            }
            this.save();
          });
        }
      );
    }
    containerEl.createEl("h2", { text: "\u672C\u5730\u5316" });
    new import_obsidian2.Setting(containerEl).setName("\u542F\u7528\u5A92\u4F53\u672C\u5730\u5316").setDesc(
      "\u201C\u672C\u5730\u5316\u5F53\u524D\u7B14\u8BB0\u9644\u4EF6\u201D\u4F1A\u628A\u7B14\u8BB0\u91CC\u7684\u5916\u94FE\u56FE\u7247\u3001\u89C6\u9891\u3001\u97F3\u9891\u3001PDF\u3001\u7F51\u9875\u4E0B\u8F7D\u5230\u672C\u5730\uFF0C\u5E76\u6539\u5199\u4E3A\u672C\u5730\u5F15\u7528\uFF0C\u4FDD\u8BC1\u8131\u673A\u53EF\u7528\u3002\u5173\u95ED\u5219\u4E0D\u505A\u4E0B\u8F7D\u548C\u6539\u5199\u3002"
    ).addToggle((t) => t.setValue(this.s.localize.enabled).onChange((v) => {
      this.s.localize.enabled = v;
      this.save();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u672C\u5730\u5316\u7F51\u7EDC URL").setDesc(
      "\u662F\u5426\u771F\u7684\u4E0B\u8F7D http(s) \u7C7B\u578B\u7684\u5916\u94FE\uFF0C\u63A8\u8350\u4FDD\u6301\u5F00\u542F\u3002\u5173\u95ED\u65F6\u53EA\u5904\u7406\u7B14\u8BB0\u5185\u5D4C\u7684 data \u56FE\u7247\u3001\u4E0D\u53D1\u8D77\u4EFB\u4F55\u7F51\u7EDC\u8BF7\u6C42\u3002\u8FD9\u662F\u4E09\u6B65\u4E2D\u7684\u7B2C\u4E8C\u6B65\uFF1A\u51B3\u5B9A\u201C\u88AB\u8BA4\u51FA\u6765\u7684\u5916\u94FE\u8981\u4E0D\u8981\u771F\u6B63\u4E0B\u8F7D\u201D\uFF1B\u81F3\u4E8E\u4E0B\u8F7D\u540E\u5B58\u4E0D\u5B58\uFF0C\u7531\u6700\u540E\u4E00\u6B65\u51B3\u5B9A\u3002"
    ).addToggle((t) => t.setValue(this.s.localize.localizeWebUrls).onChange((v) => {
      this.s.localize.localizeWebUrls = v;
      this.save();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u6269\u5C55\u626B\u63CF\uFF1A\u666E\u901A\u94FE\u63A5\u4E0E HTML \u6807\u7B7E").setDesc(
      "\u51B3\u5B9A\u626B\u63CF\u7B14\u8BB0\u65F6\u201C\u8981\u4E0D\u8981\u8BA4\u51FA\u8FD9\u4E9B\u5F15\u7528\u5F62\u5F0F\u201D\u3002Markdown \u56FE\u7247\u5D4C\u5165 ![]() \u59CB\u7EC8\u4F1A\u8BA4\uFF1B\u5F00\u542F\u540E\u624D\u4F1A\u989D\u5916\u8BA4\u51FA\u666E\u901A\u94FE\u63A5 [text](url) \u548C <img>/<audio>/<video> \u6807\u7B7E\u5E76\u4E00\u8D77\u6539\u5199\u3002\u9ED8\u8BA4\u5173\u95ED\uFF0C\u4EE5\u9650\u5236\u7F51\u7EDC\u8BF7\u6C42\u8303\u56F4\u3002\u8FD9\u662F\u4E09\u6B65\u4E2D\u7684\u7B2C\u4E00\u6B65\uFF1A\u6CA1\u88AB\u8BA4\u51FA\u7684\u5F15\u7528\uFF0C\u540E\u7EED\u4E0D\u4F1A\u505A\u4EFB\u4F55\u5904\u7406\u3002"
    ).addToggle((t) => t.setValue(this.s.localize.scanHtmlAndLinks).onChange((v) => {
      this.s.localize.scanHtmlAndLinks = v;
      this.save();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u7528 MD5 \u4F5C\u4E3A\u65B0\u6587\u4EF6\u540D").setDesc(
      "\u5F00\u542F\u540E\u6309\u5185\u5BB9\u54C8\u5E0C\u547D\u540D\uFF08\u5F62\u5982 9e599\u2026.jpg\uFF09\uFF0C\u540C\u4E00\u5F20\u56FE\u8D34\u591A\u6B21\u53EA\u4FDD\u5B58\u4E00\u4EFD\u3001\u8282\u7701\u7A7A\u95F4\u4E14\u540D\u5B57\u7A33\u5B9A\u5408\u6CD5\uFF0C\u63A8\u8350\u5F00\u542F\u3002\u5173\u95ED\u5219\u7528\u4E0B\u8F7D\u65F6\u7684\u539F\u59CB\u6587\u4EF6\u540D\uFF0C\u66F4\u76F4\u89C2\u4F46\u4E0D\u53BB\u91CD\uFF0C\u7279\u6B8A\u5B57\u7B26\u65F6\u53EF\u80FD\u9700\u8981\u8DEF\u5F84\u4FEE\u590D\u3002"
    ).addToggle((t) => t.setValue(this.s.localize.useMd5ForNew).onChange((v) => {
      this.s.localize.useMd5ForNew = v;
      this.save();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u6700\u5C0F\u6587\u4EF6\u5927\u5C0F\uFF08KB\uFF0C0 \u4E3A\u4E0D\u9650\uFF09").setDesc("\u5C0F\u4E8E\u8BE5\u6570\u503C\u7684\u4E0B\u8F7D\u4F1A\u88AB\u8DF3\u8FC7\uFF0C\u5E38\u7528\u4E8E\u8FC7\u6EE4\u5360\u4F4D\u56FE\u548C\u5FAE\u578B\u56FE\u6807\u3002\u8BBE\u4E3A 0 \u8868\u793A\u4E0D\u8FC7\u6EE4\u3001\u63A5\u6536\u5168\u90E8\uFF0C\u5EFA\u8BAE\u4FDD\u6301 0\uFF1B\u5982\u9700\u8FC7\u6EE4\u5FAE\u5C0F\u5360\u4F4D\u56FE\uFF0C\u53EF\u8BBE 2\uFF5E10\u3002").addText(
      (t) => t.setValue(String(this.s.localize.minSizeKb)).onChange((v) => {
        const n = Number(v);
        this.s.localize.minSizeKb = Number.isFinite(n) ? n : 0;
        this.save();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u4E0B\u8F7D\u91CD\u8BD5\u6B21\u6570").setDesc("\u67D0\u4E2A\u6587\u4EF6\u4E0B\u8F7D\u5931\u8D25\u65F6\u6700\u591A\u91CD\u8BD5\u7684\u6B21\u6570\uFF0C\u5EFA\u8BAE\u4FDD\u6301\u9ED8\u8BA4 3\uFF08\u8FC7\u5927\u53EA\u4F1A\u62D6\u6162\u5931\u8D25\u4E0B\u8F7D\uFF09\u3002").addText(
      (t) => t.setValue(String(this.s.localize.tryCount)).onChange((v) => {
        const n = Number(v);
        this.s.localize.tryCount = Number.isFinite(n) && n >= 1 ? n : 1;
        this.save();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u5355\u6587\u4EF6\u4E0B\u8F7D\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09").setDesc("\u5355\u4E2A\u6587\u4EF6\u4E0B\u8F7D\u8D85\u8FC7\u8BE5\u6BEB\u79D2\u6570\u5219\u653E\u5F03\u3002\u9ED8\u8BA4 30000\uFF0830\u79D2\uFF09\u3002").addText(
      (t) => t.setValue(String(this.s.localize.timeoutMs)).onChange((v) => {
        const n = Number(v);
        this.s.localize.timeoutMs = Number.isFinite(n) && n >= 1e3 ? n : 3e4;
        this.save();
      })
    );
    containerEl.createEl("p", {
      text: "\u5141\u8BB8\u672C\u5730\u5316\u7684\u7C7B\u522B\uFF08\u9ED8\u8BA4\u5168\u5F00\uFF1BSVG \u59CB\u7EC8\u4E0D\u505A\u672C\u5730\u5316\uFF09\u3002\u8FD9\u662F\u4E09\u6B65\u4E2D\u7684\u6700\u540E\u4E00\u6B65\uFF1A\u6587\u4EF6\u4E0B\u8F7D\u540E\u6309\u5B9E\u9645\u7C7B\u578B\uFF08\u56FE\u7247/\u89C6\u9891/\u97F3\u9891/PDF/\u6587\u6863/\u7F51\u9875\uFF09\u5224\u65AD\uFF0C\u53EA\u6709\u843D\u5728\u52FE\u9009\u7684\u767D\u540D\u5355\u91CC\u624D\u4FDD\u5B58\u5E76\u6539\u5199\u94FE\u63A5\uFF0C\u5426\u5219\u4E22\u5F03\u3002\u6574\u6761\u94FE\u8DEF\uFF1A\u2460\u6269\u5C55\u626B\u63CF \u8BA4\u54EA\u4E9B\u5F15\u7528 \u2192 \u2461\u672C\u5730\u5316\u7F51\u7EDC URL \u8981\u4E0D\u8981\u4E0B\u8F7D \u2192 \u2462\u7C7B\u522B\u767D\u540D\u5355 \u8981\u4E0D\u8981\u5B58\uFF0C\u4E09\u6B65\u90FD\u901A\u8FC7\u624D\u4F1A\u4FDD\u5B58\u3002",
      cls: "iap-settings-section-hint"
    });
    for (const opt of CATEGORY_OPTIONS) {
      new import_obsidian2.Setting(containerEl).setName(`\u672C\u5730\u5316 ${opt.label}`).setDesc(`\u5141\u8BB8\u628A\u8BC6\u522B\u4E3A\u300C${opt.label}\u300D\u7684\u9644\u4EF6\u4E0B\u8F7D\u5230\u672C\u5730\u3002`).addToggle(
        (t) => t.setValue(this.s.localize.allowedCategories.includes(opt.value)).onChange((v) => {
          const arr = this.s.localize.allowedCategories;
          const idx = arr.indexOf(opt.value);
          if (v && idx < 0) {
            arr.push(opt.value);
          } else if (!v && idx >= 0 && arr.length > 1) {
            arr.splice(idx, 1);
          }
          this.s.localize.allowedCategories = arr;
          this.save();
        })
      );
    }
    containerEl.createEl("h2", { text: "\u4E00\u81F4\u6027" });
    new import_obsidian2.Setting(containerEl).setName("\u542F\u7528\u4E00\u81F4\u6027").setDesc("\u603B\u5F00\u5173\u3002\u5173\u95ED\u540E\uFF0C\u201C\u68C0\u67E5\u5E93\u4E00\u81F4\u6027\u201D\u201C\u4FEE\u590D\u4E0D\u517C\u5BB9\u8DEF\u5F84\u201D\u201C\u7B14\u8BB0\u79FB\u52A8\u65F6\u8DDF\u968F\u79FB\u52A8\u9644\u4EF6\u201D\u90FD\u4E0D\u4F1A\u5DE5\u4F5C\u3002").addToggle((t) => t.setValue(this.s.consistency.enabled).onChange((v) => {
      this.s.consistency.enabled = v;
      this.save();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u62A5\u544A\u574F\u94FE\u63A5").setDesc("\u5728\u201C\u68C0\u67E5\u5E93\u4E00\u81F4\u6027\u201D\u62A5\u544A\u4E2D\u5217\u51FA\u6307\u5411\u4E0D\u5B58\u5728\u7684\u6587\u4EF6\u7684\u5F15\u7528\uFF0C\u65B9\u4FBF\u5B9A\u4F4D\u65AD\u94FE\u3002").addToggle((t) => t.setValue(this.s.consistency.reportBrokenLinks).onChange((v) => {
      this.s.consistency.reportBrokenLinks = v;
      this.save();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u4FEE\u590D\u4E0D\u517C\u5BB9\u8DEF\u5F84").setDesc(
      "\u201C\u4FEE\u590D\u4E0D\u517C\u5BB9\u8DEF\u5F84\u201D\u547D\u4EE4\u4F1A\u628A Windows \u7B49\u7CFB\u7EDF\u7684\u4FDD\u7559\u540D\u3001\u975E\u6CD5\u5B57\u7B26\u3001\u8D85\u957F\u6587\u4EF6\u540D\u5B89\u5168\u6539\u540D\uFF08\u4F8B\u5982 CON \u6539\u4E3A CON_\uFF09\uFF0C\u5E76\u81EA\u52A8\u66F4\u65B0\u5F15\u7528\u94FE\u63A5\u3002"
    ).addToggle((t) => t.setValue(this.s.consistency.repairIncompatiblePaths).onChange((v) => {
      this.s.consistency.repairIncompatiblePaths = v;
      this.save();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u7B14\u8BB0\u79FB\u52A8\u65F6\u8DDF\u968F\u79FB\u52A8\u9644\u4EF6").setDesc(
      "\u5F00\u542F\u540E\uFF0C\u5728\u6587\u4EF6\u7BA1\u7406\u5668\u628A\u7B14\u8BB0\u62D6\u5230\u5176\u5B83\u76EE\u5F55\u65F6\uFF0C\u4F1A\u81EA\u52A8\u628A\u8BE5\u7B14\u8BB0\u6240\u5728\u76EE\u5F55\u4E0B\u7684\u9644\u4EF6\u76EE\u5F55\uFF08\u5373 ./assets \u8FD9\u7C7B\u76F8\u5BF9\u76EE\u5F55\uFF09\u4E2D\u7684\u5BF9\u5E94\u9644\u4EF6\u4E00\u5E76\u8FC1\u5230\u65B0\u76EE\u5F55\uFF0C\u5E76\u4FDD\u6301\u94FE\u63A5\u3002\u9ED8\u8BA4\u5173\u95ED\u4EE5\u514D\u8BEF\u5E73\u79FB\u3002"
    ).addToggle((t) => t.setValue(this.s.consistency.followNoteMove).onChange((v) => {
      this.s.consistency.followNoteMove = v;
      this.save();
    }));
    containerEl.createEl("h2", { text: "\u6E05\u7406" });
    new import_obsidian2.Setting(containerEl).setName("\u542F\u7528\u6E05\u7406").setDesc("\u603B\u5F00\u5173\u3002\u5173\u95ED\u540E\uFF0C\u201C\u6E05\u7406\u672A\u7528\u9644\u4EF6\u201D\u547D\u4EE4\u4E0D\u6267\u884C\u3002").addToggle((t) => t.setValue(this.s.cleanup.enabled).onChange((v) => {
      this.s.cleanup.enabled = v;
      this.save();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u5220\u9664\u65B9\u5F0F").setDesc("\u6E05\u7406\u65F6\u5982\u4F55\u5904\u7F6E\u88AB\u9009\u4E2D\u7684\u6587\u4EF6\uFF1AObsidian \u56DE\u6536\u7AD9\uFF08\u63A8\u8350\uFF0C\u53EF\u6062\u590D\uFF09\uFF1B\u7CFB\u7EDF\u56DE\u6536\u7AD9\uFF1B\u6C38\u4E45\u5220\u9664\uFF08\u4E0D\u53EF\u6062\u590D\uFF0C\u9700\u8C28\u614E\u4F7F\u7528\uFF09\u3002").addDropdown(
      (d) => d.addOption(".trash", "Obsidian \u56DE\u6536\u7AD9").addOption("system-trash", "\u7CFB\u7EDF\u56DE\u6536\u7AD9").addOption("permanent", "\u6C38\u4E45\u5220\u9664").setValue(this.s.cleanup.deleteMode).onChange((v) => {
        this.s.cleanup.deleteMode = v;
        this.save();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u6392\u9664\u76EE\u5F55\uFF08\u9017\u53F7\u5206\u9694\uFF09").setDesc("\u8FD9\u4E9B\u6587\u4EF6\u5939\u4E0B\u7684\u6587\u4EF6\uFF0C\u5373\u4F7F\u6CA1\u6709\u88AB\u4EFB\u4F55\u7B14\u8BB0\u5F15\u7528\u4E5F\u7EDD\u4E0D\u4F1A\u88AB\u6E05\u7406\u3002\u8DEF\u5F84\u76F8\u5BF9\u4E8E\u5E93\u6839\uFF0C\u591A\u4E2A\u76EE\u5F55\u7528\u82F1\u6587\u9017\u53F7\u5206\u9694\u3002").addText(
      (t) => t.setValue(this.s.cleanup.excludedFolders.join(", ")).setPlaceholder("assets/keep, \u7B14\u8BB0\u5F52\u6863").onChange((v) => {
        this.s.cleanup.excludedFolders = v.split(",").map((s) => s.trim()).filter(Boolean);
        this.save();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("\u6392\u9664\u76EE\u5F55\u542B\u5B50\u76EE\u5F55").setDesc("\u5F00\u542F\u540E\uFF0C\u4E0A\u65B9\u6392\u9664\u76EE\u5F55\u4E0B\u7684\u6240\u6709\u5B50\u76EE\u5F55\u4E5F\u4E00\u5E76\u8C41\u514D\uFF1B\u5173\u95ED\u5219\u53EA\u8C41\u514D\u5217\u51FA\u7684\u76EE\u5F55\u672C\u8EAB\u3002").addToggle((t) => t.setValue(this.s.cleanup.excludeSubfolders).onChange((v) => {
      this.s.cleanup.excludeSubfolders = v;
      this.save();
    }));
    new import_obsidian2.Setting(containerEl).setName("\u5220\u9664\u524D\u786E\u8BA4").setDesc("\u5F00\u542F\u540E\u6E05\u7406\u524D\u4F1A\u5F39\u7A97\u5217\u51FA\u53D7\u5F71\u54CD\u7684\u6587\u4EF6\uFF0C\u9700\u8981\u518D\u786E\u8BA4\u4E00\u6B21\u624D\u6267\u884C\uFF1B\u5173\u95ED\u5219\u4F1A\u76F4\u63A5\u6309\u5220\u9664\u65B9\u5F0F\u5904\u7406\uFF08\u5B58\u5728\u8BEF\u5220\u98CE\u9669\uFF0C\u5F3A\u70C8\u5EFA\u8BAE\u4FDD\u6301\u5F00\u542F\uFF09\u3002").addToggle((t) => t.setValue(this.s.cleanup.requireConfirm).onChange((v) => {
      this.s.cleanup.requireConfirm = v;
      this.save();
    }));
    containerEl.createEl("h2", { text: "\u5BFC\u51FA" });
    new import_obsidian2.Setting(containerEl).setName("\u542F\u7528\u5BFC\u51FA").setDesc("\u5F00\u542F\u540E\u542F\u7528\u201C\u5BFC\u51FA\u5F53\u524D\u7B14\u8BB0\u9644\u4EF6\u201D\u548C\u201C\u5BFC\u51FA\u672A\u7528\u9644\u4EF6\u201D\u4E24\u6761 zip \u547D\u4EE4\uFF0C\u5C06\u9644\u4EF6\u8FDE\u540C\u6E05\u5355\u5143\u6570\u636E\u6253\u5305\u5F52\u6863\u3002").addToggle((t) => t.setValue(this.s.exporter.enabled).onChange((v) => {
      this.s.exporter.enabled = v;
      this.save();
    }));
  }
};

// src/commands.ts
var import_obsidian12 = require("obsidian");

// src/notify.ts
var import_obsidian3 = require("obsidian");

// src/notify-core.ts
function shouldNotify(level, kind) {
  switch (level) {
    case "silent":
      return kind === "error";
    case "summary":
      return kind === "error" || kind === "summary";
    default:
      return true;
  }
}
var BASE_DURATION = {
  error: 5e3,
  summary: 3e3,
  info: 2e3
};
var CHARS_PER_LINE = 40;
var EXTRA_PER_LINE = 1e3;
function effectiveDuration(kind, msg) {
  const base = BASE_DURATION[kind];
  const lines = Math.max(1, Math.ceil(msg.length / CHARS_PER_LINE));
  return base + (lines - 1) * EXTRA_PER_LINE;
}

// src/notify.ts
function createNoticer(getLevel) {
  const show = (kind, msg) => {
    if (shouldNotify(getLevel(), kind)) new import_obsidian3.Notice(msg, effectiveDuration(kind, msg));
  };
  return {
    error: (m) => show("error", m),
    summary: (m) => show("summary", m),
    info: (m) => show("info", m)
  };
}

// src/features/name-formatter.ts
var import_obsidian6 = require("obsidian");

// src/modals.ts
var import_obsidian4 = require("obsidian");
var ConfirmChangesModal = class extends import_obsidian4.Modal {
  constructor(app, opts) {
    super(app);
    this.opts = opts;
  }
  onOpen() {
    var _a;
    const { contentEl, modalEl } = this;
    modalEl.addClass("iap-confirm-modal");
    const header = contentEl.createDiv({ cls: "iap-confirm-header" });
    const titleRow = header.createDiv({ cls: "iap-confirm-title-row" });
    titleRow.createEl("h3", { text: this.opts.title, cls: "iap-confirm-title" });
    titleRow.createEl("span", { text: `${this.opts.rows.length} \u9879`, cls: "iap-confirm-count" });
    if (this.opts.desc) {
      header.createEl("p", { text: this.opts.desc, cls: "iap-confirm-desc" });
    }
    const list = contentEl.createDiv({ cls: "iap-confirm-list" });
    for (const row of this.opts.rows.slice(0, 50)) {
      const item = list.createDiv({ cls: "iap-confirm-row" });
      if (row.reason) {
        item.createSpan({ text: row.reason, cls: "iap-confirm-reason" });
      }
      const flow = item.createDiv({ cls: "iap-confirm-flow" });
      flow.createSpan({ text: displayPath(row.from), cls: "iap-confirm-from" });
      flow.createSpan({ text: "\u2192", cls: "iap-confirm-arrow" });
      flow.createSpan({ text: displayPath(row.to), cls: "iap-confirm-to" });
    }
    if (this.opts.rows.length > 50) {
      list.createDiv({ text: `\u2026 \u53CA\u53E6\u5916 ${this.opts.rows.length - 50} \u9879`, cls: "iap-confirm-more" });
    }
    const footer = contentEl.createDiv({ cls: "iap-confirm-footer" });
    new import_obsidian4.ButtonComponent(footer).setButtonText("\u53D6\u6D88").setClass("iap-btn").onClick(() => this.close());
    const confirm = new import_obsidian4.ButtonComponent(footer).setButtonText((_a = this.opts.confirmText) != null ? _a : "\u786E\u8BA4").setCta().setClass("iap-btn");
    if (this.opts.danger) confirm.setWarning();
    confirm.onClick(() => {
      const cb = this.opts.onConfirm;
      this.close();
      void cb();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ReportModal = class extends import_obsidian4.Modal {
  constructor(app, opts) {
    super(app);
    this.opts = opts;
  }
  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("iap-report-modal");
    const header = contentEl.createDiv({ cls: "iap-report-header" });
    header.createEl("h3", { text: this.opts.title, cls: "iap-report-title" });
    if (this.opts.summary) {
      header.createEl("p", { text: this.opts.summary, cls: "iap-report-summary" });
    }
    const body = contentEl.createDiv({ cls: "iap-report-body" });
    const hasContent = this.opts.sections.some((s) => s.items.length > 0);
    if (hasContent) {
      for (const section of this.opts.sections) {
        if (section.items.length === 0) continue;
        const block = body.createDiv({ cls: "iap-report-section" });
        const head = block.createDiv({ cls: "iap-report-section-head" });
        head.createEl("h4", { text: section.title, cls: "iap-report-section-title" });
        if (section.count !== void 0) {
          head.createEl("span", { text: String(section.count), cls: "iap-report-count" });
        }
        const list = block.createDiv({ cls: "iap-report-list" });
        for (const item of section.items.slice(0, 100)) {
          list.createDiv({ text: item, cls: "iap-report-item" });
        }
        if (section.items.length > 100) {
          list.createDiv({ text: `\u2026 \u53CA\u53E6\u5916 ${section.items.length - 100} \u9879`, cls: "iap-report-more" });
        }
      }
    } else {
      body.createDiv({ text: this.opts.sections.every((s) => s.emptyText) ? this.opts.sections[0].emptyText : "\u672A\u53D1\u73B0\u9700\u8981\u5173\u6CE8\u7684\u95EE\u9898\u3002", cls: "iap-report-empty" });
    }
    const footer = contentEl.createDiv({ cls: "iap-report-footer" });
    new import_obsidian4.ButtonComponent(footer).setButtonText("\u5173\u95ED").setCta().setClass("iap-btn").onClick(() => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
};
function displayPath(p) {
  const slash = p.lastIndexOf("/");
  const base = slash >= 0 ? p.slice(slash + 1) : p;
  const dir = slash >= 0 ? p.slice(0, slash) : "";
  return dir ? `${base}  \xB7  ${dir}` : base;
}

// src/features/name-formatter-core.ts
function namingParts(input) {
  const parts = [];
  if (input.includeNoteName) parts.push(input.noteName);
  if (input.honorCategory) parts.push(input.typeField);
  parts.push(String(input.index).padStart(3, "0"));
  if (input.addTime) parts.push(input.timeStr);
  if (input.addPathHash) parts.push(input.hashSuffix);
  return parts;
}
function buildName(input) {
  return `${namingParts(input).join(input.connector)}.${input.ext}`;
}
function checkAlreadyRenamed(stem, noteName, includeNoteName, connector, includeCategory, addTime = false, addPathHash = false) {
  if (!connector) return false;
  const parts = stem.split(connector);
  let idx = 0;
  if (includeNoteName) {
    if (parts[0] !== noteName || parts.length < 2) return false;
    idx = 1;
  }
  if (includeCategory) {
    if (parts[idx].length === 0) return false;
    idx++;
  }
  if (idx >= parts.length) return false;
  if (!/^\d{2,}$/.test(parts[idx])) return false;
  idx++;
  const expected = (addTime ? 1 : 0) + (addPathHash ? 1 : 0);
  const suffixLen = parts.length - idx;
  if (suffixLen !== expected) return false;
  if (addTime) {
    if (!/^\d{14}$/.test(parts[idx])) return false;
    idx++;
  }
  if (addPathHash) {
    if (!/^[0-9a-f]{8}$/i.test(parts[idx])) return false;
    idx++;
  }
  return true;
}
function formatTimestamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function planForSnapshot(snapshot, notePath, noteName, naming, folderByCategory = false, targetBaseDir = "") {
  var _a, _b, _c, _d;
  const items = [];
  const counters = /* @__PURE__ */ new Map();
  const now = /* @__PURE__ */ new Date();
  const timeStr = naming.addTime ? formatTimestamp(now) : "";
  const hashSuffix = naming.addPathHash ? md5HexOfString(notePath).slice(0, 8) : "";
  for (const entry of snapshot.entries.values()) {
    if (!entry.references.some((r) => r.sourcePath === notePath)) continue;
    const slash = entry.path.lastIndexOf("/");
    const fullname = entry.path.slice(slash + 1);
    const stem = fullname.replace(/\.[^.]+$/, "");
    const ext = extOf(entry.path);
    const word = (_a = naming.categoryWords[entry.category]) != null ? _a : entry.category;
    const typeField = naming.showSubType ? `${word}_${ext}` : word;
    if (!checkAlreadyRenamed(stem, noteName, true, naming.connector, naming.honorCategory, naming.addTime, naming.addPathHash)) continue;
    const parts = stem.split(naming.connector);
    let idx = 1;
    if (naming.honorCategory) idx++;
    const num = Number.parseInt(parts[idx], 10);
    if (!Number.isNaN(num)) {
      const cur = (_b = counters.get(typeField)) != null ? _b : 0;
      if (num > cur) counters.set(typeField, num);
    }
  }
  for (const entry of snapshot.entries.values()) {
    if (!entry.references.some((r) => r.sourcePath === notePath)) continue;
    const slash = entry.path.lastIndexOf("/");
    const ownDir = slash >= 0 ? entry.path.slice(0, slash + 1) : "";
    const fullname = entry.path.slice(slash + 1);
    const stem = fullname.replace(/\.[^.]+$/, "");
    const ext = extOf(entry.path);
    const word = (_c = naming.categoryWords[entry.category]) != null ? _c : entry.category;
    const typeField = naming.showSubType ? `${word}_${ext}` : word;
    if (checkAlreadyRenamed(stem, noteName, true, naming.connector, naming.honorCategory, naming.addTime, naming.addPathHash)) continue;
    const index = ((_d = counters.get(typeField)) != null ? _d : 0) + 1;
    counters.set(typeField, index);
    const newName = buildName({
      noteName,
      typeField,
      honorCategory: naming.honorCategory,
      index,
      connector: naming.connector,
      includeNoteName: true,
      addTime: naming.addTime,
      timeStr,
      addPathHash: naming.addPathHash,
      hashSuffix,
      ext
    });
    const dir = folderByCategory ? `${(targetBaseDir || ownDir.replace(/\/+$/g, "")).replace(/^\/+/, "")}/${entry.category}/` : ownDir;
    const to = folderByCategory ? normalizeLocal(`${dir}${newName}`) : `${dir}${newName}`;
    if (to === entry.path) continue;
    items.push({ from: entry.path, to, newName });
  }
  return items;
}

// src/features/link-fixer.ts
var import_obsidian5 = require("obsidian");

// src/features/link-fixer-core.ts
function refMapForMoves(moves) {
  const map = /* @__PURE__ */ new Map();
  for (const mv of moves) {
    map.set(mv.from, mv.to);
    const base = basenameOf2(mv.from);
    if (!map.has(base)) map.set(base, mv.to);
  }
  return map;
}
function basenameOf2(p) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

// src/features/link-fixer.ts
async function rewriteRefsInNote(app, notePath, map) {
  if (map.size === 0) return false;
  const f = app.vault.getAbstractFileByPath(notePath);
  if (!(f instanceof import_obsidian5.TFile)) return false;
  const text = await app.vault.read(f);
  let next = rewrite(text, map);
  next = rewriteFrontmatter(next, map);
  if (next === text) return false;
  await app.vault.modify(f, next);
  return true;
}
async function rewriteRefsInAllNotes(app, moves) {
  const map = refMapForMoves(moves);
  if (map.size === 0) return 0;
  let changed = 0;
  const notes = app.vault.getFiles().filter((f) => f.extension === "md" || f.extension === "canvas");
  for (const n of notes) {
    if (await rewriteRefsInNote(app, n.path, map)) changed++;
  }
  return changed;
}

// src/features/name-formatter.ts
async function runRenameNote(app, index, getSettings, mover, confirm = true, notePath, snapshot, notify = true) {
  const toast = createNoticer(() => getSettings().notificationLevel);
  const note = notePath ? app.vault.getAbstractFileByPath(notePath) : app.workspace.getActiveFile();
  if (!note || !(note instanceof import_obsidian6.TFile)) {
    if (!notePath && notify) toast.error("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u7B14\u8BB0\u3002");
    return { moved: 0, errors: 0 };
  }
  const naming = getSettings().naming;
  if (!naming.enabled) {
    if (notify) toast.summary("\u547D\u540D\u80FD\u529B\u5DF2\u5173\u95ED\u3002");
    return { moved: 0, errors: 0 };
  }
  const snapshotUsed = snapshot != null ? snapshot : await index.build();
  const baseDir = naming.folderByCategory ? resolveAttachmentDirForNote(app, getSettings(), note) : "";
  const items = planForSnapshot(snapshotUsed, note.path, note.basename, naming, naming.folderByCategory, baseDir);
  if (items.length === 0) {
    if (notify) toast.summary("\u6CA1\u6709\u9700\u8981\u91CD\u547D\u540D\u7684\u9644\u4EF6\u3002");
    return { moved: 0, errors: 0 };
  }
  const ownerCount = /* @__PURE__ */ new Map();
  for (const e2 of snapshotUsed.entries.values()) {
    const owners = new Set(e2.references.map((r2) => r2.sourcePath));
    ownerCount.set(e2.path, owners.size);
  }
  const renameItems = items.filter((i) => {
    var _a;
    return ((_a = ownerCount.get(i.from)) != null ? _a : 1) <= 1;
  });
  const copyItems = items.filter((i) => {
    var _a;
    return ((_a = ownerCount.get(i.from)) != null ? _a : 1) > 1;
  });
  const execute = async () => {
    let copied = 0;
    let copyFailed = 0;
    const map = /* @__PURE__ */ new Map();
    const out = await mover.moveMany(renameItems.map((i) => ({ from: i.from, to: i.to })));
    for (const r2 of refMapForMoves(out.results)) map.set(r2[0], r2[1]);
    for (const ci of copyItems) {
      const target = await uniqueCopyTarget(app, ci.to);
      if (await copyFileTo(app, ci.from, target)) {
        map.set(ci.from, target);
        map.set(basenameOf3(ci.from), target);
        copied++;
      } else {
        copyFailed++;
      }
    }
    await rewriteRefsInNote(app, note.path, map);
    index.markDirty();
    if (notify) {
      toast.summary(`\u547D\u540D\u5B8C\u6210\uFF1A\u91CD\u547D\u540D ${out.results.length}\uFF0C\u590D\u5236 ${copied}\uFF0C\u5931\u8D25 ${out.errors.length}${copyFailed ? `\uFF08\u590D\u5236\u5931\u8D25 ${copyFailed}\uFF09` : ""}\u3002`);
    }
    return { renamed: out.results.length, copied, copyFailed, fail: out.errors.length };
  };
  if (confirm) {
    new ConfirmChangesModal(app, {
      title: "\u91CD\u547D\u540D\u5F53\u524D\u7B14\u8BB0\u9644\u4EF6",
      desc: "\u5C06\u6309\u300C\u7B14\u8BB0_\u7C7B\u522B_\u5E8F\u53F7\u300D\u89C4\u8303\u547D\u540D\u4EE5\u4E0B\u9644\u4EF6\uFF1B\u88AB\u591A\u7BC7\u7B14\u8BB0\u5171\u7528\u7684\u9644\u4EF6\u4F1A\u590D\u5236\u526F\u672C\u518D\u547D\u540D\uFF0CObsidian \u81EA\u52A8\u66F4\u65B0\u94FE\u63A5\u3002",
      rows: items.map((i) => ({ from: i.from, to: i.to })),
      confirmText: `\u786E\u8BA4\u91CD\u547D\u540D\uFF08${items.length}\uFF09`,
      onConfirm: async () => {
        await execute();
      }
    }).open();
    return { moved: 0, errors: 0 };
  }
  const r = await execute();
  return { moved: r.renamed, errors: r.fail + r.copyFailed, copied: r.copied, copyFailed: r.copyFailed };
}
function basenameOf3(p) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}
async function uniqueCopyTarget(app, desired) {
  if (!await app.vault.adapter.exists(desired)) return desired;
  const dot = desired.lastIndexOf(".");
  const slash = desired.lastIndexOf("/");
  if (dot <= slash) {
    let i2 = 1;
    let c2 = `${desired} (${i2})`;
    while (await app.vault.adapter.exists(c2)) c2 = `${desired} (${++i2})`;
    return c2;
  }
  const stem = desired.slice(0, dot);
  const ext = desired.slice(dot);
  let i = 1;
  let c = `${stem} (${i})${ext}`;
  while (await app.vault.adapter.exists(c)) c = `${stem} (${++i})${ext}`;
  return c;
}
async function copyFileTo(app, from, to) {
  try {
    const f = app.vault.getAbstractFileByPath(from);
    if (!(f instanceof import_obsidian6.TFile)) return false;
    const buf = await app.vault.readBinary(f);
    const bytes = new Uint8Array(buf);
    await app.vault.createBinary(to, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    return true;
  } catch (e2) {
    return false;
  }
}

// src/features/consistency-core.ts
function profileFromPlatforms(platforms) {
  return {
    platforms,
    maxBytes: 255,
    maxUnits: 255,
    windows: platforms.includes("windows")
  };
}
function planPathFixes(paths, profile) {
  const items = [];
  for (const path of paths) {
    const slash = path.lastIndexOf("/");
    const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
    const fullname = path.slice(slash + 1);
    const dot = fullname.lastIndexOf(".");
    const stem = dot > 0 ? fullname.slice(0, dot) : fullname;
    const ext = dot > 0 ? fullname.slice(dot + 1) : "";
    const repaired = repairName(stem, ext, profile);
    if (repaired === fullname) continue;
    items.push({ from: path, to: `${dir}${repaired}`, name: repaired });
  }
  return items;
}

// src/features/consistency.ts
async function runRepairPaths(app, index, getSettings, mover, confirm = true) {
  const toast = createNoticer(() => getSettings().notificationLevel);
  const consistency = getSettings().consistency;
  if (!consistency.enabled || !consistency.repairIncompatiblePaths) {
    toast.summary("\u8DEF\u5F84\u4FEE\u590D\u80FD\u529B\u5DF2\u5173\u95ED\u3002");
    return { fixed: 0, errors: 0 };
  }
  const snapshot = await index.getSnapshot();
  const items = planPathFixes(snapshot.entries.keys(), profileFromPlatforms(consistency.platforms));
  if (items.length === 0) {
    toast.summary("\u6CA1\u6709\u9700\u8981\u4FEE\u590D\u7684\u8DEF\u5F84\u3002");
    return { fixed: 0, errors: 0 };
  }
  const execute = async () => {
    const out = await mover.moveMany(items.map((i) => ({ from: i.from, to: i.to })));
    await rewriteRefsInAllNotes(app, out.results);
    index.markDirty();
    toast.summary(`\u8DEF\u5F84\u4FEE\u590D\uFF1A\u6210\u529F ${out.results.length}\uFF0C\u5931\u8D25 ${out.errors.length}\u3002`);
  };
  if (confirm) {
    new ConfirmChangesModal(app, {
      title: "\u4FEE\u590D\u4E0D\u517C\u5BB9\u8DEF\u5F84",
      desc: "\u4EE5\u4E0B\u8DEF\u5F84\u5728\u5F53\u524D\u76EE\u6807\u5E73\u53F0\u4E0D\u53D7\u652F\u6301\uFF0C\u5C06\u6309\u5E73\u53F0\u89C4\u5219\u5B89\u5168\u6539\u540D\uFF0C\u5E76\u81EA\u52A8\u66F4\u65B0\u5F15\u7528\u94FE\u63A5\u3002",
      rows: items.map((i) => ({ from: i.from, to: i.to })),
      confirmText: `\u786E\u8BA4\u4FEE\u590D\uFF08${items.length}\uFF09`,
      onConfirm: execute
    }).open();
    return { fixed: 0, errors: 0 };
  }
  await execute();
  return { fixed: items.length, errors: 0 };
}

// src/features/localize-media.ts
var import_obsidian7 = require("obsidian");

// src/features/localize-media-core.ts
var MD_IMG = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
var MD_LINK2 = /(?<!!)\[([^\]]*)\]\(([^)\s]+)\)/g;
var HTML_MEDIA = /<(img|audio|video)\b[^>]*>/gi;
function isHttp(url) {
  return /^https?:\/\//i.test(url);
}
function isDataUrl(url) {
  return /^data:/i.test(url);
}
function nameHintOf(url, alt) {
  var _a;
  if (isDataUrl(url)) return alt || "image";
  const clean = url.split("?")[0].split("#")[0];
  const last = (_a = clean.split("/").pop()) != null ? _a : "";
  if (last && last.includes(".")) {
    try {
      return decodeURIComponent(last);
    } catch (e2) {
      return alt || "image";
    }
  }
  return alt || "image";
}
function findExternalRefs(text, scanExtended = false) {
  const refs = [];
  for (const m of text.matchAll(MD_IMG)) {
    pushRef(refs, m[2], m[1], m[0]);
  }
  if (scanExtended) {
    collectMarkdownLinks(text, refs);
    collectHtmlMedia(text, refs);
  }
  return refs;
}
function pushRef(refs, url, alt, raw) {
  if (!isHttp(url) && !isDataUrl(url)) return;
  refs.push({
    url,
    alt,
    raw,
    kind: isDataUrl(url) ? "data" : "http",
    nameHint: nameHintOf(url, alt)
  });
}
function collectMarkdownLinks(text, refs) {
  for (const m of text.matchAll(MD_LINK2)) {
    pushRef(refs, m[2], m[1], m[0]);
  }
}
function collectHtmlMedia(text, refs) {
  for (const m of text.matchAll(HTML_MEDIA)) {
    const tag = m[0];
    const isImg = m[1].toLowerCase() === "img";
    const src = attrOf(tag, "src");
    if (!src) continue;
    const alt = isImg ? attrOf(tag, "alt") : "";
    pushRef(refs, decodeHtmlEntity(src), alt, tag);
  }
}
function attrOf(tag, name) {
  var _a, _b, _c;
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  if (!m) return "";
  return (_c = (_b = (_a = m[1]) != null ? _a : m[2]) != null ? _b : m[3]) != null ? _c : "";
}
function decodeHtmlEntity(s) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function localLinkText(alt, localPath, style) {
  if (style === "wiki") {
    return `![[${localPath}${alt ? `|${alt}` : ""}]]`;
  }
  return `![${alt}](${localPath})`;
}
function applyRefReplacements(text, refs, map, style) {
  let out = text;
  for (const ref of refs) {
    const local = map.get(ref.url);
    if (local === void 0) continue;
    out = out.replace(ref.raw, localLinkText(ref.alt, local, style));
  }
  return out;
}
function localName(md5, nameHint, useMd5, ext) {
  if (useMd5) return `${md5}.${ext}`;
  const safe = sanitizeFilename(nameHint);
  if (!safe || !safe.includes(".")) return `${safe || md5}.${ext}`;
  return safe;
}
function decodeDataUri(uri) {
  const comma = uri.indexOf(",");
  if (comma < 0) return null;
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  if (/;base64$/i.test(meta)) {
    try {
      const bin = atob(payload);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch (e2) {
      return null;
    }
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(payload));
  } catch (e2) {
    return null;
  }
}
function bytesMd5(data) {
  return md5Hex(data);
}

// src/features/localize-media.ts
var MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
var ObsidianDownloader = class {
  constructor(getSettings) {
    this.getSettings = getSettings;
  }
  async download(url) {
    const { timeoutMs, tryCount, minSizeKb } = this.getSettings().localize;
    let last;
    for (let i = 0; i < Math.max(1, tryCount); i++) {
      try {
        const data = url.startsWith("data:") ? decodeDataUri(url) : await fetchHttp(url, timeoutMs);
        if (data === null) return null;
        if (data.byteLength < minSizeKb * 1024) return null;
        if (data.byteLength > MAX_DOWNLOAD_BYTES) return null;
        return data;
      } catch (e2) {
        last = e2;
      }
    }
    logger.warn(`\u4E0B\u8F7D\u5931\u8D25\uFF1A${url}\uFF08${last instanceof Error ? last.message : String(last)}\uFF09`);
    return null;
  }
};
async function fetchHttp(url, timeoutMs) {
  const res = await Promise.race([
    (0, import_obsidian7.requestUrl)({ url, method: "GET", throw: false }),
    new Promise((resolve) => window.setTimeout(() => resolve(null), timeoutMs))
  ]);
  if (!res) return null;
  if (res.status < 200 || res.status >= 300) return null;
  const ab = res.arrayBuffer;
  if (!ab || ab.byteLength === 0) return null;
  return new Uint8Array(ab);
}
async function runLocalizeNote(app, index, getSettings, downloader, notePath, overrideText, notify = true) {
  var _a, _b, _c;
  const toast = createNoticer(() => getSettings().notificationLevel);
  const note = notePath ? app.vault.getAbstractFileByPath(notePath) : app.workspace.getActiveFile();
  if (!note || !(note instanceof import_obsidian7.TFile)) {
    if (notify) toast.error("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u7B14\u8BB0\u3002");
    return { downloaded: 0, skipped: 0, errors: 0, found: 0 };
  }
  const localize = getSettings().localize;
  if (!localize.enabled) {
    if (notify) toast.summary("\u672C\u5730\u5316\u80FD\u529B\u5DF2\u5173\u95ED\u3002");
    return { downloaded: 0, skipped: 0, errors: 0, found: 0 };
  }
  if (isPathExcluded(note.path, (_b = (_a = getSettings().paths) == null ? void 0 : _a.exclude) != null ? _b : [])) {
    if (notify) toast.summary("\u8BE5\u7B14\u8BB0\u4F4D\u4E8E\u6392\u9664\u76EE\u5F55\uFF0C\u5DF2\u8DF3\u8FC7\u672C\u5730\u5316\u3002");
    return { downloaded: 0, skipped: 0, errors: 0, found: 0 };
  }
  const text = overrideText !== void 0 ? overrideText : await app.vault.read(note);
  const allRefs = findExternalRefs(text, localize.scanHtmlAndLinks);
  const refs = localize.localizeWebUrls ? allRefs : allRefs.filter((r) => r.kind === "data");
  if (refs.length === 0) {
    if (notify) {
      if (!localize.localizeWebUrls && allRefs.length > 0) {
        toast.summary("\u5DF2\u5173\u95ED\u7F51\u7EDC URL \u672C\u5730\u5316\uFF0C\u5F53\u524D\u53EA\u6709\u5916\u94FE\u9700\u8981\u5904\u7406\u3002");
      } else {
        toast.summary("\u5F53\u524D\u7B14\u8BB0\u6CA1\u6709\u53EF\u672C\u5730\u5316\u7684\u5916\u90E8\u5F15\u7528\u3002");
      }
    }
    return { downloaded: 0, skipped: 0, errors: 0, found: refs.length };
  }
  const dir = resolveAttachmentDirForNote(app, getSettings(), note);
  await ensureFolder(app, dir);
  const vaultCfg = app.vault;
  const useMarkdown = ((_c = vaultCfg.getConfig) == null ? void 0 : _c.call(vaultCfg, "useMarkdownLinks")) === true;
  const map = /* @__PURE__ */ new Map();
  let downloaded = 0;
  let skipped = 0;
  for (const ref of refs) {
    const data = await downloader.download(ref.url);
    if (data === null) {
      skipped++;
      continue;
    }
    const result = classify(data);
    if (result.isSvg || !localize.allowedCategories.includes(result.category)) {
      skipped++;
      continue;
    }
    const md5 = bytesMd5(data);
    const name = localName(md5, ref.nameHint, localize.useMd5ForNew, result.ext);
    const relPath = dir ? `${dir}/${name}` : name;
    try {
      if (!await app.vault.adapter.exists(relPath)) {
        await app.vault.createBinary(relPath, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      }
      map.set(ref.url, relPath);
      downloaded++;
    } catch (e2) {
      logger.error(`\u5199\u76D8\u5931\u8D25 ${relPath}: ${e2 instanceof Error ? e2.message : String(e2)}`);
      skipped++;
    }
  }
  if (map.size === 0) {
    if (notify) toast.summary(`\u672C\u5730\u5316\u5B8C\u6210\uFF1A\u65E0\u6210\u529F\u9879\uFF08\u4E0B\u8F7D ${downloaded}\uFF0C\u8DF3\u8FC7 ${skipped}\uFF09\u3002`);
    return { downloaded: 0, skipped, errors: 0, found: refs.length };
  }
  const newText = applyRefReplacements(text, refs, map, useMarkdown ? "markdown" : "wiki");
  if (newText !== text) {
    await app.vault.modify(note, newText);
  }
  index.markDirty();
  if (notify) toast.summary(`\u672C\u5730\u5316\u5B8C\u6210\uFF1A\u4E0B\u8F7D ${downloaded}\uFF0C\u8DF3\u8FC7 ${skipped}\u3002`);
  return { downloaded, skipped, errors: 0, found: refs.length };
}

// src/features/collect.ts
var import_obsidian8 = require("obsidian");

// src/features/collect-core.ts
function planCollect(entries, notePath, targetDir) {
  const out = [];
  for (const e2 of entries) {
    if (!e2.references.some((r) => r.sourcePath === notePath)) continue;
    const slash = e2.path.lastIndexOf("/");
    const dir = slash >= 0 ? e2.path.slice(0, slash) : "";
    if (dir === targetDir) continue;
    const filename = slash >= 0 ? e2.path.slice(slash + 1) : e2.path;
    const to = targetDir ? `${targetDir}/${filename}` : filename;
    if (to === e2.path) continue;
    out.push({ from: e2.path, to });
  }
  return out;
}

// src/features/collect.ts
async function runCollectNote(app, index, getSettings, mover, notePath) {
  const toast = createNoticer(() => getSettings().notificationLevel);
  const note = notePath ? app.vault.getAbstractFileByPath(notePath) : app.workspace.getActiveFile();
  if (!note || !(note instanceof import_obsidian8.TFile)) {
    if (!notePath) toast.error("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u7B14\u8BB0\u3002");
    return { moved: 0, errors: 0 };
  }
  const targetDir = resolveAttachmentDirForNote(app, getSettings(), note);
  const snapshot = await index.build();
  const items = planCollect(snapshot.entries.values(), note.path, targetDir);
  if (items.length === 0) {
    toast.summary("\u5F53\u524D\u7B14\u8BB0\u7684\u9644\u4EF6\u90FD\u5DF2\u5728\u5176\u5F52\u5C5E\u76EE\u5F55\u3002");
    return { moved: 0, errors: 0 };
  }
  const execute = async () => {
    const out = await mover.moveMany(items.map((i) => ({ from: i.from, to: i.to })));
    await rewriteRefsInNote(app, note.path, refMapForMoves(out.results));
    index.markDirty();
    toast.summary(`\u6536\u96C6\u5B8C\u6210\uFF1A\u79FB\u52A8 ${out.results.length}\uFF0C\u5931\u8D25 ${out.errors.length}\u3002`);
  };
  new ConfirmChangesModal(app, {
    title: "\u6536\u96C6\u5F53\u524D\u7B14\u8BB0\u9644\u4EF6",
    desc: `\u4EE5\u4E0B\u9644\u4EF6\u88AB\u5F53\u524D\u7B14\u8BB0\u5F15\u7528\u4F46\u4E0D\u5728\u5F52\u5C5E\u76EE\u5F55 ${targetDir || "(\u5E93\u6839)"}\uFF0C\u5C06\u79FB\u5165\u5E76\u6309 Obsidian \u66F4\u65B0\u5F15\u7528\u94FE\u63A5\u3002`,
    rows: items.map((i) => ({ from: i.from, to: i.to })),
    confirmText: `\u786E\u8BA4\u6536\u96C6\uFF08${items.length}\uFF09`,
    onConfirm: execute
  }).open();
  return { moved: 0, errors: 0 };
}

// src/features/unused-cleaner.ts
var import_obsidian9 = require("obsidian");

// src/features/unused-cleaner-core.ts
function shouldExclude(path, excludedFolders, excludeSubfolders) {
  if (!excludedFolders.length) return false;
  const slash = path.lastIndexOf("/");
  const parent = slash >= 0 ? path.slice(0, slash) : "";
  for (const raw of excludedFolders) {
    const norm = raw.trim().replace(/\/+$/, "");
    if (!norm) continue;
    if (excludeSubfolders) {
      if (parent === norm || parent.startsWith(`${norm}/`)) return true;
    } else if (parent === norm) {
      return true;
    }
  }
  return false;
}
function planCleanup(orphanCandidates, excludedFolders, excludeSubfolders) {
  const toDelete = [];
  const excluded = [];
  for (const path of orphanCandidates) {
    if (shouldExclude(path, excludedFolders, excludeSubfolders)) {
      excluded.push(path);
    } else {
      toDelete.push(path);
    }
  }
  return { toDelete, excluded };
}

// src/features/unused-cleaner.ts
function collectUsedSet(app) {
  const set = /* @__PURE__ */ new Set();
  const resolved = app.metadataCache.resolvedLinks;
  for (const links of Object.values(resolved)) {
    for (const target of Object.keys(links)) set.add(target);
  }
  return set;
}
async function performDelete(app, paths, mode) {
  const used = collectUsedSet(app);
  let deleted = 0;
  let errors = 0;
  let skipped = 0;
  for (const path of paths) {
    try {
      const f = app.vault.getAbstractFileByPath(path);
      if (!(f instanceof import_obsidian9.TFile)) continue;
      if (used.has(path)) {
        skipped++;
        continue;
      }
      if (mode === ".trash") await app.vault.trash(f, false);
      else if (mode === "system-trash") await app.vault.trash(f, true);
      else await app.vault.delete(f);
      deleted++;
    } catch (e2) {
      errors++;
    }
  }
  return { deleted, errors, skipped };
}
var ConfirmCleanupModal = class extends import_obsidian9.Modal {
  constructor(app, paths, mode, onDone) {
    super(app);
    this.paths = paths;
    this.mode = mode;
    this.onDone = onDone;
  }
  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("iap-cleanup-modal");
    const modeLabel = this.mode === ".trash" ? "Obsidian \u56DE\u6536\u7AD9" : this.mode === "system-trash" ? "\u7CFB\u7EDF\u56DE\u6536\u7AD9" : "\u6C38\u4E45\u5220\u9664\uFF08\u4E0D\u53EF\u6062\u590D\uFF09";
    const header = contentEl.createDiv({ cls: "iap-cleanup-header" });
    const titleRow = header.createDiv({ cls: "iap-cleanup-title-row" });
    titleRow.createEl("h3", { text: "\u6E05\u7406\u672A\u7528\u9644\u4EF6", cls: "iap-cleanup-title" });
    titleRow.createEl("span", { text: `${this.paths.length} \u4E2A\u6587\u4EF6`, cls: "iap-cleanup-count" });
    header.createEl("p", { text: `\u5220\u9664\u65B9\u5F0F\uFF1A${modeLabel}\u3002\u5220\u9664\u540E\u5C06\u6309\u56DE\u6536\u7AD9\u7B56\u7565\u5904\u7406\uFF0C\u8BF7\u6838\u5BF9\u5217\u8868\u540E\u786E\u8BA4\u3002`, cls: "iap-cleanup-desc" });
    const list = contentEl.createDiv({ cls: "iap-cleanup-list" });
    for (const p of this.paths.slice(0, 50)) {
      const row = list.createDiv({ cls: "iap-cleanup-row" });
      row.createSpan({ text: basenameOf4(p), cls: "iap-cleanup-name" });
      row.createSpan({ text: p, cls: "iap-cleanup-path" });
    }
    if (this.paths.length > 50) {
      list.createDiv({ text: `\u2026 \u53CA\u53E6\u5916 ${this.paths.length - 50} \u4E2A\u6587\u4EF6`, cls: "iap-cleanup-more" });
    }
    const footer = contentEl.createDiv({ cls: "iap-cleanup-footer" });
    new import_obsidian9.ButtonComponent(footer).setButtonText("\u53D6\u6D88").setClass("iap-btn").onClick(() => this.close());
    new import_obsidian9.ButtonComponent(footer).setButtonText(`\u786E\u8BA4\u5220\u9664\uFF08${this.paths.length}\uFF09`).setCta().setWarning().setClass("iap-btn").onClick(async () => {
      const r = await performDelete(this.app, this.paths, this.mode);
      this.onDone(r);
      this.close();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
function basenameOf4(path) {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}
async function runCleanupUnused(app, index, getSettings) {
  var _a, _b;
  const toast = createNoticer(() => getSettings().notificationLevel);
  const cleanup = getSettings().cleanup;
  if (!cleanup.enabled) {
    toast.summary("\u6E05\u7406\u80FD\u529B\u5DF2\u5173\u95ED\u3002");
    return { deleted: 0, excluded: 0, errors: 0, skipped: 0 };
  }
  const snapshot = await index.getSnapshot();
  const excludes = [...cleanup.excludedFolders, ...(_b = (_a = getSettings().paths) == null ? void 0 : _a.exclude) != null ? _b : []];
  const plan = planCleanup(snapshot.orphanCandidates, excludes, cleanup.excludeSubfolders);
  if (plan.toDelete.length === 0) {
    toast.summary(plan.excluded.length ? `\u6CA1\u6709\u53EF\u6E05\u7406\u9879\uFF08${plan.excluded.length} \u4E2A\u88AB\u6392\u9664\u76EE\u5F55\u4FDD\u7559\uFF09\u3002` : "\u6CA1\u6709\u672A\u4F7F\u7528\u7684\u9644\u4EF6\u3002");
    return { deleted: 0, excluded: plan.excluded.length, errors: 0, skipped: 0 };
  }
  const finish = (r2) => {
    index.markDirty();
    toast.summary(`\u6E05\u7406\u5B8C\u6210\uFF1A\u5220\u9664 ${r2.deleted}\uFF0C\u5931\u8D25 ${r2.errors}\uFF08\u6392\u9664 ${plan.excluded.length}\uFF0C\u590D\u68C0\u8DF3\u8FC7 ${r2.skipped}\uFF09\u3002`);
  };
  if (cleanup.requireConfirm) {
    new ConfirmCleanupModal(app, plan.toDelete, cleanup.deleteMode, finish).open();
    return { deleted: 0, excluded: plan.excluded.length, errors: 0, skipped: 0 };
  }
  const r = await performDelete(app, plan.toDelete, cleanup.deleteMode);
  finish(r);
  return { deleted: r.deleted, excluded: plan.excluded.length, errors: r.errors, skipped: r.skipped };
}

// src/features/empty-folder-cleaner.ts
var import_obsidian10 = require("obsidian");

// src/features/empty-folder-core.ts
function planEmptyFolderCleanup(files, folders) {
  const out = [];
  for (const folder of folders) {
    const prefix = `${folder}/`;
    let hasFile = false;
    let hasSub = false;
    for (const f of files) {
      if (f.startsWith(prefix)) {
        hasFile = true;
        break;
      }
    }
    if (hasFile) continue;
    for (const g of folders) {
      if (g !== folder && g.startsWith(prefix)) {
        hasSub = true;
        break;
      }
    }
    if (!hasSub) out.push(folder);
  }
  return out;
}

// src/features/empty-folder-cleaner.ts
var ConfirmEmptyFoldersModal = class extends import_obsidian10.Modal {
  constructor(app, folders, files, allFolders, onDone) {
    super(app);
    this.folders = folders;
    this.files = files;
    this.allFolders = allFolders;
    this.onDone = onDone;
  }
  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("iap-cleanup-modal");
    const header = contentEl.createDiv({ cls: "iap-cleanup-header" });
    const titleRow = header.createDiv({ cls: "iap-cleanup-title-row" });
    titleRow.createEl("h3", { text: "\u6E05\u7406\u7A7A\u9644\u4EF6\u76EE\u5F55", cls: "iap-cleanup-title" });
    titleRow.createEl("span", { text: `${this.folders.length} \u4E2A\u7A7A\u76EE\u5F55`, cls: "iap-cleanup-count" });
    header.createEl("p", { text: "\u5C06\u628A\u4EE5\u4E0B\u7A7A\u76EE\u5F55\u79FB\u5165 Obsidian \u56DE\u6536\u7AD9\uFF1B\u5220\u9664\u540E\u9010\u5C42\u53D8\u7A7A\u7684\u7236\u76EE\u5F55\u4E5F\u4F1A\u4E00\u5E76\u6E05\u7406\u3002\u4EC5\u5220\u9664\u4E0D\u542B\u4EFB\u4F55\u6587\u4EF6\u4E0E\u5B50\u76EE\u5F55\u7684\u7A7A\u76EE\u5F55\u3002", cls: "iap-cleanup-desc" });
    const list = contentEl.createDiv({ cls: "iap-cleanup-list" });
    for (const p of this.folders) {
      const row = list.createDiv({ cls: "iap-cleanup-row" });
      row.createSpan({ text: p, cls: "iap-cleanup-path" });
    }
    const footer = contentEl.createDiv({ cls: "iap-cleanup-footer" });
    new import_obsidian10.ButtonComponent(footer).setButtonText("\u53D6\u6D88").setClass("iap-btn").onClick(() => this.close());
    new import_obsidian10.ButtonComponent(footer).setButtonText(`\u786E\u8BA4\u6E05\u7406\uFF08${this.folders.length}\uFF09`).setCta().setWarning().setClass("iap-btn").onClick(async () => {
      let removed = 0;
      let errors = 0;
      const removedSet = /* @__PURE__ */ new Set();
      let pool = [...this.folders];
      while (pool.length > 0) {
        const before = removed;
        for (const p of pool) {
          const f = this.app.vault.getAbstractFileByPath(p);
          if (!(f instanceof import_obsidian10.TFolder)) continue;
          try {
            await this.app.vault.trash(f, false);
            removed++;
            removedSet.add(p);
          } catch (e2) {
            errors++;
          }
        }
        if (removed === before) break;
        pool = planEmptyFolderCleanup(this.files, this.allFolders.filter((x) => !removedSet.has(x)));
      }
      this.onDone({ removed, errors });
      this.close();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
async function runCleanupEmptyFolders(app, getSettings) {
  var _a, _b, _c;
  const toast = createNoticer(() => getSettings().notificationLevel);
  const all = (_c = (_b = (_a = app.vault).getAllLoadedFiles) == null ? void 0 : _b.call(_a)) != null ? _c : app.vault.getFiles();
  const files = [];
  const folders = [];
  for (const f of all) {
    if (f.path.startsWith(".obsidian")) continue;
    if (f instanceof import_obsidian10.TFolder) folders.push(f.path);
    else files.push(f.path);
  }
  const empty = planEmptyFolderCleanup(files, folders);
  if (empty.length === 0) {
    toast.summary("\u6CA1\u6709\u9700\u8981\u6E05\u7406\u7684\u7A7A\u76EE\u5F55\u3002");
    return { removed: 0, errors: 0 };
  }
  const finish = (r) => {
    toast.summary(`\u6E05\u7406\u5B8C\u6210\uFF1A\u5220\u9664\u7A7A\u76EE\u5F55 ${r.removed}\uFF0C\u5931\u8D25 ${r.errors}\u3002`);
  };
  new ConfirmEmptyFoldersModal(app, empty, files, folders, finish).open();
  return { removed: 0, errors: 0 };
}

// src/features/exporter.ts
var import_obsidian11 = require("obsidian");

// src/features/export-name-core.ts
function pad2(n) {
  return String(n).padStart(2, "0");
}
function tsOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}
function uniqueFlatName(base, used, stamp) {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot >= 0 ? base.slice(dot) : "";
  let candidate = `${stem}_${stamp}${ext}`;
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let i = 1;
  candidate = `${stem}_${stamp}_${i}${ext}`;
  while (used.has(candidate)) {
    i++;
    candidate = `${stem}_${stamp}_${i}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

// src/features/exporter.ts
function e(name, s) {
  return { name, data: new TextEncoder().encode(s) };
}
async function readFile(app, path) {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof import_obsidian11.TFile)) return null;
  try {
    const buf = await app.vault.readBinary(f);
    return new Uint8Array(buf);
  } catch (e2) {
    return null;
  }
}
async function saveZip(app, zipPath, zip) {
  const existing = app.vault.getAbstractFileByPath(zipPath);
  if (existing instanceof import_obsidian11.TFile) {
    await app.vault.delete(existing);
  }
  await app.vault.createBinary(
    zipPath,
    zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength)
  );
}
function fileMtimeMs(app, path) {
  var _a;
  const f = app.vault.getAbstractFileByPath(path);
  return f instanceof import_obsidian11.TFile && ((_a = f.stat) == null ? void 0 : _a.mtime) ? f.stat.mtime : Date.now();
}
async function runExportNote(app, index, getSettings) {
  var _a, _b, _c, _d;
  const toast = createNoticer(() => getSettings().notificationLevel);
  const note = app.workspace.getActiveFile();
  if (!note) {
    toast.error("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u7B14\u8BB0\u3002");
    return;
  }
  if (!getSettings().exporter.enabled) {
    toast.summary("\u5BFC\u51FA\u80FD\u529B\u5DF2\u5173\u95ED\u3002");
    return;
  }
  const snapshot = await index.getSnapshot();
  const paths = [];
  for (const entry of snapshot.entries.values()) {
    if (entry.references.some((r) => r.sourcePath === note.path)) paths.push(entry.path);
  }
  if (paths.length === 0) {
    toast.summary("\u5F53\u524D\u7B14\u8BB0\u6CA1\u6709\u9644\u4EF6\u53EF\u5BFC\u51FA\u3002");
    return;
  }
  const entries = [e("manifest.json", JSON.stringify({
    plugin: "attachment-suite",
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    note: note.path,
    count: paths.length
  }, null, 2))];
  const nameMap = /* @__PURE__ */ new Map();
  for (const p of paths) {
    const base = (_a = p.split("/").pop()) != null ? _a : "file";
    const n = (_b = nameMap.get(base)) != null ? _b : 0;
    nameMap.set(base, n + 1);
    const finalName = n === 0 ? base : `${base.slice(0, base.lastIndexOf("."))}_${n}${base.slice(base.lastIndexOf("."))}`;
    const data = await readFile(app, p);
    entries.push({ name: finalName, data: data != null ? data : new Uint8Array() });
  }
  const zip = createZip(entries);
  const dir = (_d = (_c = note.parent) == null ? void 0 : _c.path) != null ? _d : "";
  const zipPath = (0, import_obsidian11.normalizePath)(dir ? `${dir}/${note.basename}_Attachments.zip` : `${note.basename}_Attachments.zip`);
  await saveZip(app, zipPath, zip);
  logger.info(`\u5BFC\u51FA\u5B8C\u6210\uFF1A${zipPath}`);
  toast.summary(`\u5BFC\u51FA\u4E86 ${paths.length} \u4E2A\u9644\u4EF6\u81F3 ${zipPath}\u3002`);
}
async function runExportOrphaned(app, index, getSettings) {
  var _a;
  const toast = createNoticer(() => getSettings().notificationLevel);
  if (!getSettings().exporter.enabled) {
    toast.summary("\u5BFC\u51FA\u80FD\u529B\u5DF2\u5173\u95ED\u3002");
    return;
  }
  const snapshot = await index.getSnapshot();
  const orphaned = snapshot.orphanCandidates;
  if (orphaned.length === 0) {
    toast.summary("\u6CA1\u6709\u672A\u4F7F\u7528\u7684\u9644\u4EF6\u53EF\u5BFC\u51FA\u3002");
    return;
  }
  const entries = [e("manifest.json", JSON.stringify({
    plugin: "attachment-suite",
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    count: orphaned.length
  }, null, 2))];
  const usedNames = /* @__PURE__ */ new Set();
  for (const p of orphaned) {
    const base = (_a = p.split("/").pop()) != null ? _a : "file";
    const name = uniqueFlatName(base, usedNames, tsOf(fileMtimeMs(app, p)));
    const data = await readFile(app, p);
    entries.push({ name, data: data != null ? data : new Uint8Array() });
  }
  const zip = createZip(entries);
  const zipPath = "Unused_Attachments.zip";
  await saveZip(app, zipPath, zip);
  logger.info(`\u5BFC\u51FA\u672A\u7528\u5B8C\u6210\uFF1A${zipPath}`);
  toast.summary(`\u5BFC\u51FA\u4E86 ${orphaned.length} \u4E2A\u672A\u7528\u9644\u4EF6\u81F3 ${zipPath}\u3002`);
}

// src/features/bulk-rename-core.ts
function planBulkRename(snapshot, naming) {
  const noteNames = /* @__PURE__ */ new Map();
  for (const e2 of snapshot.entries.values()) {
    for (const r of e2.references) {
      if (!noteNames.has(r.sourcePath)) noteNames.set(r.sourcePath, noteNameOf(r.sourcePath));
    }
  }
  const owners = /* @__PURE__ */ new Map();
  for (const e2 of snapshot.entries.values()) {
    if (e2.references.length === 0) continue;
    const set = /* @__PURE__ */ new Set();
    for (const r of e2.references) set.add(r.sourcePath);
    owners.set(e2.path, set);
  }
  let sharedCount = 0;
  for (const set of owners.values()) if (set.size > 1) sharedCount++;
  const perNote = /* @__PURE__ */ new Map();
  let total = 0;
  for (const [notePath, noteName] of noteNames) {
    const items = planForSnapshot(snapshot, notePath, noteName, naming, naming.folderByCategory, "");
    if (items.length === 0) continue;
    perNote.set(notePath, { noteName, items });
    total += items.length;
  }
  return { perNote, sharedCount, total };
}
function basenameOf5(path) {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}
function noteNameOf(path) {
  const base = basenameOf5(path);
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(0, i) : base;
}

// src/features/bulk-rename.ts
async function runBulkRename(app, index, getSettings, mover, confirm = true) {
  var _a, _b;
  const toast = createNoticer(() => getSettings().notificationLevel);
  const naming = getSettings().naming;
  if (!naming.enabled) {
    toast.summary("\u547D\u540D\u80FD\u529B\u5DF2\u5173\u95ED\u3002");
    return { notes: 0, renamed: 0, copied: 0, errors: 0 };
  }
  const snapshot = await index.getSnapshot();
  const exclude = (_b = (_a = getSettings().paths) == null ? void 0 : _a.exclude) != null ? _b : [];
  const notes = app.vault.getFiles().filter((f) => f.extension === "md" || f.extension === "canvas").filter((f) => !isPathExcluded(f.path, exclude)).map((f) => f.path);
  const plan = planBulkRename(snapshot, naming);
  const included = new Set(notes);
  for (const key of Array.from(plan.perNote.keys())) {
    if (!included.has(key)) plan.perNote.delete(key);
  }
  plan.total = Array.from(plan.perNote.values()).reduce((s, np) => s + np.items.length, 0);
  if (plan.total === 0) {
    toast.summary("\u5168\u5E93\u6CA1\u6709\u9700\u8981\u91CD\u547D\u540D\u7684\u9644\u4EF6\u3002");
    return { notes: 0, renamed: 0, copied: 0, errors: 0 };
  }
  const execute = async () => {
    var _a2;
    let renamed = 0;
    let copied = 0;
    let errors = 0;
    for (const path of notes) {
      try {
        const r = await runRenameNote(app, index, getSettings, mover, false, path, snapshot, false);
        renamed += r.moved;
        copied += (_a2 = r.copied) != null ? _a2 : 0;
        errors += r.errors;
      } catch (e2) {
        logger.error(`\u5168\u5E93\u547D\u540D\u5355\u7BC7\u5931\u8D25 ${path}: ${e2 instanceof Error ? e2.message : String(e2)}`);
        errors++;
      }
    }
    index.markDirty();
    toast.summary(`\u5168\u5E93\u547D\u540D\u5B8C\u6210\uFF1A\u91CD\u547D\u540D ${renamed}\uFF0C\u590D\u5236 ${copied}\uFF0C\u5931\u8D25 ${errors}\u3002`);
    return { notes: notes.length, renamed, copied, errors };
  };
  if (confirm) {
    new ConfirmChangesModal(app, {
      title: "\u91CD\u547D\u540D\u5168\u5E93\u9644\u4EF6",
      desc: `\u5C06\u4EE5\u300C\u7B14\u8BB0_\u7C7B\u522B_\u5E8F\u53F7\u300D\u89C4\u8303\u91CD\u547D\u540D\u5168\u5E93 ${notes.length} \u7BC7\u7B14\u8BB0\u88AB\u5F15\u7528\u7684\u9644\u4EF6\uFF1B\u88AB\u591A\u7BC7\u7B14\u8BB0\u5171\u7528\u7684\u9644\u4EF6\u4E3A\u6BCF\u7BC7\u5F15\u7528\u7B14\u8BB0\u590D\u5236\u526F\u672C\u3002\u6392\u9664\u76EE\u5F55\u5DF2\u8DF3\u8FC7\u3002`,
      rows: bulkRows(plan),
      confirmText: `\u786E\u8BA4\u91CD\u547D\u540D\uFF08${notes.length} \u7BC7 \xB7 ${plan.total} \u4E2A\u9644\u4EF6\uFF09`,
      onConfirm: async () => {
        await execute();
      }
    }).open();
    return { notes: 0, renamed: 0, copied: 0, errors: 0 };
  }
  return execute();
}
function bulkRows(plan) {
  const noteCount = plan.perNote.size;
  const items = Array.from(plan.perNote.values());
  if (plan.total <= 20 && noteCount <= 5) {
    const rows = [];
    for (const np of items) {
      for (const it of np.items) rows.push({ from: it.from, to: it.to });
    }
    return rows;
  }
  return items.map((np) => ({ from: `${np.noteName}`, to: `${np.items.length} \u4E2A\u9644\u4EF6` }));
}

// src/features/bulk-localize.ts
async function runBulkLocalize(app, index, getSettings, downloader, confirm = true) {
  var _a, _b, _c;
  const toast = createNoticer(() => getSettings().notificationLevel);
  const localize = getSettings().localize;
  if (!localize.enabled) {
    toast.summary("\u672C\u5730\u5316\u80FD\u529B\u5DF2\u5173\u95ED\u3002");
    return { notes: 0, downloaded: 0, skipped: 0, errors: 0 };
  }
  const exclude = (_b = (_a = getSettings().paths) == null ? void 0 : _a.exclude) != null ? _b : [];
  const scanHtml = (_c = localize.scanHtmlAndLinks) != null ? _c : false;
  const notes = app.vault.getFiles().filter((f) => f.extension === "md" && !isPathExcluded(f.path, exclude));
  const preview = [];
  let totalExternal = 0;
  for (const note of notes) {
    let count = 0;
    try {
      const text = await app.vault.read(note);
      count = findExternalRefs(text, scanHtml).length;
    } catch (e2) {
      logger.error(`\u5168\u5E93\u672C\u5730\u5316\u9884\u89C8\u8BFB\u53D6\u5931\u8D25 ${note.path}: ${e2 instanceof Error ? e2.message : String(e2)}`);
      count = 0;
    }
    if (count > 0) {
      preview.push({ path: note.path, name: note.basename, count });
      totalExternal += count;
    }
  }
  if (totalExternal === 0) {
    toast.summary("\u5168\u5E93\u6CA1\u6709\u53EF\u672C\u5730\u5316\u7684\u5916\u90E8\u5F15\u7528\u3002");
    return { notes: 0, downloaded: 0, skipped: 0, errors: 0 };
  }
  const execute = async () => {
    let downloaded = 0;
    let skipped = 0;
    let errors = 0;
    for (const p of preview) {
      try {
        const r = await runLocalizeNote(app, index, getSettings, downloader, p.path, void 0, false);
        downloaded += r.downloaded;
        skipped += r.skipped;
      } catch (e2) {
        logger.error(`\u5168\u5E93\u672C\u5730\u5316\u5355\u7BC7\u5931\u8D25 ${p.path}: ${e2 instanceof Error ? e2.message : String(e2)}`);
        errors++;
      }
    }
    index.markDirty();
    toast.summary(`\u5168\u5E93\u672C\u5730\u5316\u5B8C\u6210\uFF1A\u4E0B\u8F7D ${downloaded}\uFF0C\u8DF3\u8FC7 ${skipped}\uFF0C\u5931\u8D25 ${errors}\u3002`);
    return { notes: preview.length, downloaded, skipped, errors };
  };
  if (confirm) {
    new ConfirmChangesModal(app, {
      title: "\u672C\u5730\u5316\u5168\u5E93\u5916\u90E8\u5A92\u4F53",
      desc: `\u5C06\u626B\u63CF\u5168\u5E93 ${preview.length} \u7BC7\u7B14\u8BB0\uFF08\u5171 ${totalExternal} \u4E2A\u5916\u94FE\uFF09\uFF0C\u4E0B\u8F7D\u5230\u9644\u4EF6\u76EE\u5F55\u5E76\u6539\u5199\u4E3A\u672C\u5730\u5F15\u7528\uFF1B\u91CF\u5927\u4F1A\u8017\u65F6\u3002\u6392\u9664\u76EE\u5F55\u5DF2\u8DF3\u8FC7\u3002`,
      rows: preview.map((p) => ({ from: p.name, to: `${p.count} \u4E2A\u5916\u94FE` })),
      confirmText: `\u786E\u8BA4\u672C\u5730\u5316\uFF08${preview.length} \u7BC7\uFF09`,
      onConfirm: async () => {
        await execute();
      }
    }).open();
    return { notes: 0, downloaded: 0, skipped: 0, errors: 0 };
  }
  return execute();
}

// src/commands.ts
async function traceCommand(name, fn) {
  const t0 = Date.now();
  console.log(`[AttachmentSuite] cmd START: ${name} (${t0})`);
  new import_obsidian12.Notice(`Attachment Suite
\u6267\u884C\u547D\u4EE4\uFF1A${name}`, 2e3);
  try {
    await fn();
  } finally {
    console.log(`[AttachmentSuite] cmd done: ${name} (${Date.now() - t0}ms)`);
  }
}
function createCommands(ctx) {
  return [
    {
      id: "attachment:check-consistency",
      name: "\u68C0\u67E5\u5E93\u4E00\u81F4\u6027\uFF08\u751F\u6210\u62A5\u544A\uFF09",
      callback: async () => {
        await traceCommand("\u4E00\u81F4\u6027\u5BA1\u8BA1", async () => {
          const consistency = ctx.getSettings().consistency;
          const toast = createNoticer(() => ctx.getSettings().notificationLevel);
          if (!consistency.enabled) {
            toast.summary("\u4E00\u81F4\u6027\u80FD\u529B\u5DF2\u5173\u95ED\u3002");
            return;
          }
          const t0 = Date.now();
          const snap = await ctx.index.build();
          const ms = Date.now() - t0;
          const fixes = planPathFixes(snap.entries.keys(), profileFromPlatforms(consistency.platforms));
          const showBroken = consistency.reportBrokenLinks;
          logger.info(
            `\u4E00\u81F4\u6027\u5BA1\u8BA1\uFF1A\u6761\u76EE ${snap.entries.size}\uFF0C\u574F\u5F15\u7528 ${snap.brokenRefs.length}\uFF0C\u5B64\u513F ${snap.orphanCandidates.length}\uFF0C\u53EF\u4FEE\u590D\u8DEF\u5F84 ${fixes.length}\uFF08${ms}ms\uFF09`
          );
          new ReportModal(ctx.app, {
            title: "\u5E93\u4E00\u81F4\u6027\u62A5\u544A",
            summary: `\u9644\u4EF6 ${snap.entries.size} \xB7 \u574F\u94FE\u63A5 ${snap.brokenRefs.length} \xB7 \u672A\u7528 ${snap.orphanCandidates.length} \xB7 \u53EF\u4FEE\u590D\u8DEF\u5F84 ${fixes.length}`,
            sections: [
              {
                title: "\u672A\u4F7F\u7528\u9644\u4EF6",
                count: snap.orphanCandidates.length,
                items: snap.orphanCandidates,
                emptyText: "\u65E0\u672A\u4F7F\u7528\u9644\u4EF6"
              },
              ...showBroken ? [{
                title: "\u574F\u94FE\u63A5\uFF08\u6307\u5411\u4E0D\u5B58\u5728\u6587\u4EF6\uFF09",
                count: snap.brokenRefs.length,
                items: snap.brokenRefs.map((b) => `${b.sourcePath} \u2192 ${b.linkText}`),
                emptyText: "\u65E0\u574F\u94FE\u63A5"
              }] : [],
              {
                title: "\u9700\u4FEE\u590D\u7684\u4E0D\u517C\u5BB9\u8DEF\u5F84",
                count: fixes.length,
                items: fixes.map((f) => `${f.from} \u2192 ${f.to}`),
                emptyText: "\u65E0\u4E0D\u517C\u5BB9\u8DEF\u5F84"
              }
            ]
          }).open();
        });
      }
    },
    {
      id: "attachment:cleanup-unused",
      name: "\u6E05\u7406\u672A\u7528\u9644\u4EF6",
      callback: async () => {
        await traceCommand("\u6E05\u7406\u672A\u7528\u9644\u4EF6", () => runCleanupUnused(ctx.app, ctx.index, ctx.getSettings));
      }
    },
    {
      id: "attachment:cleanup-empty-folders",
      name: "\u6E05\u7406\u7A7A\u9644\u4EF6\u76EE\u5F55",
      callback: async () => {
        await traceCommand("\u6E05\u7406\u7A7A\u9644\u4EF6\u76EE\u5F55", () => runCleanupEmptyFolders(ctx.app, ctx.getSettings));
      }
    },
    {
      id: "attachment:rename-note",
      name: "\u91CD\u547D\u540D\u5F53\u524D\u7B14\u8BB0\u9644\u4EF6\uFF08\u7EDF\u4E00\u547D\u540D\uFF09",
      callback: async () => {
        await traceCommand("\u7EDF\u4E00\u547D\u540D", () => runRenameNote(ctx.app, ctx.index, ctx.getSettings, ctx.mover));
      }
    },
    {
      id: "attachment:repair-incompatible-paths",
      name: "\u4FEE\u590D\u4E0D\u517C\u5BB9\u8DEF\u5F84",
      callback: async () => {
        await traceCommand("\u4FEE\u590D\u4E0D\u517C\u5BB9\u8DEF\u5F84", () => runRepairPaths(ctx.app, ctx.index, ctx.getSettings, ctx.mover));
      }
    },
    {
      id: "attachment:localize-note",
      name: "\u672C\u5730\u5316\u5F53\u524D\u7B14\u8BB0\u9644\u4EF6",
      callback: async () => {
        await traceCommand("\u672C\u5730\u5316\u5F53\u524D\u7B14\u8BB0", async () => {
          const r = await runLocalizeNote(ctx.app, ctx.index, ctx.getSettings, ctx.downloader);
          if (r.downloaded > 0 && ctx.getSettings().naming.enabled) {
            await runRenameNote(ctx.app, ctx.index, ctx.getSettings, ctx.mover, false);
          }
        });
      }
    },
    {
      id: "attachment:collect-current-note",
      name: "\u6536\u96C6\u5F53\u524D\u7B14\u8BB0\u9644\u4EF6\u5230\u5F52\u5C5E\u76EE\u5F55",
      callback: async () => {
        await traceCommand("\u6536\u96C6\u6563\u843D\u9644\u4EF6", () => runCollectNote(ctx.app, ctx.index, ctx.getSettings, ctx.mover));
      }
    },
    {
      id: "attachment:export-note",
      name: "\u5BFC\u51FA\u5F53\u524D\u7B14\u8BB0\u9644\u4EF6\uFF08zip\uFF09",
      callback: async () => {
        await traceCommand("\u5BFC\u51FA\u5F53\u524D\u7B14\u8BB0\u9644\u4EF6", () => runExportNote(ctx.app, ctx.index, ctx.getSettings));
      }
    },
    {
      id: "attachment:export-unused",
      name: "\u5BFC\u51FA\u672A\u7528\u9644\u4EF6\uFF08zip\uFF09",
      callback: async () => {
        await traceCommand("\u5BFC\u51FA\u672A\u7528\u9644\u4EF6", () => runExportOrphaned(ctx.app, ctx.index, ctx.getSettings));
      }
    },
    {
      id: "attachment:bulk-rename",
      name: "\u91CD\u547D\u540D\u5168\u5E93\u9644\u4EF6\uFF08\u5168\u5E93\u7EDF\u4E00\u547D\u540D\uFF09",
      callback: async () => {
        await traceCommand("\u5168\u5E93\u7EDF\u4E00\u547D\u540D", () => runBulkRename(ctx.app, ctx.index, ctx.getSettings, ctx.mover, true));
      }
    },
    {
      id: "attachment:bulk-localize",
      name: "\u672C\u5730\u5316\u5168\u5E93\u9644\u4EF6\uFF08\u5168\u5E93\u6279\u91CF\u4E0B\u8F7D\u5916\u94FE\u5A92\u4F53\uFF09",
      callback: async () => {
        await traceCommand(
          "\u5168\u5E93\u672C\u5730\u5316",
          () => runBulkLocalize(ctx.app, ctx.index, ctx.getSettings, ctx.downloader, true)
        );
      }
    }
  ];
}

// src/features/note-relocator.ts
var import_obsidian13 = require("obsidian");

// src/features/note-relocator-core.ts
function parentOf(path) {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}
function basenameOf6(path) {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}
function attachmentTargetsFromText(text) {
  const names = /* @__PURE__ */ new Set();
  for (const m of listMatches(text)) {
    if (/^https?:/i.test(m.linkText)) continue;
    if (m.linkText.endsWith(".md") || m.linkText.endsWith(".canvas")) continue;
    if (!isManagedAttachment(extOf(m.linkText))) continue;
    names.add(basenameOf6(m.linkText));
  }
  return Array.from(names);
}
function planRelocation(targets, oldDir, newDir) {
  const moves = [];
  for (const name of targets) {
    const from = oldDir ? `${oldDir}/${name}` : name;
    const to = newDir ? `${newDir}/${name}` : name;
    if (from === to) continue;
    moves.push({ from, to });
  }
  return moves;
}

// src/features/note-relocator.ts
async function runFollowNoteMove(app, mover, getSettings, notePath, oldPath) {
  const consistency = getSettings().consistency;
  if (!consistency.enabled || !consistency.followNoteMove) return;
  const file = app.vault.getAbstractFileByPath(notePath);
  if (!(file instanceof import_obsidian13.TFile)) return;
  const folder = renderAttachmentFolderTemplate(
    effectiveAttachmentFolder(app, getSettings()),
    file.basename,
    parentOf(notePath),
    /* @__PURE__ */ new Date()
  );
  if (!isNoteRelativeFolder(folder)) return;
  const oldParent = parentOf(oldPath);
  const newParent = parentOf(notePath);
  if (oldParent === newParent) return;
  const oldDir = resolveAttachmentDir(oldParent, folder);
  const newDir = resolveAttachmentDir(newParent, folder);
  if (oldDir === newDir) return;
  let text = "";
  try {
    text = await app.vault.read(file);
  } catch (e2) {
    return;
  }
  const targets = attachmentTargetsFromText(text);
  const moves = planRelocation(targets, oldDir, newDir);
  if (moves.length === 0) return;
  const movedMoves = [];
  for (const m of moves) {
    if (await app.vault.adapter.exists(m.from)) movedMoves.push(m);
  }
  if (movedMoves.length === 0) return;
  await ensureFolder(app, newDir);
  const out = await mover.moveMany(movedMoves);
  await rewriteRefsInNote(app, notePath, refMapForMoves(out.results));
  logger.info(`\u7B14\u8BB0\u79FB\u52A8\u8054\u52A8\uFF1A\u8FC1\u79FB ${out.results.length} \u4E2A\u9644\u4EF6 ${oldDir || "(\u6839)"} \u2192 ${newDir || "(\u6839)"}`);
}

// src/features/automation.ts
var import_obsidian14 = require("obsidian");
var autoBusy = false;
function isAutoBusy() {
  return autoBusy;
}
async function runAutoProcess(app, index, getSettings, downloader, mover, notePath) {
  var _a;
  const s = getSettings();
  if (!((_a = s.automation) == null ? void 0 : _a.enabled)) return { downloaded: 0, renamed: 0 };
  if (!notePath) return { downloaded: 0, renamed: 0 };
  if (autoBusy) return { downloaded: 0, renamed: 0 };
  autoBusy = true;
  try {
    console.log("[AttachmentSuite] runAutoProcess START", notePath, Date.now());
    const dl = await runLocalizeNote(app, index, getSettings, downloader, notePath, void 0, false);
    let renamed = 0;
    const namingEnabled = s.naming.enabled;
    if (namingEnabled) {
      const r = await runRenameNote(app, index, getSettings, mover, false, notePath, void 0, false);
      renamed = r.moved;
    }
    console.log("[AttachmentSuite] runAutoProcess", notePath, { found: dl.found, downloaded: dl.downloaded, skipped: dl.skipped, renamed });
    const show = (kind, msg) => {
      if (shouldNotify(s.notificationLevel, kind)) {
        new import_obsidian14.Notice(`Attachment Suite
${msg}`, effectiveDuration(kind, msg));
      }
    };
    if (dl.downloaded > 0 || renamed > 0) {
      show("summary", `\u672C\u5730\u5316\uFF1A\u4E0B\u8F7D ${dl.downloaded}\uFF0C\u8DF3\u8FC7 ${dl.skipped}\uFF1B\u81EA\u52A8\u547D\u540D\uFF1A${renamed} \u4E2A\u9644\u4EF6`);
    } else if (dl.found > 0) {
      show("error", `\u68C0\u6D4B\u5230 ${dl.found} \u5904\u5916\u90E8\u56FE\u7247\uFF0C\u4F46\u4E0B\u8F7D\u5931\u8D25/\u88AB\u8DF3\u8FC7\uFF08${dl.skipped}\uFF09\u3002\u8BF7\u68C0\u67E5\u7F51\u7EDC\u6216\u94FE\u63A5\u6709\u6548\u6027\u3002`);
    }
    return { downloaded: dl.downloaded, renamed };
  } catch (e2) {
    console.error("[AttachmentSuite] runAutoProcess ERROR", notePath, e2);
    if (shouldNotify(s.notificationLevel, "error")) {
      new import_obsidian14.Notice(`Attachment Suite
\u81EA\u52A8\u5904\u7406\u51FA\u9519\uFF1A${e2 instanceof Error ? e2.message : String(e2)}`, effectiveDuration("error", String(e2 instanceof Error ? e2.message : e2)));
    }
    return { downloaded: 0, renamed: 0 };
  } finally {
    autoBusy = false;
  }
}

// src/main.ts
var isTestEnv = typeof globalThis.__OBSIDIAN_TEST !== "undefined";
var STARTUP_SUPPRESS_MS = isTestEnv ? 0 : 1500;
var AttachmentSuitePlugin = class extends import_obsidian15.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.queue = new TaskQueue();
    // 事件节流：metadataCache 高频触发时延迟 markDirty。
    this.indexDirtyTimer = null;
    // 自动处理：待处理（脏）笔记集合 + 轮询间隔句柄（参考 obsidian-local-images-plus 的定时清扫模式）。
    this.dirtyNotes = /* @__PURE__ */ new Set();
    this.autoIntervalId = null;
    /** 插件 ready 时刻（纳秒起算点），用于启动抑制窗口。 */
    this.automationReadyAt = 0;
  }
  async onload() {
    var _a;
    console.log("[AttachmentSuite] onload START", Date.now());
    try {
      await this.loadSettings();
      this.index = new AttachmentIndex(
        new ObsidianVaultAdapter(this.app),
        new ObsidianMetadataProvider(this.app)
      );
      this.mover = new SafeMoveEngine(new ObsidianFileOps(this.app));
      this.downloader = new ObsidianDownloader(() => this.settings);
      this.addSettingTab(new AttachmentSettingTab(this.app, this));
      for (const cmd of createCommands({
        app: this.app,
        index: this.index,
        mover: this.mover,
        downloader: this.downloader,
        getSettings: () => this.settings
      })) {
        this.addCommand({ id: cmd.id, name: cmd.name, callback: cmd.callback });
      }
      this.automationReadyAt = Date.now();
      this.wireEvents();
      this.startAutomationSweep();
      logger.info(`Attachment Suite \u5DF2\u52A0\u8F7D\uFF08v${this.manifest.version}\uFF09`);
      if ((_a = this.settings.automation) == null ? void 0 : _a.enabled) {
        console.log("[AttachmentSuite] onload OK, automation=", this.settings.automation, Date.now());
        new import_obsidian15.Notice(`Attachment Suite v${this.manifest.version} \u5DF2\u52A0\u8F7D\uFF08\u81EA\u52A8\u5904\u7406\uFF1A\u5F00 \xB7 \u95F4\u9694 ${this.settings.automation.interval} \u79D2\uFF09`, 3e3);
      } else {
        console.log("[AttachmentSuite] onload OK, automation \u5173\u95ED, automation=", this.settings.automation, Date.now());
      }
    } catch (e2) {
      console.error("[AttachmentSuite] onload FAILED:", e2);
      throw e2;
    }
  }
  onunload() {
    if (this.indexDirtyTimer !== null) {
      window.clearTimeout(this.indexDirtyTimer);
      this.indexDirtyTimer = null;
    }
    if (this.autoIntervalId !== null) {
      window.clearInterval(this.autoIntervalId);
      this.autoIntervalId = null;
    }
    this.dirtyNotes.clear();
  }
  async loadSettings() {
    const raw = await this.loadData();
    this.settings = migrateSettings(raw);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  wireEvents() {
    this.registerEvent(this.app.vault.on("create", (file) => this.onVaultFileChange(file)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.onRename(file, oldPath)));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleDirty()));
    this.registerEvent(this.app.vault.on("modify", (file) => this.onVaultFileChange(file)));
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => this.onVaultFileChange(file))
    );
    this.registerEvent(
      this.app.workspace.on("editor-paste", (evt) => {
        this.onPaste(evt);
      })
    );
  }
  /** md/canvas 内容或元数据变化 → 索引失效 + 标记待自动处理（轮询统一起处理）。 */
  onVaultFileChange(file) {
    var _a, _b;
    this.scheduleDirty();
    if (!file || typeof file.path !== "string") return;
    if (!/\.(md|canvas)$/i.test(file.path)) return;
    if (!((_a = this.settings.automation) == null ? void 0 : _a.enabled)) return;
    if (isAutoBusy()) return;
    if (STARTUP_SUPPRESS_MS > 0 && Date.now() - this.automationReadyAt < STARTUP_SUPPRESS_MS) return;
    this.dirtyNotes.add(file.path);
    console.log("[AttachmentSuite] markDirty", file.path, "| enabled=", (_b = this.settings.automation) == null ? void 0 : _b.enabled);
  }
  /** 拦截粘贴：剪贴板含外部/data 图片引用时，标记活动笔记待自动处理。 */
  onPaste(evt) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    const s = this.settings;
    if (!((_a = s.automation) == null ? void 0 : _a.enabled) || !s.localize.enabled) return;
    if (!evt.clipboardData || !Array.isArray(evt.clipboardData.items)) return;
    const note = this.app.workspace.getActiveFile();
    if (!note || !/\.(md|canvas)$/i.test(note.path)) return;
    try {
      let html = "";
      let plain = "";
      for (const item of (_b = evt.clipboardData.items) != null ? _b : []) {
        if (item && item.kind === "string") {
          const type = String((_c = item.type) != null ? _c : "");
          if (type === "text/html") html = (_f = (_e = (_d = evt.clipboardData).getData) == null ? void 0 : _e.call(_d, type)) != null ? _f : "";
          else if (type === "text/plain") plain = (_i = (_h = (_g = evt.clipboardData).getData) == null ? void 0 : _h.call(_g, type)) != null ? _i : "";
        }
      }
      const md = (html ? (0, import_obsidian15.htmlToMarkdown)(html) : "") + "\n" + (plain || "");
      if (findExternalRefs(md).length === 0) return;
      this.dirtyNotes.add(note.path);
    } catch (e2) {
    }
  }
  /** 定时轮询清扫脏笔记（参照 obsidian-local-images-plus 的 realTimeUpdateInterval 轮询模式）。 */
  startAutomationSweep() {
    var _a, _b;
    const intervalSec = Math.max(1, (_b = (_a = this.settings.automation) == null ? void 0 : _a.interval) != null ? _b : 5);
    this.autoIntervalId = window.setInterval(() => {
      void this.sweepAuto();
    }, intervalSec * 1e3);
    this.registerInterval(this.autoIntervalId);
  }
  /** 从磁盘重读并处理当前所有待处理笔记（幂等：已本地化/改名的不再处理）。 */
  async sweepAuto() {
    var _a, _b;
    const s = this.settings;
    if (!((_a = s.automation) == null ? void 0 : _a.enabled) || this.queue.isProcessing()) {
      console.log("[AttachmentSuite] sweep skip", { enabled: (_b = s.automation) == null ? void 0 : _b.enabled, busy: this.queue.isProcessing() });
      return;
    }
    if (this.dirtyNotes.size === 0) return;
    const paths = Array.from(this.dirtyNotes);
    this.dirtyNotes.clear();
    console.log("[AttachmentSuite] sweep processing", paths);
    for (const notePath of paths) {
      void this.queue.enqueue(
        () => runAutoProcess(this.app, this.index, () => this.settings, this.downloader, this.mover, notePath).then(
          (r) => console.log("[AttachmentSuite] auto done", notePath, r, Date.now())
        )
      );
    }
  }
  onRename(file, oldPath) {
    this.scheduleDirty();
    if (!(file instanceof import_obsidian15.TFile)) return;
    void this.queue.enqueue(
      () => runFollowNoteMove(this.app, this.mover, () => this.settings, file.path, oldPath)
    );
  }
  scheduleDirty() {
    if (this.indexDirtyTimer !== null) {
      window.clearTimeout(this.indexDirtyTimer);
    }
    this.indexDirtyTimer = window.setTimeout(() => {
      this.indexDirtyTimer = null;
      this.index.markDirty();
      void this.queue.enqueue(async () => void 0);
    }, 300);
  }
};
