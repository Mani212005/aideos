/**
 * File Description: The pure rules of a picture asset (`EnvironmentAsset.raster`, the illustrated stage's plate and generated objects) that both renderers, the scene validator and the design build share: where a picture's file may live, its one animatable element id, the box it draws in its asset's local space and the checks on its declared size and pin. Pure: no Node imports, so the Remotion bundle, the emitter and the validators all read the same rules.
 * Inputs and outputs: an environment asset or its raster source -> its element ids, drawn box and the problems with its declaration.
 * Used by: src/dl/scene/SceneView.tsx, src/dl/scene/compile.ts, src/dl/scene/validateScene.ts, src/dl/scene/validateSceneNode.ts, backend/scene/loadSceneAssets.ts, backend/renderIr/emit.ts, backend/designCheck/*.
 */

import type { EnvironmentAsset, RasterSource } from "./types";

/** Largest pixel side a picture may have (the Render IR's own dimension cap). */
export const MAX_RASTER_SIDE = 16_384;

/** A lowercase hex sha256. */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** True when an asset draws a picture rather than SVG artwork. */
export function isRasterAsset(asset: Pick<EnvironmentAsset, "raster">): asset is { raster: RasterSource } {
  return asset.raster !== undefined;
}

/** The element ids a picture asset declares: the picture itself, named by the asset id. */
export function rasterElementIds(asset: Pick<EnvironmentAsset, "assetId">): string[] {
  return [asset.assetId];
}

/** The box a picture draws in its asset's local space: centred on the origin, one unit per pixel. */
export function rasterBox(raster: Pick<RasterSource, "width" | "height">): { x: number; y: number; w: number; h: number } {
  return { x: -raster.width / 2, y: -raster.height / 2, w: raster.width, h: raster.height };
}

/** Every problem with a picture declaration (path, size and pin), as sentences naming the asset. */
export function rasterSourceProblems(assetId: string, raster: RasterSource): string[] {
  const problems: string[] = [];
  if (typeof raster.src !== "string" || !/\.png$/i.test(raster.src)) problems.push(`Asset "${assetId}" picture must be a .png file: "${String(raster.src)}"`);
  else if (raster.src.startsWith("/") || raster.src.split("/").some((part) => part === ".." || part === "")) problems.push(`Asset "${assetId}" picture path must be repo-relative without "..": "${raster.src}"`);
  for (const side of ["width", "height"] as const) {
    const v = raster[side];
    if (!Number.isInteger(v) || v < 1 || v > MAX_RASTER_SIDE) problems.push(`Asset "${assetId}" picture ${side} ${String(v)} must be a whole number of pixels from 1 to ${MAX_RASTER_SIDE}`);
  }
  if (typeof raster.sha256 !== "string" || !SHA256_PATTERN.test(raster.sha256)) problems.push(`Asset "${assetId}" picture sha256 must be 64 lowercase hex digits (the approved image's pin)`);
  return problems;
}
