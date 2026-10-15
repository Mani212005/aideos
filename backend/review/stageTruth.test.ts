/**
 * File Description: Review truth for Three stage films (J2, J7, J9): presence and camera measured in the reviewed output, hidden and off-frame cast never counted, plan adherence judged by each performance's evaluated contact against its spoken decisive word (no dummy clip), plain-word facts for Gemini that name what is unmeasured, and SVG facts that do not depend on the output.
 * Inputs and outputs: the compiled iona-receive fixture and its timed words, edited per case -> FilmFacts, criterion verdicts, StageTruth and prompt text.
 * Used by: npm test.
 */
import "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { parseFilm, type Film } from "../../src/dl/schema";
import { designSpecSchema } from "../designSpec/spec";
import { compileDesign } from "../designSpec/compile";
import { resolveDesignCharacters } from "../designSpec/build";
import { parseLookPlan } from "../lookPlan/schema";
import { readFilmFacts, type FilmFacts } from "./source";
import { evaluateCriteria } from "./criteria";
import { stageTruth, stageTruthText } from "./stageTruth";
import { inspectCamera } from "../geminiReview/facts";
import type { Narration } from "./speech";
import type { RenderFacts } from "./renderFacts";
import type { Scene } from "../../src/dl/scene/types";

const pkg = resolvePackageDir("iona-receive");
// Reads one JSON file of the fixture package.
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(pkg, file), "utf8"));
const LONG = { width: 1920, height: 1080 }, REEL = { width: 1080, height: 1920 };

// Compiles the fixture's v2 design exactly as design build does.
function compiled(): Film {
  const spec = designSpecSchema.parse(read("design/design.json"));
  const { characters, errors } = resolveDesignCharacters(spec, pkg);
  assert.deepEqual(errors, []);
  const result = compileDesign(parseFilm(read("film.json")), spec, read("voiceover_words.json").words, "hand-built", { characters });
  assert.deepEqual(result.errors, []);
  return result.film!;
}
// The fixture narration as the measured review loads it, optionally shifted after a given time.
function narration(shiftAfterSec = Infinity, shiftSec = 0): Narration {
  const words = (read("voiceover_words.json").words as Array<{ word: string; start: number; end: number }>).map((w) => w.start >= shiftAfterSec ? { ...w, start: w.start + shiftSec, end: w.end + shiftSec } : w);
  return { words, text: words.map((w) => w.word).join(" "), timed: true };
}
// Measures facts in one output with the fixture's look plan attached, as loadFilmFacts does.
function facts(film: Film, viewport = REEL): FilmFacts {
  return { ...readFilmFacts(film, viewport), lookPlan: parseLookPlan(read("design/look.json")) };
}
const RENDER: RenderFacts = { persistence: { median: 0.85, p10: 0.6, min: 0.3, weakest: [], samples: 100 }, stageClearTimes: [], hardCutTimes: [], staticRuns: [], meanCoverage: 0.04, samples: [], ocrRan: true };
// Runs the criteria the way the review does and returns one by key.
function criterion(film: FilmFacts, key: string, words = narration()) {
  const video = { path: "x.mp4", durationSec: film.durationSec, width: film.viewport?.width ?? 1920, height: film.viewport?.height ?? 1080, fps: 30, hasAudio: true, audioDurationSec: film.durationSec };
  return evaluateCriteria({ video, render: RENDER, film, narration: words, loudness: null, silences: [] }).find((c) => c.key === key)!;
}

test("J7: plan adherence passes a performance whose contact lands on its decisive word, with no clip starting at the cue", () => {
  const film = compiled();
  assert.deepEqual((film.scene as Scene).props?.flatMap((p) => p.animation?.clips ?? []) ?? [], [], "the fixture has no SVG clip a check could lean on");
  for (const viewport of [LONG, REEL]) {
    const measured = facts(film, viewport);
    assert.equal(measured.performances![0].contactFrame, Math.round(3.7 * 30), "contact is read from the action itself, on \"catches\"");
    const result = criterion(measured, "plan-adherence");
    assert.equal(result.status, "pass", result.summary);
    assert.equal(result.metrics.performanceShots, 3);
    assert.match(result.summary, new RegExp(`in the ${measured.format} output`));
  }
});

test("J2 and J7: a contact that no longer lands on its word fails adherence and cue timing, whatever the recorded decisive frame says", () => {
  const film = compiled();
  // The words moved (narration changed) but the film was not rebuilt: the recorded decisive frame still claims a match.
  const retimed = narration(3.5, 0.5);
  const result = criterion(facts(film), "plan-adherence", retimed);
  assert.equal(result.status, "fail");
  assert.match(result.summary, /performance "receive-message" makes contact at frame 111, 15 frames before its decisive word "catches" at frame 126/);
  const tampered = compiled();
  tampered.scene!.performances![0].decisive.frame = 126;
  assert.equal(criterion(facts(tampered), "plan-adherence", retimed).status, "fail", "editing the recorded frame cannot fake a contact");
});

test("J7: presence is measured in the reviewed crop; a character outside the reel column is present in the long output only", () => {
  const film = compiled();
  const actor = film.scene!.cast!.find((c) => c.kind === "character")!;
  if (actor.kind === "character") actor.position = [1720, 1210];
  const long = facts(film, LONG), reel = facts(film, REEL);
  const contact = long.performances![0];
  assert.ok(contact.presentAtContact.includes("iona"), "long sees her");
  assert.ok(!reel.performances![0].presentAtContact.includes("iona"), "the reel column does not");
  assert.ok(reel.planShots!.find((s) => s.id === "catch")!.offFrameAtEnd!.includes("iona"));
  const reelResult = criterion(reel, "plan-adherence");
  assert.equal(reelResult.status, "fail");
  assert.match(reelResult.summary, /iona .*not on stage in the reel output/);
});

test("J7: a cast member no performance draws is hidden, never counted present", () => {
  const film = compiled();
  const scene = film.scene as Scene;
  const actor = scene.cast!.find((c) => c.kind === "character")!;
  scene.cast!.push({ ...structuredClone(actor), id: "bystander" } as typeof actor);
  const measured = facts(film);
  assert.deepEqual(measured.stageCast!.hidden, ["bystander"]);
  assert.ok(measured.planShots!.every((s) => !s.visibleAtStart.includes("bystander") && !s.visibleAtEnd.includes("bystander")));
  const truth = stageTruth(measured, narration())!;
  assert.deepEqual(truth.hidden, ["bystander"]);
  assert.match(stageTruthText(truth), /Cast never drawn \(hidden\): bystander/);
});

test("J7: the stage camera is measured in each output; the same pan is a move in the reel but drift in the long cut", () => {
  const film = compiled();
  const scene = film.scene as Scene;
  scene.camera = { keyframes: [{ frame: 0, center: { x: 960, y: 960 }, zoom: 1 }, { frame: 30, center: { x: 960, y: 960 }, zoom: 1 }, { frame: 90, center: { x: 1020, y: 960 }, zoom: 1 }] } as Scene["camera"];
  const long = facts(film, LONG), reel = facts(film, REEL);
  assert.equal(long.camera.moves.length, 0);
  assert.equal(reel.camera.moves.length, 1);
  assert.match(reel.camera.moves[0].note, /1080x1920/);
  const dir = fs.mkdtempSync(path.join(resolvePackageDir("iona-receive"), "..", "camera-"));
  try {
    const filmPath = path.join(dir, "film.json");
    fs.writeFileSync(filmPath, JSON.stringify(film));
    assert.equal(inspectCamera(filmPath, 10, reel).moveCount, 1);
    assert.match(inspectCamera(filmPath, 10, reel).summary, /reel output/);
    assert.equal(inspectCamera(filmPath, 10, long).hasCameraMoves, false);
    const unknown = inspectCamera(filmPath, 10, null);
    assert.equal(unknown.measured, false, "without the output size the stage camera is not measured, never assumed");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("J7: a there-and-back stage pan remains one projected camera move in the reel", () => {
  const film = compiled();
  const scene = film.scene as Scene;
  scene.camera = { keyframes: [{ frame: 0, center: { x: 960, y: 960 }, zoom: 1 }, { frame: 45, center: { x: 1080, y: 960 }, zoom: 1 }, { frame: 90, center: { x: 960, y: 960 }, zoom: 1 }] } as Scene["camera"];
  const reel = facts(film, REEL);
  assert.equal(reel.camera.moves.length, 1);
  assert.ok(reel.camera.moves[0].shiftWidth >= 0.04, `projected excursion was ${reel.camera.moves[0].shiftWidth}`);
});

test("J7: the stage facts for Gemini name the characters, the contact against the word and everything unmeasured, in plain words", () => {
  const truth = stageTruth(facts(compiled(), REEL), narration())!;
  assert.equal(truth.format, "reel");
  assert.deepEqual(truth.characters.map((c) => [c.castId, c.id, c.version]), [["iona", "iona", 1]]);
  assert.equal(truth.performances[0].offsetFrames, 0);
  assert.equal(truth.camera.moves, 0);
  const text = stageTruthText(truth);
  assert.match(text, /Characters drawn: 1: Iona \(cast "iona", character iona v1, hash [0-9a-f]{12}\)/);
  assert.match(text, /decisive word "catches" \(start\) in shot catch is at 3\.70 s \(frame 111\); contact at frame 111, on the word/);
  assert.match(text, /fixed: the compiled camera does not move in the reel output/);
  assert.match(text, /NOT measured by any tool: pixel visibility and final occlusion.*face appeal.*finger contact/);
  assert.match(text, /never credit a criterion from these facts alone/);
  assert.ok(text.length < 3000, "facts stay prompt-sized");
  const unseen = stageTruth(facts(compiled(), REEL), null)!;
  assert.equal(unseen.performances[0].cueFrame, null);
  assert.match(stageTruthText(unseen), /"catches" was not found in the timed narration/);
});

test("J9: SVG scene facts do not depend on the reviewed output", () => {
  const film = parseFilm(JSON.parse(fs.readFileSync(path.join(resolvePackageDir("inset-stage"), "film.json"), "utf8")));
  assert.deepEqual(readFilmFacts(film, LONG), readFilmFacts(film, REEL));
  assert.equal(readFilmFacts(film, REEL).performances, undefined);
});
