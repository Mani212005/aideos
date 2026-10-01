/**
 * File Description: Beat step for the film "RAG, in four steps". Takes the raw Kokoro narration and its
 * measured spine, plans every line onto a tempo grid (beatGrid.ts), then has beatTrack.py re-time the
 * voice, synthesize an original drum, bass, pad and arp track procedurally, and duck it under the voice.
 * Writes the fitted shot-spine.json (the picture is compiled from it), voiceover.wav, beat.wav, the word
 * list and the captions, so the whole film follows the beat from a single source of truth.
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { buildCaptionsVtt, type WordInfo } from "../audio";
import { BEATS } from "./beats";
import {
  BEAT_BPM,
  ONSET_LEAD_SEC,
  beatSeconds,
  fitSpine,
  planBeatGrid,
  type RawSegment,
} from "./beatGrid";
import { packageDir, timingPath, type VoiceoverTiming } from "./produceVoiceover";

/** Silence appended after the last line so the closing card can be read, in seconds. */
export const TAIL_HANDLE_SEC = 2.6;

// Path of the raw (unfitted) narration take and its spine inside the package.
export function rawPaths(): { wav: string; spine: string } {
  const dir = packageDir();
  return { wav: path.join(dir, "voiceover.raw.wav"), spine: path.join(dir, "shot-spine.raw.json") };
}

// Runs beatTrack.py with the given arguments and returns its stdout, failing loudly on a non-zero exit.
function runBeatTrack(args: string[]): string {
  const run = spawnSync("python3", [path.resolve(__dirname, "beatTrack.py"), ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`beatTrack.py failed: ${run.stderr || run.error}`);
  return run.stdout;
}

// Fits the raw narration to the beat grid and writes the fitted spine, voice, beat, words and captions.
export function produceBeat(bpm: number = BEAT_BPM): VoiceoverTiming {
  const dir = packageDir();
  const raw = rawPaths();
  if (!fs.existsSync(raw.wav) || !fs.existsSync(raw.spine)) {
    throw new Error("Missing the raw narration take. Run the narration step first: npx tsx backend/ragExplainer/produceVoiceover.ts");
  }
  const rawTiming = JSON.parse(fs.readFileSync(raw.spine, "utf8")) as VoiceoverTiming;

  // 1. Where each line's first and last sound really sit inside its raw slot.
  const rangesFile = path.join(dir, ".beat-ranges.json");
  const extentFile = path.join(dir, ".beat-extent.json");
  fs.writeFileSync(rangesFile, JSON.stringify(rawTiming.segments.map((s) => [s.startSec, s.startSec + s.durationSec])));
  runBeatTrack(["analyze", raw.wav, rangesFile, extentFile]);
  const extents = JSON.parse(fs.readFileSync(extentFile, "utf8")) as Array<{ onsetSec: number; offsetSec: number }>;
  fs.rmSync(rangesFile, { force: true });
  fs.rmSync(extentFile, { force: true });

  // 2. Plan the grid, then re-time the spine onto it.
  const segments: RawSegment[] = rawTiming.segments.map((s, i) => ({
    ...s,
    onsetSec: extents[i].onsetSec,
    endSec: extents[i].offsetSec,
  }));
  const plans = planBeatGrid(segments.map((s) => ({ speechSec: s.endSec - s.onsetSec })), bpm);
  const fitted = fitSpine(rawTiming, segments, plans, TAIL_HANDLE_SEC, bpm);

  // 3. Render the fitted voice and the ducked beat.
  const beatOut = path.join(dir, "beat.wav");
  const voiceOut = path.join(dir, "voiceover.wav");
  const planFile = path.join(dir, ".beat-plan.json");
  fs.writeFileSync(
    planFile,
    JSON.stringify({
      bpm,
      totalSec: fitted.totalDurationSec,
      leadSec: ONSET_LEAD_SEC,
      rawWav: raw.wav,
      beatOut,
      voiceOut,
      lines: segments.map((s, i) => ({
        id: s.shotId,
        chapter: ["the problem", "the fix", "the pipeline", "the answer", "the catch"].indexOf(BEATS[i].chapter),
        rawStartSec: s.startSec,
        onsetSec: s.onsetSec,
        offsetSec: s.endSec,
        tempo: plans[i].tempo,
        startSec: plans[i].startSec,
        beats: plans[i].beats,
      })),
    }),
  );
  console.log(`[rag-explainer] beat: ${runBeatTrack(["render", planFile]).trim()}`);
  fs.rmSync(planFile, { force: true });
  fs.rmSync(`${beatOut}.probe.wav`, { force: true });

  // 4. Persist the fitted spine and refresh the word list, captions and the editor's preview copy.
  fs.writeFileSync(timingPath(), `${JSON.stringify(fitted, null, 2)}\n`, "utf8");
  const words: WordInfo[] = fitted.segments.flatMap((s) =>
    s.words.map((w) => ({ word: w.word.toLowerCase().replace(/[^a-z0-9']/g, ""), punctuated_word: w.word, start: w.startSec, end: w.endSec })),
  );
  fs.writeFileSync(path.join(dir, "voiceover_words.json"), `${JSON.stringify({ words }, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(dir, "captions.vtt"), buildCaptionsVtt(words), "utf8");
  const publicDir = path.resolve(__dirname, "../../public");
  if (fs.existsSync(publicDir)) {
    fs.copyFileSync(voiceOut, path.join(publicDir, "voiceover.wav"));
    fs.copyFileSync(path.join(dir, "captions.vtt"), path.join(publicDir, "captions.vtt"));
  }
  console.log(`[rag-explainer] fitted to ${bpm} bpm (${beatSeconds(bpm).toFixed(3)} s/beat): ${fitted.totalDurationSec.toFixed(2)} s.`);
  return fitted;
}

if (typeof require !== "undefined" && require.main === module) {
  produceBeat();
}
