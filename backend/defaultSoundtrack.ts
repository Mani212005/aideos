/**
 * File Description: Scores unscored films deterministically from chapter acts and the curated free audio library.
 * Inputs and outputs: Film and delivery format -> preserved owner audio or a hash-locked default soundtrack.
 * Used by: design delivery, design-build CLI and reel builds.
 */

import { createHash } from "node:crypto";
import { buildTimeline } from "../src/dl/camera";
import { deliveryTimeline, type DeliveryFormat } from "../src/dl/delivery";
import { soundtrackMixDefault, type Film, type SoundtrackSection } from "../src/dl/schema";
import { computeFileSha256, fetchAudioItem, getDefaultLibraryPath, loadAudioLibrary } from "./audioLibrary/library";
import type { AudioLibrary } from "./audioLibrary/schema";
import { checkSoundtrack } from "./designCheck/soundtrack";

type Act = Pick<SoundtrackSection, "role" | "from" | "to">;

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
function actsFor(film: Film, format: DeliveryFormat, library: AudioLibrary): Act[] {
  const cuts = soundtrackChapterCuts(film);
  const end = deliveryTimeline(film, format).totalFrames / film.fps;
  const single: Act[] = [{ role: format === "reel" ? "reel" : "hook", from: 0, to: end }];
  if (format === "reel" && candidates(single[0], 0, 1, film, format, library).length) return single;
  const last = cuts[cuts.length - 1];
  const plans: Act[][] = [];
  if (cuts.length > 1) {
    const hook: Act = { role: "hook", from: 0, to: cuts[1] };
    const payoff: Act = { role: "payoff", from: last, to: end };
    if (format === "reel" || cuts.length === 2) plans.push([{ ...hook, to: last }, payoff]);
    else {
      plans.push([hook, { role: "explain", from: hook.to, to: last }, payoff]);
      const splits = cuts.slice(2, -1).sort((a, b) => Math.abs(a - (hook.to + last) / 2) - Math.abs(b - (hook.to + last) / 2) || a - b);
      for (const split of splits) plans.push([hook, { role: "explain", from: hook.to, to: split }, { role: "explain", from: split, to: last }, payoff]);
    }
  }
  if (cuts.length === 1) plans.push(single);
  const plan = plans.find((acts) => acts.every((act, i) => candidates(act, i, acts.length, film, format, library).length));
  if (!plan) throw new Error(`No default soundtrack fits ${film.id} (${format}): choose longer role-matched tracks or shorten chapters; no silent looping allowed.`);
  return plan;
}

// Preserves explicit audio and assigns stable role-matched music to an otherwise unscored film.
export function scoreDefaultSoundtrack(film: Film, format: DeliveryFormat, library: AudioLibrary = loadAudioLibrary()): Film {
  if (film.music || film.audio || film.audioClips?.some((clip) => clip.channel === "music") || (film.soundtrack && !film.soundtrack.defaultScore)) return film;
  const acts = actsFor(film, format, library);
  const fade = Math.round((format === "reel" ? 1.5 : 3) * film.fps);
  const sections = acts.map((act, index): SoundtrackSection => {
    const pool = candidates(act, index, acts.length, film, format, library);
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
export async function prepareDefaultSoundtrack(film: Film, format: DeliveryFormat): Promise<Film> {
  const library = loadAudioLibrary();
  const scored = scoreDefaultSoundtrack(film, format, library);
  if (scored === film) return film;
  const findings: Parameters<typeof checkSoundtrack>[1] = [];
  checkSoundtrack(scored, findings, { formats: [format], library });
  if (findings.length) throw new Error(findings.map((finding) => finding.message).join("\n"));
  for (const id of new Set(scored.soundtrack?.sections.map((section) => section.item))) {
    const item = library.items.find((entry) => entry.id === id);
    if (item) await fetchAudioItem(item);
  }
  return scored;
}
