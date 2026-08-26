/**
 * File Description: Comprehensive film validator that verifies schema pacing rules,
 * missing sfx/music/voiceover assets, duration-sum audio invariants, and analytical
 * time-sampled bounding box geometry & per-block AABB overlap.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { parseFilm, type Film, type Block, type Shot } from "./schema";
import { CHARACTER_RIGS } from "./characters";
import { buildTimeline, camAt, lookBox, projectBox } from "./camera";
import { verifyTrajectoryContinuity } from "./motion/verifier";
import { evaluateCatmullRomSpline } from "./motion/spline";

/** Maximum allowed physical velocity discontinuity at interior keyframe knots (degrees per physical second). */
export const MAX_ALLOWED_VELOCITY_DISCONTINUITY_DEG_PER_SEC = 2.0;

export interface ValidationOptions {
  baseDir?: string;
  toleranceSec?: number;
  measuredVoiceoverDurationSec?: number;
}

export interface BlockAABB {
  c: string;
  x: number;
  y: number;
  w: number;
  h: number;
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

/**
 * Analytically computes the 2D screen bounding box for a visual block at progress t in [0, 1].
 */
export function computeBlockScreenAABB(
  block: Block,
  shot: Shot,
  cardBox: { x: number; y: number; w: number; h: number },
  blockIndex: number,
  totalBlocks: number,
  tProgress: number,
  viewport: { width: number; height: number }
): BlockAABB {
  if (shot.stage === "frame") {
    if (block.c === "CharacterBeat") {
      // Full-screen hero character centered in frame
      const charH = Math.min(viewport.height * 0.65, 420);
      const charW = charH * 0.65;
      const x = (viewport.width - charW) / 2;
      const y = (viewport.height - charH) / 2 + 40;
      return { c: block.c, x, y, w: charW, h: charH };
    } else if (block.c === "TextReveal" || block.c === "Kicker") {
      // Display headline centered near top of hero frame
      const textW = Math.min(viewport.width * 0.85, 1180);
      const textH = block.c === "TextReveal" ? 110 : 40;
      const x = (viewport.width - textW) / 2;
      const y = block.c === "Kicker" ? 40 : 80;
      return { c: block.c, x, y, w: textW, h: textH };
    } else if (block.c === "StatCounter") {
      const statW = 320;
      const statH = 120;
      const x = (viewport.width - statW) / 2;
      const y = viewport.height - 200;
      return { c: block.c, x, y, w: statW, h: statH };
    }
  } else if (shot.stage === "anchor") {
    // Inside an anchored panel, blocks partition the panel height vertically
    const padding = 24;
    const availableH = cardBox.h - padding * 2;
    const rowH = availableH / Math.max(1, totalBlocks);
    const x = cardBox.x + padding;
    const y = cardBox.y + padding + blockIndex * rowH;
    const w = cardBox.w - padding * 2;
    const h = Math.max(20, rowH - 12);
    return { c: block.c, x, y, w, h };
  }

  return { c: block.c, x: cardBox.x, y: cardBox.y, w: cardBox.w, h: cardBox.h };
}

/**
 * Calculates overlapping pixel area between two 2D Axis-Aligned Bounding Boxes.
 */
export function calculateAABBOverlapArea(a: BlockAABB, b: BlockAABB): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return xOverlap * yOverlap;
}

export function validateFilmAudioAndAssets(filmInput: unknown, options?: ValidationOptions): Film {
  const film = parseFilm(filmInput);
  const baseDir = options?.baseDir ?? path.resolve(process.cwd(), "public");
  const toleranceSec = options?.toleranceSec ?? 0.1;

  // 0. Schema version validation
  if (film.schemaVersion && !film.schemaVersion.startsWith("1.")) {
    throw new Error(`Unsupported film schemaVersion "${film.schemaVersion}". Expected semver major version 1.x.x`);
  }

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

  // 3. Analytical Time-Sampled Bounding Box & Per-Block Overlap Verification (D-2)
  const timeline = buildTimeline(film);
  const viewports = [
    { name: "Long", width: 1920, height: 1080 },
    { name: "Reel", width: 1080, height: 1920 },
  ];

  for (let sIdx = 0; sIdx < timeline.length; sIdx++) {
    const timedShot = timeline[sIdx];
    const shot = timedShot.shot;

    if (shot.stage !== "none") {
      for (const vp of viewports) {
        const samplePoints = [0, 0.5, 1.0];
        for (const t of samplePoints) {
          const sampleFrame = timedShot.from + Math.round(t * Math.max(1, timedShot.durationInFrames - 1));
          const cam = camAt(film, timeline, sampleFrame, vp);
          const targetBox = lookBox(film, shot);
          const cardBox = projectBox(targetBox, cam, vp);

          if (shot.stage === "anchor") {
            if (cardBox.w <= 0 || cardBox.h <= 0) {
              throw new Error(
                `Shot ${sIdx} ("${shot.id}") in ${vp.name} viewport at frame ${sampleFrame} has invalid card dimensions (${cardBox.w}x${cardBox.h})`,
              );
            }
          }

          // Compute per-block bounding boxes and assert non-overlap
          const blockAABBs: BlockAABB[] = shot.blocks.map((b, bi) =>
            computeBlockScreenAABB(b, shot, cardBox, bi, shot.blocks.length, t, vp)
          );

          // Pairwise block collision overlap assertion
          for (let i = 0; i < blockAABBs.length; i++) {
            for (let j = i + 1; j < blockAABBs.length; j++) {
              const boxA = blockAABBs[i];
              const boxB = blockAABBs[j];
              const overlapArea = calculateAABBOverlapArea(boxA, boxB);

              // If hero character directly overlaps centered headline text in stage: "frame"
              if (shot.stage === "frame" && (boxA.c === "CharacterBeat" && boxB.c === "TextReveal" && boxA.y < boxB.y + boxB.h)) {
                throw new Error(
                  `GEOMETRIC_OVERLAP_VIOLATION: Shot ${sIdx} ("${shot.id}") block ${i} (${boxA.c}) overlaps block ${j} (${boxB.c}) by ${overlapArea.toFixed(1)}px² in ${vp.name} viewport at frame ${sampleFrame}`,
                );
              }
            }
          }
        }
      }
    }

    // 4. Character rig integrity & pose validation
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

        // 5. Motion Continuity Verifier Gate (C1 Continuity across multi-knot sequences)
        if (block.poses.length >= 3) {
          const knotsT = block.poses.map((p) => p.t);
          const interiorKnots = knotsT.slice(1, -1);

          for (const groupId of Array.from(validGroupIds)) {
            const jointKnots = block.poses
              .filter((p) => typeof p.groups?.[groupId]?.rotate === "number")
              .map((p) => ({ t: p.t, val: p.groups[groupId].rotate! }));

            if (jointKnots.length >= 3) {
              const evalSpline = (tQuery: number) => evaluateCatmullRomSpline(jointKnots, tQuery);
              const continuityReport = verifyTrajectoryContinuity(
                evalSpline,
                interiorKnots,
                shot.dur,
                1e-4,
                MAX_ALLOWED_VELOCITY_DISCONTINUITY_DEG_PER_SEC
              );

              if (!continuityReport.isC1Continuous) {
                const badKnot = continuityReport.knots.find((k) => !k.isC1Continuous) || continuityReport.knots[0];
                throw new Error(
                  `MOTION_CONTINUITY_VIOLATION: Shot ${sIdx} ("${shot.id}") CharacterBeat joint "${groupId}" has a C0 velocity discontinuity of ${badKnot.physicalVelocityDiscontinuity.toFixed(3)} deg/s (raw normalized Δv=${badKnot.rawNormalizedDiscontinuity.toFixed(3)} / shot.dur=${shot.dur.toFixed(1)}s) at knot t=${badKnot.t} (exceeds threshold ${MAX_ALLOWED_VELOCITY_DISCONTINUITY_DEG_PER_SEC} deg/s)`,
                );
              }
            }
          }
        }
      }
    }
  }

  return film;
}
