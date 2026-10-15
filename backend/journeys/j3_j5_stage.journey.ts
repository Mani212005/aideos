/**
 * File Description: Enforces J5 three-character production, J3 real Player/export parity and J8 unavailable-WebGL refusal on one short shared stage production.
 * Inputs and outputs: Iona, Pip and Marlo specs plus the receive fixture -> both-format clips, independent contact ownership, matching Player pixels and named graphics errors.
 * Used by: npm run test:journeys and npm run ci journeys; concurrency 2 and short frame ranges only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ensureBrowser } from "@remotion/renderer";
import { journey, decodeFrame, frameDiff, probeVideo, type Rgb } from "./harness";
import { produceIona, type Loose } from "./ionaFilm";
import { openFilm } from "./remotionFrames";
import { openPlayer } from "./playerFrames";
import { readFilm } from "../pipeline/filmStore";
import { checkLookPlanById } from "../lookPlan/check";
import { CHARACTER_FILES } from "../testSupport/characters";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import { prepareStageFacts } from "../../src/dl/scene/stageFacts";
import type { Scene } from "../../src/dl/scene/types";

type PixelBounds = { x0: number; y0: number; x1: number; y1: number };

// Counts changed pixels inside projected bounds, optionally excluding pixels changed by the actor.
function attributablePixels(full: Rgb, hidden: Rgb, bounds: PixelBounds, actorHidden?: Rgb): number {
  assert.deepEqual([full.width, full.height], [hidden.width, hidden.height]);
  if (actorHidden) assert.deepEqual([full.width, full.height], [actorHidden.width, actorHidden.height]);
  const x0 = Math.max(0, Math.ceil(bounds.x0)), x1 = Math.min(full.width, Math.floor(bounds.x1));
  const y0 = Math.max(0, Math.ceil(bounds.y0)), y1 = Math.min(full.height, Math.floor(bounds.y1));
  let changed = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * full.width + x) * 3;
    const difference = (a: Rgb, b: Rgb) => Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    if (actorHidden && difference(full, actorHidden) > 8) continue;
    if (difference(full, hidden) > 8) changed++;
  }
  return changed;
}

// Requires raster changes attributable to the named object within its projected silhouette.
function assertRasterPresence(name: string, changed: number): void {
  assert.ok(changed > 5, `${name} missing from rendered projected bounds`);
}

// Captures a real hidden-prop frame and fresh actor/prop ablations while that prop stays hidden.
async function captureMissingProp(player: Awaited<ReturnType<typeof openPlayer>>, frame: number, format: string, actor: string, prop: string, workDir: string, keep: (file: string) => void) {
  const fullPath = path.join(workDir, `${format}-${prop}-missing-full.png`);
  const actorHiddenPath = path.join(workDir, `${format}-${prop}-missing-actor-hidden.png`);
  const propHiddenPath = path.join(workDir, `${format}-${prop}-missing-prop-hidden.png`);
  [fullPath, actorHiddenPath, propHiddenPath].forEach(keep);
  await player.setVisibility(frame, { prop });
  await player.snapshot(frame, fullPath);
  await player.setVisibility(frame, { prop, character: actor });
  await player.snapshot(frame, actorHiddenPath);
  await player.setVisibility(frame, { prop });
  await player.snapshot(frame, propHiddenPath);
  return { full: decodeFrame(fullPath), actorHidden: decodeFrame(actorHiddenPath), propHidden: decodeFrame(propHiddenPath) };
}

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
      const states = facts.at(contactFrame, "prop");
      assert.equal(states.length, 3);
      const player = await openPlayer(SLUG, format === "long" ? "Long" : "Reel");
      const fullPath = path.join(ctx.workDir, `${format}-all-visible.png`);
      ctx.keep(fullPath);
      try {
        await player.snapshot(contactFrame, fullPath);
        const full = decodeFrame(fullPath);
        const hiddenActors = new Map<string, Rgb>();
        const hiddenProps = new Map<string, Rgb>();
        for (const state of states) {
          const actorPath = path.join(ctx.workDir, `${format}-${state.actor}-hidden.png`);
          const propPath = path.join(ctx.workDir, `${format}-${state.prop}-hidden.png`);
          ctx.keep(actorPath); ctx.keep(propPath);
          await player.setVisibility(contactFrame, { character: state.actor });
          await player.snapshot(contactFrame, actorPath);
          hiddenActors.set(state.actor, decodeFrame(actorPath));
          await player.setVisibility(contactFrame, { prop: state.prop });
          await player.snapshot(contactFrame, propPath);
          hiddenProps.set(state.prop, decodeFrame(propPath));
        }
      for (const state of states) {
        assert.equal(state.ownership, "attached");
        const box = state.actorBounds;
        assert.ok(box.x0 >= 0 && box.x1 <= width && box.y0 >= 0 && box.y1 < height * 0.78);
        assertRasterPresence(`${format} character ${state.actor}`, attributablePixels(full, hiddenActors.get(state.actor)!, box));
        assert.equal(state.propVisibility?.status, "exposed", `${format}: ${state.prop} has no exposed mesh samples`);
        const prop = state.propBounds;
        assert.ok(prop.x0 >= 0 && prop.x1 <= width && prop.y0 >= 0 && prop.y1 < height * 0.78, `${format}: ${state.prop} prop bounds leave the visible frame: ${JSON.stringify(prop)}`);
        assertRasterPresence(`${format} prop ${state.prop}`, attributablePixels(full, hiddenProps.get(state.prop)!, prop, hiddenActors.get(state.actor)!));
        const actorOverlap = Math.max(0, Math.min(box.x1, prop.x1) - Math.max(box.x0, prop.x0)) * Math.max(0, Math.min(box.y1, prop.y1) - Math.max(box.y0, prop.y0));
        if (state === states[0]) {
          assert.ok(actorOverlap > 0, `${format}: the hidden-prop negative must overlap the actor bounds`);
          const missing = await captureMissingProp(player, contactFrame, `${format}-missing`, state.actor, state.prop, ctx.workDir, ctx.keep);
          assert.throws(() => assertRasterPresence(`${format} prop ${state.prop}`, attributablePixels(missing.full, missing.propHidden, prop, missing.actorHidden)), new RegExp(`${format} prop ${state.prop} missing`));
          const overlap = await captureMissingProp(player, contactFrame, `${format}-overlap`, state.actor, state.prop, ctx.workDir, ctx.keep);
          assert.ok(attributablePixels(overlap.full, overlap.actorHidden, prop) > 5, `${format}: hiding the actor must change pixels inside the prop crop while the prop stays absent`);
          assert.throws(() => assertRasterPresence(`${format} prop ${state.prop}`, attributablePixels(overlap.full, overlap.propHidden, prop, overlap.actorHidden)), new RegExp(`${format} prop ${state.prop} missing`));
        }
      }
      } finally { await player.close(); }
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
