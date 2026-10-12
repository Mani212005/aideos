/**
 * File Description: Facts read from aideos film data for `aideos review`, where a film exists.
 * The camera comes from the film (the solved framing of each shot, or a scene's camera track), never
 * from pixels. Element-level carry-over and stage persistence come from what the film keeps on stage
 * across each beat boundary: for a node-graph film that is whether the canvas stays up, for a scene
 * film it is which opacity-driven elements stay visible. Also: node overlap on the canvas and the
 * times shots and animation clips start. Pure functions over a parsed Film.
 * Inputs and outputs: Film manifest and optional look plan -> FilmFacts on camera moves, node arrivals, stage persistence, and plan adherence.
 * Used by: backend/review/review.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { buildTimeline, lookBox, nodeBox, solveCam } from "../../src/dl/camera";
import { MS } from "../../src/dl/motion";
import { parseFilm, type Film } from "../../src/dl/schema";
import type { Scene } from "../../src/dl/scene/types";
import type { SvgAnimationClip } from "../../src/dl/scene/svgAnimation";
import type { LookPlan } from "../lookPlan/schema";
import { safeParseLookPlan } from "../lookPlan/schema";
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
  /** Optional plan loaded beside film.json for the non-gating plan-adherence criterion. */
  lookPlan?: LookPlan | null;
  /** Per-shot stage and scene motion facts used to compare the rendered design with its plan. */
  planShots?: Array<{
    id: string;
    startSec: number;
    endSec: number;
    stage: string;
    visibleAtStart: string[];
    visibleAtEnd: string[];
    motions: Array<{ castId: string; startSec: number }>;
  }>;
  /** Scene camera keyframe times in film seconds. */
  cameraKeyframes?: number[];
}

const FRAME = { width: 1920, height: 1080 };

// Reads a loosely shaped camera track from a scene (step 5 defines the real one): keyed frames with centre and zoom.
function sceneCameraMoves(scene: Scene, fps: number): CameraFacts {
  const raw = (scene as unknown as { camera?: unknown }).camera;
  const keys = (Array.isArray(raw) ? raw : (raw as { keys?: unknown; keyframes?: unknown } | undefined)?.keys ?? (raw as { keyframes?: unknown } | undefined)?.keyframes) as
    | Array<{ frame: number; center?: { x?: number; y?: number }; x?: number; y?: number; cx?: number; cy?: number; zoom?: number; scale?: number }>
    | undefined;
  if (!Array.isArray(keys) || keys.length < 2) return { available: false, kind: "none", moves: [], driftOnly: 0, maxSpeed: 0 };
  const sceneWidth = (scene as { sceneSize?: { w?: unknown } }).sceneSize?.w;
  const windowWidth = typeof sceneWidth === "number" && sceneWidth > 0 ? sceneWidth : FRAME.width;
  const moves: CameraMove[] = [];
  let driftOnly = 0;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    const ax = a.center?.x ?? a.x ?? a.cx ?? 0;
    const ay = a.center?.y ?? a.y ?? a.cy ?? 0;
    const bx = b.center?.x ?? b.x ?? b.cx ?? 0;
    const by = b.center?.y ?? b.y ?? b.cy ?? 0;
    const dx = bx - ax;
    const dy = by - ay;
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

// Finds the scene-frame time where a keyframed track first changes value.
function changingTrackStarts(tracks: Array<{ trackId?: string; keyframes: Array<{ frame: number; value: number }> }> | undefined, fromFrame: number, toFrame: number): number[] {
  const starts: number[] = [];
  for (const track of tracks ?? []) {
    if (track.trackId === "opacity") continue;
    for (let index = 1; index < track.keyframes.length; index++) {
      const previous = track.keyframes[index - 1];
      const current = track.keyframes[index];
      if (previous.value !== current.value && previous.frame >= fromFrame && previous.frame < toFrame && current.frame >= fromFrame) starts.push(previous.frame);
    }
  }
  return starts;
}

// Reads the opacity of a scene asset at a frame, honoring its explicit opacity track.
function sceneAssetOpacityAt(asset: Scene["background"], frame: number): number {
  const track = asset.tracks?.find((candidate) => candidate.trackId === "opacity");
  if (!track?.keyframes.length) return asset.opacity;
  const nextIndex = track.keyframes.findIndex((keyframe) => keyframe.frame >= frame);
  if (nextIndex === -1) return track.keyframes[track.keyframes.length - 1].value;
  const next = track.keyframes[nextIndex];
  if (nextIndex === 0) return next.value;
  const previous = track.keyframes[nextIndex - 1];
  const progress = (frame - previous.frame) / Math.max(1, next.frame - previous.frame);
  return previous.value + (next.value - previous.value) * progress;
}

// Reads one animated SVG target's opacity at a scene frame.
function sceneTargetOpacityAt(asset: Scene["background"], target: string, frame: number): number {
  const clips: Array<{ start: number; duration: number; from: number; to: number }> = [];
  for (const clip of asset.animation?.clips ?? []) {
    if (clip.property !== "opacity") continue;
    const targetIndex = clip.targets.indexOf(target);
    if (targetIndex < 0) continue;
    const start = clip.startFrame + (clip.staggerFrames ?? 0) * targetIndex;
    clips.push({ start, duration: clip.durationFrames, from: clip.from, to: clip.to });
  }
  if (!clips.length) return 1;
  clips.sort((a, b) => a.start - b.start);
  if (frame < clips[0].start) return clips[0].from;
  let governing = clips[0];
  for (const clip of clips) {
    if (clip.start <= frame) governing = clip;
  }
  if (frame >= governing.start + governing.duration) return governing.to;
  const progress = Math.min(1, Math.max(0, (frame - governing.start) / Math.max(1, governing.duration)));
  return governing.from + (governing.to - governing.from) * progress;
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

// The opacity a target holds at a frame from its ordered opacity clips (first clip's start value before any clip touches it).
function opacityAt(clips: Array<{ start: number; end: number; from: number; to: number }>, frame: number): number {
  if (!clips.length) return 1;
  if (frame < clips[0].start) return clips[0].from;
  let value = clips[0].from;
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
    const assets = [...(scene.background ? [scene.background] : []), ...(scene.props ?? [])];
    let shotStart = 0;
    const planShots = film.shots.map((shot, index) => {
      const startSec = shotStart;
      const endSec = startSec + durations[index];
      shotStart = endSec;
      const startFrame = Math.round(startSec * fps);
      const endFrame = Math.round(endSec * fps);
      // Lists visible asset, SVG target, and actor ids at one scene frame.
      const visibleFor = (frame: number) => {
        const visibleFromAssets = assets.flatMap((asset) => {
          if (sceneAssetOpacityAt(asset, frame) <= THRESHOLDS.planAdherence.visibleOpacityMin) return [];
          const targets = [...new Set((asset.animation?.clips ?? []).flatMap((clip) => clip.targets))];
          const visibleTargets = targets.filter((target) => sceneTargetOpacityAt(asset, target, frame) > THRESHOLDS.planAdherence.visibleOpacityMin);
          return targets.length > 0 && visibleTargets.length === 0 ? visibleTargets : [asset.assetId, ...visibleTargets];
        });
        const visibleActors = (scene.actors ?? []).map((actor) => actor.instanceId);
        return [...visibleFromAssets, ...visibleActors];
      };
      const visibleAtStart = visibleFor(startFrame);
      const visibleAtEnd = visibleFor(Math.max(startFrame, endFrame - 1));
      const motions = assets.flatMap((asset) => {
        const castIds = [asset.assetId, ...(asset.animation?.clips ?? []).flatMap((clip) => clip.targets)];
        const clipMotions = (asset.animation?.clips ?? [])
          .filter((clip) => clip.property !== "opacity" && clip.from !== clip.to)
          .flatMap((clip) => [asset.assetId, ...clip.targets].map((castId) => ({ castId, frame: clip.startFrame })));
        const assetTrackMotions = changingTrackStarts(asset.tracks?.filter((track) => ["x", "y", "scale", "rotation"].includes(track.trackId)) ?? [], startFrame, endFrame)
          .flatMap((frame) => castIds.map((castId) => ({ castId, frame })));
        return [...clipMotions, ...assetTrackMotions]
          .filter((motion) => motion.frame >= startFrame && motion.frame < endFrame)
          .map((motion) => ({ castId: motion.castId, startSec: motion.frame / fps }));
      });
      const actorMotions = (scene.actors ?? []).flatMap((actor) => changingTrackStarts([
        ...(actor.positionTracks ?? []), ...Object.values(actor.jointTracks ?? {}),
      ], startFrame, endFrame).filter((frame) => frame >= startFrame && frame < endFrame).map((frame) => ({ castId: actor.instanceId, startSec: frame / fps })));
      return { id: shot.id, startSec, endSec, stage: shot.stage, visibleAtStart, visibleAtEnd, motions: [...motions, ...actorMotions] };
    });
    const rawCam = scene.camera as { keys?: unknown; keyframes?: unknown } | unknown[] | undefined;
    const keyList = (Array.isArray(rawCam) ? rawCam : rawCam?.keyframes ?? rawCam?.keys) as Array<{ frame: number }> | undefined;
    const cameraKeyframes = Array.isArray(keyList) ? keyList.map((keyframe) => keyframe.frame / fps) : [];
    return { filmId: film.id, kind: "scene", durationSec: total, fps, shotBoundaries, shotDurations: durations, camera: sceneCameraMoves(scene, fps), boundaries: carry, clipStarts, nodeOverlaps: [], voiceoverSec, planShots, cameraKeyframes };
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
  const facts = readFilmFacts(film);
  const lookPath = path.join(path.dirname(filmJson), "design", "look.json");
  if (fs.existsSync(lookPath)) {
    try {
      const parsed = safeParseLookPlan(JSON.parse(fs.readFileSync(lookPath, "utf8")));
      facts.lookPlan = parsed.success ? parsed.data : null;
    } catch {
      facts.lookPlan = null;
    }
  }
  return { film, facts };
}

// Resolves a file next to a film's folder (voiceover words), or null when it is not there.
export function siblingFile(filmJson: string, name: string): string | null {
  const p = path.join(path.dirname(filmJson), name);
  return fs.existsSync(p) ? p : null;
}
