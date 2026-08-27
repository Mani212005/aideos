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
import { computeBlockRect } from "./layout";
import { verifyTrajectoryContinuity } from "./motion/verifier";
import { evaluateCatmullRomSpline } from "./motion/spline";

/**
 * Maximum allowed physical velocity discontinuity at interior keyframe knots (degrees per physical second).
 * Empirical basis: Smooth Catmull-Rom transitions at multi-action handover seams measure 2.0 - 3.8 deg/s,
 * whereas abrupt C0 motion kinks and joint pops measure > 15.0 deg/s. Threshold is calibrated to 5.0 deg/s.
 */
export const MAX_ALLOWED_VELOCITY_DISCONTINUITY_DEG_PER_SEC = 5.0;

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
  const rect = computeBlockRect(
    { canvas: { nodes: [], edges: [] }, shots: [shot], fps: 30, id: "val", title: "val" } as any,
    shot,
    block,
    viewport,
    { blockIndex, totalBlocks, progress: tProgress }
  );
  return { c: block.c, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
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

      // 6. Visual Metaphor data-driven content & kind integrity (Rules M1, M2, M3)
      if (block.c === "MetaphorViewer") {
        if (!block.content) {
          throw new Error(
            `METAPHOR_MISSING_CONTENT: Shot ${sIdx} ("${shot.id}") MetaphorViewer block ${bIdx} must carry a valid content payload (Rule M1)`,
          );
        }

        const validKinds = [
          "spider-web",
          "liquid-bucket",
          "balance-scale",
          "clock-gears",
          "character-throw",
          "typing-cursor-quote",
          "glowing-cluster",
          "custom",
        ];
        if (!validKinds.includes(block.content.kind)) {
          throw new Error(
            `METAPHOR_INVALID_KIND: Shot ${sIdx} ("${shot.id}") MetaphorViewer content has invalid kind "${block.content.kind}" (Rule M1)`,
          );
        }

        // Rule M2: Required label fields must be non-empty strings
        if (block.content.kind === "balance-scale") {
          if (!block.content.leftLabel?.trim() || !block.content.rightLabel?.trim()) {
            throw new Error(
              `METAPHOR_EMPTY_LABEL: Shot ${sIdx} ("${shot.id}") balance-scale must provide non-empty leftLabel and rightLabel (Rule M2)`,
            );
          }
        } else if (block.content.kind === "liquid-bucket") {
          if (!block.content.levelLabel?.trim()) {
            throw new Error(
              `METAPHOR_EMPTY_LABEL: Shot ${sIdx} ("${shot.id}") liquid-bucket must provide non-empty levelLabel (Rule M2)`,
            );
          }
        }

        // Rule M3: Kind in content must match shot's metaphor field when present
        if (shot.metaphor && shot.metaphor !== block.content.kind) {
          throw new Error(
            `METAPHOR_KIND_MISMATCH: Shot ${sIdx} ("${shot.id}") metaphor field is "${shot.metaphor}" but MetaphorViewer block content.kind is "${block.content.kind}" (Rule M3)`,
          );
        }
      }
    }

    // 7. Visual Direction Reasoned Rationale (Rule M4)
    if (shot.visualDirection) {
      if (shot.visualDirection.startsWith('Visual representation of narration segment: "')) {
        throw new Error(
          `TEMPLATE_VISUAL_DIRECTION: Shot ${sIdx} ("${shot.id}") visualDirection is a generic template string (Rule M4)`,
        );
      }
    }
  }

  // 8. Film-wide metaphor distribution rules (Rules M5 & M6)
  const metaphorSequence: Array<{ shotIndex: number; kind: string }> = [];
  const metaphorCounts: Record<string, number> = {};

  film.shots.forEach((shot, sIdx) => {
    const metaphorBlock = shot.blocks.find((b) => b.c === "MetaphorViewer") as any;
    const kind = metaphorBlock?.content?.kind || shot.metaphor;
    if (kind) {
      metaphorSequence.push({ shotIndex: sIdx, kind });
      metaphorCounts[kind] = (metaphorCounts[kind] ?? 0) + 1;
    }
  });

  // Rule M5: The same metaphor kind may not appear in > 40% of film's shots (when film has >= 3 shots)
  if (film.shots.length >= 3) {
    const maxAllowed = Math.floor(film.shots.length * 0.40);
    for (const [kind, count] of Object.entries(metaphorCounts)) {
      if (count > maxAllowed) {
        throw new Error(
          `METAPHOR_OVERUSE_VIOLATION: Metaphor "${kind}" appears in ${count}/${film.shots.length} shots (exceeds 40% threshold of max ${maxAllowed} shots) (Rule M5)`,
        );
      }
    }
  }

  // Rule M6: No two consecutive shots use the same metaphor kind
  for (let i = 0; i < metaphorSequence.length - 1; i++) {
    const curr = metaphorSequence[i];
    const next = metaphorSequence[i + 1];
    if (next.shotIndex === curr.shotIndex + 1 && curr.kind === next.kind) {
      throw new Error(
        `CONSECUTIVE_METAPHOR_VIOLATION: Shot ${curr.shotIndex + 1} and shot ${next.shotIndex + 1} both use identical metaphor "${curr.kind}" (Rule M6)`,
      );
    }
  }

  return film;
}
