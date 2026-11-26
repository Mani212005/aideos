/**
 * File Description: The structural contract of the Render IR, the versioned, data-only document between the TypeScript pipeline and the native renderer: `aideos.render/1` (SVG scene films), its strict superset `aideos.render/2` (adds the Three stage's `stage3d` node and the `mesh` asset) the strict superset `aideos.render/3` (adds a pinned picture), and `aideos.render/4` (adds opt-in glyph tracks and a 2D shutter). These zod schemas are the single source: `npm run render-ir:schema` turns them into the committed JSON Schemas the Rust loader embeds, so the two sides cannot describe different documents. Browser-safe (no Node imports).
 * Inputs and outputs: nothing at import time -> zod schemas and the TypeScript types inferred from them.
 * Used by: backend/renderIr/validate.ts, backend/renderIr/jsonSchema.ts, backend/renderIr/renderIr.test.ts.
 */

import { z } from "zod";

/** The first version: SVG scene films (Phase 1). Every film without a Three stage is still written as `/1`. */
export const RENDER_IR_VERSION = "aideos.render/1";
/** The second version, a strict superset of `/1`: adds the `stage3d` stage node and the `mesh` asset (Phase 4). */
export const RENDER_IR_VERSION_2 = "aideos.render/2";
/** The third version, a strict superset of `/2`: adds the `image` stage node, a pinned picture placed on the stage (the illustrated stage, phase 1). */
export const RENDER_IR_VERSION_3 = "aideos.render/3";
/** Every version the loaders read; any other value is rejected before the rest of the document is read. */
/** The fourth version adds opt-in 2D shutter sampling and shaped-glyph tracks. */
export const RENDER_IR_VERSION_4 = "aideos.render/4";
export const RENDER_IR_VERSIONS = [RENDER_IR_VERSION, RENDER_IR_VERSION_2, RENDER_IR_VERSION_3, RENDER_IR_VERSION_4] as const;
export type RenderIrVersion = (typeof RENDER_IR_VERSIONS)[number];

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

/** Properties a node-level track may drive (scene units on the stage, render pixels in the overlay); `scaleX` and `scaleY` multiply `scale` on one axis. */
export const NODE_PROPERTIES = ["x", "y", "scale", "scaleX", "scaleY", "rotation", "opacity"] as const;
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

/** A vertical linear gradient across a box: offset 0 is the box top and 1 its bottom; offsets never decrease. */
export const gradientSchema = z.strictObject({
  stops: z.array(z.strictObject({ offset: unit, color })).min(2),
});

export const rectNodeSchema = z.strictObject({
  kind: z.literal("rect"),
  ...nodeBase,
  fill: color.optional(),
  /** Painted over `fill` and under `stroke`. */
  gradient: gradientSchema.optional(),
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

/** A shaped glyph, indexed in the renderer's laid-out paint order, with its own tracks. */
export const glyphTrackSchema = z.strictObject({
  glyph: frame,
  property: z.enum(["x", "y", "scale", "rotation", "opacity"]),
  keyframes: z.array(keyframeSchema).min(1),
});

/** Text with optional glyph tracks, exclusive to /4. */
export const textNodeSchemaV4 = textNodeSchema.extend({ glyphTracks: z.array(glyphTrackSchema).optional() });

export const railNodeSchema = z.strictObject({
  kind: z.literal("rail"),
  ...nodeBase,
  font: id,
  ink: color,
  /** Colour of the chapter label and timestamp row (the bar's filled part is `ink`). */
  labelColor: color,
  accent: color,
  trackColor: color,
  scrim: color,
  chapters: z.array(z.strictObject({ title: text, startFrame: frame, endFrame: count })).min(1),
  /** Frames the reel's continuous bar fills over (the story, when an end card follows it); absent means the film duration. */
  progressFrames: count.optional(),
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
  /** Face of the LIKE and SUBSCRIBE chip labels; absent means `monoFont`. */
  chipFont: id.optional(),
  fill: color,
  ink: color,
  dim: color,
  /** The panel, its 1 px border and the label and handle colour; each absent one is derived from `dim` and `ink`. */
  surface: color.optional(),
  hairline: color.optional(),
  muted: color.optional(),
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
  | ImageNode
  | Stage3dNode
  | z.infer<typeof svgNodeSchema>
  | z.infer<typeof rectNodeSchema>
  | z.infer<typeof textNodeSchemaV4>
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
  /** Optional gain envelope keyed in film frames (not clip-local); each value is a gain in [0, 4]. Empty means the static gain applies throughout. */
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

/** A loaded document of any version, typed as the `/3` superset (an older document never holds a later version's additions). */
export type RenderIr = Omit<z.infer<typeof renderIrSchemaV4>, "schema"> & { schema: RenderIrVersion };
export type Asset = z.infer<typeof assetSchemaV2>;
export type Keyframe = z.infer<typeof keyframeSchema>;
export type FormatName = "long" | "reel";

// ---------------------------------------------------------------------------------------------
// aideos.render/2: the Three stage. Everything above is unchanged `/1`; `/2` adds what follows.
// ---------------------------------------------------------------------------------------------

const finite = z.number();
const vec3 = z.tuple([finite, finite, finite]);
const quaternion = z.tuple([finite, finite, finite, finite]);
/** A colour as three.js holds it on a material or light: linear-light red, green and blue in [0, 1]. */
const linearRgb = z.tuple([unit, unit, unit]);
/** Which faces a material draws: three's FrontSide, BackSide or DoubleSide. */
export const STAGE_SIDES = ["front", "back", "double"] as const;
const side = z.enum(STAGE_SIDES);

/** What a mesh part holds: `triangles` (the default: positions, normals, optional uvs, indexed triangles), `points` (a frozen dot sample field: positions, normals and a rank per vertex, no indices; the dots-v1 treatment) or `lines` (line segment end points, pairs of positions, no indices; the dots-v1 prop edges). */
export const MESH_PART_KINDS = ["triangles", "points", "lines"] as const;

/** One part of a mesh asset: its kind, vertex and index counts and whether it carries texture coordinates. */
export const meshPartSchema = z.strictObject({
  id,
  /** Absent means `triangles`. */
  kind: z.enum(MESH_PART_KINDS).optional(),
  vertices: count,
  /** Triangles: a whole number of triangles (a multiple of 3). Points and lines: 0. */
  indices: z.number().int().min(0).max(MAX_FRAME),
  uv: z.boolean(),
});

/** A binary mesh file (see docs/RENDER_IR.md "The mesh file"): every part's positions, normals, uvs and indices. */
export const meshAssetSchema = z.strictObject({
  kind: z.literal("mesh"),
  ...assetBase,
  parts: z.array(meshPartSchema).min(1),
});

/** Polygon offset as three's material fields: depth pushed by `factor` times the slope plus `units` steps. */
const polygonOffsetSchema = z.strictObject({ factor: finite, units: finite });

/** How one drawable is shaded; every kind but `face` has a flat linear colour, `ink` is the inverted-hull outline. */
export const stageMaterialSchema = z.discriminatedUnion("kind", [
  /** MeshToonMaterial: the stage's lights banded through the `ramp` gradient. */
  z.strictObject({ kind: z.literal("toon"), color: linearRgb, side, polygonOffset: polygonOffsetSchema.optional() }),
  /** MeshBasicMaterial without a map: an unlit flat colour. */
  z.strictObject({ kind: z.literal("basic"), color: linearRgb, side, polygonOffset: polygonOffsetSchema.optional() }),
  /** MeshBasicMaterial with a face texture: the texture times `color`, unlit. */
  z.strictObject({ kind: z.literal("face"), texture: id, color: linearRgb, side, polygonOffset: polygonOffsetSchema.optional() }),
  /** The ink ShaderMaterial: the part's mesh pushed out along its normals by `width` (object units), one colour. */
  z.strictObject({ kind: z.literal("ink"), color: linearRgb, width: z.number().min(0), side, polygonOffset: polygonOffsetSchema.optional() }),
]);

/** A transform node of the stage graph: a static local transform (position, quaternion x y z w, uniform scale) under an optional parent listed before it. */
export const stageGraphNodeSchema = z.strictObject({
  id,
  parent: id.optional(),
  position: vec3,
  quaternion,
  scale: z.number().gt(0),
});

/** Dense per-frame local channels of one node: `sampleFrames` samples each, 3, 4 and 1 numbers per sample; an absent channel keeps the node's static value. */
export const stageTrackSchema = z.strictObject({
  node: id,
  position: z.array(finite).optional(),
  quaternion: z.array(finite).optional(),
  scale: z.array(finite).optional(),
});

/** The stage treatments the IR carries: the cel look and the dots-v1 stipple (materials/dots.ts). */
export const STAGE_TREATMENTS = ["cel-v1", "dots-v1"] as const;
const treatmentName = z.enum(STAGE_TREATMENTS);

/** What a drawable is drawn as while its treatment is dots-v1: the paper material three swaps in, as three holds it. */
export const dotsMaterialSchema = z.discriminatedUnion("kind", [
  /** The flat paper (MeshBasicMaterial, no map, no polygon offset): black paper, or white for a light fill. */
  z.strictObject({ kind: z.literal("basic"), color: linearRgb, side }),
  /** The face paper: the face texture times `color`, then the luma ramp `vec3(smoothstep(0.06, 0.4, luma))` (grey, no chroma). */
  z.strictObject({ kind: z.literal("faceLuma"), texture: id, color: linearRgb, side }),
  /** The ink hull with the dots ink colour (white, or black behind a light fill). */
  z.strictObject({ kind: z.literal("ink"), color: linearRgb, width: z.number().min(0), side }),
]);

/** The dots-v1 look of one drawable: its paper, its sort key, its stipple and (prop only) its edge lines. */
export const dotsLookSchema = z.strictObject({
  material: dotsMaterialSchema,
  /** three's creation id of the paper material: the opaque draw order is ascending by this key (the cel key is the drawable's own `order`). */
  order: z.number().int().min(0),
  /** The point sprite field of this drawable's mesh; absent when the drawable carries no dots (head and light fills). */
  samples: z.strictObject({
    /** A part id of kind `points`. */
    part: id,
    /** `1 - lightness` of the original material's linear colour: the dots shader's tone uniform. */
    tone: unit,
  }).optional(),
  /** Edge lines (white, 1 px, opaque) drawn on this drawable's mesh. */
  edges: z.strictObject({
    /** A part id of kind `lines`. */
    part: id,
    color: linearRgb,
    /** three's creation id of the line material: its opaque draw order. */
    order: z.number().int().min(0),
  }).optional(),
});

/** One mesh part drawn with one material at one node, in draw order. */
export const stageDrawableSchema = z.strictObject({
  id,
  node: id,
  /** A part id of the stage's mesh asset. */
  part: id,
  material: stageMaterialSchema,
  /** The treatment group (a cast member) this drawable belongs to; required with `dots`. */
  group: id.optional(),
  /** three's creation id of `material`: the opaque draw order key of the cel look. Present on every drawable of a document that uses dots-v1. */
  order: z.number().int().min(0).optional(),
  /** The drawable's dots-v1 look; absent on a drawable that is always cel. */
  dots: dotsLookSchema.optional(),
});

/** The treatment of one cast member (character or prop) before the scene's spans: its own treatment, else the scene's. */
export const treatmentGroupSchema = z.strictObject({ id, treatment: treatmentName });

/** A scene treatment span: frames `startFrame` up to (not including) `endFrame` draw every group in `treatment` (`stageTreatmentAt`). */
export const treatmentSpanSchema = z.strictObject({
  startFrame: z.number().int().min(0).max(MAX_FRAME),
  endFrame: count,
  treatment: treatmentName,
});

/** A paint as the face painter sets it: a colour with its exact alpha, or a linear gradient in canvas units. */
const facePaintSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("color"), color, alpha: unit }),
  z.strictObject({
    kind: z.literal("linearGradient"),
    x0: finite, y0: finite, x1: finite, y1: finite,
    stops: z.array(z.strictObject({ offset: unit, color, alpha: unit })).min(1),
  }),
]);

const xy = z.tuple([finite, finite]);
/** One recorded Canvas 2D call of the face painter, in the order it was made. */
export const faceOpSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("setTransform"), args: z.tuple([finite, finite, finite, finite, finite, finite]) }),
  z.strictObject({ op: z.literal("save") }),
  z.strictObject({ op: z.literal("restore") }),
  z.strictObject({ op: z.literal("scale"), args: xy }),
  z.strictObject({ op: z.literal("translate"), args: xy }),
  z.strictObject({ op: z.literal("fillStyle"), paint: facePaintSchema }),
  z.strictObject({ op: z.literal("strokeStyle"), paint: facePaintSchema }),
  z.strictObject({ op: z.literal("lineWidth"), value: z.number().gt(0) }),
  z.strictObject({ op: z.literal("lineCap"), value: z.enum(["butt", "round", "square"]) }),
  z.strictObject({ op: z.literal("lineJoin"), value: z.enum(["miter", "round", "bevel"]) }),
  z.strictObject({ op: z.literal("globalAlpha"), value: unit }),
  z.strictObject({ op: z.literal("fillRect"), args: z.tuple([finite, finite, finite, finite]) }),
  z.strictObject({ op: z.literal("beginPath") }),
  z.strictObject({ op: z.literal("moveTo"), args: xy }),
  z.strictObject({ op: z.literal("lineTo"), args: xy }),
  z.strictObject({ op: z.literal("quadraticCurveTo"), args: z.tuple([finite, finite, finite, finite]) }),
  z.strictObject({ op: z.literal("bezierCurveTo"), args: z.tuple([finite, finite, finite, finite, finite, finite]) }),
  /** x, y, radiusX, radiusY, rotation, startAngle, endAngle (clockwise). */
  z.strictObject({ op: z.literal("ellipse"), args: z.tuple([finite, finite, finite, finite, finite, finite, finite]) }),
  /** x, y, radius, startAngle, endAngle (clockwise). */
  z.strictObject({ op: z.literal("arc"), args: z.tuple([finite, finite, finite, finite, finite]) }),
  z.strictObject({ op: z.literal("fill") }),
  z.strictObject({ op: z.literal("stroke") }),
  z.strictObject({ op: z.literal("clip") }),
]);

/** A painted face texture: its canvas size, sampling, and which program paints it at each sample frame. */
export const faceTextureSchema = z.strictObject({
  id,
  size: dimension,
  flipY: z.boolean(),
  filter: z.literal("linear"),
  mipmaps: z.boolean(),
  colorSpace: z.literal("srgb"),
  /** One program index per sample frame. */
  programs: z.array(z.number().int().min(0)).min(1),
});

/** The Three stage: an orthographic, lit cel scene drawn in the stage between the ground and foreground SVG planes. */
export const stage3dNodeSchema = z.strictObject({
  kind: z.literal("stage3d"),
  ...nodeBase,
  /** The mesh asset holding every drawable's part. */
  mesh: id,
  /** The scene's default treatment. A document without dots-v1 always says `cel-v1` and carries no groups or spans. */
  treatment: treatmentName,
  /** One entry per cast member whose drawables carry `dots`; the treatment at frame f is the first span containing f, else the group's, else `treatment`. */
  groups: z.array(treatmentGroupSchema).optional(),
  spans: z.array(treatmentSpanSchema).optional(),
  /** The orthographic camera: at z = cameraZ looking down -z; its frustum comes from the document camera and the format. */
  projection: z.strictObject({ cameraZ: finite, near: z.number().gt(0), far: z.number().gt(0) }),
  lighting: z.strictObject({
    directional: z.strictObject({ position: vec3, target: vec3, color: linearRgb, intensity: z.number().min(0) }),
    ambient: z.strictObject({ color: linearRgb, intensity: z.number().min(0) }),
  }),
  /** The toon gradient's texels (0 to 255), sampled nearest. */
  ramp: z.array(z.number().int().min(0).max(255)).min(1),
  output: z.strictObject({
    dpr: z.number().gt(0),
    antialias: z.boolean(),
    colorSpace: z.literal("srgb"),
    toneMapping: z.literal("none"),
    exposure: z.number().gt(0),
  }),
  /** Samples every track and face texture holds; frame f reads sample min(f, sampleFrames - 1). */
  sampleFrames: count,
  nodes: z.array(stageGraphNodeSchema).min(1),
  channels: z.array(stageTrackSchema),
  drawables: z.array(stageDrawableSchema).min(1),
  faceTextures: z.array(faceTextureSchema),
  facePrograms: z.array(z.strictObject({ ops: z.array(faceOpSchema).min(1) })),
});

export type Stage3dNode = z.infer<typeof stage3dNodeSchema>;
export type StageMaterial = z.infer<typeof stageMaterialSchema>;
export type FaceOp = z.infer<typeof faceOpSchema>;
export type MeshAsset = z.infer<typeof meshAssetSchema>;

const groupNodeSchemaV2 = z.strictObject({
  kind: z.literal("group"),
  ...nodeBase,
  x: z.number(),
  y: z.number(),
  scale: z.number().gt(0),
  rotation: z.number(),
  tracks: z.array(nodeTrackSchema),
  get children(): z.ZodArray<z.ZodType<Node>> { return z.array(nodeSchemaV2); },
});

/** Any `/2` node; the stage3d node is allowed only at the top of the stage (a cross-reference rule). */
export const nodeSchemaV2: z.ZodType<Node> = z.discriminatedUnion("kind", [
  svgNodeSchema,
  rectNodeSchema,
  textNodeSchema,
  railNodeSchema,
  captionsNodeSchema,
  endCardNodeSchema,
  stage3dNodeSchema,
  groupNodeSchemaV2,
]);

export const assetSchemaV2 = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("svg"), ...assetBase, elementIds: z.array(text) }),
  z.strictObject({ kind: z.literal("font"), ...assetBase, family: text, weight: z.number().int().min(100).max(900) }),
  z.strictObject({ kind: z.literal("image"), ...assetBase, width: dimension, height: dimension }),
  z.strictObject({ kind: z.literal("audio"), ...assetBase }),
  meshAssetSchema,
]);

/** The whole `/2` document: `/1` plus the stage3d node and the mesh asset. */
export const renderIrSchemaV2 = z.strictObject({
  schema: z.literal(RENDER_IR_VERSION_2),
  film: z.strictObject({ id, fps: z.number().int().min(1).max(240), durationFrames: count }),
  scene: size,
  formats: perFormat(size),
  background: color,
  assets: z.array(assetSchemaV2),
  camera: cameraSchema.optional(),
  stage: z.array(nodeSchemaV2),
  overlay: z.array(nodeSchemaV2),
  audio: z.array(audioClipSchema),
});

// ---------------------------------------------------------------------------------------------
// aideos.render/3: pictures on the stage. Everything above is unchanged `/2`; `/3` adds what follows.
// ---------------------------------------------------------------------------------------------

/** Element properties a picture's own track may drive: placement, scale, rotation and opacity (no stroke reveal, no line ends). */
export const IMAGE_ELEMENT_PROPERTIES = ["translateX", "translateY", "scale", "scaleX", "scaleY", "rotate", "opacity"] as const;

/**
 * A pinned picture placed on the stage like an svg node: `x`, `y`, `scale`, `rotation`, `layer` and node `tracks`
 * place it in scene space, then its own `elementTracks` (all on the one element `element`, the scene's clips on
 * the picture) move, scale, turn and fade it about its own origin, then the image asset is drawn into the box
 * `width` x `height` centred on that origin, stretched to fill, with straight alpha blended over what is below.
 */
export const imageNodeSchema = z.strictObject({
  kind: z.literal("image"),
  ...nodeBase,
  /** An `image` asset of this document. */
  asset: id,
  x: z.number(),
  y: z.number(),
  scale: z.number().gt(0),
  rotation: z.number(),
  layer: z.number().int().min(-2147483648).max(2147483647),
  /** The drawn size in the node's local units, centred on its origin. */
  width: z.number().gt(0),
  height: z.number().gt(0),
  /** The picture's element id: the one target its element tracks may name. */
  element: text,
  tracks: z.array(nodeTrackSchema),
  elementTracks: z.array(elementTrackSchema),
});

export type ImageNode = z.infer<typeof imageNodeSchema>;

const groupNodeSchemaV3 = z.strictObject({
  kind: z.literal("group"),
  ...nodeBase,
  x: z.number(),
  y: z.number(),
  scale: z.number().gt(0),
  rotation: z.number(),
  tracks: z.array(nodeTrackSchema),
  get children(): z.ZodArray<z.ZodType<Node>> { return z.array(nodeSchemaV3); },
});

/** Any `/3` node; an image node is drawn only on the stage (a cross-reference rule). */
export const nodeSchemaV3: z.ZodType<Node> = z.discriminatedUnion("kind", [
  svgNodeSchema,
  rectNodeSchema,
  textNodeSchema,
  railNodeSchema,
  captionsNodeSchema,
  endCardNodeSchema,
  stage3dNodeSchema,
  imageNodeSchema,
  groupNodeSchemaV3,
]);

/** The whole `/3` document: `/2` plus the image node. Its assets are `/2`'s (the image asset already exists in `/1`). */
export const renderIrSchemaV3 = z.strictObject({
  schema: z.literal(RENDER_IR_VERSION_3),
  film: z.strictObject({ id, fps: z.number().int().min(1).max(240), durationFrames: count }),
  scene: size,
  formats: perFormat(size),
  background: color,
  assets: z.array(assetSchemaV2),
  camera: cameraSchema.optional(),
  stage: z.array(nodeSchemaV3),
  overlay: z.array(nodeSchemaV3),
  audio: z.array(audioClipSchema),
});


// /4 adds an opt-in shutter and per-glyph tracks, preserving older closed schemas.
const groupNodeSchemaV4 = z.strictObject({
  kind: z.literal("group"), ...nodeBase, x: z.number(), y: z.number(), scale: z.number().gt(0),
  rotation: z.number(), tracks: z.array(nodeTrackSchema),
  get children(): z.ZodArray<z.ZodType<Node>> { return z.array(nodeSchemaV4); },
});

/** Nodes supported by /4, including text with shaped-glyph tracks. */
export const nodeSchemaV4: z.ZodType<Node> = z.discriminatedUnion("kind", [
  svgNodeSchema, rectNodeSchema, textNodeSchemaV4, railNodeSchema, captionsNodeSchema,
  endCardNodeSchema, stage3dNodeSchema, imageNodeSchema, groupNodeSchemaV4,
]);

/** The /4 document, with a bounded number of evenly spaced shutter samples. */
export const renderIrSchemaV4 = z.strictObject({
  schema: z.literal(RENDER_IR_VERSION_4),
  film: z.strictObject({ id, fps: z.number().int().min(1).max(240), durationFrames: count }),
  scene: size, formats: perFormat(size), background: color, assets: z.array(assetSchemaV2),
  camera: cameraSchema.optional(), stage: z.array(nodeSchemaV4), overlay: z.array(nodeSchemaV4),
  audio: z.array(audioClipSchema),
  shutter: z.strictObject({ samples: z.number().int().min(2).max(16), angle: z.number().gt(0).max(360) }).optional(),
});
