/**
 * File Description: Unit tests for the Claude screenplay intake parser/serializer, zero-leakage
 * narration extraction, and sub-shot compilation in backend/scriptIntake.ts, plus its wiring into
 * backend/audio.ts's segment splitting.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseClaudeScript,
  serializeSegmentsToScript,
  extractSpokenBlocks,
  buildFilmPartsFromScript,
  hasScreenplayTags,
} from "./scriptIntake";
import { splitScriptIntoSegments } from "./audio";
import { shotSchema, nodeSchema } from "../src/dl/schema";

const MIXED_ORDER_SCRIPT = `## 0:00-0:20 - HOOK

[VISUAL]
Slow push in on a dark terminal window, cursor blinking.

[NARRATION]
Every second your model waits on a cold cache costs you money and patience.

[ON SCREEN]
KV Cache: The Hidden Cost

[NARRATION]
Today we fix that, one block at a time.

*(Narration word count: ~24 words)*

## 0:20-0:55 - THE PROBLEM

[NARRATION]
Without caching, every new token forces the model to replay the entire conversation from scratch.

[VISUAL]
Split screen: naive recomputation on the left, cached lookup on the right.

[ON SCREEN]
O(n) becomes O(n^2)
`;

test("parses a multi-beat Claude script with mixed VISUAL/NARRATION/ON SCREEN order and strips word-count notes", () => {
  const segments = parseClaudeScript(MIXED_ORDER_SCRIPT);
  assert.equal(segments.length, 2);

  const hook = segments[0];
  assert.equal(hook.title, "HOOK");
  assert.equal(hook.timeStart, "0:00");
  assert.equal(hook.timeEnd, "0:20");
  assert.deepEqual(
    hook.beats.map((b) => b.type),
    ["visual", "narration", "onscreen", "narration"],
  );
  assert.equal(hook.beats[1].text, "Every second your model waits on a cold cache costs you money and patience.");
  assert.equal(hook.beats[2].text, "KV Cache: The Hidden Cost");
  assert.equal(hook.beats[3].text, "Today we fix that, one block at a time.");
  assert.ok(!hook.beats.some((b) => /word count/i.test(b.text)), "word-count note leaked into a beat");

  const problem = segments[1];
  assert.equal(problem.title, "THE PROBLEM");
  assert.deepEqual(
    problem.beats.map((b) => b.type),
    ["narration", "visual", "onscreen"],
  );
});

test("supports an explicit (slug) id in the segment header", () => {
  const segments = parseClaudeScript(`## Scene 1 (intro-scene)\n\n[NARRATION]\nWelcome.\n`);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].id, "intro-scene");
  assert.equal(segments[0].title, "Scene 1");
});

test("supports legacy VO:/Voiceover:/Narrator:/VISUAL:/ON-SCREEN TEXT: conventions", () => {
  const legacy = `## Legacy Scene

VISUAL: A wide shot of the office.

VO: This is the legacy narration line.

ON-SCREEN TEXT: Legacy Headline

Narrator: A second legacy narration line follows.
`;
  const segments = parseClaudeScript(legacy);
  assert.equal(segments.length, 1);
  assert.deepEqual(
    segments[0].beats.map((b) => b.type),
    ["visual", "narration", "onscreen", "narration"],
  );
  assert.equal(segments[0].beats[1].text, "This is the legacy narration line.");
  assert.equal(segments[0].beats[3].text, "A second legacy narration line follows.");
});

test("roundtrips parse -> serialize -> parse into an equivalent structured segment list", () => {
  const parsedOnce = parseClaudeScript(MIXED_ORDER_SCRIPT);
  const serialized = serializeSegmentsToScript(parsedOnce);
  const parsedTwice = parseClaudeScript(serialized);
  assert.deepEqual(parsedTwice, parsedOnce);

  // Serialized markdown stays canonical: bracket tags, no stray word-count notes.
  assert.ok(serialized.includes("[VISUAL]"));
  assert.ok(serialized.includes("[NARRATION]"));
  assert.ok(serialized.includes("[ON SCREEN]"));
  assert.ok(!/word count/i.test(serialized));
});

test("extractSpokenBlocks contains zero visual or on-screen vocabulary", () => {
  const script = `## 0:00-0:15 - INTRO

[VISUAL]
A kaleidoscope of rotating gears fills the frame.

[NARRATION]
Caching turns repeated work into a single lookup.

[ON SCREEN]
OVERLAY_HEADLINE_TOKEN

[NARRATION]
That lookup is nearly instant.
`;
  const spoken = extractSpokenBlocks(script);
  assert.deepEqual(spoken, [
    "Caching turns repeated work into a single lookup.",
    "That lookup is nearly instant.",
  ]);

  const joined = spoken.join(" ");
  assert.ok(!joined.includes("kaleidoscope"), "visual vocabulary leaked into spoken dialogue");
  assert.ok(!joined.includes("OVERLAY_HEADLINE_TOKEN"), "on-screen vocabulary leaked into spoken dialogue");
});

test("falls back to paragraph splitting for untagged free-form prose", () => {
  const prose = "Welcome to Aideos.\n\nWe build explainer videos as data.";
  assert.equal(hasScreenplayTags(prose), false);
  assert.deepEqual(extractSpokenBlocks(prose), ["Welcome to Aideos.", "We build explainer videos as data."]);
});

const SUBSHOT_SCRIPT = `## 0:00-0:20 - HOOK

[VISUAL]
Camera pushes into a glowing terminal.

[NARRATION]
This is the hook line one.

[ON SCREEN]
Big Headline

[NARRATION]
This is the hook line two.

## 0:20-0:40 - CONTEXT

[VISUAL]
Wide establishing shot of the whiteboard.

[NARRATION]
Just one single narration beat here.
`;

test("splits a multi-narration segment into alternating-move sub-shots, leaves single-narration segments unsplit", () => {
  const parts = buildFilmPartsFromScript(SUBSHOT_SCRIPT);

  assert.equal(parts.shots.length, 3);
  assert.equal(parts.nodes.length, 2);
  assert.equal(parts.edges.length, 1);

  const [hook1, hook2, context] = parts.shots;

  // Sub-shot ids follow the ${slug}-1 / ${slug}-2 convention only when split.
  assert.equal(hook1.id, "hook-1");
  assert.equal(hook2.id, "hook-2");
  assert.equal(context.id, "context");

  // The very first shot of the film must be "cut"; later sub-shots alternate pan/zoom-out.
  assert.equal(hook1.move, "cut");
  assert.equal(hook2.move, "zoom-out");
  assert.equal(context.move, "pan");

  // On-screen text becomes a TextReveal block on the sub-shot it was declared in.
  assert.ok(hook1.blocks.some((b) => b.c === "TextReveal" && b.text === "Big Headline" && b.size === "headline"));

  // A later sub-shot with no ON SCREEN of its own carries the visual direction forward
  // and falls back to the segment title for its headline.
  assert.equal(hook2.visualDirection, "Camera pushes into a glowing terminal.");
  assert.ok(hook2.blocks.some((b) => b.c === "TextReveal" && b.text === "HOOK"));

  assert.equal(hook1.scriptText, "This is the hook line one.");
  assert.equal(hook2.scriptText, "This is the hook line two.");
  assert.equal(context.scriptText, "Just one single narration beat here.");
  assert.equal(context.visualDirection, "Wide establishing shot of the whiteboard.");

  // look always references the parent segment's canvas node.
  assert.equal(hook1.look, "hook");
  assert.equal(hook2.look, "hook");
  assert.equal(context.look, "context");
});

test("a segment with no narration still produces one shot with a default duration and no scriptText", () => {
  const parts = buildFilmPartsFromScript(`## Only Visuals

[VISUAL]
A static diagram of the architecture.

[ON SCREEN]
Architecture Overview
`);
  assert.equal(parts.shots.length, 1);
  const shot = parts.shots[0];
  assert.equal(shot.scriptText, undefined);
  assert.equal(shot.dur, 4);
  assert.ok(shot.blocks.some((b) => b.c === "TextReveal" && b.text === "Architecture Overview"));
});

test("generated shots and nodes validate against the Film schema's shotSchema and nodeSchema", () => {
  const parts = buildFilmPartsFromScript(SUBSHOT_SCRIPT);
  for (const shot of parts.shots) {
    assert.doesNotThrow(() => shotSchema.parse(shot), `shot ${shot.id} failed schema validation`);
  }
  for (const node of parts.nodes) {
    assert.doesNotThrow(() => nodeSchema.parse(node), `node ${node.id} failed schema validation`);
  }

  const totalDur = parts.shots.reduce((sum, s) => sum + s.dur, 0);
  assert.ok(totalDur >= 0.5, "total shot duration should be positive");
});

test("splitScriptIntoSegments (backend/audio.ts) segments a Claude-tagged script strictly by narration, with zero visual/on-screen leakage", () => {
  const script = `## 0:00-0:15 - INTRO

[VISUAL]
A kaleidoscope of rotating gears fills the frame.

[NARRATION]
Caching turns repeated work into a single lookup.

[ON SCREEN]
OVERLAY_HEADLINE_TOKEN

[NARRATION]
That lookup is nearly instant.
`;
  const segments = splitScriptIntoSegments(script);
  assert.equal(segments.length, 2);
  const joined = segments.join(" ");
  assert.ok(!joined.includes("kaleidoscope"));
  assert.ok(!joined.includes("OVERLAY_HEADLINE_TOKEN"));

  // Untagged scripts keep the original blank-line paragraph behavior.
  const untagged = "Welcome to Aideos.\n\nWe build explainer videos as data.";
  assert.deepEqual(splitScriptIntoSegments(untagged), [
    "Welcome to Aideos.",
    "We build explainer videos as data.",
  ]);
});

test("production notes sections are excluded entirely from parsed segments", () => {
  const script = `## 0:00-0:10 - HOOK

[NARRATION]
Only this line should survive.

## Production Notes

This entire section, including any [NARRATION] blocks, must be ignored.
`;
  const segments = parseClaudeScript(script);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].beats.length, 1);
  assert.equal(segments[0].beats[0].text, "Only this line should survive.");
});
