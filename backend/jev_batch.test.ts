/**
 * File Description: Tests for batched Jev decisions and narration-grounded StatCounter quantities.
 * Verifies that a film's beats cost one Jev request instead of one per beat, that a missing or
 * failed answer falls back per beat, and that StatCounter labels come from the narration.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_BATCH_QUESTIONS,
  clearMockJevHandler,
  clearMockShotVisualHandler,
  prefetchPrimitiveAnswers,
  prefetchShotVisualAnswers,
  resolveShotVisual,
} from "./jev";
import { selectScenePrimitives, parseClaudeScript } from "./scriptIntake";
import { compileFilmFromScreenplayAsync } from "./pipeline/design";
import { readQuantity } from "./shotVisualCues";
import type { SegmentAudioInfo } from "./audio";

/** One recorded fake-endpoint call: the parsed request body. */
type Recorded = { state: { beats: unknown[] }; questions: Record<string, { instructions: string }> };

// Builds a fake fetch that records every request and answers each question with `answer(key, body)`.
function fakeFetch(answer: (key: string, body: Recorded) => unknown): { fetchFn: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchFn = (async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as Recorded;
    calls.push(body);
    const answers: Record<string, unknown> = {};
    for (const key of Object.keys(body.questions)) {
      const a = answer(key, body);
      if (a !== undefined) answers[key] = a;
    }
    return new Response(JSON.stringify({ answers }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

// Builds a narration spine matching the screenplay beat count.
function spine(durations: number[]): { segments: SegmentAudioInfo[]; shotDurations: number[] } {
  let cursor = 0;
  const segments = durations.map((duration, i) => {
    const seg = { text: `segment ${i}`, duration, startOffset: cursor, words: [], utterances: [] };
    cursor += duration + (i < durations.length - 1 ? 0.2 : 0);
    return seg;
  });
  const shotDurations = segments.map((seg, i) => (segments[i + 1] ? segments[i + 1].startOffset : cursor) - seg.startOffset);
  return { segments, shotDurations };
}

test("JevBatch: every beat goes into one request with one question per beat", async () => {
  clearMockShotVisualHandler();
  const { fetchFn, calls } = fakeFetch(() => ({ choice: "Text", confidence: 0.9 }));
  const states = [
    { narration: "Throughput scales with draft length.", onscreen: ["Curve"] },
    { narration: "Forty percent of the signal is lost.", onscreen: ["Loss"] },
    { narration: "It keeps going.", onscreen: ["Onward"] },
  ];
  const answers = await prefetchShotVisualAnswers(states, { apiKey: "k", endpoint: "https://jev.test", fetchFn });
  assert.equal(calls.length, 1);
  assert.equal(Object.keys(calls[0].questions).length, 3);
  assert.equal(calls[0].state.beats.length, 3);
  assert.match(calls[0].questions.q1.instructions, /`beats\[1\]`/);
  assert.ok(answers && answers.every((a) => "answer" in a && a.answer.choice === "Text"));
});

test("JevBatch: batches past the question cap are split into parallel requests", async () => {
  clearMockShotVisualHandler();
  const { fetchFn, calls } = fakeFetch(() => ({ choice: "Text", confidence: 0.9 }));
  const states = Array.from({ length: MAX_BATCH_QUESTIONS + 3 }, (_, i) => ({ narration: `Beat ${i}.` }));
  const answers = await prefetchShotVisualAnswers(states, { apiKey: "k", endpoint: "https://jev.test", fetchFn });
  assert.equal(calls.length, 2);
  assert.equal(answers?.length, states.length);
});

test("JevBatch: a missing answer falls back for that beat only; a failed request falls back for all", async () => {
  clearMockShotVisualHandler();
  const partial = fakeFetch((key) => (key === "q0" ? { choice: "Plot", confidence: 0.9 } : undefined));
  const states = [
    { narration: "Throughput scales linearly." },
    { narration: "Forty percent of the signal is lost." },
  ];
  const answers = await prefetchShotVisualAnswers(states, { apiKey: "k", endpoint: "https://jev.test", fetchFn: partial.fetchFn });
  assert.ok(answers);
  assert.equal(resolveShotVisual(answers[0], states[0]).visual, "Plot");
  const second = resolveShotVisual(answers[1], states[1]);
  assert.equal(second.source, "heuristic-fallback");
  assert.equal(second.visual, "StatCounter", "heuristic still grounds on the narration's number");

  const failing = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const failed = await prefetchShotVisualAnswers(states, { apiKey: "k", endpoint: "https://jev.test", fetchFn: failing });
    assert.ok(failed && failed.every((a) => "error" in a));
  } finally {
    console.warn = warn;
  }
});

test("JevBatch: no API key means no request; callers use the per-beat heuristic path", async () => {
  clearMockShotVisualHandler();
  const saved = { a: process.env.TYPESAFE_API_KEY, b: process.env.JEV_API_KEY, c: process.env.OPENROUTER_API_KEY };
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.JEV_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    assert.equal(await prefetchShotVisualAnswers([{ narration: "x" }], { apiKey: "" }), null);
  } finally {
    if (saved.a !== undefined) process.env.TYPESAFE_API_KEY = saved.a;
    if (saved.b !== undefined) process.env.JEV_API_KEY = saved.b;
    if (saved.c !== undefined) process.env.OPENROUTER_API_KEY = saved.c;
  }
});

test("JevBatch: compiling a multi-beat film makes exactly one Jev request", async () => {
  clearMockShotVisualHandler();
  const script = `## 0:00 - Numbers (numbers)

[ON SCREEN] Loss
[NARRATION] Forty percent of the signal is lost on the long way home.

[ON SCREEN] Scale
[NARRATION] Throughput scales linearly as the draft length grows.

[ON SCREEN] Layers
[NARRATION] Every one of those layers refines what the stack produced.
`;
  const { fetchFn, calls } = fakeFetch(() => ({ choice: "Text", confidence: 0.9 }));
  const { segments, shotDurations } = spine([6, 6, 6]);
  const result = await compileFilmFromScreenplayAsync(script, segments, shotDurations, { title: "Batch", maxFootageShots: 0 }, { apiKey: "k", endpoint: "https://jev.test", fetchFn });
  assert.equal(calls.length, 1, "one round-trip for the whole film");
  assert.equal(result.film.shots.length, 3);
});

test("JevBatch: screenplay primitive selection makes exactly one Jev request", async () => {
  clearMockJevHandler();
  const segments = parseClaudeScript(`## 0:00 - One (one)
[NARRATION] First scene narration.

## 0:10 - Two (two)
[NARRATION] Second scene narration with a code snippet.
`);
  const { fetchFn, calls } = fakeFetch(() => ({ choice: "TextReveal", confidence: 0.9 }));
  const results = await selectScenePrimitives(segments, { apiKey: "k", endpoint: "https://jev.test", fetchFn });
  assert.equal(calls.length, 1);
  assert.equal(results.size, segments.length);
  assert.ok(await prefetchPrimitiveAnswers([], { apiKey: "k", fetchFn }) === null, "nothing to ask costs nothing");
});

test("readQuantity: labels and values come from the narration", () => {
  const cases: [string, ReturnType<typeof readQuantity>][] = [
    ["Forty percent of the signal is lost on the way home.", { value: 40, suffix: "%", label: "Signal" }],
    ["It is still talking, on twenty two watts.", { value: 22, suffix: " W", label: "Watts" }],
    ["Generation gets two to three times faster.", { value: 3, suffix: "x", label: "Faster" }],
    ["The model reads 70 billion parameters per token.", { value: 70, suffix: "B", label: "Parameters" }],
    ["Each token moves 1.5 gigabytes of weights.", { value: 1.5, suffix: " GB", label: "Weights" }],
    ["Thirteen years out, it turned around.", { value: 13, label: "Years" }],
    ["Launched in 1977, it never came back.", null],
  ];
  for (const [text, want] of cases) assert.deepEqual(readQuantity(text), want, text);
});
