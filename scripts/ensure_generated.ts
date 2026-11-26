/**
 * File Description: Rebuilds the gitignored generated files (src/dl/films/*.ts shadows, the bundled
 * SVG source map and src/dl/activeFilm.ts) from the video packages on disk. Runs in the root
 * postinstall (scripts/postinstall.mjs) and as the pre-hook of every script that bundles them, so a fresh clone works from
 * examples/ alone and an owner's own videos are picked up automatically.
 * Inputs and outputs: video packages on disk -> generated TypeScript shadow files and activeFilm.ts.
 * Used by: bun run ensure:generated, scripts/postinstall.mjs, package.json pre-hooks and the CI install action.
 */

import { ensureGenerated } from "../backend/pipeline/generatedFiles";

/** Runs the rebuild and prints a one-line summary; failures are reported but never block an install. */
function main(): void {
  try {
    const { shadows, svgAssets, activeFilm } = ensureGenerated();
    console.log(`[generated] ${shadows} film shadow(s) written, ${svgAssets} svg asset(s) bundled, active film: ${activeFilm || "none"}`);
  } catch (err) {
    console.error(`[generated] could not rebuild generated files: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

main();
