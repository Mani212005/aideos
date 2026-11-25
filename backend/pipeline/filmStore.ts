/**
 * File Description: Reads and writes video packages for the backend and the studio server. A film lives in two places -
 * videos/<slug>/film.json (authoritative, what the editor's Player and the package loader read)
 * and src/dl/films/<slug>.ts (the generated shadow Remotion's CLI render bundles). AGENTS.md
 * requires the two never be written independently, so every film write goes through writeFilm here.
 * A film.json that exists but does not parse is an error (CorruptFilmError), never a silent read of the older shadow.
 * Inputs and outputs: slug and Film manifest -> writes film.json and src/dl/films shadow; slug -> Film and its revision.
 * Used by: backend/pipeline/run.ts, backend/designSpec/build.ts, backend/designSpec/designer.ts, backend/cli.ts, editor/vite.config.ts.
 *
 * Neither location is committed: videos/ (or AIDEOS_VIDEOS_DIR) holds the owner's personal videos
 * and src/dl/films/ plus src/dl/activeFilm.ts are generated, so a fresh clone starts with only
 * examples/. `ensureGenerated` rebuilds every generated file from whatever packages are on disk.
 */

import { carryCaptionPlacement } from "../../src/dl/captionPlacement";
import { prepareSoundtrack } from "../soundtrack";
import fs from "fs";
import path from "path";
import type { Film } from "../../src/dl/schema";
import { dropLegacyFilmBlocks, parseFilm } from "../../src/dl/schema";
import { withFootage } from "../../src/dl/footageWiring";
import { filmRevision, revisionOfFilm } from "../filmRevision";
import { traceBus } from "../agentBridge/traceBus";
import { filmEditState, noteFilmWrite } from "../filmAcceptance/store";
import { filmDifferences } from "../filmAcceptance/machine";
import { getVideosDir, resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { ROOT, FILMS_DIR, FILM_ID, filmFromModule, filmModule, ensureGenerated, setActiveFilm } from "./generatedFiles";

export { ROOT, FILMS_DIR, FILM_ID, ensureGenerated, setActiveFilm };

/** Where new packages are written: AIDEOS_VIDEOS_DIR, else <root>/videos (gitignored), as it was when this module loaded; `packageDir` follows the live value. */
export const VIDEOS_DIR = getVideosDir();

/** Turns arbitrary text into a film id: lowercase letters, digits and dashes only. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "film"
  );
}

/** Absolute path of a package directory for a slug, where it is written (read live, so a process that moves AIDEOS_VIDEOS_DIR between runs writes where the studio and the design stage read). */
export function packageDir(slug: string): string {
  if (!FILM_ID.test(slug)) throw new Error(`invalid film id "${slug}": lowercase letters, digits and dashes only`);
  return path.join(getVideosDir(), slug);
}

/** A package's film.json exists but is not valid JSON. Readers refuse it rather than serve the older generated shadow. */
export class CorruptFilmError extends Error {
  readonly slug: string;
  readonly file: string;

  // Names the package and the file so the message tells the owner exactly what to repair.
  constructor(slug: string, file: string, cause: unknown) {
    super(`film.json for "${slug}" is not valid JSON (${file}): ${cause instanceof Error ? cause.message : String(cause)}. Fix or restore the file; Aideos will not fall back to the older generated shadow.`);
    this.name = "CorruptFilmError";
    this.slug = slug;
    this.file = file;
  }
}

/** A film as read from disk, with the revision of the bytes it came from (what a studio save must name). */
export interface StoredFilm {
  film: Film;
  rev: string;
  source: "package" | "shadow";
}

/**
 * Loads a film and its revision: the authoritative film.json when the package has one, else the generated shadow module.
 * Returns null when neither exists, and throws CorruptFilmError when film.json exists but does not parse.
 */
export function readStoredFilm(slug: string): StoredFilm | null {
  if (!FILM_ID.test(slug)) throw new Error(`invalid film id "${slug}": lowercase letters, digits and dashes only`);
  const pkgFilmPath = path.join(resolvePackageDir(slug), "film.json");
  let raw: string | null = null;
  try {
    raw = fs.readFileSync(pkgFilmPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new CorruptFilmError(slug, pkgFilmPath, error);
    }
    return { film: dropLegacyFilmBlocks(parsed as Film), rev: filmRevision(raw), source: "package" };
  }
  const shadowPath = path.join(FILMS_DIR, `${slug}.ts`);
  let shadow: string;
  try {
    shadow = fs.readFileSync(shadowPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const film = filmFromModule(shadow);
  return { film, rev: revisionOfFilm(film), source: "shadow" };
}

/** Loads a film (see readStoredFilm): null when the package has none, CorruptFilmError when its film.json is broken. */
export function readFilm(slug: string): Film | null {
  return readStoredFilm(slug)?.film ?? null;
}

/** How a film write is attributed and guarded. */
export interface WriteFilmOptions {
  /** The owner's own save: caption placement locks are the owner's to change. */
  owner: boolean;
  /** An agent edit that may move a caption placement. */
  agentEdit?: boolean;
  /** Refuse to change a film.json the owner hand-edited since the last build. */
  protectHandEdits?: boolean;
  /** Runs on the validated film before either file is written (for side data such as the studio soundtrack); a throw refuses the write. */
  beforeWrite?: (validated: Film) => void;
}

/**
 * Persists a film to both authoritative locations at once.
 *
 * Writing only one of them is how the two drift, and a drifted pair renders a different film
 * than the editor previews. The film is validated before either write, so a malformed film
 * never lands on disk half-applied.
 */
export function writeFilm(slug: string, film: Film, options: WriteFilmOptions = { owner: false }): Film {
  const validated = parseFilm(prepareSoundtrack(parseFilm(carryCaptionPlacement(readFilm(slug), film, options))));
  if (options.protectHandEdits && filmEditState(resolvePackageDir(slug)) === "hand-edited") {
    const current = readFilm(slug);
    if (!current || filmDifferences(current, validated).length > 0) {
      throw new Error(`refusing to overwrite hand-edited film.json for ${slug}; move the fix into design/design.json or restore design/base-film.json before rebuilding`);
    }
  }
  options.beforeWrite?.(validated);
  const dir = packageDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const contents = JSON.stringify(validated, null, 2);
  fs.writeFileSync(path.join(dir, "film.json"), contents, "utf8");
  noteFilmWrite(dir, contents);

  fs.mkdirSync(FILMS_DIR, { recursive: true });
  fs.writeFileSync(path.join(FILMS_DIR, `${slug}.ts`), filmModule(validated), "utf8");
  traceBus.notifyFilmUpdated(slug, validated);
  return validated;
}

/** Reads the slug src/dl/activeFilm.ts currently points at, so a run can restore it. */
export function readActiveFilmSource(): string {
  ensureGenerated();
  return fs.readFileSync(path.join(ROOT, "src/dl/activeFilm.ts"), "utf8");
}

/** Restores a previously captured activeFilm.ts body verbatim. */
export function restoreActiveFilmSource(contents: string): void {
  fs.writeFileSync(path.join(ROOT, "src/dl/activeFilm.ts"), contents, "utf8");
}

/**
 * Wires a finished B-roll clip into a shot as a full-screen AnalogyInset and persists the film.
 *
 * The clip path is relative to public/, because that is what Remotion's staticFile() resolves
 * against in both the CLI render and the editor's Player. An existing inset on the shot is
 * updated in place rather than duplicated, so re-running the stage is idempotent (src/dl/footageWiring.ts).
 */
export function wireFootageIntoFilm(
  slug: string,
  shotId: string,
  staticPath: string,
  caption: string,
): Film {
  const film = readFilm(slug);
  if (!film) throw new Error(`no film found for "${slug}"`);
  return writeFilm(slug, withFootage(film, shotId, staticPath, caption));
}
