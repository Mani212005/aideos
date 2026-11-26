/**
 * File Description: Loads and checks a Render IR document (`aideos.render/1`, its supersets through `aideos.render/6`): rejects bad JSON, an unknown version or a structurally invalid document (each version against its own schema), then runs the cross-reference and range rules a schema cannot express (known assets, ordered keyframes, one origin per element, per-format placement, spans inside the film, for the Three stage its graph, tracks, parts, textures and face programs, for a picture its image asset, its one element and the properties that element may animate, and for colour tracks their elements, one track per paint and their keyframes). The Rust loader in native/aideos-render-ir implements the same rules with the same issue codes and is tested against the same fixture files.
 * Inputs and outputs: JSON text or an already parsed value -> a typed RenderIr, or a failure of kind not_json, unsupported_version or invalid_document with every issue found.
 * Used by: backend/renderIr/emit.ts (checks every emitted document), backend/renderIr/renderIr.test.ts, backend/renderIr/stage3d.test.ts.
 */

import { RENDER_IR_VERSION_5, renderIrSchemaEffects, IMAGE_ELEMENT_PROPERTIES, RENDER_IR_VERSION, RENDER_IR_VERSION_2, RENDER_IR_VERSION_3, RENDER_IR_VERSION_4, RENDER_IR_VERSIONS, renderIrSchema, renderIrSchemaV2, renderIrSchemaV3, renderIrSchemaV4, renderIrSchemaV5, type Asset, type FormatName, type Node, type RenderIr, type Stage3dNode } from "./schema";

/** The versions this build reads, as the `supported` text of an unsupported_version failure. */
export const SUPPORTED_VERSIONS_TEXT = RENDER_IR_VERSIONS.join(", ");

/** One problem in a document: a stable machine code, a JSON Pointer to the offending value and a sentence. */
export interface Issue {
  code: string;
  path: string;
  message: string;
}

/** Why a document was refused. */
export type LoadFailure =
  | { kind: "not_json"; message: string }
  | { kind: "unsupported_version"; found: string; supported: string }
  | { kind: "invalid_document"; issues: Issue[] };

export type LoadResult = { ok: true; ir: RenderIr } | { ok: false; error: LoadFailure };

const FORMATS: FormatName[] = ["long", "reel"];
const ORIGIN_PROPERTIES = new Set(["scale", "scaleX", "scaleY", "rotate"]);
const UNIT_PROPERTIES = new Set(["opacity", "drawOn"]);

// Escapes one JSON Pointer segment (RFC 6901).
function seg(part: string | number): string {
  return String(part).replace(/~/g, "~0").replace(/\//g, "~1");
}

// Appends a segment to a JSON Pointer.
function at(path: string, ...parts: Array<string | number>): string {
  return path + parts.map((p) => `/${seg(p)}`).join("");
}

/** Parses JSON text and validates it as a Render IR. */
export function parseRenderIr(text: string): LoadResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: { kind: "not_json", message: err instanceof Error ? err.message : String(err) } };
  }
  return validateRenderIr(value);
}

/** Validates a parsed value: version first, then structure, then the cross-reference rules. */
export function validateRenderIr(value: unknown): LoadResult {
  if (typeof value !== "object" || value === null || Array.isArray(value) || typeof (value as Record<string, unknown>).schema !== "string") {
    return invalid([{ code: "schema", path: "", message: "a Render IR is an object with a string `schema` field" }]);
  }
  const found = (value as Record<string, unknown>).schema as string;
  if (!(RENDER_IR_VERSIONS as readonly string[]).includes(found)) {
    return { ok: false, error: { kind: "unsupported_version", found, supported: SUPPORTED_VERSIONS_TEXT } };
  }
  // Each version is checked against its own shape, so an older document cannot carry a later version's addition.
  const parsed = (found === RENDER_IR_VERSION ? renderIrSchema : found === RENDER_IR_VERSION_2 ? renderIrSchemaV2 : found === RENDER_IR_VERSION_3 ? renderIrSchemaV3 : found === RENDER_IR_VERSION_4 ? renderIrSchemaV4 : found === RENDER_IR_VERSION_5 ? renderIrSchemaV5 : renderIrSchemaEffects).safeParse(value);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((i) => ({
      code: "schema",
      path: at("", ...i.path.map((p) => (typeof p === "symbol" ? String(p) : p))),
      message: i.message,
    })));
  }
  const ir = parsed.data as RenderIr;
  const issues = checkSemantics(ir);
  return issues.length ? invalid(issues) : { ok: true, ir };
}

// Wraps issues as an invalid_document failure.
function invalid(issues: Issue[]): LoadResult {
  return { ok: false, error: { kind: "invalid_document", issues } };
}

/** Runs the rules the structural schema cannot express and returns every issue, in document order. */
export function checkSemantics(ir: RenderIr): Issue[] {
  const issues: Issue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const duration = ir.film.durationFrames;
  const declared = FORMATS.filter((f) => ir.formats[f] !== undefined);
  if (declared.length === 0) add("no_formats", "/formats", "declare at least one of long or reel");

  // Assets: unique ids, safe relative paths, unique element ids.
  const assets = new Map<string, Asset>();
  ir.assets.forEach((asset, i) => {
    const p = at("", "assets", i);
    if (assets.has(asset.id)) add("duplicate_asset_id", at(p, "id"), `asset id ${asset.id} is already used`);
    else assets.set(asset.id, asset);
    if (!isSafeRelativePath(asset.path)) add("unsafe_asset_path", at(p, "path"), "an asset path is relative to the package and may not leave it");
    if (asset.kind === "svg") {
      const seen = new Set<string>();
      asset.elementIds.forEach((e, j) => {
        if (seen.has(e)) add("duplicate_element_id", at(p, "elementIds", j), `element id ${e} is listed twice`);
        seen.add(e);
      });
    }
    if (asset.kind === "mesh") {
      const seen = new Set<string>();
      asset.parts.forEach((part, j) => {
        if (seen.has(part.id)) add("duplicate_part_id", at(p, "parts", j, "id"), `mesh part id ${part.id} is listed twice`);
        seen.add(part.id);
        if (part.indices % 3 !== 0) add("indices_not_triangles", at(p, "parts", j, "indices"), `${part.indices} indices are not a whole number of triangles`);
        const kind = part.kind ?? "triangles";
        if (kind === "triangles" && part.indices === 0) add("indices_not_triangles", at(p, "parts", j, "indices"), "a triangles part holds at least one triangle");
        if (kind !== "triangles") {
          if (part.indices !== 0) add("part_kind_mismatch", at(p, "parts", j, "indices"), `a ${kind} part has no indices`);
          if (part.uv) add("part_kind_mismatch", at(p, "parts", j, "uv"), `a ${kind} part has no uvs`);
          if (kind === "lines" && part.vertices % 2 !== 0) add("part_kind_mismatch", at(p, "parts", j, "vertices"), "a lines part holds whole segments (an even number of end points)");
        }
      });
    }
  });

  // Looks an asset up by id and kind, reporting a missing or wrongly typed reference.
  const needAsset = (path: string, id: string, kind: Asset["kind"]): Asset | undefined => {
    const asset = assets.get(id);
    if (!asset) add("unknown_asset", path, `no asset with id ${id}`);
    else if (asset.kind !== kind) add("asset_kind_mismatch", path, `asset ${id} is a ${asset.kind} asset, expected a ${kind} asset`);
    else return asset;
    return undefined;
  };

  // Checks a keyframe list (numeric or colour): strictly increasing frames inside the film, an ease on every segment, values in range.
  const checkKeyframes = (path: string, keys: Array<{ frame: number; ease?: string; value?: number }>, range?: { min: number; max: number; exclusiveMin?: boolean }) => {
    keys.forEach((k, i) => {
      const kp = at(path, i);
      if (i > 0 && k.frame <= keys[i - 1].frame) add("keyframes_unordered", at(kp, "frame"), "keyframe frames must strictly increase");
      if (k.frame > duration) add("frame_out_of_range", at(kp, "frame"), `frame ${k.frame} is past the film's ${duration} frames`);
      if (i < keys.length - 1 && k.ease === undefined) add("ease_missing", kp, "every keyframe but the last names the easing of the segment after it");
      if (i === keys.length - 1 && k.ease !== undefined) add("ease_on_last", at(kp, "ease"), "the last keyframe has no segment after it");
      if (range && k.value !== undefined && (k.value < range.min || k.value > range.max || (range.exclusiveMin && k.value <= range.min))) {
        add("value_out_of_range", at(kp, "value"), `value ${k.value} is outside ${range.exclusiveMin ? "(" : "["}${range.min}, ${Number.isFinite(range.max) ? range.max : "infinity"}${Number.isFinite(range.max) ? "]" : ")"}`);
      }
    });
  };

  // Checks a node-level track list.
  const checkNodeTracks = (path: string, tracks: Extract<Node, { kind: "group" }>["tracks"]) => {
    const seen = new Set<string>();
    tracks.forEach((t, i) => {
      const tp = at(path, "tracks", i);
      if (seen.has(t.property)) add("duplicate_track", tp, `property ${t.property} is driven by two tracks`);
      seen.add(t.property);
      const range = t.property === "opacity" ? { min: 0, max: 1 } : t.property === "scale" ? { min: 0, max: Number.POSITIVE_INFINITY, exclusiveMin: true } : undefined;
      checkKeyframes(at(tp, "keyframes"), t.keyframes, range);
    });
  };

  // Checks that a per-format object has exactly the declared formats.
  const checkFormats = (path: string, value: Partial<Record<FormatName, unknown>>) => {
    for (const f of FORMATS) {
      const present = value[f] !== undefined;
      const wanted = declared.includes(f);
      if (wanted && !present) add("missing_format_entry", at(path, f), `format ${f} is declared but has no entry`);
      if (!wanted && present) add("undeclared_format", at(path, f), `format ${f} is not declared in formats`);
    }
  };

  // Checks a half-open frame span.
  const checkSpan = (path: string, from: number, to: number) => {
    if (to <= from) add("invalid_span", path, "a span must end after it starts");
    else if (to > duration) add("invalid_span", path, `a span may not run past the film's ${duration} frames`);
  };

  const ids = new Set<string>();
  let stage3dCount = 0;
  // Walks a node tree in one space, checking each node; `top` is true for the space's own list.
  const walk = (nodes: Node[], path: string, space: "stage" | "overlay", top: boolean) => {
    nodes.forEach((node, i) => {
      const p = at(path, i);
      if (ids.has(node.id)) add("duplicate_node_id", at(p, "id"), `node id ${node.id} is already used`);
      ids.add(node.id);
      const allowed = node.kind === "stage3d" ? space === "stage" && top : space === "stage" ? node.kind === "svg" || node.kind === "image" || node.kind === "group" : node.kind !== "svg" && node.kind !== "image";
      if (!allowed) add("node_not_allowed", at(p, "kind"), node.kind === "stage3d" ? "a stage3d node is drawn only at the top of the stage" : `a ${node.kind} node cannot be drawn in the ${space}`);
      if (ir.shutter && node.kind === "stage3d") add("shutter_not_supported", at(p, "kind"), "the 2D shutter does not sample stage3d");
      if (ir.shutter && !top && (node.kind === "captions" || node.kind === "rail" || node.kind === "endCard")) add("shutter_not_supported", at(p, "kind"), "chrome must be top-level when the 2D shutter is enabled");
      if (node.visible) checkSpan(at(p, "visible"), node.visible.fromFrame, node.visible.toFrame);
      switch (node.kind) {
        case "stage3d": {
          // Only a stage3d node in its place counts toward the one a document may draw.
          if (allowed && ++stage3dCount > 1) add("node_not_allowed", at(p, "kind"), "a document draws at most one stage3d node");
          const mesh = needAsset(at(p, "mesh"), node.mesh, "mesh");
          checkStage3d(node, p, mesh?.kind === "mesh" ? mesh : undefined, duration, add);
          break;
        }
        case "group":
          checkNodeTracks(p, node.tracks);
          walk(node.children, at(p, "children"), space, false);
          break;
        case "svg":
        case "image": {
          checkNodeTracks(p, node.tracks);
          const asset = needAsset(at(p, "asset"), node.asset, node.kind);
          // A drawn picture is pinned, so a render is as repeatable as an SVG render.
          if (node.kind === "image" && asset?.kind === "image" && asset.sha256 === undefined) add("image_unpinned", at(p, "asset"), `image asset ${asset.id} carries no sha256; a drawn picture is pinned`);
          const keys = new Set<string>();
          const origins = new Map<string, string>();
          node.elementTracks.forEach((t, j) => {
            const tp = at(p, "elementTracks", j);
            if (node.kind === "svg" && asset?.kind === "svg" && !asset.elementIds.includes(t.target)) add("unknown_element", at(tp, "target"), `asset ${node.asset} declares no element ${t.target}`);
            if (node.kind === "image" && t.target !== node.element) add("unknown_element", at(tp, "target"), `image node ${node.id} has the one element ${node.element}, not ${t.target}`);
            if (node.kind === "image" && !(IMAGE_ELEMENT_PROPERTIES as readonly string[]).includes(t.property)) add("property_not_allowed", at(tp, "property"), `a picture's ${t.property} cannot be animated; move, scale, rotate or fade it`);
            const key = `${t.target}\u0000${t.property}`;
            if (keys.has(key)) add("duplicate_track", tp, `${t.property} of ${t.target} is driven by two tracks`);
            keys.add(key);
            if (t.origin && !ORIGIN_PROPERTIES.has(t.property)) add("origin_misplaced", at(tp, "origin"), "only scale and rotate tracks take an origin");
            if (ORIGIN_PROPERTIES.has(t.property)) {
              const origin = `${t.origin?.x ?? 0},${t.origin?.y ?? 0}`;
              const first = origins.get(t.target);
              if (first !== undefined && first !== origin) add("origin_conflict", tp, `element ${t.target} already has a different transform origin`);
              if (first === undefined) origins.set(t.target, origin);
            }
            const range = t.property === "scale" ? { min: 0, max: Number.POSITIVE_INFINITY, exclusiveMin: true } : UNIT_PROPERTIES.has(t.property) ? { min: 0, max: 1 } : undefined;
            checkKeyframes(at(tp, "keyframes"), t.keyframes, range);
          });
          if (node.kind === "svg") {
            // Colour tracks (`/5`): each names an element the asset declares, and one paint of an element has one track.
            const paints = new Set<string>();
            node.colorTracks?.forEach((t, j) => {
              const tp = at(p, "colorTracks", j);
              if (asset?.kind === "svg" && !asset.elementIds.includes(t.target)) add("unknown_element", at(tp, "target"), `asset ${node.asset} declares no element ${t.target}`);
              const key = `${t.target}\u0000${t.property}`;
              if (paints.has(key)) add("duplicate_track", tp, `${t.property} of ${t.target} is driven by two tracks`);
              paints.add(key);
              checkKeyframes(at(tp, "keyframes"), t.keyframes);
            });
          }
          break;
        }
        case "rect":
          checkNodeTracks(p, node.tracks);
          checkFormats(at(p, "placement"), node.placement);
          node.gradient?.stops.forEach((s, j) => {
            if (j > 0 && s.offset < node.gradient!.stops[j - 1].offset) add("stops_unordered", at(p, "gradient", "stops", j, "offset"), "gradient stop offsets may not decrease");
          });
          break;
        case "text":
          needAsset(at(p, "font"), node.font, "font");
          checkNodeTracks(p, node.tracks);
          checkFormats(at(p, "placement"), node.placement);
          {
            const seen = new Set<string>();
            node.glyphTracks?.forEach((track, i) => {
              const tp = at(p, "glyphTracks", i);
              const key = `${track.glyph}:${track.property}`;
              if (seen.has(key)) add("duplicate_track", tp, `glyph ${track.glyph} property ${track.property} is driven by two tracks`);
              seen.add(key);
              const range = track.property === "opacity" ? { min: 0, max: 1 } : track.property === "scale" ? { min: 0, max: Number.POSITIVE_INFINITY, exclusiveMin: true } : undefined;
              checkKeyframes(at(tp, "keyframes"), track.keyframes, range);
            });
          }
          break;
        case "rail": {
          needAsset(at(p, "font"), node.font, "font");
          if (node.progressFrames !== undefined && node.progressFrames > duration) add("frame_out_of_range", at(p, "progressFrames"), `progressFrames ${node.progressFrames} is past the film's ${duration} frames`);
          checkFormats(at(p, "placement"), node.placement);
          let prevEnd = 0;
          node.chapters.forEach((c, j) => {
            const cp = at(p, "chapters", j);
            checkSpan(at(cp, "endFrame"), c.startFrame, c.endFrame);
            if (c.startFrame < prevEnd) add("chapters_unordered", at(cp, "startFrame"), "chapters must follow one another without overlap");
            prevEnd = Math.max(prevEnd, c.endFrame);
          });
          break;
        }
        case "captions": {
          needAsset(at(p, "font"), node.font, "font");
          checkFormats(at(p, "placement"), node.placement);
          let prevStart = 0;
          node.words.forEach((w, j) => {
            const wp = at(p, "words", j);
            checkSpan(at(wp, "endFrame"), w.startFrame, w.endFrame);
            if (w.startFrame < prevStart) add("words_unordered", at(wp, "startFrame"), "caption words must be in spoken order");
            prevStart = w.startFrame;
          });
          for (const f of FORMATS) {
            node.placement[f]?.spans.forEach((s, j) => {
              if (s.fromFrame >= duration) add("frame_out_of_range", at(p, "placement", f, "spans", j, "fromFrame"), `frame ${s.fromFrame} is not inside the film's ${duration} frames`);
              const prev = node.placement[f]!.spans[j - 1];
              if (prev && s.fromFrame <= prev.fromFrame) add("spans_unordered", at(p, "placement", f, "spans", j, "fromFrame"), "placement spans must start in increasing frame order");
            });
          }
          break;
        }
        case "endCard":
          needAsset(at(p, "sansFont"), node.sansFont, "font");
          needAsset(at(p, "monoFont"), node.monoFont, "font");
          if (node.chipFont !== undefined) needAsset(at(p, "chipFont"), node.chipFont, "font");
          checkFormats(at(p, "layout"), node.layout);
          if (node.pressFrame > duration) add("frame_out_of_range", at(p, "pressFrame"), `frame ${node.pressFrame} is past the film's ${duration} frames`);
          break;
      }
    });
  };
  if (ir.shutter) {
    let chromeSeen = false;
    ir.overlay.forEach((node, i) => {
      const chrome = node.kind === "rail" || node.kind === "captions" || node.kind === "endCard";
      if (chromeSeen && !chrome) add("shutter_not_supported", at("/overlay", i, "kind"), "2D content must precede chrome when the 2D shutter is enabled");
      chromeSeen ||= chrome;
    });
  }
  walk(ir.stage, "/stage", "stage", true);
  walk(ir.overlay, "/overlay", "overlay", true);

  if (ir.camera) {
    checkKeyframes("/camera/centerX", ir.camera.centerX);
    checkKeyframes("/camera/centerY", ir.camera.centerY);
    checkKeyframes("/camera/zoom", ir.camera.zoom, { min: 0, max: Number.POSITIVE_INFINITY, exclusiveMin: true });
    checkKeyframes("/camera/rotation", ir.camera.rotation);
  }

  const audioIds = new Set<string>();
  ir.audio.forEach((clip, i) => {
    const p = at("", "audio", i);
    if (audioIds.has(clip.id)) add("duplicate_audio_id", at(p, "id"), `audio clip id ${clip.id} is already used`);
    audioIds.add(clip.id);
    needAsset(at(p, "asset"), clip.asset, "audio");
    if (clip.startFrame + clip.durationFrames > duration) add("invalid_span", p, `the clip runs past the film's ${duration} frames`);
    checkKeyframes(at(p, "gainEnvelope"), clip.gainEnvelope, { min: 0, max: 4 });
  });
  return issues;
}

/** Channel widths of a stage track: numbers per sample. */
const TRACK_WIDTH = { position: 3, quaternion: 4, scale: 1 } as const;

// Checks one stage3d node: its graph (unique ids, parents listed first), tracks (one per node, every channel `sampleFrames` samples long, scale above zero), drawables (known node, part and texture) and face textures (programs that exist, one per sample frame).
function checkStage3d(node: Stage3dNode, p: string, mesh: Extract<Asset, { kind: "mesh" }> | undefined, duration: number, add: (code: string, path: string, message: string) => void): void {
  const n = node.sampleFrames;
  if (n > duration) add("frame_out_of_range", at(p, "sampleFrames"), `sampleFrames ${n} is past the film's ${duration} frames`);
  // Graph nodes, drawables and face textures each have their own id space inside the stage (a drawable usually shares its node's id).
  const spaces = { nodes: new Set<string>(), drawables: new Set<string>(), faceTextures: new Set<string>(), groups: new Set<string>() };
  const claim = (space: keyof typeof spaces, path: string, id: string) => {
    if (spaces[space].has(id)) add("duplicate_stage3d_id", path, `stage3d ${space} id ${id} is already used`);
    spaces[space].add(id);
  };
  const graph = new Set<string>();
  node.nodes.forEach((g, i) => {
    const gp = at(p, "nodes", i);
    claim("nodes", at(gp, "id"), g.id);
    if (g.parent !== undefined && !graph.has(g.parent)) add("unknown_node", at(gp, "parent"), `parent ${g.parent} is not a node listed before ${g.id}`);
    graph.add(g.id);
  });
  const tracked = new Set<string>();
  node.channels.forEach((t, i) => {
    const tp = at(p, "channels", i);
    if (!graph.has(t.node)) add("unknown_node", at(tp, "node"), `no stage3d node ${t.node}`);
    if (tracked.has(t.node)) add("duplicate_track", tp, `node ${t.node} is driven by two tracks`);
    tracked.add(t.node);
    for (const channel of ["position", "quaternion", "scale"] as const) {
      const values = t[channel];
      if (values === undefined) continue;
      const want = n * TRACK_WIDTH[channel];
      if (values.length !== want) add("sample_count_mismatch", at(tp, channel), `${channel} has ${values.length} numbers, ${n} samples need ${want}`);
      if (channel === "scale") {
        const bad = values.findIndex((v) => !(v > 0));
        if (bad >= 0) add("value_out_of_range", at(tp, channel, bad), `scale ${values[bad]} is not above 0`);
      }
    }
  });
  const textures = new Map(node.faceTextures.map((t) => [t.id, t]));
  const parts = new Map(mesh?.parts.map((part) => [part.id, part.kind ?? "triangles"]) ?? []);
  // Checks that a part exists in the mesh and is of the wanted kind.
  const needPart = (path: string, id: string, want: "triangles" | "points" | "lines") => {
    if (!mesh) return;
    const kind = parts.get(id);
    if (kind === undefined) add("unknown_part", path, `mesh ${mesh.id} has no part ${id}`);
    else if (kind !== want) add("part_kind_mismatch", path, `part ${id} is a ${kind} part, a ${want} part is needed here`);
  };
  node.groups?.forEach((g, i) => claim("groups", at(p, "groups", i, "id"), g.id));
  node.spans?.forEach((span, i) => {
    const sp = at(p, "spans", i, "endFrame");
    if (span.endFrame <= span.startFrame) add("invalid_span", sp, "a span must end after it starts");
    else if (span.endFrame > duration) add("invalid_span", sp, `a span may not run past the film's ${duration} frames`);
  });
  const usesDots = node.drawables.some((d) => d.dots !== undefined);
  node.drawables.forEach((d, i) => {
    const dp = at(p, "drawables", i);
    claim("drawables", at(dp, "id"), d.id);
    if (!graph.has(d.node)) add("unknown_node", at(dp, "node"), `no stage3d node ${d.node}`);
    needPart(at(dp, "part"), d.part, "triangles");
    if (d.material.kind === "face" && !textures.has(d.material.texture)) add("unknown_texture", at(dp, "material", "texture"), `no face texture ${d.material.texture}`);
    if (d.group !== undefined && !spaces.groups.has(d.group)) add("unknown_group", at(dp, "group"), `no treatment group ${d.group}`);
    if (usesDots && d.order === undefined) add("dots_incomplete", at(dp, "order"), "every drawable of a document that uses dots-v1 carries its draw order");
    if (d.dots) {
      if (d.group === undefined) add("dots_incomplete", at(dp, "group"), "a drawable with a dots-v1 look belongs to a treatment group");
      if (d.dots.material.kind === "faceLuma" && !textures.has(d.dots.material.texture)) add("unknown_texture", at(dp, "dots", "material", "texture"), `no face texture ${d.dots.material.texture}`);
      if (d.dots.samples) needPart(at(dp, "dots", "samples", "part"), d.dots.samples.part, "points");
      if (d.dots.edges) needPart(at(dp, "dots", "edges", "part"), d.dots.edges.part, "lines");
    }
  });
  node.faceTextures.forEach((t, i) => {
    const fp = at(p, "faceTextures", i);
    claim("faceTextures", at(fp, "id"), t.id);
    if (t.programs.length !== n) add("sample_count_mismatch", at(fp, "programs"), `${t.programs.length} program indices, ${n} samples need ${n}`);
    const bad = t.programs.findIndex((index) => index >= node.facePrograms.length);
    if (bad >= 0) add("unknown_program", at(fp, "programs", bad), `program ${t.programs[bad]} is not one of the ${node.facePrograms.length} face programs`);
  });
  if (node.projection.far <= node.projection.near) add("value_out_of_range", at(p, "projection", "far"), "the far plane must be beyond the near plane");
}

// Reports whether an asset path stays inside the package: relative, no backslash, no drive letter, no `..`.
export function isSafeRelativePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\") || path.includes("\u0000") || /^[A-Za-z]:/.test(path)) return false;
  return !path.split("/").some((part) => part === ".." || part === "");
}
