/**
 * File Description: Masters delivered MP4 audio with a measured linear gain and conditional peak limiter, and writes description credits.
 * Inputs and outputs: Rendered MP4 and film soundtracks -> mastered MP4, measured report and description-credits.txt.
 * Used by: production render stage, CLI render, studio export and all-check render.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { normalizeFilmSoundtrack, type Film } from "../src/dl/schema";
import { isLibrarySource } from "../src/dl/audio/sectionMixer";
import { loadAudioLibrary } from "./audioLibrary/library";
import { parseEbur128, type Loudness } from "./review/media";

export type MasterResult =
  | { status: "skipped"; reason: string }
  | { status: "unchanged" | "mastered"; before: Loudness; after: Loudness; gainDb: number; limited: boolean };

// Measures the delivered audio, rejecting partial statistics from failed ffmpeg runs.
function measure(file: string): Loudness | null {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-vn",
    "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? parseEbur128(result.stderr) : null;
}

// Masters against encoded measurements, preserving video packets and the original file on any failure.
export function masterAudio(file: string, onLog: (message: string) => void = console.warn): MasterResult {
  fs.rmSync(`${file}.master.json`, { force: true });
  const before = measure(file);
  let result: MasterResult;
  if (!before || before.integratedLufs <= -70) {
    result = { status: "skipped", reason: "ffmpeg could not measure finite, audible integrated loudness and true peak" };
    onLog(`Master skipped for ${file}: ${result.reason}; original render retained`);
  } else if (Math.abs(before.integratedLufs + 16) <= 0.5 && before.truePeakDb <= -1) {
    result = { status: "unchanged", before, after: before, gainDb: 0, limited: false };
  } else {
    const gainDb = -16 - before.integratedLufs;
    let limited = before.truePeakDb + gainDb > -1;
    const temporary = path.join(path.dirname(file), `.${path.basename(file)}.master-${process.pid}.mp4`);
    try {
      let after: Loudness | null = null;
      let correctedGain = gainDb;
      let limitDb = -2;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const filter = `volume=${correctedGain}dB${limited ? `,aresample=192000,alimiter=limit=${10 ** (limitDb / 20)}:release=5:level=false:latency=true,aresample=48000` : ""}`;
        const encoded = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-map", "0:v:0", "-map", "0:a:0",
          "-map_metadata", "0", "-c:v", "copy", "-af", filter, "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", temporary],
        { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
        if (encoded.status !== 0) throw new Error(`Master audio encode failed: ${encoded.error?.message ?? encoded.stderr}`);
        after = measure(temporary);
        if (!after || (Math.abs(after.integratedLufs + 16) <= 0.5 && after.truePeakDb <= -1)) break;
        if (after.truePeakDb > -1) {
          if (limited) limitDb -= after.truePeakDb + 1;
          limited = true;
        }
        correctedGain += -16 - after.integratedLufs;
      }
      if (!after) {
        result = { status: "skipped", reason: "ffmpeg could not measure the mastered candidate" };
        onLog(`Master skipped for ${file}: ${result.reason}; original render retained`);
      } else {
        if (Math.abs(after.integratedLufs + 16) > 0.5 || after.truePeakDb > -1) {
          throw new Error(`Master did not meet -16 +/- 0.5 LUFS and <= -1 dBTP: ${JSON.stringify(after)}; original render retained`);
        }
        fs.renameSync(temporary, file);
        result = { status: "mastered", before, after, gainDb: correctedGain, limited };
        onLog(`Master ${path.basename(file)}: ${before.integratedLufs} -> ${after.integratedLufs} LUFS, ${before.truePeakDb} -> ${after.truePeakDb} dBTP; gain ${correctedGain.toFixed(1)} dB${limited ? ", limited" : ""}`);
      }
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  fs.writeFileSync(`${file}.master.json`, JSON.stringify(result, null, 2) + "\n");
  return result;
}

// Writes unique required credit text from the actual library items used by all delivered cuts.
export function writeDescriptionCredits(rendersDir: string, films: Film[]): void {
  const credits = new Set<string>();
  const library = loadAudioLibrary();
  for (const film of films) {
    const soundtrack = normalizeFilmSoundtrack(film);
    for (const source of [...soundtrack.sections, ...soundtrack.sfx]) {
      if (!isLibrarySource(source)) continue;
      const item = library.items.find((item) => item.id === source.item);
      if (!item || (source.sha256 && source.sha256 !== item.sha256)) throw new Error(`Unknown or changed credit item: ${source.item}`);
      const credit = item.licence.attribution;
      if (credit?.trim()) credits.add(credit.trim());
    }
  }
  fs.mkdirSync(rendersDir, { recursive: true });
  fs.writeFileSync(path.join(rendersDir, "description-credits.txt"), credits.size ? [...credits].join("\n\n") + "\n" : "");
}
