/**
 * File Description: Defines the core Zod schema contracts, film data structures, block types, and theme definitions for Aideos.
 * Inputs and outputs: raw film JSON objects -> Zod validated Film, Shot, CanvasNode, and Block instances.
 * Used by: src/dl/runtime.ts, src/dl/Film.tsx, editor/vite.config.ts, backend/pipeline/run.ts.
 */

import { z } from "zod";
import { stageTreatmentSchema, treatmentSpanSchema } from "./scene/materials/treatment";
import { castSchema, performanceSchema } from "./scene/stageContract";

/**
 * ---------------------------------------------------------------------------
 * DESIGN LANGUAGE: THE SCHEMA CONTRACT
 * ---------------------------------------------------------------------------
 * Implements §09. Three rules hold this together, and they are the reason there
 * is no per-video animation logic anywhere in `src/dl`:
 *
 *   1. Shots reference nodes, not coordinates. Layout solves the graph once; a
 *      shot just names what to look at. Reorder the script and the camera path
 *      re-solves itself.
 *   2. Order defines stagger. Block n enters at n × 70ms. No block declares its
 *      own delay, so nothing can drift out of rhythm with its siblings.
 *   3. Format only scales. "reel" vs "long" changes type scale and margin.
 *      Nothing structural.
 *
 * Shot `start` times are *derived* from durations rather than authored. The
 * older episode schema stored both and needed a validator to catch the gaps;
 * the fix is to make the invalid state unrepresentable.
 */

export const nodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes"),
  label: z.string().min(1).max(28),
  sub: z.string().max(34).optional(),
  /** Canvas-space position. One canvas per film; these never change. */
  x: z.number(),
  y: z.number(),
  w: z.number().min(80).max(640).default(190),
  h: z.number().min(48).max(320).default(62),
});

export const edgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** Dashed reads as "reused / cached / skipped" everywhere in the system. */
  dashed: z.boolean().default(false).optional(),
  label: z.string().optional(),
});

/**
 * The block library. A closed union, so a generator cannot name a component
 * that does not exist and silently produce an empty frame.
 *
 * `c` is the component. Everything else is its data: no styling, no timing,
 * no colour. A block that could specify its own colour would be a block that
 * could break §01.
 */
export const blockSchema = z.discriminatedUnion("c", [
  z.object({
    c: z.literal("Kicker"),
    text: z.string().min(1).max(48),
  }),
  z.object({
    c: z.literal("TextReveal"),
    text: z.string().min(1).max(180),
    size: z.enum(["display", "headline", "subhead"]).default("headline"),
    /** The one word carrying accent. Underlines itself as it lands. */
    accentWord: z.string().max(40).optional(),
  }),
  z.object({
    c: z.literal("Body"),
    text: z.string().min(1).max(340),
  }),
  z.object({
    c: z.literal("Math"),
    /** Set in italic serif. Wrap a token in *stars* to accent it. */
    text: z.string().min(1).max(90),
  }),
  z.object({
    c: z.literal("StatCounter"),
    to: z.number(),
    label: z.string().min(1).max(44),
    format: z.enum(["plain", "compact"]).default("plain"),
    suffix: z.string().max(10).optional(),
  }),
  z.object({
    c: z.literal("ProgressBar"),
    value: z.number().min(0).max(1),
    label: z.string().max(44).optional(),
    /** Segmented for long-form, continuous for reels. */
    chapters: z.number().int().min(2).max(12).optional(),
  }),
  z.object({
    c: z.literal("Plot"),
    /** Points in unit space, origin bottom-left. One line, one dot. */
    points: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(2).max(24),
    xLabel: z.string().max(16).optional(),
    yLabel: z.string().max(16).optional(),
    endLabel: z.string().max(16).optional(),
  }),
  z.object({
    c: z.literal("MatrixGrid"),
    values: z.array(z.array(z.number().min(0).max(1)).min(2).max(10)).min(2).max(8),
    rowLabel: z.string().max(18).optional(),
    colLabel: z.string().max(18).optional(),
    valueLabel: z.string().max(18).optional(),
    /** Sweep one row at a time, never all cells at once. */
    sweep: z.enum(["row", "cell"]).default("row"),
  }),
  z.object({
    c: z.literal("Distribution"),
    /** Use `___` to mark the blank being predicted. */
    prompt: z.string().max(80).optional(),
    items: z
      .array(z.object({ label: z.string().min(1).max(16), p: z.number().min(0).max(1) }))
      .min(2)
      .max(6),
    note: z.string().max(60).optional(),
  }),
  z.object({
    c: z.literal("TokenStrip"),
    tokens: z.array(z.string().min(1).max(14)).min(3).max(16),
    /** Indices already computed. The rest light up one by one. */
    lit: z.array(z.number().int().min(0)).default([]),
    caption: z.string().max(60).optional(),
  }).strict(),
  z.object({
    c: z.literal("AttentionArcs"),
    tokens: z.array(z.string().min(1).max(14)).min(3).max(9),
    /** Index of the token doing the looking. */
    focus: z.number().int().min(0),
    /** Indices it looks back at, strongest first. */
    links: z.array(z.number().int().min(0)).min(1).max(4),
    note: z.string().max(60).optional(),
  }),
  z.object({
    c: z.literal("VectorSpace"),
    points: z
      .array(
        z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          label: z.string().max(12).optional(),
        }),
      )
      .min(3)
      .max(14),
    /** The single labelled arrow. Never more than one. */
    arrow: z
      .object({ from: z.number().int().min(0), to: z.number().int().min(0), label: z.string().max(14) })
      .optional(),
    xLabel: z.string().max(16).optional(),
    yLabel: z.string().max(16).optional(),
  }),
  z.object({
    c: z.literal("LayerStack"),
    count: z.number().int().min(4).max(48).default(32).optional(),
    bottomLabel: z.string().max(22).optional(),
    topLabel: z.string().max(22).optional(),
    prompt: z.string().optional(),
    layers: z.array(z.union([z.string(), z.object({ label: z.string(), dim: z.string().optional() })])).optional(),
  }),
  z.object({
    c: z.literal("ScaleBar"),
    /** Log-spaced tick labels, e.g. ["1M", "1B", "100B", "1T"]. */
    ticks: z.array(z.string().min(1).max(8)).min(2).max(6),
    value: z.number().min(0).max(1),
    label: z.string().max(20).optional(),
  }),
  z.object({
    c: z.literal("AnalogyInset"),
    caption: z.string().min(1).max(80),
    /** Optional still in `public/`. Falls back to a drawn placeholder. */
    src: z.string().optional(),
    framesDir: z.string().optional(),
    totalFrames: z.number().optional(),
    delayFrames: z.number().optional(),
    fullScreenHero: z.boolean().optional(),
  }),
  z.object({
    c: z.literal("Card"),
    title: z.string().min(1).max(30),
    body: z.string().max(80).optional(),
    tag: z.string().max(30).optional(),
    state: z.enum(["idle", "active"]).default("idle"),
  }),
  z.object({ c: z.literal("Divider") }),
  z.object({
    c: z.literal("IconLabel"),
    text: z.string().min(1).max(60),
  }),
  z.object({
    c: z.literal("CodeBlock"),
    code: z.string().min(1).max(300),
    language: z.string().max(20).optional(),
    caption: z.string().max(60).optional(),
  }),
]);

export type Block = z.infer<typeof blockSchema>;

/**
 * Retired block kinds an older film can still carry. Both drew nothing (CharacterBeat no element,
 * MetaphorViewer an empty panel), so a film that names them still opens: parsing drops them.
 */
export const LEGACY_BLOCK_KINDS = ["MetaphorViewer", "CharacterBeat"] as const;

// Removes retired block kinds from a raw shot (or a timeline animation payload, same fields) before it
// is validated. A shot that held nothing else shows the bare canvas (stage "none"), not an empty panel.
export function dropLegacyBlocks(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const shot = raw as { blocks?: unknown };
  if (!Array.isArray(shot.blocks)) return raw;
  const blocks = shot.blocks.filter((block) => {
    const kind = block && typeof block === "object" ? (block as { c?: unknown }).c : undefined;
    return !(LEGACY_BLOCK_KINDS as readonly unknown[]).includes(kind);
  });
  if (blocks.length === shot.blocks.length) return raw;
  return { ...shot, blocks, ...(blocks.length === 0 ? { stage: "none" } : {}) };
}

// Applies dropLegacyBlocks to every shot of a raw film, for the paths that serve film.json unparsed.
export function dropLegacyFilmBlocks<T>(raw: T): T {
  if (!raw || typeof raw !== "object") return raw;
  const film = raw as { shots?: unknown };
  if (!Array.isArray(film.shots)) return raw;
  const shots = film.shots.map(dropLegacyBlocks);
  return shots.every((shot, i) => shot === (film.shots as unknown[])[i]) ? raw : ({ ...film, shots } as T);
}

/** Blocks that can hold the frame on their own. §07's device library. */
export const DEVICE_BLOCKS = [
  "MatrixGrid",
  "Distribution",
  "TokenStrip",
  "AttentionArcs",
  "VectorSpace",
  "LayerStack",
  "ScaleBar",
  "AnalogyInset",
  "Plot",
] as const;

const isDevice = (b: Block) =>
  (DEVICE_BLOCKS as readonly string[]).includes(b.c);

/** Blocks an inset shot may carry: the device library plus the counter (a precise number the narrator says). */
export const INSET_BLOCKS = [...DEVICE_BLOCKS, "StatCounter"] as const;

/** Blocks that spend one of the frame's three accents. */
const accentCost = (b: Block): number => {
  if (b.c === "TextReveal") return b.accentWord ? 1 : 0;
  if (b.c === "Card") return b.state === "active" ? 1 : 0;
  if (b.c === "StatCounter") return 1;
  if (b.c === "Math") return b.text.includes("*") ? 1 : 0;
  // Every device carries exactly one internal highlight by construction.
  return isDevice(b) ? 1 : 0;
};

/**
 * ---------------------------------------------------------------------------
 * THE SCENE LAYER
 * ---------------------------------------------------------------------------
 * A film's spatial canvas is either a node graph or a scene graph, never both.
 * `canvas` is the node graph; `scene` is the vector stage from `scene/types.ts`,
 * drawn from committed SVG assets and driven by declarative animation clips.
 *
 * Mirroring the scene contract in Zod is what lets a hand-authored timeline of
 * several hundred clips fail at bundle time with a field path, instead of
 * rendering a film with one prop silently missing.
 */
export const svgAnimationClipSchema = z.object({
  clipId: z.string().min(1),
  targets: z.array(z.string().min(1)).min(1),
  property: z.enum([
    "translateX",
    "translateY",
    "scale",
    "scaleX",
    "scaleY",
    "rotate",
    "opacity",
    "drawOn",
  ]),
  from: z.number(),
  to: z.number(),
  startFrame: z.number().int().min(0),
  durationFrames: z.number().int().min(1),
  easing: z.enum(["linear", "expoOut", "expoIn", "expoInOut", "hold"]).optional(),
  staggerFrames: z.number().int().min(0).optional(),
  origin: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const svgAnimationTimelineSchema = z.object({
  timelineId: z.string().min(1),
  clips: z.array(svgAnimationClipSchema),
});

export const environmentAssetSchema = z.object({
  plane: z.enum(["background", "foreground"]).optional(),
  assetId: z.string().min(1),
  svgSource: z.string().min(1).endsWith(".svg"),
  layer: z.number().int().optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  scale: z.number().positive(),
  rotation: z.number(),
  opacity: z.number().min(0).max(1),
  animation: svgAnimationTimelineSchema.optional(),
});

export const cameraKeyframeSchema = z.object({
  frame: z.number().int().min(0),
  center: z.object({ x: z.number(), y: z.number() }),
  zoom: z.number().positive(),
  rotation: z.number().optional(),
  easing: z.string().optional(),
});

export const cameraTrackSchema = z.object({
  keyframes: z.array(cameraKeyframeSchema),
});

export type CameraKeyframe = z.infer<typeof cameraKeyframeSchema>;
export type CameraTrack = z.infer<typeof cameraTrackSchema>;

export const sceneSchema = z.object({
  treatmentResourceHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  treatment: stageTreatmentSchema.optional(),
  treatments: z.array(treatmentSpanSchema).optional(),
  renderer: z.enum(["svg", "three"]).optional(),
  cast: z.array(castSchema).optional(),
  performances: z.array(performanceSchema).optional(),
  schemaVersion: z.string().min(1),
  sceneId: z.string().min(1),
  fps: z.number().int().positive(),
  durationFrames: z.number().int().positive(),
  audioSource: z.string().min(1),
  audioDurationMs: z.number().min(0),
  sceneSize: z.object({ w: z.number().positive(), h: z.number().positive() }),
  camera: cameraTrackSchema.optional(),
  background: environmentAssetSchema,
  props: z.array(environmentAssetSchema),
  actors: z.array(z.unknown()).default([]),
}).strict();

export type FilmScene = z.infer<typeof sceneSchema>;

/**
 * How a shot's blocks sit on the film's canvas. `anchor` grows a panel out of a node, `frame` prints
 * text straight onto the canvas, `none` shows the bare canvas, and `inset` (scene films only) puts
 * one device in the format's fixed inset region (`getInsetRegion`) while the scene stays at full
 * strength around it.
 */
export const stageSchema = z.enum(["anchor", "frame", "none", "inset"]).default("anchor");
export const lookSchema = z.union([z.string(), z.array(z.string()).min(1), z.literal("all")]);
export const moveSchema = z.enum(["pan", "zoom-in", "zoom-out", "hold", "cut"]).default("pan");

export const backgroundPresetSchema = z.enum([
  "paper-white",
  "parchment",
  "blueprint",
  "charcoal",
  "dot-grid",
  "smooth-dark",
]);

export const fontPresetSchema = z.enum([
  "geist",
  "mono",
  "serif",
  "space-grotesk",
  "inter",
]);

export const videoTypeSchema = z.enum([
  "educational",
  "fact",
  "case-study",
  "tutorial",
]);

export const storyStyleSchema = z.enum([
  "spatial-map",
  "script-metaphor",
]);

export const cameraAngleSchema = z.enum([
  "flat",
  "isometric",
  "cinematic-tilt",
  "low-angle",
  "orbit",
  "top-down",
]);

export const themeSchema = z.object({
  background: backgroundPresetSchema.optional(),
  fontFamily: fontPresetSchema.optional(),
  videoType: videoTypeSchema.optional(),
  storyStyle: storyStyleSchema.optional(),
  cameraAngle: cameraAngleSchema.optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

/** An owner-controlled caption placement; absent w keeps the content-sized auto card. */
export const captionPlacementSchema = z.object({
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1).optional(),
  locked: z.boolean().default(false),
}).strict();
export const captionPlacementByFormatSchema = z.object({
  long: captionPlacementSchema.optional(),
  reel: captionPlacementSchema.optional(),
}).strict();
export type CaptionPlacement = z.infer<typeof captionPlacementSchema>;
export type CaptionPlacementByFormat = z.infer<typeof captionPlacementByFormatSchema>;

export const shotSchema = z.preprocess(dropLegacyBlocks, z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  captionPlacement: captionPlacementByFormatSchema.optional(),
  ch: z.string().min(1).max(30).optional(),
  /** Timeline position where the clip sits (seconds). Stored data! */
  position: z.number().min(0).optional(),
  /** Source media in-point (seconds). Defaults to 0 */
  start: z.number().min(0).optional(),
  /** Source media out-point (seconds). Defaults to start + dur */
  end: z.number().min(0).optional(),
  /** Track / layer index (0 = main shots, 1 = b-roll/overlay, 2 = subtitles, etc.) */
  layer: z.number().int().min(0).max(10).optional(),
  /** Editor timeline lane this shot sits on. See timelineLayerSchema. */
  layerId: z.string().optional(),
  /** Legacy alias for position */
  startSec: z.number().min(0).optional(),
  dur: z.number().min(0.5).max(90),
  /** Legacy alias for start */
  inSec: z.number().min(0).optional(),
  /** Legacy alias for layer */
  track: z.number().int().min(0).max(10).optional(),
  stage: stageSchema,
  look: lookSchema,
  move: moveSchema.default("pan"),
  /** Camera angle & 3D perspective preset */
  cameraAngle: cameraAngleSchema.optional(),
  /** Hold the frame alive with a 100 → 104% push. */
  drift: z.boolean().default(false),
  /** Tighten or loosen the framing. 1 fits the target with standard padding. */
  zoom: z.number().min(0.4).max(2.5).default(1),
  /** Optional script/narration block that will be read aloud. */
  scriptText: z.string().optional(),
  /** Human or LLM visual direction notes for this shot. */
  visualDirection: z.string().optional(),
  /** Per-shot transition to use when entering this shot. */
  // eslint-disable-next-line @remotion/non-pure-animation
  transition: z.enum(["paper-rip", "zoom-morph", "matrix-glitch", "whip-pan", "film-burn"]).optional(),
  /** Optional semantic metaphor cue for script-driven visual depictions. */
  metaphor: z.enum(["spider-web", "liquid-bucket", "balance-scale", "clock-gears", "rocket-launch", "character-throw", "glowing-cluster", "typing-cursor-quote", "custom"]).optional(),
  /** Flag for visual pipeline B-roll generation */
  needsFootage: z.boolean().optional(),
  /** Narration / speech playback speed multiplier (e.g. 1.0x, 1.25x, 1.5x) */
  speed: z.number().min(0.25).max(4).default(1).optional(),
  blocks: z.array(blockSchema).max(12).default([]),
}));

export type CanvasNode = z.infer<typeof nodeSchema>;
export type CanvasEdge = z.infer<typeof edgeSchema>;
export type Shot = z.infer<typeof shotSchema>;
export type BackgroundPreset = z.infer<typeof backgroundPresetSchema>;
export type FontPreset = z.infer<typeof fontPresetSchema>;
export type VideoType = z.infer<typeof videoTypeSchema>;
export type StoryStyle = z.infer<typeof storyStyleSchema>;
export type CameraAngle = z.infer<typeof cameraAngleSchema>;
export type ThemeConfig = z.infer<typeof themeSchema>;

export const sfxItemSchema = z.object({
  timeSec: z.number().min(0),
  src: z.string().min(1),
  volume: z.number().min(0).max(2).default(1),
});

export const musicTrackSchema = z.object({
  src: z.string().min(1),
  volume: z.number().min(0).max(2).default(1),
  duckUnderVoiceover: z.boolean().default(true).optional(),
});

/**
 * Speech interval for Remotion sidechain ducking (Report Section 4.4 and Decision D6).
 * Measured from voiceover narration audio to detect real speech vs breath gaps.
 */
export const speechIntervalSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0),
}).superRefine((interval, ctx) => {
  if (interval.endSec <= interval.startSec) {
    ctx.addIssue({ code: "custom", path: ["endSec"], message: "endSec must be greater than startSec" });
  }
});

/**
 * A story-act soundtrack section (Report Sections 4.1, 4.9 and Decision D3).
 * Represents one musical stretch playing under a section of the narrative.
 */
export const soundtrackSectionSchema = z.object({
  /** Story act role: hook, explain, tension, payoff, outro (or custom). */
  role: z.string().default("explain"),
  /** Item id referencing the audio library (e.g. mk-554) or media path. */
  item: z.string().min(1),
  /** Optional SHA-256 hash for asset locking and reproducible renders. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  /** Resolved timeline start time in seconds. */
  from: z.number().min(0).default(0),
  /** Resolved timeline end time in seconds. */
  to: z.number().min(0),
  /** Offset seconds into the source audio track to start playback (used for back-timing outro). */
  offsetSec: z.number().min(0).default(0),
  /** Equal-power crossfade duration in seconds centered on section boundary (3s long, 1.5s reel). */
  crossfadeSec: z.number().min(0).default(0),
  /** Optional source file path for legacy or direct file media playback. */
  src: z.string().optional(),
  /** Backend-probed source channels so mono-to-stereo playback preserves measured loudness. */
  sourceChannels: z.number().int().min(1).max(32).optional(),
  /** Volume multiplier gain (default 1). */
  volume: z.number().min(0).max(2).default(1).optional(),
  /** Whether this section ducks under voiceover speech (default true). */
  duckUnderVoiceover: z.boolean().default(true).optional(),
}).superRefine((section, ctx) => {
  if (section.to <= section.from) {
    ctx.addIssue({ code: "custom", path: ["to"], message: "to must be greater than from" });
  }
});

/**
 * Mix levels, ducking depths, and target loudness settings (Report Sections 4.4, 4.5 and Decision D6).
 */
export const soundtrackMixSchema = z.object({
  /** Integrated loudness target in LUFS (-16 LUFS recommendation). */
  targetLufs: z.number().default(-16),
  /** Attenuation level in dB while voiceover speech is active (-18 dB under speech). */
  duckDb: z.number().default(-18),
  /** Attenuation level in dB during narration breath pauses (-10 dB in pauses). */
  pauseGainDb: z.number().default(-10),
  /** Level in dB during music-only moments such as the end card or pre-roll (-8 dB). */
  musicOnlyGainDb: z.number().default(-8),
  /** True peak ceiling in dBTP (-1 dBTP maximum ceiling). */
  maxTruePeakDb: z.number().default(-1).optional(),
  /** Optional master gain offset in dB applied at mastering. */
  masterGainDb: z.number().default(0).optional(),
});

/**
 * Sound effect tied to an on-screen visual event (Report Sections 4.7, 4.9 and Decision D5).
 */
export const soundtrackSfxSchema = z.object({
  /** Identifier of the sound effect from the audio library. */
  item: z.string().min(1),
  /** Optional SHA-256 hash of the sound effect asset. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  /** Timeline trigger position in seconds. */
  timeSec: z.number().min(0),
  /** Gain offset in decibels for this effect (-8 dB for hits/whooshes, -14 dB for UI ticks). */
  gainDb: z.number().default(0),
  /** The on-screen visual event this sound effect is bound to (e.g. camera-pan, chapter-cut, stat-counter). */
  event: z.string().optional(),
  /** Optional source file path for legacy or direct file media playback. */
  src: z.string().optional(),
  /** Volume multiplier gain (default 1). */
  volume: z.number().min(0).max(2).default(1).optional(),
});

export const soundtrackMixDefault = {
  targetLufs: -16,
  duckDb: -18,
  pauseGainDb: -10,
  musicOnlyGainDb: -8,
};

/**
 * Recorded per-film soundtrack manifest (Report Section 4.9 and Decision D6).
 * Captures music sections, speech ducking intervals, mix levels, sound effects, and description credits.
 */
export const soundtrackSchema = z.object({
  /** SHA-256 hash of the audio/library.json manifest used for this film. */
  library: z.string().optional(),
  /** Ordered list of story act music sections. */
  sections: z.array(soundtrackSectionSchema).default([]),
  /** Measured speech activity intervals for Remotion sidechain ducking. */
  speech: z.array(speechIntervalSchema).default([]),
  /** Backend fingerprint of narration bytes and edits whose RMS intervals are recorded above. */
  speechSource: z.string().optional(),
  /** Measured narration sample peak used to keep effect true peaks safely below the voice. */
  narrationPeakDb: z.number().optional(),
  /** Mix levels, ducking depths, and target loudness settings. */
  mix: soundtrackMixSchema.default(soundtrackMixDefault),
  /** Sound effects tied to visual events on the timeline. */
  sfx: z.array(soundtrackSfxSchema).default([]),
  /** Description credit text lines for YouTube or public display. */
  credits: z.union([z.array(z.string()), z.string()]).default([]),
});

export type SpeechInterval = z.infer<typeof speechIntervalSchema>;
export type SoundtrackSection = z.infer<typeof soundtrackSectionSchema>;
export type SoundtrackMix = z.infer<typeof soundtrackMixSchema>;
export type SoundtrackSfx = z.infer<typeof soundtrackSfxSchema>;
export type Soundtrack = z.infer<typeof soundtrackSchema>;

// Normalizes legacy music, audio, and sfx fields or existing soundtrack into a unified Soundtrack structure.
export function normalizeFilmSoundtrack(film: {
  soundtrack?: Soundtrack;
  music?: { src: string; volume?: number; duckUnderVoiceover?: boolean };
  audio?: { src: string; trimBefore?: number };
  sfx?: Array<{ src: string; timeSec: number; volume?: number }>;
  shots?: Array<{ dur?: number }>;
}): Soundtrack {
  if (film.soundtrack && film.soundtrack.sections.length > 0) {
    const rawSpeech = film.soundtrack.speech ?? [];
    return {
      library: film.soundtrack.library,
      sections: film.soundtrack.sections,
      speech: rawSpeech,
      speechSource: film.soundtrack.speechSource,
      narrationPeakDb: film.soundtrack.narrationPeakDb,
      mix: {
        targetLufs: film.soundtrack.mix?.targetLufs ?? -16,
        duckDb: film.soundtrack.mix?.duckDb ?? -18,
        pauseGainDb: film.soundtrack.mix?.pauseGainDb ?? -10,
        musicOnlyGainDb: film.soundtrack.mix?.musicOnlyGainDb ?? -8,
        maxTruePeakDb: film.soundtrack.mix?.maxTruePeakDb ?? -1,
        masterGainDb: film.soundtrack.mix?.masterGainDb ?? 0,
      },
      sfx: film.soundtrack.sfx ?? [],
      credits: film.soundtrack.credits ?? [],
    };
  }

  // Derive one-section soundtrack from legacy music or audio fields
  const effectiveMusicSrc = (film.music?.src || film.audio?.src || "").trim();
  const totalDur = film.shots?.reduce((acc, s) => acc + (s.dur || 3), 0) ?? 0;
  const sections: SoundtrackSection[] = effectiveMusicSrc
    ? [
        {
          role: "explain",
          item: effectiveMusicSrc,
          src: effectiveMusicSrc,
          from: 0,
          to: totalDur,
          offsetSec: film.audio?.trimBefore ?? 0,
          crossfadeSec: 0,
          volume: film.music?.volume ?? 1,
          duckUnderVoiceover: film.music?.duckUnderVoiceover ?? true,
        },
      ]
    : [];

  const legacySfx: SoundtrackSfx[] = (film.sfx ?? []).map((s) => ({
    item: s.src,
    src: s.src,
    timeSec: s.timeSec,
    gainDb: 0,
    volume: s.volume ?? 1,
  }));

  const rawSpeech = film.soundtrack?.speech ?? [];

  return {
    library: film.soundtrack?.library,
    sections: sections.length > 0 ? sections : (film.soundtrack?.sections ?? []),
    speech: rawSpeech,
    speechSource: film.soundtrack?.speechSource,
    narrationPeakDb: film.soundtrack?.narrationPeakDb,
    mix: {
      targetLufs: film.soundtrack?.mix?.targetLufs ?? -16,
      duckDb: film.soundtrack?.mix?.duckDb ?? -18,
      pauseGainDb: film.soundtrack?.mix?.pauseGainDb ?? -10,
      musicOnlyGainDb: film.soundtrack?.mix?.musicOnlyGainDb ?? -8,
      maxTruePeakDb: film.soundtrack?.mix?.maxTruePeakDb ?? -1,
      masterGainDb: film.soundtrack?.mix?.masterGainDb ?? 0,
    },
    sfx: film.soundtrack?.sfx && film.soundtrack.sfx.length > 0 ? film.soundtrack.sfx : legacySfx,
    credits: film.soundtrack?.credits ?? [],
  };
}

export const audioClipSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  src: z.string().min(1),
  position: z.number().min(0).default(0),
  start: z.number().min(0).default(0),
  end: z.number().min(0),
  volume: z.number().min(0).max(2).default(1),
  speed: z.number().min(0.25).max(4).default(1).optional(),
  retimedSrc: z.string().optional(),
  channel: z.enum(["voiceover", "music", "sfx", "external"]).default("voiceover"),
  /** Timeline lane this clip sits on. See timelineLayerSchema. */
  layerId: z.string().optional(),
  /** Id of the linked `videoClips` entry, kept symmetric on both sides (imported footage audio). */
  linkedClipId: z.string().optional(),
});

/**
 * An imported footage picture clip. Mirrors `audioClipSchema`: the layer model is the authority
 * for video clips once any exist, and this array is how the picture survives the round trip back
 * into the manifest instead of being silently dropped (the confirmed Phase 0 defect).
 */
export const videoClipSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  src: z.string().min(1),
  position: z.number().min(0).default(0),
  start: z.number().min(0).default(0),
  end: z.number().min(0),
  /** Total length of the source file, when known. Trims clamp against it. */
  sourceDuration: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  opacity: z.number().min(0).max(1).default(1),
  volume: z.number().min(0).max(2).default(1),
  speed: z.number().min(0.25).max(4).default(1).optional(),
  muted: z.boolean().optional(),
  /** Timeline lane this clip sits on. See timelineLayerSchema. */
  layerId: z.string().optional(),
  /** Id of the linked `audioClips` entry, kept symmetric on both sides. */
  linkedClipId: z.string().optional(),
});

export type VideoClip = z.infer<typeof videoClipSchema>;

/** Typography overlay payload: standalone in `overlayClips`, and inside a layered `text` clip. */
export const textPayloadSchema = z.object({
  text: z.string().min(1),
  size: z.enum(["kicker", "headline", "body", "caption"]).default("headline"),
  accentWord: z.string().optional(),
  subtitle: z.string().optional(),
  lowerThird: z.boolean().optional(),
  position: z.enum(["top", "center", "bottom"]).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

/** Static image overlay payload: standalone in `overlayClips`, and inside a layered `image` clip. */
export const imagePayloadSchema = z.object({
  src: z.string().min(1),
  x: z.number().optional(),
  y: z.number().optional(),
  scale: z.number().positive().default(1),
});

/** A caption cue payload: standalone in `overlayClips`, and inside a layered `subtitle` clip. */
export const subtitlePayloadSchema = z.object({
  text: z.string().min(1),
  startFrame: z.number().int().min(0).optional(),
  endFrame: z.number().int().min(0).optional(),
});

export type TextPayload = z.infer<typeof textPayloadSchema>;
export type ImagePayload = z.infer<typeof imagePayloadSchema>;
export type SubtitlePayload = z.infer<typeof subtitlePayloadSchema>;

export const overlayClipKindSchema = z.enum(["text", "image", "subtitle"]);
export type OverlayClipKind = z.infer<typeof overlayClipKindSchema>;

/**
 * A text/image/standalone-subtitle clip the shot list has no field for. Mirrors `audioClips`: the
 * layer model is the authority for these once any exist, and this array is how they survive the
 * round trip back into the manifest. A subtitle *derived* from the voiceover words stays derived
 * (regenerated by `generateWordsFromFilm`); only a standalone caption cue lands here.
 */
export const overlayClipSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: overlayClipKindSchema,
  position: z.number().min(0).default(0),
  start: z.number().min(0).default(0),
  end: z.number().min(0),
  opacity: z.number().min(0).max(1).default(1),
  /** Timeline lane this clip sits on. See timelineLayerSchema. */
  layerId: z.string().optional(),
  payload: z.union([textPayloadSchema, imagePayloadSchema, subtitlePayloadSchema]),
});

export type OverlayClip = z.infer<typeof overlayClipSchema>;

/**
 * A timeline lane the editor draws clips on. Purely an editing construct: it carries z-order and
 * the per-lane visibility, lock and mute flags, and never changes how a shot itself renders.
 * Optional on a film so every existing manifest keeps working with the default lane set.
 */
export const timelineLayerSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Z-order. Higher numbers paint on top. */
  number: z.number().int().min(0).max(100),
  label: z.string().min(1).max(40),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  muted: z.boolean().default(false),
  height: z.number().min(20).max(200).default(56),
});

export type SfxItem = z.infer<typeof sfxItemSchema>;
export type MusicTrack = z.infer<typeof musicTrackSchema>;
export type AudioClip = z.infer<typeof audioClipSchema>;
export type TimelineLayer = z.infer<typeof timelineLayerSchema>;

export const filmBaseSchema = z.object({
  schemaVersion: z.string().default("1.0.0").optional(),
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
  /** Overrides the one colour. Everything else in §01 is fixed. */
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** Comprehensive studio appearance and customization config */
  theme: themeSchema.optional(),
  chapters: z.array(z.string().min(1).max(30)).min(1).max(12),
  canvas: z.object({
    nodes: z.array(nodeSchema).min(2).max(24),
    edges: z.array(edgeSchema).min(1).max(48),
  }),
  /**
   * A vector stage that replaces the node graph as this film's canvas. Present means the film is
   * drawn from committed SVG assets driven by declarative animation clips; absent is the default
   * node-graph film. See scene/README.md.
   */
  scene: sceneSchema.optional(),
  /**
   * Who made this film's design. "agent" and "server-model" are bespoke designs built from
   * videos/<id>/design/design.json and passed by the design check; "templates" means both bespoke
   * paths failed and the studio flags the film as a template fallback. Absent on older films.
   */
  design: z
    .object({
      source: z.enum(["agent", "server-model", "hand-built", "templates"]),
      note: z.string().max(500).optional(),
      brief: z
        .object({
          concept: z.string().min(1).max(600),
          throughLine: z.string().max(300).optional(),
          motifs: z.array(z.string().max(80)).max(12).optional(),
        })
        .optional(),
    })
    .optional(),
  shots: z.array(shotSchema).min(1),
  audio: z.object({ src: z.string().min(1), trimBefore: z.number().min(0).default(0) }).optional(),
  voiceover: z
    .object({
      src: z.string().min(1),
      volume: z.number().min(0).max(2).default(1),
      speed: z.number().min(0.25).max(4).default(1).optional(),
      retimedSrc: z.string().optional(),
      version: z.string().optional(),
      durationSec: z.number().min(0).optional(),
    })
    .optional(),
  audioClips: z.array(audioClipSchema).optional(),
  /** Imported footage pictures. See `videoClipSchema`. */
  videoClips: z.array(videoClipSchema).optional(),
  /** Standalone text/image/subtitle clips the shot list cannot represent. See `overlayClipSchema`. */
  overlayClips: z.array(overlayClipSchema).optional(),
  /** Editor timeline lanes. Absent means the editor derives its default lane set. */
  layers: z.array(timelineLayerSchema).optional(),
  captionPlacement: captionPlacementByFormatSchema.optional(),
  /** Burned-in captions rendering. default is "bottom" */
  captions: z.union([z.enum(["bottom", "off"]), z.string()]).default("bottom").optional(),
  /**
   * Burn kinetic subtitles into the picture. Omit to keep the long-standing default of on.
   * Set false for a film that puts its own words on screen: §04 leaves subtitles to the platform,
   * and a second line of type fighting a text card for the same space reads as a mistake.
   */
  subtitles: z.boolean().optional(),
  sfx: z.array(sfxItemSchema).optional(),
  music: musicTrackSchema.optional(),
  /**
   * Film soundtrack data describing story act music sections, sound effects, speech ducking intervals,
   * mix loudness targets, and description credits (Decision D6 and Report Section 4.9).
   */
  soundtrack: soundtrackSchema.optional(),
  /**
   * The end card's spoken line, synthesized once in this film's own narration voice. Derived data:
   * the narrate stage and `ensureEndCardVoice` (backend/endCard/voice.ts) write it, nobody authors
   * it. Word times are relative to the line's own start; `src/dl/delivery.ts` places them in the card.
   */
  endCardVoice: z
    .object({
      src: z.string().min(1),
      text: z.string().min(1),
      durationSec: z.number().positive(),
      /** Hash of the line and the voice settings it was synthesized with, so a stale line is re-made. */
      fingerprint: z.string().min(1),
      words: z.array(z.object({ word: z.string().min(1), start: z.number().min(0), end: z.number().min(0) })),
    })
    .optional(),
});

export const filmSchema = filmBaseSchema.superRefine((film, ctx) => {
    const ids = new Set(film.canvas.nodes.map((n) => n.id));

    const dupes = film.canvas.nodes
      .map((n) => n.id)
      .filter((id, i, all) => all.indexOf(id) !== i);
    if (dupes.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["canvas", "nodes"],
        message: `duplicate node ids: ${Array.from(new Set(dupes)).join(", ")}`,
      });
    }

    film.canvas.edges.forEach((e, i) => {
      if (!ids.has(e.from))
        ctx.addIssue({
          code: "custom",
          path: ["canvas", "edges", i, "from"],
          message: `no node "${e.from}"`,
        });
      if (!ids.has(e.to))
        ctx.addIssue({
          code: "custom",
          path: ["canvas", "edges", i, "to"],
          message: `no node "${e.to}"`,
        });
    });

    // ---- §08 Runsheet. These are the rules that make it a rhythm rather than
    // a look, so they are enforced rather than written down and forgotten.
    let clock = 0;
    let lastDevice: string | null = null;
    let sinceBeat = 0;
    let sinceCanvas = 0;

    film.shots.forEach((shot, i) => {
      const at = ["shots", i] as const;

      const targets =
        shot.look === "all" ? [] : Array.isArray(shot.look) ? shot.look : [shot.look];
      targets.forEach((t) => {
        if (!ids.has(t))
          ctx.addIssue({ code: "custom", path: [...at, "look"], message: `no node "${t}"` });
      });

      const device = shot.blocks.find(isDevice);
      const isBeat = shot.stage === "frame";
      const isSpine = shot.stage === "none";

      if (device) {
        // No device holds the frame past 25 seconds: attention decays after
        // roughly twenty on the same visual device.
        if (shot.dur > 25)
          ctx.addIssue({
            code: "custom",
            path: [...at, "dur"],
            message: `${device.c} holds for ${shot.dur}s; no device may hold past 25s`,
          });
        // Never the same device twice in a row.
        if (device.c === lastDevice)
          ctx.addIssue({
            code: "custom",
            path: [...at, "blocks"],
            message: `${device.c} follows itself; put the canvas or another device between them`,
          });
        lastDevice = device.c;
      } else if (isSpine || isBeat) {
        // Returning to the spine or to a beat resets the device rotation.
        lastDevice = null;
      }

      // At most three accents per frame. A fourth means the frame is doing too
      // much, which is a scripting problem rather than a design one.
      const accents = shot.blocks.reduce((sum, b) => sum + accentCost(b), 0);
      if (accents > 3)
        ctx.addIssue({
          code: "custom",
          path: [...at, "blocks"],
          message: `${accents} accents in one frame; the limit is 3`,
        });

      if (shot.stage !== "none" && shot.blocks.length === 0)
        ctx.addIssue({
          code: "custom",
          path: [...at, "blocks"],
          message: `stage "${shot.stage}" with no blocks renders an empty panel`,
        });

      if (shot.stage === "inset") {
        if (!film.scene)
          ctx.addIssue({
            code: "custom",
            path: [...at, "stage"],
            message: 'stage "inset" shares a scene stage, so only a scene film can use it',
          });
        const bad = shot.blocks.find(
          (b) => !(INSET_BLOCKS as readonly string[]).includes(b.c) || (b.c === "AnalogyInset" && b.fullScreenHero),
        );
        if (bad)
          ctx.addIssue({
            code: "custom",
            path: [...at, "blocks"],
            message: `${bad.c} cannot sit in the inset region: an inset carries one device or counter, never a card or a full-screen hero`,
          });
        if (shot.blocks.length > 1)
          ctx.addIssue({
            code: "custom",
            path: [...at, "blocks"],
            message: "an inset shot carries exactly one device; split the beat or use the scene itself",
          });
      }

      if (shot.stage === "anchor" && shot.look === "all")
        ctx.addIssue({
          code: "custom",
          path: [...at, "stage"],
          message: 'cannot anchor a panel to "all": name the node it grows out of',
        });

      sinceBeat = isBeat ? 0 : sinceBeat + shot.dur;
      sinceCanvas = isSpine ? 0 : sinceCanvas + shot.dur;

      // A persistent scene carries the beat through motion without requiring a text card.
      if (!film.scene && sinceBeat > 90)
        ctx.addIssue({
          code: "custom",
          path: [...at, "dur"],
          message: `${Math.round(sinceBeat)}s without a text beat; the viewer needs a breather every 60-90s`,
        });
      if (sinceCanvas > 90)
        ctx.addIssue({
          code: "custom",
          path: [...at, "look"],
          message: `${Math.round(sinceCanvas)}s away from the canvas; return to the spine to re-anchor`,
        });

      clock += shot.dur;
    });

    if (film.shots.length > 0 && film.shots[0].move !== "cut")
      ctx.addIssue({
        code: "custom",
        path: ["shots", 0, "move"],
        message: 'the first shot has nothing to move from: use move: "cut"',
      });

    if (clock < 10)
      ctx.addIssue({ code: "custom", path: ["shots"], message: "film is under 10s" });
  });

export type Film = z.infer<typeof filmSchema>;

/** Throws with a readable field path if the film is malformed. */
export const parseFilm = (input: unknown): Film => {
  const result = filmSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(`Invalid film:\n${lines.join("\n")}`);
  }
  return result.data;
};
