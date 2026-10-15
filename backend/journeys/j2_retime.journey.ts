/**
 * File Description: Journey J2: the narration changes after the film was designed and rendered. The same request with the new script re-narrates, rebuilds the design so the contact moves to where "catches" is now spoken, and renders a new reel instead of reusing the stale one; the measured review of the new reel finds the contact on the word.
 * Inputs and outputs: the iona-receive fixture through runProduction twice (original and retimed screenplay, tone narration, contact-window reel renders) -> assertions on stages run, contact frames against the timed words, the rendered files and the measured review.
 * Used by: npm run test:journeys (the CI journeys job).
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { journey, probeVideo } from "./harness";
import { IONA_BEATS, ionaScript, journeyRequest, produceIona } from "./ionaFilm";
import { runProduction } from "../pipeline/run";
import { readFilm } from "../pipeline/filmStore";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import { prepareStageFacts } from "../../src/dl/scene/stageFacts";
import { reviewVideo } from "../review/review";
import type { ProductionProgress } from "../pipeline/types";
import type { Scene } from "../../src/dl/scene/types";

const SLUG = "journey-retime";
const WINDOW = 5;

// Hashes a rendered file so a reused render cannot pass for a new one.
const sha = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
// Reads the frame the narration speaks "catches" on, from the package's own timed words.
function catchesFrame(): number {
  const words = JSON.parse(fs.readFileSync(path.join(getVideosDir(), SLUG, "voiceover_words.json"), "utf8")).words as Array<{ word: string; start: number }>;
  const hit = words.find((w) => w.word.toLowerCase().replace(/[^a-z]/g, "") === "catches");
  assert.ok(hit, "the narration must still say catches");
  return Math.round(hit.start * 30);
}

journey("J2 a narration change after design moves the contact to the new word and renders anew, reusing nothing stale", async (ctx) => {
  const request = { formats: ["reel" as const] };
  const { result: before, contactFrame: oldContact } = await produceIona(SLUG, { windowFrames: WINDOW, request });
  assert.equal(before.status, "completed", JSON.stringify(before.warnings));
  assert.equal(oldContact, catchesFrame(), "the first film already lands on its word");
  const oldReel = before.outputs.find((o) => o.format === "reel")!;
  const oldHash = sha(oldReel.path);

  // The writer adds words before the catch: the decisive word is now spoken later.
  const beats = [IONA_BEATS[0], IONA_BEATS[1].replace("She catches", "She reaches out, steadies herself and catches"), IONA_BEATS[2]];
  const script = ionaScript(beats);
  const events: ProductionProgress[] = [];
  const designed = await runProduction({ ...journeyRequest(SLUG, request), script, stopAfter: "assemble" }, (e) => events.push(e));
  assert.equal(designed.status, "stopped", JSON.stringify(designed.warnings));
  for (const stage of ["narrate", "design", "assemble"]) assert.ok(events.some((e) => e.stage === stage && e.status === "running"), `${stage} must run again for new narration`);
  const scene = readFilm(SLUG)!.scene as Scene;
  const newContact = scene.performances![0].data.contact.frame;
  assert.equal(newContact, catchesFrame(), "the action's contact follows the newly spoken word");
  assert.ok(newContact > oldContact + 15, `contact must move later with the inserted words (was ${oldContact}, now ${newContact})`);
  const facts = prepareStageFacts(scene, 1080, 1920);
  try {
    assert.equal(facts.at(newContact)[0].ownership, "attached");
    assert.equal(facts.at(newContact - 1)[0].ownership, "airborne", "nothing is held a frame before the new word");
  } finally { facts.dispose(); }

  const renderEvents: ProductionProgress[] = [];
  const after = await runProduction({ ...journeyRequest(SLUG, request), script, renderFrames: [newContact - WINDOW, newContact + WINDOW] }, (e) => renderEvents.push(e));
  assert.equal(after.status, "completed", JSON.stringify(after.warnings));
  assert.ok(renderEvents.some((e) => e.stage === "render" && e.status === "running"), "the reel is rendered again, not reused");
  for (const stage of ["intake", "narrate", "look", "design", "assemble"]) assert.ok(renderEvents.some((e) => e.stage === stage && e.status === "skipped"), `${stage} is reused on the second pass of the same new script`);
  const newReel = after.outputs.find((o) => o.format === "reel")!;
  ctx.keep(newReel.path);
  assert.notEqual(sha(newReel.path), oldHash, "the stale render must not survive the narration change");
  assert.equal(probeVideo(newReel.path).frames, WINDOW * 2 + 1);

  const filmJson = path.join(getVideosDir(), SLUG, "film.json");
  const review = await reviewVideo({ target: newReel.path, film: filmJson, words: path.join(getVideosDir(), SLUG, "voiceover_words.json"), noWrite: true, skipOcr: true });
  const truth = review.stageTruth!;
  assert.equal(truth.format, "reel");
  assert.equal(truth.performances[0].contactFrame, newContact);
  assert.equal(truth.performances[0].offsetFrames, 0, "the measured review finds the contact on the new word");
  const adherence = review.criteria.find((c) => c.key === "plan-adherence")!;
  assert.equal(adherence.status, "pass", adherence.summary);
});
