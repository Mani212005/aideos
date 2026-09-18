/**
 * File Description: The animation timelines for the film "Still Talking".
 * Builds the single Scene that runs for the whole film: every asset, where it sits in scene space,
 * and the declarative SVG clips that move it. The frame numbers are derived from the measured
 * narration in voiceover_words.json rather than authored, so a re-recorded take retimes the picture
 * instead of drifting away from it. A small builder enforces two house rules the scene engine
 * cannot: a clip must start from the value the previous clip on that property left behind, and one
 * element may only ever be scaled or rotated about a single origin.
 */

import type { Scene, EnvironmentAsset, Vec2 } from "../../src/dl/scene/types";
import type { SvgAnimationClip, SvgAnimatableProperty, SvgEasing } from "../../src/dl/scene/svgAnimation";
import type { VoiceoverTiming } from "./produceVoiceover";

export const FPS = 30;

/** Scene coordinate space. Square, so the wide cut and the reel each take a strip through it. */
export const SCENE_SIZE = { w: 1920, h: 1920 };

/**
 * Where each asset sits in scene space. The film is composed in two bands: inserts (the planets,
 * the plates, the record) live in the upper band, and the craft, its signal and the sun hold the
 * lower band for the whole film, which is what makes the continuity legible.
 */
const PLACEMENT = {
  insert: { x: 1000, y: 850 },
  probe: { x: 1130, y: 1210 },
  sun: { x: 470, y: 1285 },
  /** The record starts life as the small disc on the craft's flank and grows out of it. */
  recordOnFlank: { x: 1152, y: 1234 },
  boundary: { x: 1960, y: 960 },
  /**
   * The flight path hangs below the action line, in the band only the reel can see. The wide cut's
   * visible window stops at world y 1500 (it takes the centre 1080-tall strip of the 1920-tall
   * scene), so this sits low enough, at the trajectory asset's own scale (0.8, see the asset
   * below), that even its highest point stays under that line: the wide cut crops it clean and the
   * reel gets a lower third that carries the journey instead of bare sky.
   */
  trajectory: { x: 800, y: 1672 },
  centre: { x: 960, y: 960 },
};

/** Arguments for one authored clip, with an end frame instead of a duration. */
interface ClipSpec {
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
   * Allows this clip to start from a value the previous clip did not end on.
   * Only the signal pulses use it: they are meant to jump back to the dish, and they do it while
   * their own opacity is zero so the jump is never on screen.
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
 * never snap; and an element may declare only one transform origin, because the compiler applies
 * the last origin it sees to every frame of that element.
 */
class Timeline {
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

/** Frame spans of every shot, derived from the measured narration and nothing else. */
export interface ShotFrames {
  spans: Map<string, { from: number; to: number }>;
  durationFrames: number;
}

/** Turns measured narration offsets into contiguous, gap-free shot frame spans. */
export function shotFrames(timing: VoiceoverTiming): ShotFrames {
  const spans = new Map<string, { from: number; to: number }>();
  let cursor = 0;
  for (const segment of timing.segments) {
    const to = Math.round((segment.startSec + segment.durationSec) * FPS);
    spans.set(segment.shotId, { from: cursor, to });
    cursor = to;
  }
  return { spans, durationFrames: cursor };
}

/** Builds the whole film's scene: every asset, placed, layered and animated. */
export function buildScene(timing: VoiceoverTiming): Scene {
  const { spans, durationFrames } = shotFrames(timing);

  /** Frame at a fraction through a named shot, which is how beats are aimed at words. */
  const at = (shotId: string, fraction = 0): number => {
    const span = spans.get(shotId);
    if (!span) throw new Error(`No shot "${shotId}" in the measured narration.`);
    return Math.round(span.from + (span.to - span.from) * fraction);
  };
  /** First frame of a named shot. */
  const from = (shotId: string): number => at(shotId, 0);
  /** Frame one past the last frame of a named shot. */
  const to = (shotId: string): number => at(shotId, 1);

  const bySegment = new Map(timing.segments.map((segment) => [segment.shotId, segment]));
  /**
   * Frame a given phrase is spoken at, from the narration's own word offsets.
   * Aiming a beat at a word rather than at a fraction of the shot is what keeps a cue on the
   * thing being said: the payoff word of a sentence is usually near its end, not its middle.
   * Throws when the phrase is not in that shot, so re-writing a line cannot silently mis-time it.
   */
  const word = (shotId: string, phrase: string, edge: "start" | "end" = "start"): number => {
    const segment = bySegment.get(shotId);
    if (!segment) throw new Error(`No shot "${shotId}" in the measured narration.`);
    const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
    const wanted = phrase.split(/\s+/).map(normalize).filter(Boolean);
    for (let i = 0; i + wanted.length <= segment.words.length; i++) {
      if (wanted.every((w, k) => normalize(segment.words[i + k].word) === w)) {
        const hit = edge === "start" ? segment.words[i] : segment.words[i + wanted.length - 1];
        return Math.round((edge === "start" ? hit.startSec : hit.endSec) * FPS);
      }
    }
    throw new Error(`"${phrase}" is not spoken in shot "${shotId}": ${segment.text}`);
  };

  // ---------------------------------------------------------------- backdrop
  const space: EnvironmentAsset = {
    assetId: "space",
    svgSource: "videos/still-talking/visuals/space.svg",
    layer: 0,
    position: PLACEMENT.centre,
    scale: 4.8,
    rotation: 0,
    opacity: 1,
    animation: new Timeline("space-drift", durationFrames)
      .add({ id: "band-drift", targets: ["milky-band"], property: "translateX", from: 0, to: -46, start: 0, end: durationFrames, easing: "linear" })
      .build(),
  };

  // --------------------------------------------------------- parallax layers
  // Two star layers at different speeds are the whole film's sense of travel. Both accelerate
  // hard through the slingshot and then settle into a faster cruise than they had before it.
  const starsFar: EnvironmentAsset = {
    assetId: "stars-far",
    svgSource: "videos/still-talking/visuals/stars-far.svg",
    layer: 1,
    position: PLACEMENT.centre,
    scale: 4.8,
    rotation: 0,
    opacity: 1,
    animation: new Timeline("stars-far-drift", durationFrames)
      .add({ id: "far-cruise-1", targets: ["stars-far"], property: "translateX", from: 0, to: -44, start: 0, end: from("slingshot"), easing: "linear" })
      .add({ id: "far-whip", targets: ["stars-far"], property: "translateX", from: -44, to: -80, start: from("slingshot"), end: from("saturn"), easing: "expoInOut" })
      .add({ id: "far-cruise-2", targets: ["stars-far"], property: "translateX", from: -80, to: -244, start: from("saturn"), end: durationFrames, easing: "linear" })
      .add({ id: "far-twinkle-a", targets: ["stars-far-twinkle-1", "stars-far-twinkle-4"], property: "opacity", from: 0.7, to: 0.3, start: from("falling-outward"), end: to("out-of-plane"), easing: "linear" })
      .add({ id: "far-twinkle-b", targets: ["stars-far-twinkle-2", "stars-far-twinkle-6"], property: "opacity", from: 0.7, to: 0.95, start: from("turn-around"), end: to("across-the-edge"), easing: "linear" })
      .add({ id: "far-twinkle-c", targets: ["stars-far-twinkle-3", "stars-far-twinkle-7"], property: "opacity", from: 0.7, to: 0.35, start: from("particles-change"), end: to("still-out-there"), easing: "linear" })
      .add({ id: "far-twinkle-d", targets: ["stars-far-twinkle-5", "stars-far-twinkle-8"], property: "opacity", from: 0.7, to: 0.9, start: from("going-dark"), end: durationFrames, easing: "linear" })
      .build(),
  };

  const starsNear: EnvironmentAsset = {
    assetId: "stars-near",
    svgSource: "videos/still-talking/visuals/stars-near.svg",
    layer: 2,
    position: PLACEMENT.centre,
    scale: 3.6,
    rotation: 0,
    opacity: 1,
    animation: new Timeline("stars-near-drift", durationFrames)
      .add({ id: "near-cruise-1", targets: ["stars-near"], property: "translateX", from: 0, to: -162, start: 0, end: from("slingshot"), easing: "linear" })
      .add({ id: "near-whip", targets: ["stars-near"], property: "translateX", from: -162, to: -320, start: from("slingshot"), end: from("saturn"), easing: "expoInOut" })
      .add({ id: "near-cruise-2", targets: ["stars-near"], property: "translateX", from: -320, to: -1050, start: from("saturn"), end: durationFrames, easing: "linear" })
      .add({ id: "near-twinkle-a", targets: ["stars-near-twinkle-1", "stars-near-twinkle-3"], property: "opacity", from: 0.7, to: 0.34, start: from("jupiter"), end: to("nothing-but-distance"), easing: "linear" })
      .add({ id: "near-twinkle-b", targets: ["stars-near-twinkle-2", "stars-near-twinkle-5"], property: "opacity", from: 0.7, to: 0.96, start: from("sixty-photographs"), end: to("last-breath"), easing: "linear" })
      .add({ id: "near-twinkle-c", targets: ["stars-near-twinkle-4", "stars-near-twinkle-6"], property: "opacity", from: 0.7, to: 0.4, start: from("twenty-two-watts"), end: durationFrames, easing: "linear" })
      .build(),
  };

  // ------------------------------------------------------------- heliopause
  // The wind has to finish streaming before it can start stalling, and a stagger over fourteen
  // streamers pushes the last of them well past the clip's own end frame. Deriving the stall's
  // start from where the stream actually finishes keeps the two apart at any narration length.
  const windStagger = 4;
  const windStreamEnd = at("particles-change", 0.5) + windStagger * (windIds().length - 1);
  const windStallStart = Math.max(windStreamEnd, at("last-breath", 0.05));

  const boundary: EnvironmentAsset = {
    assetId: "boundary",
    svgSource: "videos/still-talking/visuals/boundary.svg",
    layer: 3,
    position: PLACEMENT.boundary,
    scale: 1,
    rotation: 0,
    opacity: 1,
    animation: new Timeline("heliopause-crossing", durationFrames)
      .add({ id: "boundary-in", targets: ["boundary-body"], property: "opacity", from: 0, to: 1, start: at("particles-change", 0.02), end: at("particles-change", 0.4) })
      .add({ id: "boundary-approach", targets: ["boundary-body"], property: "translateX", from: 0, to: -380, start: from("particles-change"), end: at("particles-change", 0.98), easing: "linear" })
      .add({ id: "boundary-near", targets: ["boundary-body"], property: "translateX", from: -380, to: -742, start: at("particles-change", 0.98), end: at("last-breath", 0.96), easing: "linear" })
      .add({ id: "boundary-cross", targets: ["boundary-body"], property: "translateX", from: -742, to: -1012, start: at("last-breath", 0.96), end: word("across-the-edge", "edge", "end"), easing: "linear" })
      .add({ id: "boundary-recede", targets: ["boundary-body"], property: "translateX", from: -1012, to: -2040, start: word("across-the-edge", "edge", "end"), end: to("going-dark"), easing: "linear" })
      .add({ id: "boundary-out", targets: ["boundary-body"], property: "opacity", from: 1, to: 0, start: at("going-dark", 0.1), end: to("going-dark") })
      // The arc draws itself across the frame: the edge is not there until it is measured.
      .add({ id: "arc-draw", targets: ["bubble-arc"], property: "drawOn", from: 0, to: 1, start: at("particles-change", 0.12), end: at("last-breath", 0.2), easing: "linear" })
      .add({ id: "arc-inner-draw", targets: ["bubble-arc-inner"], property: "drawOn", from: 0, to: 1, start: at("particles-change", 0.4), end: at("last-breath", 0.45), easing: "linear" })
      // Solar wind: streaming outward, then decelerating to a dead stop, then gone.
      .add({ id: "wind-stream", targets: windIds(), property: "translateX", from: 0, to: 108, start: at("particles-change", 0.08), end: at("particles-change", 0.5), stagger: windStagger, easing: "linear" })
      .add({ id: "wind-stall", targets: windIds(), property: "translateX", from: 108, to: 152, start: windStallStart, end: word("last-breath", "stopped", "end"), easing: "expoOut" })
      .add({ id: "wind-die", targets: windIds(), property: "opacity", from: 1, to: 0, start: word("last-breath", "simply"), end: word("last-breath", "simply") + 34, stagger: 4 })
      // What is waiting outside arrives cold, dense and unordered.
      .add({ id: "ism-arrive", targets: ismIds(), property: "opacity", from: 0, to: 0.55, start: at("last-breath", 0.12), end: at("last-breath", 0.32), stagger: 4 })
      .build(),
  };

  // --------------------------------------------------------- the system left
  const homeSystem: EnvironmentAsset = {
    assetId: "home-system",
    svgSource: "videos/still-talking/visuals/home-system.svg",
    layer: 5,
    position: PLACEMENT.sun,
    scale: 0.95,
    rotation: 0,
    opacity: 1,
    animation: new Timeline("home-system-recedes", durationFrames)
      // The orbits draw themselves outward while the narration says what the craft is flying past.
      .add({ id: "orbits-draw", targets: orbitIds(), property: "drawOn", from: 0, to: 1, start: at("one-job", 0.1), end: at("one-job", 0.75), stagger: 22, easing: "linear" })
      .add({ id: "earth-in", targets: ["earth-marker"], property: "opacity", from: 0, to: 1, start: at("one-job", 0.14), end: at("one-job", 0.5) })
      .add({ id: "earth-dim", targets: ["earth-marker"], property: "opacity", from: 1, to: 0.4, start: from("let-go"), end: at("falling-outward", 0.8) })
      .add({ id: "earth-last-look", targets: ["earth-marker"], property: "opacity", from: 0.4, to: 0, start: at("out-of-plane", 0.6), end: at("out-of-plane", 0.95) })
      // Earth pings three times, like something still trying to be heard.
      .add({ id: "earth-ping-1", targets: ["earth-halo"], property: "scale", from: 1, to: 2.6, start: at("one-job", 0.2), end: at("one-job", 0.7), origin: { x: 0, y: 0 } })
      .add({ id: "earth-ping-1-fade", targets: ["earth-halo"], property: "opacity", from: 0.9, to: 0, start: at("one-job", 0.2), end: at("one-job", 0.7) })
      .add({ id: "earth-ping-2-reset", targets: ["earth-halo"], property: "scale", from: 2.6, to: 1, start: at("one-job", 0.7), end: at("one-job", 0.74), easing: "hold", origin: { x: 0, y: 0 } })
      .add({ id: "earth-ping-2-reset-fade", targets: ["earth-halo"], property: "opacity", from: 0, to: 0.9, start: at("one-job", 0.7), end: at("one-job", 0.74), easing: "hold" })
      .add({ id: "earth-ping-2", targets: ["earth-halo"], property: "scale", from: 1, to: 2.6, start: at("one-job", 0.74), end: at("not-coming-back", 0.3), origin: { x: 0, y: 0 } })
      .add({ id: "earth-ping-2-fade", targets: ["earth-halo"], property: "opacity", from: 0.9, to: 0, start: at("one-job", 0.74), end: at("not-coming-back", 0.3) })
      // The system shrinks with the sun, then flattens into the plane the craft is about to leave.
      .add({ id: "rings-shrink-x-1", targets: ["home-rings"], property: "scaleX", from: 1, to: 0.62, start: from("falling-outward"), end: at("jupiter", 0.2), origin: { x: 0, y: 0 } })
      .add({ id: "rings-shrink-x-2", targets: ["home-rings"], property: "scaleX", from: 0.62, to: 0.42, start: from("saturn"), end: to("saturn"), origin: { x: 0, y: 0 } })
      .add({ id: "rings-flatten-x", targets: ["home-rings"], property: "scaleX", from: 0.42, to: 0.54, start: from("out-of-plane"), end: to("out-of-plane"), origin: { x: 0, y: 0 } })
      .add({ id: "rings-shrink-y-1", targets: ["home-rings"], property: "scaleY", from: 1, to: 0.62, start: from("falling-outward"), end: at("jupiter", 0.2), origin: { x: 0, y: 0 } })
      .add({ id: "rings-shrink-y-2", targets: ["home-rings"], property: "scaleY", from: 0.62, to: 0.42, start: from("saturn"), end: to("saturn"), origin: { x: 0, y: 0 } })
      .add({ id: "rings-flatten", targets: ["home-rings"], property: "scaleY", from: 0.42, to: 0.045, start: from("out-of-plane"), end: at("out-of-plane", 0.8), origin: { x: 0, y: 0 } })
      .add({ id: "rings-fall-away", targets: ["home-rings"], property: "translateY", from: 0, to: 92, start: from("out-of-plane"), end: to("out-of-plane"), easing: "linear" })
      .add({ id: "rings-emphasise", targets: ["home-rings"], property: "opacity", from: 1, to: 0.95, start: at("out-of-plane", 0.05), end: at("out-of-plane", 0.4) })
      .add({ id: "rings-gone", targets: ["home-rings"], property: "opacity", from: 0.95, to: 0, start: at("out-of-plane", 0.7), end: at("nothing-but-distance", 0.5) })
      .build(),
  };

  // ------------------------------------------------------------------ Jupiter
  const jupiter: EnvironmentAsset = {
    assetId: "jupiter",
    svgSource: "videos/still-talking/visuals/jupiter.svg",
    layer: 6,
    position: PLACEMENT.insert,
    scale: 1,
    rotation: 0,
    opacity: 1,
    animation: new Timeline("jupiter-passage", durationFrames)
      .add({ id: "jup-fade-in", targets: ["jupiter-body"], property: "opacity", from: 0, to: 1, start: at("falling-outward", 0.78), end: at("jupiter", 0.12) })
      .add({ id: "jup-approach", targets: ["jupiter-body"], property: "translateX", from: 1780, to: 80, start: at("falling-outward", 0.82), end: at("jupiter", 0.84), easing: "expoOut" })
      .add({ id: "jup-depart", targets: ["jupiter-body"], property: "translateX", from: 80, to: -2140, start: at("slingshot", 0.05), end: at("saturn", 0.06), easing: "expoIn" })
      .add({ id: "jup-loom", targets: ["jupiter-body"], property: "scale", from: 0.5, to: 1.9, start: at("falling-outward", 0.82), end: at("jupiter", 0.84), origin: { x: 0, y: 0 }, easing: "expoOut" })
      .add({ id: "jup-pass", targets: ["jupiter-body"], property: "scale", from: 1.9, to: 2.45, start: at("slingshot", 0.05), end: at("saturn", 0.06), origin: { x: 0, y: 0 }, easing: "expoIn" })
      .add({ id: "jup-fade-out", targets: ["jupiter-body"], property: "opacity", from: 1, to: 0, start: at("slingshot", 0.74), end: at("saturn", 0.04) })
      // The bands shear against each other, which is the one thing a still of Jupiter cannot show.
      .add({ id: "bands-a", targets: ["jup-band-1", "jup-band-4"], property: "translateX", from: 0, to: 48, start: at("jupiter", 0.02), end: at("saturn", 0.04), easing: "linear" })
      .add({ id: "bands-b", targets: ["jup-band-2", "jup-band-5"], property: "translateX", from: 0, to: -40, start: at("jupiter", 0.02), end: at("saturn", 0.04), easing: "linear" })
      .add({ id: "bands-c", targets: ["jup-band-3", "jup-band-6"], property: "translateX", from: 0, to: 22, start: at("jupiter", 0.02), end: at("saturn", 0.04), easing: "linear" })
      .add({ id: "spot-turn", targets: ["jup-spot", "jup-spot-core"], property: "rotate", from: 0, to: 26, start: at("jupiter", 0.02), end: at("saturn", 0.04), origin: { x: -62, y: 64 }, easing: "linear" })
      .add({ id: "spot-drift", targets: ["jup-spot", "jup-spot-core"], property: "translateX", from: 0, to: 34, start: at("jupiter", 0.02), end: at("saturn", 0.04), easing: "linear" })
      .add({ id: "terminator-sweep", targets: ["jup-terminator"], property: "opacity", from: 0.8, to: 1, start: at("jupiter", 0.1), end: at("slingshot", 0.9), easing: "linear" })
      .build(),
  };

  // ------------------------------------------------------------ Saturn, Titan
  const saturn: EnvironmentAsset = {
    assetId: "saturn",
    svgSource: "videos/still-talking/visuals/saturn.svg",
    layer: 7,
    position: PLACEMENT.insert,
    scale: 1,
    rotation: 0,
    opacity: 1,
    animation: new Timeline("saturn-encounter", durationFrames)
      .add({ id: "sat-fade-in", targets: ["saturn-body", "titan-body"], property: "opacity", from: 0, to: 1, start: at("slingshot", 0.72), end: at("saturn", 0.12) })
      .add({ id: "sat-approach", targets: ["saturn-body"], property: "translateX", from: 1820, to: 60, start: at("slingshot", 0.76), end: at("saturn", 0.9), easing: "expoOut" })
      .add({ id: "sat-depart", targets: ["saturn-body"], property: "translateX", from: 60, to: -2180, start: at("out-of-plane", 0.06), end: at("nothing-but-distance", 0.1), easing: "expoIn" })
      .add({ id: "sat-loom", targets: ["saturn-body"], property: "scale", from: 0.45, to: 1.5, start: at("slingshot", 0.76), end: at("saturn", 0.9), origin: { x: 0, y: 0 }, easing: "expoOut" })
      .add({ id: "sat-pass", targets: ["saturn-body"], property: "scale", from: 1.5, to: 1.82, start: at("out-of-plane", 0.06), end: at("nothing-but-distance", 0.1), origin: { x: 0, y: 0 }, easing: "expoIn" })
      .add({ id: "titan-approach", targets: ["titan-body"], property: "translateX", from: 1820, to: 60, start: at("slingshot", 0.76), end: at("saturn", 0.9), easing: "expoOut" })
      .add({ id: "titan-depart", targets: ["titan-body"], property: "translateX", from: 60, to: -2180, start: at("out-of-plane", 0.06), end: at("nothing-but-distance", 0.1), easing: "expoIn" })
      .add({ id: "titan-loom", targets: ["titan-body"], property: "scale", from: 0.45, to: 0.82, start: at("slingshot", 0.76), end: at("saturn", 0.9), origin: { x: 0, y: 0 }, easing: "expoOut" })
      .add({ id: "titan-pass", targets: ["titan-body"], property: "scale", from: 0.82, to: 0.98, start: at("out-of-plane", 0.06), end: at("nothing-but-distance", 0.1), origin: { x: 0, y: 0 }, easing: "expoIn" })
      .add({ id: "sat-fade-out", targets: ["saturn-body", "titan-body"], property: "opacity", from: 1, to: 0, start: at("out-of-plane", 0.7), end: at("nothing-but-distance", 0.08) })
      // The rings draw themselves on as the craft arrives, back halves first.
      .add({ id: "rings-draw", targets: ringIds(), property: "drawOn", from: 0, to: 1, start: at("saturn", 0.1), end: at("saturn", 0.56), stagger: 16, easing: "linear" })
      // Titan's atmosphere is the discovery that cost the craft the rest of its tour.
      .add({ id: "haze-found", targets: ["titan-haze", "titan-haze-ring"], property: "opacity", from: 0, to: 1, start: word("saturn", "atmosphere"), end: word("saturn", "one", "end") })
      .add({ id: "haze-swell", targets: ["titan-haze-ring"], property: "scale", from: 1, to: 1.55, start: at("saturn", 0.64), end: at("out-of-plane", 0.2), origin: { x: 0, y: 0 } })
      .add({ id: "haze-fade", targets: ["titan-haze", "titan-haze-ring"], property: "opacity", from: 1, to: 0.35, start: at("out-of-plane", 0.25), end: at("out-of-plane", 0.6) })
      .build(),
  };

  // ------------------------------------------------------- the sixty frames
  const surveyOrigin = { x: 100.5, y: 25.5 };
  const survey: EnvironmentAsset = {
    assetId: "survey",
    svgSource: "videos/still-talking/visuals/survey.svg",
    layer: 8,
    position: PLACEMENT.insert,
    scale: 1,
    rotation: 0,
    opacity: 1,
    animation: new Timeline("survey-of-home", durationFrames)
      .add({ id: "survey-in", targets: ["survey-body"], property: "opacity", from: 0, to: 1, start: at("sixty-photographs", 0.02), end: at("sixty-photographs", 0.4) })
      .add({ id: "survey-settle", targets: ["survey-body"], property: "scale", from: 1.18, to: 1.35, start: at("sixty-photographs", 0.02), end: at("sixty-photographs", 0.55), origin: surveyOrigin })
      .add({ id: "survey-dive", targets: ["survey-body"], property: "scale", from: 1.35, to: 5, start: at("pale-blue-pixel", 0.12), end: at("pale-blue-pixel", 0.98), origin: surveyOrigin, easing: "expoIn" })
      .add({ id: "survey-out", targets: ["survey-body"], property: "opacity", from: 1, to: 0, start: at("pale-blue-pixel", 0.2), end: at("pale-blue-pixel", 0.9) })
      // Sixty plates, taken one after another. The stagger is the shutter.
      .add({ id: "plates-taken", targets: cellIds(), property: "opacity", from: 0, to: 1, start: at("sixty-photographs", 0.08), end: at("sixty-photographs", 0.18), stagger: 2 })
      .add({ id: "sweep-in", targets: ["survey-sweep"], property: "opacity", from: 0, to: 0.85, start: at("sixty-photographs", 0.06), end: at("sixty-photographs", 0.24) })
      .add({ id: "sweep-across", targets: ["survey-sweep"], property: "translateX", from: 0, to: 690, start: at("sixty-photographs", 0.08), end: at("sixty-photographs", 0.94), easing: "linear" })
      .add({ id: "sweep-out", targets: ["survey-sweep"], property: "opacity", from: 0.85, to: 0, start: at("sixty-photographs", 0.86), end: at("pale-blue-pixel", 0.06) })
      .add({ id: "mark-found", targets: ["survey-mark"], property: "opacity", from: 0, to: 1, start: at("pale-blue-pixel", 0.01), end: at("pale-blue-pixel", 0.24) })
      .add({ id: "mark-out", targets: ["survey-mark"], property: "opacity", from: 1, to: 0, start: at("pale-blue-pixel", 0.5), end: at("pale-blue-pixel", 0.9) })
      .build(),
  };

  // ------------------------------------------------------------- the plate
  const speckOrigin = { x: 96, y: -46 };
  const plate: EnvironmentAsset = {
    assetId: "plate",
    svgSource: "videos/still-talking/visuals/plate.svg",
    layer: 9,
    position: PLACEMENT.insert,
    scale: 1,
    rotation: 0,
    opacity: 1,
    animation: new Timeline("pale-blue-dot", durationFrames)
      .add({ id: "plate-in", targets: ["plate-body"], property: "opacity", from: 0, to: 1, start: at("pale-blue-pixel", 0.12), end: at("pale-blue-pixel", 0.66) })
      .add({ id: "plate-open", targets: ["plate-body"], property: "scale", from: 0.45, to: 1.3, start: at("pale-blue-pixel", 0.12), end: at("pale-blue-pixel", 0.98), origin: speckOrigin })
      // The longest, slowest push in the film sits on the line about everyone who ever lived.
      .add({ id: "plate-hold", targets: ["plate-body"], property: "scale", from: 1.3, to: 1.6, start: from("that-is-everyone"), end: at("eyes-closed", 0.2), origin: speckOrigin, easing: "linear" })
      .add({ id: "plate-out", targets: ["plate-body"], property: "opacity", from: 1, to: 0, start: at("eyes-closed", 0.3), end: at("eyes-closed", 0.94) })
      .add({ id: "reticle-in", targets: ["reticle"], property: "opacity", from: 0, to: 0.95, start: at("pale-blue-pixel", 0.36), end: at("pale-blue-pixel", 0.66) })
      .add({ id: "reticle-close", targets: ["reticle"], property: "scale", from: 2.7, to: 1, start: at("pale-blue-pixel", 0.36), end: at("pale-blue-pixel", 0.96), origin: speckOrigin })
      .add({ id: "reticle-release", targets: ["reticle"], property: "scale", from: 1, to: 2.3, start: at("eyes-closed", 0.02), end: at("eyes-closed", 0.5), origin: speckOrigin })
      .add({ id: "reticle-out", targets: ["reticle"], property: "opacity", from: 0.95, to: 0, start: at("eyes-closed", 0.02), end: at("eyes-closed", 0.44) })
      .add({ id: "speck-settle", targets: ["speck"], property: "scale", from: 0.55, to: 1.25, start: at("pale-blue-pixel", 0.5), end: at("pale-blue-pixel", 0.94), origin: speckOrigin })
      .add({ id: "speck-rest", targets: ["speck"], property: "scale", from: 1.25, to: 1, start: from("that-is-everyone"), end: at("that-is-everyone", 0.4), origin: speckOrigin })
      // It pings twice while the narration says what it is. Then it stops.
      .add({ id: "halo-ping-1", targets: ["speck-halo"], property: "scale", from: 1, to: 2.8, start: at("that-is-everyone", 0.06), end: at("that-is-everyone", 0.46), origin: speckOrigin })
      .add({ id: "halo-ping-1-fade", targets: ["speck-halo"], property: "opacity", from: 0.85, to: 0, start: at("that-is-everyone", 0.06), end: at("that-is-everyone", 0.46) })
      .add({ id: "halo-reset", targets: ["speck-halo"], property: "scale", from: 2.8, to: 1, start: at("that-is-everyone", 0.46), end: at("that-is-everyone", 0.5), easing: "hold", origin: speckOrigin })
      .add({ id: "halo-reset-fade", targets: ["speck-halo"], property: "opacity", from: 0, to: 0.85, start: at("that-is-everyone", 0.46), end: at("that-is-everyone", 0.5), easing: "hold" })
      .add({ id: "halo-ping-2", targets: ["speck-halo"], property: "scale", from: 1, to: 2.8, start: at("that-is-everyone", 0.5), end: at("that-is-everyone", 0.95), origin: speckOrigin })
      .add({ id: "halo-ping-2-fade", targets: ["speck-halo"], property: "opacity", from: 0.85, to: 0, start: at("that-is-everyone", 0.5), end: at("that-is-everyone", 0.95) })
      .add({ id: "beam-drift", targets: ["beam-wide"], property: "translateX", from: 0, to: -30, start: at("pale-blue-pixel", 0.2), end: at("eyes-closed", 0.9), easing: "linear" })
      .add({ id: "beam-narrow-drift", targets: ["beam-narrow"], property: "translateX", from: 0, to: 22, start: at("pale-blue-pixel", 0.2), end: at("eyes-closed", 0.9), easing: "linear" })
      .add({ id: "scanlines-settle", targets: ["plate-scanlines"], property: "opacity", from: 1, to: 0.32, start: at("pale-blue-pixel", 0.25), end: at("that-is-everyone", 0.3) })
      .build(),
  };

  // ------------------------------------------------------------------- sun
  const sun: EnvironmentAsset = {
    assetId: "sun",
    svgSource: "videos/still-talking/visuals/sun.svg",
    layer: 10,
    position: PLACEMENT.sun,
    scale: 1,
    rotation: 0,
    opacity: 1,
    animation: new Timeline("sun-recedes", durationFrames)
      .add({ id: "sun-shrink-1", targets: ["sun-body"], property: "scale", from: 1, to: 0.62, start: from("falling-outward"), end: at("jupiter", 0.24), origin: { x: 0, y: 0 } })
      .add({ id: "sun-shrink-2", targets: ["sun-body"], property: "scale", from: 0.62, to: 0.4, start: from("saturn"), end: at("out-of-plane", 0.1), origin: { x: 0, y: 0 } })
      .add({ id: "sun-shrink-3", targets: ["sun-body"], property: "scale", from: 0.4, to: 0.26, start: from("turn-around"), end: at("sixty-photographs", 0.3), origin: { x: 0, y: 0 } })
      .add({ id: "sun-shrink-4", targets: ["sun-body"], property: "scale", from: 0.26, to: 0.15, start: from("particles-change"), end: at("across-the-edge", 0.3), origin: { x: 0, y: 0 } })
      .add({ id: "sun-becomes-a-star", targets: ["sun-body"], property: "scale", from: 0.15, to: 0.1, start: from("going-dark"), end: at("keep-going", 0.1), origin: { x: 0, y: 0 } })
      .add({ id: "rays-fade", targets: ["sun-rays"], property: "opacity", from: 1, to: 0, start: from("falling-outward"), end: at("jupiter", 0.75) })
      .add({ id: "halo-thin-1", targets: ["sun-halo"], property: "opacity", from: 1, to: 0.5, start: from("falling-outward"), end: at("jupiter", 0.75) })
      .add({ id: "halo-thin-2", targets: ["sun-halo"], property: "opacity", from: 0.5, to: 0.2, start: from("turn-around"), end: at("sixty-photographs", 0.6) })
      .add({ id: "halo-gone", targets: ["sun-halo"], property: "opacity", from: 0.2, to: 0, start: from("particles-change"), end: at("across-the-edge", 0.6) })
      .add({ id: "corona-thin", targets: ["sun-corona"], property: "opacity", from: 1, to: 0.3, start: from("saturn"), end: at("nothing-but-distance", 0.4) })
      .add({ id: "corona-gone", targets: ["sun-corona"], property: "opacity", from: 0.3, to: 0, start: from("particles-change"), end: at("last-breath", 0.6) })
      .build(),
  };

  // ----------------------------------------------------------------- the craft
  const probe: EnvironmentAsset = {
    assetId: "probe",
    svgSource: "videos/still-talking/visuals/probe.svg",
    layer: 11,
    position: PLACEMENT.probe,
    scale: 1,
    rotation: 0,
    opacity: 1,
    animation: buildProbeTimeline({ at, from, to, word, durationFrames }),
  };

  // -------------------------------------------------------------- the record
  const record: EnvironmentAsset = {
    assetId: "record",
    svgSource: "videos/still-talking/visuals/record.svg",
    layer: 12,
    position: PLACEMENT.recordOnFlank,
    scale: 1,
    rotation: 0,
    opacity: 1,
    animation: new Timeline("golden-record", durationFrames)
      // The record grows out of the disc on the craft's flank and returns to it.
      .add({ id: "record-in", targets: ["record-body"], property: "opacity", from: 0, to: 1, start: at("the-record", 0.02), end: at("the-record", 0.14) })
      .add({ id: "record-open", targets: ["record-body"], property: "scale", from: 0.07, to: 2.1, start: at("the-record", 0.04), end: at("the-record", 0.36), origin: { x: 0, y: 0 } })
      .add({ id: "record-to-centre-x", targets: ["record-body"], property: "translateX", from: 0, to: -152, start: at("the-record", 0.04), end: at("the-record", 0.36), easing: "linear" })
      .add({ id: "record-to-centre-y", targets: ["record-body"], property: "translateY", from: 0, to: -384, start: at("the-record", 0.04), end: at("the-record", 0.36), easing: "linear" })
      // One continuous groove, traced from the outside in while the record turns under it.
      .add({ id: "groove-cut", targets: ["rec-groove"], property: "drawOn", from: 0, to: 1, start: at("the-record", 0.18), end: at("the-record", 0.82), easing: "linear" })
      .add({ id: "record-turn", targets: ["record-body"], property: "rotate", from: 0, to: 38, start: at("the-record", 0.06), end: to("the-record"), origin: { x: 0, y: 0 }, easing: "linear" })
      .add({ id: "sheen-sweep", targets: ["rec-sheen"], property: "translateX", from: -80, to: 280, start: at("the-record", 0.1), end: at("the-record", 0.95), easing: "linear" })
      // The instructions etched on the cover, drawn ray by ray.
      .add({ id: "pulsar-in", targets: ["rec-pulsar-map"], property: "opacity", from: 0, to: 1, start: at("the-record", 0.56), end: at("the-record", 0.66) })
      .add({ id: "pulsar-rays", targets: pulsarRayIds(), property: "drawOn", from: 0, to: 1, start: at("the-record", 0.58), end: at("the-record", 0.68), stagger: 8, easing: "linear" })
      // Then they let it go: the record shrinks back to a speck on a craft that is suddenly small.
      .add({ id: "record-close", targets: ["record-body"], property: "scale", from: 2.1, to: 0.07, start: from("let-go"), end: at("falling-outward", 0.3), origin: { x: 0, y: 0 }, easing: "expoOut" })
      .add({ id: "record-home-x", targets: ["record-body"], property: "translateX", from: -152, to: 0, start: from("let-go"), end: at("falling-outward", 0.3), easing: "expoOut" })
      .add({ id: "record-home-y", targets: ["record-body"], property: "translateY", from: -384, to: 0, start: from("let-go"), end: at("falling-outward", 0.3), easing: "expoOut" })
      .add({ id: "record-out", targets: ["record-body"], property: "opacity", from: 1, to: 0, start: from("let-go"), end: at("falling-outward", 0.22) })
      .build(),
  };

  // --------------------------------------------------------- the road behind
  // The path draws itself as the craft actually flies it, so the lower band fills in over the
  // first two acts rather than being present from frame one, and then recedes for the rest.
  const trajectory: EnvironmentAsset = {
    assetId: "trajectory",
    svgSource: "videos/still-talking/visuals/trajectory.svg",
    layer: 4,
    position: PLACEMENT.trajectory,
    // Smaller than every other asset on purpose: at scale 1 the curve's own highest point (the
    // whip up to the edge waypoint) sits above world y 1500 and leaks into the wide cut. Shrinking
    // it is what buys the headroom to keep the whole curve, including that point, below the line.
    scale: 0.8,
    rotation: 0,
    opacity: 1,
    animation: new Timeline("flight-path", durationFrames)
      .add({ id: "path-in", targets: ["trajectory-body"], property: "opacity", from: 0, to: 1, start: at("one-job", 0.1), end: at("one-job", 0.7) })
      .add({ id: "path-leg-1", targets: ["traj-path", "traj-path-glow"], property: "drawOn", from: 0, to: 0.2, start: at("one-job", 0.2), end: to("let-go"), easing: "linear" })
      .add({ id: "path-leg-2", targets: ["traj-path", "traj-path-glow"], property: "drawOn", from: 0.2, to: 0.42, start: from("falling-outward"), end: at("jupiter", 0.9), easing: "linear" })
      .add({ id: "path-leg-3", targets: ["traj-path", "traj-path-glow"], property: "drawOn", from: 0.42, to: 0.64, start: from("slingshot"), end: at("saturn", 0.9), easing: "linear" })
      .add({ id: "path-leg-4", targets: ["traj-path", "traj-path-glow"], property: "drawOn", from: 0.64, to: 0.82, start: from("out-of-plane"), end: at("turn-around", 0.6), easing: "linear" })
      .add({ id: "path-leg-5", targets: ["traj-path", "traj-path-glow"], property: "drawOn", from: 0.82, to: 1, start: from("particles-change"), end: at("across-the-edge", 0.8), easing: "linear" })
      // Once it is complete the road slides away behind the craft for the rest of the film.
      .add({ id: "path-recede", targets: ["trajectory-body"], property: "translateX", from: 0, to: -230, start: from("still-out-there"), end: durationFrames, easing: "linear" })
      .add({ id: "path-settle", targets: ["trajectory-body"], property: "opacity", from: 1, to: 0.6, start: from("still-out-there"), end: at("twenty-two-watts", 0.6) })
      // Each waypoint lights as the craft reaches the place it marks.
      .add({ id: "mark-jupiter", targets: ["waypoint-jupiter"], property: "opacity", from: 0, to: 1, start: at("jupiter", 0.2), end: at("jupiter", 0.6) })
      .add({ id: "mark-saturn", targets: ["waypoint-saturn"], property: "opacity", from: 0, to: 1, start: at("saturn", 0.2), end: at("saturn", 0.6) })
      .add({ id: "mark-edge", targets: ["waypoint-edge"], property: "opacity", from: 0, to: 1, start: at("across-the-edge", 0.2), end: at("across-the-edge", 0.7) })
      .build(),
  };

  // ------------------------------------------------------------------ scrim
  const scrim: EnvironmentAsset = {
    assetId: "scrim",
    svgSource: "videos/still-talking/visuals/scrim.svg",
    layer: 13,
    position: PLACEMENT.centre,
    scale: 4.8,
    rotation: 0,
    opacity: 1,
    animation: buildScrimTimeline({ at, from, to, word, durationFrames }),
  };

  return {
    schemaVersion: "1.0.0",
    sceneId: "still-talking",
    fps: FPS,
    durationFrames,
    audioSource: "videos/still-talking/voiceover.wav",
    audioDurationMs: Math.round(timing.totalDurationSec * 1000),
    sceneSize: SCENE_SIZE,
    background: space,
    props: [
      starsFar,
      starsNear,
      boundary,
      trajectory,
      homeSystem,
      jupiter,
      saturn,
      survey,
      plate,
      sun,
      probe,
      record,
      scrim,
    ],
    actors: [],
  };
}

/** Frame helpers threaded into the larger timeline builders. */
interface FrameHelpers {
  at: (shotId: string, fraction?: number) => number;
  from: (shotId: string) => number;
  to: (shotId: string) => number;
  /** Frame a phrase is spoken at, so a cue can land on a word rather than on a fraction. */
  word: (shotId: string, phrase: string, edge?: "start" | "end") => number;
  durationFrames: number;
}

/**
 * Builds the craft's own timeline: how it is framed, how it unfolds, how it turns to look back,
 * and how it goes dark one lamp at a time. This is the longest timeline in the film because the
 * craft is the only thing on screen in every shot of it.
 */
function buildProbeTimeline({ at, from, to, word, durationFrames }: FrameHelpers) {
  const timeline = new Timeline("voyager", durationFrames);
  const centre = { x: 0, y: 0 };

  // How close the camera sits to the craft, shot by shot. Every value carries from the last.
  const framing: Array<[string, number, number, number, number]> = [
    ["frame-open", 0, 150, 0.46, 0.52],
    ["frame-one-job", at("one-job", 0), at("one-job", 0.9), 0.52, 1.3],
    ["frame-record-push", at("the-record", 0), at("the-record", 0.34), 1.3, 1.75],
    ["frame-let-go", from("let-go"), at("falling-outward", 0.5), 1.75, 0.7],
    ["frame-jupiter", from("jupiter"), at("jupiter", 0.75), 0.7, 0.62],
    ["frame-slingshot", from("slingshot"), at("slingshot", 0.74), 0.62, 0.8],
    ["frame-saturn", from("saturn"), at("saturn", 0.7), 0.8, 0.6],
    ["frame-turn", from("turn-around"), at("turn-around", 0.78), 0.6, 0.9],
    ["frame-survey", from("sixty-photographs"), at("sixty-photographs", 0.9), 0.9, 0.5],
    ["frame-edge", from("particles-change"), at("particles-change", 0.9), 0.5, 0.64],
    ["frame-close", from("still-out-there"), at("twenty-two-watts", 0.24), 0.64, 0.88],
    ["frame-dark", from("going-dark"), at("going-dark", 0.9), 0.88, 0.78],
    ["frame-away", from("keep-going"), durationFrames, 0.78, 0.72],
  ];
  for (const [id, start, end, fromScale, toScale] of framing) {
    timeline.add({ id, targets: ["probe-body"], property: "scale", from: fromScale, to: toScale, start, end, origin: centre });
  }

  // A slow float, with the one real climb in the film: up and out of the plane of the planets.
  const float: Array<[string, number, number, number, number, SvgEasing?]> = [
    ["float-1", at("one-job", 0), at("not-coming-back", 0.4), 0, -18],
    ["float-2", at("the-record", 0), at("the-record", 0.6), -18, -46],
    ["float-3", from("let-go"), at("jupiter", 0.3), -46, 8],
    ["float-4", from("slingshot"), at("slingshot", 0.95), 8, -28],
    ["climb-out-of-plane", from("out-of-plane"), to("out-of-plane"), -28, -98, "expoOut"],
    ["float-5", from("turn-around"), at("sixty-photographs", 0.4), -98, -72],
    ["drop-below-the-plate", from("pale-blue-pixel"), at("pale-blue-pixel", 0.6), -72, 34],
    ["float-6", from("particles-change"), at("last-breath", 0.6), 34, -92],
    ["float-7", from("still-out-there"), at("twenty-two-watts", 0.7), -92, -66],
    ["float-8", from("keep-going"), durationFrames, -66, -18],
  ];
  for (const [id, start, end, fromY, toY, easing] of float) {
    timeline.add({ id, targets: ["probe-body"], property: "translateY", from: fromY, to: toY, start, end, ...(easing ? { easing } : {}) });
  }

  timeline
    // It steals a little speed from the giant, and the whole frame feels it.
    .add({ id: "whip-out", targets: ["probe-body"], property: "translateX", from: 0, to: 108, start: from("slingshot"), end: at("slingshot", 0.56), easing: "expoIn" })
    .add({ id: "whip-settle", targets: ["probe-body"], property: "translateX", from: 108, to: 0, start: at("slingshot", 0.56), end: at("saturn", 0.3), easing: "expoOut" })
    .add({ id: "keep-going-drift", targets: ["probe-body"], property: "translateX", from: 0, to: 236, start: from("keep-going"), end: durationFrames, easing: "linear" })
    .add({ id: "tilt-out-of-plane", targets: ["probe-body"], property: "rotate", from: 0, to: -7, start: from("out-of-plane"), end: to("out-of-plane"), origin: centre })
    .add({ id: "tilt-away", targets: ["probe-body"], property: "rotate", from: -7, to: -11, start: from("keep-going"), end: durationFrames, origin: centre })

    // It arrives folded and unfolds itself: three booms, in the order they were deployed.
    .add({ id: "boom-sci-deploy", targets: ["probe-boom-sci"], property: "rotate", from: -46, to: 0, start: at("one-job", 0.1), end: at("one-job", 0.9), origin: { x: 26, y: 6 } })
    .add({ id: "boom-mag-deploy", targets: ["probe-boom-mag"], property: "rotate", from: 54, to: 0, start: at("one-job", 0.24), end: at("not-coming-back", 0.08), origin: { x: 18, y: -14 } })
    .add({ id: "boom-rtg-deploy", targets: ["probe-rtg"], property: "rotate", from: -58, to: 0, start: at("one-job", 0.4), end: at("not-coming-back", 0.24), origin: { x: 6, y: 14 } })

    // The lamps come up one by one. In the third act they go out the same way.
    .add({ id: "lamps-live", targets: ["lamp-sci-1", "lamp-sci-2", "lamp-sci-3", "lamp-mag-1"], property: "opacity", from: 0, to: 1, start: at("one-job", 0.6), end: at("one-job", 0.82), stagger: 14 })
    .add({ id: "radio-live", targets: ["lamp-radio"], property: "opacity", from: 0, to: 1, start: at("one-job", 0.54), end: at("one-job", 0.78) })
    .add({ id: "rtg-live", targets: ["rtg-glow"], property: "opacity", from: 0, to: 1, start: at("one-job", 0.7), end: at("not-coming-back", 0.1) })

    // Looking back is a mechanical act: the camera boom swings all the way round, then returns.
    .add({ id: "boom-sci-turn", targets: ["probe-boom-sci"], property: "rotate", from: 0, to: 166, start: word("turn-around", "asked"), end: word("turn-around", "time", "end"), origin: { x: 26, y: 6 }, easing: "expoInOut" })
    .add({ id: "boom-sci-return", targets: ["probe-boom-sci"], property: "rotate", from: 166, to: 0, start: at("eyes-closed", 0.16), end: at("eyes-closed", 0.92), origin: { x: 26, y: 6 }, easing: "expoInOut" })
    .add({ id: "shutter-1", targets: ["lamp-sci-1", "lamp-sci-2", "lamp-sci-3"], property: "opacity", from: 1, to: 0.25, start: at("sixty-photographs", 0.1), end: at("sixty-photographs", 0.2), stagger: 9 })
    .add({ id: "shutter-2", targets: ["lamp-sci-1", "lamp-sci-2", "lamp-sci-3"], property: "opacity", from: 0.25, to: 1, start: at("sixty-photographs", 0.3), end: at("sixty-photographs", 0.42), stagger: 9 })
    .add({ id: "cameras-off", targets: ["lamp-sci-1", "lamp-sci-2", "lamp-sci-3"], property: "opacity", from: 1, to: 0, start: at("eyes-closed", 0.2), end: at("eyes-closed", 0.46), stagger: 22 })

    // The signal thread reaches home in the first shot and never breaks until the last act.
    .add({ id: "thread-reaches", targets: ["signal-thread"], property: "drawOn", from: 0, to: 1, start: 24, end: 150, easing: "linear" })
    .add({ id: "thread-thins", targets: ["signal-thread"], property: "opacity", from: 1, to: 0.62, start: from("twenty-two-watts"), end: at("twenty-two-watts", 0.9) })
    .add({ id: "thread-stops-short", targets: ["signal-thread"], property: "drawOn", from: 1, to: 0.3, start: at("the-last-one", 0.16), end: at("the-last-one", 0.94), easing: "expoOut" })
    .add({ id: "thread-gone", targets: ["signal-thread"], property: "opacity", from: 0.62, to: 0, start: at("keep-going", 0.02), end: at("keep-going", 0.4) })

    // Going dark: instruments shut down one by one to keep the radio alive, and then that too.
    .add({ id: "mag-off", targets: ["lamp-mag-1"], property: "opacity", from: 1, to: 0, start: word("going-dark", "Instruments"), end: word("going-dark", "down", "end") })
    .add({ id: "rtg-cools", targets: ["rtg-glow"], property: "opacity", from: 1, to: 0, start: word("going-dark", "one by one"), end: word("going-dark", "alive", "end") })
    .add({ id: "rtg-dims", targets: ["rtg-1", "rtg-2", "rtg-3"], property: "opacity", from: 1, to: 0.3, start: word("going-dark", "one by one"), end: word("going-dark", "keep"), stagger: 12 })
    .add({ id: "radio-last", targets: ["lamp-radio"], property: "opacity", from: 1, to: 0, start: at("the-last-one", 0.1), end: at("the-last-one", 0.96) })

    // The record catches one last highlight as the craft turns away.
    .add({ id: "record-swells", targets: ["probe-record"], property: "scale", from: 1, to: 1.6, start: from("longer-than-the-sun"), end: durationFrames, origin: { x: 22, y: 24 } })
    .add({ id: "glint-dim", targets: ["record-glint"], property: "opacity", from: 1, to: 0.2, start: from("keep-going"), end: at("longer-than-the-sun", 0.2) })
    .add({ id: "glint-catches", targets: ["record-glint"], property: "opacity", from: 0.2, to: 1, start: at("longer-than-the-sun", 0.2), end: durationFrames });

  addSignalPulses(timeline, { at, from, to, word, durationFrames });
  return timeline.build();
}

/**
 * Adds the film's heartbeat: bursts of signal travelling the length of the thread toward home.
 * Each burst is its own set of clips rather than a loop, because every value in this engine is a
 * pure function of the frame index. A burst starts bright at the feed horn and dies before it
 * arrives, which is both what actually happens to the signal and the reason the jump back to the
 * dish is never visible.
 */
function addSignalPulses(timeline: Timeline, { at, from }: FrameHelpers): void {
  const targets = ["signal-pulse-1", "signal-pulse-2", "signal-pulse-3"];
  const travelX = -666;
  const travelY = 78;
  const cycle = 200;
  const travel = 130;
  const stagger = 34;

  const heartbeatEnd = from("twenty-two-watts");
  let burst = 0;
  for (let start = 40; start + travel + stagger * 2 <= heartbeatEnd; start += cycle) {
    burst += 1;
    timeline
      .add({ id: `pulse-${burst}-x`, targets, property: "translateX", from: 0, to: travelX, start, end: start + travel, stagger, easing: "linear", allowJump: true })
      .add({ id: `pulse-${burst}-y`, targets, property: "translateY", from: 0, to: travelY, start, end: start + travel, stagger, easing: "linear", allowJump: true })
      .add({ id: `pulse-${burst}-fade`, targets, property: "opacity", from: 0.95, to: 0, start, end: start + travel, stagger, easing: "expoIn", allowJump: true });
  }

  // Twenty two watts: one pulse, sent alone, thinning the whole way. The heartbeat stops for it.
  const soloStart = at("twenty-two-watts", 0.16);
  const soloEnd = at("twenty-two-watts", 0.94);
  timeline
    .add({ id: "solo-pulse-x", targets: ["signal-pulse-1"], property: "translateX", from: 0, to: travelX, start: soloStart, end: soloEnd, easing: "linear", allowJump: true })
    .add({ id: "solo-pulse-y", targets: ["signal-pulse-1"], property: "translateY", from: 0, to: travelY, start: soloStart, end: soloEnd, easing: "linear", allowJump: true })
    .add({ id: "solo-pulse-fade", targets: ["signal-pulse-1"], property: "opacity", from: 1, to: 0.06, start: soloStart, end: soloEnd, easing: "linear", allowJump: true })
    .add({ id: "solo-pulse-thin", targets: ["signal-pulse-1"], property: "scale", from: 1, to: 0.3, start: soloStart, end: soloEnd, origin: { x: 0, y: 0 }, easing: "linear" });

  // One last faint burst before the craft stops answering.
  const lastStart = at("going-dark", 0.2);
  const lastEnd = at("going-dark", 0.94);
  timeline
    .add({ id: "last-pulse-x", targets: ["signal-pulse-2"], property: "translateX", from: 0, to: travelX * 0.62, start: lastStart, end: lastEnd, easing: "linear", allowJump: true })
    .add({ id: "last-pulse-y", targets: ["signal-pulse-2"], property: "translateY", from: 0, to: travelY * 0.62, start: lastStart, end: lastEnd, easing: "linear", allowJump: true })
    .add({ id: "last-pulse-fade", targets: ["signal-pulse-2"], property: "opacity", from: 0.55, to: 0, start: lastStart, end: lastEnd, easing: "linear", allowJump: true });
}

/** Builds the scrim: it lifts under every card of on-screen text and drops again afterwards. */
function buildScrimTimeline({ at, from, durationFrames }: FrameHelpers) {
  const timeline = new Timeline("text-scrim", durationFrames);
  const beats: Array<[string, number, number, number, number, number]> = [
    // shot id fractions: rise start, rise end, fall start, fall end, and how dark it gets.
    ["departure", 0.06, 0.24, 0.84, 0.99, 0.44],
    ["jupiter", 0.02, 0.24, 0.68, 0.96, 0.34],
    ["saturn", 0.03, 0.26, 0.66, 0.95, 0.34],
    ["pale-blue-pixel", 0.06, 0.34, 0.66, 0.96, 0.3],
    ["particles-change", 0.04, 0.34, 0.62, 0.96, 0.34],
    ["twenty-two-watts", 0.03, 0.18, 0.64, 0.9, 0.3],
  ];
  beats.forEach(([shotId, riseFrom, riseTo, fallFrom, fallTo, depth], i) => {
    timeline
      .add({ id: `scrim-up-${i}`, targets: ["scrim-fill"], property: "opacity", from: 0, to: depth, start: at(shotId, riseFrom), end: at(shotId, riseTo) })
      .add({ id: `scrim-down-${i}`, targets: ["scrim-fill"], property: "opacity", from: depth, to: 0, start: at(shotId, fallFrom), end: at(shotId, fallTo) });
  });
  // The closing card holds to the last frame rather than dropping.
  timeline.add({ id: "scrim-close", targets: ["scrim-fill"], property: "opacity", from: 0, to: 0.34, start: from("keep-going"), end: at("keep-going", 0.34) });
  return timeline.build();
}

/** Ids of the six orbit rings, in the order they are drawn outward from the sun. */
function orbitIds(): string[] {
  return ["orbit-earth", "orbit-mars", "orbit-jupiter", "orbit-saturn", "orbit-uranus", "orbit-neptune"];
}

/** Ids of Saturn's ring arcs, back halves first so the planet reads as sitting between them. */
function ringIds(): string[] {
  return [
    "sat-ring-back-outer",
    "sat-ring-back-mid",
    "sat-ring-back-inner",
    "sat-ring-front-outer",
    "sat-ring-front-mid",
    "sat-ring-front-inner",
  ];
}

/** Ids of the sixty survey plates, in the order the pictures were taken. */
function cellIds(): string[] {
  return Array.from({ length: 60 }, (_, i) => `survey-cell-${i}`);
}

/** Ids of the solar wind streamers. */
function windIds(): string[] {
  return Array.from({ length: 14 }, (_, i) => `wind-${i + 1}`);
}

/** Ids of the interstellar medium particles waiting on the far side of the boundary. */
function ismIds(): string[] {
  return Array.from({ length: 34 }, (_, i) => `ism-${i + 1}`);
}

/** Ids of the fourteen pulsar rays etched on the record's cover. */
function pulsarRayIds(): string[] {
  return Array.from({ length: 14 }, (_, i) => `pulsar-ray-${i + 1}`);
}
