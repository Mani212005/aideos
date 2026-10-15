/**
 * File Description: Journey J7: both reviewers see the 3D stage truthfully on real renders. For the wide and the reel mp4 of the Iona fixture, the measured review describes that output's own stage (characters drawn, contact on the decisive word, camera in that crop, what is unmeasured) and passes plan adherence without any clip at the cue; the Gemini facts and the prompt the reviewer receives say the same per format in plain words, never a raw geometry dump; and a reviewer reply that skips evidence is not accepted.
 * Inputs and outputs: the iona-receive fixture through runProduction (contact-window wide and reel renders, tone narration) -> assertions on review.json stage truth, criterion 13, deterministic Gemini facts and the reviewer prompt (no model is called).
 * Used by: npm run test:journeys (the CI journeys job).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { journey, probeVideo } from "./harness";
import { produceIona } from "./ionaFilm";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import { reviewVideo } from "../review/review";
import { extractDeterministicFacts } from "../geminiReview/facts";
import { reviewVideo as geminiReview } from "../geminiReview/geminiReview";
import { RUBRIC_CRITERIA } from "../geminiReview/rubric";

const SLUG = "journey-review-truth";

journey("J7 the measured review and the Gemini facts describe each output's own 3D stage and name what is unmeasured", async (ctx) => {
  const { result, contactFrame } = await produceIona(SLUG, { windowFrames: 5, request: { formats: ["long", "reel"] } });
  assert.equal(result.status, "completed", JSON.stringify(result.warnings));
  const pkg = path.join(getVideosDir(), SLUG);
  const filmJson = path.join(pkg, "film.json"), words = path.join(pkg, "voiceover_words.json");
  assert.match(fs.readFileSync(path.join(pkg, "design", "LOOK.md"), "utf8"), /\[performs: receive-message, contact on "catches"\]/, "the look strip the reviewer reads names the performance");

  for (const format of ["long", "reel"] as const) {
    const out = result.outputs.find((o) => o.format === format)!;
    ctx.keep(out.path);
    const { width, height } = probeVideo(out.path);

    const review = await reviewVideo({ target: out.path, film: filmJson, words, noWrite: true, skipOcr: true });
    const truth = review.stageTruth!;
    assert.ok(truth, `${format}: review.json carries the stage as measured in this output`);
    assert.equal(truth.format, format);
    assert.deepEqual(truth.viewport, { width, height });
    assert.deepEqual(truth.characters.map((c) => [c.castId, c.id, c.version]), [["iona", "iona", 1]]);
    assert.deepEqual(truth.hidden, []);
    assert.equal(truth.performances[0].contactFrame, contactFrame);
    assert.equal(truth.performances[0].offsetFrames, 0, `${format}: contact lands on "catches"`);
    assert.deepEqual(truth.performances[0].presentAtContact.sort(), ["glider", "iona"]);
    assert.equal(truth.camera.moves, 0, "the fixture camera is fixed and a moving glider is not a camera move");
    assert.ok(truth.unmeasured.some((u) => /face appeal/.test(u)) && truth.unmeasured.some((u) => /finger contact/.test(u)) && truth.unmeasured.some((u) => /occlusion/.test(u)));
    const adherence = review.criteria.find((c) => c.key === "plan-adherence")!;
    assert.equal(adherence.status, "pass", `${format}: ${adherence.summary}`);
    assert.match(adherence.summary, new RegExp(`in the ${format} output`));

    const facts = await extractDeterministicFacts(out.path, { filmPath: filmJson, skipOcr: true });
    assert.equal(facts.stage?.format, format, "Gemini reads the same output's stage");
    assert.equal(facts.camera.measured, true);
    assert.equal(facts.camera.hasCameraMoves, false);
    assert.match(facts.camera.summary, new RegExp(`Static camera in the ${format} output`));
    assert.match(facts.rawSummaryText, new RegExp(`seen in the ${format} output \\(${width}x${height}\\)`));
    assert.match(facts.rawSummaryText, /Characters drawn: 1: Iona/);
    assert.match(facts.rawSummaryText, /contact at frame \d+, on the word/);
    assert.match(facts.rawSummaryText, /NOT measured by any tool/);
    assert.doesNotMatch(facts.rawSummaryText, /actorBounds|propParts|"x0"/, "no raw geometry is pasted into the prompt");

    let prompt = "";
    const criteria = RUBRIC_CRITERIA.map((c) => ({ name: c.name, title: c.title, isGate: c.isGate, score: 9.5, passed: true, evidenceTimestamps: c.name === "visible_cause_effect" ? [] : ["0:00"], reason: c.name === "visible_cause_effect" ? "The catch reads well." : "Seen at 0:00." }));
    const gemini = await geminiReview(out.path, {
      facts, filmPath: filmJson, maxValidationAttempts: 1,
      runner: async (p) => { prompt = p; return JSON.stringify({ overallScore: 9.6, verdict: "ACCEPT", summary: "ok", criteria, feedback: [] }); },
    });
    assert.match(prompt, /STAGE FACTS FOR THIS OUTPUT/);
    assert.match(prompt, /LOOK PLAN SHOTS[\s\S]*performs: receive-message/);
    assert.equal(gemini.verdict, "REVISE", "a criterion judged without evidence is never accepted");
  }
});
