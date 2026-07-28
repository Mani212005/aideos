import type { CanvasEdge, CanvasNode, Film, Shot } from "./schema";
import { easeExpo, MS } from "./motion";

/**
 * ---------------------------------------------------------------------------
 * DESIGN LANGUAGE — CAMERA & CONTINUITY
 * ---------------------------------------------------------------------------
 * Implements §06. This is the single decision that stops the output reading as
 * a deck: there is one canvas per film and it never resets. Every idea is a
 * node in real space, every relationship is a drawn edge, and a "scene" is just
 * where the camera is looking.
 *
 * Pure — no React, no Remotion imports — so the validator and the storyboard
 * generator can solve the same camera path in plain Node.
 */

export type Box = { x: number; y: number; w: number; h: number };

/** Camera state: what point is centred, and how many pixels a canvas unit is. */
export type Cam = { cx: number; cy: number; ppu: number };

export const nodeBox = (n: CanvasNode): Box => ({ x: n.x, y: n.y, w: n.w, h: n.h });

export const union = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const b = Math.max(...boxes.map((b2) => b2.y + b2.h));
  return { x, y, w: r - x, h: b - y };
};

/**
 * The connector between two nodes.
 *
 * Forward edges leave the right face and enter the left, bending through the
 * midpoint so the curve reads as a wire rather than an arrow. A backward edge
 * (target sits left of source) instead drops out of the bottom and loops under
 * everything — routing it straight would draw it *through* the nodes between.
 */
export const edgePath = (a: CanvasNode, b: CanvasNode): string => {
  const x1 = a.x + a.w;
  const y1 = a.y + a.h / 2;
  const x2 = b.x;
  const y2 = b.y + b.h / 2;

  if (x2 < x1) {
    const my = Math.max(y1, y2) + 60;
    const ax = a.x + a.w / 2;
    const bx = b.x + b.w / 2;
    return `M${ax} ${a.y + a.h} C${ax} ${my}, ${bx} ${my}, ${bx} ${b.y}`;
  }

  const mx = (x1 + x2) / 2;
  return `M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
};

/** Padding around whatever a shot is looking at, in canvas units. */
const PAD = 46;

/**
 * Solve a shot's framing from the nodes it names.
 *
 * Fit-to-box rather than authored coordinates is what makes rule 1 of §09 true:
 * reorder the script, move a node, and every shot re-frames itself. It is also
 * what makes the reel free — the same solve against a 9:16 frame naturally
 * gives a narrower camera on tight shots and pulls back far enough on the
 * payoff that the whole structure still fits. Neither format is authored twice.
 */
export const solveCam = (
  box: Box,
  frame: { width: number; height: number },
  zoom: number,
): Cam => {
  const ppu =
    Math.min(frame.width / (box.w + PAD * 2), frame.height / (box.h + PAD * 2)) * zoom;
  return { cx: box.x + box.w / 2, cy: box.y + box.h / 2, ppu };
};

export const lookBox = (film: Film, shot: Shot): Box => {
  const byId = new Map(film.canvas.nodes.map((n) => [n.id, n]));
  if (shot.look === "all") return union(film.canvas.nodes.map(nodeBox));
  const ids = Array.isArray(shot.look) ? shot.look : [shot.look];
  const boxes = ids.map((id) => byId.get(id)).filter((n): n is CanvasNode => Boolean(n)).map(nodeBox);
  // The schema rejects unknown ids, so an empty result here means an empty
  // canvas — fall back to the whole thing rather than dividing by zero.
  return boxes.length > 0 ? union(boxes) : union(film.canvas.nodes.map(nodeBox));
};

export type TimedShot = {
  shot: Shot;
  index: number;
  /** Frame this shot's move begins. */
  from: number;
  /** Frame the next shot begins. */
  to: number;
  durationInFrames: number;
  /** Which chapter this shot belongs to, derived from `cut` boundaries. */
  chapter: number;
};

/**
 * Lay the shots out on the timeline. Starts are computed, never authored, so
 * the whole class of "scene 7 starts 0.5s before scene 6 ends" bugs cannot
 * occur — that failure silently distorted every camera move in the old engine.
 */
export const buildTimeline = (film: Film): TimedShot[] => {
  let cursor = 0;
  let chapter = -1;
  return film.shots.map((shot, index) => {
    const durationInFrames = Math.round(shot.dur * film.fps);
    const from = cursor;
    cursor += durationInFrames;
    if (shot.move === "cut") chapter += 1;
    return {
      shot,
      index,
      from,
      to: cursor,
      durationInFrames,
      chapter: Math.max(0, chapter),
    };
  });
};

export const totalFrames = (timeline: TimedShot[]) =>
  timeline.length === 0 ? 1 : timeline[timeline.length - 1].to;

export const shotAt = (timeline: TimedShot[], frame: number): TimedShot => {
  for (const t of timeline) if (frame < t.to) return t;
  return timeline[timeline.length - 1];
};

/**
 * The camera at a given frame.
 *
 * Move, never cut: every station is reached by a 900ms travel on the expo
 * curve, and only an explicit `cut` (a chapter boundary) is allowed to jump.
 * Scale interpolates in log space — linear scale interpolation makes a zoom
 * start fast and crawl to a halt, which fights the curve doing the easing.
 */
export const camAt = (
  film: Film,
  timeline: TimedShot[],
  frame: number,
  frameSize: { width: number; height: number },
): Cam => {
  const current = shotAt(timeline, frame);
  const target = solveCam(lookBox(film, current.shot), frameSize, current.shot.zoom);

  const previous = current.index > 0 ? timeline[current.index - 1] : null;
  const moveFrames = (MS.move / 1000) * film.fps;

  let cam = target;
  if (previous && current.shot.move !== "cut" && frame < current.from + moveFrames) {
    const start = solveCam(lookBox(film, previous.shot), frameSize, previous.shot.zoom);
    const p = easeExpo((frame - current.from) / moveFrames);
    cam = {
      cx: start.cx + (target.cx - start.cx) * p,
      cy: start.cy + (target.cy - start.cy) * p,
      ppu: Math.exp(Math.log(start.ppu) + (Math.log(target.ppu) - Math.log(start.ppu)) * p),
    };
  }

  return cam;
};

/**
 * Which shot each node first becomes current in. Drives §06 rule 02: visited
 * nodes stay drawn and dim to muted, unvisited ones sit ghosted at 0.4. The
 * canvas accumulates; nothing is ever destroyed.
 */
export const nodeArrivals = (film: Film, timeline: TimedShot[]): Map<string, number> => {
  const arrivals = new Map<string, number>();
  timeline.forEach((t) => {
    const ids =
      t.shot.look === "all"
        ? film.canvas.nodes.map((n) => n.id)
        : Array.isArray(t.shot.look)
          ? t.shot.look
          : [t.shot.look];
    ids.forEach((id) => {
      if (!arrivals.has(id)) arrivals.set(id, t.from);
    });
  });
  return arrivals;
};

/** An edge arrives with its target — and draws 70ms before the node enters. */
export const edgeArrival = (edge: CanvasEdge, arrivals: Map<string, number>) =>
  arrivals.get(edge.to) ?? Infinity;

/** The transform that puts canvas space on screen. */
export const camTransform = (cam: Cam, frameSize: { width: number; height: number }) =>
  `translate(${frameSize.width / 2 - cam.cx * cam.ppu}px, ${
    frameSize.height / 2 - cam.cy * cam.ppu
  }px) scale(${cam.ppu})`;

/** Where a canvas box lands on screen under a given camera. */
export const projectBox = (
  box: Box,
  cam: Cam,
  frameSize: { width: number; height: number },
): Box => ({
  x: frameSize.width / 2 + (box.x - cam.cx) * cam.ppu,
  y: frameSize.height / 2 + (box.y - cam.cy) * cam.ppu,
  w: box.w * cam.ppu,
  h: box.h * cam.ppu,
});
