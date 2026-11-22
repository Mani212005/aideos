/**
 * File Description: Behaviour tests for the natural-narration take seam. They prove the selection rule (the
 * clean, most natural take wins, a search ends at the first accepted take, a line with no clean take is marked
 * degraded, an unavailable scorer falls back to the gates) and that the chosen take is what the real narration
 * pipeline caches: stored under a voice key that carries the selector, reused when the selector is unchanged and
 * re-recorded when it changes. Every voice here is a fake that reports itself as the owner's voice and returns
 * synthetic tones; no voice service, recording or real speech is used.
 * Inputs and outputs: fake take synthesizers and scorers -> chosen takes, cache keys and recorded or reused counts.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createTakeSelector,
  DEFAULT_TAKE_GATES,
  gateViolations,
  measureTake,
  reportedScoreScorer,
  selectTake,
  takeSelectorKey,
  takesVoiceKey,
  type NaturalnessScorer,
  type TakeChoice,
  type TakeResult,
  type TakeSynthesizer,
} from "./narrationTakes";
import { lineFingerprint, readLine, type LineAudio } from "./voiceLines";
import { lineVoiceKey, produceAudioPipeline } from "./audio";
import { PCM_SAMPLE_RATE, type TtsBackend } from "./tts";
import { FAKE_OWNER_BACKEND_NAME } from "./testSupport/fakeVcd";

const RATE = PCM_SAMPLE_RATE;

// Makes one line of a steady tone: `seconds` long at the given linear amplitude.
function tone(seconds: number, amplitude: number): LineAudio {
  const samples = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < samples.length; i++) samples[i] = amplitude * Math.sin((2 * Math.PI * 200 * i) / RATE);
  return { sampleRate: RATE, chunks: [{ text: "line", samples }] };
}

// A take synthesizer that returns the given takes in order and counts how many were asked for.
function scriptedTakes(takes: TakeResult[]): { synthesize: TakeSynthesizer; calls: () => number } {
  let calls = 0;
  return {
    synthesize: async (_text, index) => {
      calls += 1;
      return takes[Math.min(index, takes.length - 1)];
    },
    calls: () => calls,
  };
}

const LINE = "Caches make things fast.";
const CLEAN = (score: number): TakeResult => ({ audio: tone(1.4, 0.2), reportedScore: score });
const CLIPPED = (score: number): TakeResult => ({ audio: tone(1.4, 1), reportedScore: score });

test("the most natural clean take wins and a clipped take never does, even when it scores highest", async () => {
  const selector = createTakeSelector({ id: "t", maxTakes: 3, scorer: reportedScoreScorer("1"), acceptScore: 0.95, minScore: 0.4 });
  const takes = scriptedTakes([CLIPPED(0.99), CLEAN(0.6), CLEAN(0.8)]);
  const { choice } = await selectTake(LINE, takes.synthesize, selector);
  assert.equal(choice.chosenIndex, 2);
  assert.ok(choice.takes[0].violations.includes("clipping"), "a full-scale take is flagged as clipped");
  assert.equal(choice.degraded, false);
  assert.equal(choice.scored, true);
  assert.equal(takes.calls(), 3, "no take reached the accept score, so every take was tried");
});

test("the search ends at the first take that passes the gates and reaches the accept score", async () => {
  const selector = createTakeSelector({ id: "t", maxTakes: 5, scorer: reportedScoreScorer("1"), acceptScore: 0.8 });
  const takes = scriptedTakes([CLEAN(0.9), CLEAN(0.99)]);
  const { choice } = await selectTake(LINE, takes.synthesize, selector);
  assert.equal(choice.chosenIndex, 0);
  assert.equal(takes.calls(), 1, "a good first take costs one synthesis, not five");
});

test("a line with no clean take keeps the take with the fewest failed gates and is marked degraded", async () => {
  const selector = createTakeSelector({ id: "t", maxTakes: 3, scorer: reportedScoreScorer("1"), minScore: 0.5 });
  // take 0 and 2 are clipped and unnatural (several violations each); take 1 is only unnatural (one)
  const takes = scriptedTakes([CLIPPED(0.1), { audio: tone(1.4, 0.2), reportedScore: 0.3 }, CLIPPED(0.2)]);
  const { choice } = await selectTake(LINE, takes.synthesize, selector);
  assert.equal(choice.chosenIndex, 1);
  assert.equal(choice.degraded, true);
  assert.deepEqual(choice.takes[1].violations, ["low-naturalness"]);
  assert.equal(takes.calls(), 3);
});

test("an unavailable scorer falls back to the gates: the first clean take wins and the choice says it was unscored", async () => {
  const silentScorer: NaturalnessScorer = { id: "down", version: "1", score: async () => null };
  const selector = createTakeSelector({ id: "t", maxTakes: 4, scorer: silentScorer });
  const takes = scriptedTakes([CLIPPED(0.5), CLEAN(0.5), CLEAN(0.5)]);
  const { choice } = await selectTake(LINE, takes.synthesize, selector);
  assert.equal(choice.chosenIndex, 1, "take 0 is clipped, take 1 is the first clean one");
  assert.equal(choice.scored, false);
  assert.equal(takes.calls(), 2);
});

test("a scorer that returns a number outside 0..1 is an error, not a silent choice", async () => {
  const broken: NaturalnessScorer = { id: "broken", version: "1", score: async () => 4.2 };
  const selector = createTakeSelector({ id: "t", maxTakes: 2, scorer: broken });
  await assert.rejects(selectTake(LINE, scriptedTakes([CLEAN(0.5)]).synthesize, selector), /scores must be between 0 and 1/);
});

test("the service-reported scorer treats a missing or out-of-range score as unscored", async () => {
  const scorer = reportedScoreScorer("1");
  const audio = tone(1, 0.2);
  assert.equal(await scorer.score({ text: LINE, audio }), null);
  assert.equal(await scorer.score({ text: LINE, audio, reportedScore: 1.5 }), null);
  assert.equal(await scorer.score({ text: LINE, audio, reportedScore: 0.7 }), 0.7);
});

test("every change to the selection policy changes the cache key, and an equal policy keeps it", () => {
  const base = { id: "t", maxTakes: 3, scorer: reportedScoreScorer("1") };
  const key = takeSelectorKey(createTakeSelector(base));
  assert.equal(takeSelectorKey(createTakeSelector(base)), key);
  const variants = [
    createTakeSelector({ ...base, id: "other" }),
    createTakeSelector({ ...base, maxTakes: 4 }),
    createTakeSelector({ ...base, minScore: 0.6 }),
    createTakeSelector({ ...base, acceptScore: 0.9 }),
    createTakeSelector({ ...base, scorer: reportedScoreScorer("2") }),
    createTakeSelector({ ...base, scorer: null }),
    createTakeSelector({ ...base, gates: { maxPeak: 0.9 } }),
  ].map(takeSelectorKey);
  assert.equal(new Set([key, ...variants]).size, variants.length + 1, "all keys differ");
  assert.equal(takesVoiceKey("voice", undefined), "voice", "no selector keeps the plain key, so older recordings stay valid");
});

test("an invalid selector is refused with a plain message", () => {
  const scorer = reportedScoreScorer("1");
  assert.throws(() => createTakeSelector({ id: "t", maxTakes: 0, scorer }), /maxTakes/);
  assert.throws(() => createTakeSelector({ id: "t", maxTakes: 9, scorer }), /maxTakes/);
  assert.throws(() => createTakeSelector({ id: "t", maxTakes: 2, scorer, minScore: 0.9, acceptScore: 0.5 }), /minScore/);
  assert.throws(() => createTakeSelector({ id: " ", maxTakes: 2, scorer }), /id/);
});

test("the gates name what is wrong: silence, dead air in the middle of a line, a hot level and a hurried pace", () => {
  const gates = DEFAULT_TAKE_GATES;
  assert.deepEqual(gateViolations(LINE, measureTake(LINE, { sampleRate: RATE, chunks: [{ text: LINE, samples: new Float32Array(RATE) }] }), gates), ["empty"]);

  const hot = measureTake(LINE, tone(1.4, 0.95));
  assert.deepEqual(gateViolations(LINE, hot, gates), ["too-hot"]);

  const withGap = tone(1.9, 0.2);
  withGap.chunks[0].samples.fill(0, Math.round(0.5 * RATE), Math.round(1.3 * RATE));
  assert.deepEqual(gateViolations(LINE, measureTake(LINE, withGap), gates), ["dead-air"]);

  const hurried = measureTake(LINE, tone(0.5, 0.2)); // 4 words in 0.5 s is 480 wpm
  assert.deepEqual(gateViolations(LINE, hurried, gates), ["too-fast"]);
  assert.deepEqual(gateViolations("Hi there.", hurried, gates), [], "a two-word line is not judged on pace");
});

test("the pipeline stores the chosen take under a key that carries the selector, reuses it, and re-records when the selector changes", async () => {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-takes-"));
  try {
    let synthCalls = 0;
    // The owner-voice fake: take 0 clips, take 1 is clean but flat, take 2 is the natural one (amplitude 0.3 marks it).
    const amplitudes = [1, 0.2, 0.3];
    const scores = [0.95, 0.55, 0.9];
    const backend: TtsBackend = {
      name: FAKE_OWNER_BACKEND_NAME,
      voice: "voice_test_owner_fake",
      maxChars: 1800,
      async synthesize() {
        throw new Error("take-aware synthesis must not fall back to synthesize");
      },
      async synthesizeTake(text, take) {
        synthCalls += 1;
        const seconds = 1.2 + text.length / 100;
        return { samples: tone(seconds, amplitudes[Math.min(take, 2)]).chunks[0].samples, score: scores[Math.min(take, 2)] };
      },
    };
    const script = [LINE, "They also forget."];
    const selector = createTakeSelector({ id: "natural", maxTakes: 3, scorer: reportedScoreScorer("1"), acceptScore: 0.95, minScore: 0.4 });
    const choices: TakeChoice[] = [];
    const run = (sel = selector) =>
      produceAudioPipeline(script, pkg, { ttsBackendInstance: backend, narrationRate: 1, takeSelector: sel, onTakeChoice: (c) => choices.push(c) });

    const first = await run();
    assert.deepEqual(first.lines, { recorded: 2, reused: 0 });
    assert.equal(synthCalls, 6, "three takes for each of two lines");
    assert.deepEqual(choices.map((c) => c.chosenIndex), [2, 2], "the natural take wins on both lines");

    const stored = readLine(pkg, lineFingerprint(LINE, lineVoiceKey(backend, 1, selector)));
    assert.ok(stored, "the line is stored under the selector's key");
    const peak = stored.chunks[0].samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
    assert.ok(Math.abs(peak - 0.3) < 0.02, `the stored line is take 2 (peak ${peak})`);
    assert.equal(readLine(pkg, lineFingerprint(LINE, lineVoiceKey(backend, 1))), null, "nothing is stored under the plain key");

    synthCalls = 0;
    const second = await run();
    assert.deepEqual(second.lines, { recorded: 0, reused: 2 });
    assert.equal(synthCalls, 0, "an unchanged selector reuses the chosen takes");
    assert.deepEqual(second.shotDurations, first.shotDurations);

    const stricter = createTakeSelector({ id: "natural", maxTakes: 3, scorer: reportedScoreScorer("1"), acceptScore: 0.95, minScore: 0.45 });
    const third = await run(stricter);
    assert.deepEqual(third.lines, { recorded: 2, reused: 0 }, "a changed selector re-records every line");
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});

test("without a selector the pipeline behaves as before: one synthesis per line under the plain key", async () => {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-takes-off-"));
  try {
    let plainCalls = 0;
    const backend: TtsBackend = {
      name: FAKE_OWNER_BACKEND_NAME,
      voice: "voice_test_owner_fake",
      maxChars: 1800,
      async synthesize(text) {
        plainCalls += 1;
        return tone(1.2 + text.length / 100, 0.2).chunks[0].samples;
      },
      async synthesizeTake() {
        throw new Error("take-aware synthesis is only used when a selector is set");
      },
    };
    const result = await produceAudioPipeline([LINE], pkg, { ttsBackendInstance: backend, narrationRate: 1 });
    assert.deepEqual(result.lines, { recorded: 1, reused: 0 });
    assert.equal(plainCalls, 1);
    assert.ok(readLine(pkg, lineFingerprint(LINE, lineVoiceKey(backend, 1))));
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});

test("a deterministic backend without synthesizeTake gets one synthesis per line even when maxTakes is 3, and a take-capable backend gets all three", async () => {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-takes-cap-"));
  try {
    let plainCalls = 0;
    let takeCalls = 0;
    const base = { name: FAKE_OWNER_BACKEND_NAME, voice: "voice_test_owner_fake", maxChars: 1800 };
    // Too fast for the house pace gate, so every take fails a gate and the search would run to maxTakes if it could.
    const deterministic: TtsBackend = {
      ...base,
      async synthesize() {
        plainCalls += 1;
        return tone(0.3, 0.2).chunks[0].samples;
      },
    };
    const capable: TtsBackend = {
      ...base,
      async synthesize() {
        throw new Error("a take-capable backend is spoken through synthesizeTake");
      },
      async synthesizeTake() {
        takeCalls += 1;
        return { samples: tone(0.3, 0.2).chunks[0].samples };
      },
    };
    const selector = createTakeSelector({ id: "cap", maxTakes: 3, scorer: null });
    const script = [LINE, "They also forget to expire."];
    const choices: TakeChoice[] = [];
    const run = (backend: TtsBackend, dir: string) =>
      produceAudioPipeline(script, dir, { ttsBackendInstance: backend, narrationRate: 1, takeSelector: selector, onTakeChoice: (c) => choices.push(c) });

    const first = await run(deterministic, pkg);
    assert.deepEqual(first.lines, { recorded: 2, reused: 0 });
    assert.equal(plainCalls, 2, "one synthesis per line, not three");
    assert.ok(choices.every((c) => c.takes.length === 1 && c.degraded), "the single take is still judged by the gates");
    assert.ok(readLine(pkg, lineFingerprint(LINE, lineVoiceKey(deterministic, 1, selector))), "stored under the key of the effective selector");
    assert.notEqual(lineVoiceKey(deterministic, 1, selector), lineVoiceKey(capable, 1, selector), "the key reflects the effective take count");

    plainCalls = 0;
    const again = await run(deterministic, pkg);
    assert.deepEqual(again.lines, { recorded: 0, reused: 2 });
    assert.equal(plainCalls, 0);

    const pkg2 = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-takes-cap2-"));
    try {
      choices.length = 0;
      await run(capable, pkg2);
      assert.equal(takeCalls, 6, "three takes for each of two lines");
      assert.ok(choices.every((c) => c.takes.length === 3));
    } finally {
      fs.rmSync(pkg2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});
