/**
 * File Description: Test suite for TypeSafe Jev model integration for screenplay primitive selection.
 * Verifies request building, response parsing, deterministic heuristic fallback, confidence gating,
 * mock client injection, and screenplay integration with zero live API calls.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ANIMATED_PRIMITIVES,
  DEFAULT_JEV_MODEL,
  OPENROUTER_JEV_MODEL,
  OPENROUTER_DECISIONS_ENDPOINT,
  TYPESAFE_ENDPOINT,
  applyConfidenceGating,
  buildDecisionRequest,
  clearMockJevHandler,
  getJevModel,
  heuristicPrimitiveSelection,
  parseDecisionResponse,
  selectPrimitive,
  setMockJevHandler,
  type JevChoiceAnswer,
  type JevDecisionState,
} from "./jev";
import {
  buildBlocksForPrimitive,
  buildFilmPartsFromScript,
  buildFilmPartsFromScriptAsync,
  selectScenePrimitives,
  parseClaudeScript,
} from "./scriptIntake";
import { shotSchema } from "../src/dl/schema";

test("Jev: buildDecisionRequest constructs conforming TypeSafe / OpenRouter payload", () => {
  const state: JevDecisionState = {
    visual: "Terminal window executing installation command",
    narration: "Run npm install to add the dependency to your project.",
    onscreen: ["npm install @typesafe-ai/sdk"],
    activeComponents: ["TextReveal"],
    sceneTitle: "Installation",
  };

  const payload = buildDecisionRequest(state, DEFAULT_JEV_MODEL) as Record<string, unknown>;

  assert.equal(payload.model, DEFAULT_JEV_MODEL);
  assert.ok(payload.state && typeof payload.state === "object");
  const reqState = payload.state as Record<string, unknown>;
  assert.equal(reqState.visual, "Terminal window executing installation command");
  assert.equal(reqState.narration, "Run npm install to add the dependency to your project.");
  assert.deepEqual(reqState.onscreen, ["npm install @typesafe-ai/sdk"]);
  assert.deepEqual(reqState.activeComponents, ["TextReveal"]);
  assert.equal(reqState.sceneTitle, "Installation");

  const questions = payload.questions as Record<string, unknown>;
  assert.ok(questions && questions.primitive);
  const primQ = questions.primitive as Record<string, unknown>;
  assert.equal(primQ.type, "choice");
  assert.ok(typeof primQ.instructions === "string");

  const criteria = primQ.criteria as Record<string, string>;
  for (const prim of ANIMATED_PRIMITIVES) {
    assert.ok(criteria[prim], `Criteria must define description for ${prim}`);
  }
});

test("Jev: parseDecisionResponse parses standard TypeSafe answer format", () => {
  const typeSafeResponse = {
    model: "typesafe/jev-1.13",
    answers: {
      primitive: {
        type: "choice",
        choice: "StatCounter",
        confidence: 0.91,
        probabilities: {
          StatCounter: 0.91,
          TextReveal: 0.05,
          Card: 0.02,
          ProgressBar: 0.01,
          CodeBlock: 0.01,
        },
      },
    },
    usage: { input_tokens: 120, output_tokens: 15 },
  };

  const parsed = parseDecisionResponse(typeSafeResponse);
  assert.equal(parsed.choice, "StatCounter");
  assert.equal(parsed.confidence, 0.91);
  assert.equal(parsed.probabilities.StatCounter, 0.91);
});

test("Jev: parseDecisionResponse parses OpenRouter decisions shape and normalizes casing", () => {
  const openRouterResponse = {
    decisions: {
      primitive: {
        choice: "codeblock",
        confidence: 0.84,
      },
    },
  };

  const parsed = parseDecisionResponse(openRouterResponse);
  assert.equal(parsed.choice, "CodeBlock");
  assert.equal(parsed.confidence, 0.84);
  assert.equal(parsed.probabilities.CodeBlock, 0.84);
});

test("Jev: parseDecisionResponse rejects unknown primitive and handles error payload", () => {
  const errorResponse = {
    error: {
      message: "Model typesafe/jev-1.13 rate limit reached",
    },
  };

  assert.throws(
    () => parseDecisionResponse(errorResponse),
    /rate limit reached/,
    "Should surface API error message",
  );

  const invalidChoiceResponse = {
    answers: {
      primitive: {
        choice: "UnknownFloatingOrb",
        confidence: 0.99,
      },
    },
  };

  assert.throws(
    () => parseDecisionResponse(invalidChoiceResponse),
    /unknown primitive choice/,
    "Should reject choice not in the closed set of 7 primitives",
  );
});

test("Jev: deterministic heuristic fallback maps all 7 primitives accurately without network", () => {
  // 1. StatCounter: quantities, percentages, metrics, benchmarks
  const statState: JevDecisionState = {
    narration: "Our throughput jumped by 4.5x with 99.9% uptime across all clusters.",
    onscreen: ["4.5x Throughput Gain"],
  };
  assert.equal(heuristicPrimitiveSelection(statState), "StatCounter");

  // 2. CodeBlock: terminal commands, functions, syntax
  const codeState: JevDecisionState = {
    visual: "Terminal prompt executing bash command",
    narration: "Run git checkout -b feature to start your new branch.",
    onscreen: ["`git checkout -b feature`"],
  };
  assert.equal(heuristicPrimitiveSelection(codeState), "CodeBlock");

  // 3. ProgressBar: steps, phases, progress, completion
  const progressState: JevDecisionState = {
    visual: "Progress indicator filling across the frame",
    narration: "Step 3 of 5 is now complete, validating the intermediate checksums.",
    onscreen: ["Step 3 of 5: Validation"],
  };
  assert.equal(heuristicPrimitiveSelection(progressState), "ProgressBar");

  // 4. Divider: separation rule, boundaries, transition line
  const dividerState: JevDecisionState = {
    visual: "A thin hairline rule separating the two major phases",
    narration: "With the intake phase complete, we cross into the synthesis pipeline.",
    onscreen: ["Phase Shift"],
  };
  assert.equal(heuristicPrimitiveSelection(dividerState), "Divider");

  // 5. IconLabel: status badge, metadata pill, tag
  const iconState: JevDecisionState = {
    visual: "A compact status pill with an icon badge",
    onscreen: ["Status: Verified"],
  };
  assert.equal(heuristicPrimitiveSelection(iconState), "IconLabel");

  // 6. Card: structured container with multiple lines
  const cardState: JevDecisionState = {
    visual: "A glassmorphic container card grouping configuration flags",
    onscreen: ["Config Overview", "Timeout: 400ms", "Retries: 3"],
  };
  assert.equal(heuristicPrimitiveSelection(cardState), "Card");

  // 7. TextReveal: standard typography, spoken thesis, titles
  const textState: JevDecisionState = {
    narration: "The core principle of distributed consensus is fault tolerance.",
    onscreen: ["Distributed Consensus"],
  };
  assert.equal(heuristicPrimitiveSelection(textState), "TextReveal");
});

test("Jev: confidence gating accepts high-confidence complex primitives", () => {
  const answer: JevChoiceAnswer = {
    choice: "StatCounter",
    confidence: 0.88,
    probabilities: { StatCounter: 0.88, TextReveal: 0.12 },
  };
  const state: JevDecisionState = {
    narration: "The system scaled to 100k requests per second.",
    onscreen: ["100k req/s"],
  };

  const result = applyConfidenceGating(answer, state);
  assert.equal(result.primitive, "StatCounter");
  assert.equal(result.source, "jev");
  assert.equal(result.confidence, 0.88);
});

test("Jev: confidence gating falls back to safe generic primitive on low confidence for complex choices", () => {
  // Low confidence on complex primitive (CodeBlock at 0.52 < 0.65 threshold)
  const answer: JevChoiceAnswer = {
    choice: "CodeBlock",
    confidence: 0.52,
    probabilities: { CodeBlock: 0.52, TextReveal: 0.48 },
  };

  // Single onscreen line -> falls back to TextReveal
  const singleLineState: JevDecisionState = {
    narration: "Maybe this looks like a script call.",
    onscreen: ["Execution call"],
  };
  const result1 = applyConfidenceGating(answer, singleLineState);
  assert.equal(result1.primitive, "TextReveal");
  assert.equal(result1.source, "confidence-fallback");
  assert.ok(result1.fallbackReason?.includes("Low confidence"));

  // Multi-line onscreen -> falls back to Card
  const multiLineState: JevDecisionState = {
    narration: "Here are the parameters and options.",
    onscreen: ["Execution Options", "Param A", "Param B"],
  };
  const result2 = applyConfidenceGating(answer, multiLineState);
  assert.equal(result2.primitive, "Card");
  assert.equal(result2.source, "confidence-fallback");
});

test("Jev: confidence gating falls back to heuristic when confidence is below minimum threshold", () => {
  const answer: JevChoiceAnswer = {
    choice: "TextReveal",
    confidence: 0.25, // Below DEFAULT_MIN_CONFIDENCE_THRESHOLD (0.40)
    probabilities: { TextReveal: 0.25 },
  };
  const state: JevDecisionState = {
    narration: "We measured a 10x latency speedup.",
    onscreen: ["10x Speedup"],
  };

  const result = applyConfidenceGating(answer, state);
  // Heuristic detects 10x speedup -> StatCounter
  assert.equal(result.primitive, "StatCounter");
  assert.equal(result.source, "confidence-fallback");
  assert.ok(result.fallbackReason?.includes("below minimum threshold"));
});

test("Jev: selectPrimitive uses mock handler cleanly without live network requests", async () => {
  setMockJevHandler(async (state): Promise<JevChoiceAnswer> => {
    if (state.visual?.includes("code")) {
      return {
        choice: "CodeBlock",
        confidence: 0.95,
        probabilities: { CodeBlock: 0.95, TextReveal: 0.05 },
      };
    }
    return {
      choice: "TextReveal",
      confidence: 0.90,
      probabilities: { TextReveal: 0.90 },
    };
  });

  try {
    const res1 = await selectPrimitive({
      visual: "A terminal code block",
      narration: "Inspect the output below.",
      onscreen: ["const x = 1;"],
    });
    assert.equal(res1.primitive, "CodeBlock");
    assert.equal(res1.source, "jev");
    assert.equal(res1.confidence, 0.95);

    const res2 = await selectPrimitive({
      visual: "Clean wide title card",
      narration: "Welcome to the overview.",
      onscreen: ["Overview"],
    });
    assert.equal(res2.primitive, "TextReveal");
    assert.equal(res2.source, "jev");
  } finally {
    clearMockJevHandler();
  }
});

test("Jev: selectPrimitive falls back deterministically when no API key is set in options or env", async () => {
  clearMockJevHandler();

  // Explicit empty apiKey overrides env
  const result = await selectPrimitive(
    {
      narration: "A 95% reduction in memory consumption was recorded.",
      onscreen: ["95% Reduction"],
    },
    { apiKey: "" },
  );

  assert.equal(result.primitive, "StatCounter");
  assert.equal(result.source, "heuristic-fallback");
  assert.ok(result.fallbackReason?.includes("No Jev API key"));
});

test("Jev: selectPrimitive catches network error and falls back gracefully", async () => {
  clearMockJevHandler();

  // Inject a custom failing fetchFn
  const failingFetch: typeof fetch = async () => {
    throw new Error("Connection refused (simulated offline)");
  };

  const result = await selectPrimitive(
    {
      narration: "Progress across the multi-stage compiler pipeline.",
      onscreen: ["Pipeline Stages"],
    },
    {
      apiKey: "dummy_test_key",
      fetchFn: failingFetch,
    },
  );

  assert.equal(result.primitive, "ProgressBar");
  assert.equal(result.source, "heuristic-fallback");
  assert.ok(result.fallbackReason?.includes("Connection refused"));
});

test("Jev: selectScenePrimitives tracks active components and maps screenplay scenes", async () => {
  const screenplay = `## 0:00-0:10 - Overview
[VISUAL]
Clean title card introducing the architecture.
[NARRATION]
In this guide we explore deep learning architectures.
[ON SCREEN]
Deep Learning Architectures

## 0:10-0:25 - Metrics
[VISUAL]
Animated numerical readout of latency.
[NARRATION]
Our benchmark achieved a 12x throughput gain.
[ON SCREEN]
12x Throughput Gain

## 0:25-0:40 - Terminal
[VISUAL]
Code snippet showing command execution.
[NARRATION]
Simply run the training script via python train.py.
[ON SCREEN]
\`python train.py --epochs 100\`
`;

  const segments = parseClaudeScript(screenplay);
  assert.equal(segments.length, 3);

  // Use mocked Jev to verify activeComponents tracking and selection
  const capturedStates: JevDecisionState[] = [];
  setMockJevHandler(async (state): Promise<JevChoiceAnswer> => {
    capturedStates.push(state);
    if (state.onscreen?.some((t) => t.includes("12x"))) {
      return { choice: "StatCounter", confidence: 0.92, probabilities: { StatCounter: 0.92 } };
    }
    if (state.onscreen?.some((t) => t.includes("train.py"))) {
      return { choice: "CodeBlock", confidence: 0.89, probabilities: { CodeBlock: 0.89 } };
    }
    return { choice: "TextReveal", confidence: 0.90, probabilities: { TextReveal: 0.90 } };
  });

  try {
    const decisions = await selectScenePrimitives(segments);
    assert.equal(decisions.size, 3);

    const shot1Decision = decisions.get("overview");
    assert.equal(shot1Decision?.primitive, "TextReveal");

    const shot2Decision = decisions.get("metrics");
    assert.equal(shot2Decision?.primitive, "StatCounter");

    const shot3Decision = decisions.get("terminal");
    assert.equal(shot3Decision?.primitive, "CodeBlock");

    // Verify activeComponents chained across scenes
    assert.equal(capturedStates.length, 3);
    assert.deepEqual(capturedStates[0].activeComponents, []);
    assert.deepEqual(capturedStates[1].activeComponents, ["TextReveal"]);
    assert.deepEqual(capturedStates[2].activeComponents, ["TextReveal", "StatCounter"]);
  } finally {
    clearMockJevHandler();
  }
});

test("Jev: buildFilmPartsFromScriptAsync produces conforming Remotion shots with Jev decisions", async () => {
  const screenplay = `## 0:00-0:15 - INTRO
[VISUAL]
Terminal prompt executing the install script.
[NARRATION]
Let us set up the environment in seconds.
[ON SCREEN]
\`npm install @typesafe-ai/sdk\`
`;

  setMockJevHandler(async () => ({
    choice: "CodeBlock",
    confidence: 0.93,
    probabilities: { CodeBlock: 0.93 },
  }));

  try {
    const result = await buildFilmPartsFromScriptAsync(screenplay, 15);
    assert.equal(result.shots.length, 1);
    const shot = result.shots[0];
    assert.equal(shot.dur, 15);

    // Conforms to Remotion shot schema
    assert.doesNotThrow(() => shotSchema.parse(shot), "Shot must pass shotSchema validation");

    // The shot blocks contain the selected CodeBlock primitive
    assert.ok(shot.blocks.some((b) => b.c === "CodeBlock"));
  } finally {
    clearMockJevHandler();
  }
});

test("Jev: buildBlocksForPrimitive builds valid blocks for all 7 primitives", () => {
  const group = {
    onscreen: ["Headline", "Secondary details", "Run `npm test` now"],
    visual: "Visual prompt text",
    narration: "Spoken text with 50% gain and 5x multiplier.",
  };

  for (const prim of ANIMATED_PRIMITIVES) {
    const blocks = buildBlocksForPrimitive(prim, group, "Fallback Title");
    assert.ok(blocks.length > 0, `Primitive ${prim} must generate at least one block`);
    assert.ok(
      blocks.some((b) => b.c === prim),
      `Blocks for ${prim} must contain a block with c = "${prim}"`,
    );
  }
});

test("Jev: synchronous buildFilmPartsFromScript uses deterministic heuristic and conforms to schema", () => {
  const script = `## 0:00-0:10 - Hook
[VISUAL]
A numerical counter showing rapid gain.
[NARRATION]
Throughput increased by 10x in tests.
[ON SCREEN]
10x Speedup
`;

  const parts = buildFilmPartsFromScript(script, 10, { usePrimitives: true });
  assert.equal(parts.shots.length, 1);
  const shot = parts.shots[0];

  assert.doesNotThrow(() => shotSchema.parse(shot), "Shot must conform to shotSchema");
  assert.ok(shot.blocks.some((b) => b.c === "StatCounter"));
});

test("Jev: getJevModel resolves jev-latest for the direct TypeSafe endpoint", () => {
  assert.equal(DEFAULT_JEV_MODEL, "jev-latest");
  assert.equal(getJevModel(TYPESAFE_ENDPOINT), "jev-latest");
});

test("Jev: getJevModel resolves typesafe/jev-1.13 only for the OpenRouter endpoint", () => {
  assert.equal(OPENROUTER_JEV_MODEL, "typesafe/jev-1.13");
  assert.equal(getJevModel(OPENROUTER_DECISIONS_ENDPOINT), "typesafe/jev-1.13");
});

test("Jev: getJevModel honors an explicit JEV_MODEL / TYPESAFE_MODEL env override on either endpoint", () => {
  const originalJevModel = process.env.JEV_MODEL;
  process.env.JEV_MODEL = "jev-custom";
  try {
    assert.equal(getJevModel(TYPESAFE_ENDPOINT), "jev-custom");
    assert.equal(getJevModel(OPENROUTER_DECISIONS_ENDPOINT), "jev-custom");
  } finally {
    if (originalJevModel === undefined) delete process.env.JEV_MODEL;
    else process.env.JEV_MODEL = originalJevModel;
  }
});

test("Jev: selectPrimitive logs a non-silent warning and still falls back when a live call fails", async () => {
  const originalKey = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "test-key";
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (msg: string) => {
    warnings.push(msg);
  };

  try {
    const result = await selectPrimitive(
      { visual: "A rat in a maze", narration: "The rat explores." },
      {
        fetchFn: (async () =>
          new Response(JSON.stringify({ error: { message: "Unknown model: bad-model" } }), {
            status: 400,
          })) as unknown as typeof fetch,
      },
    );

    assert.equal(result.source, "heuristic-fallback");
    assert.ok(
      warnings.some((w) => w.includes("selectPrimitive") && w.includes("falling back to heuristic")),
      "A failed live Jev call must log a warning, not fail silently",
    );
  } finally {
    console.warn = originalWarn;
    if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = originalKey;
  }
});

test("Jev: buildBlocksForPrimitive never invents a counter, snippet or bar the beat does not carry", () => {
  const bare = { onscreen: ["Just words"], narration: "Nothing quantitative is said here." };
  for (const prim of ["StatCounter", "CodeBlock", "ProgressBar"] as const) {
    const blocks = buildBlocksForPrimitive(prim, bare, "Title");
    assert.ok(blocks.every((b) => b.c === "TextReveal"), `${prim} must fall back to the text card`);
  }
});
