/**
 * File Description: Comprehensive Validator for Generic Layered Films (Phase L-1).
 * Implements the 7 core validation rules:
 * Rule 1: Every clip.layerId resolves to an existing layer.
 * Rule 2: Every layer.number is a unique integer.
 * Rule 3: position >= 0, end >= start, derived duration > 0.
 * Rule 4: Two clips on the same layer may not overlap in time.
 * Rule 5: linkedClipId resolves to an existing clip and is symmetric.
 * Rule 6: Source file references are valid non-empty strings.
 * Rule 7: opacity in [0,1], volume in [0,1].
 */

import fs from "fs";
import path from "path";
import { layeredFilmSchema, type LayeredFilm, type Clip } from "./layeredSchema";

export interface LayeredValidationOptions {
  checkAssetsOnDisk?: boolean;
  baseDir?: string;
}

export function validateLayeredFilm(input: unknown, options?: LayeredValidationOptions): LayeredFilm {
  const parseRes = layeredFilmSchema.safeParse(input);
  if (!parseRes.success) {
    throw new Error(`Invalid layered film schema:\n${parseRes.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }

  const film = parseRes.data;
  const baseDir = options?.baseDir ?? path.resolve(process.cwd(), "public");

  // Rule 2: Every layer.number is a unique integer
  const layerNumbers = new Set<number>();
  const layerIds = new Set<string>();

  for (const layer of film.layers) {
    if (layerNumbers.has(layer.number)) {
      throw new Error(`Rule 2 violation: duplicate layer.number ${layer.number} found on layer "${layer.id}"`);
    }
    layerNumbers.add(layer.number);
    layerIds.add(layer.id);
  }

  // Rule 1 & Rule 3 & Rule 5 & Rule 7
  const clipMap = new Map<string, Clip>();
  for (const clip of film.clips) {
    clipMap.set(clip.id, clip);

    // Rule 1: Every clip.layerId resolves to an existing layer
    if (!layerIds.has(clip.layerId)) {
      throw new Error(`Rule 1 violation: clip "${clip.id}" references nonexistent layerId "${clip.layerId}"`);
    }

    // Rule 3: position >= 0, end >= start, derived duration > 0
    if (clip.position < 0) {
      throw new Error(`Rule 3 violation: clip "${clip.id}" has negative position ${clip.position}`);
    }
    if (clip.end <= clip.start) {
      throw new Error(`Rule 3 violation: clip "${clip.id}" has invalid source range (start: ${clip.start}, end: ${clip.end})`);
    }

    // Rule 7: opacity and volume in [0,1]
    if (clip.opacity !== undefined && (clip.opacity < 0 || clip.opacity > 1)) {
      throw new Error(`Rule 7 violation: clip "${clip.id}" has opacity ${clip.opacity} outside [0, 1]`);
    }
    if (clip.volume !== undefined && (clip.volume < 0 || clip.volume > 1)) {
      throw new Error(`Rule 7 violation: clip "${clip.id}" has volume ${clip.volume} outside [0, 1]`);
    }

    // Rule 6: Source file verification for video/audio/image clips
    if (clip.kind === "video" || clip.kind === "audio" || clip.kind === "image") {
      const src = (clip.payload as { src?: string })?.src;
      if (!src || typeof src !== "string" || src.trim().length === 0) {
        throw new Error(`Rule 6 violation: clip "${clip.id}" has empty source path`);
      }

      if (options?.checkAssetsOnDisk) {
        const candidates = [
          path.resolve(baseDir, src),
          path.resolve(baseDir, "..", src),
          path.resolve(process.cwd(), "public", src),
        ];
        const exists = candidates.some((c) => fs.existsSync(c));
        if (!exists) {
          throw new Error(`Rule 6 violation: Source asset file missing: "${src}" for clip "${clip.id}"`);
        }
      }
    }
  }

  // Rule 4: Two clips on the same layer may not overlap in time
  const clipsByLayer = new Map<string, Clip[]>();
  for (const clip of film.clips) {
    const arr = clipsByLayer.get(clip.layerId) || [];
    arr.push(clip);
    clipsByLayer.set(clip.layerId, arr);
  }

  for (const [layerId, clips] of clipsByLayer.entries()) {
    // Sort clips by position
    const sorted = [...clips].sort((a, b) => a.position - b.position);
    for (let i = 0; i < sorted.length - 1; i++) {
      const c1 = sorted[i];
      const c2 = sorted[i + 1];
      const c1End = c1.position + (c1.end - c1.start);
      // Disallow genuine overlap beyond 5ms float rounding epsilon
      if (c1End > c2.position + 0.005) {
        throw new Error(
          `Rule 4 violation: clips "${c1.id}" [${c1.position}s..${c1End.toFixed(2)}s] and "${c2.id}" [${c2.position}s..] overlap on layer "${layerId}"`
        );
      }
    }
  }

  // Rule 5: linkedClipId resolves to an existing clip and is symmetric
  for (const clip of film.clips) {
    if (clip.linkedClipId) {
      const partner = clipMap.get(clip.linkedClipId);
      if (!partner) {
        throw new Error(`Rule 5 violation: clip "${clip.id}" references nonexistent linkedClipId "${clip.linkedClipId}"`);
      }
      if (partner.linkedClipId !== clip.id) {
        throw new Error(`Rule 5 violation: asymmetric link between "${clip.id}" and "${partner.id}"`);
      }
    }
  }

  return film;
}
