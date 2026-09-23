/**
 * File Description: A timeline builder that holds the scene engine's two unwritten rules.
 * The engine holds each element's last value until another clip takes over, so a clip that does
 * not start where the previous one ended is a visible snap; and the compiler applies the last
 * transform origin it sees to every frame of an element, so an element may only ever have one.
 * Timeline refuses both at authoring time, with the clip ids involved, instead of shipping a glitch.
 */

import type { Vec2 } from "../../src/dl/scene/types";
import type { SvgAnimationClip, SvgAnimatableProperty, SvgEasing } from "../../src/dl/scene/svgAnimation";

/** Arguments for one authored clip, with an end frame instead of a duration. */
export interface ClipSpec {
  id: string;
  targets: string[];
  property: SvgAnimatableProperty;
  from: number;
  to: number;
  start: number;
  end: number;
  easing?: SvgEasing;
  stagger?: number;
  origin?: Vec2;
  /**
   * Allows this clip to start from a value the previous clip did not end on. Only for a jump the
   * viewer cannot see, such as moving an element while its own opacity is zero.
   */
  allowJump?: boolean;
}

/** The state slots a property writes, which is the granularity continuity is checked at. */
function slotsFor(property: SvgAnimatableProperty): string[] {
  return property === "scale" ? ["scaleX", "scaleY"] : [property];
}

/** The value an element holds before anything touches it, per property. */
function restValue(property: SvgAnimatableProperty): number {
  if (property === "scale" || property === "scaleX" || property === "scaleY") return 1;
  if (property === "opacity" || property === "drawOn") return 1;
  return 0;
}

/**
 * Collects clips for one asset while holding the rules that keep motion continuous.
 * Every clip is checked against the last clip on the same element and property, so a value can
 * never snap; and an element may declare only one transform origin.
 */
export class Timeline {
  private clips: SvgAnimationClip[] = [];
  private lastValue = new Map<string, { clipId: string; value: number }>();
  private origins = new Map<string, { clipId: string; origin: Vec2 }>();

  constructor(
    private readonly timelineId: string,
    private readonly durationFrames: number,
  ) {}

  /** Adds one clip, failing loudly on a discontinuity, a clashing origin or an overrun. */
  add(spec: ClipSpec): this {
    const duration = spec.end - spec.start;
    if (duration <= 0) {
      throw new Error(`[${this.timelineId}/${spec.id}] end ${spec.end} is not after start ${spec.start}.`);
    }
    const stagger = spec.stagger ?? 0;
    const lastEnd = spec.end + stagger * (spec.targets.length - 1);
    if (lastEnd > this.durationFrames) {
      throw new Error(
        `[${this.timelineId}/${spec.id}] ends at frame ${lastEnd}, past the film's ${this.durationFrames}.`,
      );
    }

    for (const target of spec.targets) {
      if (spec.origin) {
        const existing = this.origins.get(target);
        if (existing && (existing.origin.x !== spec.origin.x || existing.origin.y !== spec.origin.y)) {
          throw new Error(
            `[${this.timelineId}/${spec.id}] gives "${target}" origin (${spec.origin.x}, ${spec.origin.y}) ` +
              `but "${existing.clipId}" already gave it (${existing.origin.x}, ${existing.origin.y}). ` +
              "One element, one origin: the compiler applies the last origin it sees to every frame.",
          );
        }
        this.origins.set(target, { clipId: spec.id, origin: spec.origin });
      }

      for (const slot of slotsFor(spec.property)) {
        const key = `${target}::${slot}`;
        const previous = this.lastValue.get(key);
        const expected = previous ? previous.value : restValue(spec.property);
        if (!spec.allowJump && previous && Math.abs(expected - spec.from) > 1e-6) {
          throw new Error(
            `[${this.timelineId}/${spec.id}] starts "${target}" ${slot} at ${spec.from} but ` +
              `"${previous.clipId}" left it at ${expected}. A gap here is a visible snap on screen.`,
          );
        }
        this.lastValue.set(key, { clipId: spec.id, value: spec.to });
      }
    }

    this.clips.push({
      clipId: spec.id,
      targets: spec.targets,
      property: spec.property,
      from: spec.from,
      to: spec.to,
      startFrame: spec.start,
      durationFrames: duration,
      ...(spec.easing ? { easing: spec.easing } : {}),
      ...(stagger ? { staggerFrames: stagger } : {}),
      ...(spec.origin ? { origin: spec.origin } : {}),
    });
    return this;
  }

  /** Hands back the finished timeline for attaching to its asset. */
  build() {
    return { timelineId: this.timelineId, clips: this.clips };
  }
}
