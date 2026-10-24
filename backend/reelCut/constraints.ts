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

// Lists text the block actually displays, keeping coordinates and animation parameters out of grounding.
function blockText(block: Block): string[] {
  switch (block.c) {
    case "Kicker":
    case "TextReveal":
    case "Body":
    case "Math":
    case "IconLabel":
      return [block.text];
    case "StatCounter":
      return [String(block.to), block.label];
    case "ProgressBar":
      return block.label
        ? [String(Math.round(block.value * 100)), block.label]
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
      return [
        String(block.count ?? 32),
        block.bottomLabel ?? "",
        block.topLabel ?? "",
        block.prompt ?? "",
        ...(block.layers ?? []).flatMap((l) =>
          typeof l === "string" ? [l] : [l.label, l.dim ?? ""],
        ),
      ];
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
  const shots: ReelShotConstraint[] = film.shots.map((s) => {
    const onScreenText = [
      ...s.blocks.flatMap(blockText),
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
