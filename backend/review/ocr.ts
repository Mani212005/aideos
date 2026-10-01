/**
 * File Description: On-screen text measurement for `aideos review`.
 * Runs tesseract on full-resolution sample frames (piped as PGM, no temp files) and turns its word
 * boxes into the facts the rubric needs: is there a caption band along the bottom, how many words
 * are too small or too faint to read, does text overlap other text or leave the safe margin, and
 * which numbers are on screen. Sizes are normalised to a 1080 short side so a reel and a wide cut
 * are held to the same standard. The geometry (`analyzeSample`) is pure and unit tested.
 */

import { spawn } from "node:child_process";
import { THRESHOLDS } from "./thresholds";

/** One word tesseract found, in pixels of the sampled frame. */
export interface OcrWord {
  text: string;
  conf: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What one sampled frame shows. */
export interface SampleAnalysis {
  t: number;
  words: number;
  /** A caption band (>= 3 caption-sized words on a line in the bottom quarter) is present. */
  hasCaption: boolean;
  /** Lines of caption-sized text in the band. */
  captionLines: number;
  /** The caption words read in the band, in reading order. */
  captionText: string;
  smallWords: number;
  lowContrastWords: number;
  /** Pairs of words whose boxes overlap each other. */
  overlaps: number;
  /** Words closer to the frame edge than the safe margin. */
  offSafe: number;
  /** Numeric tokens on screen. */
  numbers: string[];
  /** Smallest word box height, px at 1080 short side. */
  minHeight: number | null;
}

// Parses tesseract's TSV output into word boxes, dropping empty text and non-word rows.
export function parseTsv(tsv: string): OcrWord[] {
  const lines = tsv.split("\n");
  const header = lines[0]?.split("\t") ?? [];
  const col = (name: string) => header.indexOf(name);
  const [iText, iConf, iLeft, iTop, iW, iH] = ["text", "conf", "left", "top", "width", "height"].map(col);
  if ([iText, iConf, iLeft, iTop, iW, iH].some((i) => i < 0)) return [];
  const words: OcrWord[] = [];
  for (const line of lines.slice(1)) {
    const f = line.split("\t");
    const text = (f[iText] ?? "").trim();
    const conf = Number(f[iConf]);
    if (!text || !Number.isFinite(conf) || conf < 0) continue;
    words.push({ text, conf, left: Number(f[iLeft]), top: Number(f[iTop]), width: Number(f[iW]), height: Number(f[iH]) });
  }
  return words;
}

// Wraps a gray frame as a binary PGM, which tesseract reads straight from stdin.
function toPgm(gray: Uint8Array, width: number, height: number): Buffer {
  return Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), Buffer.from(gray.buffer, gray.byteOffset, gray.byteLength)]);
}

// Runs tesseract over one gray frame (sparse-text mode, one thread so several can run side by side).
export function ocrFrame(gray: Uint8Array, width: number, height: number): Promise<OcrWord[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("tesseract", ["stdin", "stdout", "--psm", "11", "tsv"], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, OMP_THREAD_LIMIT: "1" } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => reject(new Error(`could not run tesseract: ${e.message}. Install it (brew install tesseract) to measure captions and readability.`)));
    child.on("close", (code) => (code === 0 ? resolve(parseTsv(out)) : reject(new Error(`tesseract failed: ${err.trim().slice(0, 300)}`))));
    child.stdin.on("error", () => undefined);
    child.stdin.end(toPgm(gray, width, height));
  });
}

// Relative luminance of an 8-bit gray level, using a plain gamma curve.
function luminance(v: number): number {
  return Math.pow(v / 255, 2.2);
}

// WCAG-style contrast of a word box against its own surroundings, from its 2nd and 98th percentile luminance.
export function boxContrast(gray: Uint8Array, width: number, height: number, w: OcrWord): number {
  const x0 = Math.max(0, w.left);
  const y0 = Math.max(0, w.top);
  const x1 = Math.min(width, w.left + w.width);
  const y1 = Math.min(height, w.top + w.height);
  const bins = new Uint32Array(256);
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      bins[gray[y * width + x]]++;
      n++;
    }
  }
  if (n === 0) return 21;
  const at = (p: number) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += bins[v];
      if (seen >= p * n) return v;
    }
    return 255;
  };
  const lo = luminance(at(0.02));
  const hi = luminance(at(0.98));
  return (hi + 0.05) / (lo + 0.05);
}

// True when two word boxes overlap by more than `ratio` of the smaller box's area.
function overlapping(a: OcrWord, b: OcrWord, ratio: number): boolean {
  const ix = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const iy = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  if (ix <= 0 || iy <= 0) return false;
  return (ix * iy) / Math.min(a.width * a.height, b.width * b.height) > ratio;
}

// Measures one sampled frame: caption band, small and faint words, overlaps, edge crowding, numbers.
export function analyzeSample(words: OcrWord[], gray: Uint8Array | null, width: number, height: number, t: number): SampleAnalysis {
  const unit = Math.min(width, height) / 1080;
  const T = THRESHOLDS;
  const confident = words.filter((w) => w.conf >= T.readability.confidenceMin && w.text.length > 1 && /[A-Za-z0-9]/.test(w.text));

  const band = confident.filter((w) => w.top > height * T.captions.bandTopRatio && w.height / unit >= T.captions.wordHeightMin);
  const lines = new Map<number, OcrWord[]>();
  for (const w of band) {
    const key = Math.round(w.top / (20 * unit));
    lines.set(key, [...(lines.get(key) ?? []), w]);
  }
  // Rows whose keys are adjacent are one line split by rounding; merge them before counting lines.
  const keys = [...lines.keys()].sort((a, b) => a - b);
  const merged: OcrWord[][] = [];
  keys.forEach((k, i) => {
    if (i > 0 && k - keys[i - 1] <= 1 && merged.length) merged[merged.length - 1].push(...lines.get(k)!);
    else merged.push([...lines.get(k)!]);
  });
  const captionRows = merged.filter((row) => row.length >= 3);
  const captionText = captionRows
    .sort((a, b) => a[0].top - b[0].top)
    .map((row) => row.sort((a, b) => a.left - b.left).map((w) => w.text).join(" "))
    .join(" ");

  let small = 0;
  let faint = 0;
  let offSafe = 0;
  const margin = T.overlap.safeMarginPx * unit;
  for (const w of confident) {
    if (w.height / unit < T.readability.wordHeightMin) small++;
    if (gray && boxContrast(gray, width, height, w) < T.readability.contrastMin) faint++;
    if (w.left < margin || w.top < margin || w.left + w.width > width - margin || w.top + w.height > height - margin) offSafe++;
  }
  // OCR boxes for short or low-confidence tokens are often wrong (a two-character number boxed as wide as a word),
  // so only well-read, word-length tokens with a plausible box shape are tested for overlap.
  const solid = confident.filter((w) => w.conf >= T.overlap.confidenceMin && w.text.length >= 3 && w.width <= T.overlap.maxCharAspect * w.height * w.text.length);
  let overlaps = 0;
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) if (overlapping(solid[i], solid[j], T.overlap.overlapRatio)) overlaps++;
  }
  const numbers = confident.map((w) => w.text.replace(/^[^\d]+|[^\d%]+$/g, "")).filter((s) => /^\d[\d,.]*%?$/.test(s));
  return {
    t,
    words: confident.length,
    hasCaption: captionRows.length > 0,
    captionLines: captionRows.length,
    captionText,
    smallWords: small,
    lowContrastWords: faint,
    overlaps,
    offSafe,
    numbers: numbers,
    minHeight: confident.length ? Math.min(...confident.map((w) => w.height / unit)) : null,
  };
}
