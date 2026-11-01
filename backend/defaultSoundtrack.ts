/**
 * File Description: Completes a film's compulsory music and sound effects deterministically from chapter acts, visual events and the curated free audio library, leaving whatever the owner authored untouched.
 * Inputs and outputs: Film and delivery format -> the film with owner audio preserved and any missing music or effects filled by a hash-locked default soundtrack.
 * Used by: design delivery, design-build CLI and reel builds.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import { buildTimeline } from "../src/dl/camera";
import { deliveryTimeline, type DeliveryFormat } from "../src/dl/delivery";
import { soundtrackMixDefault, type Film, type SoundtrackSection, type SoundtrackSfx } from "../src/dl/schema";
import { computeFileSha256, getDefaultLibraryPath, loadAudioLibrary, verifyAudioItem } from "./audioLibrary/library";
import type { AudioLibrary } from "./audioLibrary/schema";
import { checkSoundtrack } from "./designCheck/soundtrack";
import { resolveAudioSourcePath } from "./audio";
import { detectVisualEvent, getVisualEventFrames } from "./designSpec/soundtrack";

type Act = Pick<SoundtrackSection, "role" | "from" | "to">;

// Whether the owner supplied music: legacy music or audio, a music clip, or authored (not generated) soundtrack sections.
export function hasExplicitMusic(film: Film): boolean {
  return Boolean(film.music || film.audio || film.audioClips?.some((clip) => clip.channel === "music") ||
    (film.soundtrack && !film.soundtrack.defaultScore && film.soundtrack.sections.length > 0));
}

// Whether the owner supplied sound effects: legacy effects, an effects clip, or authored (not generated) soundtrack effects.
export function hasExplicitEffects(film: Film): boolean {
  return Boolean(film.sfx?.length || film.audioClips?.some((clip) => clip.channel === "sfx") ||
    film.soundtrack?.sfx.some((effect) => !effect.generated));
}

// Removes generated music and generated effects while preserving every piece of owner-authored soundtrack data.
function withoutGenerated(film: Film): Film {
  const soundtrack = film.soundtrack;
  if (!soundtrack || (!soundtrack.defaultScore && !soundtrack.sfx.some((effect) => effect.generated))) return film;
  const sections = soundtrack.defaultScore ? [] : soundtrack.sections;
  const sfx = soundtrack.sfx.filter((effect) => !effect.generated);
  const { soundtrack: _generated, ...rest } = film;
  if (sections.length === 0 && sfx.length === 0) return rest;
  const { defaultScore: _marker, ...kept } = soundtrack;
  return { ...rest, soundtrack: { ...kept, sections, sfx } };
}

// Returns frame-aligned chapter starts from the same timeline that playback uses.
function soundtrackChapterCuts(film: Film): number[] {
  const timeline = buildTimeline(film);
  return [0, ...timeline.filter((entry, index) => index > 0 && entry.shot.ch && entry.shot.ch !== timeline[index - 1].shot.ch)
    .map((entry) => entry.from / film.fps)];
}

// Filters by role, rights, dynamics and the exact source span including frame-rounded crossfades.
function candidates(act: Act, index: number, count: number, film: Film, format: DeliveryFormat, library: AudioLibrary) {
  const fade = Math.round((format === "reel" ? 1.5 : 3) * film.fps);
  const from = Math.max(0, Math.round(act.from * film.fps) - (index > 0 ? Math.ceil(fade / 2) : 0));
  const to = Math.round(act.to * film.fps) + (index < count - 1 ? Math.ceil(fade / 2) : 0);
  const span = to - from;
  if (count > 1 && (act.to - act.from < fade / film.fps || span < fade * Number(index > 0) + fade * Number(index < count - 1))) return [];
  return library.items.filter((item) => item.kind === "music" && item.licence.attribution === null &&
    item.roles.includes(act.role) && (item.loudness.lra <= 10 || act.role === "payoff" || act.role === "outro") &&
    Math.floor(item.durationSec * film.fps) >= span).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// Chooses chapter-sized acts, splitting a long explanation once when one track cannot cover it.
function actsFor(film: Film, format: DeliveryFormat, library: AudioLibrary, completeLibrary: AudioLibrary): Act[] {
  const cuts = soundtrackChapterCuts(film);
  const delivery = deliveryTimeline(film, format);
  const end = delivery.totalFrames / film.fps;
  const storyEnd = delivery.storyFrames / film.fps;
  const single: Act[] = [{ role: format === "reel" ? "reel" : "hook", from: 0, to: end }];
  if (format === "reel" && candidates(single[0], 0, 1, film, format, library).length) return single;
  const last = cuts[cuts.length - 1];
  const plans: Act[][] = [];
  if (cuts.length > 1) {
    const hook: Act = { role: "hook", from: 0, to: cuts[1] };
    const payoff: Act = { role: "payoff", from: last, to: end };
    if (cuts.length === 2) plans.push([hook, payoff]);
    else if (format !== "reel") {
      plans.push([hook, { role: "explain", from: hook.to, to: last }, payoff]);
      const splits = cuts.slice(2, -1).sort((a, b) => Math.abs(a - (hook.to + last) / 2) - Math.abs(b - (hook.to + last) / 2) || a - b);
      for (const split of splits) plans.push([hook, { role: "explain", from: hook.to, to: split }, { role: "explain", from: split, to: last }, payoff]);
    }
    if (format === "reel" && !candidates(single[0], 0, 1, film, format, completeLibrary).length) {
      const splits = cuts.slice(1).sort((a, b) => Math.abs(a - end / 2) - Math.abs(b - end / 2) || a - b);
      for (const split of splits) plans.push([{ role: "reel", from: 0, to: split }, { role: "reel", from: split, to: end }]);
    }
  }
  if (cuts.length === 1) {
    plans.push([
      { role: "hook", from: 0, to: storyEnd },
      { role: "payoff", from: storyEnd, to: end },
    ]);
  }
  const plan = plans.find((acts) => acts.every((act, i) => candidates(act, i, acts.length, film, format, library).length));
  if (!plan) throw new Error(`No default soundtrack fits ${film.id} (${format}): choose longer role-matched tracks or shorten chapters; no silent looping allowed.`);
  return plan;
}

/** Longest library effect the default scorer places; keeps long beds such as typing out of the accents. */
const DEFAULT_EFFECT_MAX_SEC = 4;

/** Library effects the default scorer lays on each kind of visual event; a film's seed picks among them, except the end card, which takes the first one that is cached. */
const EFFECTS_FOR_EVENT: Record<string, string[]> = {
  "end-card": ["card-arrive", "pop-card"],
  "chapter-cut": ["whoosh-soft", "whoosh-fast"],
  "counter-end": ["counter-land"],
  "text-card": ["pop-card"],
};

/** Event kinds in the order the scorer spends its effect budget on them. */
const EFFECT_EVENT_PRIORITY = ["end-card", "chapter-cut", "counter-end", "text-card"];

// Places library effects on real visual events within the design check's density, spacing and family limits.
export function defaultEffects(film: Film, format: DeliveryFormat, library: AudioLibrary): SoundtrackSfx[] {
  const fps = film.fps;
  const totalSec = deliveryTimeline(film, format).totalFrames / fps;
  const spacingSec = format === "reel" ? 5 : 8;
  const budget = Math.floor(totalSec / spacingSec);
  const events = getVisualEventFrames(film).filter((event) => event.frame > 0 && EFFECTS_FOR_EVENT[event.type]);
  const chosen: { frame: number; type: string }[] = [];
  for (const type of EFFECT_EVENT_PRIORITY) {
    const frames = [...new Set(events.filter((event) => event.type === type).map((event) => event.frame))].sort((a, b) => a - b);
    for (const frame of frames) {
      if (chosen.length >= budget) break;
      if (chosen.every((other) => Math.abs(other.frame - frame) / fps >= spacingSec)) chosen.push({ frame, type });
    }
  }
  const usable = library.items.filter((item) => item.kind === "sfx" && item.licence.attribution === null && item.durationSec <= DEFAULT_EFFECT_MAX_SEC);
  return chosen.sort((a, b) => a.frame - b.frame).flatMap((event, index): SoundtrackSfx[] => {
    const pool = EFFECTS_FOR_EVENT[event.type].map((id) => usable.find((item) => item.id === id)).filter((item) => item !== undefined);
    if (pool.length === 0) return [];
    const seed = createHash("sha256").update(JSON.stringify([film.id, format, event.type, index])).digest().readUInt32BE(0);
    const item = event.type === "end-card" ? pool[0] : pool[seed % pool.length];
    const timeSec = Number((event.frame / fps).toFixed(3));
    return [{ item: item.id, sha256: item.sha256, timeSec, gainDb: 0, event: detectVisualEvent(film, timeSec, fps), volume: 1, generated: true }];
  });
}

// Preserves owner audio and fills whichever of music and sound effects the film lacks with stable library choices.
export function scoreDefaultSoundtrack(film: Film, format: DeliveryFormat, library: AudioLibrary = loadAudioLibrary()): Film {
  const base = withoutGenerated(film);
  const needsMusic = !hasExplicitMusic(base);
  const needsEffects = !hasExplicitEffects(base);
  if (!needsMusic && !needsEffects) return base;
  const cachedLibrary: AudioLibrary = { ...library, items: library.items.filter((item) => verifyAudioItem(item).status === "valid") };
  const fade = Math.round((format === "reel" ? 1.5 : 3) * film.fps);
  let sections = base.soundtrack?.sections ?? [];
  if (needsMusic) {
    const acts = actsFor(base, format, cachedLibrary, library);
    sections = acts.map((act, index): SoundtrackSection => {
      const pool = candidates(act, index, acts.length, base, format, cachedLibrary);
      const seed = createHash("sha256").update(JSON.stringify([film.id, format, act.role, index])).digest().readUInt32BE(0);
      const item = pool[seed % pool.length];
      const spanFrames = Math.round((act.to - act.from) * film.fps) + (index > 0 ? Math.ceil(fade / 2) : 0);
      const offsetSec = index === acts.length - 1 ? (Math.floor(item.durationSec * film.fps) - spanFrames) / film.fps : 0;
      return { ...act, item: item.id, sha256: item.sha256, offsetSec, crossfadeSec: format === "reel" ? 1.5 : 3, volume: 1, duckUnderVoiceover: true };
    });
  }
  const kept = base.soundtrack;
  const sfx = needsEffects ? defaultEffects(base, format, cachedLibrary) : kept?.sfx ?? [];
  return { ...base, soundtrack: {
    library: computeFileSha256(getDefaultLibraryPath()), ...(needsMusic ? { defaultScore: { format } } : {}), sections,
    speech: kept?.speech ?? [], speechSource: kept?.speechSource, narrationPeakDb: kept?.narrationPeakDb,
    mix: kept?.mix ?? soundtrackMixDefault, sfx, credits: kept?.credits ?? [],
  } };
}

// Validates the default music and effects and gets them ready for persistence; a missing narration file or audio cache leaves the gap for the delivery gate to refuse.
export async function prepareDefaultSoundtrack(film: Film, format: DeliveryFormat, onWarning?: (message: string) => void): Promise<Film> {
  const clips = film.audioClips?.filter((clip) => (clip.channel ?? "voiceover") === "voiceover") ?? [];
  const sources = clips.length ? clips.map((clip) => clip.src) : film.voiceover?.src ? [film.voiceover.src] : [];
  const warn = onWarning ?? console.warn;
  try {
    for (const src of sources) fs.accessSync(resolveAudioSourcePath(src), fs.constants.R_OK);
  } catch (error) {
    warn(`[soundtrack] Skipping default music and effects for "${film.id}" (${format}): narration audio cannot be read (${error instanceof Error ? error.message : String(error)}). Delivery will refuse this film until it has both.`);
    return withoutGenerated(film);
  }
  const library = loadAudioLibrary();
  const cachedCount = library.items.filter((item) => verifyAudioItem(item).status === "valid").length;
  let scored: Film;
  try {
    scored = scoreDefaultSoundtrack(film, format, library);
  } catch (error) {
    if (cachedCount === library.items.length) throw error;
    warn(`[soundtrack] Skipping default music and effects for "${film.id}" (${format}): suitable tracks are not verified in the audio cache; run "aideos audio fetch". Delivery will refuse this film until it has both.`);
    return withoutGenerated(film);
  }
  if (scored === film) return film;
  const findings: Parameters<typeof checkSoundtrack>[1] = [];
  checkSoundtrack(scored, findings, { formats: [format], library });
  if (findings.length) throw new Error(findings.map((finding) => finding.message).join("\n"));
  return scored;
}
