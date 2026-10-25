/**
 * File Description: The inset rule of the design check. A shot staged "inset" puts one device in the format's fixed
 * inset region while the scene keeps playing around it, so no scene art may be visible inside that region while the
 * shot is on screen. Art is measured per drawn element (never per asset, whose box would cover the whole stage),
 * through the compiled scene so authored transforms, element animation, asset placement and the scene camera all count,
 * then through each format's window onto the square scene, in both the wide cut and the reel.
 * Inputs and outputs: a parsed scene or film -> projected SVG parts and inset findings naming shot, asset, element, format and frame.
 * Used by: backend/designCheck/designCheck.ts, threeStage.ts and designCheck.test.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { buildTimeline } from "../../src/dl/camera";
import type { Film } from "../../src/dl/schema";
import { getInsetRegion, INSET_FORMAT_FRAMES, type InsetRect } from "../../src/dl/fullScreenHeroLayout";
import { compileScene, type CompiledEntity, type CompiledFrame } from "../../src/dl/scene/compile";
import type { Scene } from "../../src/dl/scene/types";
import { stageProjection } from "../../src/dl/scene/projection";
import { parseSvgDocument, type SvgNode } from "../../src/dl/scene/svgDocument";
import { getExamplesDir, getVideosDir, resolvePackageDir, resolveRepoAssetPath } from "../../src/dl/videoPackageLoader";
import {
  apply,
  IDENTITY,
  isStrokeOnly,
  leafBounds,
  multiply,
  NON_DRAWING_TAGS,
  paintsNothing,
  parseTransform,
  rotation,
  scaling,
  translation,
  type Affine,
  type Box,
} from "./svgBounds";

/** Art fainter than this (ghost grids, resting traces) does not count as occupying the region. */
export const INSET_ART_MIN_OPACITY = 0.15;

/** How far art may reach into the region before it counts, in render pixels (anti-alias fringe). */
const OVERLAP_TOLERANCE_PX = 2;

/** Frames between samples of an inset shot; short enough that no element crosses the region between two. */
const SAMPLE_STEP_FRAMES = 3;

/** A finding produced by the inset rule, shaped like the design check's own findings. */
export interface InsetFinding {
  where: string;
  message: string;
}

/** One drawn element of an asset, with the chain of identified ancestors that can animate it. */
interface Leaf {
  /** The id used to name it: its own, else the nearest identified ancestor, else its tag. */
  name: string;
  box: Box;
  strokeOnly: boolean;
  /** Ancestors then self, outermost first, each with the static data the renderer composes. */
  chain: Array<{ id?: string; transform: Affine; opacity: number }>;
}

/** The drawn elements of one parsed asset document, cached per file version. */
const LEAF_CACHE = new Map<string, Leaf[]>();

// Resolves only package visual assets and rejects absolute or escaping sources.
export function resolveCaptionSvgSource(svgSource: string, packageSlug?: string): string {
  const parts = svgSource.split("/");
  if (
    path.isAbsolute(svgSource) ||
    parts.some((part) => !part || part === "." || part === "..") ||
    !/^(videos|examples)\/[^/]+\/visuals\/[^/]+\.svg$/.test(svgSource)
  ) throw new Error(`Caption geometry only accepts package visuals SVG paths: ${svgSource}`);
  const targetSlug = packageSlug ?? parts[1];
  if (packageSlug && (parts[1] !== packageSlug || !/^[a-z0-9-]+$/.test(packageSlug)))
    throw new Error(`Caption geometry SVG source must belong to package ${packageSlug}: ${svgSource}`);
  if (!/^[a-z0-9-]+$/.test(targetSlug))
    throw new Error(`Caption geometry package slug is invalid: ${targetSlug}`);
  const personalDir = getVideosDir();
  const packageDir = resolvePackageDir(targetSlug);
  const personalPackage = path.resolve(packageDir) === path.resolve(personalDir, targetSlug);
  const expectedPrefix = `${personalPackage ? "videos" : "examples"}/${targetSlug}/visuals/`;
  if (!svgSource.startsWith(expectedPrefix))
    throw new Error(`Caption geometry SVG source must belong to package ${targetSlug}: ${svgSource}`);
  const packageVisuals = path.join(packageDir, "visuals");
  const svgPath = path.join(packageVisuals, parts[3]);
  try {
    if (fs.lstatSync(packageDir).isSymbolicLink() || fs.lstatSync(packageVisuals).isSymbolicLink() || fs.lstatSync(svgPath).isSymbolicLink())
      throw new Error("Package SVG paths may not be symlinks");
    const videosRoot = fs.realpathSync(personalPackage ? personalDir : getExamplesDir());
    const physicalPackage = fs.realpathSync(packageDir);
    if (physicalPackage !== path.join(videosRoot, targetSlug)) throw new Error("Package directory is not physically owned by its root");
    const visualRoot = fs.realpathSync(packageVisuals);
    const resolved = fs.realpathSync(svgPath);
    const visualRelative = path.relative(visualRoot, resolved);
    if (visualRelative.startsWith("..") || path.isAbsolute(visualRelative)) throw new Error("SVG escapes package visuals");
    return resolved;
  } catch {
    throw new Error(`Caption geometry SVG source does not resolve to an authorized package asset: ${svgSource}`);
  }
}

// Reads an element's authored opacity, defaulting to opaque.
function authoredOpacity(node: SvgNode): number {
  const v = Number.parseFloat(node.attrs.opacity ?? "");
  return Number.isFinite(v) ? v : 1;
}

// Flattens an asset document into its drawn elements, recording each one's chain of ancestors.
function collectLeaves(svgSource: string, packageSlug?: string): Leaf[] {
  const file = packageSlug ? resolveCaptionSvgSource(svgSource, packageSlug) : resolveRepoAssetPath(svgSource);
  if (!fs.existsSync(file)) return [];
  // A design build rewrites artwork in place, so the cache is keyed by the file's own version.
  const stat = fs.statSync(file);
  const key = `${file}:${stat.mtimeMs}:${stat.size}`;
  const cached = LEAF_CACHE.get(key);
  if (cached) return cached;
  const leaves: Leaf[] = [];
  const doc = parseSvgDocument(fs.readFileSync(file, "utf8"));
  const visit = (node: SvgNode, chain: Leaf["chain"], nearestId: string | undefined): void => {
    if (NON_DRAWING_TAGS.has(node.tag) || node.attrs.display === "none" || node.attrs.visibility === "hidden") return;
    const here = [...chain, { id: node.attrs.id, transform: parseTransform(node.attrs.transform), opacity: authoredOpacity(node) }];
    const name = node.attrs.id ?? nearestId;
    const box = leafBounds(node);
    if (box && !paintsNothing(node)) {
      leaves.push({ name: name ?? node.tag, box, strokeOnly: isStrokeOnly(node), chain: here });
    }
    for (const child of node.children) visit(child, here, name);
  };
  for (const child of doc.children) visit(child, [], undefined);
  LEAF_CACHE.set(key, leaves);
  return leaves;
}

// The matrix an element's animated state adds on top of its authored transform (the renderer's order).
function stateMatrix(state: NonNullable<CompiledEntity["elementStates"]>[string]): Affine {
  let m = IDENTITY;
  if (state.translateX !== 0 || state.translateY !== 0) m = multiply(m, translation(state.translateX, state.translateY));
  if (state.scaleX !== 1 || state.scaleY !== 1 || state.rotate !== 0) {
    m = multiply(m, translation(state.originX, state.originY));
    m = multiply(m, rotation(state.rotate));
    m = multiply(m, scaling(state.scaleX, state.scaleY));
    m = multiply(m, translation(-state.originX, -state.originY));
  }
  return m;
}

// Maps scene coordinates to a format's frame pixels: the scene camera, then the cover window SceneStage uses.
function sceneToFrame(frame: CompiledFrame, scene: Scene, width: number, height: number): Affine {
  const sw = scene.sceneSize.w;
  const sh = scene.sceneSize.h;
  const cam = frame.camera ?? { center: { x: sw / 2, y: sh / 2 }, zoom: 1, rotation: 0 };
  return stageProjection(cam, width, height, scene.sceneSize);
}

// Measures how far an axis-aligned box reaches into a region, or null when it only touches or misses.
function overlapOf(box: Box, region: InsetRect): { w: number; h: number } | null {
  const w = Math.min(box.x1, region.x + region.w) - Math.max(box.x0, region.x);
  const h = Math.min(box.y1, region.y + region.h) - Math.max(box.y0, region.y);
  return w > OVERLAP_TOLERANCE_PX && h > OVERLAP_TOLERANCE_PX ? { w, h } : null;
}

// Finds the visible element of one entity that reaches into the region at one frame, if any.
export function projectedSvgParts(
  entity: CompiledEntity,
  frameToPx: Affine,
  packageSlug?: string,
  options: { includeAncestry?: boolean; minOpacity?: number } = {},
): Array<{ name: string; bounds: Box; ancestors?: string[] }> {
  const minOpacity = options.minOpacity ?? INSET_ART_MIN_OPACITY;
  if (!entity.svgSource || entity.transform.opacity <= minOpacity) return [];
  const parts: Array<{ name: string; bounds: Box; ancestors?: string[] }> = [];
  const placed = multiply(
    frameToPx,
    multiply(multiply(translation(entity.transform.x, entity.transform.y), scaling(entity.transform.scale, entity.transform.scale)), rotation(entity.transform.rotation)),
  );
  const states = entity.elementStates ?? {};
  for (const leaf of collectLeaves(entity.svgSource, packageSlug)) {
    let m = placed;
    let opacity = entity.transform.opacity;
    let drawn = true;
    for (const link of leaf.chain) {
      const state = link.id ? states[link.id] : undefined;
      m = multiply(m, link.transform);
      if (state) {
        m = multiply(m, stateMatrix(state));
        opacity *= state.opacityDriven || state.opacity !== 1 ? state.opacity : link.opacity;
        // A stroke-only element with nothing drawn on yet has no ink to occupy the region with.
        if (leaf.strokeOnly && state.drawOn <= 0.02) drawn = false;
      } else {
        opacity *= link.opacity;
      }
    }
    if (!drawn || opacity <= minOpacity) continue;
    const corners = [apply(m, leaf.box.x0, leaf.box.y0), apply(m, leaf.box.x1, leaf.box.y0), apply(m, leaf.box.x0, leaf.box.y1), apply(m, leaf.box.x1, leaf.box.y1)];
    const box: Box = {
      x0: Math.min(...corners.map((c) => c[0])),
      y0: Math.min(...corners.map((c) => c[1])),
      x1: Math.max(...corners.map((c) => c[0])),
      y1: Math.max(...corners.map((c) => c[1])),
    };
    parts.push({ name: leaf.name, bounds: box, ...(options.includeAncestry ? { ancestors: leaf.chain.flatMap((link) => link.id ? [link.id] : []) } : {}) });
  }
  return parts;
}

// Prepares SVG plane geometry using the runtime compiler and the canonical projector.
export function prepareSvgProjection(
  scene: Scene,
  width: number,
  height: number,
  packageSlugOrOptions?: string | { includeBackground?: boolean; packageSlug?: string; includeAncestry?: boolean; minOpacity?: number },
  options: { includeBackground?: boolean; includeAncestry?: boolean; minOpacity?: number } = {},
) {
  const packageSlug = typeof packageSlugOrOptions === "string" ? packageSlugOrOptions : packageSlugOrOptions?.packageSlug;
  const opts = typeof packageSlugOrOptions === "object" && packageSlugOrOptions !== null ? packageSlugOrOptions : options;
  const compiled = compileScene(scene, { clockMs: 0, skipContinuityVerification: true });
  // Returns the drawn parts at exactly this frame, preserving element animation and authored opacity.
  return (frame: number) => {
    const current = compiled.frames[Math.max(0, Math.min(compiled.frames.length - 1, frame))];
    const matrix = sceneToFrame(current, scene, width, height);
    return current.entities
      .filter((e) => opts.includeBackground || e.kind !== "background")
      .map((e) => ({ id: e.entityId, parts: projectedSvgParts(e, matrix, packageSlug, opts) }));
  };
}

// Checks every inset shot of a scene film keeps the inset region free of visible scene art in both formats.
export function checkInsetRegions(film: Film, scene: Scene, formats: ReadonlyArray<"long" | "reel"> = ["long", "reel"]): InsetFinding[] {
  const insetShots = film.shots.filter((s) => s.stage === "inset");
  if (insetShots.length === 0) return [];
  let compiled;
  try {
    compiled = compileScene(scene, { clockMs: 0, skipContinuityVerification: true });
  } catch (err) {
    return [{ where: "scene", message: `could not compile the scene to check the inset region: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}` }];
  }
  const findings: InsetFinding[] = [];
  const timeline = buildTimeline(film);
  for (const timed of timeline) {
    if (timed.shot.stage !== "inset") continue;
    const last = Math.min(timed.to, compiled.frames.length) - 1;
    const samples: number[] = [];
    for (let f = timed.from; f < last; f += SAMPLE_STEP_FRAMES) samples.push(f);
    if (last >= timed.from) samples.push(last);
    for (const [format, size] of Object.entries(INSET_FORMAT_FRAMES) as Array<[keyof typeof INSET_FORMAT_FRAMES, { width: number; height: number }]>) {
      if (!formats.includes(format)) continue;
      const region = getInsetRegion(format, size.width, size.height);
      const reported = new Set<string>();
      for (const f of samples) {
        const frame = compiled.frames[f];
        const toPx = sceneToFrame(frame, scene, size.width, size.height);
        for (const entity of frame.entities) {
          if (entity.kind === "background" || reported.has(entity.entityId)) continue;
          const hit = projectedSvgParts(entity, toPx, film.id).find((part) => overlapOf(part.bounds, region));
          if (!hit) continue;
          reported.add(entity.entityId);
          const cut = format === "long" ? "wide" : "reel";
          findings.push({
            where: `shot ${timed.shot.id}`,
            message:
              `scene art "${entity.entityId}" (element "${hit.name}") is visible inside the ${cut} cut's inset region ` +
              `(x ${Math.round(region.x)}-${Math.round(region.x + region.w)}, y ${Math.round(region.y)}-${Math.round(region.y + region.h)}) at frame ${f}. ` +
              `An inset shot shares the stage, so move that art out of the region, fade it before the shot starts, or stage the shot as a text card.`,
          });
        }
      }
    }
  }
  return findings;
}
