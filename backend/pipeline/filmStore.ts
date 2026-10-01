/**
 * File Description: Reads and writes video packages from the backend. A film lives in two places -
 * videos/<slug>/film.json (authoritative, what the editor's Player and the package loader read)
 * and src/dl/films/<slug>.ts (the generated shadow Remotion's CLI render bundles). AGENTS.md
 * requires the two never be written independently, so every write in the production pipeline goes
 * through writeFilm here, which is the backend twin of the editor dev server's helper of the same
 * name and emits the identical module format.
 *
 * Neither location is committed: videos/ (or AIDEOS_VIDEOS_DIR) holds the owner's personal videos
 * and src/dl/films/ plus src/dl/activeFilm.ts are generated, so a fresh clone starts with only
 * examples/. `ensureGenerated` rebuilds every generated file from whatever packages are on disk.
 */

import fs from "fs";
import path from "path";
import type { Block, Film } from "../../src/dl/schema";
import { parseFilm } from "../../src/dl/schema";
import { traceBus } from "../agentBridge/traceBus";
import { getVideosDir, resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { ROOT, FILMS_DIR, FILM_ID, filmModule, ensureGenerated, setActiveFilm } from "./generatedFiles";

export { ROOT, FILMS_DIR, FILM_ID, ensureGenerated, setActiveFilm };

/** Where new packages are written: AIDEOS_VIDEOS_DIR, else <root>/videos (gitignored). */
export const VIDEOS_DIR = getVideosDir();
export const PUBLIC_DIR = path.join(ROOT, "public");

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

/** Absolute path of a package directory for a slug, where it is written. */
export function packageDir(slug: string): string {
  if (!FILM_ID.test(slug)) throw new Error(`invalid film id "${slug}": lowercase letters, digits and dashes only`);
  return path.join(VIDEOS_DIR, slug);
}

/** Loads a film, preferring the authoritative film.json and falling back to the shadow module. */
export function readFilm(slug: string): Film | null {
  if (!FILM_ID.test(slug)) throw new Error(`invalid film id "${slug}": lowercase letters, digits and dashes only`);
  const pkgFilmPath = path.join(resolvePackageDir(slug), "film.json");
  if (fs.existsSync(pkgFilmPath)) {
    try {
      return JSON.parse(fs.readFileSync(pkgFilmPath, "utf8")) as Film;
    } catch {
      // Fall through to the generated module.
    }
  }
  const filmPath = path.join(FILMS_DIR, `${slug}.ts`);
  if (fs.existsSync(filmPath)) {
    const jsonMatch = fs.readFileSync(filmPath, "utf8").match(/=\s*(\{[\s\S]*\})\s*;/);
    if (jsonMatch) return JSON.parse(jsonMatch[1]) as Film;
  }
  return null;
}

/**
 * Persists a film to both authoritative locations at once.
 *
 * Writing only one of them is how the two drift, and a drifted pair renders a different film
 * than the editor previews. The film is validated before either write, so a malformed film
 * never lands on disk half-applied.
 */
export function writeFilm(slug: string, film: Film): Film {
  const validated = parseFilm(film);
  const dir = packageDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "film.json"), JSON.stringify(validated, null, 2), "utf8");

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
 * updated in place rather than duplicated, so re-running the stage is idempotent.
 */
export function wireFootageIntoFilm(
  slug: string,
  shotId: string,
  staticPath: string,
  caption: string,
): Film {
  const film = readFilm(slug);
  if (!film) throw new Error(`no film found for "${slug}"`);
  const shot = film.shots.find((s) => s.id === shotId);
  if (!shot) throw new Error(`film "${slug}" has no shot "${shotId}"`);

  shot.needsFootage = true;
  const inset = shot.blocks.find((b) => b.c === "AnalogyInset") as
    | Extract<Block, { c: "AnalogyInset" }>
    | undefined;

  if (inset) {
    inset.src = staticPath;
    inset.fullScreenHero = true;
    inset.caption = caption.slice(0, 80) || inset.caption;
  } else {
    shot.blocks = [
      {
        c: "AnalogyInset",
        caption: (caption || "B-roll").slice(0, 80),
        src: staticPath,
        fullScreenHero: true,
      },
      ...shot.blocks.filter((b) => b.c !== "AnalogyInset"),
    ];
  }

  return writeFilm(slug, film);
}
