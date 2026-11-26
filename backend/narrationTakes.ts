/**
 * File Description: The take-selection seam for natural narration. A narration line can be spoken as several
 * takes (a retry, another seed, or a better voice build); every take is measured (loudness, clipping, dead air,
 * pace), optionally scored for naturalness by a pluggable scorer, and one take is chosen by a fixed rule. The
 * chosen take is what voiceLines.ts caches, under a voice key that carries the selector's identity, so changing
 * the scorer, the thresholds or the take count re-records lines and an unchanged selector reuses them. The module
 * has no speech engine, network or scorer of its own: synthesis and scoring are injected, and the owner's voice
 * recordings never enter it (it only ever sees the samples a synthesizer returns for one line).
 * Inputs and outputs: a line's text, a take synthesizer and a selector -> the chosen LineAudio plus a per-take report, and the cache voice key.
 * Used by: backend/audio.ts (produceAudioPipeline), backend/narrationTakes.test.ts, docs/NATURAL_NARRATION.md.
 */

import { createHash } from "node:crypto";
import type { LineAudio } from "./voiceLines";
import { longestSilenceSec, trimSilence } from "./pcm";
import { HOUSE_PACE } from "../src/dl/pacingProfile";

/** One take as a synthesizer returns it: the audio and, when the voice service reports one, its own naturalness score in 0..1. */
export interface TakeResult {
  audio: LineAudio;
  reportedScore?: number;
}

/** Speaks one line as take number `takeIndex` (0 for the first); a source may use the index as a seed or retry counter. */
export type TakeSynthesizer = (text: string, takeIndex: number) => Promise<TakeResult>;

/** Everything a scorer sees about one take. */
export interface ScoreInput {
  text: string;
  audio: LineAudio;
  /** The score the voice service reported with this take, when it reports one. */
  reportedScore?: number;
}

/**
 * Scores how natural (not robotic) a take sounds, from 0 (robotic) to 1 (natural), or null when it cannot say.
 * `id` and `version` identify the scorer and its model: they are part of the cache key, so bump `version`
 * whenever the scoring changes.
 */
export interface NaturalnessScorer {
  id: string;
  version: string;
  score(input: ScoreInput): Promise<number | null>;
}

/** Sanity gates a take must pass on the dry line, before the film-wide loudness mastering and the music mix. */
export interface TakeGates {
  /** Highest allowed absolute sample value (linear, 1 is full scale); a take at or above it is clipped. */
  maxPeak: number;
  /** Allowed active-speech RMS level in dBFS, [too quiet, too hot]. Mastering levels the film later; this only catches broken takes. */
  activeRmsDb: readonly [number, number];
  /** Longest allowed silence inside the line (edge silence is trimmed first), seconds. */
  maxInternalSilenceSec: number;
  /** Allowed speaking pace of the finished line in words per minute, [slowest, fastest]; checked only for lines of `minWordsForPace` words or more. */
  wpmWindow: readonly [number, number];
  /** Shortest line (in words) whose pace is judged; a two-word line legitimately runs at any pace. */
  minWordsForPace: number;
}

/** A selector: how many takes to try, when to stop early, how to score them and what they must pass. */
export interface TakeSelector {
  /** Short name of this selection policy, part of the cache key. */
  id: string;
  /** The most takes tried per line (1 to 8). */
  maxTakes: number;
  /** A take that passes every gate and scores at least this stops the search early. */
  acceptScore: number;
  /** A take scoring below this fails the naturalness gate. */
  minScore: number;
  gates: TakeGates;
  /** The pluggable naturalness scorer; null selects on the gates alone (the first take that passes wins). */
  scorer: NaturalnessScorer | null;
}

/** Why a take failed a gate. */
export type TakeViolation = "empty" | "clipping" | "too-quiet" | "too-hot" | "dead-air" | "too-slow" | "too-fast" | "low-naturalness";

/** What was measured on one take (all from its samples, never from a transcript). */
export interface TakeMeasure {
  /** Highest absolute sample value, linear. */
  peak: number;
  /** RMS level of the active (non-silent) samples in dBFS, or null for a silent take. */
  activeRmsDb: number | null;
  /** Longest silence inside the line, seconds (edges trimmed). */
  longestSilenceSec: number;
  /** Speech duration with edge silence trimmed, seconds. */
  speechSec: number;
  /** Words of the line per minute of speech, or null when the line has no speech. */
  wordsPerMinute: number | null;
}

/** One take with its measurements, its score and the gates it failed. */
export interface TakeReport {
  index: number;
  measure: TakeMeasure;
  /** The naturalness score used for selection (0..1), or null when none was available. */
  score: number | null;
  violations: TakeViolation[];
}

/** The decision for one line. */
export interface TakeChoice {
  text: string;
  /** The cache identity of the selector that decided. */
  selectorKey: string;
  chosenIndex: number;
  takes: TakeReport[];
  /** True when at least one take had a score; false means the choice rests on the gates alone. */
  scored: boolean;
  /** True when even the chosen take failed a gate (no take was clean), so a reviewer should look at this line. */
  degraded: boolean;
}

/** The silence threshold shared with the rest of the narration pipeline (see trimSilence in pcm.ts). */
const SILENCE_THRESHOLD = 0.005;

/** The most takes one line may try; each take is a full synthesis, and the voice service runs one job at a time. */
export const MAX_TAKES_LIMIT = 8;

/**
 * Provisional gates: wide sanity bounds that only reject broken takes (clipped, near-silent, stuck, hurried or
 * dragging). The pace window is the house pace window widened by a quarter on each side. They are to be tightened
 * against the owner's own recordings by the voice-clone work, never by guessing here.
 */
export const DEFAULT_TAKE_GATES: TakeGates = {
  maxPeak: 0.999,
  activeRmsDb: [-38, -10],
  maxInternalSilenceSec: HOUSE_PACE.deadAirMaxSec,
  wpmWindow: [Math.round(HOUSE_PACE.wpmWindow[0] * 0.75), Math.round(HOUSE_PACE.wpmWindow[1] * 1.25)],
  minWordsForPace: 4,
};

// Builds a selector with the provisional gates, validating it.
export function createTakeSelector(options: {
  id: string;
  maxTakes: number;
  scorer: NaturalnessScorer | null;
  acceptScore?: number;
  minScore?: number;
  gates?: Partial<TakeGates>;
}): TakeSelector {
  const selector: TakeSelector = {
    id: options.id,
    maxTakes: options.maxTakes,
    acceptScore: options.acceptScore ?? 0.8,
    minScore: options.minScore ?? 0.5,
    gates: { ...DEFAULT_TAKE_GATES, ...options.gates },
    scorer: options.scorer,
  };
  assertValidSelector(selector);
  return selector;
}

// Throws a plain error when a selector's numbers cannot make a sound decision.
export function assertValidSelector(selector: TakeSelector): void {
  const inUnit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  if (!selector.id.trim()) throw new Error("take selector: id must not be empty");
  if (!Number.isInteger(selector.maxTakes) || selector.maxTakes < 1 || selector.maxTakes > MAX_TAKES_LIMIT) {
    throw new Error(`take selector: maxTakes must be a whole number from 1 to ${MAX_TAKES_LIMIT}, got ${selector.maxTakes}`);
  }
  if (!inUnit(selector.acceptScore) || !inUnit(selector.minScore)) throw new Error("take selector: acceptScore and minScore must be between 0 and 1");
  if (selector.minScore > selector.acceptScore) throw new Error("take selector: minScore must not exceed acceptScore");
  const { maxPeak, activeRmsDb, maxInternalSilenceSec, wpmWindow, minWordsForPace } = selector.gates;
  if (!(maxPeak > 0 && maxPeak <= 1)) throw new Error("take selector: gates.maxPeak must be in (0, 1]");
  if (!(activeRmsDb[0] < activeRmsDb[1])) throw new Error("take selector: gates.activeRmsDb must be [low, high] with low < high");
  if (!(maxInternalSilenceSec > 0)) throw new Error("take selector: gates.maxInternalSilenceSec must be positive");
  if (!(wpmWindow[0] > 0 && wpmWindow[0] < wpmWindow[1])) throw new Error("take selector: gates.wpmWindow must be [slowest, fastest] with 0 < slowest < fastest");
  if (!Number.isInteger(minWordsForPace) || minWordsForPace < 1) throw new Error("take selector: gates.minWordsForPace must be a whole number of at least 1");
}

/**
 * The cache identity of a selector: its name, its scorer and scorer version, and a hash of every number that
 * can change a decision. Any change to the policy changes this string, so stored lines never outlive it.
 */
export function takeSelectorKey(selector: TakeSelector): string {
  const policy = JSON.stringify([selector.maxTakes, selector.acceptScore, selector.minScore, selector.gates, selector.scorer?.id ?? null, selector.scorer?.version ?? null]);
  const hash = createHash("sha256").update(policy).digest("hex").slice(0, 8);
  return `${selector.id}.${hash}`;
}

/**
 * The voice key lines are cached under when a selector chooses them. No selector keeps the plain key, so a line
 * recorded before takes existed stays valid. Apply the stretch suffix (pacedVoiceKey) on top of this key.
 */
export function takesVoiceKey(voiceKey: string, selector: TakeSelector | undefined): string {
  return selector ? `${voiceKey}|takes=${takeSelectorKey(selector)}` : voiceKey;
}

// Counts the words of a narration line.
function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// Measures one take from its samples: level, clipping, dead air and pace.
export function measureTake(text: string, audio: LineAudio): TakeMeasure {
  let peak = 0;
  let activeSumSquares = 0;
  let activeCount = 0;
  let speechSamples = 0;
  let silence = 0;
  for (const chunk of audio.chunks) {
    const trimmed = trimSilence(chunk.samples, SILENCE_THRESHOLD);
    speechSamples += trimmed.length;
    silence = Math.max(silence, longestSilenceSec(trimmed, audio.sampleRate, SILENCE_THRESHOLD));
    for (let i = 0; i < trimmed.length; i++) {
      const a = Math.abs(trimmed[i]);
      if (a > peak) peak = a;
      if (a > SILENCE_THRESHOLD) {
        activeSumSquares += trimmed[i] * trimmed[i];
        activeCount += 1;
      }
    }
  }
  const speechSec = speechSamples / audio.sampleRate;
  return {
    peak,
    activeRmsDb: activeCount > 0 ? 10 * Math.log10(activeSumSquares / activeCount) : null,
    longestSilenceSec: silence,
    speechSec,
    wordsPerMinute: speechSec > 0 ? (wordCount(text) / speechSec) * 60 : null,
  };
}

// Lists the gates a measured take fails (not counting the naturalness gate).
export function gateViolations(text: string, measure: TakeMeasure, gates: TakeGates): TakeViolation[] {
  if (measure.activeRmsDb === null || measure.speechSec <= 0) return ["empty"];
  const out: TakeViolation[] = [];
  if (measure.peak >= gates.maxPeak) out.push("clipping");
  if (measure.activeRmsDb < gates.activeRmsDb[0]) out.push("too-quiet");
  if (measure.activeRmsDb > gates.activeRmsDb[1]) out.push("too-hot");
  if (measure.longestSilenceSec > gates.maxInternalSilenceSec) out.push("dead-air");
  if (measure.wordsPerMinute !== null && wordCount(text) >= gates.minWordsForPace) {
    if (measure.wordsPerMinute < gates.wpmWindow[0]) out.push("too-slow");
    if (measure.wordsPerMinute > gates.wpmWindow[1]) out.push("too-fast");
  }
  return out;
}

// Orders two reports: fewer violations first, then the higher score (a scored take beats an unscored one), then the earlier take.
function compareReports(a: TakeReport, b: TakeReport): number {
  if (a.violations.length !== b.violations.length) return a.violations.length - b.violations.length;
  const sa = a.score ?? -1;
  const sb = b.score ?? -1;
  if (sa !== sb) return sb - sa;
  return a.index - b.index;
}

/**
 * The per-line selection rule. Takes are made in order up to `maxTakes`. A take that passes every gate and
 * either scores at least `acceptScore` or has no score to improve on ends the search. The chosen take is the one
 * with the fewest failed gates, then the highest score, then the earliest. When even the best take fails a gate
 * the choice is marked degraded so the line can be reviewed, and it is still used so a film is never blocked.
 */
export async function selectTake(text: string, synthesize: TakeSynthesizer, selector: TakeSelector): Promise<{ audio: LineAudio; choice: TakeChoice }> {
  assertValidSelector(selector);
  const made: Array<{ report: TakeReport; audio: LineAudio }> = [];
  for (let index = 0; index < selector.maxTakes; index++) {
    const take = await synthesize(text, index);
    const measure = measureTake(text, take.audio);
    const raw = selector.scorer ? await selector.scorer.score({ text, audio: take.audio, reportedScore: take.reportedScore }) : null;
    if (raw !== null && !(Number.isFinite(raw) && raw >= 0 && raw <= 1)) {
      throw new Error(`naturalness scorer "${selector.scorer?.id}" returned ${raw} for take ${index}; scores must be between 0 and 1`);
    }
    const violations = gateViolations(text, measure, selector.gates);
    if (raw !== null && raw < selector.minScore) violations.push("low-naturalness");
    made.push({ report: { index, measure, score: raw, violations }, audio: take.audio });
    if (violations.length === 0 && (raw === null || raw >= selector.acceptScore)) break;
  }
  const best = made.reduce((winner, candidate) => (compareReports(candidate.report, winner.report) < 0 ? candidate : winner));
  return {
    audio: best.audio,
    choice: {
      text,
      selectorKey: takeSelectorKey(selector),
      chosenIndex: best.report.index,
      takes: made.map((m) => m.report),
      scored: made.some((m) => m.report.score !== null),
      degraded: best.report.violations.length > 0,
    },
  };
}

/**
 * Wraps a take synthesizer as the one-line synthesizer voiceLines.synthesizeLines expects: each line is spoken as
 * up to `maxTakes` takes and only the chosen take is returned (and so stored). `onChoice` receives each decision.
 */
export function withTakes(
  synthesize: TakeSynthesizer,
  selector: TakeSelector,
  onChoice?: (choice: TakeChoice) => void,
): (text: string) => Promise<LineAudio> {
  assertValidSelector(selector);
  return async (text) => {
    const { audio, choice } = await selectTake(text, synthesize, selector);
    onChoice?.(choice);
    return audio;
  };
}

/**
 * A scorer that passes through the naturalness score the voice service reports with each take. A take with no
 * score, or one outside 0..1, counts as unscored (null) rather than failing the film on a service quirk.
 */
export function reportedScoreScorer(version: string): NaturalnessScorer {
  return {
    id: "service-reported",
    version,
    async score(input) {
      const s = input.reportedScore;
      return typeof s === "number" && Number.isFinite(s) && s >= 0 && s <= 1 ? s : null;
    },
  };
}
