/**
 * File Description: Node-only half of layered-film validation: after the browser-safe structural checks pass, confirms every video/audio/image clip's source file exists on disk (Rule 6, file existence).
 * Split out of src/dl/validateLayeredFilm.ts because that module is bundled into the studio, where `fs` and `path` do not exist and importing them broke the AI edit Apply gesture.
 * Inputs and outputs: a layered film (and an optional base directory) -> the parsed film, or a thrown Rule 6 violation naming the missing source.
 * Used by: backend/timeline/imported_footage.test.ts and any server-side caller that wants disk-checked validation (never import from editor/src).
 */

import fs from "node:fs";
import path from "node:path";
import { validateLayeredFilm } from "../../src/dl/validateLayeredFilm";
import type { LayeredFilm } from "../../src/dl/layeredSchema";

export interface LayeredAssetCheckOptions {
  /** Directory media paths are resolved against; defaults to `<cwd>/public`. */
  baseDir?: string;
}

/** Throws a Rule 6 violation for the first media clip whose source file cannot be found under the base directory. */
export function assertLayeredAssetsExist(film: LayeredFilm, options?: LayeredAssetCheckOptions): void {
  const baseDir = options?.baseDir ?? path.resolve(process.cwd(), "public");
  for (const clip of film.clips) {
    if (clip.kind !== "video" && clip.kind !== "audio" && clip.kind !== "image") continue;
    const src = (clip.payload as { src?: string })?.src;
    if (!src) continue;
    const candidates = [
      path.resolve(baseDir, src),
      path.resolve(baseDir, "..", src),
      path.resolve(process.cwd(), "public", src),
    ];
    if (!candidates.some((c) => fs.existsSync(c))) {
      throw new Error(`Rule 6 violation: Source asset file missing: "${src}" for clip "${clip.id}"`);
    }
  }
}

/** Runs the structural validation, then the on-disk source check, and returns the parsed film. */
export function validateLayeredFilmWithAssets(input: unknown, options?: LayeredAssetCheckOptions): LayeredFilm {
  const film = validateLayeredFilm(input);
  assertLayeredAssetsExist(film, options);
  return film;
}
