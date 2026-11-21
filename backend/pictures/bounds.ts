/**
 * File Description: Reads a picture's pixels for the checks that measure them: decodes a pinned picture once per process (by sha256), and finds its visible bounds (the box of the pixels a cut-out keeps, trimmed to alpha) in its asset's local space, so geometry rules (inset, safe area, carry-over) measure the object rather than its transparent rectangle.
 * Inputs and outputs: a scene raster source -> decoded RGBA pixels, the alpha-trimmed pixel box, the local-space visible box.
 * Used by: backend/designCheck/pictures.ts, backend/designCheck/insetRegion.ts.
 */

import fs from "node:fs";
import type { RasterSource } from "../../src/dl/scene/types";
import { resolveRepoAssetPath } from "../../src/dl/videoPackageLoader";
import { decodePng, sha256Hex, type RgbaImage } from "./png";

/** A pixel at or below this alpha (0 to 255) is cut-out background, outside a picture's visible bounds. */
export const ALPHA_FLOOR = 8;

/** An axis-aligned box. */
export interface PictureBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Decoded pictures by sha256, so a picture used twice or checked twice in one process decodes once. */
const DECODED = new Map<string, RgbaImage | null>();

/** Decodes a picture's pinned file, or null when it is missing, unreadable or not the pinned bytes (the scene rule reports those). */
export function loadPicture(raster: RasterSource): RgbaImage | null {
  if (DECODED.has(raster.sha256)) return DECODED.get(raster.sha256)!;
  let image: RgbaImage | null = null;
  try {
    const bytes = fs.readFileSync(resolveRepoAssetPath(raster.src));
    if (sha256Hex(bytes) === raster.sha256) image = decodePng(bytes);
  } catch {
    image = null;
  }
  DECODED.set(raster.sha256, image);
  return image;
}

/** The pixel box of a picture's visible (not cut-out) pixels, or null when every pixel is transparent. */
export function alphaBounds(image: RgbaImage, floor: number = ALPHA_FLOOR): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = image.width;
  let y0 = image.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.rgba[(y * image.width + x) * 4 + 3] <= floor) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** A picture's visible bounds in its asset's local space (alpha-trimmed, centred box), or its full box when it cannot be read. */
export function pictureLocalBox(raster: RasterSource): PictureBox | null {
  const image = loadPicture(raster);
  const left = -raster.width / 2;
  const top = -raster.height / 2;
  if (!image) return { x0: left, y0: top, x1: left + raster.width, y1: top + raster.height };
  const b = alphaBounds(image);
  return b ? { x0: left + b.x0, y0: top + b.y0, x1: left + b.x1, y1: top + b.y1 } : null;
}
