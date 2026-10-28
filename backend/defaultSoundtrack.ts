/**
 * File Description: Scores unscored films deterministically from chapter acts and the curated free audio library.
 * Inputs and outputs: Film and delivery format -> preserved owner audio or a hash-locked default soundtrack.
 * Used by: design delivery, design-build CLI and reel builds.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import { buildTimeline } from "../src/dl/camera";
import { deliveryTimeline, type DeliveryFormat } from "../src/dl/delivery";
import { soundtrackMixDefault, type Film, type SoundtrackSection } from "../src/dl/schema";
import { computeFileSha256, getDefaultLibraryPath, loadAudioLibrary, verifyAudioItem } from "./audioLibrary/library";
import type { AudioLibrary } from "./audioLibrary/schema";
import { checkSoundtrack } from "./designCheck/soundtrack";
import { resolveAudioSourcePath } from "./audio";

type Act = Pick<SoundtrackSection, "role" | "from" | "to">;

// Keeps owner-authored audio outside the default scorer's selection and fallback paths.
function hasExplicitAudio(film: Film): boolean {
  return Boolean(film.music || film.audio || film.sfx?.length || film.audioClips?.some((clip) => clip.channel === "music") ||
    (film.soundtrack && !film.soundtrack.defaultScore));
}

// Removes generated music while preserving all owner-authored soundtrack data.
function withoutDefaultScore(film: Film): Film {
  if (!film.soundtrack?.defaultScore) return film;
  const { soundtrack: _defaultScore, ...unscored } = film;
  return unscored;
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

// Preserves explicit audio and assigns stable role-matched music to an otherwise unscored film.
export function scoreDefaultSoundtrack(film: Film, format: DeliveryFormat, library: AudioLibrary = loadAudioLibrary()): Film {
  if (hasExplicitAudio(film)) return film;
  const cachedLibrary: AudioLibrary = { ...library, items: library.items.filter((item) => verifyAudioItem(item).status === "valid") };
  const acts = actsFor(film, format, cachedLibrary, library);
  const fade = Math.round((format === "reel" ? 1.5 : 3) * film.fps);
  const sections = acts.map((act, index): SoundtrackSection => {
    const pool = candidates(act, index, acts.length, film, format, cachedLibrary);
    const seed = createHash("sha256").update(JSON.stringify([film.id, format, act.role, index])).digest().readUInt32BE(0);
    const item = pool[seed % pool.length];
    const spanFrames = Math.round((act.to - act.from) * film.fps) + (index > 0 ? Math.ceil(fade / 2) : 0);
    const offsetSec = index === acts.length - 1 ? (Math.floor(item.durationSec * film.fps) - spanFrames) / film.fps : 0;
    return { ...act, item: item.id, sha256: item.sha256, offsetSec, crossfadeSec: format === "reel" ? 1.5 : 3, volume: 1, duckUnderVoiceover: true };
  });
  return { ...film, soundtrack: {
    library: computeFileSha256(getDefaultLibraryPath()), defaultScore: { format }, sections,
    speech: film.soundtrack?.speech ?? [], speechSource: film.soundtrack?.speechSource, narrationPeakDb: film.soundtrack?.narrationPeakDb,
    mix: film.soundtrack?.mix ?? soundtrackMixDefault, sfx: [], credits: [],
  } };
}

// Validates a default score and fetches only its selected, hash-verified assets before persistence.
export async function prepareDefaultSoundtrack(film: Film, format: DeliveryFormat, onWarning?: (message: string) => void): Promise<Film> {
  if (hasExplicitAudio(film)) return film;
  const clips = film.audioClips?.filter((clip) => (clip.channel ?? "voiceover") === "voiceover") ?? [];
  const sources = clips.length ? clips.map((clip) => clip.src) : film.voiceover?.src ? [film.voiceover.src] : [];
  try {
    for (const src of sources) fs.accessSync(resolveAudioSourcePath(src), fs.constants.R_OK);
  } catch (error) {
    (onWarning ?? console.warn)(`[soundtrack] Skipping default music for "${film.id}" (${format}): narration audio cannot be read (${error instanceof Error ? error.message : String(error)}). Film remains unscored.`);
    return withoutDefaultScore(film);
  }
  const library = loadAudioLibrary();
  const cachedCount = library.items.filter((item) => verifyAudioItem(item).status === "valid").length;
  let scored: Film;
  try {
    scored = scoreDefaultSoundtrack(film, format, library);
  } catch (error) {
    if (cachedCount === library.items.length) throw error;
    (onWarning ?? console.warn)(`[soundtrack] Skipping default music for "${film.id}" (${format}): suitable tracks are not verified in the audio cache. Film remains unscored.`);
    return withoutDefaultScore(film);
  }
  if (scored === film) return film;
  const findings: Parameters<typeof checkSoundtrack>[1] = [];
  checkSoundtrack(scored, findings, { formats: [format], library });
  if (findings.length) throw new Error(findings.map((finding) => finding.message).join("\n"));
  return scored;
}
