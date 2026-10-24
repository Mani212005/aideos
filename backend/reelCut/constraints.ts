/**
 * File Description: Extracts the narration locks and displayed data a reel writer must preserve.
 * Inputs and outputs: Film, optional shared design and look plan -> ordered shot constraints and hashes.
 * Used by: backend/reelCut/check.ts and brief.ts.
 */
import { createHash } from "node:crypto";
import type { Block, Film } from "../../src/dl/schema";
import type { DesignSpec } from "../designSpec/spec";
import type { LookPlan } from "../lookPlan/schema";
import { resolveCue } from "../designSpec/cues";
import type { Cues } from "../sceneKit/timing";
import { spokenNumbers } from "../review/speech";
import { buildTimeline } from "../../src/dl/camera";
import { easeExpo, frames, MS } from "../../src/dl/motion";
import { minimumShotSeconds } from "./motion";

export interface ReelPhraseLock {
  phrase: string;
  unique: boolean;
  source: string;
}
export interface ReelShotConstraint {
  id: string;
  narration: string;
  hash: string;
  longSec: number;
  minSec: number;
  locks: ReelPhraseLock[];
  onScreenText: string[];
  onScreenNumbers: number[];
  decisive: boolean;
}
export interface ReelContext {
  filmId: string;
  fps: number;
  wordsPerSec: number;
  shots: ReelShotConstraint[];
}

// Hashes the exact long line so edits, including punctuation changes, invalidate its reel counterpart.
export function narrationHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// Counts the same whitespace-delimited spoken tokens the cue matcher consumes.
export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word)).length;
}

// Reads a phrase cue through the real grammar without maintaining a second cue parser.
function phraseCue(
  cue: string | number,
): { id: string; phrase: string } | undefined {
  let found: { id: string; phrase: string } | undefined;
  // Captures a grammar-validated phrase; non-phrase look and design cues carry no lock.
  const word = (id: string, phrase: string): number => {
    found = { id, phrase };
    return 0;
  };
  const cues: Cues = {
    at: () => 0,
    from: () => 0,
    to: () => 0,
    word,
    wordOnce: word,
    durationFrames: 0,
  };
  resolveCue(cue, cues);
  return found;
}

// Samples the same eased progress used by the animated primitives at each rendered shot frame.
function progressSamples(
  durationInFrames: number,
  fps: number,
  durationMs: number,
  delayMs: number,
  valueAt: (progress: number) => string,
): string[] {
  return Array.from({ length: durationInFrames }, (_, frame) =>
    valueAt(easeExpo((frame - frames(delayMs, fps)) / frames(durationMs, fps))),
  );
}

// Formats one counter tick with the same visible compact notation as StatCounter.
function statCounterText(value: number, to: number, format: "plain" | "compact"): string {
  if (format === "compact") {
    const abs = Math.abs(value);
    if (abs >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
    if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}k`;
  }
  return (to >= 1900 && to <= 2100) || format === "plain"
    ? String(value)
    : value.toLocaleString("en-US");
}

// Lists block text and every numeric label rendered during its shot.
function blockText(
  block: Block,
  durationInFrames: number,
  fps: number,
  index: number,
): string[] {
  switch (block.c) {
    case "Kicker":
    case "TextReveal":
    case "Body":
    case "Math":
    case "IconLabel":
      return [block.text];
    case "StatCounter":
      return [
        ...progressSamples(durationInFrames, fps, 900, MS.stagger * index, (p) =>
          statCounterText(Math.round(block.to * p), block.to, block.format),
        ),
        block.label,
      ];
    case "ProgressBar":
      return block.label
        ? [
            ...progressSamples(durationInFrames, fps, 900, MS.stagger * index, (p) =>
              String(Math.round(p * block.value * 100)),
            ),
            block.label,
          ]
        : [];
    case "Plot":
      return [block.xLabel ?? "", block.yLabel ?? "", block.endLabel ?? ""];
    case "MatrixGrid":
      return [
        block.rowLabel ?? "",
        block.colLabel ?? "",
        block.valueLabel ?? "",
      ];
    case "Distribution":
      return [
        block.prompt ?? "",
        block.note ?? "",
        ...block.items.flatMap((i) => [i.label, i.p.toFixed(2)]),
      ];
    case "TokenStrip":
      return [...block.tokens, block.caption ?? ""];
    case "AttentionArcs":
      return [...block.tokens, block.note ?? ""];
    case "VectorSpace":
      return [
        block.xLabel ?? "",
        block.yLabel ?? "",
        block.arrow?.label ?? "",
        ...block.points.map((p) => p.label ?? ""),
      ];
    case "LayerStack":
      {
        const count = block.count ?? 32;
        const sweepFrom = frames(MS.enter, fps);
        const sweepSpan = Math.max(
          1,
          durationInFrames - frames(MS.enter + MS.move, fps),
        );
        const indexes = Array.from({ length: durationInFrames }, (_, frame) => {
          const travel = Math.max(0, Math.min(1, (frame - sweepFrom) / sweepSpan));
          return String(Math.min(count - 1, Math.floor(travel * count)) + 1);
        });
      return [
        ...indexes,
        String(count),
        block.bottomLabel ?? "",
        block.topLabel ?? "",
        block.prompt ?? "",
        ...(block.layers ?? []).flatMap((l) =>
          typeof l === "string" ? [l] : [l.label, l.dim ?? ""],
        ),
      ];
      }
    case "ScaleBar":
      return [...block.ticks, block.label ?? ""];
    case "AnalogyInset":
      return [block.caption];
    case "Card":
      return [block.title, block.body ?? "", block.tag ?? ""];
    case "CodeBlock":
      return [block.code, block.caption ?? ""];
    case "Divider":
      return [];
    default: {
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

// Converts compact magnitude labels to their full numeric value before shared number grounding.
function groundedNumbers(text: string): number[] {
  const expanded = text.replace(/\b(\d[\d,]*(?:\.\d+)?)\s*([kmbt])\b/gi, (_, raw: string, suffix: string) => {
    const scale: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
    return String(Number(raw.replace(/,/g, "")) * scale[suffix.toLowerCase()]);
  });
  return spokenNumbers(expanded);
}

// Extracts every shared-design lock, including look camera/cast cues and decisive performances.
export function createReelContext({
  film,
  design,
  look,
  visibleText = {},
}: {
  film: Film;
  design?: DesignSpec;
  look?: LookPlan;
  visibleText?: Record<string, string[]>;
}): ReelContext {
  const minimum = minimumShotSeconds(film);
  const durationByShot = new Map(
    buildTimeline(film).map((timed) => [timed.shot.id, timed.durationInFrames]),
  );
  const shots: ReelShotConstraint[] = film.shots.map((s) => {
    const onScreenText = [
      ...s.blocks.flatMap((block, index) =>
        blockText(block, durationByShot.get(s.id) ?? 1, film.fps, index),
      ),
      ...(visibleText[s.id] ?? []),
    ].filter(Boolean);
    return {
      id: s.id,
      narration: s.scriptText ?? "",
      hash: narrationHash(s.scriptText ?? ""),
      longSec: s.dur,
      minSec: minimum.get(s.id) ?? 1 / film.fps,
      locks: [],
      onScreenText,
      onScreenNumbers: [...new Set(onScreenText.flatMap(groundedNumbers))],
      decisive: false,
    };
  });
  const byId = new Map(shots.map((s) => [s.id, s]));
  // Adds one phrase lock, merging duplicates while preserving decisive uniqueness.
  const lock = (id: string, phrase: string, source: string, unique = false) => {
    const shot = byId.get(id);
    if (!shot) throw new Error(`${source} names unknown shot "${id}"`);
    const prior = shot.locks.find((l) => l.phrase === phrase);
    if (prior) prior.unique ||= unique;
    else shot.locks.push({ phrase, source, unique });
    shot.decisive ||= unique;
  };
  // Pulls a lock out of an authored cue, failing closed on malformed cue syntax.
  const cue = (value: string | number, source: string) => {
    const found = phraseCue(value);
    if (found) lock(found.id, found.phrase, source);
  };
  for (const c of design?.clips ?? []) {
    cue(c.start, `design clip ${c.id} start`);
    cue(c.end, `design clip ${c.id} end`);
  }
  for (const c of design?.camera ?? [])
    cue(c.at, `design camera ${c.id ?? c.at}`);
  for (const s of look?.shots ?? []) lock(s.id, s.cue, `look shot ${s.id}`);
  for (const c of look?.film.camera ?? []) cue(c.at, "look camera");
  for (const c of look?.film.cast ?? []) {
    cue(c.enters, `look cast ${c.id}`);
    for (const change of c.changes) cue(change.at, `look cast ${c.id} change`);
  }
  const performances = [
    ...(design && "performances" in design ? design.performances : []),
    ...(look?.schema === "aideos.look/2" ? look.film.performances : []),
    ...(film.scene?.performances ?? []),
  ];
  for (const p of performances) {
    if ("start" in p) cue(p.start, `performance ${p.id} start`);
    lock(
      p.decisive.shotId,
      p.decisive.phrase,
      `performance ${p.id} decisive`,
      true,
    );
  }
  const longSec =
    film.voiceover?.durationSec ?? shots.reduce((sum, s) => sum + s.longSec, 0);
  const wordCount = shots.reduce((sum, s) => sum + countWords(s.narration), 0);
  if (!wordCount || !(longSec > 0))
    throw new Error(
      "reel cut needs the long film's narration and measured duration to estimate its speaking rate",
    );
  return {
    filmId: film.id,
    fps: film.fps,
    wordsPerSec: wordCount / longSec,
    shots,
  };
}
