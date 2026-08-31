/**
 * File Description: Unified Video Package Loader for Aideos.
 * Discovers and dynamically loads self-contained video packages from videos/<slug>/film.json.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Film } from "./schema";

export interface VideoPackage {
  slug: string;
  film: Film;
  shotlist?: any;
  treatment?: any;
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
  try {
    if (typeof import.meta !== "undefined" && import.meta.url) {
      const selfDir = path.dirname(fileURLToPath(import.meta.url));
      const candidate = path.resolve(selfDir, "../..");
      if (fs.existsSync(path.join(candidate, "src", "dl"))) {
        return candidate;
      }
    }
  } catch (_) {}
  return process.cwd();
}

/**
 * Resolves the absolute path to the videos directory.
 */
export function getVideosDir(): string {
  if (process.env.AIDEOS_VIDEOS_DIR) {
    return path.resolve(process.env.AIDEOS_VIDEOS_DIR);
  }
  return path.resolve(getProjectRoot(), "videos");
}

/**
 * Lists all available video package slugs in the videos/ directory.
 */
export function listVideoPackages(): string[] {
  const dir = getVideosDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith("."))
    .map((dirent) => dirent.name)
    .sort();
}

/**
 * Loads a complete Film manifest from a video package directory.
 */
export function loadVideoPackage(slug: string): VideoPackage | null {
  const pkgDir = path.join(getVideosDir(), slug);
  const filmJsonPath = path.join(pkgDir, "film.json");

  if (!fs.existsSync(filmJsonPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filmJsonPath, "utf8");
    const film = JSON.parse(raw) as Film;

    let shotlist: any = null;
    const shotlistPath = path.join(pkgDir, "shotlist.json");
    if (fs.existsSync(shotlistPath)) {
      try {
        shotlist = JSON.parse(fs.readFileSync(shotlistPath, "utf8"));
      } catch (_) {}
    }

    let treatment: any = null;
    const treatmentPath = path.join(pkgDir, "treatment.json");
    if (fs.existsSync(treatmentPath)) {
      try {
        treatment = JSON.parse(fs.readFileSync(treatmentPath, "utf8"));
      } catch (_) {}
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
