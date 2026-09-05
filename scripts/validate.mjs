/**
 * File Description: Validates the active design-language film manifest and prints its runsheet bar chart.
 *
 * The schema enforces section 08 rhythm rules: no device past 25s, never the same
 * device twice in a row, a text beat every 60-90s, the canvas returning as an
 * anchor, catching pacing mistakes quickly. The printed runsheet is the same
 * bar chart the spec draws, in text.
 */
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Loads and bundles a TypeScript source module via esbuild for Node execution.
const load = async (rel, name) => {
  const tmp = path.join(ROOT, "node_modules", ".cache", name);
  await mkdir(path.dirname(tmp), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(ROOT, rel)],
    outfile: tmp,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  return import(`file://${tmp}?t=${Date.now()}`);
};

const { ACTIVE_FILM } = await load("src/dl/activeFilm.ts", "dl-film.mjs");
const { parseFilm, DEVICE_BLOCKS } = await load("src/dl/schema.ts", "dl-schema.mjs");
const { validateFilmAudioAndAssets } = await load("src/dl/validateFilm.ts", "dl-validate.mjs");
const { buildTimeline, totalFrames } = await load("src/dl/camera.ts", "dl-camera.mjs");
const { lintMetaphorSourceFiles } = await load("backend/visual_pipeline/lintMetaphors.ts", "dl-lint.mjs");

// Rule M1: Source scan for zero hardcoded topic-specific labels in metaphor components
const lintResult = lintMetaphorSourceFiles();
if (!lintResult.clean) {
  console.error("\n❌ METAPHOR LINT FAILED (Rule M1): Hardcoded topic-specific labels found in component source:");
  for (const v of lintResult.violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

const film = validateFilmAudioAndAssets(ACTIVE_FILM);
const timeline = buildTimeline(film);
const frames = totalFrames(timeline);
const seconds = frames / film.fps;
// Formats seconds into MM:SS timestamp string.
const stamp = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.round(s % 60)).padStart(2, "0")}`;

console.log(`\n✓ ${film.id} - valid`);
console.log(
  `  ${film.shots.length} shots · ${film.canvas.nodes.length} nodes · ${film.canvas.edges.length} edges`,
);
console.log(`  ${stamp(seconds)} · ${frames} frames @ ${film.fps}fps · ${film.chapters.length} chapters\n`);

const KIND = { none: "spine", frame: "beat", anchor: "device" };
let clock = 0;
for (const { shot, chapter } of timeline) {
  const device = shot.blocks.find((b) => DEVICE_BLOCKS.includes(b.c));
  const kind = device ? "device" : KIND[shot.stage];
  const bar = { spine: "█", device: "▓", beat: "░" }[kind].repeat(Math.max(1, Math.round(shot.dur / 2)));
  const look = shot.look === "all" ? "all" : Array.isArray(shot.look) ? shot.look.join("+") : shot.look;
  console.log(
    `  ${stamp(clock)}  ch${chapter + 1}  ${shot.move.padEnd(9)} ${String(shot.dur).padStart(2)}s ` +
      `${bar.padEnd(13)} ${shot.id.padEnd(11)} ${(device?.c ?? kind).padEnd(14)} → ${look}`,
  );
  clock += shot.dur;
}

const devices = {};
for (const { shot } of timeline)
  for (const b of shot.blocks)
    if (DEVICE_BLOCKS.includes(b.c)) devices[b.c] = (devices[b.c] ?? 0) + 1;

console.log(
  `\n  devices used: ${Object.entries(devices).map(([k, v]) => `${k}×${v}`).join(", ")}`,
);
console.log(`  █ spine  ▓ device  ░ beat\n`);
