/**
 * File Description: The design check - one pass that enforces the standard layer on any film.
 * However a film's design was made (hand-written builder, connected coding agent, server model or
 * templates), it has to pass this before it ships. Each finding names the rule, where it is, and
 * what to change, so an agent can be handed the report verbatim and repair its own design.
 * Rules: schema, scene engine validity, static self-contained artwork, palette, typography,
 * continuity (no motion snaps while visible, one origin per element), camera (speed limits,
 * move-then-hold pacing, cue landing, and subject focus framing), carry-over change holds,
 * audio lock, honest on-screen data, and a clear inset region while a device shot shares the stage.
 * Inputs and outputs: Film or Scene data -> standard-layer design rule violations and warnings.
 * Used by: backend/cli.ts, backend/pipeline/run.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { parseFilm, type Film } from "../../src/dl/schema";
import type { EnvironmentAsset, Scene } from "../../src/dl/scene/types";
import type { SvgAnimationClip } from "../../src/dl/scene/svgAnimation";
import {
  compileCameraTrack,
  measureCameraMotion,
  CAMERA_CUE_LANDING_TOLERANCE_SECONDS,
  MIN_CAMERA_HOLD_SHARE,
  MAX_CAMERA_CONTINUOUS_MOVE_SECONDS,
} from "../../src/dl/scene/cameraTrack";
import { parseSvgDocument, walkSvgNodes } from "../../src/dl/scene/svgDocument";
import { validateSceneWithNodeAssets } from "../../src/dl/scene/validateSceneNode";
import { narrationSupportsVisual, numbersIn } from "../shotVisualCues";
import type { ShotVisual } from "../jev";
import { resolvePackageDir, resolveRepoAssetPath } from "../../src/dl/videoPackageLoader";
import { checkInsetRegions } from "./insetRegion";
import { safeParseLookPlan, type LookPlan } from "../lookPlan/schema";
import { createCues, FPS, CAPTION_SAFE_SQUARE } from "../sceneKit";
import { narrationTimingForFilm, type TimedWord } from "../designSpec/compile";
import { resolveCue } from "../designSpec/cues";
import { checkThreeStage } from "./threeStage";

/** The standard layer rules a finding can belong to. */
export type DesignRule =
  | "schema"
  | "scene"
  | "camera"
  | "static-art"
  | "palette"
  | "typography"
  | "continuity"
  | "origin"
  | "audio-lock"
  | "honest-data"
  | "safe-area"
  | "inset"
  | "carry-over"
  | "occlusion";

/** One problem found in a film's design. Errors block shipping; warnings are worth a look. */
export interface DesignFinding {
  rule: DesignRule;
  severity: "error" | "warning";
  where: string;
  message: string;
}

/** The result of checking one film. */
export interface DesignReport {
  filmId: string;
  ok: boolean;
  findings: DesignFinding[];
  stats: { shots: number; assets: number; clips: number };
}

/** Optional approved look data used to check authored camera and carry-over intent. */
export interface DesignCheckContext {
  lookPlan?: LookPlan;
  cameraTargets?: Array<{ frame: number; focus?: string; authoredFocus?: string }>;
}

/** The locked design-system palette (src/dl/README.md); a film may add its own accent. */
export const LOCKED_PALETTE = ["#0A0A0B", "#F5F5F5", "#8A8A8E", "#635BFF", "#101013"] as const;

/** Typefaces the design system allows. */
const ALLOWED_FONTS = /^(geist|jetbrains mono)$/i;

/** Elements that would make an asset animate itself or reach outside the package. */
const FORBIDDEN_TAGS = new Set(["script", "animate", "animateTransform", "animateMotion", "foreignObject", "set"]);

const REPO_ROOT = path.resolve(__dirname, "../..");

// Converts a #rgb or #rrggbb literal to its channels.
function hexChannels(hex: string): [number, number, number] {
  const full = hex.length === 4 ? `#${hex.slice(1).split("").map((c) => c + c).join("")}` : hex;
  const n = parseInt(full.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// True for greys, black and white, allowing a few units of tint (shadows, scrims, surfaces).
function isNeutral([r, g, b]: [number, number, number]): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) <= 4;
}

// Lists every chromatic colour in an asset that is neither in the palette nor the film's accent.
export function offPaletteColours(svgText: string, accent?: string): string[] {
  const allowed = [...LOCKED_PALETTE, ...(accent ? [accent] : [])].map((h) => hexChannels(h.toUpperCase()).join(","));
  const found = new Set<string>();
  const consider = (literal: string, rgb: [number, number, number]) => {
    if (isNeutral(rgb) || allowed.includes(rgb.join(","))) return;
    found.add(literal);
  };
  for (const m of svgText.matchAll(/#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g)) consider(m[0], hexChannels(m[0]));
  for (const m of svgText.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)[^)]*\)/g)) {
    consider(m[0], [Number(m[1]), Number(m[2]), Number(m[3])]);
  }
  return [...found];
}

// Checks one asset document is static, self-contained, on palette and in the allowed typefaces.
function checkAsset(asset: EnvironmentAsset, accent: string | undefined, findings: DesignFinding[]): void {
  if (!asset.svgSource) return;
  const file = resolveRepoAssetPath(asset.svgSource);
  if (!fs.existsSync(file)) return; // The scene rule already reports a missing file.
  const text = fs.readFileSync(file, "utf8");
  const where = asset.svgSource;
  let doc;
  try {
    doc = parseSvgDocument(text);
  } catch {
    return; // The scene rule already reports an unparseable file.
  }
  const forbidden = new Set<string>();
  walkSvgNodes(doc, (node) => {
    if (FORBIDDEN_TAGS.has(node.tag)) forbidden.add(node.tag);
    for (const [name, value] of Object.entries(node.attrs)) {
      if ((name === "href" || name === "xlink:href" || name === "src") && /^(https?:|\/\/)/i.test(value)) {
        findings.push({ rule: "static-art", severity: "error", where, message: `<${node.tag}> loads "${value}" from outside the package; embed it instead.` });
      }
      if (name === "style" && /(transition|animation)\s*:/i.test(value)) {
        findings.push({ rule: "static-art", severity: "error", where, message: `<${node.tag}> declares CSS motion; move it into an animation clip.` });
      }
      if (name === "font-family" || (name === "style" && /font-family/i.test(value))) {
        const family = (name === "style" ? value.replace(/.*font-family\s*:\s*([^;]+).*/i, "$1") : value).split(",")[0].replace(/["']/g, "").trim();
        if (family && !ALLOWED_FONTS.test(family)) {
          findings.push({ rule: "typography", severity: "error", where, message: `uses the typeface "${family}"; only Geist and JetBrains Mono are allowed.` });
        }
      }
    }
  });
  for (const tag of forbidden) {
    findings.push({ rule: "static-art", severity: "error", where, message: `contains <${tag}>; assets are static and motion is authored as clips.` });
  }
  const off = offPaletteColours(text, accent);
  if (off.length) {
    findings.push({ rule: "palette", severity: "error", where, message: `uses colours outside the palette and the film accent: ${off.slice(0, 6).join(", ")}${off.length > 6 ? ", ..." : ""}.` });
  }
}

/** One target's view of a clip, with the stagger already applied. */
interface TargetClip {
  clipId: string;
  start: number;
  end: number;
  from: number;
  to: number;
}

// The state slots a property writes, which is the granularity continuity is checked at.
function slotsFor(property: string): string[] {
  return property === "scale" ? ["scaleX", "scaleY"] : [property];
}

// The value an element holds before any clip touches it.
function restValue(slot: string): number {
  return slot === "scaleX" || slot === "scaleY" || slot === "opacity" || slot === "drawOn" ? 1 : 0;
}

// Splits a timeline's clips into per-target, per-slot sequences ordered by start frame.
function perTargetSlots(clips: SvgAnimationClip[]): Map<string, TargetClip[]> {
  const out = new Map<string, TargetClip[]>();
  for (const clip of clips) {
    clip.targets.forEach((target, k) => {
      const start = clip.startFrame + (clip.staggerFrames ?? 0) * k;
      for (const slot of slotsFor(clip.property)) {
        const key = `${target}::${slot}`;
        const list = out.get(key) ?? [];
        list.push({ clipId: clip.clipId, start, end: start + clip.durationFrames, from: clip.from, to: clip.to });
        out.set(key, list);
      }
    });
  }
  for (const list of out.values()) list.sort((a, b) => a.start - b.start);
  return out;
}

// The value a slot holds at a frame, from its ordered clips (linear inside a clip is close enough here).
function valueAt(list: TargetClip[] | undefined, slot: string, frame: number): number {
  let value = restValue(slot);
  for (const c of list ?? []) {
    if (c.start > frame) break;
    value = frame >= c.end ? c.to : c.from + ((c.to - c.from) * (frame - c.start)) / Math.max(1, c.end - c.start);
  }
  return value;
}

// Checks every animated element for snaps (a clip not starting where the last one left the value,
// while the element is visible) and for more than one transform origin.
function checkContinuity(asset: EnvironmentAsset, findings: DesignFinding[]): number {
  const clips = asset.animation?.clips ?? [];
  const slots = perTargetSlots(clips);
  for (const [key, list] of slots) {
    const [target, slot] = key.split("::");
    // Opacity may cut: an element popping in or out is an authored appearance, not a glitch.
    if (slot === "opacity") continue;
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      if (Math.abs(prev.to - cur.from) <= 1e-6) continue;
      // A jump the viewer cannot see is fine: the element is fully transparent on the frame
      // before the jump (it reappears already in place) or on the jump frame itself.
      const opacityClips = slots.get(`${target}::opacity`);
      const opacity = Math.min(valueAt(opacityClips, "opacity", cur.start - 1), valueAt(opacityClips, "opacity", cur.start));
      if (opacity <= 0.001) continue;
      findings.push({
        rule: "continuity",
        severity: "error",
        where: `${asset.assetId} / ${target}`,
        message: `"${cur.clipId}" starts ${slot} at ${cur.from} but "${prev.clipId}" left it at ${prev.to}: a visible snap at frame ${cur.start}. Start from ${prev.to}, or hide the element first.`,
      });
    }
  }
  const origins = new Map<string, { clipId: string; key: string }>();
  for (const clip of clips) {
    if (!clip.origin) continue;
    const key = `${clip.origin.x},${clip.origin.y}`;
    for (const target of clip.targets) {
      const seen = origins.get(target);
      if (seen && seen.key !== key) {
        findings.push({
          rule: "origin",
          severity: "error",
          where: `${asset.assetId} / ${target}`,
          message: `"${clip.clipId}" uses origin (${key}) but "${seen.clipId}" uses (${seen.key}); the compiler applies one origin to every frame, so give the element a single origin.`,
        });
      } else if (!seen) {
        origins.set(target, { clipId: clip.clipId, key });
      }
    }
  }
  return clips.length;
}

// Checks the film's picture is locked to its narration: shot durations, scene length and voiceover agree.
function checkAudioLock(film: Film, findings: DesignFinding[]): void {
  const fps = film.fps ?? FPS;
  const shotFrames = Math.round(film.shots.reduce((sum, s) => sum + s.dur, 0) * fps);
  const scene = film.scene as Scene | undefined;
  if (scene && Math.abs(scene.durationFrames - shotFrames) > 2) {
    findings.push({ rule: "audio-lock", severity: "error", where: "scene", message: `scene runs ${scene.durationFrames} frames but the shots add up to ${shotFrames}; derive both from the measured narration.` });
  }
  // Unnarrated shots at the very end (an editor's closing footage) play after the voice has
  // finished, so they do not unlock anything: the narration is compared with the shots before them.
  let tail = film.shots.length;
  while (tail > 0 && !film.shots[tail - 1].scriptText?.trim()) tail -= 1;
  // A film that records no narration text on any shot has no tail to tell apart.
  if (tail === 0) tail = film.shots.length;
  const tailFrames = Math.round(film.shots.slice(tail).reduce((sum, s) => sum + s.dur, 0) * fps);
  const narratedFrames = shotFrames - tailFrames;
  const vo = film.voiceover?.durationSec;
  if (vo && Math.abs(vo * fps - narratedFrames) > fps) {
    findings.push({ rule: "audio-lock", severity: "error", where: "voiceover", message: `voiceover is ${vo.toFixed(2)}s but the narrated shots last ${(narratedFrames / fps).toFixed(2)}s.` });
  }
  if (vo && tailFrames > 0) {
    findings.push({ rule: "audio-lock", severity: "warning", where: "voiceover", message: `${(tailFrames / fps).toFixed(1)}s of unnarrated shots play after the voiceover ends (${film.shots.slice(tail).map((s) => s.id).join(", ")}).` });
  }
  if (!film.voiceover) {
    findings.push({ rule: "audio-lock", severity: "warning", where: "voiceover", message: "the film has no voiceover yet, so nothing is audio-locked." });
  }
  for (const shot of film.shots) {
    if (!shot.scriptText?.trim()) {
      findings.push({ rule: "audio-lock", severity: "warning", where: `shot ${shot.id}`, message: "carries no narration; every shot should depict what is being said." });
    }
  }
}

// Checks every data device on screen is backed by the shot's own narration. A counter's number
// must actually be spoken (an error: it is a precise claim); whether a chart's kind matches the
// narration is a keyword heuristic, so a mismatch is only a warning worth a look.
function checkHonestData(film: Film, findings: DesignFinding[]): void {
  const devices = ["TokenStrip", "Plot", "MatrixGrid", "Distribution", "LayerStack", "ScaleBar"];
  for (const shot of film.shots) {
    const narration = shot.scriptText ?? "";
    const blocks = shot.blocks as Array<{ c: string; to?: number }>;
    const hasData = blocks.some((b) => b.c === "StatCounter" || devices.includes(b.c));
    if (hasData && !narration.trim()) {
      findings.push({ rule: "honest-data", severity: "warning", where: `shot ${shot.id}`, message: "shows data but carries no narration, so it cannot be checked against what is said." });
      continue;
    }
    for (const block of blocks) {
      if (block.c === "StatCounter") {
        const spoken = numbersIn(narration);
        if (typeof block.to === "number" && !spoken.includes(block.to)) {
          findings.push({
            rule: "honest-data",
            severity: "error",
            where: `shot ${shot.id}`,
            message: `StatCounter shows ${block.to} but the narration ${spoken.length ? `only says ${spoken.join(", ")}` : "states no number"}.`,
          });
        }
      } else if (devices.includes(block.c) && !narrationSupportsVisual(block.c as ShotVisual, narration)) {
        findings.push({ rule: "honest-data", severity: "warning", where: `shot ${shot.id}`, message: `${block.c} may assert data the narration does not talk about; check its labels and values are said.` });
      }
    }
  }
}

/** Largest zoom change allowed in a single frame, as a fraction of the zoom (0.8% a frame is about 24% a second at 30 fps). */
export const MAX_CAMERA_ZOOM_STEP = 0.008;
/** Largest pan acceleration allowed, as a fraction of the scene width per second squared (a stop-and-burst move is several times this). */
export const MAX_CAMERA_PAN_ACCEL_WIDTHS = 0.3;

// Resolves the scene-space position of a prop or animated element at a given frame, accounting for translations.
function objectPositionAt(prop: EnvironmentAsset, targetId: string | undefined, frame: number): { x: number; y: number } {
  const clips = prop.animation?.clips ?? [];
  if (!clips.length) return { x: prop.position.x, y: prop.position.y };
  const slots = perTargetSlots(clips);
  const target = targetId && (slots.has(`${targetId}::translateX`) || slots.has(`${targetId}::translateY`))
    ? targetId
    : (clips.flatMap((c) => c.targets).find((t) => slots.has(`${t}::translateX`) || slots.has(`${t}::translateY`)) ?? targetId);
  const scale = prop.scale ?? 1;
  const dx = target ? valueAt(slots.get(`${target}::translateX`), "translateX", frame) : 0;
  const dy = target ? valueAt(slots.get(`${target}::translateY`), "translateY", frame) : 0;
  return {
    x: prop.position.x + dx * scale,
    y: prop.position.y + dy * scale,
  };
}

// Checks the scene camera keyframes for valid speed limits and motion.
function checkCamera(scene: Scene, findings: DesignFinding[], targets: DesignCheckContext["cameraTargets"] = []): void {
  if (!scene.camera || !scene.camera.keyframes || scene.camera.keyframes.length === 0) return;
  const kfs = [...scene.camera.keyframes].sort((a, b) => a.frame - b.frame);
  if (kfs.length < 2) {
    findings.push({ rule: "camera", severity: "error", where: "scene.camera", message: "declares a camera but has no moves (needs at least two keyframes)." });
    return;
  }
  
  let hasMove = false;
  for (let i = 1; i < kfs.length; i++) {
    const p1 = kfs[i - 1];
    const p2 = kfs[i];
    const dx = p2.center.x - p1.center.x;
    const dy = p2.center.y - p1.center.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist > 1e-3 || Math.abs(p1.zoom - p2.zoom) > 1e-3 || Math.abs((p1.rotation ?? 0) - (p2.rotation ?? 0)) > 1e-3) {
      hasMove = true;
    }
    
    const frames = p2.frame - p1.frame;
    if (frames > 0) {
      const durationSec = frames / (scene.fps || FPS);
      const speed = dist / durationSec;
      const maxSpeed = (scene.sceneSize?.w ?? 1920) * 0.20;
      if (speed > maxSpeed) {
        findings.push({ rule: "camera", severity: "error", where: `scene.camera segment ${p1.frame}-${p2.frame}`, message: `camera moves ${speed.toFixed(1)} px/s, exceeding the speed limit of 20% of frame width (${maxSpeed} px/s).` });
      }
    } else if (dist > 1e-3) {
      findings.push({ rule: "camera", severity: "error", where: `scene.camera segment ${p1.frame}-${p2.frame}`, message: `camera has an instantaneous jump of ${dist.toFixed(1)} px at frame ${p1.frame}.` });
    }
  }
  
  if (!hasMove) {
    findings.push({ rule: "camera", severity: "error", where: "scene.camera", message: "declares a camera but has no moves." });
    return;
  }

  // The compiled curve is what the viewer sees: an eased move can stay under the average speed cap and still burst.
  const fps = scene.fps || FPS;
  const sceneW = scene.sceneSize?.w ?? 1920;
  const stats = measureCameraMotion(compileCameraTrack(scene.camera, scene.durationFrames, scene.sceneSize ?? { w: sceneW, h: sceneW }), fps);
  const hint = "Leave `easing` off the keyframes so the camera flows through them, or give the move more frames.";
  if (stats.peakZoomStep > MAX_CAMERA_ZOOM_STEP) {
    findings.push({ rule: "camera", severity: "error", where: "scene.camera", message: `camera zoom changes ${(stats.peakZoomStep * 100).toFixed(2)}% in a single frame, above the ${(MAX_CAMERA_ZOOM_STEP * 100).toFixed(1)}% limit, which reads as a jerk. ${hint}` });
  }
  const maxAccel = sceneW * MAX_CAMERA_PAN_ACCEL_WIDTHS;
  if (stats.peakPanAccel > maxAccel) {
    findings.push({ rule: "camera", severity: "error", where: "scene.camera", message: `camera pan accelerates at ${stats.peakPanAccel.toFixed(0)} px/s^2, above the limit of ${maxAccel.toFixed(0)} px/s^2, which reads as a jerk. ${hint}` });
  }
  if (stats.holdShare < MIN_CAMERA_HOLD_SHARE) {
    findings.push({ rule: "camera", severity: "warning", where: "scene.camera", message: `camera holds for ${(stats.holdShare * 100).toFixed(0)}% of the film; aim for at least ${(MIN_CAMERA_HOLD_SHARE * 100).toFixed(0)}% so viewers can read each composition.` });
  }
  if (stats.maxContinuousMoveSeconds > MAX_CAMERA_CONTINUOUS_MOVE_SECONDS) {
    findings.push({ rule: "camera", severity: "warning", where: "scene.camera", message: `camera moves continuously for as long as ${stats.maxContinuousMoveSeconds.toFixed(1)}s; break the move with a settled hold within ${MAX_CAMERA_CONTINUOUS_MOVE_SECONDS}s.` });
  }
  const maxLandingGap = CAMERA_CUE_LANDING_TOLERANCE_SECONDS * fps;
  for (let i = 0; i < (targets?.length ?? 0); i++) {
    const target = targets![i];
    const keyframe = kfs.reduce((nearest, candidate) =>
      Math.abs(candidate.frame - target.frame) < Math.abs(nearest.frame - target.frame) ? candidate : nearest,
    );
    const keyframeIndex = kfs.indexOf(keyframe) + 1;
    const gap = Math.abs(keyframe.frame - target.frame);
    if (gap > maxLandingGap) {
      findings.push({ rule: "camera", severity: "warning", where: `scene.camera keyframe ${keyframeIndex}`, message: `move lands ${(gap / fps).toFixed(1)}s from its planned cue; aim to arrive about one beat before the narration cue.` });
    }
    if (target.focus) {
      if (target.authoredFocus !== target.focus) {
        findings.push({ rule: "camera", severity: "warning", where: `scene.camera keyframe ${keyframeIndex}`, message: `look plan focuses on "${target.focus}" but the design pose does not name that object as its focus.` });
      }
      if (scene.renderer === "three" && scene.cast?.some((item) => item.id === target.focus)) continue;
      const subject = scene.props.find((prop) => prop.assetId === target.focus || prop.animation?.clips.some((clip) => clip.targets.includes(target.focus!)));
      if (!subject) {
        findings.push({ rule: "camera", severity: "warning", where: `scene.camera keyframe ${keyframeIndex}`, message: `planned focus "${target.focus}" has no scene object to frame.` });
      } else {
        const subjectPos = objectPositionAt(subject, target.focus, keyframe.frame);
        if (Math.hypot(keyframe.center.x - subjectPos.x, keyframe.center.y - subjectPos.y) > 360) {
          findings.push({ rule: "camera", severity: "warning", where: `scene.camera keyframe ${keyframeIndex}`, message: `camera pose does not land near focused object "${target.focus}"; move the pose toward the subject.` });
        }
      }
    }
  }
}

const MIN_VISIBLE_CHANGE_DELTA: Record<string, number> = {
  opacity: 0.25,
  scale: 0.2,
  scaleX: 0.2,
  scaleY: 0.2,
  translateX: 40,
  translateY: 40,
  rotate: 15,
  drawOn: 0.25,
};

// Checks declared carry-over changes for a substantial animation that settles in a visible camera hold.
function checkCarryChangeHolds(film: Film, scene: Scene, plan: LookPlan | undefined, findings: DesignFinding[]): void {
  if (!plan) return;
  const fps = scene.fps || FPS;
  const holdFrames = 2 * fps;
  const camera = compileCameraTrack(scene.camera, scene.durationFrames, scene.sceneSize ?? { w: 1920, h: 1920 });
  const shotFrames = new Map<string, { start: number; end: number }>();
  let shotTime = 0;
  for (const shot of film.shots) {
    const start = Math.round(shotTime * fps);
    shotTime += shot.dur;
    const end = Math.round(shotTime * fps);
    shotFrames.set(shot.id, { start, end });
  }
  for (const cast of plan.film.cast) {
    if (scene.renderer === "three" && scene.cast?.some((item) => item.id === cast.id)) continue; // Three carry holds are measured over evaluated geometry by checkThreeStage.
    const prop = scene.props.find((item) => item.assetId === cast.id || item.animation?.clips.some((clip) => clip.targets.includes(cast.id)));
    for (const change of cast.changes) {
      const window = shotFrames.get(change.at);
      const where = `scene.camera / ${cast.id} at ${change.at}`;
      if (!prop || !window) {
        findings.push({ rule: "carry-over", severity: "warning", where, message: `cannot verify the planned state change "${change.state ?? change.how}" against a scene object and shot timing.` });
        continue;
      }
      const clips = (prop.animation?.clips ?? []).filter((clip) =>
        (prop.assetId === cast.id || clip.targets.includes(cast.id)) &&
        clip.startFrame < window.end && clip.startFrame + clip.durationFrames >= window.start &&
        Math.abs(clip.to - clip.from) >= (MIN_VISIBLE_CHANGE_DELTA[clip.property] ?? Number.POSITIVE_INFINITY),
      );
      const finish = clips.length ? Math.max(...clips.map((clip) => clip.startFrame + clip.durationFrames)) : -1;
      const aimedAndHeld = finish >= 0 && finish + holdFrames <= camera.length && Array.from({ length: holdFrames }, (_, i) => camera[finish + i]).every((pose, i) => {
        const pan = Math.hypot(camera[finish].center.x - pose.center.x, camera[finish].center.y - pose.center.y);
        const zoom = Math.abs(camera[finish].zoom - pose.zoom);
        const targetPos = objectPositionAt(prop, cast.id, finish + i);
        const inFrame = Math.abs(pose.center.x - targetPos.x) <= 540 / pose.zoom && Math.abs(pose.center.y - targetPos.y) <= 540 / pose.zoom;
        return pan < 0.3 && zoom < 1e-4 && inFrame;
      });
      if (!clips.length) {
        findings.push({ rule: "carry-over", severity: "warning", where, message: `planned state "${change.state ?? change.how}" has no large visible animation on this object during the change shot.` });
      } else if (!aimedAndHeld) {
        findings.push({ rule: "carry-over", severity: "warning", where, message: `planned state "${change.state ?? change.how}" must finish while the camera holds on the object, then stay framed for at least 2 seconds.` });
      }
    }
  }
}

// Runs every standard-layer rule over a parsed film manifest.
export function checkFilmDesign(raw: unknown, context: DesignCheckContext = {}): DesignReport {
  const findings: DesignFinding[] = [];
  const filmId = (raw as { id?: string })?.id ?? "unknown";
  let film: Film;
  try {
    film = parseFilm(raw);
  } catch (err) {
    findings.push({ rule: "schema", severity: "error", where: "film.json", message: err instanceof Error ? err.message.slice(0, 600) : String(err) });
    return { filmId, ok: false, findings, stats: { shots: 0, assets: 0, clips: 0 } };
  }

  let clips = 0;
  const scene = film.scene as Scene | undefined;
  const assets: EnvironmentAsset[] = scene ? [...(scene.background ? [scene.background] : []), ...(scene.props ?? [])] : [];
  if (scene) {
    const result = validateSceneWithNodeAssets(scene);
    for (const e of result.errors) {
      findings.push({ rule: "scene", severity: "error", where: e.entityId ?? "scene", message: e.message });
    }
    const hasCaptions = film.captions !== "off";
    if (scene.renderer === "three" && result.errors.length === 0) {
      findings.push(...checkThreeStage(film, scene, context));
      findings.push({ rule: "scene", severity: "warning", where: "three stage", message: "posed vertices, outlines and sampled mesh depth measured in both crops; facial appeal, finger contact, raster presence and unsampled occlusion remain unmeasured" });
    }
    for (const asset of assets) {
      if (hasCaptions && asset.position.y > CAPTION_SAFE_SQUARE.y1 && asset.assetId !== "background") {
        findings.push({ rule: "safe-area", severity: "error", where: asset.assetId, message: `placed at y=${asset.position.y}, which is inside the caption band (y > ${CAPTION_SAFE_SQUARE.y1}); move it up to keep it readable.` });
      }
      checkAsset(asset, film.accent, findings);
      clips += checkContinuity(asset, findings);
    }
    checkCamera(scene, findings, context.cameraTargets);
    checkCarryChangeHolds(film, scene, context.lookPlan, findings);
    // The inset rule reads the compiled scene, which only exists when the scene itself is valid.
    if (result.errors.length === 0) {
      for (const f of checkInsetRegions(film, scene)) findings.push({ rule: "inset", severity: "error", ...f });
    }
  }
  checkAudioLock(film, findings);
  checkHonestData(film, findings);

  return {
    filmId: film.id,
    ok: !findings.some((f) => f.severity === "error"),
    findings,
    stats: { shots: film.shots.length, assets: assets.length, clips },
  };
}

// Loads the film.json of a video package (personal videos dir, else examples/) and checks it.
export function checkFilmDesignById(filmId: string): DesignReport {
  const file = path.join(resolvePackageDir(filmId), "film.json");
  if (!fs.existsSync(file)) throw new Error(`no film at ${path.relative(REPO_ROOT, file)}`);
  const film = parseFilm(JSON.parse(fs.readFileSync(file, "utf8")));
  const pkg = resolvePackageDir(filmId);
  const lookFile = path.join(pkg, "design", "look.json");
  if (!fs.existsSync(lookFile)) return checkFilmDesign(film);
  const parsed = safeParseLookPlan(JSON.parse(fs.readFileSync(lookFile, "utf8")));
  if (!parsed.success) return checkFilmDesign(film);
  const wordsFile = path.join(pkg, "voiceover_words.json");
  const words: TimedWord[] = fs.existsSync(wordsFile) ? JSON.parse(fs.readFileSync(wordsFile, "utf8")).words ?? [] : [];
  const designFile = path.join(pkg, "design", "design.json");
  let designCamera: Array<{ at: string | number; focus?: string }> = [];
  try {
    designCamera = fs.existsSync(designFile) ? JSON.parse(fs.readFileSync(designFile, "utf8")).camera ?? [] : [];
  } catch {
    designCamera = [];
  }
  const cues = createCues(narrationTimingForFilm(film, words), film.fps);
  let cameraTargets: DesignCheckContext["cameraTargets"] = [];
  try {
    const authoredPoses = designCamera.map((pose) => ({
      frame: resolveCue(pose.at, cues),
      focus: typeof pose.focus === "string" ? pose.focus : undefined,
    }));
    cameraTargets = parsed.data.film.camera.map((pose) => {
      const frame = resolveCue(pose.at, cues);
      const authoredPose = authoredPoses.length ? authoredPoses.reduce((nearest, candidate) =>
        Math.abs(candidate.frame - frame) < Math.abs(nearest.frame - frame) ? candidate : nearest,
      ) : undefined;
      return { frame, focus: pose.focus, authoredFocus: authoredPose?.focus };
    });
  } catch {
    cameraTargets = [];
  }
  return checkFilmDesign(film, { lookPlan: parsed.data, cameraTargets });
}

// Formats a report as plain text an agent or a person can act on.
export function formatDesignReport(report: DesignReport): string {
  const lines = [
    `${report.ok ? "PASS" : "FAIL"} ${report.filmId}: ${report.stats.shots} shots, ${report.stats.assets} assets, ${report.stats.clips} clips`,
  ];
  for (const f of report.findings) lines.push(`  ${f.severity === "error" ? "error" : "warn "} [${f.rule}] ${f.where}: ${f.message}`);
  return lines.join("\n");
}
