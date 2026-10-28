/**
 * File Description: Measures the music-to-narration gap from isolated production mixer stems during audible speech.
 * Inputs and outputs: Film and delivery format -> measured 400 ms speech-window level gaps or an explicit unavailable reason.
 * Used by: backend/review/review.ts and backend/review/music.test.ts (D6).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeFilmSoundtrack, type Film } from "../../src/dl/schema";
import type { DeliveryFormat } from "../../src/dl/delivery";
import { stagePublicDir } from "../pipeline/render";

const execute = promisify(execFile);
const ROOT = path.resolve(__dirname, "../..");

export type MusicUnderVoice =
  | { status: "absent" }
  | { status: "unavailable"; reason: string }
  | { status: "measured"; gapDb: number; minimumGapDb: number; worstTimeSec: number; speechWindows: number };

// Compares equally timed stereo stem energies only where the narration is audibly speaking.
export function compareStemLevels(voiceDb: number[], musicDb: number[]): MusicUnderVoice {
  let voiceEnergy = 0;
  let musicEnergy = 0;
  let minimumGapDb = Infinity;
  let worstTimeSec = 0;
  let speechWindows = 0;
  for (let i = 0; i < voiceDb.length; i++) {
    const voice = voiceDb[i];
    const music = musicDb[i];
    if (voice <= -40 || !Number.isFinite(voice)) continue;
    if (music === undefined || Number.isNaN(music)) return { status: "unavailable", reason: "music stem does not cover the narration timeline" };
    speechWindows++;
    voiceEnergy += 10 ** (voice / 10);
    musicEnergy += 10 ** (music / 10);
    const gap = voice - music;
    if (gap < minimumGapDb) {
      minimumGapDb = gap;
      worstTimeSec = i * 0.4;
    }
  }
  if (!speechWindows) return { status: "unavailable", reason: "no audible narration windows in the stem" };
  // Finite floor represents an inaudible music stem without putting Infinity in JSON reports.
  return { status: "measured", gapDb: Math.min(120, 10 * Math.log10(voiceEnergy / musicEnergy)),
    minimumGapDb: Math.min(120, minimumGapDb), worstTimeSec, speechWindows };
}

// Decodes one stem into time-aligned RMS windows using the actual stereo samples.
async function levels(file: string): Promise<number[]> {
  const { stdout } = await execute("ffmpeg", ["-v", "error", "-i", file, "-vn", "-af",
    "aresample=48000,aformat=channel_layouts=stereo,asetnsamples=n=19200:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
    "-f", "null", "-"], { maxBuffer: 64 * 1024 * 1024 });
  const values = [...stdout.matchAll(/lavfi\.astats\.Overall\.RMS_level=([^\r\n]+)/g)].map((match) => Number(match[1]));
  if (!values.length) throw new Error("ffmpeg produced no stem RMS measurements");
  return values;
}

// Renders both buses through Soundtrack so trims, envelopes, retiming, ducking and chapter overlaps match delivery.
export async function measureMusicUnderVoice(film: Film, format: DeliveryFormat, onProgress?: (message: string) => void): Promise<MusicUnderVoice> {
  const soundtrack = normalizeFilmSoundtrack(film);
  if (!soundtrack.sections.length && !film.audioClips?.some((clip) => clip.channel === "music")) return { status: "absent" };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-review-stems-"));
  let publicDir: ReturnType<typeof stagePublicDir> = null;
  try {
    publicDir = stagePublicDir();
    const measurements: number[][] = [];
    for (const stem of ["narration", "music"] as const) {
      onProgress?.(`measuring ${format} ${stem} stem through the production mixer`);
      const props = path.join(work, "props.json");
      const output = path.join(work, `${stem}.wav`);
      fs.writeFileSync(props, JSON.stringify({ film, format, stem }));
      await execute("npx", ["remotion", "render", "src/dl/reviewAudio.tsx", "ReviewAudio", output,
        `--props=${props}`, "--codec=wav", "--log=error", "--concurrency=2",
        ...(publicDir ? [`--public-dir=${publicDir.dir}`] : [])],
      { cwd: ROOT, maxBuffer: 4 * 1024 * 1024, timeout: 30 * 60 * 1000 });
      measurements.push(await levels(output));
      fs.rmSync(output);
    }
    return compareStemLevels(measurements[0], measurements[1]);
  } catch (error) {
    return { status: "unavailable", reason: error instanceof Error ? error.message.slice(-2000) : String(error) };
  } finally {
    publicDir?.cleanup();
    fs.rmSync(work, { recursive: true, force: true });
  }
}
