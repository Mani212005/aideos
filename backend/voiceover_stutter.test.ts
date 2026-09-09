/**
 * File Description: Regression unit tests for voiceover stutter bug fixes covering chunking thresholds, silence trimming, and shot-scoped segment mapping.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  chunkTextForTTS,
  trimSilence,
  splitScriptIntoSegments,
} from "./audio";

// Unit test verifying that normal multi-sentence shots up to 800 chars are not sliced into sub-chunks
test("chunkTextForTTS: preserves multi-sentence shot within 800-char threshold as a single chunk", () => {
  const shotText =
    "Meet Yann LeCun, the pioneer Meta hired to lead its artificial intelligence lab. " +
    "While the tech industry went all in on chatbots, he has been arguing the one thing almost nobody wanted to hear: " +
    "LLMs are a dead end that will never achieve real physical understanding.";

  assert.ok(shotText.length > 220, "Shot text length exceeds old 220-char threshold");
  assert.ok(shotText.length < 800, "Shot text length is within new 800-char threshold");

  const chunks = chunkTextForTTS(shotText, 800);
  assert.equal(chunks.length, 1, "Expected single chunk for normal multi-sentence shot");
  assert.equal(chunks[0], shotText);
});

// Unit test verifying that text genuinely exceeding 800 chars splits cleanly at sentence boundaries
test("chunkTextForTTS: splits text exceeding maxChars at sentence boundaries", () => {
  const sentence1 = "A".repeat(500) + ".";
  const sentence2 = "B".repeat(400) + ".";
  const longParagraph = `${sentence1} ${sentence2}`;

  assert.ok(longParagraph.length > 800, "Paragraph exceeds 800 chars");

  const chunks = chunkTextForTTS(longParagraph, 800);
  assert.equal(chunks.length, 2, "Expected 2 chunks split at sentence boundary");
  assert.equal(chunks[0], sentence1);
  assert.equal(chunks[1], sentence2);
});

// Unit test verifying that an unpunctuated sentence or starting block exceeding maxChars is chunked into word-level pieces
test("chunkTextForTTS: splits unpunctuated text exceeding maxChars into sub-chunks", () => {
  const longSentence = "word ".repeat(250).trim(); // ~1250 chars without sentence punctuation
  assert.ok(longSentence.length > 800);

  const chunks = chunkTextForTTS(longSentence, 800);
  assert.ok(chunks.length >= 2, "Expected at least 2 chunks");
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 800, `Chunk length ${chunk.length} should not exceed 800`);
  }
  assert.equal(chunks.join(" "), longSentence);
});

// Unit test verifying that trimSilence strips leading and trailing zero-amplitude and low-noise samples
test("trimSilence: trims leading and trailing silence below amplitude threshold", () => {
  const leadingSilence = new Float32Array(7535); // ~314ms at 24kHz
  leadingSilence.fill(0.0001);

  const activeSpeech = new Float32Array(24000); // 1.0s active speech
  for (let i = 0; i < activeSpeech.length; i++) {
    activeSpeech[i] = 0.1 + Math.sin((i + 1) / 10) * 0.4;
  }

  const trailingSilence = new Float32Array(16556); // ~690ms at 24kHz
  trailingSilence.fill(-0.0001);

  const rawBuffer = new Float32Array(leadingSilence.length + activeSpeech.length + trailingSilence.length);
  rawBuffer.set(leadingSilence, 0);
  rawBuffer.set(activeSpeech, leadingSilence.length);
  rawBuffer.set(trailingSilence, leadingSilence.length + activeSpeech.length);

  const trimmed = trimSilence(rawBuffer, 0.005);
  assert.equal(trimmed.length, activeSpeech.length, "Trimmed buffer length should match active speech length");
  assert.ok(Math.abs(trimmed[0]) > 0.005, "First sample should be active speech above threshold");
  assert.ok(Math.abs(trimmed[trimmed.length - 1]) > 0.005, "Last sample should be active speech above threshold");
});

// Unit test verifying that trimSilence returns an empty buffer when passed all-silence samples
test("trimSilence: handles all-silence buffers cleanly", () => {
  const allSilence = new Float32Array(1000);
  allSilence.fill(0.00001);

  const trimmed = trimSilence(allSilence, 0.005);
  assert.equal(trimmed.length, 0, "All-silence buffer should trim to empty Float32Array");
});

// Unit test verifying shot-scoped 1:1 segment mapping for multi-sentence shots
test("splitScriptIntoSegments: maintains 1:1 shot mapping without slicing on internal sentence periods", () => {
  const shot1 = "First sentence of shot 1. Second sentence of shot 1! Third sentence of shot 1?";
  const shot2 = "First sentence of shot 2. Second sentence of shot 2.";
  const scriptInput = [shot1, shot2];

  const segments = splitScriptIntoSegments(scriptInput);
  assert.equal(segments.length, 2, "Segments array length must equal input shot count exactly");
  assert.equal(segments[0], shot1);
  assert.equal(segments[1], shot2);
});
