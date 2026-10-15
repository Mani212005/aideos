/**
 * File Description: Journeys J1, J3 (seek order), J4 and J12 on one real production of the Iona receive fixture: script to rendered wide and reel mp4s through runProduction (tone narration, null engine, software GL), then checks that every frame is a pure function of its frame number, that the character and prop stay inside the frame and above the caption band, the contact frame has the glider attached, the rendered frames are drawn rather than blank, and no temp or disk is left behind.
 * Inputs and outputs: the committed iona-receive look and design -> assertions about stages, outputs, projected geometry and temp hygiene; failing frames are saved under .ci-artifacts/.
 * Used by: npm run test:journeys (the CI journeys job).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { journey, decodeFrame, extractFramePng, frameDiff, frameStats, probeVideo, sizeOf, tempEntries } from "./harness";
import { produceIona, type IonaProduction } from "./ionaFilm";
import { openFilm } from "./remotionFrames";
import { readFilm } from "../pipeline/filmStore";
import { prepareStageFacts } from "../../src/dl/scene/stageFacts";
import { SUBTITLE_BAND_TOP_RATIO } from "../../src/dl/fullScreenHeroLayout";
import type { Scene } from "../../src/dl/scene/types";

const SLUG = "journey-iona";
const WINDOW = 15;

let production: Promise<{ run: IonaProduction; tempBefore: string[]; tempAfter: string[] }> | undefined;
/** Produces the film once per test process; every journey below reads the same finished run. */
function produced() {
  production ??= (async () => {
    const tempBefore = tempEntries();
    const run = await produceIona(SLUG, { windowFrames: WINDOW, request: { formats: ["long", "reel"] } });
    return { run, tempBefore, tempAfter: tempEntries() };
  })();
  return production;
}

journey("J1 script to wide and reel mp4s through the real pipeline, with no model, key or GPU", async (ctx) => {
  const { run } = await produced();
  const { result, contactFrame } = run;
  assert.equal(result.status, "completed", JSON.stringify(result.warnings));
  assert.deepEqual(
    result.stages.map((s) => `${s.stage}:${s.status}`),
    ["intake", "narrate", "look", "design", "broll", "assemble", "render", "verify"].map((s) => `${s}:done`),
  );
  assert.equal(result.ttsBackend, "tone");
  assert.deepEqual(result.warnings, [], "a clean run must not warn");

  const expectedFrames = WINDOW * 2 + 1;
  const sizes = { long: [1920, 1080], reel: [1080, 1920] } as const;
  for (const format of ["long", "reel"] as const) {
    const out = result.outputs.find((o) => o.format === format);
    assert.ok(out, `${format} was not rendered`);
    ctx.keep(out.path);
    const facts = probeVideo(out.path);
    assert.deepEqual([facts.width, facts.height], sizes[format], `${format} frame size`);
    assert.equal(facts.fps, 30);
    assert.equal(facts.frames, expectedFrames, `${format} must hold exactly the requested window`);
    assert.ok(facts.hasAudio, `${format} must carry the narration`);

    // The contact frame is the middle of the window: drawn (not blank) and different from the approach.
    const contact = decodeFrame(out.path, { frame: WINDOW, scaleWidth: 480 });
    const approach = decodeFrame(out.path, { frame: 0, scaleWidth: 480 });
    const stats = frameStats(contact);
    assert.ok(stats.stddev > 8, `${format} contact frame looks flat (stddev ${stats.stddev.toFixed(1)}); a blank stage must never ship`);
    const moved = frameDiff(contact, approach);
    assert.ok(moved.changedShare > 0.002, `${format}: the contact frame is the same picture as 1 s earlier (${(moved.changedShare * 100).toFixed(3)}% changed); nothing moved`);
    extractFramePng(out.path, WINDOW, path.join(ctx.workDir, `${format}-contact-${contactFrame}.png`), 960);
    ctx.keep(path.join(ctx.workDir, `${format}-contact-${contactFrame}.png`));
  }
});

journey("J4 character and prop stay in frame and clear of the caption band in wide and reel", async () => {
  const { run } = await produced();
  const scene = readFilm(SLUG)!.scene as Scene;
  const contact = run.contactFrame;
  for (const [format, width, height] of [["wide", 1920, 1080], ["reel", 1080, 1920]] as const) {
    const facts = prepareStageFacts(scene, width, height);
    try {
      const captionTop = SUBTITLE_BAND_TOP_RATIO * height;
      // Every frame from the approach to the end of the recovery, not a sparse sample.
      for (let frame = Math.max(0, contact - 45); frame <= Math.min(scene.durationFrames - 1, contact + 80); frame++) {
        for (const state of facts.at(frame)) {
          for (const [what, box] of [["character", state.actorBounds], ["prop", state.propBounds]] as const) {
            const where = `${format} frame ${frame} ${what} ${JSON.stringify(box)}`;
            assert.ok([box.x0, box.y0, box.x1, box.y1].every(Number.isFinite), `${where} has a non-finite bound`);
            if (what === "prop" && state.ownership === "airborne" && box.x1 < 0) continue;
            assert.ok(box.x0 >= 0 && box.x1 <= width && box.y0 >= 0, `${where} leaves the ${format} frame`);
            assert.ok(box.y1 <= captionTop, `${where} reaches the caption band that starts at y=${captionTop.toFixed(0)}`);
          }
        }
      }
      const at = facts.at(contact)[0];
      assert.equal(at.ownership, "attached", `${format}: at the decisive frame the glider must be in Iona's hand`);
      assert.equal(facts.at(contact - 20)[0].ownership, "airborne", `${format}: 20 frames earlier the glider is still flying`);
      assert.equal(at.afterState, "message-received");
    } finally {
      facts.dispose();
    }
  }
});

journey("J12 a render leaves no temp folders behind and stays small on disk", async () => {
  const { run, tempBefore, tempAfter } = await produced();
  const leaked = tempAfter.filter((e) => !tempBefore.includes(e));
  assert.deepEqual(leaked, [], "the pipeline left render temp folders in the temp dir");
  for (const out of run.result.outputs) {
    assert.ok(fs.existsSync(out.path));
    assert.ok(sizeOf(out.path) < 3 * 1024 * 1024, `${out.format} 1 s clip is ${sizeOf(out.path)} bytes; a short render must stay small`);
  }
  const staged = tempEntries(["aideos-public-", "aideos-journey-bundle-"]);
  assert.deepEqual(staged, [], "the staged public dir or bundle was not removed");
});

journey("J3 a frame is a pure function of its frame number: a concurrent out-of-order render equals each frame rendered cold", async (ctx) => {
  const { run } = await produced();
  const film = await openFilm(SLUG);
  try {
    const around: [number, number] = [run.contactFrame - 3, run.contactFrame + 3];
    for (const composition of ["Long", "Reel"] as const) {
      // Two workers pull frames in whatever order they finish: this is how an export renders.
      const sequenceDir = path.join(ctx.workDir, `${composition}-sequence`);
      const sequence = await film.sequence(composition, around, sequenceDir, 2);
      assert.equal(sequence.length, 7, `${composition} sequence must hold every requested frame`);
      const first = decodeFrame(sequence[0]);
      const last = decodeFrame(sequence[6]);
      assert.ok(frameDiff(first, last, 0).changedShare > 0, `${composition}: frames ${around[0]} and ${around[1]} are identical, so the equality below would prove nothing`);
      ctx.keep(sequenceDir);
      // Cold frames in a deliberately scrambled order, each in a fresh page with nothing carried over.
      for (const frame of [around[0] + 3, around[1], around[0], around[0] + 3, around[0] + 1]) {
        const cold = path.join(ctx.workDir, `${composition}-cold-${frame}.png`);
        await film.still(composition, frame, cold);
        const exported = sequence[frame - around[0]];
        const diff = frameDiff(decodeFrame(cold), decodeFrame(exported), 1);
        assert.ok(diff.changedShare < 0.0001, `${composition} frame ${frame}: the cold render differs from the export render in ${(diff.changedShare * 100).toFixed(4)}% of pixels (${exported})`);
      }
    }
  } finally {
    await film.close();
  }
});
