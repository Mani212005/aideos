import { z } from "zod";

/**
 * ---------------------------------------------------------------------------
 * THE PIPELINE CONTRACT
 * ---------------------------------------------------------------------------
 * Everything upstream (research, scripting, design) exists to produce one
 * `Episode`. Everything downstream (storyboard, render) is a pure function of it.
 *
 * This is a *validated* schema rather than a bare TypeScript type on purpose. A
 * generator emitting JSON gets checked at the boundary, so a malformed episode
 * fails immediately with a field path instead of rendering 1800 broken frames.
 *
 * `visual` is intentionally a closed enum. Only modules that actually exist may
 * appear, so a generator cannot invent `"visual": "timeline"` and silently
 * produce a scene with nothing in it.
 */

export const cameraSetupSchema = z.object({
  /** Distance from the subject, in subject-lengths. Larger = further away. */
  distance: z.number().min(1).max(40),
  /** Horizontal orbit, radians. */
  yaw: z.number().min(-Math.PI).max(Math.PI),
  /** Vertical orbit, radians. */
  pitch: z.number().min(-1.2).max(1.2),
});

export const bulletSchema = z.object({
  title: z.string().min(1).max(40),
  sub: z.string().min(1).max(90),
});

export const chipSchema = z.object({
  label: z.string().min(1).max(20),
  sub: z.string().min(1).max(28),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a 6-digit hex colour"),
});

/** Only modules with a real implementation. Adding a name here is a code change. */
export const visualModuleSchema = z.enum([
  "spectrum",
  "chips",
  "bullets",
  "endcard",
  /** Monospace formula or code block. */
  "formula",
  /** Two-column side-by-side comparison. */
  "compare",
  /** Animated token row showing re-read cost — naive vs cached. */
  "rescan",
  /** Next-token prediction with probability bars. */
  "predict",
  /** A word splitting into token pieces, then into number vectors. */
  "tokenize",
  /** Stacked layers, each holding its own shelf — the skyscraper of kitchens. */
  "layers",
  /** Two grids of different shape that visibly fail to align. */
  "mismatch",
]);

/**
 * Background treatments. Varying these across chapters stops a long video
 * reading as one static set, and each is cross-faded at the cut so the change
 * registers as travelling somewhere rather than as a jump.
 */
export const backdropSchema = z.enum(["deep", "grid", "rays", "rings", "beams"]);

/** Only 3D subjects with a real implementation, keyed into the subject registry. */
export const subjectSchema = z.enum(["leaf", "cardShelf"]);

export const formulaSchema = z.object({
  lines: z.array(z.string().max(80)).min(1).max(8),
  caption: z.string().max(140).optional(),
  /** 0-based line indices to emphasise. */
  highlight: z.array(z.number().int().min(0)).optional(),
});

export const rescanSchema = z.object({
  /** false = re-read everything each step (the problem); true = read only the new token (the fix). */
  cached: z.boolean().default(false),
  /** How many tokens the row builds up to. */
  tokens: z.number().int().min(6).max(20).default(14),
});

export const predictSchema = z.object({
  /** Use `___` to mark the blank being predicted. */
  prompt: z.string().max(80),
  candidates: z
    .array(
      z.object({
        label: z.string().max(16),
        /** Probability 0..1. Drives the bar length. */
        p: z.number().min(0).max(1),
        /** Marks the absurd option, drawn in the warning accent. */
        absurd: z.boolean().optional(),
      }),
    )
    .min(2)
    .max(5),
});

export const layersSchema = z.object({
  /** How many floors to draw. */
  count: z.number().int().min(3).max(10).default(6),
  /** Label for the bottom-most floor. */
  bottomLabel: z.string().max(24).optional(),
  /** Label for the top-most floor. */
  topLabel: z.string().max(24).optional(),
});

export const mismatchSchema = z.object({
  left: z.object({ label: z.string().max(20), rows: z.number().int().min(2).max(9) }),
  right: z.object({ label: z.string().max(20), rows: z.number().int().min(2).max(9) }),
  note: z.string().max(70).optional(),
});

export const tokenizeSchema = z.object({
  word: z.string().max(24),
  pieces: z.array(z.string().max(12)).min(2).max(5),
});

export const compareSchema = z.object({
  left: z.object({
    title: z.string().max(32),
    points: z.array(z.string().max(90)).min(1).max(5),
  }),
  right: z.object({
    title: z.string().max(32),
    points: z.array(z.string().max(90)).min(1).max(5),
  }),
});

/** Theme pack ids from `palette.ts`. */
export const themeSchema = z.enum(["botanical", "circuit", "signal"]);

/**
 * Accents are roles, not colours. The theme pack decides what `primary` looks
 * like, so copy written for one episode can be re-themed without edits.
 */
export const accentSchema = z.enum(["primary", "secondary", "neutral"]);

export const sceneSchema = z
  .object({
    /** Stable slug. Used for storyboard frame filenames, so keep it filesystem-safe. */
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/, "must be lowercase letters, digits and dashes"),
    /** Seconds from the start of the episode. Scenes must be contiguous. */
    start: z.number().min(0),
    // Long-form explainers hold a single idea far longer than a 60s short does;
    // the old 20s ceiling was tuned for Reels and rejects narrated chapters.
    duration: z.number().min(1.5).max(45),

    kicker: z.string().max(34).optional(),
    /**
     * Supports inline markers:
     *   `*word*`  this scene's accent
     *   `~word~`  the opposite accent
     *   `_word_`  serif italic
     * `\n` forces a line break.
     */
    headline: z.string().min(1).max(150),
    body: z.string().max(420).optional(),

    bullets: z.array(bulletSchema).min(2).max(6).optional(),
    chips: z.array(chipSchema).min(2).max(4).optional(),
    formula: formulaSchema.optional(),
    compare: compareSchema.optional(),
    rescan: rescanSchema.optional(),
    layers: layersSchema.optional(),
    mismatch: mismatchSchema.optional(),
    predict: predictSchema.optional(),
    tokenize: tokenizeSchema.optional(),

    accent: accentSchema,
    visual: visualModuleSchema.optional(),
    /** Background treatment. Defaults to "deep". */
    backdrop: backdropSchema.optional(),

    camera: cameraSetupSchema,
    /** Overrides where the subject sits on screen, 0..1, y downward. */
    subjectScreen: z
      .object({ x: z.number().optional(), y: z.number().optional() })
      .optional(),

    /**
     * The subject's morph state, 0..1. Meaning is the subject's own: for the leaf
     * it is chlorophyll (0) to anthocyanin (1); another subject might read it as
     * cold-to-hot or empty-to-full.
     */
    subjectState: z.number().min(0).max(1),
    /** Animate the state change as a wash across the subject within this scene. */
    wash: z.boolean().optional(),
  })
  .superRefine((scene, ctx) => {
    // A module that needs data is useless without it, and the failure is silent
    // at render time — so it is an error here instead.
    if (scene.visual === "bullets" && !scene.bullets) {
      ctx.addIssue({
        code: "custom",
        path: ["bullets"],
        message: 'visual "bullets" requires a bullets array',
      });
    }
    if (scene.visual === "chips" && !scene.chips) {
      ctx.addIssue({
        code: "custom",
        path: ["chips"],
        message: 'visual "chips" requires a chips array',
      });
    }
    if (scene.visual === "formula" && !scene.formula) {
      ctx.addIssue({
        code: "custom",
        path: ["formula"],
        message: 'visual "formula" requires a formula object',
      });
    }
    if (scene.visual === "compare" && !scene.compare) {
      ctx.addIssue({
        code: "custom",
        path: ["compare"],
        message: 'visual "compare" requires a compare object',
      });
    }
    if (scene.visual === "predict" && !scene.predict) {
      ctx.addIssue({
        code: "custom",
        path: ["predict"],
        message: 'visual "predict" requires a predict object',
      });
    }
    if (scene.visual === "mismatch" && !scene.mismatch) {
      ctx.addIssue({
        code: "custom",
        path: ["mismatch"],
        message: 'visual "mismatch" requires a mismatch object',
      });
    }
    if (scene.visual === "tokenize" && !scene.tokenize) {
      ctx.addIssue({
        code: "custom",
        path: ["tokenize"],
        message: 'visual "tokenize" requires a tokenize object',
      });
    }
  });

export const episodeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(1),
    subtitle: z.string().optional(),
    fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
    /** Which 3D subject carries the episode. */
    subject: subjectSchema,
    /** Which theme pack supplies primary/secondary. */
    theme: themeSchema,
    /** Small label under the closing line. Episode-specific, so it lives here. */
    endTag: z.string().max(48).optional(),
    /**
     * Narration track in `public/`. When present the music bed automatically
     * ducks, so adding a voiceover never requires touching the mix by hand.
     */
    voiceover: z
      .object({ src: z.string().min(1), volume: z.number().min(0).max(2).default(1) })
      .optional(),
    /** Captions JSON in `public/`, in @remotion/captions `Caption[]` format. */
    captions: z.string().min(1).optional(),
    audio: z
      .object({
        /** Filename inside `public/`. */
        src: z.string().min(1),
        /** Seconds to skip into the track. */
        trimBefore: z.number().min(0).default(0),
      })
      .optional(),
    scenes: z.array(sceneSchema).min(1),
  })
  .superRefine((episode, ctx) => {
    // Contiguity matters: the camera and pigment tracks interpolate between scene
    // start times, so a gap or an overlap silently distorts every move.
    let expected = 0;
    episode.scenes.forEach((scene, i) => {
      if (Math.abs(scene.start - expected) > 1e-6) {
        ctx.addIssue({
          code: "custom",
          path: ["scenes", i, "start"],
          message: `scene "${scene.id}" starts at ${scene.start}s but the previous scene ends at ${expected}s`,
        });
      }
      expected = scene.start + scene.duration;
    });

    const ids = episode.scenes.map((s) => s.id);
    const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (duplicated.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["scenes"],
        message: `duplicate scene ids: ${[...new Set(duplicated)].join(", ")}`,
      });
    }
  });

export type CameraSetup = z.infer<typeof cameraSetupSchema>;
export type Bullet = z.infer<typeof bulletSchema>;
export type Chip = z.infer<typeof chipSchema>;
export type Formula = z.infer<typeof formulaSchema>;
export type Compare = z.infer<typeof compareSchema>;
export type Rescan = z.infer<typeof rescanSchema>;
export type Predict = z.infer<typeof predictSchema>;
export type Tokenize = z.infer<typeof tokenizeSchema>;
export type Layers = z.infer<typeof layersSchema>;
export type Mismatch = z.infer<typeof mismatchSchema>;
export type VisualModule = z.infer<typeof visualModuleSchema>;
export type SubjectId = z.infer<typeof subjectSchema>;
export type ThemeId = z.infer<typeof themeSchema>;
export type Accent = z.infer<typeof accentSchema>;
export type BackdropKind = z.infer<typeof backdropSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Episode = z.infer<typeof episodeSchema>;

/** Throws with a readable field path if the episode is malformed. */
export const parseEpisode = (input: unknown): Episode => {
  const result = episodeSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(`Invalid episode:\n${lines.join("\n")}`);
  }
  return result.data;
};
