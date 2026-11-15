/**
 * File Description: Draws the labelled contact sheet of `aideos compare` as a PNG: REF on the left, OURS on the right, one row per matched moment (equal fractions of
 * each film's own duration) and then one row per cut point (each film's own agreed cuts, paired by order), every frame with its frame id and time label and a strip of
 * palette swatches. Frames come from single ffmpeg decodes; the labels use the built-in pixel font. The swatches are an illustration, never a metric and never used in a delta.
 * Inputs and outputs: two local videos with their study bibles and an output path -> a PNG file and a SheetManifest (labels, size, cell boxes, swatch colours).
 * Used by: backend/compare/run.ts, backend/compare/compare.test.ts.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { round, type StudyBible } from "../study/types";
import { blit, drawText, fillRect, newCanvas, textWidth, type Canvas, type Rgb } from "./font";
import { encodePng } from "./png";
import { COMPARE, type SheetCell, type SheetManifest, type Side } from "./types";

const BACKGROUND: Rgb = [24, 24, 28];
const TEXT: Rgb = [235, 235, 240];
const MUTED: Rgb = [150, 150, 160];
const SIDE_COLOR: Record<Side, Rgb> = { ref: [255, 200, 80], ours: [120, 200, 255] };

/** One frame to show: where it is and how it is labelled. */
interface Moment {
  kind: SheetCell["kind"];
  label: string;
  frameId: number;
  timeSec: number;
  fraction: number;
}

// The frame box (px) a video is drawn in: fitted inside the cell width and height, aspect kept.
export function fitFrame(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(COMPARE.sheet.cellWidth / width, COMPARE.sheet.cellMaxHeight / height);
  return { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)) };
}

// The moments of one side: equal fractions of its duration, then its first agreed cut points (and how many cut points were left out).
export function planMoments(bible: StudyBible): { moments: Moment[]; cuts: Moment[]; cutsOmitted: number } {
  const { durationSec, fps } = bible.media;
  const frameOf = (t: number) => Math.round(t * fps);
  const moments: Moment[] = [];
  for (let i = 0; i < COMPARE.sheet.momentCount; i++) {
    const fraction = (i + 0.5) / COMPARE.sheet.momentCount;
    const timeSec = round(fraction * durationSec, 3);
    moments.push({ kind: "moment", label: "", frameId: frameOf(timeSec), timeSec, fraction: round(fraction, 3) });
  }
  const agreedCuts = bible.series.cuts.filter((c) => c.agreed).map((c) => c.t);
  const cuts = agreedCuts.slice(0, COMPARE.sheet.maxCutPoints).map<Moment>((t, i) => ({ kind: "cut", label: `CUT ${i + 1}`, frameId: frameOf(t), timeSec: round(t, 3), fraction: round(durationSec > 0 ? t / durationSec : 0, 3) }));
  return { moments, cuts, cutsOmitted: Math.max(0, agreedCuts.length - cuts.length) };
}

// Decodes one frame (the frame with this id) scaled to w x h as packed RGB; throws a clear error when ffmpeg cannot.
export function extractFrame(file: string, bible: StudyBible, frameId: number, w: number, h: number): Uint8Array {
  const { fps, durationSec } = bible.media;
  // Half a frame past the frame start, clamped inside the file, so the decode lands on this frame and never past the end.
  const t = Math.max(0, Math.min((frameId + 0.5) / fps, durationSec - 0.5 / fps));
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", t.toFixed(4), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}:flags=area`, "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], { maxBuffer: w * h * 3 * 4 + 1024 });
  if (r.error) throw new Error(`could not run ffmpeg: ${r.error.message}. Install ffmpeg to use aideos compare.`);
  const bytes = r.stdout as Buffer;
  if (r.status !== 0 || bytes.length < w * h * 3) throw new Error(`ffmpeg could not decode frame ${frameId} (${t.toFixed(2)} s) of ${file}: ${String(r.stderr).trim().slice(0, 200)}`);
  return new Uint8Array(bytes.subarray(0, w * h * 3));
}

// The dominant colours of a frame: the most used 4-bit-per-channel buckets, skipping near duplicates, each as the mean colour of its pixels and its share of the frame.
export function palette(rgb: Uint8Array, count: number): Array<{ hex: string; share: number; color: Rgb }> {
  const sums = new Map<number, { n: number; r: number; g: number; b: number }>();
  const pixels = rgb.length / 3;
  for (let i = 0; i < rgb.length; i += 3) {
    const key = ((rgb[i] >> 4) << 8) | ((rgb[i + 1] >> 4) << 4) | (rgb[i + 2] >> 4);
    const s = sums.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    s.n++;
    s.r += rgb[i];
    s.g += rgb[i + 1];
    s.b += rgb[i + 2];
    sums.set(key, s);
  }
  const ranked = [...sums.entries()].sort((a, b) => b[1].n - a[1].n || a[0] - b[0]);
  const chosen: Array<{ hex: string; share: number; color: Rgb }> = [];
  for (const [, s] of ranked) {
    const color: Rgb = [Math.round(s.r / s.n), Math.round(s.g / s.n), Math.round(s.b / s.n)];
    // Skip a bucket whose colour is close to one already chosen (distance under 48 in RGB), so the strip shows different colours.
    if (chosen.some((c) => Math.hypot(c.color[0] - color[0], c.color[1] - color[1], c.color[2] - color[2]) < 48)) continue;
    chosen.push({ hex: `#${color.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`, share: round(s.n / pixels, 4), color });
    if (chosen.length === count) break;
  }
  return chosen;
}

// Black or white text, whichever reads on a colour.
function inkOn(color: Rgb): Rgb {
  return 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2] > 140 ? [10, 10, 12] : [250, 250, 250];
}

// Cuts a text to what fits in a pixel width at a scale.
function fitText(text: string, maxWidth: number, scale: number): string {
  let out = text;
  while (out.length > 1 && textWidth(out, scale) > maxWidth) out = out.slice(0, -1);
  return out;
}

/** What is drawn for one side of one row. */
interface CellPlan {
  side: Side;
  moment: Moment | null;
  file: string;
  bible: StudyBible;
}

// Draws the sheet and writes it to outFile; returns what it drew.
export function renderContactSheet(input: { ours: { file: string; bible: StudyBible }; ref: { file: string; bible: StudyBible }; outFile: string }): SheetManifest {
  const S = COMPARE.sheet;
  const plans: Record<Side, ReturnType<typeof planMoments>> = { ref: planMoments(input.ref.bible), ours: planMoments(input.ours.bible) };
  const frames: Record<Side, { width: number; height: number }> = { ref: fitFrame(input.ref.bible.media.width, input.ref.bible.media.height), ours: fitFrame(input.ours.bible.media.width, input.ours.bible.media.height) };
  const sources: Record<Side, { file: string; bible: StudyBible }> = { ref: input.ref, ours: input.ours };
  const cutRows = Math.max(plans.ref.cuts.length, plans.ours.cuts.length);
  const colX: Record<Side, number> = { ref: S.gap, ours: S.gap * 2 + S.cellWidth };
  const width = S.gap * 3 + S.cellWidth * 2;
  const labelH = 7 * S.labelScale + 6;
  const rowH = Math.max(frames.ref.height, frames.ours.height);
  const rowBlock = labelH + rowH + 4 + S.swatchHeight + S.gap;
  const headingLines = [
    "REF (LEFT) VS OURS (RIGHT)",
    "CRAFT MEASUREMENTS ONLY. NUMBERS, NOT A VERDICT.",
    `REF: ${path.basename(input.ref.file)}`,
    `OURS: ${path.basename(input.ours.file)}`,
  ];
  const sectionH = 7 * S.labelScale + S.gap;
  const headingH = S.gap + 7 * S.headingScale + S.gap + 3 * (7 * S.labelScale + 4) + S.gap;
  const height = headingH + sectionH + S.momentCount * rowBlock + (cutRows > 0 ? sectionH + cutRows * rowBlock : 0);
  const canvas: Canvas = newCanvas(width, height, BACKGROUND);

  // Heading.
  let y = S.gap;
  drawText(canvas, S.gap, y, headingLines[0], S.headingScale, TEXT);
  y += 7 * S.headingScale + S.gap;
  headingLines.slice(1).forEach((line, i) => {
    drawText(canvas, S.gap, y, fitText(line, width - 2 * S.gap, S.labelScale), S.labelScale, i === 0 ? MUTED : TEXT);
    y += 7 * S.labelScale + 4;
  });
  y += S.gap;

  const cells: SheetCell[] = [];
  let rowIndex = 0;
  // Draws one row: a label line, the two frames (or a "no cut" box), and the swatch strips.
  const drawRow = (pair: Record<Side, CellPlan>): void => {
    for (const side of ["ref", "ours"] as Side[]) {
      const plan = pair[side];
      const fit = frames[side];
      const x = colX[side] + Math.round((S.cellWidth - fit.width) / 2);
      const top = y + labelH;
      if (!plan.moment) {
        fillRect(canvas, colX[side], top, S.cellWidth, rowH, [38, 38, 44]);
        drawText(canvas, colX[side] + 8, top + 8, `NO ${side === "ref" ? "REF" : "OURS"} CUT HERE`, S.labelScale, MUTED);
        continue;
      }
      const m = plan.moment;
      const label = `${side === "ref" ? "REF" : "OURS"}${m.label ? ` ${m.label}` : ""} F${m.frameId} T${m.timeSec.toFixed(2)}S (${Math.round(m.fraction * 100)}%)`;
      drawText(canvas, colX[side], y + 3, fitText(label, S.cellWidth, S.labelScale), S.labelScale, SIDE_COLOR[side]);
      const rgb = extractFrame(plan.file, plan.bible, m.frameId, fit.width, fit.height);
      blit(canvas, x, top, fit.width, fit.height, rgb);
      const swatches = palette(rgb, S.swatches);
      const sw = Math.floor(S.cellWidth / S.swatches);
      swatches.forEach((p, i) => {
        fillRect(canvas, colX[side] + i * sw, top + rowH + 4, sw - 2, S.swatchHeight, p.color);
        drawText(canvas, colX[side] + i * sw + 3, top + rowH + 4 + Math.round((S.swatchHeight - 14) / 2), p.hex, 2, inkOn(p.color));
      });
      cells.push({ side, kind: m.kind, row: rowIndex, label, frameId: m.frameId, timeSec: m.timeSec, fraction: m.fraction, x, y: top, width: fit.width, height: fit.height, swatches: swatches.map((p, i) => ({ hex: p.hex, share: p.share, x: colX[side] + i * sw, y: top + rowH + 4, width: sw - 2, height: S.swatchHeight })) });
    }
    y += rowBlock;
    rowIndex++;
  };

  drawText(canvas, S.gap, y, "MATCHED MOMENTS (EQUAL FRACTIONS OF EACH DURATION)", S.labelScale, TEXT);
  y += sectionH;
  for (let i = 0; i < S.momentCount; i++) {
    drawRow({
      ref: { side: "ref", moment: plans.ref.moments[i], file: sources.ref.file, bible: sources.ref.bible },
      ours: { side: "ours", moment: plans.ours.moments[i], file: sources.ours.file, bible: sources.ours.bible },
    });
  }
  if (cutRows > 0) {
    const omitted = plans.ref.cutsOmitted + plans.ours.cutsOmitted;
    drawText(canvas, S.gap, y, fitText(`CUT POINTS (EACH VIDEO HAS ITS OWN AGREED CUTS, BY ORDER${omitted ? `; ${omitted} NOT SHOWN` : ""})`, width - 2 * S.gap, S.labelScale), S.labelScale, TEXT);
    y += sectionH;
    for (let i = 0; i < cutRows; i++) {
      drawRow({
        ref: { side: "ref", moment: plans.ref.cuts[i] ?? null, file: sources.ref.file, bible: sources.ref.bible },
        ours: { side: "ours", moment: plans.ours.cuts[i] ?? null, file: sources.ours.file, bible: sources.ours.bible },
      });
    }
  }
  fs.mkdirSync(path.dirname(input.outFile), { recursive: true });
  fs.writeFileSync(input.outFile, encodePng(width, height, canvas.data));
  return { file: path.basename(input.outFile), width, height, heading: headingLines, cells, cutPointsOmitted: { ref: plans.ref.cutsOmitted, ours: plans.ours.cutsOmitted } };
}
