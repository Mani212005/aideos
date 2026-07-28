/**
 * Fast episode validation — no browser, no bundle, no render.
 *
 * The Zod schema already rejects a malformed episode, but it does so inside the
 * renderer, so a bad string costs a full Chromium boot to discover. This runs the
 * same parse in ~2 seconds. Run it before every storyboard or render.
 */
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

const { ACTIVE_EPISODE } = await load("src/activeEpisode.ts", "validate-episode.mjs");
const { parseEpisode } = await load("src/schema.ts", "validate-schema.mjs");

const episode = parseEpisode(ACTIVE_EPISODE);

const seconds = episode.scenes.reduce((sum, s) => sum + s.duration, 0);
const frames = Math.round(seconds * episode.fps);
const mins = Math.floor(seconds / 60);

console.log(`✓ ${episode.id} — valid`);
console.log(`  ${episode.scenes.length} scenes · ${mins}m ${Math.round(seconds % 60)}s · ${frames} frames @ ${episode.fps}fps`);
console.log(`  subject: ${episode.subject} · theme: ${episode.theme}`);

const modules = {};
for (const s of episode.scenes) modules[s.visual ?? "type only"] = (modules[s.visual ?? "type only"] ?? 0) + 1;
console.log(`  modules: ${Object.entries(modules).map(([k, v]) => `${k}×${v}`).join(", ")}`);
