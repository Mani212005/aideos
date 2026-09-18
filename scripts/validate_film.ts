/**
 * File Description: Standalone CLI validator for arbitrary Aideos film.json files.
 * Validates against all 19 cinematic invariants in src/dl/schema.ts and prints a rich runsheet.
 * Usage: tsx scripts/validate_film.ts <path/to/film.json> [--skip-assets]
 */

import fs from "fs";
import path from "path";
import { parseFilm, DEVICE_BLOCKS, type Film } from "../src/dl/schema";
import { buildTimeline, totalFrames } from "../src/dl/camera";

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`
Usage:
  npx tsx scripts/validate_film.ts <path-to-film.json>

Examples:
  npx tsx scripts/validate_film.ts public/film.json
  npx tsx scripts/validate_film.ts videos/why-dit-replaced-unet/film.json
`);
  process.exit(0);
}

const targetPath = path.resolve(process.cwd(), args[0]);

if (!fs.existsSync(targetPath)) {
  console.error(`\n❌ Error: File not found at ${targetPath}\n`);
  process.exit(1);
}

let rawJson: unknown;
try {
  const content = fs.readFileSync(targetPath, "utf-8");
  rawJson = JSON.parse(content);
} catch (err) {
  console.error(`\n❌ Error: Failed to parse JSON from ${targetPath}:`, (err as Error).message);
  process.exit(1);
}

console.log(`\n🔍 Validating Aideos film at: ${targetPath}`);

let film: Film;
try {
  film = parseFilm(rawJson);
} catch (err: any) {
  console.error(`\n❌ Schema Invariant Validation Failed!`);
  if (err.errors && Array.isArray(err.errors)) {
    for (const issue of err.errors) {
      const pathStr = issue.path.join(".");
      console.error(`  • [${pathStr}]: ${issue.message}`);
    }
  } else {
    console.error(`  • ${err.message || String(err)}`);
  }
  console.error(`\nRefer to docs/DIRECTOR_GUIDE.md for the 19 cinematic invariant rules.\n`);
  process.exit(1);
}

const timeline = buildTimeline(film);
const frames = totalFrames(timeline);
const seconds = frames / film.fps;

const stamp = (s: number) => {
  const total = Math.round(s);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

console.log(`\n✅ Valid Aideos Film: "${film.title}" (${film.id})`);
console.log(`  • ${film.shots.length} shots · ${film.canvas.nodes.length} nodes · ${film.canvas.edges.length} edges`);
console.log(`  • ${stamp(seconds)} duration (${frames} frames @ ${film.fps}fps) · ${film.chapters.length} chapters\n`);

const KIND: Record<string, string> = { none: "spine", frame: "beat", anchor: "device" };
let clock = 0;
for (const { shot, chapter } of timeline) {
  const device = shot.blocks.find((b) => DEVICE_BLOCKS.includes(b.c as any));
  const kind = device ? "device" : KIND[shot.stage] || shot.stage;
  const bar = ({ spine: "█", device: "▓", beat: "░" } as any)[kind]?.repeat(Math.max(1, Math.round(shot.dur / 2))) || "·";
  const look = shot.look === "all" ? "all" : Array.isArray(shot.look) ? shot.look.join("+") : shot.look;
  console.log(
    `  ${stamp(clock)}  ch${chapter + 1}  ${shot.move.padEnd(9)} ${String(shot.dur).padStart(2)}s ` +
      `${bar.padEnd(13)} ${shot.id.padEnd(11)} ${(device?.c ?? kind).padEnd(14)} → ${look}`,
  );
  clock += shot.dur;
}

const devices: Record<string, number> = {};
for (const { shot } of timeline) {
  for (const b of shot.blocks) {
    if (DEVICE_BLOCKS.includes(b.c as any)) {
      devices[b.c] = (devices[b.c] ?? 0) + 1;
    }
  }
}

console.log(`\n  Devices summary: ${Object.keys(devices).length > 0 ? Object.entries(devices).map(([k, v]) => `${k}×${v}`).join(", ") : "None (pure typographic spine)"}`);
console.log(`  █ spine  ▓ device  ░ beat\n`);
