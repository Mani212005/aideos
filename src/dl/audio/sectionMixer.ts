/**
 * File Description: Browser-safe library resolution, section envelopes, speech ducking and effect gains.
 * Inputs and outputs: Recorded soundtrack and delivery timeline -> deterministic source spans and linear gains.
 * Used by: src/dl/Soundtrack.tsx and backend/soundtrack.ts.
 */

import library from "../../../audio/library.json";
import type { DeliveryTimeline } from "../delivery";
import type { Soundtrack, SoundtrackMix, SoundtrackSfx, SpeechInterval } from "../schema";

type LibraryItem = (typeof library.items)[number];

export type MixedSection = {
  src: string;
  from: number;
  durationInFrames: number;
  trimBefore: number;
  gain: number;
  duck: boolean;
  fadeInFrames: number;
  fadeOutFrames: number;
  fadeInStartFrame: number;
  fadeOutEndFrame: number;
};

// Converts a decibel gain to a linear amplitude multiplier without rounding quiet beds away.
export function dbGain(db: number): number {
  return 10 ** (db / 20);
}

// Recognizes path-only legacy sections so saving their normalized form preserves their original mix.
export function usesSectionMixer(soundtrack: Soundtrack | undefined): soundtrack is Soundtrack {
  return Boolean(soundtrack && (soundtrack.library ||
    soundtrack.sections.some(isLibrarySource) || soundtrack.sfx.some(isLibrarySource)));
}

// Distinguishes a library identity from the source paths preserved by legacy normalization.
export function isLibrarySource(source: { item: string; src?: string; sha256?: string }): boolean {
  return Boolean(source.sha256 || source.item !== source.src);
}

// Resolves a recorded library identity and refuses to substitute a changed item silently.
export function soundtrackItem(itemId: string, sha256?: string): LibraryItem {
  const item = library.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Unknown soundtrack library item: ${itemId}`);
  if (sha256 && sha256 !== item.sha256) throw new Error(`Soundtrack hash changed for ${itemId}`);
  return item;
}

// Names the same shared cache asset the library fetcher writes, without importing filesystem code.
export function soundtrackItemSrc(item: LibraryItem): string {
  const source = "archivePath" in item ? item.archivePath : item.url;
  const extension = source?.split(/[?#]/)[0].match(/\.[^./]+$/)?.[0] ?? ".mp3";
  return `videos/.audio-library/${item.id}${extension}`;
}

// Sorts and joins phrases separated by less than 0.6 s, including overlaps from edited narration.
export function mergeSpeech(intervals: SpeechInterval[]): SpeechInterval[] {
  const merged: SpeechInterval[] = [];
  for (const interval of [...intervals].sort((a, b) => a.startSec - b.startSec)) {
    if (interval.endSec <= interval.startSec) continue;
    const previous = merged[merged.length - 1];
    if (previous && interval.startSec - previous.endSec < 0.6 - 1e-9) {
      previous.endSec = Math.max(previous.endSec, interval.endSec);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

// Bounds a ramp's progress to its endpoints.
function progress(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// Pre-ducks over 0.25 s and releases over 0.6 s, keeping word gaps inside a merged phrase flat.
export function speechGain(timeSec: number, speech: SpeechInterval[], mix: SoundtrackMix, storySec: number): number {
  let previousEnd = -Infinity;
  let nextStart = Infinity;
  for (const interval of speech) {
    if (timeSec >= interval.startSec && timeSec <= interval.endSec) return dbGain(mix.duckDb);
    if (interval.endSec < timeSec) previousEnd = Math.max(previousEnd, interval.endSec);
    if (interval.startSec > timeSec) nextStart = Math.min(nextStart, interval.startSec);
  }
  const musicOnly = previousEnd === -Infinity || nextStart === Infinity;
  const cardRise = progress((timeSec - storySec + 0.25) / 0.25);
  const openDb = musicOnly ? mix.musicOnlyGainDb :
    mix.pauseGainDb + (mix.musicOnlyGainDb - mix.pauseGainDb) * cardRise;
  const release = mix.duckDb + (openDb - mix.duckDb) * progress((timeSec - previousEnd) / 0.6);
  const attack = mix.duckDb + (openDb - mix.duckDb) * progress((nextStart - timeSec) / 0.25);
  return dbGain(Math.min(openDb, release, attack));
}

// Compiles frame-aligned overlaps and source trims, back-timing the final track through the card.
export function mixSections(soundtrack: Soundtrack, delivery: DeliveryTimeline): MixedSection[] {
  const { fps } = delivery;
  const ordered = [...soundtrack.sections].sort((a, b) => a.from - b.from);
  const crossfade = Math.round((delivery.format === "reel" ? 1.5 : 3) * fps);
  const joins = ordered.slice(1).map((section, i) => {
    const previous = ordered[i];
    return Math.abs(previous.to - section.from) < 1 / fps ? crossfade : 0;
  });
  return ordered.map((section, i) => {
    const item = soundtrackItem(section.item, section.sha256);
    if (item.kind !== "music") throw new Error(`${item.id} is not a music track`);
    const last = i === ordered.length - 1;
    const fadeIn = joins[i - 1] ?? 0;
    const fadeOut = joins[i] ?? 0;
    const from = Math.max(0, Math.round(section.from * fps) - Math.ceil(fadeIn / 2));
    const to = last && section.to >= delivery.storyFrames / fps - 1 / fps
      ? delivery.totalFrames
      : Math.min(delivery.totalFrames, Math.round(section.to * fps) + Math.ceil(fadeOut / 2));
    const trackFrames = Math.floor(item.durationSec * fps);
    const trimBefore = last ? Math.max(0, trackFrames - (to - from)) : Math.round(section.offsetSec * fps);
    const available = trackFrames - trimBefore;
    if (available <= 0 || (!last && available < to - from)) {
      throw new Error(`Soundtrack section ${item.id} exceeds its track; choose a longer track or an earlier offset`);
    }
    const durationInFrames = Math.min(to - from, available);
    if (durationInFrames <= 0) throw new Error(`Soundtrack section ${item.id} is outside the delivery`);
    if (fadeIn + fadeOut > durationInFrames) throw new Error(`Soundtrack section ${item.id} is too short for its crossfades`);
    return {
      src: section.src || soundtrackItemSrc(item), from, durationInFrames, trimBefore,
      gain: dbGain(soundtrack.mix.targetLufs - item.loudness.integratedLufs) * (section.volume ?? 1) *
        (section.sourceChannels === 1 ? Math.SQRT1_2 : 1),
      duck: section.duckUnderVoiceover ?? true,
      fadeInFrames: fadeIn || Math.min(Math.round(0.25 * fps), durationInFrames),
      fadeOutFrames: last && available < to - from
        ? Math.min(Math.round(1.5 * fps), durationInFrames)
        : fadeOut || (last ? 0 : Math.min(Math.round(0.25 * fps), durationInFrames)),
      // A 45-frame reel fade straddles half frames; keep its mathematical center on the chapter.
      fadeInStartFrame: fadeIn ? Math.round(section.from * fps) - fadeIn / 2 - from : 0,
      fadeOutEndFrame: fadeOut ? Math.round(section.to * fps) + fadeOut / 2 - from : durationInFrames,
    };
  });
}

// Evaluates equal-power entrance and exit envelopes in the section's local timeline.
export function sectionEnvelope(section: MixedSection, frame: number): number {
  const entrance = section.fadeInFrames
    ? Math.sin(progress((frame - section.fadeInStartFrame) / section.fadeInFrames) * Math.PI / 2) : 1;
  const exit = section.fadeOutFrames
    ? Math.sin(progress((section.fadeOutEndFrame - frame) / section.fadeOutFrames) * Math.PI / 2) : 1;
  return entrance * exit;
}

// Normalizes effects before the authored gain and caps their peaks below the normalized narration.
export function effectGain(effect: SoundtrackSfx, mix: SoundtrackMix, narrationPeakDb: number): number {
  const item = soundtrackItem(effect.item, effect.sha256);
  if (item.kind !== "sfx") throw new Error(`${item.id} is not a sound effect`);
  const peakGap = item.roles.includes("ui") ? 14 : 8;
  const volume = effect.volume ?? 1;
  if (volume === 0) return 0;
  const requested = mix.targetLufs - item.loudness.integratedLufs + effect.gainDb + 20 * Math.log10(volume);
  return dbGain(Math.min(requested, narrationPeakDb - peakGap - item.loudness.truePeakDb));
}
