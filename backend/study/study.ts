/**
 * File Description: `aideos study` for one reference video: probes the file, makes one pass over its analysis frames (cuts by changed-block coverage,
 * camera motion by two estimators), runs the other methods (scene score, tone, audio pacing, captions) and assembles the style bible, a numbers-only
 * proposal in which every pixel-derived metric carries two independent measurements and an agreement flag. Local mp4 files only: a URL is refused.
 * Inputs and outputs: a local video path (and optional word timings) -> StudyBible.
 * Used by: backend/study/run.ts, backend/cli.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { probeVideo } from "../review/media";
import { resolveMetric } from "./agreement";
import { analyzeAudio } from "./audio";
import { analyzeCamera, buildPyramid, cornerSpeed, estimateBlocks, estimateTiles, staticOverlayMask, type FramePyramid, type MotionModel, type OverlayMask, type SpeedSeries } from "./camera";
import { measureCaptions, type CaptionDeps } from "./captions";
import { analyzeCuts, changedBlockShare, sceneCutsFfmpeg, type SceneCut } from "./cuts";
import { analysisSize, streamRawFrames } from "./decode";
import { measureTone } from "./tone";
import { IP_BOUNDARY, round, STUDY, STUDY_SCHEMA, type Metric, type NotMeasured, type StudyBible } from "./types";

/** What a test or caller may replace: every outside effect and the second camera method. */
export interface StudyDeps extends CaptionDeps {
  /** Replaces camera method B (used to prove that a disagreement is excluded). */
  estimateBlocks?: (prev: FramePyramid, cur: FramePyramid, mask?: OverlayMask) => MotionModel | null;
  /** Replaces the ffmpeg scene detection of cut method A. */
  sceneCuts?: (file: string) => SceneCut[];
  onProgress?: (message: string) => void;
}

/** Options of one reference study. */
export interface StudyOptions {
  /** Word timings (voiceover_words.json shape) for wpm; without them wpm is reported as not measured. */
  wordsFile?: string;
  deps?: StudyDeps;
}

// True for anything that is not a plain local path (a URL or other scheme): studies never fetch.
export function isRemoteReference(ref: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(ref) || /^(www\.|youtu\.?be)/i.test(ref);
}

// The nearest simple aspect label (for example 9:16) of a frame size.
export function aspectLabel(width: number, height: number): string {
  const known: Array<[string, number]> = [["16:9", 16 / 9], ["9:16", 9 / 16], ["1:1", 1], ["4:3", 4 / 3], ["3:4", 3 / 4], ["4:5", 4 / 5], ["21:9", 21 / 9]];
  const ratio = width / height;
  const best = known.reduce((a, b) => (Math.abs(b[1] - ratio) < Math.abs(a[1] - ratio) ? b : a));
  return Math.abs(best[1] - ratio) / ratio < 0.02 ? best[0] : `${round(ratio, 3)}:1`;
}

/** The raw results of the single frame pass. */
interface FramePass {
  fps: number;
  frames: number;
  blockCuts: Array<{ t: number; share: number }>;
  speedA: SpeedSeries;
  speedB: SpeedSeries;
}

// One pass over the analysis frames: changed-block cuts and both camera estimators for every pair that is not a cut.
async function framePass(file: string, width: number, height: number, sourceFps: number, deps: StudyDeps): Promise<FramePass> {
  const size = analysisSize(width, height);
  const fps = Math.min(sourceFps || STUDY.analysisMaxFps, STUDY.analysisMaxFps);
  const blocksEstimator = deps.estimateBlocks ?? estimateBlocks;
  const blockCuts: FramePass["blockCuts"] = [];
  const speedA: SpeedSeries = [];
  const speedB: SpeedSeries = [];
  let prevGray: Uint8Array | null = null;
  let prevPyr: FramePyramid | null = null;
  const frames = await streamRawFrames(file, `fps=${fps},scale=${size.width}:${size.height}:flags=area`, "gray", size.width * size.height, (gray, index) => {
    const pyr = buildPyramid(gray, size.width, size.height);
    if (prevGray && prevPyr) {
      const share = changedBlockShare(prevGray, gray, size.width, size.height);
      if (share >= STUDY.cuts.changedBlockShareMin) {
        blockCuts.push({ t: index / fps, share });
        speedA.push(null);
        speedB.push(null);
      } else {
        // Both methods skip the static overlay (a grid, a HUD); a pair they then cannot read is unmeasured, never read from the biased whole frame.
        const mask = staticOverlayMask(prevPyr, pyr) ?? undefined;
        const a = estimateTiles(prevPyr, pyr, mask);
        const b = blocksEstimator(prevPyr, pyr, mask);
        speedA.push(a ? cornerSpeed(a, size.width, size.height, fps) : null);
        speedB.push(b ? cornerSpeed(b, size.width, size.height, fps) : null);
      }
    }
    prevGray = gray;
    prevPyr = pyr;
  });
  return { fps, frames, blockCuts, speedA, speedB };
}

// Blanks the camera series around every cut either method found (the pair into the cut and its neighbours), so a cut is never read as motion.
function maskCuts(series: SpeedSeries, cutTimes: number[], fps: number): SpeedSeries {
  const out = [...series];
  for (const t of cutTimes) {
    const pair = Math.round(t * fps) - 1;
    for (let k = pair - 1; k <= pair + 1; k++) if (k >= 0 && k < out.length) out[k] = null;
  }
  return out;
}

// Studies one local reference video and returns its bible. Throws a clear error for a URL, a missing file or an unreadable video.
export async function studyReference(file: string, options: StudyOptions = {}): Promise<StudyBible> {
  const deps = options.deps ?? {};
  const say = deps.onProgress ?? (() => undefined);
  if (isRemoteReference(file)) {
    throw new Error(`"${file}" is a URL. aideos study reads local files only: it never downloads or scrapes anything. Save the video yourself where you are allowed to, then pass its path.`);
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`no video file at ${file}`);
  const video = probeVideo(file);
  const notMeasured: NotMeasured[] = [];
  say(`probed ${path.basename(file)}: ${video.width}x${video.height}, ${video.durationSec.toFixed(1)} s, ${video.fps} fps`);

  say("cuts: scene score (method A)");
  const sceneCuts = (deps.sceneCuts ?? sceneCutsFfmpeg)(file);
  say("cuts and camera: one pass over the analysis frames (changed-block coverage, tile Lucas-Kanade, block matching)");
  const pass = await framePass(file, video.width, video.height, video.fps, deps);
  const cuts = analyzeCuts(sceneCuts, pass.blockCuts, video.durationSec);
  const camera = analyzeCamera(maskCuts(pass.speedA, cuts.anyCutTimes, pass.fps), maskCuts(pass.speedB, cuts.anyCutTimes, pass.fps), pass.fps);
  say("tone: signalstats and plane statistics");
  const tone = await measureTone(file, video.width, video.height);
  say("captions: review OCR and band ink");
  const captions = await measureCaptions(file, video, deps);
  say("audio: pause map, loudness");
  const audio = analyzeAudio(file, video.durationSec, video.hasAudio, options.wordsFile);
  notMeasured.push(...captions.notMeasured, ...audio.notMeasured);
  notMeasured.push({ what: "identity, likeness, characters, voice, script, channel", why: "out of scope by design: aideos study measures craft only" });

  const decodedDuration = pass.frames / pass.fps;
  const duration = resolveMetric({
    id: "media.durationSec",
    label: "Duration",
    unit: "s",
    a: { method: "ffprobe container duration", value: video.durationSec },
    b: { method: `decoded analysis frames / ${round(pass.fps, 2)} fps`, value: decodedDuration },
    tolerance: { abs: 0.1 },
  });
  const metrics: Metric[] = [duration, ...cuts.metrics, ...camera.metrics, ...tone, ...captions.metrics, ...audio.metrics];
  return {
    schema: STUDY_SCHEMA,
    proposal: true,
    boundary: IP_BOUNDARY,
    generatedAt: new Date().toISOString(),
    source: { file: path.basename(file), sizeBytes: fs.statSync(file).size },
    media: { durationSec: round(video.durationSec, 3), width: video.width, height: video.height, aspect: aspectLabel(video.width, video.height), fps: video.fps, hasAudio: video.hasAudio },
    metrics,
    series: { cuts: cuts.records, shotLengthsSec: cuts.shotLengthsSec, moves: camera.moves, pauseMap: audio.pauseMap },
    notMeasured,
  };
}
