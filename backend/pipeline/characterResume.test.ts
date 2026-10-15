/**
 * File Description: Resume and hashing for character films (J6): an unchanged rerun reuses every stage, while editing the character a film names (its rig proportions, re-stamped) reopens exactly design and everything after it and leaves intake, narration and look reused; the look hash and the design fingerprint both carry the character.
 * Inputs and outputs: the real runProduction on the iona-receive fixture's look and design (tone narration, no engine, stopping before render) -> stage progress events, fingerprints and the compiled film's embedded spec.
 * Used by: npm test.
 */
import "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runProduction, designFilesFingerprint, lookPlanFingerprint } from "./run";
import { readFilm } from "./filmStore";
import { buildDesign } from "../designSpec/build";
import { journeyRequest, writeIonaDesign } from "../journeys/ionaFilm";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import { characterHash } from "../../src/dl/characters/hash";
import { characterSpecSchema } from "../../src/dl/characters/schema";
import { rawSpec } from "../testSupport/characters";
import type { ProductionProgress, ProductionStage } from "./types";
import type { Scene } from "../../src/dl/scene/types";

// Runs the request to the end of assembly and returns which stages ran and which were reused.
async function run(slug: string): Promise<{ ran: ProductionStage[]; reused: ProductionStage[]; status: string }> {
  const events: ProductionProgress[] = [];
  const result = await runProduction({ ...journeyRequest(slug), stopAfter: "assemble" }, (e) => events.push(e));
  const stages = (status: string) => [...new Set(events.filter((e) => e.status === status).map((e) => e.stage))];
  return { ran: stages("running"), reused: stages("skipped"), status: result.status };
}

test("J6: a character spec edit reopens exactly design and the stages after it; an unchanged rerun reuses everything", async () => {
  const slug = "resume-character";
  const first = await runProduction({ ...journeyRequest(slug), stopAfter: "look" });
  assert.equal(first.status, "needs_look");
  writeIonaDesign(slug);
  assert.equal(buildDesign(slug, "hand-built").state, "passed");
  const built = await run(slug);
  assert.equal(built.status, "stopped");

  const again = await run(slug);
  assert.deepEqual(again.ran, [], "nothing changed, so nothing runs");
  assert.deepEqual(again.reused, ["intake", "narrate", "look", "design", "broll", "assemble"]);

  // The film's own copy of Iona with a longer neck: a rig change, re-stamped as an author would.
  const lookBefore = lookPlanFingerprint(slug), designBefore = designFilesFingerprint(slug);
  const spec = characterSpecSchema.parse(rawSpec("iona"));
  spec.skeleton.proportions.neck[1] += 0.02;
  spec.hash = characterHash(spec);
  const dir = path.join(getVideosDir(), slug, "characters");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "iona.character.json"), JSON.stringify(spec, null, 2));
  assert.notEqual(lookPlanFingerprint(slug), lookBefore, "the look hash carries the characters the plan names");
  assert.notEqual(designFilesFingerprint(slug), designBefore, "the design fingerprint carries the character spec");

  const edited = await run(slug);
  assert.deepEqual(edited.reused, ["intake", "narrate", "look"], "the narration and the look plan still hold");
  assert.deepEqual(edited.ran, ["design", "broll", "assemble"], "design and everything after it rebuild");
  const cast = (readFilm(slug)!.scene as Scene).cast!.find((c) => c.kind === "character")!;
  assert.ok("character" in cast && cast.character.hash === spec.hash, "the rebuilt film embeds the edited spec, not the stale one");
  assert.equal(readFilm(slug)!.scene!.performances![0].retarget?.characterHash, spec.hash, "the receive was refitted to the edited rig");
});
