/**
 * File Description: Deterministic music bed selector for the default soundtrack: ranks the eligible library tracks of one act by how little they compete with narration (speech-band share, loudness swells inside the section's own source window), how well their energy and mood fit the act and its pace, and whether the film already used them.
 * Inputs and outputs: one act, its pace and its eligible candidates with their source windows -> candidates ranked best first with every cost part, and a seeded pick among exact ties.
 * Used by: backend/defaultSoundtrack.ts and backend/musicSelector.test.ts.
 */

import type { AudioItem, MusicSwell } from "./audioLibrary/schema";

/** Share of a bed's energy in the speech band (dB) at or below which it costs nothing; above it every dB costs MIDRANGE_COST_PER_DB. */
export const MIDRANGE_FREE_DB = -8;
export const MIDRANGE_COST_PER_DB = 1;
/** A swell rise (dB) at or below this costs nothing; above it every dB costs SWELL_COST_PER_DB. */
export const SWELL_FREE_DB = 4;
export const SWELL_COST_PER_DB = 0.6;
/** Cost per step of difference between a bed's energy (1 to 5) and the energy the act wants. */
export const ENERGY_COST_PER_STEP = 1.5;
/** Reward per mood tag the act prefers, counted up to MOOD_MATCH_CAP tags. */
export const MOOD_REWARD = 0.75;
export const MOOD_MATCH_CAP = 3;
/** A bed with vocals competes with the narrator for the same words; it is chosen only when nothing else is eligible. */
export const VOCAL_COST = 50;
/** A bed the film already used restarts audibly when it plays again, so another bed wins unless it is clearly worse. */
export const REUSE_COST = 4;
/** Costs this close count as a tie, and a tie is broken by the film's seed. */
export const TIE_EPSILON = 0.25;

/** Energy (1 quiet to 5 driving) each story position wants before the pace adjusts it: calm under explanation, lifted for the hook and the payoff. */
export const ROLE_ENERGY: Readonly<Record<string, number>> = { hook: 3, explain: 2, payoff: 3, reel: 3, outro: 2 };
/** Mood tags (library vocabulary) each story position prefers. */
export const ROLE_MOODS: Readonly<Record<string, readonly string[]>> = {
  hook: ["Tension", "Mysterious", "Investigation", "Serious", "Cinematic"],
  explain: ["Underscore", "Atmospheric", "Ambient", "Meditative", "Relaxed", "Technology"],
  payoff: ["Positive", "Hopeful", "Motivational", "Reflective", "Cinematic"],
  reel: ["Rhythmic Underscore", "Futuristic", "Technology", "Positive", "Chillout"],
  outro: ["Hopeful", "Reflective", "Ambient", "Relaxed"],
};
/** Mean shot length (seconds) under which an act is fast cut (wants one more step of energy) and over which it is slow (one fewer). */
export const FAST_SHOT_SEC = 8;
export const SLOW_SHOT_SEC = 16;
const VOCAL_MOOD = /vocal|singer|singing|choir|lyric/i;

export interface MusicAct {
  role: string;
  /** Mean shot length of the act in seconds; null when the act has no measured shots. */
  meanShotSec: number | null;
}

export interface MusicCandidate {
  item: AudioItem;
  /** The part of the track (source seconds) this section would play, offset included. */
  window: { startSec: number; endSec: number };
}

export interface MusicCostParts {
  midrange: number;
  swell: number;
  energy: number;
  mood: number;
  vocals: number;
  reuse: number;
}

export interface RankedMusic {
  item: AudioItem;
  cost: number;
  parts: MusicCostParts;
}

// Returns the energy an act wants, moved one step by its pace and kept inside 1 to 5.
export function targetEnergy(act: MusicAct): number {
  const base = ROLE_ENERGY[act.role] ?? 3;
  const shift = act.meanShotSec === null ? 0 : act.meanShotSec < FAST_SHOT_SEC ? 1 : act.meanShotSec > SLOW_SHOT_SEC ? -1 : 0;
  return Math.min(5, Math.max(1, base + shift));
}

// Whether a bed is known to have vocals: the manifest says so, or a mood tag names a voice.
export function hasVocals(item: AudioItem): boolean {
  return item.instrumental === false || item.moods.some((mood) => VOCAL_MOOD.test(mood));
}

// Sums the cost of every swell that overlaps the section's source window; a track that was never measured has none.
export function swellCost(swells: readonly MusicSwell[], window: MusicCandidate["window"]): number {
  return swells
    .filter((swell) => swell.endSec > window.startSec && swell.startSec < window.endSec)
    .reduce((sum, swell) => sum + Math.max(0, swell.riseDb - SWELL_FREE_DB) * SWELL_COST_PER_DB, 0);
}

// Costs one candidate for an act; lower is better and every part is kept so a choice can be explained.
export function costMusic(act: MusicAct, candidate: MusicCandidate, used: ReadonlySet<string>): RankedMusic {
  const { item, window } = candidate;
  const midrangeDb = item.profile?.midrangeDb ?? MIDRANGE_FREE_DB;
  const preferred = ROLE_MOODS[act.role] ?? [];
  const matches = Math.min(MOOD_MATCH_CAP, item.moods.filter((mood) => preferred.includes(mood)).length);
  const parts: MusicCostParts = {
    midrange: Math.max(0, midrangeDb - MIDRANGE_FREE_DB) * MIDRANGE_COST_PER_DB,
    swell: swellCost(item.profile?.swells ?? [], window),
    energy: Math.abs(item.energy - targetEnergy(act)) * ENERGY_COST_PER_STEP,
    mood: -matches * MOOD_REWARD,
    vocals: hasVocals(item) ? VOCAL_COST : 0,
    reuse: used.has(item.id) ? REUSE_COST : 0,
  };
  const cost = Object.values(parts).reduce((sum, part) => sum + part, 0);
  return { item, cost: Number(cost.toFixed(4)), parts };
}

// Ranks the candidates of one act, cheapest first, equal costs in id order so the result never depends on input order.
export function rankMusic(act: MusicAct, candidates: readonly MusicCandidate[], used: ReadonlySet<string> = new Set()): RankedMusic[] {
  return candidates
    .map((candidate) => costMusic(act, candidate, used))
    .sort((a, b) => a.cost - b.cost || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
}

// Picks the cheapest bed; beds within TIE_EPSILON of it are tied and the seed (a 32-bit integer) picks among them in id order.
export function pickMusic(ranked: readonly RankedMusic[], seed: number): RankedMusic {
  if (ranked.length === 0) throw new Error("pickMusic needs at least one ranked candidate");
  const tied = ranked.filter((entry) => entry.cost - ranked[0].cost <= TIE_EPSILON).sort((a, b) => (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
  return tied[seed % tied.length];
}
