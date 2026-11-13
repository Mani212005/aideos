/**
 * File Description: CLI entry point for rendering the currently active film in Long (16:9) or Reel (9:16) format to videos/<slug>/renders/.
 * Inputs and outputs: format argument and Remotion flags -> rendered MP4 video under videos/<slug>/renders/.
 * Used by: package.json (npm run render, npm run render:reel), bin/aideos.
 */

import path from "node:path";
import { ensureGenerated } from "../backend/pipeline/generatedFiles";
import { resolvePackageDir } from "../src/dl/videoPackageLoader";
import { readFilm } from "../backend/pipeline/filmStore";
import { writeDescriptionCredits } from "../backend/masterAudio";
import { reelForRender } from "../backend/reelCut/store";
import { createRenderJob } from "../backend/renderJob";
import { createRemotionRenderer } from "../backend/remotionRenderer";

const REPO_ROOT = path.resolve(__dirname, "..");

// Resolves the active package and executes the shared job with the legacy manual command options.
async function main(): Promise<void> {
  const format = (process.argv[2] || "Long").toLowerCase() === "reel" ? "reel" : "long";
  const { activeFilm } = ensureGenerated();
  if (!activeFilm) throw new Error("No active film found. Ensure a video package exists in videos/ or examples/.");
  const film = format === "reel" ? reelForRender(activeFilm) : readFilm(activeFilm);
  if (!film) throw new Error(`No film found for "${activeFilm}"`);
  const rendersDir = path.join(resolvePackageDir(activeFilm), "renders");
  const outPath = path.join(rendersDir, `${format}.mp4`);
  console.log(`[render] Rendering active film "${activeFilm}" (${format}) to ${path.relative(REPO_ROOT, outPath)}...`);
  await createRenderJob({ film, format, outPath, profile: "final" }, createRemotionRenderer({ caller: "manual", extraArgs: process.argv.slice(3) })).run();
  writeDescriptionCredits(rendersDir, [film]);
  console.log(`[render] Render complete: ${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
