/**
 * File Description: Data contract and fixed constants of `aideos compare`, the numbers-only side-by-side of one of our videos against a local reference.
 * A comparison holds one row per metric (both sides' readings, an agreed delta or an unresolved status), plain-words summary bullets and the contact sheet manifest.
 * Inputs and outputs: TypeScript definitions and constants -> CompareRow, CompareReport, SheetManifest and the COMPARE constants.
 * Used by: backend/compare/*.ts, backend/cli.ts.
 */

import { IP_BOUNDARY, type MetricStatus } from "../study/types";

/** Schema id written into every comparison report. */
export const COMPARE_SCHEMA = "aideos.compare/1";

/** The boundary every compare output repeats: the same craft-only boundary as `aideos study`, plus that a comparison is not a verdict. */
export const COMPARE_BOUNDARY = `${IP_BOUNDARY} A comparison states numbers only: it is not a verdict, not a score and not advice.`;

/** Every fixed number the contact sheet uses. None of these are review thresholds. */
export const COMPARE = {
  sheet: {
    /** Frames per side at equal fractions of the duration (the moments sit at (i + 0.5) / count). */
    momentCount: 5,
    /** Most cut points drawn per side (the first ones, in time order). */
    maxCutPoints: 5,
    /** Palette swatches under each frame. */
    swatches: 5,
    /** Widest a frame is drawn, px. */
    cellWidth: 480,
    /** Tallest a frame is drawn, px. */
    cellMaxHeight: 360,
    /** Gap between cells and around the sheet, px. */
    gap: 16,
    /** Height of the swatch strip, px. */
    swatchHeight: 28,
    /** Pixel scale of the built-in 5x7 label font for cell labels and for headings. */
    labelScale: 2,
    headingScale: 3,
  },
  /** How many of the largest agreed deltas the summary states. */
  summaryTopCount: 5,
} as const;

/** The two sides of a comparison. */
export type Side = "ref" | "ours";

/** One side's reading of a metric: the value the study stands behind (null when not agreed) and both methods' numbers. */
export interface SideReading {
  status: MetricStatus;
  value: number | null;
  /** Each method's name and number, so an unresolved metric keeps both readings. */
  readings: Array<{ method: string; value: number | null }>;
  reason?: string;
}

/** How a metric row stands: agreed (both sides agreed, so it has a delta), unresolved (a side did not agree: both numbers kept, no delta, not used) or not-measured (a side has no such metric). */
export type RowStatus = "agreed" | "unresolved" | "not-measured";

/** One metric compared across the two videos. */
export interface CompareRow {
  id: string;
  label: string;
  unit: string;
  group: "media" | "cuts" | "camera" | "tone" | "captions" | "audio";
  status: RowStatus;
  ref: SideReading | null;
  ours: SideReading | null;
  /** ours minus ref, set only on an agreed row. */
  delta: number | null;
  /** Absolute delta as a share of the larger of the two values, set only on an agreed row (0 when both are 0). */
  relativeDelta: number | null;
  /** True when the delta is larger than the study's own agreement tolerance for this metric; null on a row without a delta. */
  differs: boolean | null;
  /** The study tolerance used for `differs`, in words. */
  sameWithin: string;
  /** Why a row is unresolved or not measured. */
  reason?: string;
}

/** A fact that is text, not a number (the aspect). */
export interface TextFact {
  id: string;
  label: string;
  ref: string;
  ours: string;
  same: boolean;
}

/** One cell of the contact sheet. */
export interface SheetCell {
  side: Side;
  /** What the cell shows: a moment at an equal fraction of the duration, or a cut point. */
  kind: "moment" | "cut";
  /** The row of the cell on the sheet (0 for the first). */
  row: number;
  /** Label text drawn above the frame. */
  label: string;
  frameId: number;
  timeSec: number;
  /** Position in the duration, 0 to 1. */
  fraction: number;
  /** Frame box on the sheet, px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Palette swatches (hex colour, share of pixels and box on the sheet), the strip under the frame. */
  swatches: Array<{ hex: string; share: number; x: number; y: number; width: number; height: number }>;
}

/** What the contact sheet drew, so a reader (or a test) can check the labels and size without reading pixels. */
export interface SheetManifest {
  file: string;
  width: number;
  height: number;
  heading: string[];
  cells: SheetCell[];
  /** Cut points left out of the sheet because the side has more than the sheet shows, per side. */
  cutPointsOmitted: { ref: number; ours: number };
}

/** The machine-readable report. */
export interface CompareReport {
  schema: typeof COMPARE_SCHEMA;
  /** Always true: a comparison is a measurement, never a plan or a verdict. */
  proposal: true;
  boundary: string;
  generatedAt: string;
  ours: { file: string; durationSec: number; width: number; height: number; aspect: string; fps: number };
  ref: { file: string; durationSec: number; width: number; height: number; aspect: string; fps: number };
  facts: TextFact[];
  rows: CompareRow[];
  /** The largest agreed deltas, as short plain-words bullets (Simplified Technical English), largest first. */
  summary: string[];
  /** Metrics left out of every delta, with the reason. */
  unresolved: Array<{ id: string; reason: string }>;
  /** Metrics only one side has (for example words per minute), with the reason. */
  notMeasured: Array<{ id: string; reason: string }>;
  sheet: SheetManifest | null;
  /** Files written next to the report, relative to the report folder. */
  files: { sheet: string | null; diff: string; summary: string; report: string };
}
