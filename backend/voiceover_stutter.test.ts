/**
 * File Description: Regression unit tests for voiceover stutter bug fixes covering chunking thresholds, silence trimming, shot-scoped segment mapping, and screenplay word partitioning.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  chunkTextForTTS,
  trimSilence,
  splitScriptIntoSegments,
  syncWordsIntoScreenplay,
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

// Unit test verifying that syncWordsIntoScreenplay partitions words per scene and preserves screenplay structure
test("syncWordsIntoScreenplay: partitions edited words back into original per-scene VO tags without destroying other tags", () => {
  const screenplay = [
    "# Film Title",
    "",
    "## Scene 1 (the-hook)",
    "**VISUAL:** Graph animation with neon nodes.",
    "**ON-SCREEN TEXT:** JEPA Architecture",
    "**VO:** Meet Yann LeCun, Meta pioneer. He argues LLMs are a dead end.",
    "",
    "## Scene 2 (who-is-lecun)",
    "**VISUAL:** Split screen comparing LLMs vs human toddler.",
    "**VO:** A French American computer scientist, LeCun won Turing Award.",
    "",
    "## Scene 3 (the-close)",
    "**VISUAL:** World model simulation.",
    "**VO:** World models predict representations instead of raw pixels.",
  ].join("\n");

  const words = [
    // Scene 0 words (Scene 1)
    { punctuated: "Meet", sceneIndex: 0 },
    { punctuated: "Yann", sceneIndex: 0 },
    { punctuated: "LeCun,", sceneIndex: 0 },
    { punctuated: "Meta", sceneIndex: 0 },
    { punctuated: "chief", sceneIndex: 0 },
    { punctuated: "scientist.", sceneIndex: 0 },
    { punctuated: "He", sceneIndex: 0 },
    { punctuated: "argues", sceneIndex: 0 },
    { punctuated: "LLMs", sceneIndex: 0 },
    { punctuated: "are", sceneIndex: 0 },
    { punctuated: "limited.", sceneIndex: 0 },

    // Scene 1 words (Scene 2)
    { punctuated: "A", sceneIndex: 1 },
    { punctuated: "NYU", sceneIndex: 1 },
    { punctuated: "professor,", sceneIndex: 1 },
    { punctuated: "LeCun", sceneIndex: 1 },
    { punctuated: "won", sceneIndex: 1 },
    { punctuated: "the", sceneIndex: 1 },
    { punctuated: "2018", sceneIndex: 1 },
    { punctuated: "Turing", sceneIndex: 1 },
    { punctuated: "Award.", sceneIndex: 1 },

    // Scene 2 words (Scene 3)
    { punctuated: "World", sceneIndex: 2 },
    { punctuated: "models", sceneIndex: 2 },
    { punctuated: "predict", sceneIndex: 2 },
    { punctuated: "meaning", sceneIndex: 2 },
    { punctuated: "directly.", sceneIndex: 2 },
  ];

  const updatedScreenplay = syncWordsIntoScreenplay(screenplay, words);

  // Assertions: All 3 scenes and their visual tags must be completely preserved
  assert.ok(updatedScreenplay.includes("## Scene 1 (the-hook)"), "Scene 1 header must be preserved");
  assert.ok(updatedScreenplay.includes("## Scene 2 (who-is-lecun)"), "Scene 2 header must be preserved");
  assert.ok(updatedScreenplay.includes("## Scene 3 (the-close)"), "Scene 3 header must be preserved");
  assert.ok(updatedScreenplay.includes("**VISUAL:** Graph animation with neon nodes."), "Scene 1 visual must be preserved");
  assert.ok(updatedScreenplay.includes("**VISUAL:** Split screen comparing LLMs vs human toddler."), "Scene 2 visual must be preserved");
  assert.ok(updatedScreenplay.includes("**VISUAL:** World model simulation."), "Scene 3 visual must be preserved");

  // Assertions: VO tags must contain only the partitioned words for their respective scene
  assert.ok(
    updatedScreenplay.includes("**VO:** Meet Yann LeCun, Meta chief scientist. He argues LLMs are limited."),
    "Scene 1 VO should be updated with Scene 1 words only",
  );
  assert.ok(
    updatedScreenplay.includes("**VO:** A NYU professor, LeCun won the 2018 Turing Award."),
    "Scene 2 VO should be updated with Scene 2 words only",
  );
  assert.ok(
    updatedScreenplay.includes("**VO:** World models predict meaning directly."),
    "Scene 3 VO should be updated with Scene 3 words only",
  );
});
