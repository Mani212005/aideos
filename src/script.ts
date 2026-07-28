import { interpolate } from "remotion";
import { EASE } from "./theme";
import { ACTIVE_EPISODE } from "./activeEpisode";
import { parseEpisode, type CameraSetup, type Scene } from "./schema";

/**
 * Runtime view over the episode data.
 *
 * The episode itself is pure data in `src/episodes/`; this module holds only the
 * functions that turn it into per-frame values. Keeping the two apart is what
 * lets the storyboard generator and the renderer read the same source of truth
 * without the generator needing a browser.
 */

// Validated once at module load. A malformed episode fails here with a field
// path, rather than rendering 1800 frames of something subtly wrong.
export const EPISODE = parseEpisode(ACTIVE_EPISODE);

export const SCRIPT: Scene[] = EPISODE.scenes;
export const FPS = EPISODE.fps;

export type { CameraSetup, Scene };
export type { Bullet, Chip, Accent, VisualModule } from "./schema";

export const TOTAL_SECONDS = SCRIPT.reduce((sum, s) => sum + s.duration, 0);
export const TOTAL_FRAMES = Math.round(TOTAL_SECONDS * FPS);

export const sec = (seconds: number) => Math.round(seconds * FPS);

/** Frame at which each scene begins. */
export const sceneStart = (scene: Scene) => sec(scene.start);
export const sceneFrames = (scene: Scene) => sec(scene.duration);

/**
 * Camera and pigment are interpolated across the *whole* script rather than
 * per scene, so the move never stops dead at a cut. The camera is always
 * travelling toward the next setup and arrives exactly as the copy changes.
 */
const cameraKeys = SCRIPT.map((s) => sec(s.start));

const track = (frame: number, keys: number[], values: number[], easing = EASE.inOut) => {
  if (keys.length === 1) return values[0];
  return interpolate(frame, keys, values, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });
};

export const cameraAt = (frame: number): CameraSetup => ({
  distance: track(frame, cameraKeys, SCRIPT.map((s) => s.camera.distance)),
  yaw: track(frame, cameraKeys, SCRIPT.map((s) => s.camera.yaw)),
  pitch: track(frame, cameraKeys, SCRIPT.map((s) => s.camera.pitch)),
});

/** Where the leaf should sit on screen, falling back to the layout default. */
export const subjectScreenAt = (frame: number, base: { x: number; y: number }) => ({
  x: track(frame, cameraKeys, SCRIPT.map((s) => s.subjectScreen?.x ?? base.x)),
  y: track(frame, cameraKeys, SCRIPT.map((s) => s.subjectScreen?.y ?? base.y)),
});

/**
 * The pigment wash lands in the first 60% of a scene that declares `wash`, so
 * the colour has settled before the viewer finishes reading the line.
 */
const washKeys: number[] = [];
const washValues: number[] = [];
SCRIPT.forEach((scene, i) => {
  const start = sec(scene.start);
  if (i === 0) {
    washKeys.push(start);
    washValues.push(scene.subjectState);
    return;
  }
  const prev = SCRIPT[i - 1];
  if (scene.wash) {
    // Hold the previous value into the cut, then wash across.
    washKeys.push(start, start + Math.round(sceneFrames(scene) * 0.6));
    washValues.push(prev.subjectState, scene.subjectState);
  } else {
    washKeys.push(start);
    washValues.push(scene.subjectState);
  }
});

export const subjectStateAt = (frame: number) =>
  track(frame, washKeys, washValues, EASE.inOut);

/**
 * Modules that occupy the full copy column. When one of these is on screen the
 * 3D subject must recede, or the illustration is read over a moving background
 * and both fight for the same attention.
 */
const WIDE_VISUALS = new Set([
  "compare",
  "formula",
  "rescan",
  "predict",
  "tokenize",
  "spectrum",
  "layers",
  "mismatch",
]);

export const isWideVisual = (visual?: string) =>
  visual !== undefined && WIDE_VISUALS.has(visual);

export const sceneAt = (frame: number): { scene: Scene; index: number; local: number } => {
  for (let i = SCRIPT.length - 1; i >= 0; i--) {
    const start = sec(SCRIPT[i].start);
    if (frame >= start) {
      return { scene: SCRIPT[i], index: i, local: frame - start };
    }
  }
  return { scene: SCRIPT[0], index: 0, local: frame };
};

/**
 * How far the 3D subject fades back on the current frame. Blended across the
 * first few frames of a scene so the change rides the cut instead of popping.
 */
export const subjectDimAt = (frame: number): number => {
  const { scene, index, local } = sceneAt(frame);
  const target = isWideVisual(scene.visual) ? 0.3 : 1;
  if (index === 0 || local >= 12) return target;
  const prevTarget = isWideVisual(SCRIPT[index - 1].visual) ? 0.3 : 1;
  return interpolate(local, [0, 12], [prevTarget, target], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE.inOut,
  });
};

/**
 * The frame the storyboard should show for a scene: far enough in that every
 * entrance has finished, far enough from the end that nothing has begun to exit.
 */
export const posterFrame = (scene: Scene): number => {
  const total = sceneFrames(scene);
  return sceneStart(scene) + Math.min(Math.round(total * 0.72), total - 24);
};
