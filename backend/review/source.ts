/**
 * File Description: Facts read from aideos film data for `aideos review`, where a film exists.
 * The camera comes from the film (the solved framing of each shot, or a scene's camera track), never
 * from pixels. Element-level carry-over and stage persistence come from what the film keeps on stage
 * across each beat boundary: for a node-graph film that is whether the canvas stays up, for a scene
 * film it is which opacity-driven elements stay visible. Also: node overlap on the canvas and the
 * times shots and animation clips start. Pure functions over a parsed Film.
 * Inputs and outputs: Film manifest -> FilmFacts on camera moves, node arrivals, and stage persistence.
 * Used by: backend/review/review.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { buildTimeline, lookBox, nodeBox, solveCam } from "../../src/dl/camera";
import { MS } from "../../src/dl/motion";
import { parseFilm, type Film } from "../../src/dl/schema";
import type { Scene } from "../../src/dl/scene/types";
import type { SvgAnimationClip } from "../../src/dl/scene/svgAnimation";
import { THRESHOLDS } from "./thresholds";

/** One camera move found in the film data. */
export interface CameraMove {
  t: number;
  /** Share of the frame width the framing travels. */
  shiftWidth: number;
  /** Zoom change as a ratio >= 1. */
  zoomRatio: number;
  /** Frame widths per second at the move's speed. */
  speed: number;
  note: string;
}

/** The film's camera as data. */
export interface CameraFacts {
  /** False when the film has no camera at all (a scene film without a camera track). */
  available: boolean;
  kind: "node-graph" | "scene-track" | "none";
  moves: CameraMove[];
  /** Moves that change the framing by too little to count. */
  driftOnly: number;
  maxSpeed: number;
}

/** What survives one beat boundary. */
export interface BoundaryCarry {
  t: number;
  /** Elements on stage just before the boundary. */
  outgoing: number;
  /** Of those, how many are still on stage just after. */
  kept: number;
  /** A kept element is also being transformed across the boundary. */
  transformed: number;
}

/** Facts read from film data. */
export interface FilmFacts {
  filmId: string;
  kind: "node-graph" | "scene";
  durationSec: number;
  fps: number;
  /** Seconds at which each shot after the first starts. */
  shotBoundaries: number[];
  shotDurations: number[];
  camera: CameraFacts;
  boundaries: BoundaryCarry[];
  /** Seconds at which scene animation clips start (empty for node-graph films). */
  clipStarts: number[];
  /** Canvas nodes whose boxes overlap, as "a / b". */
  nodeOverlaps: string[];
  voiceoverSec: number | null;
}

const FRAME = { width: 1920, height: 1080 };

// Reads a loosely shaped camera track from a scene (step 5 defines the real one): keyed frames with centre and zoom.
function sceneCameraMoves(scene: Scene, fps: number): CameraFacts {
  const raw = (scene as unknown as { camera?: unknown }).camera;
  const keys = (Array.isArray(raw) ? raw : (raw as { keys?: unknown; keyframes?: unknown } | undefined)?.keys ?? (raw as { keyframes?: unknown } | undefined)?.keyframes) as
    | Array<{ frame: number; x?: number; y?: number; cx?: number; cy?: number; zoom?: number; scale?: number }>
    | undefined;
  if (!Array.isArray(keys) || keys.length < 2) return { available: false, kind: "none", moves: [], driftOnly: 0, maxSpeed: 0 };
  const windowWidth = FRAME.width;
  const moves: CameraMove[] = [];
  let driftOnly = 0;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    const dx = (b.x ?? b.cx ?? 0) - (a.x ?? a.cx ?? 0);
    const dy = (b.y ?? b.cy ?? 0) - (a.y ?? a.cy ?? 0);
    const shiftWidth = Math.hypot(dx, dy) / windowWidth;
    const za = a.zoom ?? a.scale ?? 1;
    const zb = b.zoom ?? b.scale ?? 1;
    const zoomRatio = Math.max(za / zb, zb / za);
    const dur = Math.max(1 / fps, (b.frame - a.frame) / fps);
    if (shiftWidth >= THRESHOLDS.camera.minShiftWidth || zoomRatio >= THRESHOLDS.camera.minZoomRatio) {
      moves.push({ t: a.frame / fps, shiftWidth, zoomRatio, speed: Math.max(shiftWidth, Math.log(zoomRatio)) / dur, note: "scene camera track" });
    } else driftOnly++;
  }
  return { available: true, kind: "scene-track", moves, driftOnly, maxSpeed: Math.max(0, ...moves.map((m) => m.speed)) };
}

// Solves the framing of every shot of a node-graph film and lists the moves between them.
function nodeGraphCamera(film: Film, voiceSec: number | null): { camera: CameraFacts; starts: number[]; durations: number[] } {
  const timeline = buildTimeline(film, voiceSec ?? undefined);
  const fps = film.fps;
  const moves: CameraMove[] = [];
  let driftOnly = 0;
  let prev: ReturnType<typeof solveCam> | null = null;
  const starts: number[] = [];
  timeline.forEach((timed, i) => {
    const shot = timed.shot;
    const cam = solveCam(lookBox(film, shot), FRAME, shot.zoom);
    if (i > 0) starts.push(timed.from / fps);
    // A cut or a stage-framing shot jumps; only pan and zoom moves travel the camera.
    const travels = i > 0 && prev && shot.move !== "cut" && shot.move !== "hold" && shot.stage !== "frame";
    if (travels && prev) {
      const shiftWidth = (Math.hypot(cam.cx - prev.cx, cam.cy - prev.cy) * ((cam.ppu + prev.ppu) / 2)) / FRAME.width;
      const zoomRatio = Math.max(cam.ppu / prev.ppu, prev.ppu / cam.ppu);
      if (shiftWidth >= THRESHOLDS.camera.minShiftWidth || zoomRatio >= THRESHOLDS.camera.minZoomRatio) {
        const moveSec = MS.move / 1000;
        moves.push({ t: timed.from / fps, shiftWidth, zoomRatio, speed: Math.max(shiftWidth, Math.log(zoomRatio)) / moveSec, note: `shot ${shot.id}: ${shot.move}` });
      } else driftOnly++;
    }
    prev = cam;
  });
  const durations = timeline.map((t) => (t.to - t.from) / fps);
  return { camera: { available: true, kind: "node-graph", moves, driftOnly, maxSpeed: Math.max(0, ...moves.map((m) => m.speed)) }, starts, durations };
}

// The opacity a target holds at a frame from its ordered opacity clips (1 before any clip touches it).
function opacityAt(clips: Array<{ start: number; end: number; from: number; to: number }>, frame: number): number {
  let value = 1;
  for (const c of clips) {
    if (c.start > frame) break;
    value = frame >= c.end ? c.to : c.from + ((c.to - c.from) * (frame - c.start)) / Math.max(1, c.end - c.start);
  }
  return value;
}

// Per boundary, which opacity-driven scene elements stay on stage and which of those are being transformed.
function sceneBoundaries(scene: Scene, boundaryFrames: number[], fps: number): { carry: BoundaryCarry[]; clipStarts: number[] } {
  const assets = [...(scene.background ? [scene.background] : []), ...(scene.props ?? [])];
  const opacity = new Map<string, Array<{ start: number; end: number; from: number; to: number }>>();
  const transforms = new Map<string, Array<{ start: number; end: number }>>();
  const clipStarts = new Set<number>();
  for (const asset of assets) {
    for (const clip of (asset.animation?.clips ?? []) as SvgAnimationClip[]) {
      clip.targets.forEach((target, k) => {
        const start = clip.startFrame + (clip.staggerFrames ?? 0) * k;
        const key = `${asset.assetId}::${target}`;
        if (k === 0) clipStarts.add(clip.startFrame);
        if (clip.property === "opacity") {
          opacity.set(key, [...(opacity.get(key) ?? []), { start, end: start + clip.durationFrames, from: clip.from, to: clip.to }]);
        } else if (clip.property !== "drawOn") {
          transforms.set(key, [...(transforms.get(key) ?? []), { start, end: start + clip.durationFrames }]);
        }
      });
    }
  }
  for (const list of opacity.values()) list.sort((a, b) => a.start - b.start);
  const after = Math.round(0.5 * fps);
  const around = Math.round(1.5 * fps);
  const carry = boundaryFrames.map((b) => {
    const outgoing = [...opacity.keys()].filter((k) => opacityAt(opacity.get(k)!, b - 1) > 0.05);
    const keptKeys = outgoing.filter((k) => opacityAt(opacity.get(k)!, b + after) > 0.05);
    const transformed = keptKeys.filter((k) => (transforms.get(k) ?? []).some((c) => c.end >= b - after && c.start <= b + around));
    return { t: b / fps, outgoing: outgoing.length, kept: keptKeys.length, transformed: transformed.length };
  });
  return { carry, clipStarts: [...clipStarts].sort((a, b) => a - b).map((f) => f / fps) };
}

// Overlapping canvas node boxes of a node-graph film.
function overlappingNodes(film: Film): string[] {
  const boxes = film.canvas.nodes.map((n) => ({ id: n.id, ...nodeBox(n) }));
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(`${a.id} / ${b.id}`);
    }
  }
  return out;
}

// Reads every film-data fact the review uses from a parsed film.
export function readFilmFacts(film: Film): FilmFacts {
  const fps = film.fps;
  const voiceoverSec = film.voiceover?.durationSec ?? null;
  const durations = film.shots.map((s) => s.dur);
  const total = durations.reduce((a, b) => a + b, 0);
  const scene = film.scene as Scene | undefined;
  const shotBoundaries: number[] = [];
  let acc = 0;
  durations.slice(0, -1).forEach((d) => {
    acc += d;
    shotBoundaries.push(acc);
  });
  if (scene) {
    const boundaryFrames = shotBoundaries.map((t) => Math.round(t * fps));
    const { carry, clipStarts } = sceneBoundaries(scene, boundaryFrames, fps);
    return { filmId: film.id, kind: "scene", durationSec: total, fps, shotBoundaries, shotDurations: durations, camera: sceneCameraMoves(scene, fps), boundaries: carry, clipStarts, nodeOverlaps: [], voiceoverSec };
  }
  const { camera, starts, durations: timedDurations } = nodeGraphCamera(film, voiceoverSec);
  // A node-graph film keeps its canvas up while consecutive shots are anchored on it; a framed or spine shot closes it.
  const anchored = film.shots.map((s) => s.stage === "anchor");
  const boundaries: BoundaryCarry[] = starts.map((t, i) => {
    const outgoing = anchored[i] ? film.canvas.nodes.length : 0;
    const kept = anchored[i] && anchored[i + 1] ? outgoing : 0;
    const moved = camera.moves.some((m) => Math.abs(m.t - t) < 0.01);
    return { t, outgoing, kept, transformed: kept && moved ? kept : 0 };
  });
  return { filmId: film.id, kind: "node-graph", durationSec: timedDurations.reduce((a, b) => a + b, 0), fps, shotBoundaries: starts, shotDurations: timedDurations, camera, boundaries, clipStarts: [], nodeOverlaps: overlappingNodes(film), voiceoverSec };
}

// Loads and parses a film.json, returning the facts and the parsed film.
export function loadFilmFacts(filmJson: string): { film: Film; facts: FilmFacts } {
  const film = parseFilm(JSON.parse(fs.readFileSync(filmJson, "utf8")));
  return { film, facts: readFilmFacts(film) };
}

// Resolves a file next to a film's folder (voiceover words), or null when it is not there.
export function siblingFile(filmJson: string, name: string): string | null {
  const p = path.join(path.dirname(filmJson), name);
  return fs.existsSync(p) ? p : null;
}
