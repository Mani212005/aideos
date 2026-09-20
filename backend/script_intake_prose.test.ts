/**
 * File Description: Unit and regression tests for untagged prose parsing, heuristic structuring,
 * Director LLM screenplay transformation, and zero-shot error handling in backend/scriptIntake.ts
 * and backend/pipeline/director.ts.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseClaudeScript,
  hasScreenplayTags,
  structureUntaggedProseToScript,
  buildFilmPartsFromScript,
  buildFilmPartsFromScriptAsync,
  extractSpokenBlocks,
} from "./scriptIntake";
import {
  transformProseToScreenplay,
  type GenerateScreenplayFn,
} from "./pipeline/director";
import { shotSchema, nodeSchema } from "../src/dl/schema";

const TAGGED_SCREENPLAY = `# Speculative Decoding

## 0:00-0:15 - THE PROBLEM

[VISUAL]
A small draft model generating tokens at lightning speed next to a massive target model.

[ON SCREEN]
Speculative Decoding: 3x Faster Inference

[NARRATION]
Autoregressive LLM inference is strictly memory bandwidth bound. Every single token requires loading billions of weights.

## 0:15-0:35 - THE SOLUTION

[VISUAL]
Draft model generates five tokens, target model verifies them in parallel in a single forward pass.

[ON SCREEN]
Draft, Verify, Accept

[NARRATION]
Speculative decoding uses a lightweight draft model to speculate candidate tokens, then verifies them all at once.
`;

const UNTAGGED_PROSE_MULTI = `Autoregressive large language models are memory bandwidth bound. Every single generated token requires reading billions of parameters from high bandwidth memory into the compute cores.

Speculative decoding solves this by running a small, fast draft model ahead of the large target model. The draft model speculates several candidate tokens quickly.

Then, the target model verifies all candidate tokens simultaneously in a single forward pass. If three tokens match, we get three tokens of progress in the time of one.`;

const UNTAGGED_PROSE_SINGLE = `KV Cache eviction reduces GPU memory footprint by discarding unimportant attention keys and values while preserving critical context.`;

test("hasScreenplayTags: accurately detects tagged screenplay vs untagged prose", () => {
  assert.equal(hasScreenplayTags(TAGGED_SCREENPLAY), true);
  assert.equal(hasScreenplayTags("## Scene 1\n\n[NARRATION]\nHello world.\n"), true);
  assert.equal(hasScreenplayTags("## Scene 1\n\nVO: Hello world.\n"), true);
  assert.equal(hasScreenplayTags("## Scene 1\n\nVISUAL: Showing a screen.\n"), true);

  assert.equal(hasScreenplayTags(UNTAGGED_PROSE_MULTI), false);
  assert.equal(hasScreenplayTags(UNTAGGED_PROSE_SINGLE), false);
  assert.equal(hasScreenplayTags(""), false);
  assert.equal(hasScreenplayTags("   \n\n  "), false);
});

test("parseClaudeScript: tagged screenplays parse into exact segments and beats", () => {
  const segments = parseClaudeScript(TAGGED_SCREENPLAY);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].title, "THE PROBLEM");
  assert.equal(segments[0].timeStart, "0:00");
  assert.equal(segments[0].timeEnd, "0:15");
  assert.deepEqual(
    segments[0].beats.map((b) => b.type),
    ["visual", "onscreen", "narration"],
  );
  assert.equal(segments[1].title, "THE SOLUTION");
});

test("structureUntaggedProseToScript: multi-paragraph prose produces structured scenes with visual directions and headlines", () => {
  const segments = structureUntaggedProseToScript(UNTAGGED_PROSE_MULTI);
  assert.equal(segments.length, 3);

  segments.forEach((seg, idx) => {
    assert.ok(seg.id, `Segment ${idx + 1} must have a valid slug id`);
    assert.ok(seg.title.startsWith(`Scene ${idx + 1}:`), `Segment ${idx + 1} title should have Scene prefix`);
    assert.equal(seg.beats.length, 3, "Each structured scene should have visual, onscreen, and narration beats");
    assert.equal(seg.beats[0].type, "visual");
    assert.equal(seg.beats[1].type, "onscreen");
    assert.equal(seg.beats[2].type, "narration");
    assert.ok(seg.beats[0].text.length > 0, "Visual direction must not be empty");
    assert.ok(seg.beats[1].text.length > 0, "On-screen text must not be empty");
    assert.ok(seg.beats[2].text.length > 0, "Narration text must not be empty");
  });

  assert.ok(segments[0].beats[2].text.includes("Autoregressive large language models"));
  assert.ok(segments[1].beats[2].text.includes("Speculative decoding solves this"));
  assert.ok(segments[2].beats[2].text.includes("Then, the target model verifies"));
});

test("structureUntaggedProseToScript: single paragraph creates one clean structured scene", () => {
  const segments = structureUntaggedProseToScript(UNTAGGED_PROSE_SINGLE);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].beats.length, 3);
  assert.equal(segments[0].beats[2].text, UNTAGGED_PROSE_SINGLE);
  assert.ok(segments[0].beats[1].text.length <= 44, "On-screen headline should be punchy and bounded");
});

test("structureUntaggedProseToScript: empty or whitespace input returns empty array", () => {
  assert.deepEqual(structureUntaggedProseToScript(""), []);
  assert.deepEqual(structureUntaggedProseToScript("   \n\n\t  "), []);
});

test("extractSpokenBlocks: handles untagged prose and extracts spoken blocks correctly", () => {
  const blocks = extractSpokenBlocks(UNTAGGED_PROSE_MULTI);
  assert.equal(blocks.length, 3);
  assert.ok(blocks[0].includes("Autoregressive"));
  assert.ok(blocks[1].includes("Speculative decoding"));
  assert.ok(blocks[2].includes("Then, the target model"));
});

test("buildFilmPartsFromScript: compiles valid shots, nodes, and edges from untagged prose", () => {
  const result = buildFilmPartsFromScript(UNTAGGED_PROSE_MULTI, 30);
  assert.equal(result.shots.length, 3);
  assert.equal(result.nodes.length, 3);
  assert.equal(result.edges.length, 2);
  assert.ok(result.wordCount > 0);
  assert.ok(result.durationSec > 0);
  assert.ok(result.spokenText.includes("Speculative decoding"));

  result.shots.forEach((shot) => {
    assert.doesNotThrow(() => shotSchema.parse(shot), `Shot ${shot.id} should validate against shotSchema`);
    assert.ok(shot.dur > 0, "Shot duration must be positive");
    assert.ok(shot.blocks.length > 0, "Shot must contain generated primitive blocks");
  });

  result.nodes.forEach((node) => {
    assert.doesNotThrow(() => nodeSchema.parse(node), `Node ${node.id} should validate against nodeSchema`);
  });

  assert.equal(result.edges[0].from, result.nodes[0].id);
  assert.equal(result.edges[0].to, result.nodes[1].id);
  assert.equal(result.edges[1].from, result.nodes[1].id);
  assert.equal(result.edges[1].to, result.nodes[2].id);
});

test("buildFilmPartsFromScriptAsync: compiles valid film parts with primitive selection from untagged prose", async () => {
  const result = await buildFilmPartsFromScriptAsync(UNTAGGED_PROSE_MULTI);
  assert.equal(result.shots.length, 3);
  assert.equal(result.nodes.length, 3);
  assert.ok(result.decisions instanceof Map);
  assert.equal(result.decisions.size, 3);
});

test("buildFilmPartsFromScript: returns zero shots for empty string without throwing", () => {
  const result = buildFilmPartsFromScript("", 0);
  assert.equal(result.shots.length, 0);
  assert.equal(result.nodes.length, 0);
  assert.equal(result.edges.length, 0);
  assert.equal(result.wordCount, 0);
  assert.equal(result.durationSec, 0);
  assert.equal(result.spokenText, "");
});

test("transformProseToScreenplay: transforms untagged prose via mock generator", async () => {
  const mockGenerator: GenerateScreenplayFn = async (prose) => {
    return `# KV Cache Eviction

## Scene 1: The Bottleneck
[VISUAL] A timeline showing memory saturation.
[ON SCREEN] Memory Saturation
[NARRATION] ${prose.slice(0, 50)}

## Scene 2: The Solution
[VISUAL] Blocks evicted to maintain steady throughput.
[ON SCREEN] Eviction Strategy
[NARRATION] Discarding unimportant attention keys keeps inference fast.
`;
  };

  const drafted = await transformProseToScreenplay(UNTAGGED_PROSE_SINGLE, {
    generateScreenplay: mockGenerator,
    filmTitle: "KV Cache Eviction",
  });

  assert.equal(drafted.attempts, 1);
  assert.equal(drafted.title, "KV Cache Eviction");
  assert.ok(hasScreenplayTags(drafted.screenplay));
  const parsed = parseClaudeScript(drafted.screenplay);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].title, "Scene 1: The Bottleneck");
});

test("transformProseToScreenplay: strips surrounding markdown code fences from model output", async () => {
  const mockGenerator: GenerateScreenplayFn = async () => {
    return `\`\`\`markdown
# Fenced Screenplay

## Scene 1: Introduction
[VISUAL] Terminal cursor typing.
[ON SCREEN] Introduction
[NARRATION] This output was wrapped in a code fence by the model.
\`\`\``;
  };

  const drafted = await transformProseToScreenplay("Some input prose", {
    generateScreenplay: mockGenerator,
  });

  assert.equal(drafted.attempts, 1);
  assert.ok(!drafted.screenplay.startsWith("```"), "Screenplay should not start with a code fence");
  assert.ok(!drafted.screenplay.endsWith("```"), "Screenplay should not end with a code fence");
  const parsed = parseClaudeScript(drafted.screenplay);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, "Scene 1: Introduction");
});

test("transformProseToScreenplay: retries rejected draft with feedback and succeeds on retry", async () => {
  const reasonsSeen: Array<string | undefined> = [];
  const mockGenerator: GenerateScreenplayFn = async (_prose, reason) => {
    reasonsSeen.push(reason);
    if (reasonsSeen.length === 1) {
      return "just raw text with no tags at all";
    }
    return `# Retry Success

## Scene 1: Valid Scene
[VISUAL] Clear visual diagram.
[ON SCREEN] Success
[NARRATION] Now structured properly with narration.
`;
  };

  const drafted = await transformProseToScreenplay("Some raw prose", {
    generateScreenplay: mockGenerator,
    maxAttempts: 2,
  });

  assert.equal(drafted.attempts, 2);
  assert.equal(reasonsSeen[0], undefined);
  assert.ok(reasonsSeen[1] && reasonsSeen[1].length > 0);
  assert.equal(drafted.title, "Retry Success");
});

test("transformProseToScreenplay: throws error on empty prose input", async () => {
  await assert.rejects(
    () => transformProseToScreenplay("   "),
    /prose input cannot be empty/,
  );
});
