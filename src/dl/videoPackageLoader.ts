/**
 * File Description: Unified Video Package Loader for Aideos.
 * Discovers and dynamically loads self-contained video packages from videos/<slug>/film.json.
 * The videos directory is personal and gitignored (AIDEOS_VIDEOS_DIR moves it anywhere); the
 * committed examples/ directory is a read-only fallback so a fresh clone always has a film.
 * Inputs and outputs: slug identifier and filesystem paths -> loaded video package manifest and asset paths.
 * Used by: backend/pipeline/filmStore.ts, editor/vite.config.ts, backend/pipeline/run.ts.
 */

import fs from "node:fs";
import path from "node:path";
import type { Film } from "./schema";

export interface VideoPackage {
  slug: string;
  film: Film;
  shotlist?: unknown;
  treatment?: unknown;
  hasVisuals: boolean;
}

/**
 * Resolves the absolute path to the project root directory.
 */
export function getProjectRoot(): string {
  if (process.env.AIDEOS_PROJECT_ROOT) {
    return path.resolve(process.env.AIDEOS_PROJECT_ROOT);
  }
  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(cur, "src", "dl")) && fs.existsSync(path.join(cur, "package.json"))) {
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  if (typeof __dirname !== "undefined") {
    const candidate = path.resolve(__dirname, "../..");
    if (fs.existsSync(path.join(candidate, "src", "dl"))) {
      return candidate;
    }
  }
  return process.cwd();
}

/**
 * Resolves the absolute path to the videos directory: AIDEOS_VIDEOS_DIR (a relative value is
 * resolved against the project root, not the cwd, since the editor server runs from editor/),
 * else <root>/videos. This is the only place new packages are written.
 */
export function getVideosDir(): string {
  if (process.env.AIDEOS_VIDEOS_DIR) {
    return path.resolve(getProjectRoot(), process.env.AIDEOS_VIDEOS_DIR);
  }
  return path.resolve(getProjectRoot(), "videos");
}

/** Resolves the committed examples directory, a read-only fallback pool of tiny packages. */
export function getExamplesDir(): string {
  return path.resolve(getProjectRoot(), "examples");
}

/** Lists the package folders (with a film.json) directly inside a directory. */
function packagesIn(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && fs.existsSync(path.join(dir, d.name, "film.json")))
    .map((d) => d.name);
}

/**
 * Lists every available video package slug: the personal videos directory first, then any
 * committed example that a personal package of the same name does not shadow.
 */
export function listVideoPackages(): string[] {
  const dir = getVideosDir();
  const personal = fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith("."))
        .map((dirent) => dirent.name)
    : [];
  const examples = packagesIn(getExamplesDir()).filter((slug) => !personal.includes(slug));
  return [...personal, ...examples].sort();
}

/** The package directory a slug resolves to for reading: personal first, then examples. */
export function resolvePackageDir(slug: string): string {
  const personal = path.join(getVideosDir(), slug);
  if (fs.existsSync(path.join(personal, "film.json"))) return personal;
  const example = path.join(getExamplesDir(), slug);
  if (fs.existsSync(path.join(example, "film.json"))) return example;
  return personal;
}

/**
 * Resolves a repo-relative asset path a film names ("videos/<slug>/visuals/x.svg",
 * "examples/<slug>/..."). A "videos/" path follows AIDEOS_VIDEOS_DIR, then the cwd, then the root.
 */
export function resolveRepoAssetPath(rel: string): string {
  if (path.isAbsolute(rel)) return rel;
  const candidates: string[] = [];
  const m = /^videos\/(.*)$/.exec(rel);
  if (m) candidates.push(path.join(getVideosDir(), m[1]));
  candidates.push(path.resolve(process.cwd(), rel), path.resolve(getProjectRoot(), rel));
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[candidates.length - 1];
}

/**
 * Loads a complete Film manifest from a video package directory.
 */
export function loadVideoPackage(slug: string): VideoPackage | null {
  const pkgDir = resolvePackageDir(slug);
  const filmJsonPath = path.join(pkgDir, "film.json");

  if (!fs.existsSync(filmJsonPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filmJsonPath, "utf8");
    const film = JSON.parse(raw) as Film;

    let shotlist: unknown = null;
    const shotlistPath = path.join(pkgDir, "shotlist.json");
    if (fs.existsSync(shotlistPath)) {
      try {
        shotlist = JSON.parse(fs.readFileSync(shotlistPath, "utf8"));
      } catch {
        // Ignore invalid JSON
      }
    }

    let treatment: unknown = null;
    const treatmentPath = path.join(pkgDir, "treatment.json");
    if (fs.existsSync(treatmentPath)) {
      try {
        treatment = JSON.parse(fs.readFileSync(treatmentPath, "utf8"));
      } catch {
        // Ignore invalid JSON
      }
    }

    const visualsDir = path.join(pkgDir, "visuals");
    const hasVisuals = fs.existsSync(visualsDir) && fs.readdirSync(visualsDir).length > 0;

    return {
      slug,
      film,
      shotlist,
      treatment,
      hasVisuals,
    };
  } catch (err) {
    console.error(`Failed to load video package "${slug}":`, err);
    return null;
  }
}
