/**
 * File Description: Journey J7: shared Three stage facts describe the Iona film in the wide and reel crops, including contact against the decisive word, projected presence, camera and what remains unmeasured.
 * Inputs and outputs: the iona-receive fixture through runProduction (contact-window wide and reel renders, tone narration) -> assertions on film-derived stage truth and Gemini stage facts for each output crop.
 * Used by: npm run test:journeys (the CI journeys job).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { journey, probeVideo } from "./harness";
import { produceIona } from "./ionaFilm";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import { parseFilm } from "../../src/dl/schema";
import { parseLookPlan } from "../lookPlan/schema";
import { readFilmFacts } from "../review/source";
import { loadNarration } from "../review/speech";
import { stageTruth, stageTruthText } from "../review/stageTruth";

const SLUG = "journey-review-truth";

journey("J7 film-derived stage truth describes the whole film in wide and reel crops", async (ctx) => {
  const { result, contactFrame } = await produceIona(SLUG, { windowFrames: 5, request: { formats: ["long", "reel"] } });
  assert.equal(result.status, "completed", JSON.stringify(result.warnings));
  const pkg = path.join(getVideosDir(), SLUG);
  const filmJson = path.join(pkg, "film.json"), wordsPath = path.join(pkg, "voiceover_words.json");
  const film = parseFilm(JSON.parse(fs.readFileSync(filmJson, "utf8")));
  const lookPlan = parseLookPlan(JSON.parse(fs.readFileSync(path.join(pkg, "design", "look.json"), "utf8")));
  const narration = loadNarration(wordsPath);
  assert.match(fs.readFileSync(path.join(pkg, "design", "LOOK.md"), "utf8"), /\[performs: receive-message, contact on "catches"\]/, "the look strip names the performance");

  for (const format of ["long", "reel"] as const) {
    const out = result.outputs.find((o) => o.format === format)!;
    ctx.keep(out.path);
    const { width, height } = probeVideo(out.path);
    const filmFacts = readFilmFacts(film, { width, height });
    filmFacts.lookPlan = lookPlan;
    const truth = stageTruth(filmFacts, narration)!;
    assert.equal(truth.format, format);
    assert.deepEqual(truth.viewport, { width, height });
    assert.deepEqual(truth.characters.map((c) => [c.castId, c.id, c.version]), [["iona", "iona", 1]]);
    assert.deepEqual(truth.hidden, []);
    assert.equal(truth.performances[0].contactFrame, contactFrame);
    assert.equal(truth.performances[0].offsetFrames, 0, `${format}: contact lands on "catches"`);
    assert.deepEqual(truth.performances[0].presentAtContact.sort(), ["glider", "iona"]);
    assert.equal(truth.camera.moves, 0, "the fixture camera is fixed and a moving glider is not a camera move");
    assert.ok(truth.unmeasured.some((u) => /face appeal/.test(u)) && truth.unmeasured.some((u) => /finger contact/.test(u)) && truth.unmeasured.some((u) => /occlusion/.test(u)));
    const text = stageTruthText(truth);
    assert.match(text, new RegExp(`seen in the ${format} output \\(${width}x${height}\\)`));
    assert.match(text, /Characters drawn: 1: Iona/);
    assert.match(text, /contact at frame \d+, on the word/);
    assert.match(text, /NOT measured by any tool/);
    assert.doesNotMatch(text, /actorBounds|propParts|"x0"/, "stage truth avoids raw geometry");
  }
});
