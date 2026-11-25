/**
 * File Description: Caption presence of a reference for `aideos study`, by two independent methods on the same sampled frames. Method A is the
 * existing review caption measurement (tesseract OCR, `analyzeSample` in backend/review/ocr.ts, caption-sized words in the bottom band). Method B is a
 * pixel test of the same band: a plausible share of ink (pixels far from the band median) with no OCR. Caption cadence (words per burst, burst rate)
 * is NOT measured: it needs OCR at frame rate, which is out of scope here, and the review's own 2 s sampling cannot resolve a word that lasts 0.1 s.
 * Inputs and outputs: a video file and its probe facts -> caption presence metric (share of samples with a caption) and what was not measured.
 * Used by: backend/study/study.ts.
 */

import { spawnSyncBounded } from "../proc";
import { analyzeSample, ocrFrame, type OcrWord } from "../review/ocr";
import { streamSampleFrames } from "../review/media";
import type { VideoFacts } from "../review/types";
import { resolveMetric } from "./agreement";
import { STUDY, type Metric, type NotMeasured } from "./types";

/** Injectable effects, so a test never needs a real OCR process. */
export interface CaptionDeps {
  /** Reads words from a full-resolution gray frame. Defaults to the review's tesseract reader. */
  ocr?: (gray: Uint8Array, width: number, height: number) => Promise<OcrWord[]>;
  /** Whether tesseract exists. Defaults to running `tesseract --version`. */
  hasTesseract?: () => boolean;
}

// True when a tesseract binary answers `--version`.
function defaultHasTesseract(): boolean {
  return spawnSyncBounded("tesseract", ["--version"], { stdio: "ignore" }).status === 0;
}

// Method B: whether the bottom band of a gray frame holds ink (pixels more than inkLevels off the band median) in a plausible share for captions.
export function bandHasInk(gray: Uint8Array, width: number, height: number): boolean {
  const top = Math.floor(height * STUDY.captions.bandTopRatio);
  const bins = new Uint32Array(256);
  let n = 0;
  for (let y = top; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      bins[gray[y * width + x]]++;
      n++;
    }
  }
  if (n === 0) return false;
  let seen = 0;
  let median = 128;
  for (let v = 0; v < 256; v++) {
    seen += bins[v];
    if (seen >= n / 2) { median = v; break; }
  }
  let ink = 0;
  for (let v = 0; v < 256; v++) if (Math.abs(v - median) > STUDY.captions.inkLevels) ink += bins[v];
  const share = ink / n;
  return share >= STUDY.captions.inkShareMin && share <= STUDY.captions.inkShareMax;
}

/** The caption result of one reference. */
export interface CaptionAnalysis {
  metrics: Metric[];
  notMeasured: NotMeasured[];
}

// Samples frames at the review's cadence and measures caption presence by OCR and by band ink.
export async function measureCaptions(file: string, video: VideoFacts, deps: CaptionDeps = {}): Promise<CaptionAnalysis> {
  const hasTesseract = (deps.hasTesseract ?? defaultHasTesseract)();
  const ocr = deps.ocr ?? ocrFrame;
  let samples = 0;
  let ocrCaptions = 0;
  let inkCaptions = 0;
  await streamSampleFrames(file, video, STUDY.captions.sampleEverySec, async (gray, _index, t) => {
    samples++;
    if (bandHasInk(gray, video.width, video.height)) inkCaptions++;
    if (hasTesseract) {
      const words = await ocr(gray, video.width, video.height);
      if (analyzeSample(words, gray, video.width, video.height, t).hasCaption) ocrCaptions++;
    }
  });
  const share = (n: number) => (samples > 0 ? n / samples : null);
  const metric = resolveMetric({
    id: "captions.presenceShare",
    label: "Share of sampled moments with caption text in the bottom band",
    unit: "share",
    a: { method: `review caption measurement: tesseract OCR, caption-sized words in the bottom ${Math.round((1 - STUDY.captions.bandTopRatio) * 100)}% band, one sample every ${STUDY.captions.sampleEverySec} s`, value: hasTesseract ? share(ocrCaptions) : null, ...(hasTesseract ? {} : { note: "tesseract is not installed" }) },
    b: { method: `band ink test: ${Math.round(STUDY.captions.inkShareMin * 1000) / 10}% to ${Math.round(STUDY.captions.inkShareMax * 100)}% of the band more than ${STUDY.captions.inkLevels} gray levels off its median, same samples`, value: share(inkCaptions) },
    tolerance: { abs: STUDY.captions.presenceToleranceAbs },
  });
  return {
    metrics: [metric],
    notMeasured: [
      { what: "caption cadence (words per burst, burst rate, one-word captions)", why: `needs OCR at frame rate, which is out of scope for this step; the review's own ${STUDY.captions.sampleEverySec} s sampling cannot resolve a word shown for 0.1 to 0.3 s` },
      { what: "caption text", why: "a study never keeps what a reference says or shows as text" },
    ],
  };
}
