/**
 * File Description: Builds the seed of `aideos study` from a bible: a proposed partial design/look.json made only of metrics the two methods agreed on
 * (never a valid look plan by itself: it has no cast, camera poses or shots), the list of excluded metrics, and a look brief paragraph made of numbers.
 * Everything is marked as a proposal. Pure functions, no I/O.
 * Inputs and outputs: a StudyBible -> a LookSeed object and a markdown paragraph for the look brief.
 * Used by: backend/study/run.ts, backend/study/format.ts.
 */

import { IP_BOUNDARY, round, SEED_SCHEMA, type Metric, type StudyBible } from "./types";

/** One seed entry: a number, where it would go in look.json, and the two readings behind it. */
export interface SeedEntry {
  metric: string;
  value: number | string;
  lookPath: string;
  methods: Array<{ method: string; value: number | null }>;
}

/** The seed written next to a study (and, with --into, into a film package as design/look.seed.json). */
export interface LookSeed {
  schema: typeof SEED_SCHEMA;
  proposal: true;
  boundary: string;
  source: string;
  partialLook: Record<string, unknown>;
  entries: SeedEntry[];
  excluded: Array<{ metric: string; status: string; reason: string }>;
  brief: string;
}

/** Where each metric lands in the partial look. `film.captions.position` is a real look.json field; `film.targets.*` are numeric targets that look.json has no field for yet. */
const TARGET_PATHS: Record<string, string> = {
  "cuts.perMinute": "film.targets.cutsPerMinute",
  "shots.medianLengthSec": "film.targets.shotSec.median",
  "shots.p10LengthSec": "film.targets.shotSec.p10",
  "shots.p90LengthSec": "film.targets.shotSec.p90",
  "camera.movingShare": "film.targets.camera.movingShare",
  "camera.medianSpeedWidthsPerSec": "film.targets.camera.medianSpeedWidthsPerSec",
  "camera.p90SpeedWidthsPerSec": "film.targets.camera.p90SpeedWidthsPerSec",
  "camera.framesPerMove": "film.targets.camera.framesPerMove",
  "tone.meanLuma": "film.targets.tone.meanLuma",
  "tone.blackPoint": "film.targets.tone.blackPoint",
  "tone.contrast": "film.targets.tone.contrast",
  "tone.saturation": "film.targets.tone.saturation",
  "captions.presenceShare": "film.targets.captions.presenceShare",
  "audio.firstSpeechSec": "film.targets.narration.firstSpeechSec",
  "audio.longestPauseSec": "film.targets.narration.longestPauseSec",
  "audio.pauseCount": "film.targets.narration.pauseCount",
  "audio.loudnessLufs": "film.targets.narration.loudnessLufs",
  "audio.wpm": "film.targets.narration.wpm",
};

// Sets a nested value in a plain object by a dotted path.
function setPath(target: Record<string, unknown>, dotted: string, value: unknown): void {
  const keys = dotted.split(".");
  let node = target;
  for (const key of keys.slice(0, -1)) {
    const next = node[key];
    node = (typeof next === "object" && next !== null ? next : (node[key] = {})) as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
}

// Finds a metric by id.
function find(bible: StudyBible, id: string): Metric | undefined {
  return bible.metrics.find((m) => m.id === id);
}

// The value of a metric when it may seed a look, otherwise null.
function eligible(bible: StudyBible, id: string): number | null {
  const m = find(bible, id);
  return m && m.seedEligible && m.value !== null ? m.value : null;
}

// Writes the look brief paragraph from the agreed numbers; every clause is a number, and what is missing is named.
export function briefParagraph(bible: StudyBible): string {
  const v = (id: string) => {
    const value = eligible(bible, id);
    return value === null ? null : round(value, 3);
  };
  const clauses: string[] = [];
  const cuts = v("cuts.perMinute");
  if (cuts !== null) {
    const med = v("shots.medianLengthSec");
    const lo = v("shots.p10LengthSec");
    const hi = v("shots.p90LengthSec");
    clauses.push(`${cuts} hard cuts per minute${med !== null ? `, a median shot of ${med} s` : ""}${lo !== null && hi !== null ? ` (10th to 90th percentile ${lo} to ${hi} s)` : ""}`);
  }
  const moving = v("camera.movingShare");
  if (moving !== null) {
    const speed = v("camera.medianSpeedWidthsPerSec");
    const frames = v("camera.framesPerMove");
    clauses.push(`the camera moves in ${Math.round(moving * 100)}% of frames${speed !== null ? `, at a median ${speed} frame widths per second` : ""}${frames !== null ? `, a move lasting a median ${frames} frames` : ""}`);
  }
  const luma = v("tone.meanLuma");
  if (luma !== null) {
    const black = v("tone.blackPoint");
    const contrast = v("tone.contrast");
    const sat = v("tone.saturation");
    clauses.push(`mean luma ${luma}${black !== null ? `, black point ${black}` : ""}${contrast !== null ? `, contrast ${contrast}` : ""}${sat !== null ? `, saturation ${sat}` : ""} (all on 0 to 1 scales)`);
  }
  const captions = v("captions.presenceShare");
  if (captions !== null) clauses.push(`captions are on screen in ${Math.round(captions * 100)}% of sampled moments`);
  const wpm = v("audio.wpm");
  const first = v("audio.firstSpeechSec");
  const longest = v("audio.longestPauseSec");
  const speech: string[] = [];
  if (wpm !== null) speech.push(`${wpm} words per minute`);
  if (first !== null) speech.push(`first sound at ${first} s`);
  if (longest !== null) speech.push(`longest pause ${longest} s`);
  if (speech.length) clauses.push(`speech: ${speech.join(", ")}`);
  const excluded = bible.metrics.filter((m) => !m.seedEligible).map((m) => m.id);
  const body = clauses.length ? `Measured on the reference: ${clauses.join("; ")}.` : "No metric was agreed by two methods, so there is nothing to seed.";
  const tail = excluded.length ? ` Not agreed, therefore not used: ${excluded.join(", ")}.` : "";
  return `PROPOSAL from measured numbers, not a plan and not a verdict. ${body}${tail}`;
}

// Builds the look seed from the agreed metrics of a bible.
export function buildSeed(bible: StudyBible): LookSeed {
  const entries: SeedEntry[] = [];
  const partial: Record<string, unknown> = {
    _partial: "Not a valid aideos.look document: it has no cast, camera poses or shots. `film.captions.position` is a real look.json field; `film.targets.*` are numbers the plan may use and look.json has no field for yet.",
  };
  for (const metric of bible.metrics) {
    const lookPath = TARGET_PATHS[metric.id];
    if (!lookPath || !metric.seedEligible || metric.value === null) continue;
    entries.push({ metric: metric.id, value: metric.value, lookPath, methods: metric.methods.map((m) => ({ method: m.method, value: m.value })) });
    setPath(partial, lookPath, metric.value);
  }
  const captions = eligible(bible, "captions.presenceShare");
  if (captions !== null && captions >= 0.5) {
    entries.push({ metric: "captions.presenceShare", value: "bottom", lookPath: "film.captions.position", methods: find(bible, "captions.presenceShare")?.methods.map((m) => ({ method: m.method, value: m.value })) ?? [] });
    setPath(partial, "film.captions.position", "bottom");
  }
  return {
    schema: SEED_SCHEMA,
    proposal: true,
    boundary: IP_BOUNDARY,
    source: bible.source.file,
    partialLook: partial,
    entries: entries.map((e) => ({ ...e, value: typeof e.value === "number" ? round(e.value) : e.value })),
    excluded: bible.metrics.filter((m) => !m.seedEligible).map((m) => ({ metric: m.id, status: m.status, reason: m.reason ?? "not measured by two methods" })),
    brief: briefParagraph(bible),
  };
}
