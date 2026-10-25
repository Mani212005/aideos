/**
 * File Description: Per-shot motion time floors derived from the film's compiled camera curve.
 * Inputs and outputs: long Film -> minimum seconds for each shot under uniform curve retiming.
 * Used by: backend/reelCut/constraints.ts; the reel design check remains the final motion gate.
 */
import type { Film } from "../../src/dl/schema";
import { buildTimeline, MIN_SHOT_FRAMES } from "../../src/dl/camera";
import { compileCameraTrack } from "../../src/dl/scene/cameraTrack";
import { projectStagePoint, SAFE_SQUARE } from "../../src/dl/scene/projection";
import {
  MAX_CAMERA_PAN_WIDTHS,
  MAX_CAMERA_PAN_ACCEL_WIDTHS,
  MAX_CAMERA_ZOOM_STEP,
} from "../designCheck/designCheck";
import { MS } from "../../src/dl/motion";

// Measures the time scale required by speed, zoom and acceleration on each shot's actual curve.
export function minimumShotSeconds(film: Film): Map<string, number> {
  const timeline = buildTimeline(film);
  const scene = film.scene;
  if (!scene)
    return new Map(
      timeline.map(({ shot, index }) => [
        shot.id,
        index > 0 && shot.move !== "cut"
          ? Math.max(MS.move / 1000, MIN_SHOT_FRAMES / film.fps)
          : MIN_SHOT_FRAMES / film.fps,
      ]),
    );
  const camera = compileCameraTrack(
    scene.camera,
    scene.durationFrames,
    scene.sceneSize,
  );
  const fps = scene.fps;
  return new Map(
    timeline.map(({ shot, from, to }) => {
      let scale = 0;
      for (let f = Math.max(1, from); f < Math.min(camera.length, to); f++) {
        const a = camera[f - 1],
          b = camera[f];
        const speed =
          Math.hypot(b.center.x - a.center.x, b.center.y - a.center.y) * fps;
        scale = Math.max(
          scale,
          speed / (scene.sceneSize.w * MAX_CAMERA_PAN_WIDTHS),
          Math.abs(b.zoom - a.zoom) / a.zoom / MAX_CAMERA_ZOOM_STEP,
        );
        if (f > 1) {
          const before = camera[f - 2];
          const prevSpeed =
            Math.hypot(
              a.center.x - before.center.x,
              a.center.y - before.center.y,
            ) * fps;
          scale = Math.max(
            scale,
            Math.sqrt(
              (Math.abs(speed - prevSpeed) * fps) /
                (scene.sceneSize.w * MAX_CAMERA_PAN_ACCEL_WIDTHS),
            ),
          );
        }
        if (scene.renderer === "three") {
          for (const x of [SAFE_SQUARE.x0, SAFE_SQUARE.x1])
            for (const y of [SAFE_SQUARE.y0, SAFE_SQUARE.y1]) {
              const p = projectStagePoint(
                { x, y },
                a,
                1080,
                1920,
                scene.sceneSize,
              );
              const q = projectStagePoint(
                { x, y },
                b,
                1080,
                1920,
                scene.sceneSize,
              );
              scale = Math.max(
                scale,
                (Math.hypot(q.x - p.x, q.y - p.y) * fps) /
                  1080 /
                  MAX_CAMERA_PAN_WIDTHS,
              );
              if (f > 1) {
                const r = projectStagePoint(
                  { x, y },
                  camera[f - 2],
                  1080,
                  1920,
                  scene.sceneSize,
                );
                scale = Math.max(
                  scale,
                  Math.sqrt(
                    (Math.hypot(q.x - 2 * p.x + r.x, q.y - 2 * p.y + r.y) *
                      fps *
                      fps) /
                      1080 /
                      MAX_CAMERA_PAN_ACCEL_WIDTHS,
                  ),
                );
              }
            }
        }
      }
      return [
        shot.id,
        Math.max(MIN_SHOT_FRAMES, Math.ceil((to - from) * scale - 1e-9)) /
          film.fps,
      ];
    }),
  );
}
