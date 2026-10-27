/**
 * File Description: Measures narration activity and source channel formats in the backend for the pure soundtrack mixer.
 * Inputs and outputs: Film plus audio sources -> Film with cached speech intervals, narration peaks and source channels.
 * Used by: backend/pipeline/filmStore.ts, backend/reelCut/store.ts and editor/vite.config.ts.
 */

import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { Film, SpeechInterval } from "../src/dl/schema";
import { isLibrarySource, mergeSpeech, soundtrackItem, soundtrackItemSrc, usesSectionMixer } from "../src/dl/audio/sectionMixer";
import { resolveAudioSourcePath } from "./audio";

const formats = new Map<string, { size: number; mtimeMs: number; channels: number }>();
const probeSchema = z.object({ streams: z.array(z.object({ channels: z.number().int().min(1).max(32) })) });

// Probes each changed source once so frame audio can upmix mono without adding 3 dB to its LUFS.
function sourceChannels(src: string): number {
  const file = resolveAudioSourcePath(src);
  const { size, mtimeMs } = fs.statSync(file);
  const cached = formats.get(file);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.channels;
  const output = execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "json", file,
  ], { encoding: "utf8" });
  const stream = probeSchema.parse(JSON.parse(output)).streams[0];
  if (!stream) throw new Error(`Soundtrack source has no audio stream: ${src}`);
  formats.set(file, { size, mtimeMs, channels: stream.channels });
  return stream.channels;
}

// Reads 10 ms RMS windows from decoded audio and merges word gaps shorter than 0.6 s.
function measureSpeech(file: string, start: number, end: number): { speech: SpeechInterval[]; peakDb: number } {
  const trim = `atrim=start=${start}${Number.isFinite(end) ? `:end=${end}` : ""},asetpts=PTS-STARTPTS,`;
  const output = execFileSync("ffmpeg", [
    "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "48000",
    "-af", `${trim}aresample=48000,asetnsamples=n=480:p=0,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-,ametadata=mode=print:key=lavfi.astats.Overall.Peak_level:file=-`,
    "-f", "null", "-",
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const windows: SpeechInterval[] = [];
  const pattern = /pts_time:([\d.e+-]+)\s*\r?\nlavfi\.astats\.Overall\.RMS_level=([^\r\n]+)/g;
  for (const match of output.matchAll(pattern)) {
    const rmsDb = Number(match[2]);
    if (!Number.isFinite(rmsDb) || rmsDb <= -40) continue;
    const startSec = Number(match[1]);
    windows.push({ startSec, endSec: startSec + 0.01 });
  }
  let peakDb = -Infinity;
  for (const match of output.matchAll(/lavfi\.astats\.Overall\.Peak_level=([^\r\n]+)/g)) {
    const windowPeak = Number(match[1]);
    if (Number.isFinite(windowPeak)) peakDb = Math.max(peakDb, windowPeak);
  }
  return { speech: mergeSpeech(windows), peakDb };
}

// Reuses measured phrases on ordinary saves and recomputes them when narration bytes or edits change.
export function prepareSoundtrack(film: Film): Film {
  if (!usesSectionMixer(film.soundtrack)) return film;
  const soundtrack = film.soundtrack;
  const sections = soundtrack.sections.map((section) => {
    if (!isLibrarySource(section)) return section;
    const src = section.src || soundtrackItemSrc(soundtrackItem(section.item, section.sha256));
    const channels = sourceChannels(src);
    return section.sourceChannels === channels ? section : { ...section, sourceChannels: channels };
  });
  const prepared = sections.every((section, i) => section === soundtrack.sections[i])
    ? film : { ...film, soundtrack: { ...soundtrack, sections } };
  const clips = film.audioClips?.filter((clip) => (clip.channel ?? "voiceover") === "voiceover") ?? [];
  const sources = clips.length ? clips.map((clip) => ({
    src: clip.src, position: clip.position, start: clip.start ?? 0, end: clip.end, speed: clip.speed ?? 1,
    volume: clip.volume ?? 1,
  })) : film.voiceover?.src ? [{
    src: film.voiceover.src, position: 0, start: 0, end: Infinity, speed: film.voiceover.speed ?? 1, volume: 1,
  }] : [];
  const resolved = sources.map((source) => ({ ...source, file: resolveAudioSourcePath(source.src) }));
  const fingerprint = createHash("sha256").update("rms-10ms-minus40db-merge600ms-peak-v1");
  for (const source of resolved) {
    fingerprint.update(JSON.stringify(source));
    fingerprint.update(fs.readFileSync(source.file));
  }
  const speechSource = fingerprint.digest("hex");
  if (soundtrack.speechSource === speechSource) return prepared;
  const speech: SpeechInterval[] = [];
  let narrationPeakDb = -Infinity;
  for (const source of resolved) {
    const measured = measureSpeech(source.file, source.start, source.end);
    narrationPeakDb = Math.max(narrationPeakDb, measured.peakDb + 20 * Math.log10(source.volume || 1e-10));
    for (const interval of measured.speech) {
      speech.push({
        startSec: source.position + interval.startSec / source.speed,
        endSec: source.position + interval.endSec / source.speed,
      });
    }
  }
  return { ...prepared, soundtrack: {
    ...soundtrack, sections, speech: mergeSpeech(speech), speechSource,
    narrationPeakDb: Number.isFinite(narrationPeakDb) ? narrationPeakDb : undefined,
  } };
}
