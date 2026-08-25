import { z } from "zod";

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

export const poseTransformSchema = z.object({
  rotate: z.number().min(-360).max(360).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  scaleX: z.number().min(0.1).max(5).optional(),
  scaleY: z.number().min(0.1).max(5).optional(),
});

export const poseKeyframeSchema = z.object({
  t: z.number().min(0).max(1),
  groups: z.record(z.string(), poseTransformSchema),
});

export type PoseTransform = z.infer<typeof poseTransformSchema>;
export type PoseKeyframe = z.infer<typeof poseKeyframeSchema>;

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
    c: z.literal("CharacterBeat"),
    characterId: z.string().min(1).default("astronaut"),
    poses: z.array(poseKeyframeSchema).default([]),
  }),
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
  }),
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
    state: z.enum(["idle", "active"]).default("idle"),
  }),
  z.object({ c: z.literal("Divider") }),
  z.object({
    c: z.literal("IconLabel"),
    text: z.string().min(1).max(60),
  }),
]);

export type Block = z.infer<typeof blockSchema>;

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
  "CharacterBeat",
] as const;

const isDevice = (b: Block) =>
  (DEVICE_BLOCKS as readonly string[]).includes(b.c);

/** Blocks that spend one of the frame's three accents. */
const accentCost = (b: Block): number => {
  if (b.c === "TextReveal") return b.accentWord ? 1 : 0;
  if (b.c === "Card") return b.state === "active" ? 1 : 0;
  if (b.c === "StatCounter") return 1;
  if (b.c === "Math") return b.text.includes("*") ? 1 : 0;
  // Every device carries exactly one internal highlight by construction.
  return isDevice(b) ? 1 : 0;
};

export const stageSchema = z.enum(["anchor", "frame", "none"]).default("anchor");
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

export const shotSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  ch: z.string().min(1).max(30).optional(),
  dur: z.number().min(0.5).max(90),
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
  transition: z.enum(["paper-rip", "zoom-morph", "matrix-glitch", "whip-pan", "film-burn"]).optional(),
  /** Optional semantic metaphor cue for script-driven visual depictions. */
  metaphor: z.enum(["spider-web", "liquid-bucket", "balance-scale", "clock-gears", "rocket-launch", "character-throw", "glowing-cluster", "custom"]).optional(),
  blocks: z.array(blockSchema).max(12).default([]),
});

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

export type SfxItem = z.infer<typeof sfxItemSchema>;
export type MusicTrack = z.infer<typeof musicTrackSchema>;

export const filmBaseSchema = z.object({
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
  shots: z.array(shotSchema).min(1),
  audio: z.object({ src: z.string().min(1), trimBefore: z.number().min(0).default(0) }).optional(),
  voiceover: z
    .object({ src: z.string().min(1), volume: z.number().min(0).max(2).default(1) })
    .optional(),
  captions: z.string().min(1).optional(),
  sfx: z.array(sfxItemSchema).optional(),
  music: musicTrackSchema.optional(),
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

      if (shot.stage === "anchor" && shot.look === "all")
        ctx.addIssue({
          code: "custom",
          path: [...at, "stage"],
          message: 'cannot anchor a panel to "all": name the node it grows out of',
        });

      sinceBeat = isBeat ? 0 : sinceBeat + shot.dur;
      sinceCanvas = isSpine ? 0 : sinceCanvas + shot.dur;

      if (sinceBeat > 90)
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
