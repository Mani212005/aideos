/**
 * File Description: The design check's rules for SVG drawn together with pictures (the illustrated stage's composition): a callout (an SVG group marked `data-callout="<picture asset id>"`) must keep its anchor (the element marked `data-anchor="true"`) on that picture's visible, alpha-trimmed box whenever the picture shows, even while the picture moves; a callout's leader lines and arrows must keep non-text contrast against the picture under them; and a picture drawn above an SVG label or callout must not hide it. Geometry comes from the compiled scene (element states, layer order), pixels from the pinned picture files, the same way the label contrast rule measures them.
 * Inputs and outputs: a parsed film, its scene, the compiled scene and the formats to check -> design findings naming the asset, callout or label, the frame and the measured value.
 * Used by: backend/designCheck/designCheck.ts.
 */

import { DEFAULT_FPS } from "../../src/dl/defaults";

import fs from "node:fs";
import type { Film } from "../../src/dl/schema";
import type { Scene } from "../../src/dl/scene/types";
import type { CompiledEntity, CompiledScene } from "../../src/dl/scene/compile";
import { buildTimeline } from "../../src/dl/camera";
import { parseSvgDocument, type SvgNode } from "../../src/dl/scene/svgDocument";
import { elementOpacity, VISIBLE_OPACITY_MIN } from "../../src/dl/scene/visibility";
import { resolveRepoAssetPath } from "../videoPackageLoader";
import { pictureLocalBox } from "../pictures/bounds";
import { apply, IDENTITY, leafBounds, multiply, NON_DRAWING_TAGS, numbers, parseTransform, pathPoints, styleValue, type Affine, type Box } from "./svgBounds";
import { sceneToFrame, stateMatrix } from "./insetRegion";
import { canvasChannels, channels, composite, contrastRatio, drawnPictures, invert, placement, PICTURE_THRESHOLDS, relativeLuminance, type DrawnPicture } from "./pictures";
import type { DesignFinding } from "./types";

/** The attribute that marks an SVG group as a callout of one picture; its value is the picture's asset id. */
export const CALLOUT_ATTR = "data-callout";
/** The attribute that marks the element of a callout whose centre is the point it names on the picture. */
export const ANCHOR_ATTR = "data-anchor";

/** One link of an element's ancestor chain: its id (for animated state), authored transform and opacity. */
type ChainLink = { id?: string; transform: Affine; opacity: number };

/** One drawn part of an SVG asset the composition rules measure. */
interface Part {
  name: string;
  /** text: a label; leader: a stroked line, polyline or path inside a callout; anchor: the callout's anchor; mark: any other callout ink. */
  kind: "text" | "leader" | "anchor" | "mark";
  /** The callout group's id and the picture it points at, for parts inside a callout. */
  callout?: { name: string; picture: string };
  box: Box;
  /** A leader's geometry in local units (straight segments through these points). */
  points?: Array<[number, number]>;
  /** A text's fill or a leader's stroke. */
  color?: [number, number, number];
  strokeOnly: boolean;
  chain: ChainLink[];
}

/** One callout group of an asset: its id, the picture it names and whether it marks an anchor. */
interface CalloutGroup {
  name: string;
  picture: string;
  anchors: number;
}

/** The parts and callouts of an SVG asset document. */
interface AssetComposition {
  parts: Part[];
  callouts: CalloutGroup[];
}

/** Composition data per SVG file version. */
const COMPOSITION_CACHE = new Map<string, AssetComposition>();

/** Reads an element's authored opacity attribute, 1 when absent. */
function authoredOpacity(node: SvgNode): number {
  const v = Number.parseFloat(node.attrs.opacity ?? "");
  return Number.isFinite(v) ? v : 1;
}

/** A leader's points: a line's two ends, a polyline's points or a path's points. */
function leaderPoints(node: SvgNode): Array<[number, number]> {
  if (node.tag === "line") {
    const n = (k: string) => Number.parseFloat(node.attrs[k] ?? "0") || 0;
    return [[n("x1"), n("y1")], [n("x2"), n("y2")]];
  }
  if (node.tag === "polyline") {
    const n = numbers(node.attrs.points ?? "");
    const pts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
    return pts;
  }
  return pathPoints(node.attrs.d ?? "");
}

/** Reads the labels, callout parts and callout groups of an SVG asset, with inherited fill and stroke. */
export function assetComposition(svgSource: string): AssetComposition {
  const file = resolveRepoAssetPath(svgSource);
  if (!fs.existsSync(file)) return { parts: [], callouts: [] };
  const stat = fs.statSync(file);
  const key = `${file}:${stat.mtimeMs}:${stat.size}`;
  const cached = COMPOSITION_CACHE.get(key);
  if (cached) return cached;
  const out: AssetComposition = { parts: [], callouts: [] };
  let doc;
  try {
    doc = parseSvgDocument(fs.readFileSync(file, "utf8"));
  } catch {
    return out; // The scene rule reports artwork that does not parse.
  }
  const visit = (node: SvgNode, chain: ChainLink[], paint: { fill: string; stroke: string }, nearestId: string | undefined, callout: { group: CalloutGroup } | undefined) => {
    if (NON_DRAWING_TAGS.has(node.tag) || node.attrs.display === "none" || node.attrs.visibility === "hidden") return;
    const here = [...chain, { id: node.attrs.id, transform: parseTransform(node.attrs.transform), opacity: authoredOpacity(node) }];
    const own = { fill: node.tag === "line" ? "none" : styleValue(node, "fill") ?? paint.fill, stroke: styleValue(node, "stroke") ?? paint.stroke };
    const name = node.attrs.id ?? nearestId;
    let inCallout = callout;
    const pictureId = node.attrs[CALLOUT_ATTR];
    if (pictureId !== undefined) {
      const group: CalloutGroup = { name: name ?? `${node.tag} callout`, picture: pictureId.trim(), anchors: 0 };
      out.callouts.push(group);
      inCallout = { group };
    }
    const box = leafBounds(node);
    const isAnchor = node.attrs[ANCHOR_ATTR] !== undefined && node.attrs[ANCHOR_ATTR] !== "false";
    if (box) {
      const strokeOnly = own.fill === "none" && own.stroke !== "none";
      const base = { name: name ?? node.tag, box, strokeOnly, chain: here, ...(inCallout ? { callout: { name: inCallout.group.name, picture: inCallout.group.picture } } : {}) };
      if (node.tag === "text") {
        const color = own.fill === "none" ? null : channels(own.fill);
        out.parts.push({ ...base, kind: "text", ...(color ? { color } : {}) });
      } else if (inCallout && isAnchor) {
        inCallout.group.anchors++;
        out.parts.push({ ...base, kind: "anchor" });
      } else if (inCallout && ["line", "polyline", "path"].includes(node.tag) && own.stroke !== "none") {
        const color = channels(own.stroke);
        out.parts.push({ ...base, kind: "leader", points: leaderPoints(node), ...(color ? { color } : {}) });
      } else if (inCallout && !(own.fill === "none" && own.stroke === "none")) {
        out.parts.push({ ...base, kind: "mark" });
      }
    }
    if (node.tag === "text") return;
    for (const child of node.children) visit(child, here, own, name, inCallout);
  };
  for (const child of doc.children) visit(child, [], { fill: "#000000", stroke: "none" }, undefined, undefined);
  COMPOSITION_CACHE.set(key, out);
  return out;
}

/** A part as drawn at one frame: its matrix into the target space, its opacity and how much of its stroke is drawn on. */
interface PlacedPart {
  m: Affine;
  opacity: number;
  drawOn: number;
}

/** Places one part of an SVG entity at a frame (base maps scene units to the target space), or null when it is not visible. */
function placePart(entity: CompiledEntity, part: Part, base: Affine): PlacedPart | null {
  const states = entity.elementStates ?? {};
  let m = multiply(base, placement(entity));
  let opacity = entity.transform.opacity;
  let drawOn = 1;
  for (const link of part.chain) {
    const state = link.id ? states[link.id] : undefined;
    m = multiply(m, link.transform);
    if (state) {
      m = multiply(m, stateMatrix(state));
      opacity *= elementOpacity(state, link.opacity);
      drawOn = Math.min(drawOn, state.drawOn);
    } else opacity *= link.opacity;
  }
  if (opacity <= VISIBLE_OPACITY_MIN) return null;
  // A stroke-only part with nothing drawn on yet has no ink.
  if (part.strokeOnly && drawOn <= 0.02) return null;
  return { m, opacity, drawOn: part.strokeOnly ? drawOn : 1 };
}

/** Points along the drawn length of a leader, in the target space. */
function leaderSamples(part: Part, placed: PlacedPart, count = 32): Array<[number, number]> {
  const pts = (part.points ?? []).map(([x, y]) => apply(placed.m, x, y));
  if (pts.length < 2) return pts;
  const lengths = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= 0) return [pts[0]];
  const drawn = total * Math.max(0, Math.min(1, placed.drawOn));
  const out: Array<[number, number]> = [];
  for (let s = 0; s < count; s++) {
    let d = ((s + 0.5) / count) * drawn;
    for (let i = 0; i < lengths.length; i++) {
      if (d <= lengths[i] || i === lengths.length - 1) {
        const t = lengths[i] > 0 ? Math.min(1, d / lengths[i]) : 0;
        out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]);
        break;
      }
      d -= lengths[i];
    }
  }
  return out;
}

/** A grid of points over a part's local box, in the target space (follows rotation and scale). */
function boxSamples(part: Part, placed: PlacedPart, cols = 12, rows = 4): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = part.box.x0 + ((c + 0.5) * (part.box.x1 - part.box.x0)) / cols;
      const y = part.box.y0 + ((r + 0.5) * (part.box.y1 - part.box.y0)) / rows;
      out.push(apply(placed.m, x, y));
    }
  }
  return out;
}

/** How opaquely the given pictures cover a point (0 to 1), composited in order. */
function coverAt(x: number, y: number, pictures: DrawnPicture[]): number {
  let clear = 1;
  for (const p of pictures) {
    const [u, v] = apply(p.toPixel, x, y);
    const px = Math.floor(u);
    const py = Math.floor(v);
    if (px < 0 || py < 0 || px >= p.image.width || py >= p.image.height) continue;
    clear *= 1 - (p.image.rgba[(py * p.image.width + px) * 4 + 3] / 255) * p.opacity;
  }
  return 1 - clear;
}

/** The frames the composition rules sample: the middle of every shot, and at least every `compositionSampleSec`. */
function sampleFrames(film: Film, compiled: CompiledScene): number[] {
  const last = compiled.frames.length - 1;
  if (last < 0) return [];
  const frames = new Set<number>();
  for (const timed of buildTimeline(film)) frames.add(Math.max(0, Math.min(last, Math.round((timed.from + timed.to) / 2))));
  const step = Math.max(1, Math.round(PICTURE_THRESHOLDS.compositionSampleSec * (compiled.fps || DEFAULT_FPS)));
  for (let f = 0; f <= last; f += step) frames.add(f);
  return [...frames].sort((a, b) => a - b);
}

/** Formats a point in scene units for a message. */
const at = (p: [number, number]) => `(${Math.round(p[0])}, ${Math.round(p[1])})`;

/**
 * The anchor rule: every callout names a picture of the scene and marks an anchor, and whenever that picture shows,
 * the anchor's centre lies on the picture's visible (alpha-trimmed) box, so a label never points at empty air beside
 * the object or stays behind when the object moves. While the picture is not shown (an SVG diagram that the picture
 * later replaces) the callout may point at the diagram, and is not measured.
 */
export function checkCalloutAnchors(film: Film, scene: Scene, compiled: CompiledScene): DesignFinding[] {
  const findings: DesignFinding[] = [];
  const pictureIds = new Set([scene.background, ...scene.props].filter((a) => a?.raster).map((a) => a!.assetId));
  for (const asset of scene.props) {
    if (!asset.svgSource) continue;
    for (const callout of assetComposition(asset.svgSource).callouts) {
      const where = `${asset.assetId} / ${callout.name}`;
      if (!pictureIds.has(callout.picture)) findings.push({ rule: "callout-anchor", severity: "error", where, message: `callout points at "${callout.picture}", which is not a picture of this scene; set ${CALLOUT_ATTR} to the asset id of the picture it labels.` });
      if (callout.anchors !== 1) findings.push({ rule: "callout-anchor", severity: "error", where, message: `callout marks ${callout.anchors} anchors; mark exactly one element ${ANCHOR_ATTR}="true" (the dot or arrow tip on the picture), so the build can check it stays on the object.` });
    }
  }
  if (findings.length) return findings;
  const reported = new Set<string>();
  for (const f of sampleFrames(film, compiled)) {
    const frame = compiled.frames[f];
    const byId = new Map(frame.entities.map((e) => [e.entityId, e]));
    for (const entity of frame.entities) {
      if (!entity.svgSource || entity.transform.opacity <= VISIBLE_OPACITY_MIN) continue;
      for (const part of assetComposition(entity.svgSource).parts) {
        if (part.kind !== "anchor" || !part.callout) continue;
        const key = `${entity.entityId}:${part.callout.name}`;
        if (reported.has(key)) continue;
        const placed = placePart(entity, part, IDENTITY);
        if (!placed) continue;
        const picture = byId.get(part.callout.picture);
        if (!picture?.raster || picture.transform.opacity <= VISIBLE_OPACITY_MIN) continue;
        const state = picture.elementStates?.[picture.entityId];
        if (picture.transform.opacity * (state ? elementOpacity(state, 1) : 1) <= VISIBLE_OPACITY_MIN) continue;
        const local = multiply(placement(picture), state ? stateMatrix(state) : IDENTITY);
        const toLocal = invert(local);
        const box = pictureLocalBox(picture.raster);
        if (!toLocal || !box) continue;
        const point = apply(placed.m, (part.box.x0 + part.box.x1) / 2, (part.box.y0 + part.box.y1) / 2);
        const [u, v] = apply(toLocal, point[0], point[1]);
        if (u >= box.x0 && u <= box.x1 && v >= box.y0 && v <= box.y1) continue;
        reported.add(key);
        const corners = [apply(local, box.x0, box.y0), apply(local, box.x1, box.y1)];
        findings.push({
          rule: "callout-anchor",
          severity: "error",
          where: `${entity.entityId} / ${part.callout.name}`,
          message: `callout anchor sits at ${at(point)}, off picture "${picture.entityId}" whose visible box spans ${at(corners[0])} to ${at(corners[1])} (scene units, alpha-trimmed) at frame ${f}. Put the anchor on the part of the object it names, and move the callout with the picture (a picture's translate clip is in its own pixels, so the same scene distance is the picture's value times its scale).`,
        });
      }
    }
  }
  return findings;
}

/**
 * The hidden-label rule: a picture drawn above an SVG label (any text) or any part of a callout must not cover it.
 * Labels and callouts belong on a layer above the pictures they describe; diagram linework may sit below a picture
 * that replaces it, but its words may not.
 */
export function checkPictureCover(film: Film, compiled: CompiledScene): DesignFinding[] {
  const t = PICTURE_THRESHOLDS;
  const findings: DesignFinding[] = [];
  const reported = new Set<string>();
  for (const f of sampleFrames(film, compiled)) {
    const entities = compiled.frames[f].entities;
    entities.forEach((entity, index) => {
      if (!entity.svgSource || entity.transform.opacity <= VISIBLE_OPACITY_MIN) return;
      const above = drawnPictures(entities, entities.length, IDENTITY, index + 1);
      if (!above.length) return;
      for (const part of assetComposition(entity.svgSource).parts) {
        if (part.kind !== "text" && !part.callout) continue;
        const key = `${entity.entityId}:${part.name}`;
        if (reported.has(key)) continue;
        const placed = placePart(entity, part, IDENTITY);
        if (!placed) continue;
        const samples = part.kind === "leader" ? leaderSamples(part, placed) : boxSamples(part, placed);
        if (!samples.length) continue;
        const hidden = samples.filter(([x, y]) => coverAt(x, y, above) >= t.coverAlphaMin).length / samples.length;
        if (hidden <= t.coverShareMax) continue;
        reported.add(key);
        findings.push({
          rule: "picture-cover",
          severity: "error",
          where: `${entity.entityId} / ${part.name}`,
          message: `picture "${above.map((p) => p.id).join(", ")}" is drawn above this ${part.kind === "text" ? "label" : `callout ${part.kind}`} and hides ${(hidden * 100).toFixed(0)}% of it at frame ${f} (at most ${(t.coverShareMax * 100).toFixed(0)}%). Give the SVG asset a higher layer than the picture, or move it off the picture.`,
        });
      }
    });
  }
  return findings;
}

/**
 * The leader contrast rule: at the middle of every shot, in each format, a callout's leader line or arrow drawn over a
 * picture keeps WCAG non-text contrast (3:1) against the worst tenth of the picture pixels under its drawn length,
 * measured like the label contrast rule (picture pixels only).
 */
export function checkLeaderContrast(film: Film, scene: Scene, compiled: CompiledScene, formats: ReadonlyArray<"long" | "reel">): DesignFinding[] {
  const t = PICTURE_THRESHOLDS;
  const canvas = canvasChannels(film);
  const findings: DesignFinding[] = [];
  const reported = new Set<string>();
  for (const timed of buildTimeline(film)) {
    const f = Math.max(0, Math.min(compiled.frames.length - 1, Math.round((timed.from + timed.to) / 2)));
    const frame = compiled.frames[f];
    if (!frame) continue;
    for (const format of formats) {
      const [width, height] = format === "long" ? [1920, 1080] : [1080, 1920];
      const toPx = sceneToFrame(frame, scene, width, height);
      frame.entities.forEach((entity, index) => {
        if (!entity.svgSource || entity.transform.opacity <= VISIBLE_OPACITY_MIN) return;
        const below = drawnPictures(frame.entities, index, toPx);
        if (!below.length) return;
        for (const part of assetComposition(entity.svgSource).parts) {
          if (part.kind !== "leader" || !part.color) continue;
          const key = `${format}:${entity.entityId}:${part.name}`;
          if (reported.has(key)) continue;
          const placed = placePart(entity, part, toPx);
          if (!placed) continue;
          const samples = leaderSamples(part, placed).filter(([x, y]) => x >= 0 && y >= 0 && x < width && y < height);
          const lum = relativeLuminance(...part.color);
          const ratios: number[] = [];
          for (const [x, y] of samples) {
            const rgb = composite(x, y, below, canvas);
            if (rgb) ratios.push(contrastRatio(lum, relativeLuminance(...rgb)));
          }
          if (ratios.length < 8) continue;
          ratios.sort((p, q) => p - q);
          const worst = ratios[Math.floor(ratios.length * t.labelContrastPercentile)];
          if (worst >= t.leaderContrastMin) continue;
          reported.add(key);
          findings.push({
            rule: "contrast",
            severity: "error",
            where: `shot ${timed.shot.id} / ${entity.entityId} / ${part.name}`,
            message: `callout leader over picture "${below.map((p) => p.id).join(", ")}" has contrast ${worst.toFixed(2)}:1 against the busiest tenth under it in the ${format === "long" ? "wide" : "reel"} cut at frame ${f} (needs ${t.leaderContrastMin}:1). Change the leader's colour, route it over a calmer part of the picture, or quiet the picture.`,
          });
        }
      });
    }
  }
  return findings;
}

/** Runs the composition rules over a scene that has pictures: callout anchors, hidden labels and leader contrast. */
export function checkPictureComposition(film: Film, scene: Scene, compiled: CompiledScene, formats: ReadonlyArray<"long" | "reel">): DesignFinding[] {
  if (![scene.background, ...scene.props].some((a) => a?.raster)) {
    // Callouts need a picture to point at; name the mistake instead of passing silently.
    const callouts = scene.props.filter((a) => a.svgSource).flatMap((a) => assetComposition(a.svgSource!).callouts.map((c) => ({ asset: a.assetId, c })));
    return callouts.map(({ asset, c }) => ({ rule: "callout-anchor" as const, severity: "error" as const, where: `${asset} / ${c.name}`, message: `callout points at "${c.picture}", but this scene has no pictures; callouts label a picture of the illustrated stage.` }));
  }
  return [...checkCalloutAnchors(film, scene, compiled), ...checkPictureCover(film, compiled), ...checkLeaderContrast(film, scene, compiled, formats)];
}
