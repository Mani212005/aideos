/**
 * File Description: Stage geometry shared by every scene film.
 * A scene film is composed on one square scene space. Each output format shows a 1080-wide strip
 * through its centre, so the square in the middle is the only area both formats always see. These
 * numbers are the standard layer's geometry: artwork placement and the design check both use them.
 */

/** Frames per second of every scene film. */
export const FPS = 30;

/** Scene coordinate space. Square, so the wide cut and the reel each take a strip through it. */
export const SCENE_SIZE = { w: 1920, h: 1920 };

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

// Reports whether one rectangle lies entirely inside another.
export function rectInside(inner: SceneRect, outer: SceneRect): boolean {
  return inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1;
}
