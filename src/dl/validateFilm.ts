/**
 * File Description: Comprehensive film validator that verifies schema pacing rules,
 * missing sfx/music/voiceover assets, and duration-sum audio invariants.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { parseFilm, type Film } from "./schema";
import { CHARACTER_RIGS } from "./characters";

export interface ValidationOptions {
  baseDir?: string;
  toleranceSec?: number;
  measuredVoiceoverDurationSec?: number;
}

function findAssetPath(src: string, baseDir: string): string | null {
  const candidates = [
    path.resolve(baseDir, src),
    path.resolve(baseDir, "..", src),
    path.resolve(baseDir, "..", "src", src),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function validateFilmAudioAndAssets(filmInput: unknown, options?: ValidationOptions): Film {
  const film = parseFilm(filmInput);
  const baseDir = options?.baseDir ?? path.resolve(process.cwd(), "public");
  const toleranceSec = options?.toleranceSec ?? 0.1;

  // 1. Missing audio asset file checks
  if (film.voiceover?.src) {
    const voPath = findAssetPath(film.voiceover.src, baseDir);
    if (!voPath) {
      throw new Error(`Voiceover asset file missing: "${film.voiceover.src}"`);
    }
  }

  if (film.music?.src) {
    const musicPath = findAssetPath(film.music.src, baseDir);
    if (!musicPath) {
      throw new Error(`Music asset file missing: "${film.music.src}"`);
    }
  }

  if (film.sfx && film.sfx.length > 0) {
    for (const item of film.sfx) {
      const sfxPath = findAssetPath(item.src, baseDir);
      if (!sfxPath) {
        throw new Error(`SFX asset file missing: "${item.src}"`);
      }
    }
  }

  // 2. Duration sum invariant check against voiceover duration
  let voDur = options?.measuredVoiceoverDurationSec;
  if (voDur === undefined && film.voiceover?.src) {
    const voPath = findAssetPath(film.voiceover.src, baseDir);
    if (voPath) {
      try {
        const output = execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${voPath}"`,
        )
          .toString()
          .trim();
        const parsed = parseFloat(output);
        if (!isNaN(parsed) && parsed > 0) {
          voDur = parsed;
        }
      } catch {
        // Ignore ffprobe execution error if unavailable
      }
    }
  }

  if (voDur !== undefined && voDur > 0) {
    const sumShotDurations = film.shots.reduce((acc, shot) => acc + shot.dur, 0);
    const diff = Math.abs(sumShotDurations - voDur);
    if (diff > toleranceSec) {
      throw new Error(
        `Duration sum invariant violated: total shot duration (${sumShotDurations.toFixed(3)}s) differs from voiceover duration (${voDur.toFixed(3)}s) by ${diff.toFixed(3)}s beyond tolerance ${toleranceSec}s`,
      );
    }
  }

  // 3. Character rig integrity validation
  for (let sIdx = 0; sIdx < film.shots.length; sIdx++) {
    const shot = film.shots[sIdx];
    for (let bIdx = 0; bIdx < shot.blocks.length; bIdx++) {
      const block = shot.blocks[bIdx];
      if (block.c === "CharacterBeat") {
        const rig = CHARACTER_RIGS[block.characterId];
        if (!rig) {
          throw new Error(
            `Shot ${sIdx} ("${shot.id}") block ${bIdx} references unknown characterId "${block.characterId}". Available: ${Object.keys(CHARACTER_RIGS).join(", ")}`,
          );
        }
        const validGroupIds = new Set(rig.groups.map((g) => g.id));
        let prevT = -1;
        for (let pIdx = 0; pIdx < block.poses.length; pIdx++) {
          const pose = block.poses[pIdx];
          if (pose.t < 0 || pose.t > 1) {
            throw new Error(
              `Shot ${sIdx} ("${shot.id}") block ${bIdx} pose ${pIdx} has invalid progress t=${pose.t}; must be between 0 and 1`,
            );
          }
          if (pose.t < prevT) {
            throw new Error(
              `Shot ${sIdx} ("${shot.id}") block ${bIdx} pose keyframes must be non-decreasing in t (pose ${pIdx} t=${pose.t} < prev ${prevT})`,
            );
          }
          prevT = pose.t;

          for (const groupId of Object.keys(pose.groups)) {
            if (!validGroupIds.has(groupId)) {
              throw new Error(
                `Shot ${sIdx} ("${shot.id}") block ${bIdx} pose ${pIdx} references unknown group "${groupId}" for character "${block.characterId}". Valid groups: ${Array.from(validGroupIds).join(", ")}`,
              );
            }
          }
        }
      }
    }
  }

  return film;
}
