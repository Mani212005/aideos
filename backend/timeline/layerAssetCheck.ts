/**
 * File Description: Node-only half of layered-film validation: after the browser-safe structural checks pass, confirms every video/audio/image clip's source file exists on disk (Rule 6, file existence).
 * Split out of src/dl/validateLayeredFilm.ts because that module is bundled into the studio, where `fs` and `path` do not exist and importing them broke the AI edit Apply gesture.
 * Also holds the write-time guard the server runs before it persists a film (studio save, AI edit Apply, MCP edit): a write must not introduce a source file that is missing on disk.
 * Inputs and outputs: a layered film (and an optional base directory), or the film about to be written and the film on disk -> the parsed film, or a thrown Rule 6 violation naming the missing source.
 * Used by: editor/vite.config.ts (POST /api/films/:id and /api/ai-edit), backend/mcp/server.ts (edit tool), backend/timeline/imported_footage.test.ts, backend/timeline/layerAssetCheck.test.ts (never import from editor/src).
 */

import fs from "node:fs";
import path from "node:path";
import { validateLayeredFilm } from "../../src/dl/validateLayeredFilm";
import { convertFilmToLayeredFilm } from "../../src/dl/convertFilm";
import { resolveRepoAssetPath } from "../../src/dl/videoPackageLoader";
import type { LayeredFilm } from "../../src/dl/layeredSchema";
import type { Film } from "../../src/dl/schema";

export interface LayeredAssetCheckOptions {
  /** Directory media paths are resolved against; defaults to `<cwd>/public`. */
  baseDir?: string;
  /** Sources the film already carried before this write; they are not checked, so a film that already names a missing file stays editable. */
  knownSources?: ReadonlySet<string>;
}

/** True for a source that is not a local file (a remote or inline URL), which the disk check cannot judge. */
function isNonFileSource(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(src) || src.startsWith("data:");
}

/** Collects every video, audio and image source a layered film names (the `knownSources` a write starts from). */
export function layeredMediaSources(film: LayeredFilm): Set<string> {
  const sources = new Set<string>();
  for (const clip of film.clips) {
    if (clip.kind !== "video" && clip.kind !== "audio" && clip.kind !== "image") continue;
    const src = (clip.payload as { src?: string })?.src;
    if (src) sources.add(src);
  }
  return sources;
}

/** Throws a Rule 6 violation for the first media clip whose source file cannot be found under the base directory. */
export function assertLayeredAssetsExist(film: LayeredFilm, options?: LayeredAssetCheckOptions): void {
  const baseDir = options?.baseDir ?? path.resolve(process.cwd(), "public");
  for (const clip of film.clips) {
    if (clip.kind !== "video" && clip.kind !== "audio" && clip.kind !== "image") continue;
    const payload = clip.payload as { src?: string; itemId?: string };
    // A soundtrack clip names a library item, fetched into the shared cache on demand, so it is not a missing user file.
    if (payload?.itemId) continue;
    const src = payload?.src;
    if (!src || isNonFileSource(src) || options?.knownSources?.has(src)) continue;
    const candidates = [
      resolveRepoAssetPath(src),
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

/**
 * Refuses a film write that introduces a media source missing on disk: every source in `next` that
 * `previous` (the film currently on disk, or null for a new film) did not already carry must exist.
 * Sources the film already had are left alone, so an old film with a broken reference can still be saved and fixed.
 */
export function assertFilmWriteAssetsExist(next: Film, previous: Film | null, options?: Omit<LayeredAssetCheckOptions, "knownSources">): void {
  const knownSources = previous ? layeredMediaSources(convertFilmToLayeredFilm(previous)) : new Set<string>();
  assertLayeredAssetsExist(convertFilmToLayeredFilm(next), { ...options, knownSources });
}
