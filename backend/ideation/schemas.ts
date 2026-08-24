/**
 * File Description: Zod schemas for the staged ideation layer (report section 4).
 * Each pipeline stage (ideate, shoot, prompts) gets its own schema so every
 * LLM call stays small, is validated before anything touches disk, and fails
 * at token cost rather than render cost. The shot list maps onto the existing
 * `shotSchema` / `blockSchema` from src/dl/schema.ts so compilation to a final
 * film is deterministic code, not another model call.
 */
import { z } from "zod";
import { blockSchema } from "../../src/dl/schema";

/**
 * A recurring named entity with a frozen description paragraph. The prompt
 * stage prepends these verbatim to any footage prompt that mentions the
 * entity, which is how visual consistency is enforced without image-to-video
 * reference frames (that flow needs more VRAM than the 8 GB box budget allows
 * and is a documented future upgrade).
 */
export const characterSchema = z.object({
  name: z.string().min(1).max(40),
  description: z.string().min(1).max(600),
});

/**
 * Stage 1 output: the treatment. Story-level decisions only: what the film
 * says, in what order, and on what evidence. No shots, no layout, no timing.
 * The styleBlock is stored once here and later prepended verbatim to every
 * footage prompt (palette words, lens, grade) so all b-roll shares one look.
 */
export const treatmentSchema = z.object({
  title: z.string().min(1).max(120),
  logline: z.string().min(1).max(400),
  /** Shared look paragraph reused verbatim across every footage prompt. */
  styleBlock: z.string().min(1).max(1200),
  characters: z.array(characterSchema).max(6).default([]),
  chapters: z
    .array(
      z.object({
        /** Chapter label; becomes an entry in filmBaseSchema.chapters. */
        label: z.string().min(1).max(30),
        /** What this chapter asserts. */
        claim: z.string().min(1).max(600),
        /** Why the viewer should believe it. */
        evidence: z.string().min(1).max(600),
      }),
    )
    .min(2)
    .max(12),
});

export type Treatment = z.infer<typeof treatmentSchema>;
export type Character = z.infer<typeof characterSchema>;

/** Stage 2 output, per shot. Mirrors the fields of `shotSchema` it needs. */
export const shotSpecSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Chapter label this shot belongs to; must match a treatment chapter label. */
  ch: z.string().min(1).max(30).optional(),
  dur: z.number().min(2).max(45),
  move: z.enum(["pan", "zoom-in", "zoom-out", "hold", "cut"]).default("pan"),
  stage: z.enum(["anchor", "frame", "none"]).default("anchor"),
  /**
   * Node id the camera looks at, or the literal "all" for the whole canvas.
   * A plain string here: the union shape confuses tool-call schemas, and
   * target existence plus the "all" literal are checked below and again by
   * parseFilm at compile time.
   */
  look: z.string().min(1),
  drift: z.boolean().default(false),
  zoom: z.number().min(0.4).max(2.5).default(1),
  /** Narration spoken during this shot; becomes shotSchema.scriptText. */
  scriptText: z.string().min(1).max(600).optional(),
  /** Visual direction notes for this shot's panel composition. */
  visualDirection: z.string().max(400).optional(),
  transition: z.enum(["paper-rip", "zoom-morph", "matrix-glitch", "whip-pan", "film-burn"]).optional(),
  blocks: z.array(blockSchema).max(12).default([]),
  /**
   * Flag for shots whose panel wants generated b-roll. The prompts stage turns
   * each flagged shot into a self-contained video-model prompt.
   */
  needsFootage: z.boolean().default(false),
  /** Requested b-roll clip length in seconds (snapped by the engine profile). */
  footageSeconds: z.number().min(2).max(10).default(5),
});

/** Canvas node spec from the shoot stage; coordinates are assigned by code. */
export const nodeListSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1).max(28),
  sub: z.string().max(34).optional(),
});

/**
 * Stage 2 output: the full shot list. Everything needed to compile the final
 * film deterministically except coordinates, which `compile.ts` lays out
 * left-to-right so the model never has to invent numbers.
 */
export const shotlistSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    title: z.string().min(1).max(120),
    fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(30),
    /** Copied from the treatment so this file stands alone for review. */
    chapters: z.array(z.string().min(1).max(30)).min(2).max(12),
    nodes: z.array(nodeListSchema).min(2).max(24),
    /** Extra edges beyond the sequential spine compiled from node order. */
    extraEdges: z
      .array(
        z.object({
          from: z.string(),
          to: z.string(),
          label: z.string().max(30).optional(),
          dashed: z.boolean().optional(),
        }),
      )
      .max(24)
      .default([]),
    shots: z.array(shotSpecSchema).min(3).max(60),
  })
  .superRefine((sl, ctx) => {
    const ids = new Set(sl.nodes.map((n) => n.id));

    // Every look target and edge endpoint must name a real node; catching it
    // here means the error names the shot instead of failing deep in compile.
    sl.shots.forEach((shot, i) => {
      if (shot.look !== "all" && !ids.has(shot.look))
        ctx.addIssue({
          code: "custom",
          path: ["shots", i, "look"],
          message: `shot "${shot.id}" looks at unknown node "${shot.look}"`,
        });
    });

    sl.extraEdges.forEach((e, i) => {
      if (!ids.has(e.from))
        ctx.addIssue({ code: "custom", path: ["extraEdges", i, "from"], message: `no node "${e.from}"` });
      if (!ids.has(e.to))
        ctx.addIssue({ code: "custom", path: ["extraEdges", i, "to"], message: `no node "${e.to}"` });
    });

    // Every chapter must own at least one shot, or the rail shows a lie.
    sl.chapters.forEach((ch, i) => {
      if (!sl.shots.some((s) => s.ch === ch))
        ctx.addIssue({
          code: "custom",
          path: ["chapters", i],
          message: `chapter "${ch}" has no shots`,
        });
    });

    // At least one needsFootage claim must come with visual direction, or the
    // prompt stage has nothing concrete to describe.
    sl.shots.forEach((shot, i) => {
      if (shot.needsFootage && !shot.visualDirection)
        ctx.addIssue({
          code: "custom",
          path: ["shots", i, "needsFootage"],
          message: `shot "${shot.id}" needs footage but has no visualDirection`,
        });
    });
  });

export type Shotlist = z.infer<typeof shotlistSchema>;
export type ShotSpec = z.infer<typeof shotSpecSchema>;

/** One self-contained video-model prompt produced by stage 3. */
export const footagePromptItemSchema = z.object({
  shotId: z.string().min(1),
  /** Core clip description: subject, action, camera move, lighting, lens. */
  prompt: z.string().min(1).max(1500),
  negativePrompt: z.string().max(500).optional(),
});

/** Stage 3 output wrapper: exactly one entry per needsFootage shot. */
export const promptsSchema = z
  .object({
    prompts: z.array(footagePromptItemSchema).min(0).max(60),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    p.prompts.forEach((item, i) => {
      if (seen.has(item.shotId))
        ctx.addIssue({
          code: "custom",
          path: ["prompts", i, "shotId"],
          message: `duplicate prompt for shot "${item.shotId}"`,
        });
      seen.add(item.shotId);
    });
  });

export type PromptsFile = z.infer<typeof promptsSchema>;
export type FootagePrompt = z.infer<typeof footagePromptItemSchema>;

/**
 * Normalize typographic characters the models love but the design system
 * forbids: long dashes become plain hyphens, curly quotes straighten, invisible
 * characters vanish. Applied to every stage payload before validation.
 */
export function normalizeText(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212\uFE58\uFF0D]/g, "-")
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/\u2026/g, "...")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, " ")
      .trim();
  }
  if (Array.isArray(value)) return value.map(normalizeText);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeText(v)]));
  }
  return value;
}

/** Parse a raw treatment with readable field-path errors. */
export function parseTreatment(input: unknown): Treatment {
  const result = treatmentSchema.safeParse(normalizeText(input));
  if (!result.success) throw formatIssues("treatment", result.error.issues);
  return result.data;
}

/**
 * Coerce frequent model-shaped near misses into the canonical form before
 * validation: Plot points as {x,y} objects become [x,y] pairs, and empty
 * optional strings are dropped rather than failing the length check.
 */
export function coerceShotlist(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const sl = raw as Record<string, unknown>;
  if (!Array.isArray(sl.shots)) return raw;
  sl.shots = (sl.shots as Record<string, unknown>[]).map((shot) => {
    const s = { ...shot };
    if (typeof s.scriptText === "string" && s.scriptText.trim() === "") delete s.scriptText;
    if (Array.isArray(s.blocks)) {
      s.blocks = (s.blocks as Record<string, unknown>[]).map((b) => {
        if (b && b.c === "Plot" && Array.isArray(b.points)) {
          return {
            ...b,
            points: b.points.map((p: unknown) =>
              Array.isArray(p)
                ? p
                : p && typeof p === "object" && typeof (p as { x?: unknown }).x === "number"
                  ? [(p as { x: number }).x, (p as { y: number }).y]
                  : p,
            ),
          };
        }
        return b;
      });
    }
    return s;
  });
  return sl;
}

/** Parse a raw shot list with readable field-path errors. */
export function parseShotlist(input: unknown): Shotlist {
  const result = shotlistSchema.safeParse(coerceShotlist(normalizeText(input)));
  if (!result.success) throw formatIssues("shotlist", result.error.issues);
  return result.data;
}

/** Parse a raw prompts file with readable field-path errors. */
export function parsePrompts(input: unknown): PromptsFile {
  const result = promptsSchema.safeParse(normalizeText(input));
  if (!result.success) throw formatIssues("prompts", result.error.issues);
  return result.data;
}

/** Render zod issues as an indented, path-prefixed error string. */
function formatIssues(label: string, issues: { path: (string | number | symbol)[]; message: string }[]): Error {
  const lines = issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
  return new Error(`Invalid ${label}:\n${lines.join("\n")}`);
}
