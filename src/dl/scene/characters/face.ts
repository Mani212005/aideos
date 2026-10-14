/**
 * File Description: Paints a character's face (skin, hairline, brows, eyes, mouth) into its head texture from spec parameters.
 * Inputs and outputs: 2D canvas context, face spec, palette and blended expression values -> painted face texture pixels.
 * Used by: scene/characters/build.ts setExpression; browser only (Node builds keep geometry without a face canvas).
 */
import type { ExpressionPreset, FaceSpec } from "../../characters/schema";

/** The slice of a 2D canvas context the painter uses; declared structurally so Node-side compiles need no DOM library. */
export interface FaceContext {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  save(): void;
  restore(): void;
  scale(x: number, y: number): void;
  translate(x: number, y: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(offset: number, color: string): void };
}
/** A canvas the face can be painted into (an HTMLCanvasElement in the browser). */
export interface FaceCanvas {
  width: number;
  height: number;
  getContext(contextId: "2d"): FaceContext | null;
}

/** Blended expression values in painter units: eye openness, brow tilt and raise, mouth curve and opening. */
export interface FaceValues { o: number; bt: number; br: number; mc: number; mo: number }

// Converts a named spec preset into painter units.
export const faceValues = (p: ExpressionPreset): FaceValues => ({ o: p.eyeOpen, bt: p.browTilt, br: p.browRaise, mc: p.mouthCurve, mo: p.mouthOpen });

// Formats a #rrggbb colour with an alpha as a CSS rgba() string.
function rgba(color: string, alpha: number): string {
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Draws the approved almond eye: lidded sclera, gradient iris, pupil, highlights, lash flick and crease.
function almondEye(c: FaceContext, face: FaceSpec, e: FaceValues, h: number): void {
  if (e.o < .4) { c.lineWidth = .016; c.beginPath(); c.moveTo(-.09, 0); c.bezierCurveTo(-.04, .055, .05, .06, .105, .01); c.stroke(); return; }
  const lo = .035 * Math.min(e.o, 1), up = () => { c.beginPath(); c.moveTo(-.09, 0); c.bezierCurveTo(-.05, h * 1.15, .05, h * 1.25, .105, .02); };
  up(); c.bezierCurveTo(.06, -lo, -.04, -lo, -.09, 0); c.save(); c.clip(); c.fillStyle = face.eyes.sclera; c.fillRect(-.1, -.1, .25, .2);
  const g = c.createLinearGradient(0, -.06, 0, .07); g.addColorStop(0, face.eyes.iris[0]); g.addColorStop(.5, face.eyes.iris[1]); g.addColorStop(1, face.eyes.iris[2]);
  c.fillStyle = g; c.beginPath(); c.ellipse(.015, 0, .047, .058, 0, 0, 7); c.fill();
  c.fillStyle = face.eyes.pupil; c.beginPath(); c.ellipse(.015, 0, .02, .027, 0, 0, 7); c.fill();
  c.fillStyle = "#fff"; c.beginPath(); c.arc(0, .022, .012, 0, 7); c.arc(.035, -.015, .006, 0, 7); c.fill(); c.restore();
  up(); c.lineWidth = .017; c.stroke(); c.beginPath(); c.moveTo(.105, .02); c.lineTo(.14, .045); c.lineWidth = .012; c.stroke();
  c.lineWidth = .005; c.globalAlpha = .6; c.beginPath(); c.moveTo(-.07, -.003); c.bezierCurveTo(-.03, -lo * 1.1, .05, -lo * 1.1, .1, .015); c.moveTo(-.06, h * 1.5 + .01); c.bezierCurveTo(0, h * 2 + .015, .06, h * 2 + .015, .1, .045); c.stroke(); c.globalAlpha = 1;
}

// Draws a large round mascot eye: outlined sclera, big gradient iris, pupil and two catch lights; closed reads as a smiling arc.
function roundEye(c: FaceContext, face: FaceSpec, e: FaceValues): void {
  if (e.o < .4) { c.lineWidth = .02; c.beginPath(); c.moveTo(-.07, -.01); c.quadraticCurveTo(0, .05, .07, -.01); c.stroke(); return; }
  const rx = .07, ry = .088 * Math.min(e.o, 1.25);
  c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, 7); c.fillStyle = face.eyes.sclera; c.fill();
  c.save(); c.clip();
  const g = c.createLinearGradient(0, ry, 0, -ry); g.addColorStop(0, face.eyes.iris[0]); g.addColorStop(.5, face.eyes.iris[1]); g.addColorStop(1, face.eyes.iris[2]);
  c.fillStyle = g; c.beginPath(); c.ellipse(.008, -.006, rx * .74, ry * .8, 0, 0, 7); c.fill();
  c.fillStyle = face.eyes.pupil; c.beginPath(); c.ellipse(.008, -.006, rx * .36, ry * .42, 0, 0, 7); c.fill();
  c.fillStyle = "#fff"; c.beginPath(); c.arc(-.016, ry * .36, .02, 0, 7); c.arc(.026, -ry * .3, .009, 0, 7); c.fill();
  c.restore();
  c.lineWidth = .014; c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, 7); c.stroke();
}

// Repaints the whole face for one expression without touching geometry, pose or camera.
export function paintFace(c: FaceContext, face: FaceSpec, palette: Readonly<Record<string, string>>, e: FaceValues): void {
  c.setTransform(face.size, 0, 0, -face.size, face.size / 2, face.size / 2); c.lineCap = c.lineJoin = "round";
  c.fillStyle = face.base; c.fillRect(-.5, -.5, 1, 1);
  c.fillStyle = palette[face.skin]; c.beginPath(); c.ellipse(face.oval[0], face.oval[1], face.oval[2], face.oval[3], 0, 0, 7); c.fill();
  if (face.ovalLine) { c.strokeStyle = rgba(face.ovalLine.color, face.ovalLine.alpha); c.lineWidth = face.ovalLine.width; c.stroke(); }
  if (face.blush) { c.fillStyle = rgba(face.blush.color, face.blush.alpha); for (const s of [-1, 1]) { c.beginPath(); c.ellipse(face.blush.at[0] * s, face.blush.at[1], face.blush.size[0], face.blush.size[1], 0, 0, 7); c.fill(); } }
  if (face.hairline) {
    c.fillStyle = palette[face.hairline.color]; c.beginPath();
    for (const cmd of face.hairline.path) {
      if (cmd[0] === "M") c.moveTo(cmd[1], cmd[2]);
      else if (cmd[0] === "L") c.lineTo(cmd[1], cmd[2]);
      else if (cmd[0] === "Q") c.quadraticCurveTo(cmd[1], cmd[2], cmd[3], cmd[4]);
      else c.bezierCurveTo(cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[6]);
    }
    c.fill();
  }
  const by = face.brows.y, [bx0, bx1, bx2] = face.brows.x;
  const h = .06 * e.o, yi = by + e.br - e.bt * .04, ya = by + e.br + .012, yo = by + e.br;
  for (const s of [-1, 1]) {
    c.save(); c.scale(s, 1); c.fillStyle = palette[face.brows.color];
    c.beginPath(); c.moveTo(bx0, yi - .012); c.quadraticCurveTo(bx1, ya + .03, bx2, yo); c.quadraticCurveTo(bx1, ya + .005, bx0, yi + .014); c.fill();
    c.translate(face.eyes.at[0], face.eyes.at[1]);
    if (face.eyes.scale !== 1) c.scale(face.eyes.scale, face.eyes.scale);
    c.strokeStyle = palette[face.eyes.line];
    if (face.eyes.style === "almond") almondEye(c, face, e, h); else roundEye(c, face, e);
    c.restore();
  }
  const k = face.mouth.scale, w = (e.mo ? .01 : e.bt > .3 ? .07 : .085) * k, yb = face.mouth.y;
  c.beginPath(); if (!e.mo) { c.moveTo(-w, yb + e.mc); c.quadraticCurveTo(0, yb - e.mc * 1.6, w, yb + e.mc); }
  if (e.mo) { c.ellipse(0, yb - .005, .043 * k, .047 * k, 0, 0, 7); c.fillStyle = face.mouth.inner; c.fill(); }
  c.lineWidth = e.bt > .3 ? .013 : .009; c.strokeStyle = face.mouth.line; c.stroke();
}
