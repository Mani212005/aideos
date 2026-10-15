/**
 * File Description: Enforces J5 three-character production, J3 real Player/export parity and J8 unavailable-WebGL refusal on one short shared stage production.
 * Inputs and outputs: Iona, Pip and Marlo specs plus the receive fixture -> both-format clips, independent contact ownership, matching Player pixels and named graphics errors.
 * Used by: npm run test:journeys and npm run ci journeys; concurrency 2 and short frame ranges only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ensureBrowser } from "@remotion/renderer";
import { journey, decodeFrame, frameDiff, frameStats, probeVideo } from "./harness";
import { produceIona, type Loose } from "./ionaFilm";
import { openFilm } from "./remotionFrames";
import { openPlayer } from "./playerFrames";
import { readFilm } from "../pipeline/filmStore";
import { checkLookPlanById } from "../lookPlan/check";
import { CHARACTER_FILES } from "../testSupport/characters";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import { prepareStageFacts } from "../../src/dl/scene/stageFacts";
import type { Scene } from "../../src/dl/scene/types";

const SLUG = "journey-three-characters";
const CHARACTERS = ["iona", "pip", "marlo"] as const;
let production: ReturnType<typeof produceIona> | undefined;

// Runs the same receive on three distinct data-defined characters in one persistent stage and one production.
function produced() {
  return production ??= produceIona(SLUG, {
    windowFrames: 6,
    design: (design) => {
      const dir = path.join(getVideosDir(), SLUG, "characters");
      fs.mkdirSync(dir, { recursive: true });
      for (const name of CHARACTERS) fs.copyFileSync(CHARACTER_FILES[name], path.join(dir, `${name}.character.json`));
      const receive = design.performances[0];
      design.assets = CHARACTERS.flatMap((character, i) => [
        { id: character, renderer: "three", kind: "character", character, position: [1060, 760 + i * 240], unitsToStage: 30, treatment: "cel-v1" },
        { id: `glider-${character}`, renderer: "three", kind: "prop", asset: "paper-glider-v1", treatment: "cel-v1" },
      ]);
      design.performances = CHARACTERS.map((actor) => ({ ...receive, id: `receive-${actor}`, actor, prop: `glider-${actor}`, limits: actor === "pip" ? "clamp" : "fail" }));
    },
    look: (look) => {
      const actor = look.film.cast.find((c: Loose) => c.id === "iona");
      const prop = look.film.cast.find((c: Loose) => c.id === "glider");
      const receive = look.film.performances[0];
      look.film.cast = CHARACTERS.flatMap((character) => [{ ...actor, id: character, character }, { ...prop, id: `glider-${character}` }]);
      look.film.performances = CHARACTERS.map((actor) => ({ ...receive, id: `receive-${actor}`, actor, prop: `glider-${actor}` }));
      for (const shot of look.shots) {
        shot.carries = look.film.cast.map((c: Loose) => c.id);
        shot.performances = look.film.performances.map((p: Loose) => p.id);
      }
    },
  });
}

journey("J5 three distinct characters pass look, design, compile and short wide/reel production with the same action", async (ctx) => {
  const { result, contactFrame } = await produced();
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(checkLookPlanById(SLUG).ok, true);
  const scene = readFilm(SLUG)!.scene as Scene;
  assert.deepEqual(scene.performances!.map((p) => p.data.rigId), CHARACTERS.map((c) => `${c}-v1`));
  assert.deepEqual(scene.performances!.map((p) => p.action), CHARACTERS.map(() => "receive-v1"));
  assert.equal(new Set(scene.cast!.filter((c) => c.kind === "character").map((c) => "character" in c ? c.character.hash : "")).size, 3);
  for (const [format, width, height] of [["long", 1920, 1080], ["reel", 1080, 1920]] as const) {
    const output = result.outputs.find((o) => o.format === format)!;
    ctx.keep(output.path);
    const probe = probeVideo(output.path);
    assert.deepEqual([probe.width, probe.height, probe.frames], [width, height, 13]);
    const facts = prepareStageFacts(scene, width, height);
    try {
      const states = facts.at(contactFrame);
      assert.equal(states.length, 3);
      const contact = decodeFrame(output.path, { frame: 6 });
      for (const state of states) {
        assert.equal(state.ownership, "attached");
        const box = state.actorBounds;
        assert.ok(box.x0 >= 0 && box.x1 <= width && box.y0 >= 0 && box.y1 < height * 0.78);
        // Each projected character rectangle must contain actual drawn pixels, not just valid JSON.
        const pixels: number[] = [];
        for (let y = Math.ceil(box.y0); y < Math.floor(box.y1); y++) {
          for (let x = Math.ceil(box.x0); x < Math.floor(box.x1); x++) {
            const i = (y * width + x) * 3;
            pixels.push(contact.data[i], contact.data[i + 1], contact.data[i + 2]);
          }
        }
        assert.ok(frameStats({ width: pixels.length / 3, height: 1, data: Buffer.from(pixels) }).stddev > 8, `${format}: character bounds contain no drawn character`);
      }
      const first = decodeFrame(output.path, { frame: 0 });
      const last = decodeFrame(output.path, { frame: 12 });
      assert.ok(frameDiff(first, last, 1).changedShare > 0.0001, `${format}: receive excerpt has no motion`);
    } finally { facts.dispose(); }
  }
});

journey("J3 the real Remotion Player matches exported pixels at the same absolute frames in both formats", async (ctx) => {
  const { contactFrame } = await produced();
  const exported = await openFilm(SLUG);
  try {
    for (const composition of ["Long", "Reel"] as const) {
      const player = await openPlayer(SLUG, composition);
      try {
        // Seek forwards, backwards, then repeat contact; the Player remains mounted throughout.
        for (const frame of [contactFrame, contactFrame + 4, contactFrame - 4, contactFrame]) {
          const preview = path.join(ctx.workDir, `${composition}-player-${frame}.png`);
          const output = path.join(ctx.workDir, `${composition}-export-${frame}.png`);
          ctx.keep(preview); ctx.keep(output);
          await player.snapshot(frame, preview);
          await exported.still(composition, frame, output);
          const diff = frameDiff(decodeFrame(preview), decodeFrame(output), 1);
          assert.ok(diff.changedShare < 0.0001, `${composition} absolute frame ${frame}: Player/export differ in ${(diff.changedShare * 100).toFixed(5)}% of pixels`);
        }
        assert.deepEqual(player.errors, []);
      } finally { await player.close(); }
    }
  } finally { await exported.close(); }
});

journey("J8 no WebGL gives a named export refusal and visible Player error, never a blank successful frame", async (ctx) => {
  const { contactFrame } = await produced();
  const chrome = await ensureBrowser();
  assert.ok("path" in chrome, "Remotion's pinned browser must be available");
  // Remotion has no disable-WebGL option. Pass Chrome's real flag through a temporary executable.
  const executable = path.join(ctx.workDir, "chrome-no-webgl");
  const quoted = `'${chrome.path.replace(/'/g, "'\\''")}'`;
  fs.writeFileSync(executable, `#!/bin/sh\nexec ${quoted} --disable-webgl "$@"\n`, { mode: 0o755 });
  const exported = await openFilm(SLUG, { browserExecutable: executable });
  const output = path.join(ctx.workDir, "must-not-render.png");
  try {
    await assert.rejects(exported.still("Long", contactFrame, output), /Three stage .*WebGL could not start/);
    assert.equal(fs.existsSync(output), false, "an unavailable stage must not emit a successful image");
  } finally { await exported.close(); }
  const player = await openPlayer(SLUG, "Long", { browserExecutable: executable });
  try {
    await player.waitForFailure();
    assert.match(await player.status(), /Scene graphics unavailable: WebGL could not start/);
  } finally { await player.close(); }
});
