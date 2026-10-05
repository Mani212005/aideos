/**
 * File Description: Generates the browser-side SVG source map for scene films.
 * SceneView is pure and has no filesystem access, so the source text of every committed asset under
 * videos/<slug>/visuals/ and examples/<slug>/visuals/ is written into a generated, gitignored module the Remotion bundle imports directly.
 * Inlining rather than fetching keeps the render synchronous and reproducible: a frame can never be
 * drawn before its artwork has arrived, because the artwork is part of the bundle.
 * Inputs and outputs: video package visuals/ directories -> generated svgSources.generated.ts source map.
 * Used by: backend/pipeline/generatedFiles.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { getExamplesDir, getVideosDir } from "../../src/dl/videoPackageLoader";

/** Repo root, resolved from this file's own location. */
function projectRoot(): string {
  return path.resolve(__dirname, "../..");
}

/** Path of the generated module every scene film's artwork is bundled through. */
export function generatedModulePath(): string {
  return path.join(projectRoot(), "src/dl/scene/assets/svgSources.generated.ts");
}

/** Adds every svg under <dir>/<slug>/visuals/ to the map, keyed "<prefix>/<slug>/visuals/<file>". */
function collectFrom(dir: string, prefix: string, sources: Record<string, string>): void {
  if (!fs.existsSync(dir)) return;
  for (const slug of fs.readdirSync(dir).sort()) {
    const visuals = path.join(dir, slug, "visuals");
    if (!fs.existsSync(visuals) || !fs.statSync(visuals).isDirectory()) continue;
    for (const file of fs.readdirSync(visuals).sort()) {
      if (!file.endsWith(".svg")) continue;
      sources[`${prefix}/${slug}/visuals/${file}`] = fs.readFileSync(path.join(visuals, file), "utf8");
    }
  }
}

/**
 * Collects every scene asset on this machine, keyed by the repo-relative path a film names it by:
 * the personal videos directory ("videos/...", wherever AIDEOS_VIDEOS_DIR points) and the committed
 * examples ("examples/..."). The result is gitignored: it differs per machine.
 */
export function collectSvgSources(): Record<string, string> {
  const sources: Record<string, string> = {};
  collectFrom(getVideosDir(), "videos", sources);
  collectFrom(getExamplesDir(), "examples", sources);
  return sources;
}

/** Renders the generated module's text, which is what the sync check compares against. */
export function renderModule(sources: Record<string, string>): string {
  const entries = Object.entries(sources)
    .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`)
    .join("\n");
  return [
    "/**",
    " * File Description: Generated SVG source map for scene films. Do not edit by hand.",
    " * Every asset under videos/<slug>/visuals/ and examples/<slug>/visuals/ inlined as source text, keyed by the path a",
    " * film's scene names it by, so Remotion's browser bundle can draw a scene without reading disk.",
    " * Regenerate with: npx tsx backend/scene/buildSvgSources.ts",
    " */",
    "",
    "export const SVG_SOURCES: Record<string, string> = {",
    entries,
    "};",
    "",
  ].join("\n");
}

/** Writes the generated module and returns how many assets it carries. */
export function buildSvgSources(): number {
  const sources = collectSvgSources();
  const target = generatedModulePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Rewriting an identical module would still make Vite reload the open studio (the editor imports
  // it), so it is only written when the artwork actually changed.
  const next = renderModule(sources);
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== next) fs.writeFileSync(target, next, "utf8");
  return Object.keys(sources).length;
}

// Guarded with typeof so this module can also be bundled as ESM (the editor dev server's config
// reaches it through the design build), where `require` and `module` do not exist.
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  const count = buildSvgSources();
  console.log(`[svg-sources] bundled ${count} assets into ${path.relative(projectRoot(), generatedModulePath())}`);
}
