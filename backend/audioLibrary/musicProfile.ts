/**
 * File Description: Measures how much a music bed competes with narration (speech-band energy share and loudness swells) so the default scorer can choose beds by clarity, not by hash.
 * Inputs and outputs: a cached music file (or 0.5 s RMS levels) -> a MusicProfile that is stored on the audio library manifest item.
 * Used by: backend/audioLibrary/cli.ts (`aideos audio profile`) and backend/audioLibrary/musicProfile.test.ts.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MusicProfile, MusicSwell } from "./schema";

const execute = promisify(execFile);

/** Length of one level window in seconds; 24000 samples at 48 kHz. */
export const PROFILE_WINDOW_SEC = 0.5;
const WINDOW_SAMPLES = 24000;
/** Windows averaged (in power) before swells are looked for, about 2 s, so beats and drum hits are not swells. */
const SMOOTH_WINDOWS = 4;
/** A swell is a rise of at least this many dB inside this many windows (8 s). */
export const SWELL_MIN_RISE_DB = 6;
const SWELL_HORIZON_WINDOWS = 16;
/** Windows ignored at both ends (about 3 s) so a track's own fade in and fade out are not swells. */
const EDGE_WINDOWS = 6;
/** Narration band: where the voice carries its consonants and vowels, so where a bed competes with it. */
export const SPEECH_BAND_HZ = { low: 300, high: 3400 } as const;
/** Floor that stands in for digital silence in a level window. */
const SILENCE_DB = -90;

// Converts a level in dB to power so windows can be averaged.
function power(db: number): number {
  return 10 ** (db / 10);
}

// Returns the share of the track's energy that sits in the speech band, in dB (0 means all of it, more negative means less).
export function midrangeShareDb(broadbandDb: number[], speechBandDb: number[]): number {
  const count = Math.min(broadbandDb.length, speechBandDb.length);
  if (count === 0) throw new Error("midrangeShareDb needs at least one level window");
  let broadband = 0;
  let band = 0;
  for (let i = 0; i < count; i++) {
    broadband += power(broadbandDb[i]);
    band += power(speechBandDb[i]);
  }
  if (broadband <= 0) return SILENCE_DB;
  return Math.min(0, Math.round(10 * Math.log10(Math.max(band, 1e-12) / broadband) * 10) / 10);
}

// Finds the rises of at least SWELL_MIN_RISE_DB inside 8 s on the smoothed contour, earliest first and never overlapping.
export function findSwells(levelsDb: number[]): MusicSwell[] {
  const smooth: number[] = [];
  for (let i = 0; i + SMOOTH_WINDOWS <= levelsDb.length; i++) {
    let sum = 0;
    for (let j = 0; j < SMOOTH_WINDOWS; j++) sum += power(levelsDb[i + j]);
    smooth.push(10 * Math.log10(Math.max(sum / SMOOTH_WINDOWS, 1e-12)));
  }
  const last = smooth.length - 1 - EDGE_WINDOWS;
  const swells: MusicSwell[] = [];
  let k = EDGE_WINDOWS;
  while (k < last) {
    let peak = k;
    for (let u = k + 1; u <= Math.min(last, k + SWELL_HORIZON_WINDOWS); u++) if (smooth[u] > smooth[peak]) peak = u;
    if (smooth[peak] - smooth[k] < SWELL_MIN_RISE_DB) {
      k++;
      continue;
    }
    // The rise really starts at the last of the quietest windows before the peak.
    let start = k;
    for (let u = k; u <= peak; u++) if (smooth[u] <= smooth[start]) start = u;
    let top = start;
    for (let u = start + 1; u <= Math.min(last, start + SWELL_HORIZON_WINDOWS); u++) if (smooth[u] > smooth[top]) top = u;
    swells.push({
      startSec: Number((start * PROFILE_WINDOW_SEC).toFixed(1)),
      endSec: Number((top * PROFILE_WINDOW_SEC).toFixed(1)),
      riseDb: Number((smooth[top] - smooth[start]).toFixed(1)),
    });
    k = Math.max(top, k + 1);
  }
  return swells;
}

// Builds the profile from the broadband and speech-band level windows of one track.
export function profileFromLevels(broadbandDb: number[], speechBandDb: number[]): MusicProfile {
  return { midrangeDb: midrangeShareDb(broadbandDb, speechBandDb), swells: findSwells(broadbandDb) };
}

// Decodes a file into 0.5 s RMS level windows after an optional ffmpeg filter (a band limit).
async function levels(file: string, filter: string): Promise<number[]> {
  const chain = `aresample=48000,${filter}asetnsamples=n=${WINDOW_SAMPLES}:p=0,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`;
  const { stdout } = await execute("ffmpeg", ["-v", "error", "-i", file, "-vn", "-af", chain, "-f", "null", "-"], { maxBuffer: 64 * 1024 * 1024 });
  const values = [...stdout.matchAll(/lavfi\.astats\.Overall\.RMS_level=(\S+)/g)].map((match) => {
    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.max(SILENCE_DB, value) : SILENCE_DB;
  });
  if (values.length === 0) throw new Error(`ffmpeg produced no level windows for ${file}`);
  return values;
}

// Measures one cached music file with two ffmpeg passes (broadband and speech band); deterministic for the same bytes and ffmpeg build.
export async function measureMusicProfile(file: string): Promise<MusicProfile> {
  const broadband = await levels(file, "");
  // Each edge is two cascaded 2-pole filters (24 dB per octave) so a bass or air-heavy bed is not counted as midrange.
  const edges = `highpass=f=${SPEECH_BAND_HZ.low},highpass=f=${SPEECH_BAND_HZ.low},lowpass=f=${SPEECH_BAND_HZ.high},lowpass=f=${SPEECH_BAND_HZ.high},`;
  const band = await levels(file, edges);
  return profileFromLevels(broadband, band);
}
