/**
 * File Description: Closed Zod Schema and TypeScript Types for Video Edit Operations (Phase 2).
 * Defines the complete, closed editing operation vocabulary (EditOp) for the AI editor:
 * text overlays, slides, caption tracks, filler-word removal, dead-air removal, range trimming,
 * splitting, moving clips, clip speed, volume, lane mute/hide, accent, theme, and segment reordering.
 */

import { z } from "zod";

export const addTextOverlayOpSchema = z.object({
  op: z.literal("add_text_overlay"),
  text: z.string().min(1).describe("Text content to display in the overlay"),
  startSec: z.number().min(0).describe("Timeline start second for the overlay"),
  endSec: z.number().min(0).describe("Timeline end second for the overlay"),
  size: z.enum(["headline", "body", "kicker"]).optional().describe("Typography scale for the text"),
  position: z.enum(["top", "center", "bottom"]).optional().describe("Vertical positioning of the text on screen"),
  accentWord: z.string().optional().describe("Optional word within text to highlight with the theme accent color"),
  laneHint: z.string().optional().describe("Optional target layer ID or name"),
  label: z.string().optional().describe("Human-readable label for this edit operation"),
});

export const addSlideOpSchema = z.object({
  op: z.literal("add_slide"),
  visualDirection: z.string().optional().describe("Direction or prompt describing the slide visual"),
  sceneSpec: z.record(z.string(), z.unknown()).optional().describe("Declarative scene specification"),
  startSec: z.number().min(0).describe("Timeline start second for the slide"),
  endSec: z.number().min(0).describe("Timeline end second for the slide"),
  style: z.string().optional().describe("Visual styling preset"),
  label: z.string().optional().describe("Human-readable label for this edit operation"),
});

export const addCaptionTrackOpSchema = z.object({
  op: z.literal("add_caption_track"),
  style: z.enum(["kinetic", "standard"]).optional().describe("Caption rendering style"),
  fromSec: z.number().min(0).optional().describe("Start second for captions"),
  toSec: z.number().min(0).optional().describe("End second for captions"),
  label: z.string().optional().describe("Human-readable label for this edit operation"),
});

export const removeFillersOpSchema = z.object({
  op: z.literal("remove_fillers"),
  scope: z
    .union([
      z.literal("all"),
      z.array(z.string()),
      z.object({
        fromSec: z.number().min(0),
        toSec: z.number().min(0),
      }),
    ])
    .optional()
    .describe("Scope of fillers to remove: all, specific words, or a time window"),
  confidenceMin: z.number().min(0).max(1).optional().describe("Minimum confidence threshold below which fillers are removed"),
  label: z.string().optional().describe("Human-readable label for this edit operation"),
});

export const removeDeadAirOpSchema = z.object({
  op: z.literal("remove_dead_air"),
  minSilenceSec: z.number().min(0.1).optional().describe("Minimum silence duration to qualify as dead air (seconds)"),
  targetGapSec: z.number().min(0).optional().describe("Residual natural gap to leave between spoken phrases (seconds)"),
  range: z
    .object({
      fromSec: z.number().min(0),
      toSec: z.number().min(0),
    })
    .optional()
    .describe("Optional time window to constrain dead air removal"),
  label: z.string().optional().describe("Human-readable label for this edit operation"),
});

export const trimRangeOpSchema = z.object({
  op: z.literal("trim_range"),
  fromSec: z.number().min(0).describe("Start second of the range to remove"),
  toSec: z.number().min(0).describe("End second of the range to remove"),
  label: z.string().optional().describe("Human-readable label for this edit operation"),
});

export const splitAtOpSchema = z.object({
  op: z.literal("split_at"),
  atSec: z.number().min(0).describe("Timeline second where the cut/split occurs"),
  clipId: z.string().optional().describe("Optional specific clip ID to split; if omitted, splits all active clips at time"),
  label: z.string().optional().describe("Human-readable label for this edit operation"),
});

export const moveClipOpSchema = z.object({
  op: z.literal("move_clip"),
  clipId: z.string().min(1).describe("ID of the clip to move"),
  toSec: z.number().min(0).describe("New timeline position in seconds"),
  laneHint: z.string().optional().describe("Optional target lane ID to move the clip onto"),
  label: z.string().optional().describe("Human-readable label for this edit operation"),
});

export const setClipSpeedOpSchema = z.object({
  op: z.literal("set_clip_speed"),
  clipId: z.string().min(1).describe("ID of the clip to retime, or 'base' for all base A/V footage"),
  factor: z.number().min(0.25).max(4.0).describe("Playback speed multiplier (e.g. 1.25 for 25% faster)"),
  label: z.string().optional().describe("Human-readable label for this edit operation"),
});

export const setVolumeOpSchema = z.object({
  op: z.literal("set_volume"),
  clipId: z.string().optional().describe("ID of the clip whose volume to set"),
  laneId: z.string().optional().describe("ID of the lane whose clips' volume to set"),
  volume: z.number().min(0).max(1).describe("Volume level between 0 (silent) and 1 (full)"),
  label: z.string().optional().describe("Human-readable label for this edit operation"),
});

export const muteLaneOpSchema = z.object({
  op: z.literal("mute_lane"),
  laneId: z.string().min(1).describe("ID of the layer to mute or unmute"),
  muted: z.boolean().optional().describe("Whether the lane is muted (defaults to true)"),
  label: z.string().optional().describe("Human-readable label for this edit operation"),
});

export const hideLaneOpSchema = z.object({
  op: z.literal("hide_lane"),
  laneId: z.string().min(1).describe("ID of the layer to hide or show"),
  hidden: z.boolean().optional().describe("Whether the lane is hidden (defaults to true)"),
  label: z.string().optional().describe("Human-readable label for this edit operation"),
});

export const setAccentOpSchema = z.object({
  op: z.literal("set_accent"),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe("Six-digit hexadecimal color code for the accent color"),
  label: z.string().optional().describe("Human-readable label for this edit operation"),
});

export const setThemeOpSchema = z.object({
  op: z.literal("set_theme"),
  partialTheme: z.record(z.string(), z.unknown()).describe("Theme configuration properties to update"),
  label: z.string().optional().describe("Human-readable label for this edit operation"),
});

export const reorderSegmentsOpSchema = z.object({
  op: z.literal("reorder_segments"),
  order: z.array(z.string().min(1)).min(1).describe("Ordered array of clip IDs representing the desired sequence"),
  label: z.string().optional().describe("Human-readable label for this edit operation"),
});

/**
 * Closed discriminated union of all supported EditOp schemas.
 * Unknown op values are rejected by Zod parser.
 */
export const editOpSchema = z.discriminatedUnion("op", [
  addTextOverlayOpSchema,
  addSlideOpSchema,
  addCaptionTrackOpSchema,
  removeFillersOpSchema,
  removeDeadAirOpSchema,
  trimRangeOpSchema,
  splitAtOpSchema,
  moveClipOpSchema,
  setClipSpeedOpSchema,
  setVolumeOpSchema,
  muteLaneOpSchema,
  hideLaneOpSchema,
  setAccentOpSchema,
  setThemeOpSchema,
  reorderSegmentsOpSchema,
]);

export type EditOp = z.infer<typeof editOpSchema>;

export type AddTextOverlayOp = z.infer<typeof addTextOverlayOpSchema>;
export type AddSlideOp = z.infer<typeof addSlideOpSchema>;
export type AddCaptionTrackOp = z.infer<typeof addCaptionTrackOpSchema>;
export type RemoveFillersOp = z.infer<typeof removeFillersOpSchema>;
export type RemoveDeadAirOp = z.infer<typeof removeDeadAirOpSchema>;
export type TrimRangeOp = z.infer<typeof trimRangeOpSchema>;
export type SplitAtOp = z.infer<typeof splitAtOpSchema>;
export type MoveClipOp = z.infer<typeof moveClipOpSchema>;
export type SetClipSpeedOp = z.infer<typeof setClipSpeedOpSchema>;
export type SetVolumeOp = z.infer<typeof setVolumeOpSchema>;
export type MuteLaneOp = z.infer<typeof muteLaneOpSchema>;
export type HideLaneOp = z.infer<typeof hideLaneOpSchema>;
export type SetAccentOp = z.infer<typeof setAccentOpSchema>;
export type SetThemeOp = z.infer<typeof setThemeOpSchema>;
export type ReorderSegmentsOp = z.infer<typeof reorderSegmentsOpSchema>;

export const editProgramSchema = z.array(editOpSchema);
export type EditProgram = z.infer<typeof editProgramSchema>;

export const plannerOutputSchema = z.object({
  plan: z.string().min(1).describe("Human-readable natural language summary of the edit plan"),
  ops: editProgramSchema.describe("Sequence of discrete edit operations to apply"),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;
