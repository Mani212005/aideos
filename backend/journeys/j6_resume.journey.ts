/**
 * File Description: Journey J6: resume reopens exactly the right stages on a real character film. Running the same request again reuses every production stage (verify re-probes the outputs) and keeps the rendered reel byte for byte; giving the film its own edited copy of Iona (re-stamped) reuses intake, narration and look, and reruns design, reel, broll, assembly, render and verify into a reel whose pixels show the new art.
 * Inputs and outputs: the iona-receive fixture through runProduction three times (contact-window reel renders, tone narration) -> assertions on stages reused and run, the rendered files and the decoded contact frame.
 * Used by: npm run test:journeys (the CI journeys job).
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { decodeFrame, frameDiff, journey } from "./harness";
import { journeyRequest, produceIona } from "./ionaFilm";
import { runProduction } from "../pipeline/run";
import { readFilm } from "../pipeline/filmStore";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import { characterHash } from "../../src/dl/characters/hash";
import { characterSpecSchema } from "../../src/dl/characters/schema";
import { rawSpec } from "../testSupport/characters";
import type { ProductionProgress, ProductionRequest, ProductionStage } from "../pipeline/types";
import type { Scene } from "../../src/dl/scene/types";

const SLUG = "journey-resume";
const WINDOW = 5;

// Hashes a rendered file so a reused render can be told from a new one.
const sha = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
// Runs the request and splits its stages into those that ran and those reused from the previous run.
async function rerun(request: ProductionRequest): Promise<{ ran: ProductionStage[]; reused: ProductionStage[]; outputs: { format: string; path: string }[] }> {
  const events: ProductionProgress[] = [];
  const result = await runProduction(request, (e) => events.push(e));
  assert.equal(result.status, "completed", JSON.stringify(result.warnings));
  const stages = (status: string) => [...new Set(events.filter((e) => e.status === status).map((e) => e.stage))];
  return { ran: stages("running"), reused: stages("skipped"), outputs: result.outputs };
}

journey("J6 resume reuses everything when nothing changed, and a character edit reruns exactly design through verify", async (ctx) => {
  const { result, contactFrame } = await produceIona(SLUG, { windowFrames: WINDOW, request: { formats: ["reel"] } });
  assert.equal(result.status, "completed", JSON.stringify(result.warnings));
  const request = journeyRequest(SLUG, { formats: ["reel"], renderFrames: [contactFrame - WINDOW, contactFrame + WINDOW] });
  const firstReel = result.outputs.find((o) => o.format === "reel")!.path;
  const firstHash = sha(firstReel);
  const firstContact = decodeFrame(firstReel, { frame: WINDOW, scaleWidth: 480 });

  const same = await rerun(request);
  // Verify always probes the outputs again (cheap, and its warnings belong to every run); everything else is reused.
  assert.deepEqual(same.ran, ["verify"], "an unchanged request must not redo any production stage");
  assert.deepEqual(same.reused, ["intake", "narrate", "look", "design", "reel", "broll", "assemble", "render"]);
  assert.equal(sha(same.outputs[0].path), firstHash, "the reel is the one already rendered");

  // The film gets its own Iona with a different jacket colour, re-stamped as `aideos character check --stamp` would.
  const spec = characterSpecSchema.parse(rawSpec("iona"));
  spec.palette.teal = "#a83a6b";
  spec.hash = characterHash(spec);
  const dir = path.join(getVideosDir(), SLUG, "characters");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "iona.character.json"), JSON.stringify(spec, null, 2));

  const edited = await rerun(request);
  assert.deepEqual(edited.reused, ["intake", "narrate", "look"], "narration and the look plan still hold");
  assert.deepEqual(edited.ran, ["design", "reel", "broll", "assemble", "render", "verify"], "design and every later stage reopen");
  const cast = (readFilm(SLUG)!.scene as Scene).cast!.find((c) => c.kind === "character")!;
  assert.ok("character" in cast && cast.character.hash === spec.hash, "the film embeds the edited spec");
  const reel = edited.outputs[0].path;
  ctx.keep(reel);
  assert.notEqual(sha(reel), firstHash, "a stale render must not survive the character edit");
  const recoloured = decodeFrame(reel, { frame: WINDOW, scaleWidth: 480 });
  assert.ok(frameDiff(recoloured, firstContact).changedShare > 0.002, "the new jacket colour is visible at the contact frame");
});
