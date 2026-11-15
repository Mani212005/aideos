/**
 * File Description: The metric diff of `aideos compare`. Builds one row per metric from the study bibles of the two videos. A row gets a delta only when BOTH
 * sides are agreed (two methods inside the study tolerance, or a named non-pixel reading); an unresolved side makes the row unresolved with every reading kept
 * and no delta, so a disagreement never reaches the summary. Whether a delta counts as a difference is judged with the study's own agreement tolerance for that metric.
 * Pure functions, no I/O.
 * Inputs and outputs: two StudyBibles (ours and the reference) -> CompareRow[] and TextFact[].
 * Used by: backend/compare/summary.ts, backend/compare/run.ts.
 */

import { describeTolerance, withinTolerance, type Tolerance } from "../study/agreement";
import { round, STUDY, type Metric, type StudyBible } from "../study/types";
import type { CompareRow, SideReading, TextFact } from "./types";

/** One metric the comparison reports, with the study tolerance inside which two values count as the same. */
interface RowSpec {
  id: string;
  group: CompareRow["group"];
  /** The study's own agreement tolerance for this metric: a delta inside it is not a difference. */
  sameWithin: Tolerance;
}

const TONE_TOL: Tolerance = { abs: STUDY.tone.toleranceAbs };
const CAMERA = STUDY.camera.tolerance;
const AUDIO = STUDY.audio.tolerance;

/** The metrics of the diff, in table order: duration, cut count and cadence, camera motion profile, tone, caption presence, pauses and pace. */
export const ROW_SPECS: RowSpec[] = [
  { id: "media.durationSec", group: "media", sameWithin: { abs: 0.1 } },
  { id: "cuts.count", group: "cuts", sameWithin: { abs: 0 } },
  { id: "cuts.perMinute", group: "cuts", sameWithin: { rel: STUDY.cuts.unmatchedShareMax } },
  { id: "shots.medianLengthSec", group: "cuts", sameWithin: { rel: STUDY.cuts.unmatchedShareMax } },
  { id: "camera.movingShare", group: "camera", sameWithin: { abs: CAMERA.movingShareAbs } },
  { id: "camera.medianSpeedWidthsPerSec", group: "camera", sameWithin: { abs: CAMERA.speedAbsWidthsPerSec, rel: CAMERA.speedRel } },
  { id: "camera.moveCount", group: "camera", sameWithin: { abs: CAMERA.moveCountAbs } },
  { id: "camera.framesPerMove", group: "camera", sameWithin: { abs: CAMERA.moveFramesAbs, rel: CAMERA.moveFramesRel } },
  { id: "tone.meanLuma", group: "tone", sameWithin: TONE_TOL },
  { id: "tone.contrast", group: "tone", sameWithin: { abs: STUDY.tone.toleranceAbs * 2 } },
  { id: "tone.blackPoint", group: "tone", sameWithin: TONE_TOL },
  { id: "tone.saturation", group: "tone", sameWithin: TONE_TOL },
  { id: "captions.presenceShare", group: "captions", sameWithin: { abs: STUDY.captions.presenceToleranceAbs } },
  { id: "audio.firstSpeechSec", group: "audio", sameWithin: { abs: 0.1 } },
  { id: "audio.speechShare", group: "audio", sameWithin: { abs: AUDIO.speechShareAbs } },
  { id: "audio.pauseCount", group: "audio", sameWithin: { abs: AUDIO.pauseCountAbs } },
  { id: "audio.pauseTotalSec", group: "audio", sameWithin: { abs: AUDIO.pauseTotalAbsSec, rel: AUDIO.pauseTotalRel } },
  { id: "audio.longestPauseSec", group: "audio", sameWithin: { abs: AUDIO.pauseTotalAbsSec, rel: AUDIO.pauseTotalRel } },
  { id: "audio.wpm", group: "audio", sameWithin: { abs: 0 } },
];

// Finds a metric of a bible by id.
function findMetric(bible: StudyBible, id: string): Metric | null {
  return bible.metrics.find((m) => m.id === id) ?? null;
}

// Reads one side of a row from a study metric: its status, the agreed value and every method's number.
function readSide(metric: Metric): SideReading {
  return {
    status: metric.status,
    value: metric.value,
    readings: metric.methods.map((m) => ({ method: m.method, value: m.value })),
    ...(metric.reason ? { reason: metric.reason } : {}),
  };
}

// True when a side stands behind a number: two methods agreed, or one named non-pixel method read it.
function isStanding(side: SideReading): boolean {
  return (side.status === "agreed" || side.status === "not-pixel") && side.value !== null;
}

// Names the side(s) whose reading is not usable, in words (the study's own reason stays in that side's bible).
function unusableSides(ref: SideReading, ours: SideReading): string {
  const parts: string[] = [];
  if (!isStanding(ref)) parts.push(`the reference is ${ref.status}`);
  if (!isStanding(ours)) parts.push(`ours is ${ours.status}`);
  return parts.join("; ");
}

// Builds one row from the two bibles. A row has a delta only when both sides stand behind their number.
export function buildRow(spec: RowSpec, ours: StudyBible, ref: StudyBible): CompareRow {
  const mo = findMetric(ours, spec.id);
  const mr = findMetric(ref, spec.id);
  const label = (mo ?? mr)?.label ?? spec.id;
  const unit = (mo ?? mr)?.unit ?? "";
  const base = { id: spec.id, label, unit, group: spec.group, sameWithin: describeTolerance(spec.sameWithin, unit) };
  if (!mo || !mr) {
    const missing = !mr && !mo ? "neither video has" : !mr ? "the reference has no" : "ours has no";
    return { ...base, status: "not-measured", ref: mr ? readSide(mr) : null, ours: mo ? readSide(mo) : null, delta: null, relativeDelta: null, differs: null, reason: `${missing} ${spec.id} (the study could not produce it: for example no audio track, or no word list for words per minute)` };
  }
  const sideRef = readSide(mr);
  const sideOurs = readSide(mo);
  if (!isStanding(sideRef) || !isStanding(sideOurs)) {
    return { ...base, status: "unresolved", ref: sideRef, ours: sideOurs, delta: null, relativeDelta: null, differs: null, reason: `not used: ${unusableSides(sideRef, sideOurs)}. The two methods did not agree on that side. Both readings are kept and no delta is stated` };
  }
  const o = sideOurs.value as number;
  const r = sideRef.value as number;
  const delta = round(o - r);
  const larger = Math.max(Math.abs(o), Math.abs(r));
  return {
    ...base,
    status: "agreed",
    ref: sideRef,
    ours: sideOurs,
    delta,
    relativeDelta: larger === 0 ? 0 : round(Math.abs(o - r) / larger),
    differs: !withinTolerance(o, r, spec.sameWithin),
  };
}

// Builds every row of the diff, in table order.
export function buildRows(ours: StudyBible, ref: StudyBible): CompareRow[] {
  return ROW_SPECS.map((spec) => buildRow(spec, ours, ref));
}

// Builds the facts that are text, not numbers (the aspect).
export function buildFacts(ours: StudyBible, ref: StudyBible): TextFact[] {
  return [{ id: "media.aspect", label: "Aspect", ref: ref.media.aspect, ours: ours.media.aspect, same: ref.media.aspect === ours.media.aspect }];
}
