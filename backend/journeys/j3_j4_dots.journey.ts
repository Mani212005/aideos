/**
 * File Description: J3 dots preview/export equality and J4 caption-safe reel crop through the real production and Player paths.
 * Inputs and outputs: unchanged Iona receive with dots selected in look/design -> short concurrency-2 exports and exact-frame comparisons.
 * Used by: npm run test:journeys and npm run ci; no full-film exports or live model calls.
 */
import type { Scene } from "../../src/dl/scene/types";
import assert from "node:assert/strict";
import path from "node:path";
import { journey, decodeFrame, frameDiff, probeVideo } from "./harness";
import { produceIona } from "./ionaFilm";
import { openFilm } from "./remotionFrames";
import { openPlayer } from "./playerFrames";
import { readFilm } from "../pipeline/filmStore";
import { prepareStageFacts } from "../../src/dl/scene/stageFacts";
import { getStageSafeRegion } from "../../src/dl/fullScreenHeroLayout";
import { rectInside } from "../../src/dl/scene/projection";
import { stageTreatmentAt } from "../../src/dl/scene/materials/treatment";

journey("J3/J4 dots: preview equals export including cold/reverse seeks and both crops retain the catch", async (ctx) => {
  const slug = "journey-j3-j4-dots";
  const { result, contactFrame } = await produceIona(slug, {
    windowFrames: 2,
    design: (design) => {
      const iona = design.assets.find((asset: { id: string }) => asset.id === "iona"); iona.treatment = "dots-v1";
      design.assets.push({ id: "iona-copy", renderer: "three", kind: "character", character: "iona", position: [1200, 1215], unitsToStage: 44, treatment: "cel-v1" });
      design.assets.push({ id: "glider-copy", renderer: "three", kind: "prop", asset: "paper-glider-v1", treatment: "cel-v1" });
      design.performances.push({ ...design.performances[0], id: "receive-copy", actor: "iona-copy", prop: "glider-copy" });
      design.treatment = "cel-v1";
      delete design.shots;
    },
    look: (look) => {
      const iona = look.film.cast.find((actor: { id: string }) => actor.id === "iona"); iona.treatment = "dots-v1";
      look.film.cast.push({ id: "iona-copy", renderer: "three", treatment: "cel-v1", what: "A second Iona receives a glider", enters: "beat-01", changes: [{ at: "beat-02", how: "The second Iona catches and settles the glider.", state: "message-received", magnitude: "major" }], character: "iona" });
      look.film.cast.push({ id: "glider-copy", renderer: "three", treatment: "cel-v1", asset: "paper-glider-v1", what: "A second paper glider", enters: "beat-01", changes: [{ at: "beat-02", how: "The second glider becomes attached to its receiver's grip.", state: "message-received", magnitude: "major" }] });
      look.film.performances.push({ ...look.film.performances[0], id: "receive-copy", actor: "iona-copy", prop: "glider-copy" });
      for (const shot of look.shots) { shot.performances.push("receive-copy"); shot.carries.push("iona-copy", "glider-copy"); }
      look.film.treatment = "cel-v1";
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.outputs.length, 2);
  const film = readFilm(slug)!; assert.ok(film.scene); assert.equal(film.scene.treatment, "cel-v1");
  const scene = film.scene as Scene;
  const iona = scene.cast!.find((member) => member.id === "iona")!;
  const celActor = scene.cast!.find((member) => member.id === "iona-copy")!;
  assert.equal(stageTreatmentAt(scene, contactFrame, iona.treatment), "dots-v1");
  assert.equal(stageTreatmentAt(scene, contactFrame, celActor.treatment), "cel-v1");
  const exported = await openFilm(slug);
  try {
    for (const [format, composition, width, height] of [["long", "Long", 1920, 1080], ["reel", "Reel", 1080, 1920]] as const) {
      const output = result.outputs.find((o) => o.format === format)!;
      assert.deepEqual([probeVideo(output.path).width, probeVideo(output.path).height, probeVideo(output.path).frames], [width, height, 5]);
      const facts = prepareStageFacts(scene, width, height);
      try {
        const safe = getStageSafeRegion(format, width, height, true);
        for (let frame = contactFrame - 2; frame <= contactFrame + 2; frame++) {
          for (const pose of facts.at(frame)) {
            assert.ok(rectInside(pose.actorBounds, safe), `${format} actor cropped at ${frame}`);
            assert.ok(rectInside(pose.propBounds, safe), `${format} prop cropped at ${frame}`);
          }
        }
      } finally { facts.dispose(); }
      const player = await openPlayer(slug, composition, { initialFrame: contactFrame });
      try {
        const first = path.join(ctx.workDir, `${composition}-cold.png`);
        await player.snapshot(contactFrame, first, false); ctx.keep(first);
        const reference = path.join(ctx.workDir, `${composition}-export.png`);
        await exported.still(composition, contactFrame, reference); ctx.keep(reference);
        assert.ok(frameDiff(decodeFrame(first), decodeFrame(reference), 1).changedShare < .0001);
        for (const frame of [0, contactFrame + 2, contactFrame - 2, contactFrame]) {
          const preview = path.join(ctx.workDir, `${composition}-player-${frame}.png`), png = path.join(ctx.workDir, `${composition}-export-${frame}.png`);
          ctx.keep(preview); ctx.keep(png); await player.snapshot(frame, preview); await exported.still(composition, frame, png);
          assert.ok(frameDiff(decodeFrame(preview), decodeFrame(png), 1).changedShare < .0001, `${format} preview/export mismatch at ${frame}`);
        }
        assert.deepEqual(player.errors, []);
        const sequence = await exported.sequence(composition, [contactFrame, contactFrame + 1], path.join(ctx.workDir, `${composition}-workers`), 2);
        assert.equal(frameDiff(decodeFrame(reference), decodeFrame(sequence[0]), 0).changedShare, 0, `${format} duplicate worker output differs`);
      } finally { await player.close(); }
    }
  } finally { await exported.close(); }
});
