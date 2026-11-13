/**
 * File Description: Loads and checks a Render IR document (`aideos.render/1`): rejects bad JSON, an unknown version or a structurally invalid document, then runs the cross-reference and range rules a schema cannot express (known assets, ordered keyframes, one origin per element, per-format placement, spans inside the film). The Rust loader in native/aideos-render-ir implements the same rules with the same issue codes and is tested against the same fixture files. The pipeline emitter is planned for R4.
 * Inputs and outputs: JSON text or an already parsed value -> a typed RenderIr, or a failure of kind not_json, unsupported_version or invalid_document with every issue found.
 * Used by: the TypeScript Render IR emitter (R4), backend/renderIr/renderIr.test.ts.
 */

import { RENDER_IR_VERSION, renderIrSchema, type Asset, type FormatName, type Keyframe, type Node, type RenderIr } from "./schema";

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
  if (found !== RENDER_IR_VERSION) {
    return { ok: false, error: { kind: "unsupported_version", found, supported: RENDER_IR_VERSION } };
  }
  const parsed = renderIrSchema.safeParse(value);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((i) => ({
      code: "schema",
      path: at("", ...i.path.map((p) => (typeof p === "symbol" ? String(p) : p))),
      message: i.message,
    })));
  }
  const issues = checkSemantics(parsed.data);
  return issues.length ? invalid(issues) : { ok: true, ir: parsed.data };
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
  });

  // Looks an asset up by id and kind, reporting a missing or wrongly typed reference.
  const needAsset = (path: string, id: string, kind: Asset["kind"]): Asset | undefined => {
    const asset = assets.get(id);
    if (!asset) add("unknown_asset", path, `no asset with id ${id}`);
    else if (asset.kind !== kind) add("asset_kind_mismatch", path, `asset ${id} is a ${asset.kind} asset, expected a ${kind} asset`);
    else return asset;
    return undefined;
  };

  // Checks a keyframe list: strictly increasing frames inside the film, an ease on every segment, values in range.
  const checkKeyframes = (path: string, keys: Keyframe[], range?: { min: number; max: number; exclusiveMin?: boolean }) => {
    keys.forEach((k, i) => {
      const kp = at(path, i);
      if (i > 0 && k.frame <= keys[i - 1].frame) add("keyframes_unordered", at(kp, "frame"), "keyframe frames must strictly increase");
      if (k.frame > duration) add("frame_out_of_range", at(kp, "frame"), `frame ${k.frame} is past the film's ${duration} frames`);
      if (i < keys.length - 1 && k.ease === undefined) add("ease_missing", kp, "every keyframe but the last names the easing of the segment after it");
      if (i === keys.length - 1 && k.ease !== undefined) add("ease_on_last", at(kp, "ease"), "the last keyframe has no segment after it");
      if (range && (k.value < range.min || k.value > range.max || (range.exclusiveMin && k.value <= range.min))) {
        add("value_out_of_range", at(kp, "value"), `value ${k.value} is outside ${range.exclusiveMin ? "(" : "["}${range.min}, ${Number.isFinite(range.max) ? range.max : "infinity"}${Number.isFinite(range.max) ? "]" : ")"}`);
      }
    });
  };

  // Checks a node-level track list.
  const checkNodeTracks = (path: string, tracks: Extract<Node, { tracks: unknown[] }>["tracks"]) => {
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
  // Walks a node tree in one space, checking each node.
  const walk = (nodes: Node[], path: string, space: "stage" | "overlay") => {
    nodes.forEach((node, i) => {
      const p = at(path, i);
      if (ids.has(node.id)) add("duplicate_node_id", at(p, "id"), `node id ${node.id} is already used`);
      ids.add(node.id);
      const allowed = space === "stage" ? node.kind === "svg" || node.kind === "group" : node.kind !== "svg";
      if (!allowed) add("node_not_allowed", at(p, "kind"), `a ${node.kind} node cannot be drawn in the ${space}`);
      if (node.visible) checkSpan(at(p, "visible"), node.visible.fromFrame, node.visible.toFrame);
      switch (node.kind) {
        case "group":
          checkNodeTracks(p, node.tracks);
          walk(node.children, at(p, "children"), space);
          break;
        case "svg": {
          checkNodeTracks(p, node.tracks);
          const asset = needAsset(at(p, "asset"), node.asset, "svg");
          const keys = new Set<string>();
          const origins = new Map<string, string>();
          node.elementTracks.forEach((t, j) => {
            const tp = at(p, "elementTracks", j);
            if (asset?.kind === "svg" && !asset.elementIds.includes(t.target)) add("unknown_element", at(tp, "target"), `asset ${node.asset} declares no element ${t.target}`);
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
          checkFormats(at(p, "layout"), node.layout);
          if (node.pressFrame > duration) add("frame_out_of_range", at(p, "pressFrame"), `frame ${node.pressFrame} is past the film's ${duration} frames`);
          break;
      }
    });
  };
  walk(ir.stage, "/stage", "stage");
  walk(ir.overlay, "/overlay", "overlay");

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

// Reports whether an asset path stays inside the package: relative, no backslash, no drive letter, no `..`.
export function isSafeRelativePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\") || path.includes("\u0000") || /^[A-Za-z]:/.test(path)) return false;
  return !path.split("/").some((part) => part === ".." || part === "");
}
