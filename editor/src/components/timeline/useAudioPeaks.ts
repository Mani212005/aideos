/**
 * File Description: Real audio waveform extraction for the Aideos timeline.
 * Fetches an audio source once, decodes it with the Web Audio API off the render path, and reduces
 * it to a fixed bucket of normalised amplitude peaks the timeline can draw at any zoom level.
 * Results are cached per source for the life of the page so scrubbing, zooming and re-renders never
 * re-decode, and any failure degrades to "no waveform" rather than breaking the lane.
 */

import { useEffect, useState } from "react";

/** Number of amplitude buckets extracted per source. Enough detail for a full-width timeline. */
const PEAK_BUCKETS = 1600;

type PeakCacheEntry = { peaks: number[]; durationSec: number } | "pending" | "failed";

const peakCache = new Map<string, PeakCacheEntry>();
const waiters = new Map<string, Array<() => void>>();

/** Reduce a decoded buffer to normalised absolute-amplitude peaks. */
function extractPeaks(buffer: AudioBuffer, buckets: number): number[] {
  const channel = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(channel.length / buckets));
  const peaks: number[] = [];
  let maxSeen = 0;

  for (let i = 0; i < buckets; i++) {
    const from = i * step;
    const to = Math.min(channel.length, from + step);
    let peak = 0;
    for (let j = from; j < to; j += 1) {
      const sample = Math.abs(channel[j]);
      if (sample > peak) peak = sample;
    }
    if (peak > maxSeen) maxSeen = peak;
    peaks.push(peak);
  }

  // Normalise so quiet narration still fills the lane rather than drawing a flat line.
  const scale = maxSeen > 0 ? 1 / maxSeen : 1;
  return peaks.map((p) => Number(Math.min(1, p * scale).toFixed(3)));
}

/** Decode one source into peaks, sharing the work between every caller that asks for it. */
async function loadPeaks(src: string): Promise<void> {
  peakCache.set(src, "pending");
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const bytes = await res.arrayBuffer();
    const AudioCtor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtor();
    const buffer = await ctx.decodeAudioData(bytes);
    peakCache.set(src, { peaks: extractPeaks(buffer, PEAK_BUCKETS), durationSec: buffer.duration });
    void ctx.close();
  } catch {
    peakCache.set(src, "failed");
  } finally {
    const pending = waiters.get(src) ?? [];
    waiters.delete(src);
    pending.forEach((fn) => fn());
  }
}

export interface AudioPeaks {
  peaks: number[];
  durationSec: number;
  status: "idle" | "loading" | "ready" | "failed";
}

/** Load and cache the waveform peaks for one audio source. */
export function useAudioPeaks(src: string | undefined): AudioPeaks {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!src) return;
    const cached = peakCache.get(src);
    if (cached && cached !== "pending") return;

    let live = true;
    /** Re-render this consumer once the shared decode settles. */
    const wake = () => {
      if (live) setTick((t) => t + 1);
    };
    waiters.set(src, [...(waiters.get(src) ?? []), wake]);
    if (cached !== "pending") void loadPeaks(src);

    return () => {
      live = false;
      waiters.set(src, (waiters.get(src) ?? []).filter((fn) => fn !== wake));
    };
  }, [src]);

  if (!src) return { peaks: [], durationSec: 0, status: "idle" };
  const entry = peakCache.get(src);
  if (!entry || entry === "pending") return { peaks: [], durationSec: 0, status: "loading" };
  if (entry === "failed") return { peaks: [], durationSec: 0, status: "failed" };
  return { peaks: entry.peaks, durationSec: entry.durationSec, status: "ready" };
}

/**
 * Slice the cached peaks down to the window a clip actually plays, so a trimmed clip shows the
 * part of the waveform it really uses rather than the whole file squashed into its body.
 */
export function slicePeaks(peaks: number[], durationSec: number, startSec: number, endSec: number, buckets: number): number[] {
  if (peaks.length === 0 || durationSec <= 0) return [];
  const from = Math.max(0, Math.floor((startSec / durationSec) * peaks.length));
  const to = Math.min(peaks.length, Math.ceil((endSec / durationSec) * peaks.length));
  const window = peaks.slice(from, Math.max(from + 1, to));
  if (window.length <= buckets) return window;

  const step = window.length / buckets;
  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const a = Math.floor(i * step);
    const b = Math.min(window.length, Math.floor((i + 1) * step));
    let peak = 0;
    for (let j = a; j < b; j++) if (window[j] > peak) peak = window[j];
    out.push(peak);
  }
  return out;
}
