/**
 * File Description: The design spec - the data a bespoke film design is written as.
 * An agent (or the server-model fallback) designs a film by writing videos/<id>/design/design.json
 * plus the SVG artwork it names. Frames are never written by hand: every clip is timed with a cue
 * that names a shot or a spoken phrase, and `aideos design build` resolves the cues against the
 * measured narration, holds the continuity rules and runs the design check before anything ships.
 *
 * Cue grammar (a string, or a frame number):
 *   "jupiter"                shot start          "jupiter@0.4"      40% through the shot
 *   "jupiter@end"            shot end            "end"              the film's last frame
 *   'jupiter:"the storm"'    phrase start        'jupiter:"the storm"@end'   phrase end
 *   any of the above + "+12" or "-6"             offset in frames
 */

import { z } from "zod";
import { blockSchema } from "../../src/dl/schema";

const vec2 = z.tuple([z.number(), z.number()]);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "an accent is a #rrggbb colour");
const cue = z.union([z.string().min(1).max(120), z.number().int().min(0)]);

/** One piece of artwork placed on the stage. */
export const specAssetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "asset ids are lowercase letters, digits and dashes"),
  /** Path inside the film's package, e.g. "visuals/probe.svg". */
  file: z.string().regex(/^visuals\/[a-z0-9-]+\.svg$/, 'artwork lives at "visuals/<name>.svg"'),
  /** Where the artwork's centre sits in the 1920 x 1920 scene. */
  position: vec2,
  scale: z.number().positive().max(20).default(1),
  layer: z.number().int().min(0).max(50).optional(),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
});

/** One animation clip, timed by cues instead of frames. */
export const specClipSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  asset: z.string(),
  targets: z.array(z.string().min(1)).min(1),
  property: z.enum(["translateX", "translateY", "scale", "scaleX", "scaleY", "rotate", "opacity", "drawOn"]),
  from: z.number(),
  to: z.number(),
  start: cue,
  end: cue,
  easing: z.enum(["linear", "expoOut", "expoIn", "expoInOut", "hold"]).optional(),
  stagger: z.number().int().min(0).optional(),
  origin: vec2.optional(),
  /** Allow starting from a value the last clip did not leave, for a jump made while hidden. */
  allowJump: z.boolean().optional(),
});

/** The whole design of one film. */
export const designSpecSchema = z.object({
  brief: z.object({
    concept: z.string().min(1).max(600),
    throughLine: z.string().max(300).optional(),
    motifs: z.array(z.string().max(80)).max(12).optional(),
  }),
  /** The film's one accent colour; everything else uses the locked palette. */
  accent: hex.optional(),
  /** Full-bleed backdrop. Omit for the plain canvas colour. */
  background: z.object({ file: specAssetSchema.shape.file, scale: z.number().positive().default(4.8) }).optional(),
  assets: z.array(specAssetSchema).max(40),
  clips: z.array(specClipSchema).max(1500),
  /** Optional per-shot overrides of the on-screen blocks drawn over the scene. */
  shots: z
    .record(
      z.string(),
      z.object({
        blocks: z.array(blockSchema).max(4),
        /** Defaults to "frame" for text cards, "none" for no blocks, and the shot's own stage when a chart remains. */
        stage: z.enum(["frame", "anchor", "none"]).optional(),
      }),
    )
    .optional(),
});

export type DesignSpec = z.infer<typeof designSpecSchema>;
export type SpecClip = z.infer<typeof specClipSchema>;
