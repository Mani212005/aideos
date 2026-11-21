/**
 * File Description: Tests for the reel hook check (criterion 15), the opt-in reel-fast pacing profile and the house pace windows of criterion 9.
 * Hand-built word timings and render facts go through the real criteria code; nothing is rendered.
 * Inputs and outputs: synthetic narration words and review inputs -> test assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCriteria, reelHook, type ReviewInputs } from "./criteria";
import type { Narration } from "./speech";
import { THRESHOLDS } from "./thresholds";
import type { ReviewWord, VideoFacts } from "./types";
import type { FilmFacts } from "./source";

// Builds timed narration from a sentence list: every word lasts `wordSec` and follows the previous one with no gap.
function narrate(sentences: string[], startSec = 0, wordSec = 0.3): Narration {
  const words: ReviewWord[] = [];
  let t = startSec;
  for (const token of sentences.join(" ").split(/\s+/)) {
    words.push({ word: token, start: t, end: t + wordSec });
    t += wordSec;
  }
  return { words, text: words.map((w) => w.word).join(" "), timed: true };
}

const OPENER = "Honey found in Egyptian tombs is still perfectly edible after three thousand years.";
// Runs the hook criterion on a narration.
const hook = (n: Narration | null) => reelHook(n);

test("hook: a 13 word statement of fact voiced at 0.0 s passes with its measurements", () => {
  const r = hook(narrate([OPENER, "Here is why."]));
  assert.equal(r.key, "hook");
  assert.equal(r.gate, false);
  assert.equal(r.status, "pass");
  assert.equal(r.metrics.firstSentenceWords, 13);
  assert.equal(r.metrics.firstWordStartSec, 0);
  assert.equal(r.metrics.greetingOpener, false);
  assert.deepEqual(r.threshold, { firstWordMaxSec: 0.25, sentenceWordsMin: 10, sentenceWordsMax: 16 });
});

// The 0.25 s bound is the 2026-11-21 house pace decision (captain: "I want a bit more faster editing"), 0.3 s before it.
test("hook: the first word must start under 0.25 s", () => {
  assert.equal(hook(narrate([OPENER], 0.24)).status, "pass");
  const late = hook(narrate([OPENER], 0.25));
  assert.equal(late.status, "fail");
  assert.match(late.summary, /voice starts at 0\.25 s/);
  assert.equal(hook(narrate([OPENER], 1.2)).status, "fail");
});

test("hook: the first sentence is 10 to 16 words inclusive", () => {
  const sentence = (n: number) => `${Array.from({ length: n }, (_, i) => `word${i}`).join(" ")}.`;
  for (const [n, status] of [[9, "fail"], [10, "pass"], [16, "pass"], [17, "fail"]] as const) {
    const r = hook(narrate([sentence(n), "More."]));
    assert.equal(r.status, status, `${n} words`);
    assert.equal(r.metrics.firstSentenceWords, n);
  }
});

test("hook: only the first sentence is counted, and ! and ? end it", () => {
  const r = hook(narrate(["Nothing in nature is truly straight, not even a bolt of lightning?", "It zigzags down in steps."]));
  assert.equal(r.metrics.firstSentenceWords, 12);
  assert.equal(r.status, "pass");
});

test("hook: a greeting or intro opener fails even at the right length and timing", () => {
  const openers = [
    "Hey everyone, welcome back to the channel where we explain how bridges hold up cars.",
    "Hello and welcome to a short explainer about why the sky is blue at noon today.",
    "In this video we will look at how a bridge carries a heavy load across water.",
    "Today we are going to learn how a bridge carries a heavy load across water.",
    "Let's talk about how a bridge carries a heavy load across a wide river today.",
    "Good morning, here is how a bridge carries a heavy load across a wide river.",
  ];
  for (const opener of openers) {
    const r = hook(narrate([opener, "Next."]));
    assert.equal(r.status, "fail", opener);
    assert.equal(r.metrics.greetingOpener, true, opener);
  }
});

test("hook: a statement that merely starts with a greeting-like word is not a greeting", () => {
  const r = hook(narrate(["Today a single bridge in Norway weighs less than the cars it carries over water."]));
  assert.equal(r.metrics.greetingOpener, false);
  assert.equal(r.status, "pass");
});

test("hook: abbreviations do not end the first sentence", () => {
  const r = hook(narrate(["The U.S. mint once made a coin so rare that nobody was able to spend one.", "Odd."]));
  assert.equal(r.metrics.firstSentenceWords, 16);
});

test("hook: missing inputs are skipped, never a pass", () => {
  const cases: Array<[string, Narration | null]> = [
    ["no narration", null],
    ["text only", { words: [], text: OPENER, timed: false }],
    ["no words", { words: [], text: "", timed: true }],
    ["no sentence punctuation in the words", narrate(["honey found in egyptian tombs is still edible after three thousand years"])],
  ];
  for (const [name, n] of cases) {
    const r = hook(n);
    assert.equal(r.status, "skipped", name);
    assert.equal(r.score, null, name);
    assert.match(r.summary, /^not measured/, name);
  }
});

const VIDEO: VideoFacts = { path: "x.mp4", durationSec: 21, width: 1080, height: 1920, fps: 30, hasAudio: true, audioDurationSec: 21 };

// Builds reel review inputs around a narration; the picture is healthy so pacing only reflects the speech.
function reelInputs(narration: Narration, over: Partial<ReviewInputs> = {}): ReviewInputs {
  return {
    format: "reel", video: VIDEO, narration, film: null, silences: [], loudness: { integratedLufs: -16, truePeakDb: -3 }, ...over,
    render: { persistence: { median: 0.85, p10: 0.6, min: 0.3, weakest: [], samples: 100 }, stageClearTimes: [], hardCutTimes: [], staticRuns: [], meanCoverage: 0.04, samples: [], ocrRan: true },
  };
}
// Finds one criterion result by its key.
const byKey = (rs: ReturnType<typeof evaluateCriteria>, key: string) => rs.find((c) => c.key === key);

test("hook: criterion 15 is evaluated on reel reviews only", () => {
  const n = narrate([OPENER]);
  assert.equal(byKey(evaluateCriteria(reelInputs(n)), "hook")?.status, "pass");
  assert.equal(byKey(evaluateCriteria(reelInputs(n, { format: "long", video: { ...VIDEO, width: 1920, height: 1080 } })), "hook"), undefined);
});

test("hook: a failed hook is a soft failure that never fails a gate", () => {
  const r = byKey(evaluateCriteria(reelInputs(narrate([OPENER], 1))), "hook")!;
  assert.equal(r.status, "fail");
  assert.equal(r.gate, false);
});

// The captain's 2026-11-21 pace decision ("I feel that 1.2x of the speed would really fit this nicely"):
// one house pace for both formats, 1.2x the 120 to 180 wpm window and the 5 to 12 s mean beat before it.
test("house pace (2026-11-21): the narration window is 145 to 215 wpm on the long and the reel alike", () => {
  assert.equal(THRESHOLDS.pacing.wpmMin, 145);
  assert.equal(THRESHOLDS.pacing.wpmMax, 215);
  const long = (n: Narration) => reelInputs(n, { format: "long", video: { ...VIDEO, width: 1920, height: 1080 } });
  // 0.31 s per word with no gaps is 193.5 wpm: the pace of the reference shorts, now the house pace.
  const brisk = narrate([`${Array.from({ length: 68 }, (_, i) => `w${i}`).join(" ")}.`], 0, 0.31);
  // 0.45 s per word is 133 wpm: inside the old window, too slow for the house pace.
  const old = narrate([`${Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ")}.`], 0, 0.45);
  // 0.27 s per word is 222 wpm: past the top of the window.
  const rushed = narrate([`${Array.from({ length: 70 }, (_, i) => `w${i}`).join(" ")}.`], 0, 0.27);
  for (const build of [reelInputs, long]) {
    const pass = byKey(evaluateCriteria(build(brisk)), "pacing")!;
    assert.equal(pass.status, "pass", pass.summary);
    assert.equal(pass.threshold.wpmMax, 215);
    const slow = byKey(evaluateCriteria(build(old)), "pacing")!;
    assert.equal(slow.status, "fail");
    assert.match(slow.summary, /133 words per minute \(window 145 to 215\)/);
    assert.equal(byKey(evaluateCriteria(build(rushed)), "pacing")!.status, "fail");
  }
});

// The 2026-11-21 house pace restates the default window and the reel-fast ceiling at 1.2x the 120 to 180 and 200 wpm before it.
test("pacing profile: the default band is 145 to 215 wpm", () => {
  assert.deepEqual(THRESHOLDS.pacingProfiles.default, { wpmMin: THRESHOLDS.pacing.wpmMin, wpmMax: THRESHOLDS.pacing.wpmMax });
  assert.deepEqual(THRESHOLDS.pacing, { ...THRESHOLDS.pacing, wpmMin: 145, wpmMax: 215 });
});

test("pacing profile: reel-fast allows about 231 wpm only on a reel that selects it", () => {
  // 0.26 s per word with no gaps is 230.8 wpm.
  const fast = narrate([`${Array.from({ length: 68 }, (_, i) => `w${i}`).join(" ")}.`], 0, 0.26);
  const plain = byKey(evaluateCriteria(reelInputs(fast)), "pacing")!;
  assert.equal(plain.status, "fail");
  assert.equal(plain.threshold.wpmMax, 215);
  assert.equal(plain.metrics.pacingProfile, undefined, "the default report shape is unchanged");
  assert.equal(byKey(evaluateCriteria(reelInputs(fast, { pacingProfile: "default" })), "pacing")!.status, "fail");
  const opted = byKey(evaluateCriteria(reelInputs(fast, { pacingProfile: "reel-fast" })), "pacing")!;
  assert.equal(opted.status, "pass");
  assert.equal(opted.threshold.wpmMax, 240);
  assert.equal(opted.metrics.pacingProfile, "reel-fast");
  const long = evaluateCriteria(reelInputs(fast, { format: "long", video: { ...VIDEO, width: 1920, height: 1080 }, pacingProfile: "reel-fast" }));
  assert.equal(byKey(long, "pacing")!.status, "fail", "a long review ignores the reel profile");
});

test("pacing profile: reel-fast does not loosen the slow end or go past about 240 wpm", () => {
  const slow = narrate([`${Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ")}.`], 0, 0.6);
  assert.equal(byKey(evaluateCriteria(reelInputs(slow, { pacingProfile: "reel-fast" })), "pacing")!.status, "fail");
  const tooFast = narrate([`${Array.from({ length: 70 }, (_, i) => `w${i}`).join(" ")}.`], 0, 0.24);
  assert.equal(byKey(evaluateCriteria(reelInputs(tooFast, { pacingProfile: "reel-fast" })), "pacing")!.status, "fail");
});

// The captain's 2026-11-21 pace decision asks for faster cutting, so only the top of the mean beat is gated: 10 s,
// the 12 s before it scaled by the house rate. A shorter mean beat is the intent and never fails.
test("house pace (2026-11-21): the mean beat may be at most 10 s and shorter is fine", () => {
  const brisk = narrate([`${Array.from({ length: 68 }, (_, i) => `w${i}`).join(" ")}.`], 0, 0.31);
  // Builds film facts with the given shot lengths and nothing else to judge.
  const film = (shotDurations: number[]): FilmFacts => ({
    filmId: "beats", kind: "scene", durationSec: shotDurations.reduce((a, b) => a + b, 0), fps: 30,
    shotBoundaries: [], shotDurations,
    camera: { available: false, kind: "none", moves: [], driftOnly: 0, maxSpeed: 0 },
    boundaries: [], clipStarts: [], performanceContacts: [], nodeOverlaps: [], voiceoverSec: null,
  });
  const pacingOf = (durations: number[]) => byKey(evaluateCriteria(reelInputs(brisk, { film: film(durations) })), "pacing")!;
  assert.equal(pacingOf([4, 7, 9]).status, "pass");
  assert.equal(pacingOf([4, 7, 9]).metrics.meanBeatSec, 6.7);
  assert.equal(pacingOf([4, 7, 9]).threshold.meanBeatMaxSec, 10);
  assert.equal(pacingOf([3, 3.5, 3]).status, "pass", "a 3.2 s mean beat is the faster cutting the captain asked for");
  // Mean 11 s: inside the old 5 to 12 s target, too long for the house pace.
  const long = pacingOf([10, 12, 11]);
  assert.equal(long.status, "fail");
  assert.match(long.summary, /mean beat lasts 11 s \(max 10 s\)/);
});
