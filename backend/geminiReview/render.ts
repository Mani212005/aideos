/**
 * File Description: Renders a film package to out/<slug>-<format>.mp4 through the Remotion CLI, so the
 * review tools (`aideos all-check`) can watch the current cut of a film.
 * Inputs and outputs: video slug and aspect ratio -> rendered MP4 video under out/.
 * Used by: backend/allCheck/round.ts.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureGenerated } from "../pipeline/generatedFiles";

const REPO_ROOT = path.resolve(__dirname, "../..");

// Renders the video for a given slug using Remotion CLI.
export async function renderVideoForSlug(slug: string, format: "long" | "reel" = "long"): Promise<string> {
  const outPath = path.join(REPO_ROOT, "out", `${slug}-${format}.mp4`);
  // Remotion bundles the generated film shadows, so a film.json edited since the last render must be re-shadowed first.
  ensureGenerated();
  await fsp.mkdir(path.dirname(outPath), { recursive: true });

  const compId = format === "reel" ? "Reel" : "Long";
  const args = [
    "remotion", "render", "src/index.ts", compId, outPath, `--props={"filmId":"${slug}"}`, "--gl=angle"
  ];

  execFileSync("npx", args, { cwd: REPO_ROOT, stdio: "inherit" });
  if (!fs.existsSync(outPath)) {
    throw new Error(`Render failed to create output file at ${outPath}`);
  }
  return outPath;
}
