/**
 * File Description: Tests for the reel hook check (criterion 15) and the opt-in reel-fast pacing profile.
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
  assert.deepEqual(r.threshold, { firstWordMaxSec: 0.3, sentenceWordsMin: 10, sentenceWordsMax: 16 });
});

test("hook: the first word must start under 0.3 s", () => {
  assert.equal(hook(narrate([OPENER], 0.29)).status, "pass");
  const late = hook(narrate([OPENER], 0.3));
  assert.equal(late.status, "fail");
  assert.match(late.summary, /voice starts at 0\.3 s/);
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

test("pacing profile: the default band is unchanged at 120 to 180 wpm", () => {
  assert.deepEqual(THRESHOLDS.pacingProfiles.default, { wpmMin: THRESHOLDS.pacing.wpmMin, wpmMax: THRESHOLDS.pacing.wpmMax });
  assert.deepEqual(THRESHOLDS.pacing, { ...THRESHOLDS.pacing, wpmMin: 120, wpmMax: 180 });
});

test("pacing profile: reel-fast allows about 194 wpm only on a reel that selects it", () => {
  // 0.31 s per word with no gaps is 193.5 wpm.
  const fast = narrate([`${Array.from({ length: 68 }, (_, i) => `w${i}`).join(" ")}.`], 0, 0.31);
  const plain = byKey(evaluateCriteria(reelInputs(fast)), "pacing")!;
  assert.equal(plain.status, "fail");
  assert.equal(plain.threshold.wpmMax, 180);
  assert.equal(plain.metrics.pacingProfile, undefined, "the default report shape is unchanged");
  assert.equal(byKey(evaluateCriteria(reelInputs(fast, { pacingProfile: "default" })), "pacing")!.status, "fail");
  const opted = byKey(evaluateCriteria(reelInputs(fast, { pacingProfile: "reel-fast" })), "pacing")!;
  assert.equal(opted.status, "pass");
  assert.equal(opted.threshold.wpmMax, 200);
  assert.equal(opted.metrics.pacingProfile, "reel-fast");
  const long = evaluateCriteria(reelInputs(fast, { format: "long", video: { ...VIDEO, width: 1920, height: 1080 }, pacingProfile: "reel-fast" }));
  assert.equal(byKey(long, "pacing")!.status, "fail", "a long review ignores the reel profile");
});

test("pacing profile: reel-fast does not loosen the slow end or go past about 200 wpm", () => {
  const slow = narrate([`${Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ")}.`], 0, 0.6);
  assert.equal(byKey(evaluateCriteria(reelInputs(slow, { pacingProfile: "reel-fast" })), "pacing")!.status, "fail");
  const tooFast = narrate([`${Array.from({ length: 70 }, (_, i) => `w${i}`).join(" ")}.`], 0, 0.28);
  assert.equal(byKey(evaluateCriteria(reelInputs(tooFast, { pacingProfile: "reel-fast" })), "pacing")!.status, "fail");
});
