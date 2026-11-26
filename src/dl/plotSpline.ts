/**
 * File Description: The Plot device's curve (Catmull-Rom through the points as cubic beziers), its evaluator and its numeric
 * arc length, shared by the Remotion component and the native emitter so both draw the same path and dash it the same way.
 * Pure: no React or Node imports.
 * Inputs and outputs: points in the plot's own units -> the path data, a point at a fraction of the curve, and the length.
 * Used by: src/dl/primitives.tsx (Plot), backend/renderIr/emitPlot.ts.
 */

export type Pt = { x: number; y: number };

/**
 * Catmull-Rom through the points, converted to cubic beziers.
 *
 * The evaluator is kept alongside the path builder on purpose: the travelling
 * dot has to sit exactly on the drawn line, and eyeballing it with a separate
 * linear interpolation puts the dot visibly off the curve at every bend.
 */
export const spline = (pts: Pt[]) => {
  const segs: { p0: Pt; p1: Pt; p2: Pt; p3: Pt }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p3 = pts[i + 1];
    const prev = pts[i - 1] ?? p0;
    const next = pts[i + 2] ?? p3;
    segs.push({
      p0,
      p1: { x: p0.x + (p3.x - prev.x) / 6, y: p0.y + (p3.y - prev.y) / 6 },
      p2: { x: p3.x - (next.x - p0.x) / 6, y: p3.y - (next.y - p0.y) / 6 },
      p3,
    });
  }

  const d =
    `M${pts[0].x} ${pts[0].y}` +
    segs.map((s) => ` C${s.p1.x} ${s.p1.y}, ${s.p2.x} ${s.p2.y}, ${s.p3.x} ${s.p3.y}`).join("");

  const at = (t: number): Pt => {
    if (segs.length === 0) return pts[0];
    const scaled = Math.max(0, Math.min(1, t)) * segs.length;
    const i = Math.min(segs.length - 1, Math.floor(scaled));
    const u = scaled - i;
    const { p0, p1, p2, p3 } = segs[i];
    const v = 1 - u;
    return {
      x: v ** 3 * p0.x + 3 * v ** 2 * u * p1.x + 3 * v * u ** 2 * p2.x + u ** 3 * p3.x,
      y: v ** 3 * p0.y + 3 * v ** 2 * u * p1.y + 3 * v * u ** 2 * p2.y + u ** 3 * p3.y,
    };
  };

  // Numeric arc length, so the dash animation and the dot agree.
  let length = 0;
  let last = at(0);
  for (let i = 1; i <= 120; i++) {
    const p = at(i / 120);
    length += Math.hypot(p.x - last.x, p.y - last.y);
    last = p;
  }

  return { d, at, length };
};
