/**
 * File Description: CLI entry point for rendering the currently active film in Long (16:9) or Reel (9:16) format to videos/<slug>/renders/.
 * Inputs and outputs: format argument and Remotion flags -> rendered MP4 video under videos/<slug>/renders/.
 * Used by: package.json (npm run render, npm run render:reel), bin/aideos.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureGenerated } from "../backend/pipeline/generatedFiles";
import { resolvePackageDir } from "../src/dl/videoPackageLoader";

const REPO_ROOT = path.resolve(__dirname, "..");

// Main execution function resolving the active film and rendering to videos/<slug>/renders/.
function main(): void {
  const compArg = process.argv[2] || "Long";
  const composition = compArg.toLowerCase() === "reel" ? "Reel" : "Long";
  const formatSlug = composition.toLowerCase();

  const { activeFilm } = ensureGenerated();
  if (!activeFilm) {
    console.error("Error: No active film found. Ensure a video package exists in videos/ or examples/.");
    process.exit(1);
  }

  const pkgDir = resolvePackageDir(activeFilm);
  const rendersDir = path.join(pkgDir, "renders");
  fs.mkdirSync(rendersDir, { recursive: true });

  const outPath = path.join(rendersDir, `${formatSlug}.mp4`);
  const extraArgs = process.argv.slice(3);

  const args = [
    "remotion",
    "render",
    "src/index.ts",
    composition,
    outPath,
    `--props={"filmId":"${activeFilm}"}`,
    "--gl=angle",
    ...extraArgs,
  ];

  console.log(`[render] Rendering active film "${activeFilm}" (${composition}) to ${path.relative(REPO_ROOT, outPath)}...`);
  try {
    execFileSync("npx", args, { cwd: REPO_ROOT, stdio: "inherit" });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 1;
    process.exit(status);
  }

  if (!fs.existsSync(outPath)) {
    console.error(`Error: Render failed to create output file at ${outPath}`);
    process.exit(1);
  }

  console.log(`[render] Render complete: ${outPath}`);
}

main();
