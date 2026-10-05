/**
 * File Description: Builds the generated, gitignored files Remotion's CLI render and the Vite
 * editor need: one shadow module per video package (src/dl/films/<slug>.ts), the bundled SVG
 * source map and src/dl/activeFilm.ts. Personal videos live in videos/ (or AIDEOS_VIDEOS_DIR) and
 * are never committed, so none of these can be committed either; `ensureGenerated` rebuilds all of
 * them from whatever packages are on disk, falling back to the committed examples/ on a fresh
 * clone. It is run by npm's postinstall and by the pre-hooks of every script that bundles them.
 * Deliberately free of the trace bus and the model clients so a bare install can run it.
 */

import fs from "fs";
import path from "path";
import { dropLegacyFilmBlocks, type Film } from "../../src/dl/schema";
import { getVideosDir, listVideoPackages, resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { buildSvgSources } from "../scene/buildSvgSources";

/** Repo root, resolved from this module so the pipeline works from any cwd. */
export const ROOT = path.resolve(__dirname, "../..");
export const FILMS_DIR = path.join(ROOT, "src/dl/films");
/** The schema's own id rule, which also makes path traversal unrepresentable. */
export const FILM_ID = /^[a-z0-9-]+$/;

/** `kv-cache` becomes `kvCacheFilm`: film ids may contain dashes, identifiers may not. */
export function exportName(id: string): string {
  const camel = id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  const identifier = `${camel}Film`;
  return /^[0-9]/.test(identifier) ? `_${identifier}` : identifier;
}

/** The generated shadow module: pure data behind a type-only import. */
export function filmModule(film: Film): string {
  return `import type { Film } from "../schema";\n\nexport const ${exportName(film.id)}: Film = ${JSON.stringify(film, null, 2)};\n`;
}

/** The generated module that points Remotion's CLI render at one film. */
function activeFilmModule(slug: string): string {
  return `import { ${exportName(slug)} } from "./films/${slug}";
import type { Film } from "./schema";

/**
 * Which film renders. One line, so swapping the subject of the whole pipeline
 * is a one-word change rather than a search through the components.
 */
export const ACTIVE_FILM: Film = ${exportName(slug)};
`;
}

/** Writes a file only when its text differs, so an idle rebuild never makes Vite hot-reload. */
function writeIfChanged(file: string, text: string): boolean {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  return true;
}

/**
 * Rebuilds every generated, gitignored file from the packages on disk: one shadow module per
 * package (src/dl/films/<slug>.ts), the bundled SVG source map, and an activeFilm.ts when none
 * exists. Safe to run at any time; a fresh clone gets the committed example, an owner gets all
 * of their videos. Shadows with no package behind them are removed. Packages whose film.json does
 * not parse are skipped, never fatal.
 */
export function ensureGenerated(): { shadows: number; svgAssets: number; activeFilm: string } {
  let shadows = 0;
  let firstPersonal: string | null = null;
  let firstExample: string | null = null;
  for (const slug of listVideoPackages()) {
    if (!FILM_ID.test(slug)) continue;
    const file = path.join(resolvePackageDir(slug), "film.json");
    if (!fs.existsSync(file)) continue;
    let film: Film;
    try {
      // The shadow is typed as Film, so block kinds the schema retired are dropped as parsing drops them.
      film = dropLegacyFilmBlocks(JSON.parse(fs.readFileSync(file, "utf8")) as Film);
    } catch {
      continue;
    }
    if (film.id !== slug) continue;
    if (writeIfChanged(path.join(FILMS_DIR, `${slug}.ts`), filmModule(film))) shadows++;
    if (file.startsWith(getVideosDir() + path.sep)) firstPersonal ??= slug;
    else firstExample ??= slug;
  }
  // A shadow whose package is gone (a deleted video, or a test fixture from an earlier run) would
  // still be listed by the studio, so only shadows of packages on disk are kept.
  const available = new Set(listVideoPackages());
  if (fs.existsSync(FILMS_DIR)) {
    for (const file of fs.readdirSync(FILMS_DIR)) {
      if (file.endsWith(".ts") && !available.has(file.slice(0, -3))) fs.rmSync(path.join(FILMS_DIR, file), { force: true });
    }
  }
  const svgAssets = buildSvgSources();

  const activeFile = path.join(ROOT, "src/dl/activeFilm.ts");
  let activeFilm = "";
  const m = fs.existsSync(activeFile) ? /from "\.\/films\/([a-z0-9-]+)"/.exec(fs.readFileSync(activeFile, "utf8")) : null;
  if (m && fs.existsSync(path.join(FILMS_DIR, `${m[1]}.ts`))) {
    activeFilm = m[1];
  } else if (firstPersonal ?? firstExample) {
    activeFilm = (firstPersonal ?? firstExample) as string;
    setActiveFilm(activeFilm);
  }
  return { shadows, svgAssets, activeFilm };
}

/** Points src/dl/activeFilm.ts at a package so Remotion's CLI render bundles that film. */
export function setActiveFilm(slug: string): void {
  if (!FILM_ID.test(slug)) throw new Error(`invalid film id "${slug}"`);
  writeIfChanged(path.join(ROOT, "src/dl/activeFilm.ts"), activeFilmModule(slug));
}
