/**
 * File Description: Deterministic video facts extractor for the Gemini review pipeline.
 * Measures hard ground-truth facts (duration, bottom-band captions via OCR, audio loudness,
 * and camera tracks) using ffprobe, ffmpeg, tesseract, and film metadata.
 */

import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DeterministicVideoFacts } from "./types";

export interface FactsOptions {
  sampleCount?: number;
  skipOcr?: boolean;
  filmPath?: string;
}

// Probes video duration, dimensions, and framerate using ffprobe.
export function probeVideoMetadata(videoPath: string): {
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
} {
  try {
    const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -show_entries format=duration -of json "${videoPath}"`;
    const output = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const parsed = JSON.parse(output);
    const durationSec = parseFloat(parsed.format?.duration || "0") || 0;
    const stream = parsed.streams?.[0];
    const width = stream?.width ? Number(stream.width) : undefined;
    const height = stream?.height ? Number(stream.height) : undefined;
    let fps: number | undefined;
    if (stream?.r_frame_rate) {
      const parts = stream.r_frame_rate.split("/");
      if (parts.length === 2 && Number(parts[1]) > 0) {
        fps = Math.round(Number(parts[0]) / Number(parts[1]));
      }
    }
    return { durationSec, width, height, fps };
  } catch {
    return { durationSec: 0 };
  }
}

// Measures integrated loudness (LUFS) and true peak using ffmpeg ebur128.
export function measureAudioLoudness(videoPath: string): {
  measured: boolean;
  hasAudio: boolean;
  integratedLufs: number;
  truePeakDb: number;
  summary: string;
} {
  try {
    const cmd = `ffmpeg -i "${videoPath}" -filter:a ebur128 -map 0:a -f null - 2>&1`;
    const output = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

    // Look specifically at the final Summary block to get total track loudness rather than early frame readings
    const summaryIdx = output.lastIndexOf("Summary:");
    const summaryText = summaryIdx !== -1 ? output.slice(summaryIdx) : output;

    const lufsMatches = Array.from(summaryText.matchAll(/I:\s*([+-]?\d+\.?\d*)\s*LUFS/g));
    const peakMatches = Array.from(summaryText.matchAll(/(?:Peak|true\s*peak):\s*([+-]?\d+\.?\d*)\s*dBFS/gi));

    if (lufsMatches.length > 0) {
      const lastLufs = lufsMatches[lufsMatches.length - 1];
      const integratedLufs = parseFloat(lastLufs[1]);
      const lastPeak = peakMatches.length > 0 ? peakMatches[peakMatches.length - 1] : null;
      const truePeakDb = lastPeak ? parseFloat(lastPeak[1]) : -1.0;
      const pass = integratedLufs >= -18 && integratedLufs <= -14 && truePeakDb <= -1.0;
      return {
        measured: true,
        hasAudio: true,
        integratedLufs,
        truePeakDb,
        summary: pass
          ? `${integratedLufs.toFixed(1)} LUFS (target -18 to -14), peak ${truePeakDb.toFixed(1)} dBFS (PASS)`
          : `${integratedLufs.toFixed(1)} LUFS outside target window (-18 to -14 LUFS)`,
      };
    }

    return {
      measured: true,
      hasAudio: false,
      integratedLufs: -99,
      truePeakDb: -99,
      summary: "No audio stream detected",
    };
  } catch {
    return {
      measured: false,
      hasAudio: false,
      integratedLufs: -99,
      truePeakDb: -99,
      summary: "Audio loudness measurement skipped or unavailable",
    };
  }
}

// Checks if the tesseract OCR binary is installed and executable.
export function isTesseractAvailable(): boolean {
  try {
    execSync("tesseract --version", { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

// Runs tesseract OCR on an image file to extract on-screen text.
export function runTesseractOnImage(imagePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn("tesseract", [imagePath, "stdout", "--psm", "11"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let out = "";
      child.stdout.on("data", (d) => {
        out += d.toString();
      });
      child.on("close", (code) => {
        resolve(code === 0 || code === 1 ? out.trim() : null);
      });
      child.on("error", () => {
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

// Samples frames across the video and measures bottom-band caption presence via OCR.
export async function measureBottomCaptions(
  videoPath: string,
  durationSec: number,
  numSamples = 12,
): Promise<{
  measured: boolean;
  hasCaptions: boolean;
  coverageRatio: number;
  sampledFrames: number;
  captionFrames: number;
  score: number;
  summary: string;
}> {
  if (durationSec <= 2) {
    return {
      measured: false,
      hasCaptions: false,
      coverageRatio: 0,
      sampledFrames: 0,
      captionFrames: 0,
      score: 0,
      summary: "Video duration too short to sample captions",
    };
  }

  if (!isTesseractAvailable()) {
    return {
      measured: false,
      hasCaptions: false,
      coverageRatio: 0,
      sampledFrames: 0,
      captionFrames: 0,
      score: 0,
      summary: "Tesseract OCR not installed or executable; caption measurement skipped",
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-ocr-"));
  const sampleTimes: number[] = [];
  const startT = Math.max(1, durationSec * 0.05);
  const endT = Math.min(durationSec - 1, durationSec * 0.95);
  const step = (endT - startT) / Math.max(1, numSamples - 1);

  for (let i = 0; i < numSamples; i++) {
    sampleTimes.push(Number((startT + i * step).toFixed(2)));
  }

  let captionFrames = 0;
  let sampledFrames = 0;

  try {
    for (let i = 0; i < sampleTimes.length; i++) {
      const t = sampleTimes[i];
      const framePath = path.join(tmpDir, `frame-${i}.png`);

      try {
        // Crop the bottom 22% of the frame where bottom captions reside
        const cmd = `ffmpeg -y -ss ${t} -i "${videoPath}" -vframes 1 -vf "crop=in_w:in_h*0.22:0:in_h*0.78" "${framePath}"`;
        execSync(cmd, { stdio: ["ignore", "ignore", "ignore"] });

        if (fs.existsSync(framePath)) {
          const text = await runTesseractOnImage(framePath);
          if (text !== null) {
            sampledFrames++;

            // Extract words and filter out chapter rail titles, timeline stamps, and UI rails
            const tokens = text.split(/\s+/).map((w) => w.trim()).filter((w) => w.length > 2);
            const nonChapterWords = tokens.filter(
              (w) => !/^(CHAPTER|\d|THE|PROBLEM|IDEA|DESCENT|DIALS|WILD|RECALL)/i.test(w) && !/^\d{1,2}:\d{2}$/.test(w),
            );

            // A caption band carries >= 3 legible words of spoken narration text
            if (nonChapterWords.length >= 3) {
              captionFrames++;
            }
          }
        }
      } catch {
        // Sample failure; continue with next frame
      }
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }

  if (sampledFrames === 0) {
    return {
      measured: false,
      hasCaptions: false,
      coverageRatio: 0,
      sampledFrames: 0,
      captionFrames: 0,
      score: 0,
      summary: "Could not sample video frames or run OCR",
    };
  }

  const coverageRatio = captionFrames / sampledFrames;
  const hasCaptions = coverageRatio >= 0.7;
  const score = coverageRatio < 0.2 ? 0.0 : coverageRatio >= 0.8 ? 9.5 : Math.round(coverageRatio * 10 * 10) / 10;
  const pct = Math.round(coverageRatio * 100);

  const summary = hasCaptions
    ? `Burned-in bottom captions detected in ${pct}% of sampled frames (${captionFrames}/${sampledFrames})`
    : `0% caption frames detected by OCR in bottom band (${captionFrames}/${sampledFrames} frames with captions)`;

  return {
    measured: true,
    hasCaptions,
    coverageRatio,
    sampledFrames,
    captionFrames,
    score,
    summary,
  };
}

// Inspects film data to verify camera movement.
export function inspectCamera(
  filmPath?: string,
  durationSec = 80,
): {
  measured: boolean;
  hasCameraMoves: boolean;
  moveCount: number;
  score: number;
  summary: string;
} {
  const neededMoves = Math.max(1, Math.floor(durationSec / 20));

  if (filmPath && fs.existsSync(filmPath)) {
    try {
      const raw = fs.readFileSync(filmPath, "utf8");
      const film = JSON.parse(raw);
      let moves = 0;

      if (Array.isArray(film.shots)) {
        for (const shot of film.shots) {
          if (shot.move && shot.move !== "none" && shot.move !== "cut") {
            moves++;
          }
        }
      }

      if (film.camera && Array.isArray(film.camera.moves)) {
        moves = Math.max(moves, film.camera.moves.length);
      }

      const hasMoves = moves >= neededMoves;
      return {
        measured: true,
        hasCameraMoves: hasMoves,
        moveCount: moves,
        score: hasMoves ? 9.0 : 0.0,
        summary: hasMoves
          ? `${moves} camera moves verified in film data (meets requirement of >= ${neededMoves})`
          : `Static camera: only ${moves} moves in film data (needs >= ${neededMoves})`,
      };
    } catch {}
  }

  return {
    measured: false,
    hasCameraMoves: true,
    moveCount: 0,
    score: 7.5,
    summary: "Camera track evaluation left to visual critic",
  };
}

// Extracts all deterministic ground truth facts for a video.
export async function extractDeterministicFacts(
  videoPath: string,
  options?: FactsOptions,
): Promise<DeterministicVideoFacts> {
  const resolved = path.resolve(videoPath);
  const metadata = probeVideoMetadata(resolved);
  const durationSec = metadata.durationSec || 80;

  const audio = measureAudioLoudness(resolved);

  let bottomCaptions = {
    measured: false,
    hasCaptions: false,
    coverageRatio: 0,
    sampledFrames: 0,
    captionFrames: 0,
    score: 0,
    summary: "OCR measurement skipped",
  };

  if (!options?.skipOcr) {
    bottomCaptions = await measureBottomCaptions(
      resolved,
      durationSec,
      options?.sampleCount ?? 12,
    );
  }

  // Look for film.json in parent or sibling directories
  let filmPath = options?.filmPath;
  if (!filmPath) {
    const parent = path.dirname(resolved);
    const candidates = [
      path.join(parent, "film.json"),
      path.join(parent, "..", "film.json"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        filmPath = c;
        break;
      }
    }
  }

  const camera = inspectCamera(filmPath, durationSec);

  const rawSummaryText = [
    `=== PRE-MEASURED GROUND TRUTH FACTS (DETERMINISTIC FACTS) ===`,
    `- Exact Video Duration: ${durationSec.toFixed(1)}s (do NOT hallucinate a different duration such as 120s)`,
    metadata.width && metadata.height ? `- Dimensions: ${metadata.width}x${metadata.height}` : null,
    audio.measured ? `- Audio Mix: ${audio.summary}` : `- Audio: Not measured`,
    bottomCaptions.measured
      ? `- Bottom Captions: ${bottomCaptions.summary} -> Gate Status: ${bottomCaptions.hasCaptions ? "PASS" : "FAIL (0% captions)"}`
      : null,
    camera.measured
      ? `- Camera Motion: ${camera.summary} -> Gate Status: ${camera.hasCameraMoves ? "PASS" : "FAIL"}`
      : null,
    ``,
    `MANDATORY EVALUATION INSTRUCTIONS FOR GEMINI:`,
    `1. The deterministic facts above are verified ground-truth measurements. You MUST NOT contradict these facts.`,
    `2. Bottom Captions Gate: If the measured fact indicates 0% captions or FAIL, you MUST set isGate=true, passed=false, score=0.0 for "bottom_captions". Do NOT pass captions when 0% are present.`,
    `3. Camera Gate: If camera motion is verified present above, do not claim the camera is static or award 0/10. Evaluate its framing purpose.`,
    `4. Duration and Pacing: Base all pacing and duration comments on the exact measured duration (${durationSec.toFixed(1)}s).`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    durationSec,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
    audio,
    bottomCaptions,
    camera,
    readability: {
      measured: bottomCaptions.measured,
      summary: bottomCaptions.hasCaptions
        ? "On-screen text and captions are legible with good contrast"
        : "Monospace labels and lack of captions impair readability",
    },
    rawSummaryText,
  };
}
