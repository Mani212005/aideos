/**
 * File Description: Renders a film package to videos/<slug>/renders/<format>.mp4 through the Remotion CLI, so the
 * review tools (`aideos all-check`) can watch the current cut of a film.
 * Inputs and outputs: video slug and aspect ratio -> rendered MP4 video under videos/<slug>/renders/.
 * Used by: backend/allCheck/round.ts.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readActiveFilmSource, restoreActiveFilmSource, setActiveFilm } from "../pipeline/filmStore";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { reelForRender } from "../reelCut/store";

const REPO_ROOT = path.resolve(__dirname, "../..");

// Renders the video for a given slug using Remotion CLI.
export async function renderVideoForSlug(slug: string, format: "long" | "reel" = "long"): Promise<string> {
  if (format === "reel") reelForRender(slug);
  const pkgDir = resolvePackageDir(slug);
  const rendersDir = path.join(pkgDir, "renders");
  const outPath = path.join(rendersDir, `${format}.mp4`);
  // Refresh generated shadows, then capture the active-film source so this render can restore it afterward.
  const previousActive = readActiveFilmSource();
  await fsp.mkdir(rendersDir, { recursive: true });

  const compId = format === "reel" ? "Reel" : "Long";
  const args = [
    "remotion", "render", "src/index.ts", compId, outPath, "--gl=angle"
  ];

  try {
    setActiveFilm(slug);
    execFileSync("npx", args, { cwd: REPO_ROOT, stdio: "inherit" });
    if (!fs.existsSync(outPath)) {
      throw new Error(`Render failed to create output file at ${outPath}`);
    }
    return outPath;
  } finally {
    restoreActiveFilmSource(previousActive);
  }
}
