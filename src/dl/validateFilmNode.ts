/**
 * File Description: Node-runtime asset and audio duration verifier for Aideos Films.
 * Extends the pure validateFilm data validator with filesystem asset existence checks and ffprobe duration probes.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { validateFilmAudioAndAssets as pureValidateFilm } from "./validateFilm";
import type { Film } from "./schema";

function findAssetPath(src: string, baseDir: string): string | null {
  const candidates = [
    path.resolve(baseDir, src),
    path.resolve(baseDir, "..", src),
    path.resolve(baseDir, "..", "src", src),
    path.resolve(process.cwd(), "public", src),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function validateFilmWithNodeAssets(
  filmInput: unknown,
  options?: { baseDir?: string; toleranceSec?: number; measuredVoiceoverDurationSec?: number }
): Film {
  const baseDir = options?.baseDir ?? path.resolve(process.cwd(), "public");
  const toleranceSec = options?.toleranceSec ?? 0.1;

  // 1. Measure voiceover duration via ffprobe if voiceover file exists
  let measuredVoiceoverDurationSec = options?.measuredVoiceoverDurationSec;
  const film = filmInput as Partial<Film>;

  if (film?.voiceover?.src) {
    const voPath = findAssetPath(film.voiceover.src, baseDir);
    if (!voPath) {
      throw new Error(`Voiceover asset file missing: "${film.voiceover.src}"`);
    }
    try {
      const output = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${voPath}"`,
      )
        .toString()
        .trim();
      const parsed = parseFloat(output);
      if (!isNaN(parsed) && parsed > 0) {
        measuredVoiceoverDurationSec = parsed;
      }
    } catch {
      // Ignore ffprobe failure
    }
  }

  if (film?.music?.src) {
    const musicPath = findAssetPath(film.music.src, baseDir);
    if (!musicPath) {
      throw new Error(`Music asset file missing: "${film.music.src}"`);
    }
  }

  if (film?.sfx && film.sfx.length > 0) {
    for (const item of film.sfx) {
      const sfxPath = findAssetPath(item.src, baseDir);
      if (!sfxPath) {
        throw new Error(`SFX asset file missing: "${item.src}"`);
      }
    }
  }

  return pureValidateFilm(filmInput, {
    toleranceSec,
    measuredVoiceoverDurationSec,
  });
}
