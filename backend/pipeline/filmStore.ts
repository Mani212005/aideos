/**
 * File Description: Reads and writes video packages from the backend. A film lives in two places -
 * videos/<slug>/film.json (authoritative, what the editor's Player and the package loader read)
 * and src/dl/films/<slug>.ts (the generated shadow Remotion's CLI render bundles). AGENTS.md
 * requires the two never be written independently, so every write in the production pipeline goes
 * through writeFilm here, which is the backend twin of the editor dev server's helper of the same
 * name and emits the identical module format.
 */

import fs from "fs";
import path from "path";
import type { Block, Film } from "../../src/dl/schema";
import { parseFilm } from "../../src/dl/schema";
import { traceBus } from "../agentBridge/traceBus";

/** Repo root, resolved from this module so the pipeline works from any cwd. */
export const ROOT = path.resolve(__dirname, "../..");
export const VIDEOS_DIR = path.join(ROOT, "videos");
export const FILMS_DIR = path.join(ROOT, "src/dl/films");
export const PUBLIC_DIR = path.join(ROOT, "public");

/** The schema's own id rule, which also makes path traversal unrepresentable. */
export const FILM_ID = /^[a-z0-9-]+$/;

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

/** `kv-cache` becomes `kvCacheFilm`: film ids may contain dashes, identifiers may not. */
function exportName(id: string): string {
  return `${id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())}Film`;
}

/** The generated shadow module: pure data behind a type-only import. */
function filmModule(film: Film): string {
  return `import type { Film } from "../schema";\n\nexport const ${exportName(film.id)}: Film = ${JSON.stringify(film, null, 2)};\n`;
}

/** Absolute path of a package directory for a slug. */
export function packageDir(slug: string): string {
  if (!FILM_ID.test(slug)) throw new Error(`invalid film id "${slug}": lowercase letters, digits and dashes only`);
  return path.join(VIDEOS_DIR, slug);
}

/** Loads a film, preferring the authoritative film.json and falling back to the shadow module. */
export function readFilm(slug: string): Film | null {
  const pkgFilmPath = path.join(packageDir(slug), "film.json");
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

/** Points src/dl/activeFilm.ts at a package so Remotion's CLI render bundles that film. */
export function setActiveFilm(slug: string): void {
  if (!FILM_ID.test(slug)) throw new Error(`invalid film id "${slug}"`);
  const contents = `import { ${exportName(slug)} } from "./films/${slug}";
import type { Film } from "./schema";

/**
 * Which film renders. One line, so swapping the subject of the whole pipeline
 * is a one-word change rather than a search through the components.
 */
export const ACTIVE_FILM: Film = ${exportName(slug)};
`;
  fs.writeFileSync(path.join(ROOT, "src/dl/activeFilm.ts"), contents, "utf8");
}

/** Reads the slug src/dl/activeFilm.ts currently points at, so a run can restore it. */
export function readActiveFilmSource(): string {
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
