/**
 * File Description: Stage geometry shared by every scene film.
 * A scene film is composed on one square scene space. Each output format shows a 1080-wide strip
 * through its centre, so the square in the middle is the only area both formats always see. These
 * numbers are the standard layer's geometry: artwork placement and the design check both use them.
 * Inputs and outputs: aspect ratio or format type -> coordinate conversion helpers and format safe areas.
 * Used by: SceneStage, ThreeStage, stage checks and backend/sceneKit/stage.ts.
 */

import type { OrthographicCamera } from "three";

export interface StageCameraPose {
  center: { x: number; y: number };
  zoom: number;
  rotation: number;
}

/** Frames per second of every scene film. */
export const FPS = 30;

/** Scene coordinate space. Square, so the wide cut and the reel each take a strip through it. */
export const SCENE_SIZE = { w: 1920, h: 1920 };
export const STAGE_CAMERA_DEPTH = 2000;
export const STAGE_CAMERA_NEAR = 0.1;
export const STAGE_CAMERA_FAR = 10000;

/** An axis-aligned rectangle in scene coordinates. */
export interface SceneRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What each format's fixed window sees of the square scene (SceneStage covers, never letterboxes). */
export const FORMAT_WINDOWS: Record<"wide" | "reel", SceneRect> = {
  // The wide cut takes the horizontal 1080-tall band through the middle.
  wide: { x0: 0, y0: 420, x1: 1920, y1: 1500 },
  // The reel takes the vertical 1080-wide column through the middle.
  reel: { x0: 420, y0: 0, x1: 1500, y1: 1920 },
};

/** The centre square both formats see. Anything essential to the story belongs inside it. */
export const SAFE_SQUARE: SceneRect = { x0: 420, y0: 420, x1: 1500, y1: 1500 };

/** The safe square excluding the bottom 22% caption band (y=1260 to 1500 in wide, y=1498 to 1920 in reel). */
export const CAPTION_SAFE_SQUARE: SceneRect = { x0: 420, y0: 420, x1: 1500, y1: 1260 };

// Reports whether one rectangle lies entirely inside another.
export function rectInside(inner: SceneRect, outer: SceneRect): boolean {
  return inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1;
}

// Returns the actual viewport's centered cover crop and orthographic frustum in stage units.
export function stageViewport(width: number, height: number, size = SCENE_SIZE) {
  const fit = Math.max(width / size.w, height / size.h);
  return { fit, halfWidth: width / fit / 2, halfHeight: height / fit / 2 };
}

// Projects stage coordinates through the same center/zoom/rotation and cover crop as SVG and Three.
export function projectStagePoint(p: { x: number; y: number }, camera: StageCameraPose, width: number, height: number, size = SCENE_SIZE) {
  const { fit } = stageViewport(width, height, size);
  const r = camera.rotation * Math.PI / 180, dx = p.x - camera.center.x, dy = p.y - camera.center.y;
  return { x: width / 2 + (dx * Math.cos(r) - dy * Math.sin(r)) * camera.zoom * fit, y: height / 2 + (dx * Math.sin(r) + dy * Math.cos(r)) * camera.zoom * fit };
}

// Supplies the affine form of the canonical projector for SVG element geometry.
export function stageProjection(camera: StageCameraPose, width: number, height: number, size = SCENE_SIZE) {
  const o = projectStagePoint({ x: 0, y: 0 }, camera, width, height, size);
  const x = projectStagePoint({ x: 1, y: 0 }, camera, width, height, size);
  const y = projectStagePoint({ x: 0, y: 1 }, camera, width, height, size);
  return { a: x.x - o.x, b: x.y - o.y, c: y.x - o.x, d: y.y - o.y, e: o.x, f: o.y };
}

// Assigns the runtime camera from the same viewport and pose used by the geometry projector.
export function applyStageCamera(camera: OrthographicCamera, pose: StageCameraPose, width: number, height: number, size = SCENE_SIZE): void {
  const viewport = stageViewport(width, height, size);
  camera.left = -viewport.halfWidth / pose.zoom;
  camera.right = -camera.left;
  camera.top = viewport.halfHeight / pose.zoom;
  camera.bottom = -camera.top;
  camera.near = STAGE_CAMERA_NEAR;
  camera.far = STAGE_CAMERA_FAR;
  camera.position.set(pose.center.x - size.w / 2, size.h / 2 - pose.center.y, STAGE_CAMERA_DEPTH);
  camera.rotation.set(0, 0, pose.rotation * Math.PI / 180);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}
