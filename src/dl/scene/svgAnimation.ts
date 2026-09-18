/**
 * File Description: Declarative custom SVG animation engine for the Aideos scene graph.
 * Defines the typed clip format that describes which element of an SVG asset animates, along which
 * property, over which frames, with which easing, and compiles it into dense per-frame element
 * state. Every value is a pure function of the frame index: no wall clock, no CSS transitions and
 * no unseeded randomness, so a scene renders identically on every pass.
 */

import type { Vec2 } from "./types";

/**
 * The properties a clip may drive on a single SVG element.
 * - translateX / translateY move the element in its asset's own coordinate space.
 * - scale / scaleX / scaleY scale it about its transform origin.
 * - rotate turns it about its transform origin, in degrees.
 * - opacity fades it, clamped to [0, 1].
 * - drawOn reveals a stroked path from 0 (nothing drawn) to 1 (fully drawn) via stroke dashing.
 */
export type SvgAnimatableProperty =
  | "translateX"
  | "translateY"
  | "scale"
  | "scaleX"
  | "scaleY"
  | "rotate"
  | "opacity"
  | "drawOn";

/** The easing curves available to a clip. expoOut is the project standard (see motion.ts EXPO). */
export type SvgEasing = "linear" | "expoOut" | "expoIn" | "expoInOut" | "hold";

/** One declarative animation: a property moving from one value to another over a frame span. */
export interface SvgAnimationClip {
  /** Unique within its timeline. Stable across patches so the editor can address a clip. */
  clipId: string;
  /**
   * Ids of elements inside the asset's SVG document that this clip drives.
   * Listing several targets in one clip is how a staged, staggered entry is authored.
   */
  targets: string[];
  property: SvgAnimatableProperty;
  from: number;
  to: number;
  /** First frame of the clip, relative to the scene. Integer >= 0. */
  startFrame: number;
  /** Length of the clip in frames. Integer > 0. */
  durationFrames: number;
  /** Omit for the project standard ease-out-expo. */
  easing?: SvgEasing;
  /** Frames of delay added per target index, so ordered targets land one after another. */
  staggerFrames?: number;
  /**
   * Transform origin in the asset's own coordinate space. Omit to transform about the origin of
   * that space. Only meaningful for scale and rotate.
   */
  origin?: Vec2;
}

/** A named set of clips animating the elements of one SVG asset. */
export interface SvgAnimationTimeline {
  timelineId: string;
  clips: SvgAnimationClip[];
}

/** The fully resolved animated state of one SVG element at one frame. */
export interface SvgElementState {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
  opacity: number;
  /** 0 = nothing drawn, 1 = fully drawn. Rendered as stroke dashing on the target element. */
  drawOn: number;
  /**
   * True when a clip actually drives this element's opacity.
   * The renderer needs to tell "faded to fully opaque" apart from "nothing touched opacity", and
   * the value alone cannot: both read 1. Without this an element authored `opacity="0.07"` and
   * moved by a translate clip would be forced to full opacity, and an element authored
   * `opacity="0"` and faded in would snap back to invisible the instant its fade completed.
   */
  opacityDriven: boolean;
  /** Transform origin in the asset's own coordinate space. */
  originX: number;
  originY: number;
}

/** Per-frame element state for one asset: frames[f][elementId]. */
export interface CompiledSvgTimeline {
  timelineId: string;
  durationFrames: number;
  frames: Array<Record<string, SvgElementState>>;
}

/** A single problem found while validating a timeline, addressed to a specific clip. */
export interface SvgTimelineValidationError {
  clipId: string;
  message: string;
}

/** Inputs the timeline validator needs beyond the timeline itself. */
export interface SvgTimelineValidationContext {
  /** Length of the owning scene in frames. */
  durationFrames: number;
  /** Ids actually declared in the asset's SVG document; omit to skip the target existence check. */
  availableElementIds?: string[];
}

export const SVG_ANIMATABLE_PROPERTIES: readonly SvgAnimatableProperty[] = [
  "translateX",
  "translateY",
  "scale",
  "scaleX",
  "scaleY",
  "rotate",
  "opacity",
  "drawOn",
];

const SVG_EASINGS: readonly SvgEasing[] = ["linear", "expoOut", "expoIn", "expoInOut", "hold"];

/** The neutral state an element sits in before any clip touches it. */
export function identitySvgElementState(origin?: Vec2): SvgElementState {
  return {
    translateX: 0,
    translateY: 0,
    scaleX: 1,
    scaleY: 1,
    rotate: 0,
    opacity: 1,
    drawOn: 1,
    opacityDriven: false,
    originX: origin?.x ?? 0,
    originY: origin?.y ?? 0,
  };
}

/**
 * Solves a cubic bezier easing curve for y at a given x.
 * Written out rather than taken from Remotion's Easing so the same curve is available to the
 * pure compiler, to Node tests and to the browser bundle without a renderer in scope.
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const curveX = (t: number) => {
    const mt = 1 - t;
    return 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t;
  };
  const curveY = (t: number) => {
    const mt = 1 - t;
    return 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t;
  };
  const curveDx = (t: number) => {
    const mt = 1 - t;
    return 3 * mt * mt * x1 + 6 * mt * t * (x2 - x1) + 3 * t * t * (1 - x2);
  };

  // Newton-Raphson with a bisection fallback: a fixed iteration count keeps this deterministic.
  let t = x;
  for (let i = 0; i < 8; i++) {
    const error = curveX(t) - x;
    if (Math.abs(error) < 1e-7) return curveY(t);
    const dx = curveDx(t);
    if (Math.abs(dx) < 1e-7) break;
    t -= error / dx;
  }

  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 32; i++) {
    const value = curveX(t);
    if (Math.abs(value - x) < 1e-7) break;
    if (value > x) hi = t;
    else lo = t;
    t = (lo + hi) / 2;
  }
  return curveY(t);
}

/** Maps a normalized progress in [0, 1] through the named easing curve. */
export function applySvgEasing(easing: SvgEasing | undefined, t: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  switch (easing) {
    case "linear":
      return clamped;
    case "hold":
      return clamped >= 1 ? 1 : 0;
    case "expoIn":
      return cubicBezier(0.7, 0, 0.84, 0, clamped);
    case "expoInOut":
      return cubicBezier(0.87, 0, 0.13, 1, clamped);
    case "expoOut":
    default:
      // The one curve in the system: ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1).
      return cubicBezier(0.16, 1, 0.3, 1, clamped);
  }
}

/** Rounds to 4 decimal places and normalizes negative zero, so output bytes are stable. */
export function quantize(value: number): number {
  const rounded = Math.round(value * 1e4) / 1e4;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Computes the inclusive frame span a clip occupies for a given target index. */
function clipSpanForTarget(clip: SvgAnimationClip, targetIndex: number): { start: number; end: number } {
  const delay = (clip.staggerFrames ?? 0) * targetIndex;
  const start = clip.startFrame + delay;
  return { start, end: start + clip.durationFrames };
}

/**
 * Evaluates a clip's contribution for one target at one frame.
 * Before the clip starts the element holds `from`; after it ends it holds `to`. Holding rather
 * than snapping back is what makes a scene evolve continuously instead of cutting between states.
 */
function evaluateClipValue(clip: SvgAnimationClip, targetIndex: number, frame: number): number {
  const { start, end } = clipSpanForTarget(clip, targetIndex);
  if (frame <= start) return clip.from;
  if (frame >= end) return clip.to;
  const t = (frame - start) / clip.durationFrames;
  const eased = applySvgEasing(clip.easing, t);
  return clip.from + (clip.to - clip.from) * eased;
}

/** The individual state fields a clip can drive. "scale" writes scaleX and scaleY. */
type SvgStateSlot = "translateX" | "translateY" | "scaleX" | "scaleY" | "rotate" | "opacity" | "drawOn";

/** Writes one resolved value into a single element state slot. */
function assignSlot(state: SvgElementState, slot: SvgStateSlot, value: number): void {
  if (slot === "opacity" || slot === "drawOn") {
    state[slot] = quantize(Math.min(1, Math.max(0, value)));
    if (slot === "opacity") state.opacityDriven = true;
    return;
  }
  state[slot] = quantize(value);
}

/** The element state slots a property writes, used to detect conflicting overlapping clips. */
function propertySlots(property: SvgAnimatableProperty): SvgStateSlot[] {
  if (property === "scale") return ["scaleX", "scaleY"];
  return [property as SvgStateSlot];
}

/** One clip bound to one of its targets, which is the unit the compiler schedules. */
interface ClipBinding {
  clip: SvgAnimationClip;
  targetIndex: number;
  start: number;
  end: number;
}

/**
 * Picks the clip that governs a slot at a given frame.
 * Inside a clip's span that clip governs; after it ends it keeps holding its end value until the
 * next clip starts; before the first clip starts that clip's start value is held. Holding rather
 * than resetting is what lets a scene evolve continuously instead of snapping between states.
 */
function governingBinding(bindings: ClipBinding[], frame: number): ClipBinding {
  let governing = bindings[0];
  for (const binding of bindings) {
    if (binding.start <= frame) governing = binding;
  }
  return governing;
}

/**
 * Validates a timeline against its owning scene and its asset's SVG document.
 * Returns every problem found rather than throwing on the first, so a caller can report them all.
 */
export function validateSvgTimeline(
  timeline: SvgAnimationTimeline,
  context: SvgTimelineValidationContext,
): SvgTimelineValidationError[] {
  const errors: SvgTimelineValidationError[] = [];
  if (!timeline || !Array.isArray(timeline.clips)) {
    return [{ clipId: timeline?.timelineId ?? "<unknown>", message: "Timeline has no clips array." }];
  }

  const seenClipIds = new Set<string>();
  // slot key -> occupied spans, used for the overlapping-clip conflict rule.
  const occupancy = new Map<string, Array<{ clipId: string; start: number; end: number }>>();

  for (const clip of timeline.clips) {
    const clipId = clip?.clipId ?? "<missing clipId>";

    if (!clip.clipId) {
      errors.push({ clipId, message: "Clip is missing a clipId." });
    } else if (seenClipIds.has(clip.clipId)) {
      errors.push({ clipId, message: `Duplicate clipId "${clip.clipId}" in timeline "${timeline.timelineId}".` });
    } else {
      seenClipIds.add(clip.clipId);
    }

    if (!Array.isArray(clip.targets) || clip.targets.length === 0) {
      errors.push({ clipId, message: "Clip must name at least one target element id." });
    }

    if (!SVG_ANIMATABLE_PROPERTIES.includes(clip.property)) {
      errors.push({
        clipId,
        message: `Unknown property "${clip.property}". Supported: ${SVG_ANIMATABLE_PROPERTIES.join(", ")}.`,
      });
    }

    if (clip.easing !== undefined && !SVG_EASINGS.includes(clip.easing)) {
      errors.push({ clipId, message: `Unknown easing "${clip.easing}". Supported: ${SVG_EASINGS.join(", ")}.` });
    }

    if (!Number.isFinite(clip.from) || !Number.isFinite(clip.to)) {
      errors.push({ clipId, message: "Clip from and to must both be finite numbers." });
    }

    if (!Number.isInteger(clip.startFrame) || clip.startFrame < 0) {
      errors.push({ clipId, message: `startFrame must be an integer >= 0, got ${clip.startFrame}.` });
    }

    if (!Number.isInteger(clip.durationFrames) || clip.durationFrames <= 0) {
      errors.push({ clipId, message: `durationFrames must be an integer > 0, got ${clip.durationFrames}.` });
    }

    if (clip.staggerFrames !== undefined && (!Number.isInteger(clip.staggerFrames) || clip.staggerFrames < 0)) {
      errors.push({ clipId, message: `staggerFrames must be an integer >= 0, got ${clip.staggerFrames}.` });
    }

    if (clip.property === "opacity" || clip.property === "drawOn") {
      for (const [label, value] of [["from", clip.from], ["to", clip.to]] as const) {
        if (Number.isFinite(value) && (value < 0 || value > 1)) {
          errors.push({ clipId, message: `${clip.property} ${label} must be within [0, 1], got ${value}.` });
        }
      }
    }

    const targets = Array.isArray(clip.targets) ? clip.targets : [];
    const seenTargets = new Set<string>();
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      if (seenTargets.has(target)) {
        errors.push({ clipId, message: `Duplicate target "${target}" in clip "${clipId}".` });
        continue;
      }
      seenTargets.add(target);

      if (context.availableElementIds && !context.availableElementIds.includes(target)) {
        errors.push({
          clipId,
          message: `Target element id "${target}" does not exist in the asset's SVG document.`,
        });
      }

      if (Number.isInteger(clip.startFrame) && Number.isInteger(clip.durationFrames) && clip.durationFrames > 0) {
        const { start, end } = clipSpanForTarget(clip, i);
        if (end > context.durationFrames) {
          errors.push({
            clipId,
            message: `Clip on target "${target}" ends at frame ${end}, past the scene length of ${context.durationFrames} frames.`,
          });
        }

        for (const slot of propertySlots(clip.property)) {
          const key = `${target}::${slot}`;
          const spans = occupancy.get(key) ?? [];
          for (const span of spans) {
            if (start < span.end && span.start < end) {
              errors.push({
                clipId,
                message: `Clip overlaps clip "${span.clipId}" on target "${target}" property "${slot}" (frames ${Math.max(start, span.start)}..${Math.min(end, span.end)}). Overlapping clips on one property are ambiguous: split them or retime one.`,
              });
            }
          }
          spans.push({ clipId, start, end });
          occupancy.set(key, spans);
        }
      }
    }
  }

  return errors;
}

/**
 * Compiles a timeline into dense per-frame element state.
 * Throws on an invalid timeline: a silently-dropped clip is a scene that renders wrong with no
 * sign that anything went missing.
 */
export function compileSvgTimeline(
  timeline: SvgAnimationTimeline,
  context: SvgTimelineValidationContext,
): CompiledSvgTimeline {
  const errors = validateSvgTimeline(timeline, context);
  if (errors.length > 0) {
    throw new Error(
      `SVG_TIMELINE_VALIDATION_FAILED: ${errors.map((e) => `[${e.clipId}] ${e.message}`).join("; ")}`,
    );
  }

  const totalFrames = context.durationFrames;

  // Bind every clip to each of its targets, then group those bindings by the state slot they
  // drive. Resolving a slot from its own ordered bindings is what makes a clip that has not
  // started yet unable to overwrite the value an earlier clip is currently holding.
  const slotBindings = new Map<string, { target: string; slot: SvgStateSlot; bindings: ClipBinding[] }>();
  const targetOrigins = new Map<string, Vec2>();
  const allTargets = new Set<string>();

  for (const clip of timeline.clips) {
    for (let i = 0; i < clip.targets.length; i++) {
      const target = clip.targets[i];
      allTargets.add(target);
      if (clip.origin) targetOrigins.set(target, clip.origin);
      const { start, end } = clipSpanForTarget(clip, i);
      for (const slot of propertySlots(clip.property)) {
        const key = `${target}::${slot}`;
        const entry = slotBindings.get(key) ?? { target, slot, bindings: [] };
        entry.bindings.push({ clip, targetIndex: i, start, end });
        slotBindings.set(key, entry);
      }
    }
  }
  for (const entry of slotBindings.values()) {
    entry.bindings.sort((a, b) => a.start - b.start);
  }

  const frames: Array<Record<string, SvgElementState>> = new Array(totalFrames);

  for (let f = 0; f < totalFrames; f++) {
    const frameState: Record<string, SvgElementState> = {};

    for (const target of allTargets) {
      const state = identitySvgElementState(targetOrigins.get(target));
      frameState[target] = state;
    }

    for (const { target, slot, bindings } of slotBindings.values()) {
      const binding = governingBinding(bindings, f);
      assignSlot(frameState[target], slot, evaluateClipValue(binding.clip, binding.targetIndex, f));
    }

    frames[f] = frameState;
  }

  return { timelineId: timeline.timelineId, durationFrames: totalFrames, frames };
}

/**
 * Builds the SVG transform attribute for an element state.
 * Returns null when the state is the identity, so untouched elements emit no extra attribute.
 */
export function svgElementStateToTransform(state: SvgElementState): string | null {
  const moved = state.translateX !== 0 || state.translateY !== 0;
  const scaled = state.scaleX !== 1 || state.scaleY !== 1;
  const rotated = state.rotate !== 0;
  if (!moved && !scaled && !rotated) return null;

  const parts: string[] = [];
  if (moved) parts.push(`translate(${state.translateX}, ${state.translateY})`);
  if (scaled || rotated) {
    const needsOrigin = state.originX !== 0 || state.originY !== 0;
    if (needsOrigin) parts.push(`translate(${state.originX}, ${state.originY})`);
    if (rotated) parts.push(`rotate(${state.rotate})`);
    if (scaled) parts.push(`scale(${state.scaleX}, ${state.scaleY})`);
    if (needsOrigin) parts.push(`translate(${-state.originX}, ${-state.originY})`);
  }
  return parts.join(" ");
}

/**
 * Convenience builder for a staged entry: a set of elements fading and lifting into place in
 * order, on the project's single easing curve and its authored rise distance.
 */
export function stagedEntryClips(options: {
  clipIdPrefix: string;
  targets: string[];
  startFrame: number;
  durationFrames: number;
  staggerFrames?: number;
  risePx?: number;
}): SvgAnimationClip[] {
  const { clipIdPrefix, targets, startFrame, durationFrames } = options;
  const staggerFrames = options.staggerFrames ?? 2;
  const risePx = options.risePx ?? 12;
  return [
    {
      clipId: `${clipIdPrefix}-fade`,
      targets,
      property: "opacity",
      from: 0,
      to: 1,
      startFrame,
      durationFrames,
      easing: "expoOut",
      staggerFrames,
    },
    {
      clipId: `${clipIdPrefix}-rise`,
      targets,
      property: "translateY",
      from: risePx,
      to: 0,
      startFrame,
      durationFrames,
      easing: "expoOut",
      staggerFrames,
    },
  ];
}
