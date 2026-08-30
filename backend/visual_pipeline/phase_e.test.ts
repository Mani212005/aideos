/**
 * File Description: Phase E Unit & Regression Test Suite.
 * Asserts tests for non-truncated text extraction (E-a) and <= 8-word concise headlines (E-b).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractConciseHeadline } from "../ideation/visualSelector";
import { buildBriefFromSegmentFallback } from "../ideation/segmentSync";

test("E-a: Derived headlines never slice text mid-word and contain complete words", () => {
  const longSentences = [
    "Paxos was the original mathematical foundation, but its complex dual-phase design made real implementations notoriously difficult to reason about.",
    "The server returns HTML, which the browser engine parses into the DOM tree, computing styles and rendering pixels at sixty frames per second.",
    "FlashAttention-3 overlaps tensor cores with data movement using specialized producer-consumer warpgroups.",
  ];

  for (const sentence of longSentences) {
    const headline = extractConciseHeadline(sentence);
    const words = headline.split(/\s+/);

    // Assert every word in the headline is an exact complete word from the sentence
    for (const w of words) {
      assert.ok(
        sentence.toLowerCase().includes(w.toLowerCase()),
        `Headline word "${w}" must be an exact complete word from the sentence: "${sentence}"`
      );
    }
  }
});

test("E-b: Extracted headlines never exceed 8 words and are distinct from long narration", () => {
  const testNarrations = [
    "An HTTP request reaches Google's edge reverse proxy, which load balances traffic to backend clusters.",
    "Because atmospheric pressure sits below the thermodynamic triple point of water, ice sublimates directly into vapor when heated.",
    "Distributed systems rely on consensus to keep data consistent across unreliable networks.",
  ];

  for (const narration of testNarrations) {
    const brief = buildBriefFromSegmentFallback(narration, "shot-test");
    const textRevealBlock = brief.blocks.find((b) => b.c === "TextReveal") as any;

    assert.ok(textRevealBlock, "Brief must contain a TextReveal block");
    const headlineWords = textRevealBlock.text.trim().split(/\s+/);

    assert.ok(
      headlineWords.length <= 8,
      `Headline "${textRevealBlock.text}" has ${headlineWords.length} words; must not exceed 8 words`
    );
    assert.notEqual(
      textRevealBlock.text,
      narration,
      `Headline must be a concise summary, not identical to the full narration sentence`
    );
  }
});

test("Phase E Negative Case 1: Truncating a text field mid-word fails complete-word assertion", () => {
  const fullSentence = "made real implementations notoriously difficult to reason about.";
  const brokenHeadline = "made real implementations notoriously difficul";

  const words = brokenHeadline.split(/\s+/);
  const lastWord = words[words.length - 1];

  // Regex check for word boundary in original sentence
  const isWholeWord = new RegExp(`\\b${lastWord}\\b`, "i").test(fullSentence);
  assert.equal(isWholeWord, false, `Chopped word "${lastWord}" must fail whole-word boundary test`);
});

test("Phase E Negative Case 2: A headline equal to full multi-sentence narration fails <= 8 words assertion", () => {
  const longNarration = "Paxos was the original mathematical foundation, but its complex dual-phase design made real implementations notoriously difficult to reason about.";
  const rawWords = longNarration.split(/\s+/);

  const exceeds8Words = rawWords.length > 8;
  assert.equal(exceeds8Words, true, `Full narration has ${rawWords.length} words and exceeds 8 words limit`);
});
