/**
 * File Description: CLI entry point for rendering the currently active film in Long (16:9) or Reel (9:16) format to videos/<slug>/renders/. Remotion renders by default; `--renderer native` (or AIDEOS_RENDERER=native) renders through the native renderer when it can draw the film, else falls back to Remotion and says why.
 * Inputs and outputs: format argument, an optional `--renderer remotion|native` and Remotion flags -> rendered MP4 video under videos/<slug>/renders/.
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
import { createNativeRenderer } from "../backend/nativeRenderer";
import { requestedRenderer, selectRenderer } from "../backend/rendererSelection";

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
  const requested = requestedRenderer(process.argv.slice(3));
  const choice = selectRenderer(film, format, requested.name, {
    remotion: () => createRemotionRenderer({ caller: "manual", extraArgs: requested.rest }),
    native: () => createNativeRenderer({
      onLog: (message) => console.log(`[render] ${message}`),
      onReport: (r) => console.log(`[render] native: ${r.frames} frames in ${r.elapsedSec.toFixed(1)} s (${r.framesPerSecond.toFixed(1)} fps), encoder ${r.encoder}${r.fallbackReason ? ` (${r.fallbackReason})` : ""}`),
    }),
  });
  if (choice.fallbackReason) console.warn(`[render] Native renderer not used, falling back to Remotion: ${choice.fallbackReason}`);
  console.log(`[render] Rendering active film "${activeFilm}" (${format}, ${choice.name}) to ${path.relative(REPO_ROOT, outPath)}...`);
  await createRenderJob({ film, format, outPath, profile: "final" }, choice.renderer).run();
  writeDescriptionCredits(rendersDir, [film]);
  console.log(`[render] Render complete: ${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
