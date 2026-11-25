/**
 * File Description: The design check's rules for pictures (the illustrated stage's plate and generated objects, raster assets of a scene). A picture must keep its provenance record (prompt, date, seconds, tool and sha256, beside the original file) with a prompt that follows the picture rules; its strong colours must sit near the film's accent and the plate's tone near the canvas (the palette rule, which raster pixels used to slip past); it must show no text, read by OCR (SVG keeps every word); every SVG label drawn over a picture must keep its contrast against the busiest part of the picture behind it; and a picture should not be enlarged past its own pixels at the strongest camera zoom. Pixels are read with the dependency-free PNG decoder, OCR with tesseract (injectable), geometry through the compiled scene and each format's window, as the inset rule does.
 * Inputs and outputs: a parsed film, its scene and the formats to check (plus an optional OCR reader) -> design findings naming the picture, shot, format, label and the measured value.
 * Used by: backend/designCheck/designCheck.ts, backend/designCheck/pictureComposition.ts (shared pixel sampling), backend/designCheck/pictures.test.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { converter } from "culori";
import type { Film } from "../../src/dl/schema";
import type { EnvironmentAsset, RasterSource, Scene } from "../../src/dl/scene/types";
import { compileScene, type CompiledEntity, type CompiledScene } from "../../src/dl/scene/compile";
import { buildTimeline } from "../../src/dl/camera";
import { parseSvgDocument, type SvgNode } from "../../src/dl/scene/svgDocument";
import { elementOpacity, VISIBLE_OPACITY_MIN } from "../../src/dl/scene/visibility";
import { BACKGROUND_THEMES, PALETTE } from "../../src/dl/tokens";
import { resolveRepoAssetPath } from "../../src/dl/videoPackageLoader";
import type { RgbaImage } from "../pictures/png";
import { ALPHA_FLOOR, loadPicture } from "../pictures/bounds";
import { promptProblems } from "../pictures/policy";
import type { PictureRecord } from "../pictures/cache";
import { parseTsv, toPgm } from "../review/ocr";
import { apply, IDENTITY, leafBounds, multiply, NON_DRAWING_TAGS, parseTransform, rotation, scaling, styleValue, translation, type Affine, type Box } from "./svgBounds";
import type { DesignFinding } from "./designCheck";
import { sceneToFrame, stateMatrix } from "./insetRegion";
import { spawnSyncBounded } from "../proc";

/** The measured limits of the picture rules. */
export const PICTURE_THRESHOLDS = {
  /** A pixel at or below this alpha (0 to 255) is cut-out background, outside the picture's visible bounds. */
  alphaFloor: ALPHA_FLOOR,
  /** A strong colour has at least this HSV saturation and value. */
  strongSaturation: 0.35,
  strongValue: 0.3,
  /** A strong colour within this many degrees of the accent's hue counts as the accent. */
  accentHueToleranceDeg: 30,
  /** The largest share of a picture's visible pixels that may be strong colour off the accent hue. */
  offAccentShareMax: 0.08,
  /** The largest distance between the plate's median relative luminance and the canvas colour's. */
  plateToneDistanceMax: 0.15,
  /** OCR: a word counts as text from this tesseract confidence and this many letters or digits. */
  ocrConfidenceMin: 60,
  ocrCharsMin: 2,
  /** WCAG contrast a label needs against the worst tenth of the picture behind it; large labels (at least `largeLabelPx` tall) need less. */
  labelContrastMin: 4.5,
  largeLabelContrastMin: 3,
  largeLabelPx: 24,
  /** The share of a label's samples ranked worst that sets its contrast (the 10th percentile). */
  labelContrastPercentile: 0.1,
  /** A picture shown larger than this many output pixels per source pixel is enlarged enough to look soft (a warning). */
  enlargementMax: 1.5,
  /** WCAG non-text contrast a callout's leader line or arrow needs against the worst tenth of the picture under it. */
  leaderContrastMin: 3,
  /** A sample of an SVG mark counts as hidden when the pictures drawn above it cover it at least this opaquely (0 to 1). */
  coverAlphaMin: 0.5,
  /** The largest share of a label's or callout part's samples a picture drawn above it may hide. */
  coverShareMax: 0.1,
  /** Callout anchoring and hidden labels are sampled at the middle of every shot and at least this often (seconds). */
  compositionSampleSec: 0.5,
} as const;

/** One word an OCR reader found in a picture. */
export interface PictureWord {
  text: string;
  conf: number;
}

/** Reads the words in a picture composited over the canvas (grey levels, rows top to bottom). */
export type PictureOcr = (gray: Uint8Array, width: number, height: number) => PictureWord[] | { unavailable: string };

/** The record file kept beside a picture (`<fingerprint>.json` beside `<fingerprint>.png`). */
function recordPath(raster: RasterSource): string {
  return resolveRepoAssetPath(raster.src).replace(/\.png$/i, ".json");
}

/** Checks a picture keeps its provenance record (prompt, date, seconds, tool, sha256) and that its prompt follows the picture rules. */
export function checkProvenance(asset: EnvironmentAsset & { raster: RasterSource }): DesignFinding[] {
  const where = asset.assetId;
  let record: PictureRecord;
  try {
    record = JSON.parse(fs.readFileSync(recordPath(asset.raster), "utf8")) as PictureRecord;
  } catch {
    return [{ rule: "provenance", severity: "error", where, message: `picture ${asset.raster.src} has no readable record beside it (${path.basename(recordPath(asset.raster))}); store pictures through the picture cache (\`aideos pictures add\`) so the prompt, date, seconds, tool and sha256 are kept.` }];
  }
  const findings: DesignFinding[] = [];
  const missing = (["prompt", "createdAt", "tool", "sha256"] as const).filter((k) => typeof record[k] !== "string" || !record[k]);
  if (typeof record.seconds !== "number") missing.push("seconds" as never);
  if (missing.length) findings.push({ rule: "provenance", severity: "error", where, message: `picture record lacks ${missing.join(", ")}.` });
  if (record.sha256 && record.sha256 !== asset.raster.sha256) findings.push({ rule: "provenance", severity: "error", where, message: `picture record names sha256 ${record.sha256} but the scene pins ${asset.raster.sha256}; the original file must be the one recorded.` });
  for (const [label, text] of [["style paragraph", record.style ?? ""], ["prompt", record.objectPrompt ?? ""]] as const) {
    for (const problem of promptProblems(text)) findings.push({ rule: "provenance", severity: "error", where, message: `picture ${label} ${problem}; pictures are abstract objects only.` });
  }
  return findings;
}

// Linearises one sRGB channel (0 to 255), as the WCAG luminance needs.
function linearChannel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** The linearised value of every whole 8-bit channel level, so an opaque pixel (whole levels) skips the power function. */
const LINEAR_LEVELS = Float64Array.from({ length: 256 }, (_, level) => linearChannel(level));

/** Relative luminance (WCAG) of an sRGB colour with 0 to 255 channels. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

/** The WCAG contrast ratio of two relative luminances. */
export function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Hue in degrees (0 to 360) of an sRGB colour with 0 to 255 channels; 0 for a grey. */
function hueOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return h;
}

/** Reads a CSS colour as 0 to 255 channels, or null. */
export function channels(css: string): [number, number, number] | null {
  const c = converter("rgb")(css);
  if (!c || c.r === undefined) return null;
  return [c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255)) as [number, number, number];
}

/** The film's canvas colour (its background theme) as channels. */
export function canvasChannels(film: Film): [number, number, number] {
  const theme = BACKGROUND_THEMES[film.theme?.background ?? "paper-white"] ?? BACKGROUND_THEMES["paper-white"];
  return channels(theme.canvas) ?? [10, 10, 11];
}

/**
 * The palette rule on pixels: of a picture's visible pixels, strong colour off the film accent's hue may cover only a
 * small share, and the plate's median tone must stay near the canvas so the film keeps its ground.
 */
export function checkPicturePalette(asset: EnvironmentAsset, image: RgbaImage, accent: string, canvas: [number, number, number], isPlate: boolean): DesignFinding[] {
  const t = PICTURE_THRESHOLDS;
  const accentRgb = channels(accent);
  const accentHue = accentRgb ? hueOf(...accentRgb) : 0;
  let visible = 0;
  let offAccent = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((image.width * image.height) / 250_000)));
  // One luminance per visible sample, in a typed array (sorted numerically in place for the median).
  const lums = new Float64Array(Math.ceil(image.height / step) * Math.ceil(image.width / step));
  for (let y = 0; y < image.height; y += step) {
    for (let x = 0; x < image.width; x += step) {
      const i = (y * image.width + x) * 4;
      const a = image.rgba[i + 3];
      if (a <= t.alphaFloor) continue;
      const r = image.rgba[i];
      const g = image.rgba[i + 1];
      const b = image.rgba[i + 2];
      // Saturation and value of the pixel; the hue is only needed for a strong colour.
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      if ((max === 0 ? 0 : d / max) >= t.strongSaturation && max / 255 >= t.strongValue) {
        const h = hueOf(r, g, b);
        const dh = Math.min(Math.abs(h - accentHue), 360 - Math.abs(h - accentHue));
        if (dh > t.accentHueToleranceDeg) offAccent++;
      }
      // The tone is read as the picture shows over the canvas.
      if (a === 255) {
        // Fully opaque: the canvas contributes nothing, so the channels are whole levels and read from the table (the same values the formula gives).
        lums[visible++] = 0.2126 * LINEAR_LEVELS[r] + 0.7152 * LINEAR_LEVELS[g] + 0.0722 * LINEAR_LEVELS[b];
        continue;
      }
      const k = a / 255;
      lums[visible++] = relativeLuminance(r * k + canvas[0] * (1 - k), g * k + canvas[1] * (1 - k), b * k + canvas[2] * (1 - k));
    }
  }
  const findings: DesignFinding[] = [];
  if (visible === 0) return [{ rule: "palette", severity: "error", where: asset.assetId, message: "picture has no visible pixels (every pixel is transparent)." }];
  const share = offAccent / visible;
  if (share > t.offAccentShareMax) {
    findings.push({ rule: "palette", severity: "error", where: asset.assetId, message: `picture is ${(share * 100).toFixed(1)}% strong colour off the film accent ${accent} (at most ${(t.offAccentShareMax * 100).toFixed(0)}%): regenerate it with the accent in the style paragraph, or keep it neutral.` });
  }
  if (isPlate) {
    const seen = lums.subarray(0, visible).sort();
    const median = seen[Math.floor(seen.length / 2)];
    const ground = relativeLuminance(...canvas);
    if (Math.abs(median - ground) > t.plateToneDistanceMax) {
      findings.push({ rule: "palette", severity: "error", where: asset.assetId, message: `plate's median tone (luminance ${median.toFixed(2)}) is too far from the canvas (${ground.toFixed(2)}; at most ${t.plateToneDistanceMax} apart): the plate must keep the film's ground.` });
    }
  }
  return findings;
}

/** Composites a picture over the canvas and returns its grey levels (rows top to bottom), as OCR reads it. */
export function pictureGray(image: RgbaImage, canvas: [number, number, number]): Uint8Array {
  const gray = new Uint8Array(image.width * image.height);
  for (let p = 0; p < gray.length; p++) {
    const i = p * 4;
    const k = image.rgba[i + 3] / 255;
    const r = image.rgba[i] * k + canvas[0] * (1 - k);
    const g = image.rgba[i + 1] * k + canvas[1] * (1 - k);
    const b = image.rgba[i + 2] * k + canvas[2] * (1 - k);
    gray[p] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return gray;
}

/** OCR with tesseract (sparse text, the same reader `aideos review` uses), or why it cannot run. */
export const tesseractOcr: PictureOcr = (gray, width, height) => {
  const input = toPgm(gray, width, height);
  const result = spawnSyncBounded("tesseract", ["stdin", "stdout", "--psm", "11", "tsv"], { input, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" });
  if (result.error) return { unavailable: `tesseract could not run (${result.error.message}); install it to check pictures for text` };
  if (result.status !== 0) return { unavailable: `tesseract exited with code ${result.status}: ${result.stderr?.toString().trim().slice(0, 200)}` };
  return parseTsv(result.stdout.toString("utf8")).map((w) => ({ text: w.text, conf: w.conf }));
};

/** OCR results by picture sha256 for this process, so a design rebuild does not read the same picture again. */
const OCR_CACHE = new Map<string, PictureWord[]>();

/** The no-text rule: OCR must find no word in a picture (SVG carries every word, number and label). */
export function checkPictureText(asset: EnvironmentAsset & { raster: RasterSource }, image: RgbaImage, canvas: [number, number, number], ocr: PictureOcr): DesignFinding[] {
  const t = PICTURE_THRESHOLDS;
  let words = ocr === tesseractOcr ? OCR_CACHE.get(asset.raster.sha256) : undefined;
  if (!words) {
    const read = ocr(pictureGray(image, canvas), image.width, image.height);
    if (!Array.isArray(read)) return [{ rule: "picture-text", severity: "error", where: asset.assetId, message: `picture could not be read for text, so the no-text rule is not met: ${read.unavailable}.` }];
    words = read;
    if (ocr === tesseractOcr) OCR_CACHE.set(asset.raster.sha256, words);
  }
  const found = words.filter((w) => w.conf >= t.ocrConfidenceMin && (w.text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= t.ocrCharsMin);
  if (!found.length) return [];
  return [{ rule: "picture-text", severity: "error", where: asset.assetId, message: `picture shows text (${found.slice(0, 6).map((w) => `"${w.text}"`).join(", ")}); generated pictures carry no words, so regenerate it, and draw any label in SVG.` }];
}

/** One SVG text label of an asset: its box in local units, its colour, its size and the chain that places it. */
interface Label {
  name: string;
  box: Box;
  color: [number, number, number];
  fontSize: number;
  chain: Array<{ id?: string; transform: Affine; opacity: number }>;
}

/** The text labels of an SVG asset document, cached per file version. */
const LABEL_CACHE = new Map<string, Label[]>();

/** Reads every visible `<text>` of an SVG asset with its fill (inherited), font size and ancestor chain. */
function assetLabels(svgSource: string): Label[] {
  const file = resolveRepoAssetPath(svgSource);
  if (!fs.existsSync(file)) return [];
  const stat = fs.statSync(file);
  const key = `${file}:${stat.mtimeMs}:${stat.size}`;
  const cached = LABEL_CACHE.get(key);
  if (cached) return cached;
  const labels: Label[] = [];
  let doc;
  try {
    doc = parseSvgDocument(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const visit = (node: SvgNode, chain: Label["chain"], fill: string, nearestId: string | undefined) => {
    if (NON_DRAWING_TAGS.has(node.tag) || node.attrs.display === "none" || node.attrs.visibility === "hidden") return;
    const opacity = Number.parseFloat(node.attrs.opacity ?? "");
    const here = [...chain, { id: node.attrs.id, transform: parseTransform(node.attrs.transform), opacity: Number.isFinite(opacity) ? opacity : 1 }];
    const ownFill = styleValue(node, "fill") ?? fill;
    const name = node.attrs.id ?? nearestId;
    if (node.tag === "text") {
      const box = leafBounds(node);
      const color = ownFill === "none" ? null : channels(ownFill);
      if (box && color) labels.push({ name: name ?? "text", box, color, fontSize: Number.parseFloat(styleValue(node, "font-size") ?? "16") || 16, chain: here });
      return;
    }
    for (const child of node.children) visit(child, here, ownFill, name);
  };
  for (const child of doc.children) visit(child, [], "#000000", undefined);
  LABEL_CACHE.set(key, labels);
  return labels;
}

/** The matrix that places a compiled entity on the stage (translate, scale, rotate), before its element states. */
export function placement(entity: CompiledEntity): Affine {
  const t = entity.transform;
  return multiply(multiply(translation(t.x, t.y), scaling(t.scale, t.scale)), rotation(t.rotation));
}

/** Inverts an affine matrix, or null when it is singular. */
export function invert(m: Affine): Affine | null {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return null;
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det };
}

/** A picture as drawn at one frame: frame pixels to its pixels, and its opacity. */
export interface DrawnPicture {
  id: string;
  image: RgbaImage;
  toPixel: Affine;
  opacity: number;
}

/** The pictures drawn at a frame between two layer indexes (below `below`, from `from`), mapped from frame pixels into each picture's own pixels. */
export function drawnPictures(entities: CompiledEntity[], below: number, toPx: Affine, from = 0): DrawnPicture[] {
  const out: DrawnPicture[] = [];
  for (const entity of entities.slice(from, below)) {
    if (!entity.raster || entity.transform.opacity <= VISIBLE_OPACITY_MIN) continue;
    const image = loadPicture(entity.raster);
    if (!image) continue;
    const state = entity.elementStates?.[entity.entityId];
    const opacity = entity.transform.opacity * (state ? elementOpacity(state, 1) : 1);
    if (opacity <= VISIBLE_OPACITY_MIN) continue;
    const local = multiply(multiply(toPx, placement(entity)), state ? stateMatrix(state) : IDENTITY);
    // Local units to pixels: the picture's box is centred on its origin, one unit per pixel.
    const toLocal = invert(local);
    if (!toLocal) continue;
    out.push({ id: entity.entityId, image, toPixel: multiply(translation(entity.raster.width / 2, entity.raster.height / 2), toLocal), opacity });
  }
  return out;
}

/** The colour at a frame pixel: the canvas with every picture below composited over it in order. */
export function composite(x: number, y: number, pictures: DrawnPicture[], canvas: [number, number, number]): [number, number, number] | null {
  let rgb: [number, number, number] = [...canvas];
  let covered = false;
  for (const p of pictures) {
    const [u, v] = apply(p.toPixel, x, y);
    const px = Math.floor(u);
    const py = Math.floor(v);
    if (px < 0 || py < 0 || px >= p.image.width || py >= p.image.height) continue;
    const i = (py * p.image.width + px) * 4;
    const a = (p.image.rgba[i + 3] / 255) * p.opacity;
    if (a <= 0) continue;
    covered = true;
    rgb = [0, 1, 2].map((k) => p.image.rgba[i + k] * a + rgb[k] * (1 - a)) as [number, number, number];
  }
  return covered ? rgb : null;
}

/**
 * The contrast rule for labels over pictures: at the middle of every shot, in each format, every SVG text label drawn
 * over a picture must keep WCAG contrast against the worst tenth of the picture behind it (a busy plate lowers that).
 * It measures picture pixels only, never SVG fills drawn between the plate and the label, and samples only the middle of each shot.
 */
export function checkLabelContrast(film: Film, scene: Scene, compiled: CompiledScene, formats: ReadonlyArray<"long" | "reel">): DesignFinding[] {
  const t = PICTURE_THRESHOLDS;
  if (![scene.background, ...scene.props].some((a) => a?.raster)) return [];
  const canvas = canvasChannels(film);
  const findings: DesignFinding[] = [];
  const reported = new Set<string>();
  for (const timed of buildTimeline(film)) {
    const f = Math.max(0, Math.min(compiled.frames.length - 1, Math.round((timed.from + timed.to) / 2)));
    const frame = compiled.frames[f];
    for (const format of formats) {
      const [width, height] = format === "long" ? [1920, 1080] : [1080, 1920];
      const toPx = sceneToFrame(frame, scene, width, height);
      frame.entities.forEach((entity, index) => {
        if (!entity.svgSource || entity.transform.opacity <= VISIBLE_OPACITY_MIN) return;
        const pictures = drawnPictures(frame.entities, index, toPx);
        if (!pictures.length) return;
        const states = entity.elementStates ?? {};
        for (const label of assetLabels(entity.svgSource)) {
          const key = `${format}:${entity.entityId}:${label.name}`;
          if (reported.has(key)) continue;
          let m = multiply(toPx, placement(entity));
          let opacity = entity.transform.opacity;
          for (const link of label.chain) {
            const state = link.id ? states[link.id] : undefined;
            m = multiply(m, link.transform);
            if (state) {
              m = multiply(m, stateMatrix(state));
              opacity *= elementOpacity(state, link.opacity);
            } else opacity *= link.opacity;
          }
          if (opacity <= VISIBLE_OPACITY_MIN) continue;
          const corners = [apply(m, label.box.x0, label.box.y0), apply(m, label.box.x1, label.box.y0), apply(m, label.box.x0, label.box.y1), apply(m, label.box.x1, label.box.y1)];
          const x0 = Math.max(0, Math.min(...corners.map((c) => c[0])));
          const x1 = Math.min(width, Math.max(...corners.map((c) => c[0])));
          const y0 = Math.max(0, Math.min(...corners.map((c) => c[1])));
          const y1 = Math.min(height, Math.max(...corners.map((c) => c[1])));
          if (x1 - x0 < 1 || y1 - y0 < 1) continue;
          const labelLum = relativeLuminance(...label.color);
          const ratios: number[] = [];
          const cols = 16;
          const rows = 6;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const rgb = composite(x0 + ((c + 0.5) * (x1 - x0)) / cols, y0 + ((r + 0.5) * (y1 - y0)) / rows, pictures, canvas);
              if (rgb) ratios.push(contrastRatio(labelLum, relativeLuminance(...rgb)));
            }
          }
          if (ratios.length < (cols * rows) / 4) continue;
          ratios.sort((p, q) => p - q);
          const worst = ratios[Math.floor(ratios.length * t.labelContrastPercentile)];
          const sizePx = label.fontSize * Math.hypot(m.a, m.b);
          const need = sizePx >= t.largeLabelPx ? t.largeLabelContrastMin : t.labelContrastMin;
          if (worst >= need) continue;
          reported.add(key);
          findings.push({
            rule: "contrast",
            severity: "error",
            where: `shot ${timed.shot.id} / ${entity.entityId} / ${label.name}`,
            message: `label over picture "${pictures.map((p) => p.id).join(", ")}" has contrast ${worst.toFixed(2)}:1 against the busiest tenth behind it in the ${format === "long" ? "wide" : "reel"} cut at frame ${f} (needs ${need}:1). This rule measures picture pixels only (not SVG scrims, cards or pills drawn between the plate and the label) and samples the middle of each shot only, so move the label, change its colour, or quiet the plate.`,
          });
        }
      });
    }
  }
  return findings;
}

/** The resolution rule: at the strongest camera zoom, in each format, a picture should not be shown larger than its own pixels allow (a warning). */
export function checkPictureResolution(scene: Scene, compiled: CompiledScene, formats: ReadonlyArray<"long" | "reel">): DesignFinding[] {
  const findings: DesignFinding[] = [];
  const worst = new Map<string, { scale: number; format: string; frame: number }>();
  const step = Math.max(1, Math.floor(compiled.frames.length / 120));
  for (let f = 0; f < compiled.frames.length; f += step) {
    const frame = compiled.frames[f];
    for (const format of formats) {
      const [width, height] = format === "long" ? [1920, 1080] : [1080, 1920];
      const toPx = sceneToFrame(frame, scene, width, height);
      for (const entity of frame.entities) {
        if (!entity.raster || entity.transform.opacity <= VISIBLE_OPACITY_MIN) continue;
        const state = entity.elementStates?.[entity.entityId];
        const scaleState = state ? Math.max(Math.abs(state.scaleX), Math.abs(state.scaleY)) : 1;
        const m = multiply(toPx, placement(entity));
        const shown = Math.hypot(m.a, m.b) * scaleState;
        const prev = worst.get(entity.entityId);
        if (!prev || shown > prev.scale) worst.set(entity.entityId, { scale: shown, format, frame: f });
      }
    }
  }
  for (const [id, w] of worst) {
    if (w.scale > PICTURE_THRESHOLDS.enlargementMax) findings.push({ rule: "resolution", severity: "warning", where: id, message: `picture is shown at ${w.scale.toFixed(2)} output pixels per source pixel in the ${w.format === "long" ? "wide" : "reel"} cut at frame ${w.frame} (above ${PICTURE_THRESHOLDS.enlargementMax}); it will look soft. Use a larger source or a smaller placement.` });
  }
  return findings;
}

/** Runs every picture rule over a scene: provenance and prompt, palette on pixels, no text, label contrast and resolution. */
export function checkPictures(film: Film, scene: Scene, options: {
  formats: ReadonlyArray<"long" | "reel">;
  accent?: string;
  ocr?: PictureOcr;
}): DesignFinding[] {
  const pictures = [scene.background, ...scene.props].filter((a): a is EnvironmentAsset & { raster: RasterSource } => Boolean(a?.raster));
  if (!pictures.length) return [];
  const findings: DesignFinding[] = [];
  const canvas = canvasChannels(film);
  const accent = options.accent ?? film.accent ?? PALETTE.accent;
  for (const asset of pictures) {
    findings.push(...checkProvenance(asset));
    const image = loadPicture(asset.raster);
    if (!image) continue; // The scene rule reports a missing or changed file.
    findings.push(...checkPicturePalette(asset, image, accent, canvas, asset.assetId === scene.background?.assetId));
    findings.push(...checkPictureText(asset, image, canvas, options.ocr ?? tesseractOcr));
  }
  let compiled: CompiledScene;
  try {
    compiled = compileScene(scene, { clockMs: 0, skipContinuityVerification: true });
  } catch {
    return findings; // The scene rule reports a scene that does not compile.
  }
  findings.push(...checkLabelContrast(film, scene, compiled, options.formats));
  findings.push(...checkPictureResolution(scene, compiled, options.formats));
  return findings;
}
