/**
 * File Description: The structural contract of the Render IR `aideos.render/1`, the versioned, data-only document the TypeScript pipeline hands to the native renderer. This zod schema is the single source: `npm run render-ir:schema` turns it into the committed JSON Schema the Rust loader embeds, so the two sides cannot describe different documents. Browser-safe (no Node imports).
 * Inputs and outputs: nothing at import time -> zod schemas and the TypeScript types inferred from them.
 * Used by: backend/renderIr/validate.ts, backend/renderIr/jsonSchema.ts, backend/renderIr/renderIr.test.ts.
 */

import { z } from "zod";

/** The one version string this schema describes; any other value is rejected before the rest is read. */
export const RENDER_IR_VERSION = "aideos.render/1";

/** Largest frame index or count a document may carry (about 10 days at 30 fps), so integers stay exact. */
export const MAX_FRAME = 26_000_000;
/** Largest pixel dimension of a scene or a format. */
export const MAX_DIMENSION = 16_384;

/** Element and node ids: letters, digits, dot, underscore and hyphen, starting with a letter or digit. */
export const ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]*$";
/** Colours are `#RRGGBB` or `#RRGGBBAA`, never named or functional notation. */
export const COLOR_PATTERN = "^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$";

const frame = z.number().int().min(0).max(MAX_FRAME);
const count = z.number().int().min(1).max(MAX_FRAME);
const dimension = z.number().int().min(1).max(MAX_DIMENSION);
const unit = z.number().min(0).max(1);
const id = z.string().regex(new RegExp(ID_PATTERN));
const color = z.string().regex(new RegExp(COLOR_PATTERN));
const text = z.string().min(1);

/** Easing applied to the segment that starts at a keyframe; `spline` is the monotone cubic through neighbouring keyframes. */
export const EASES = ["linear", "hold", "expoIn", "expoOut", "expoInOut", "spline"] as const;
export const easeSchema = z.enum(EASES);

/** One keyframe: the value at a frame, plus the easing of the segment that follows it. */
export const keyframeSchema = z.strictObject({
  frame,
  value: z.number(),
  ease: easeSchema.optional(),
});

/** Properties a node-level track may drive (scene units on the stage, render pixels in the overlay). */
export const NODE_PROPERTIES = ["x", "y", "scale", "rotation", "opacity"] as const;
export const nodeTrackSchema = z.strictObject({
  property: z.enum(NODE_PROPERTIES),
  keyframes: z.array(keyframeSchema).min(1),
});

/** Properties a track may drive on one element inside an SVG asset (the scene engine's clip properties). */
export const ELEMENT_PROPERTIES = [
  "translateX", "translateY", "scale", "scaleX", "scaleY", "rotate", "opacity", "drawOn", "x1", "y1", "x2", "y2",
] as const;
export const elementTrackSchema = z.strictObject({
  /** Id of an element inside the SVG asset's own document. */
  target: text,
  property: z.enum(ELEMENT_PROPERTIES),
  /** Transform origin in the asset's coordinate space; only for scale and rotate properties. */
  origin: z.strictObject({ x: z.number(), y: z.number() }).optional(),
  keyframes: z.array(keyframeSchema).min(1),
});

/** One axis-aligned rectangle in render pixels. */
const box = z.strictObject({ x: z.number(), y: z.number(), w: z.number().min(0), h: z.number().min(0) });

/** A value that must be given for exactly the formats the document declares. */
const perFormat = <T extends z.ZodType>(inner: T) => z.strictObject({ long: inner.optional(), reel: inner.optional() });

/** A half-open span of frames `[fromFrame, toFrame)` in which a node is drawn. */
export const visibleSchema = z.strictObject({ fromFrame: frame, toFrame: count });

// Fields every node carries.
const nodeBase = {
  id,
  visible: visibleSchema.optional(),
  opacity: unit.optional(),
};

export const svgNodeSchema = z.strictObject({
  kind: z.literal("svg"),
  ...nodeBase,
  asset: id,
  x: z.number(),
  y: z.number(),
  scale: z.number().gt(0),
  rotation: z.number(),
  layer: z.number().int().min(-2147483648).max(2147483647),
  tracks: z.array(nodeTrackSchema),
  elementTracks: z.array(elementTrackSchema),
});

export const rectNodeSchema = z.strictObject({
  kind: z.literal("rect"),
  ...nodeBase,
  fill: color.optional(),
  stroke: z.strictObject({ color, width: z.number().gt(0) }).optional(),
  radius: z.number().min(0),
  tracks: z.array(nodeTrackSchema),
  placement: perFormat(box),
});

export const textNodeSchema = z.strictObject({
  kind: z.literal("text"),
  ...nodeBase,
  text,
  font: id,
  color,
  align: z.enum(["left", "center", "right"]),
  lineHeight: z.number().gt(0),
  letterSpacing: z.number(),
  tracks: z.array(nodeTrackSchema),
  placement: perFormat(z.strictObject({ x: z.number(), y: z.number(), w: z.number().min(0), h: z.number().min(0), fontSize: z.number().gt(0) })),
});

export const railNodeSchema = z.strictObject({
  kind: z.literal("rail"),
  ...nodeBase,
  font: id,
  ink: color,
  accent: color,
  trackColor: color,
  scrim: color,
  chapters: z.array(z.strictObject({ title: text, startFrame: frame, endFrame: count })).min(1),
  placement: perFormat(z.strictObject({ x: z.number(), y: z.number(), w: z.number().min(0), h: z.number().min(0), fontSize: z.number().gt(0), scrimHeight: z.number().min(0) })),
});

export const captionsNodeSchema = z.strictObject({
  kind: z.literal("captions"),
  ...nodeBase,
  font: id,
  color,
  highlightColor: color,
  backgroundColor: color,
  words: z.array(z.strictObject({ text, startFrame: frame, endFrame: count })),
  /** Owner-resolved card placement per format: from each span's first frame it holds until the next span. */
  placement: perFormat(z.strictObject({
    fontSize: z.number().gt(0),
    spans: z.array(z.strictObject({ fromFrame: frame, x: unit, y: unit, w: unit.optional() })).min(1),
  })),
});

const endCardLayout = z.strictObject({
  card: box,
  scale: z.number().gt(0),
  padX: z.number().min(0),
  padY: z.number().min(0),
  gap: z.number().min(0),
  radius: z.number().min(0),
  type: z.strictObject({ label: z.number().gt(0), headline: z.number().gt(0), chip: z.number().gt(0), handle: z.number().gt(0) }),
  chip: z.strictObject({ height: z.number().gt(0), padX: z.number().min(0), gap: z.number().min(0), icon: z.number().gt(0) }),
});

export const endCardNodeSchema = z.strictObject({
  kind: z.literal("endCard"),
  ...nodeBase,
  sansFont: id,
  monoFont: id,
  fill: color,
  ink: color,
  dim: color,
  copy: z.strictObject({ label: text, headline: text, likeLabel: text, subscribeLabel: text, handle: text }),
  /** The frame the subscribe pill presses, from the spoken word or a fixed beat. */
  pressFrame: frame,
  layout: perFormat(endCardLayout),
});

/** A group (stage or overlay): a transform, an opacity and children drawn in order. */
export interface GroupNode {
  kind: "group";
  id: string;
  visible?: { fromFrame: number; toFrame: number };
  opacity?: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  tracks: z.infer<typeof nodeTrackSchema>[];
  children: Node[];
}

export type Node =
  | z.infer<typeof svgNodeSchema>
  | z.infer<typeof rectNodeSchema>
  | z.infer<typeof textNodeSchema>
  | z.infer<typeof railNodeSchema>
  | z.infer<typeof captionsNodeSchema>
  | z.infer<typeof endCardNodeSchema>
  | GroupNode;

const groupNodeSchema = z.strictObject({
  kind: z.literal("group"),
  ...nodeBase,
  x: z.number(),
  y: z.number(),
  scale: z.number().gt(0),
  rotation: z.number(),
  tracks: z.array(nodeTrackSchema),
  get children(): z.ZodArray<z.ZodType<Node>> { return z.array(nodeSchema); },
});

/** Any node; `kind` selects the variant. */
export const nodeSchema: z.ZodType<Node> = z.discriminatedUnion("kind", [
  svgNodeSchema,
  rectNodeSchema,
  textNodeSchema,
  railNodeSchema,
  captionsNodeSchema,
  endCardNodeSchema,
  groupNodeSchema,
]);

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const assetBase = { id, path: z.string().min(1), sha256: sha256.optional() };

export const assetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("svg"), ...assetBase, elementIds: z.array(text) }),
  z.strictObject({ kind: z.literal("font"), ...assetBase, family: text, weight: z.number().int().min(100).max(900) }),
  z.strictObject({ kind: z.literal("image"), ...assetBase, width: dimension, height: dimension }),
  z.strictObject({ kind: z.literal("audio"), ...assetBase }),
]);

export const audioClipSchema = z.strictObject({
  id,
  asset: id,
  startFrame: frame,
  durationFrames: count,
  sourceStartMs: z.number().min(0),
  gain: z.number().min(0).max(4),
  /** Optional gain envelope; each value is a gain in [0, 4]. Empty means the static gain applies throughout. */
  gainEnvelope: z.array(keyframeSchema),
});

export const cameraSchema = z.strictObject({
  centerX: z.array(keyframeSchema).min(1),
  centerY: z.array(keyframeSchema).min(1),
  zoom: z.array(keyframeSchema).min(1),
  rotation: z.array(keyframeSchema).min(1),
});

const size = z.strictObject({ width: dimension, height: dimension });

/** The whole document. */
export const renderIrSchema = z.strictObject({
  schema: z.literal(RENDER_IR_VERSION),
  film: z.strictObject({ id, fps: z.number().int().min(1).max(240), durationFrames: count }),
  /** The scene coordinate space the stage is composed in (square for scene films). */
  scene: size,
  /** Output formats; each shows a cover-fit window of the scene. At least one is required. */
  formats: perFormat(size),
  background: color,
  assets: z.array(assetSchema),
  camera: cameraSchema.optional(),
  /** Drawn in scene space under the camera, in order (then by svg `layer`). */
  stage: z.array(nodeSchema),
  /** Drawn in frame space (render pixels) above the stage, in order, with no camera. */
  overlay: z.array(nodeSchema),
  audio: z.array(audioClipSchema),
});

export type RenderIr = z.infer<typeof renderIrSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Keyframe = z.infer<typeof keyframeSchema>;
export type FormatName = "long" | "reel";
