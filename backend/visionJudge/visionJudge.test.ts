/**
 * File Description: Tests for the vision-judge loop.
 * Covers the 5-7 frame sampler, Jev's frameVerdict and suggestion ratings (mock, live-shaped
 * batched request, confidence and heuristic fallbacks), the reframed primitive pick (job rubric,
 * named spoken phrase, no repeat), and the whole judge on a temporary copy of the demo film with a
 * fake renderer, fake dispatch and fake Jev client, so nothing needs Chrome, a live agent or the network.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  ANIMATED_PRIMITIVES,
  PRIMITIVE_CRITERIA,
  applyConfidenceGating,
  buildDecisionRequest,
  buildFrameVerdictRequest,
  candidatePhrases,
  clearMockFrameVerdictHandler,
  heuristicFrameVerdict,
  heuristicSuggestionVerdict,
  judgeFrameVerdicts,
  parseDecisionResponse,
  prefetchPrimitiveAnswers,
  setMockFrameVerdictHandler,
  type FrameVerdictState,
} from "../jev";
import { buildSvgSources } from "../scene/buildSvgSources";
import { readFilm } from "../pipeline/filmStore";
import { readAgentReview, writeAgentReview } from "./agentReview";
import { judgeAndRepair, judgeFilm } from "./judge";
import { clampStride, describeFrame, sampleFrameNumbers } from "./sampler";

const ROOT = path.resolve(__dirname, "../..");
const DEMO = path.join(ROOT, "videos/speculative-decoding-designed");
const ID = "tmp-vision-judge-test";
const PKG = path.join(ROOT, "videos", ID);
const FRAMES = path.join(ROOT, ".frames", ID);

// Creates a temporary designed film (scene included) under its own id.
function freshPackage(): void {
  cleanup();
  fs.mkdirSync(PKG, { recursive: true });
  const film = JSON.parse(fs.readFileSync(path.join(DEMO, "film.json"), "utf8"));
  fs.writeFileSync(path.join(PKG, "film.json"), JSON.stringify({ ...film, id: ID }, null, 2));
}

// Removes the temporary package, its stills and everything a write generated for it.
function cleanup(): void {
  fs.rmSync(PKG, { recursive: true, force: true });
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, "src/dl/films", `${ID}.ts`), { force: true });
  buildSvgSources();
}

// A renderer that writes a stand-in file instead of launching Chrome.
const fakeRender = (_frame: unknown, out: string): string => {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, "png");
  return out;
};

test("Sampler: stride is clamped to 5-7 and samples are spaced by it", () => {
  assert.equal(clampStride(1), 5);
  assert.equal(clampStride(99), 7);
  assert.equal(clampStride(undefined), 6);
  const frames = sampleFrameNumbers(100, { stride: 6 });
  assert.equal(frames[0], 3);
  for (let i = 1; i < frames.length; i++) assert.equal(frames[i] - frames[i - 1], 6);
  assert.ok(frames.every((f) => f < 100));
});

test("Sampler: a long film is thinned evenly to the cap, keeping first and last", () => {
  const all = sampleFrameNumbers(5650, { stride: 6, maxSamples: 100000 });
  const thinned = sampleFrameNumbers(5650, { stride: 6, maxSamples: 20 });
  assert.equal(thinned.length, 20);
  assert.equal(thinned[0], all[0]);
  assert.equal(thinned[19], all[all.length - 1]);
});

test("Sampler: a frame is described by its own shot's narration and on-screen copy", () => {
  const film = JSON.parse(fs.readFileSync(path.join(DEMO, "film.json"), "utf8"));
  const first = describeFrame(film, 3);
  assert.equal(first.shotId, film.shots[0].id);
  assert.match(first.narration, /large language model/);
  assert.deepEqual(first.onscreen, ["One token at a time"]);
});

test("FrameVerdict: the request carries text only, plus one question per suggestion", () => {
  const state: FrameVerdictState = { narration: "Costs fall by 40%.", onscreen: ["40%"], note: "counter overlaps caption", suggestions: ["move the counter up", "shrink the label"], embeddingScore: 0.31 };
  const req = buildFrameVerdictRequest(state) as { state: Record<string, unknown>; questions: Record<string, unknown> };
  assert.deepEqual(Object.keys(req.questions), ["frameVerdict", "suggestion0", "suggestion1"]);
  assert.deepEqual(req.state.embedding, { score: 0.31, threshold: 0.5 });
  assert.equal(JSON.stringify(req).includes("png"), false);
});

test("FrameVerdict: heuristics read the note first and the embedding score second", () => {
  assert.equal(heuristicFrameVerdict({ narration: "x", note: "the label is too small to read" }), "Unreadable");
  assert.equal(heuristicFrameVerdict({ narration: "x", note: "the counter overlaps the caption" }), "LayoutDefect");
  assert.equal(heuristicFrameVerdict({ narration: "x", embeddingScore: 0.2 }), "WrongData");
  assert.equal(heuristicFrameVerdict({ narration: "x", embeddingScore: 0.8 }), "Match");
  assert.equal(heuristicFrameVerdict({ narration: "x", note: "overlaps the caption", repaired: true, embeddingScore: 0.8 }), "Match");
  assert.equal(heuristicSuggestionVerdict("make it better", "WrongData"), "reject");
  assert.equal(heuristicSuggestionVerdict("move the counter above the caption band", "LayoutDefect"), "accept");
});

test("FrameVerdict: one batched request rules on every frame and suggestion, low confidence falls back", async () => {
  const requests: any[] = [];
  const fetchFn = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    return {
      ok: true,
      json: async () => ({
        answers: {
          f0: { choice: "Match", confidence: 0.95 },
          f1: { choice: "LayoutDefect", confidence: 0.9 },
          f1s0: { choice: "accept-with-change", confidence: 0.8 },
          f1s1: { choice: "reject", confidence: 0.85 },
          f2: { choice: "Unreadable", confidence: 0.2 },
        },
      }),
    };
  }) as unknown as typeof fetch;
  const states: FrameVerdictState[] = [
    { narration: "one" },
    { narration: "two", note: "overlap", suggestions: ["move the counter up by a third", "recolor everything"] },
    { narration: "three", embeddingScore: 0.1 },
  ];
  const results = await judgeFrameVerdicts(states, { apiKey: "k", endpoint: "https://jev.test", fetchFn });
  assert.equal(requests.length, 1);
  assert.deepEqual(results.map((r) => r.verdict), ["Match", "LayoutDefect", "WrongData"]);
  assert.deepEqual(results[1].suggestionVerdicts, ["accept-with-change", "reject"]);
  assert.equal(results[2].source, "confidence-fallback");
});

test("FrameVerdict: with no key or a failing endpoint the heuristic rules", async () => {
  const state: FrameVerdictState = { narration: "x", note: "text is illegible", suggestions: ["raise the contrast of the caption text"] };
  const noKey = await judgeFrameVerdicts([state], { apiKey: "" });
  assert.equal(noKey[0].source, "heuristic-fallback");
  assert.equal(noKey[0].verdict, "Unreadable");
  const failing = (async () => ({ ok: false, status: 500, text: async () => "boom" })) as unknown as typeof fetch;
  const failed = await judgeFrameVerdicts([state], { apiKey: "k", endpoint: "https://jev.test", fetchFn: failing });
  assert.equal(failed[0].source, "heuristic-fallback");
  assert.equal(failed[0].suggestionVerdicts[0], "accept");
});

test("Primitive: every criterion states its job, when to pick and when not", () => {
  for (const p of ANIMATED_PRIMITIVES) {
    assert.match(PRIMITIVE_CRITERIA[p], /JOB:/, p);
    assert.match(PRIMITIVE_CRITERIA[p], /WHEN /, p);
    assert.match(PRIMITIVE_CRITERIA[p], /WHEN NOT:/, p);
  }
});

test("Primitive: the request carries camera, previous pick and the phrases a pick can serve", () => {
  const state = { narration: "Latency drops by 40%, and it stays low.", onscreen: ["Latency"], camera: "zoom-out", previousPick: "Card" };
  const req = buildDecisionRequest(state) as { state: Record<string, unknown>; questions: Record<string, any> };
  assert.equal(req.state.camera, "zoom-out");
  assert.equal(req.state.previousPick, "Card");
  assert.deepEqual(Object.keys(req.questions), ["primitive", "servesPhrase"]);
  assert.match(req.questions.servesPhrase.criteria.phrase1, /Latency drops by 40%/);
  assert.deepEqual(candidatePhrases("Hello."), []);
});

test("Primitive: a complex pick that names no spoken phrase degrades safely, a named one ships", () => {
  const state = { narration: "Latency drops by 40%, and it stays low.", onscreen: ["Latency"] };
  const phrases = candidatePhrases(state.narration);
  const response = { answers: { primitive: { choice: "StatCounter", confidence: 0.9 }, servesPhrase: { choice: "phrase1", confidence: 0.9 } } };
  const named = parseDecisionResponse(response, phrases);
  assert.equal(named.phrase, phrases[0]);
  assert.equal(applyConfidenceGating(named, state).primitive, "StatCounter");
  assert.equal(applyConfidenceGating(named, state).phrase, phrases[0]);
  const unnamed = parseDecisionResponse({ answers: { primitive: { choice: "StatCounter", confidence: 0.9 }, servesPhrase: { choice: "nonsense" } } }, phrases);
  assert.equal(unnamed.phrase, null);
  const gated = applyConfidenceGating(unnamed, state);
  assert.equal(gated.primitive, "TextReveal");
  assert.match(gated.fallbackReason ?? "", /no spoken phrase/);
});

test("Primitive: a back-to-back repeat gives way to Jev's close runner-up, but not to a distant one", () => {
  const state = { narration: "x", activeComponents: ["Card"], previousPick: "Card" };
  const close = applyConfidenceGating({ choice: "Card", confidence: 0.8, probabilities: { Card: 0.8, StatCounter: 0.6 } }, state);
  assert.equal(close.primitive, "StatCounter");
  const far = applyConfidenceGating({ choice: "Card", confidence: 0.8, probabilities: { Card: 0.8, StatCounter: 0.1 } }, state);
  assert.equal(far.primitive, "Card");
});

test("Primitive: the batched request asks every beat's primitive and phrase in one request", async () => {
  const bodies: any[] = [];
  const fetchFn = (async (_u: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const answers: Record<string, unknown> = {};
    Object.keys(body.questions).forEach((k) => {
      answers[k] = k.endsWith("phrase") ? { choice: "phrase1", confidence: 0.9 } : { choice: "TextReveal", confidence: 0.9 };
    });
    return { ok: true, json: async () => ({ answers }) };
  }) as unknown as typeof fetch;
  const states = [
    { narration: "The cache cuts latency by 40%, every time.", onscreen: ["Latency"], camera: "cut" },
    { narration: "Then it shut its eyes for good.", onscreen: [] },
  ];
  const out = await prefetchPrimitiveAnswers(states, { apiKey: "k", endpoint: "https://jev.test", fetchFn });
  assert.equal(bodies.length, 1);
  assert.deepEqual(Object.keys(bodies[0].questions), ["q0", "q0phrase", "q1", "q1phrase"]);
  assert.equal(bodies[0].state.beats[1].alreadyOnScreen[0], "Latency");
  assert.ok(out && "answer" in out[0] && out[0].answer.phrase === "The cache cuts latency by 40%");
});

test("AgentReview: a malformed review is refused and a stored one is only read when newer", () => {
  freshPackage();
  try {
    assert.throws(() => writeAgentReview(ID, { samples: [{ frame: -1 }] }));
    const stored = writeAgentReview(ID, { samples: [{ frame: 3, note: "ok", similarity: 0.7 }] }, () => new Date("2030-01-01T00:00:00Z"));
    assert.equal(readAgentReview(ID, "2029-01-01T00:00:00.000Z")?.samples[0].similarity, 0.7);
    assert.equal(readAgentReview(ID, stored.at), null);
  } finally {
    cleanup();
  }
});

test("Judge: skipped agent round, text-only ruling, a per-frame embedding log and no film write", async () => {
  freshPackage();
  try {
    const filmBefore = fs.readFileSync(path.join(PKG, "film.json"), "utf8");
    setMockFrameVerdictHandler((s) => ({ choice: "Match", confidence: 0.9, probabilities: {}, suggestions: (s.suggestions ?? []).map(() => ({ choice: "accept", confidence: 0.9 })) }));
    const result = await judgeFilm(ID, { skipAgent: true, renderStill: fakeRender, maxSamples: 5, jevOptions: { apiKey: "" } });
    assert.equal(result.agentRound, "skipped");
    assert.equal(result.samples.length, 5);
    assert.equal(result.passed, true);
    const log = fs.readFileSync(path.join(PKG, "design/judge/embedding-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(log.length, 5);
    assert.ok(log.every((e) => e.threshold === 0.5 && e.score === null && e.source === "none"));
    assert.equal(fs.readFileSync(path.join(PKG, "film.json"), "utf8"), filmBefore);
    assert.ok(fs.existsSync(path.join(PKG, "design/judge/verdicts.json")));
    assert.ok(fs.existsSync(path.join(PKG, "design/judge/manifest.json")));
  } finally {
    clearMockFrameVerdictHandler();
    cleanup();
  }
});

test("Judge: the agent's critique and scores reach Jev, and a failed frame carries its exact error", async () => {
  freshPackage();
  try {
    const seen: FrameVerdictState[] = [];
    setMockFrameVerdictHandler((s) => {
      seen.push(s);
      return s.embeddingScore !== null && (s.embeddingScore ?? 1) < 0.5
        ? { choice: "WrongData", confidence: 0.9, probabilities: {}, suggestions: (s.suggestions ?? []).map(() => ({ choice: "accept-with-change" as const, confidence: 0.9 })) }
        : { choice: "Match", confidence: 0.9, probabilities: {}, suggestions: [] };
    });
    const dispatched: any[] = [];
    const dispatch = async (opts: any) => {
      dispatched.push(opts);
      // The agent answers a moment after the task is sent, scoring the first sample low.
      setTimeout(() => {
        writeAgentReview(ID, {
          samples: [
            { frame: 3, note: "the picture shows the wrong chart", suggestions: ["swap the token strip for a single growing bar"], similarity: 0.2 },
            { frame: 9, note: "fine", similarity: 0.9 },
          ],
        });
      }, 10);
      return { ok: true, taskId: "t", channels: ["mcp_queue", "firstmate_inbox"], prompt: "", fallbackScheduled: false, fallbackTimeoutMs: 0, message: "" } as any;
    };
    const result = await judgeFilm(ID, { skipAgent: false, dispatch, renderStill: fakeRender, maxSamples: 3, pollMs: 20, agentTimeoutMs: 3000 });
    assert.equal(dispatched[0].eventType, "frame_review");
    assert.equal(dispatched[0].metadata.stills.length, 3);
    assert.equal(result.agentRound, "reported");
    assert.equal(result.passed, false);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].verdict, "WrongData");
    assert.match(result.failures[0].error, /frame 3 \(shot .+\) was ruled WrongData/);
    assert.match(result.failures[0].error, /image-text score 0\.20 against threshold 0\.50/);
    assert.match(result.failures[0].error, /swap the token strip/);
    assert.match(result.failures[0].error, /adjust it to fit this frame first/);
    assert.ok(seen.every((s) => typeof s.narration === "string"));
    assert.equal(JSON.stringify(seen).includes(".png"), false, "Jev only ever receives text");
  } finally {
    clearMockFrameVerdictHandler();
    cleanup();
  }
});

test("Judge: with no agent connected the round degrades to the text fallback", async () => {
  freshPackage();
  try {
    const dispatch = async () => ({ ok: true, taskId: "t", channels: ["mcp_queue", "file_inbox"], prompt: "", fallbackScheduled: false, fallbackTimeoutMs: 0, message: "" }) as any;
    const result = await judgeFilm(ID, { skipAgent: false, dispatch, renderStill: fakeRender, maxSamples: 2, jevOptions: { apiKey: "" } });
    assert.equal(result.agentRound, "no-agent");
    assert.equal(result.passed, true);
  } finally {
    cleanup();
  }
});

test("Judge: a missing rasterizer skips the pass instead of failing the film", async () => {
  freshPackage();
  try {
    const broken = () => {
      throw new Error("STILL_RASTERIZER_UNAVAILABLE: no Chrome");
    };
    const result = await judgeFilm(ID, { skipAgent: true, renderStill: broken, maxSamples: 2 });
    assert.match(result.skipped ?? "", /STILL_RASTERIZER_UNAVAILABLE/);
    assert.equal(result.passed, true);
  } finally {
    cleanup();
  }
});

test("Judge: failed samples go back to synthesis with their exact errors, bounded by the repair rounds", async () => {
  freshPackage();
  try {
    let round = 0;
    setMockFrameVerdictHandler(() => ({ choice: round === 0 ? "Unreadable" : "Match", confidence: 0.9, probabilities: {}, suggestions: [] }));
    const errors: string[] = [];
    const result = await judgeAndRepair(ID, {
      skipAgent: true,
      renderStill: fakeRender,
      maxSamples: 2,
      maxRepairRounds: 2,
      repair: async (e) => {
        errors.push(e);
        round += 1;
        return true;
      },
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /was ruled Unreadable/);
    assert.equal(result.passed, true);
    assert.ok(readFilm(ID));
  } finally {
    clearMockFrameVerdictHandler();
    cleanup();
  }
});
