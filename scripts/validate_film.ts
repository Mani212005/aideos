/**
 * File Description: The one film validator CLI. Validates a film (a film.json, a TypeScript module exporting a
 * film, or the active film when no path is given) with the same validateFilmAudioAndAssets the renderer runs, then
 * prints its runsheet bar chart: one row per shot with its move, length, stage kind, device and look target.
 * Usage: tsx scripts/validate_film.ts [path/to/film.json | path/to/film.ts]
 * Inputs and outputs: optional film path -> validation verdict and formatted runsheet; exit 1 on an invalid film.
 * Used by: npm run validate, npm run validate:film, bin/aideos validate, backend/cli.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ZodError } from "zod";
import { DEVICE_BLOCKS, type Film } from "../src/dl/schema";
import { buildTimeline, totalFrames } from "../src/dl/camera";
import { validateFilmAudioAndAssets } from "../src/dl/validateFilm";

const USAGE = `
Usage:
  npx tsx scripts/validate_film.ts [path-to-film.json | path-to-film.ts]

With no path it validates the active film (src/dl/activeFilm.ts).

Examples:
  npx tsx scripts/validate_film.ts examples/hello-scene/film.json
  npx tsx scripts/validate_film.ts videos/my-video/film.json
`;

/** How each stage reads in the runsheet when the shot carries no device. */
const STAGE_KIND: Record<string, "spine" | "beat" | "device"> = { none: "spine", frame: "beat", anchor: "device" };
const BAR: Record<"spine" | "beat" | "device", string> = { spine: "█", device: "▓", beat: "░" };

// Reports whether a module export looks like a film object.
function isFilmLike(value: unknown): boolean {
  return Boolean(value) && typeof value === "object" && "id" in (value as object) && "shots" in (value as object);
}

// Loads the raw film the CLI was pointed at: a JSON file, a TypeScript film module, or the active film.
async function loadRawFilm(arg: string | undefined): Promise<{ raw: unknown; source: string }> {
  if (!arg) {
    const { ACTIVE_FILM } = await import("../src/dl/activeFilm");
    return { raw: ACTIVE_FILM, source: "src/dl/activeFilm.ts" };
  }
  const target = path.resolve(process.cwd(), arg);
  if (!fs.existsSync(target)) throw new Error(`film file not found: ${target}`);
  if (target.endsWith(".json")) {
    try {
      return { raw: JSON.parse(fs.readFileSync(target, "utf8")), source: target };
    } catch (err) {
      throw new Error(`could not parse JSON from ${target}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const loaded = (await import(pathToFileURL(target).href)) as Record<string, unknown>;
  const film = Object.values(loaded).find(isFilmLike);
  if (!film) throw new Error(`no film export found in module: ${target}`);
  return { raw: film, source: target };
}

// Prints why a film failed validation, listing each schema issue with its path.
function reportInvalid(err: unknown): void {
  console.error(`\n✗ Film validation failed`);
  if (err instanceof ZodError) {
    for (const issue of err.issues) console.error(`  • [${issue.path.join(".")}]: ${issue.message}`);
  } else {
    console.error(`  • ${err instanceof Error ? err.message : String(err)}`);
  }
  console.error(`\nRefer to docs/DIRECTOR_GUIDE.md for the cinematic invariant rules.\n`);
}

// Formats seconds as MM:SS, rounding to whole seconds before splitting so the tail of a minute never prints "01:60".
function stamp(seconds: number): string {
  const total = Math.round(seconds);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// Prints the validated film's summary and its runsheet bar chart.
function printRunsheet(film: Film): void {
  const timeline = buildTimeline(film);
  const frames = totalFrames(timeline);
  const devices = new Map<string, number>();

  console.log(`\n✓ ${film.title} (${film.id}) - valid`);
  console.log(`  ${film.shots.length} shots · ${film.canvas.nodes.length} nodes · ${film.canvas.edges.length} edges`);
  console.log(`  ${stamp(frames / film.fps)} · ${frames} frames @ ${film.fps}fps · ${film.chapters.length} chapters\n`);

  let clock = 0;
  for (const { shot, chapter } of timeline) {
    const device = shot.blocks.find((b) => (DEVICE_BLOCKS as readonly string[]).includes(b.c));
    if (device) devices.set(device.c, (devices.get(device.c) ?? 0) + 1);
    const kind = device ? "device" : STAGE_KIND[shot.stage] ?? "beat";
    const bar = BAR[kind].repeat(Math.max(1, Math.round(shot.dur / 2)));
    const look = shot.look === "all" ? "all" : Array.isArray(shot.look) ? shot.look.join("+") : shot.look;
    console.log(
      `  ${stamp(clock)}  ch${chapter + 1}  ${shot.move.padEnd(9)} ${String(shot.dur).padStart(2)}s ` +
        `${bar.padEnd(13)} ${shot.id.padEnd(11)} ${(device?.c ?? kind).padEnd(14)} → ${look}`,
    );
    clock += shot.dur;
  }

  const used = [...devices].map(([name, count]) => `${name}×${count}`).join(", ");
  console.log(`\n  devices used: ${used || "none (pure typographic spine)"}`);
  console.log(`  █ spine  ▓ device  ░ beat\n`);
}

// Runs the CLI: load, validate, print; exits 1 on any failure.
async function main(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const unknown = argv.filter((a) => a.startsWith("-"));
  if (unknown.length) throw new Error(`unknown option ${unknown[0]}\n${USAGE}`);
  const paths = argv;
  if (paths.length > 1) throw new Error(`expected at most one film path, got ${paths.length}`);
  const { raw, source } = await loadRawFilm(paths[0]);
  console.log(`\nValidating film from ${source}`);
  let film: Film;
  try {
    film = validateFilmAudioAndAssets(raw);
  } catch (err) {
    reportInvalid(err);
    process.exit(1);
  }
  printRunsheet(film);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
