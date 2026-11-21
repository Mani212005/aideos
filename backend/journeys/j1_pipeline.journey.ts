/**
 * File Description: Journeys J1, J3 (seek order), J4 and J12 on one real production of the Iona receive fixture: script to rendered wide and reel mp4s through runProduction (tone narration, null engine, software GL; the render job is native since P4.2), then checks that every frame is a pure function of its frame number (twice: the Remotion render, which draws every film the native renderer does not and is the kill switch, and the native export, P4.5), that the character and prop stay inside the frame and above the caption band, the contact frame has the glider attached, the rendered frames are drawn rather than blank, and no temp or disk is left behind.
 * Inputs and outputs: the committed iona-receive look and design -> assertions about stages, outputs, projected geometry and temp hygiene; failing frames are saved under .ci-artifacts/.
 * Used by: npm run test:journeys (the CI journeys job).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { journey, decodeFrame, extractFramePng, frameDiff, frameStats, probeVideo, sizeOf, tempEntries } from "./harness";
import { produceIona, type IonaProduction } from "./ionaFilm";
import { openFilm } from "./remotionFrames";
import { nativeJourneyProblem, nativeJourneysRequired, psnrDb, renderNativeFrame, stageNativePackage } from "./nativeFrames";
import { readFilm } from "../pipeline/filmStore";
import { FAKE_OWNER_BACKEND_NAME } from "../testSupport/fakeVcd";
import { reelForRender } from "../reelCut/store";
import { createRenderJob } from "../renderJob";
import { createNativeRenderer } from "../nativeRenderer";
import { prepareStageFacts } from "../../src/dl/scene/stageFacts";
import { subtitleBandTopRatio } from "../../src/dl/fullScreenHeroLayout";
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
    ["intake", "narrate", "look", "design", "reel", "broll", "assemble", "render", "verify"].map((s) => `${s}:done`),
  );
  assert.equal(result.ttsBackend, FAKE_OWNER_BACKEND_NAME, "the journey film is narrated by the owner voice");
  // Captain-approved edit (Option 1, 2026-11-01): music and effects are compulsory and the test environment caches a synthetic audio library, so no cache-miss warning remains.
  assert.deepEqual(result.warnings, [], "the default music and effects are assigned from the synthetic test library, so no warning is expected");

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
      const captionTop = subtitleBandTopRatio(format === "reel" ? "reel" : "long") * height;
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

const nativeProblem = nativeJourneyProblem();

/** The bar a native video frame must clear against the same frame drawn cold and lossless: the one `native/aideos-render/tests/video.rs` uses for an exported frame against its reference still. */
const EXPORT_PSNR_DB = 38;

journey("J3 native: the native export is a pure function of the frame number: one and three raster threads give the same frames, and each is the frame drawn cold", async (ctx) => {
  if (nativeProblem && !nativeJourneysRequired()) return;
  assert.equal(nativeProblem, null, "the native binary must be built for this journey (CI builds it first)");
  const { run } = await produced();
  const around: [number, number] = [run.contactFrame - 3, run.contactFrame + 3];
  for (const format of ["long", "reel"] as const) {
    const film = format === "reel" ? reelForRender(SLUG) : readFilm(SLUG)!;
    // The real export job at one raster thread and at three: the workers finish frames in whatever order they like and the encoder sees them in order.
    const exported = new Map<number, string>();
    for (const threads of [1, 3]) {
      const out = path.join(ctx.workDir, `${format}-native-${threads}-threads.mp4`);
      const job = createRenderJob({ film, format, outPath: out, profile: "final", frames: around }, createNativeRenderer({ threads }));
      assert.equal((await job.run()).output.format, format);
      exported.set(threads, out);
      ctx.keep(out);
    }
    assert.ok(frameDiff(decodeFrame(exported.get(1)!, { frame: 0 }), decodeFrame(exported.get(1)!, { frame: 6 }), 0).changedShare > 0, `${format}: frames ${around[0]} and ${around[1]} are identical, so the equality below would prove nothing`);
    for (let index = 0; index <= 6; index++) {
      const diff = frameDiff(decodeFrame(exported.get(1)!, { frame: index }), decodeFrame(exported.get(3)!, { frame: index }), 0);
      assert.equal(diff.changedShare, 0, `${format} frame ${around[0] + index}: the one-thread and three-thread exports differ in ${(diff.changedShare * 100).toFixed(4)}% of pixels`);
      assert.equal(diff.meanAbs, 0, `${format} frame ${around[0] + index}: the one-thread and three-thread exports differ`);
    }
    // Cold frames, each in its own process, in a deliberately scrambled order with one frame drawn twice.
    const staged = stageNativePackage(film, format, path.join(ctx.workDir, `${format}-cold-package`));
    const cold = new Map<number, string>();
    let lowestDb = Number.POSITIVE_INFINITY;
    for (const frame of [around[0] + 3, around[1], around[0], around[0] + 3, around[0] + 1]) {
      const png = path.join(ctx.workDir, `${format}-cold-${frame}-${cold.has(frame) ? "again" : "first"}.png`);
      renderNativeFrame(staged, format, frame, png);
      if (!cold.has(frame)) cold.set(frame, png);
      else assert.ok(fs.readFileSync(png).equals(fs.readFileSync(cold.get(frame)!)), `${format} frame ${frame}: drawn cold twice, the two PNG files differ`);
      const db = psnrDb(exported.get(3)!, frame - around[0], png);
      lowestDb = Math.min(lowestDb, db);
      assert.ok(db > EXPORT_PSNR_DB, `${format} frame ${frame}: the export is ${db.toFixed(2)} dB from the frame drawn cold (bar ${EXPORT_PSNR_DB} dB)`);
    }
    console.log(`native ${format} export against the cold frame, lowest PSNR ${lowestDb.toFixed(2)} dB (bar ${EXPORT_PSNR_DB} dB)`);
  }
});
