/**
 * File Description: Emits the Render IR documents and artwork the native golden frames are rendered from (hello-scene, still-talking and the Three-stage iona-receive, long and reel) into native/aideos-render/fixtures/golden/, plus cases.json naming the golden frames. Narration, music and effect clips are dropped from the committed IR (the frame raster never opens audio), so the files stay small; everything the picture depends on is the emitter's own output (for iona-receive that includes the stage3d node, its face programs and the mesh file).
 * Inputs and outputs: the committed example and fixture films, the release aideos-render binary (text measurement) -> native/aideos-render/fixtures/golden/<film>/render.<format>.json, visuals/*.svg and cases.json.
 * Used by: `npm run goldens:native:ir` (run before `AIDEOS_NATIVE_GOLDEN_UPDATE=1 cargo test ... --test golden`), docs/NATIVE_RENDERER.md.
 */

import "../backend/testSupport/fixtureVideosDir";
import fs from "node:fs";
import path from "node:path";
import { buildDesign } from "../backend/designSpec/build";
import { readFilm } from "../backend/pipeline/filmStore";
import { reelForRender } from "../backend/reelCut/store";
import { emitFilmIr } from "../backend/nativeRenderer";
import { deliveryTimeline } from "../src/dl/delivery";
import type { NativeFormat } from "../backend/renderIr/emit";

const OUT = path.resolve(__dirname, "../native/aideos-render/fixtures/golden");

/** One film and the frames (as fractions of its story length) kept per format, the same picks as the Chrome goldens. */
const SPECS: Array<{ slug: string; frames: Record<NativeFormat, number[]>; buildFirst?: boolean }> = [
  { slug: "hello-scene", frames: { long: [0.1, 0.5, 0.9], reel: [0.5] } },
  { slug: "still-talking", frames: { long: [0.2, 0.6], reel: [0.4] } },
  // The Three-stage character film (P4.2): the fixture is a design package, built through the real buildDesign as the journeys do.
  { slug: "iona-receive", frames: { long: [0.1, 0.37, 0.6, 0.95], reel: [0.37, 0.8] }, buildFirst: true },
];

/** Emits every IR and writes the files plus the case list. */
function main(): void {
  fs.rmSync(OUT, { recursive: true, force: true });
  const cases: Array<{ film: string; format: NativeFormat; ir: string; frames: number[] }> = [];
  for (const spec of SPECS) {
    if (spec.buildFirst) {
      const built = buildDesign(spec.slug, "hand-built");
      if (built.state !== "passed") throw new Error(`cannot build ${spec.slug}: ${JSON.stringify(built).slice(0, 500)}`);
    }
    const base = readFilm(spec.slug);
    if (!base) throw new Error(`missing film ${spec.slug}`);
    const storyFrames = deliveryTimeline(base, "long").storyFrames;
    for (const format of ["long", "reel"] as const) {
      const film = format === "reel" ? reelForRender(spec.slug) : base;
      if (!film) throw new Error(`missing ${format} film for ${spec.slug}`);
      const { ir, files } = emitFilmIr(film, format);
      // The frame raster never opens audio: drop its assets and clips so the committed document stays small.
      const picture = { ...ir, assets: ir.assets.filter((a) => a.kind !== "audio"), audio: [] };
      const dir = path.join(OUT, spec.slug);
      fs.mkdirSync(path.join(dir, "visuals"), { recursive: true });
      const irName = `render.${format}.json`;
      fs.writeFileSync(path.join(dir, irName), `${JSON.stringify(picture)}\n`);
      for (const file of files) {
        if (file.path.startsWith("visuals/") && "text" in file) fs.writeFileSync(path.join(dir, file.path), file.text);
        // The Three stage's mesh file is shared by both formats (the same bytes).
        if (file.path.startsWith("meshes/") && "bytes" in file) {
          fs.mkdirSync(path.join(dir, "meshes"), { recursive: true });
          fs.writeFileSync(path.join(dir, file.path), file.bytes);
        }
      }
      const frames = spec.frames[format].map((fraction) => Math.min(storyFrames - 1, Math.round(fraction * storyFrames)));
      cases.push({ film: spec.slug, format, ir: `${spec.slug}/${irName}`, frames });
    }
  }
  fs.writeFileSync(path.join(OUT, "cases.json"), `${JSON.stringify(cases, null, 2)}\n`);
  for (const c of cases) console.log(`${c.ir}: ${(fs.statSync(path.join(OUT, c.ir)).size / 1024).toFixed(0)} KiB, frames ${c.frames.join(", ")}`);
}

main();
