/**
 * File Description: Regression tests for the voiceover defect classes the production pipeline has
 * to stay clear of - chunk-boundary clicks, TTS silence padding pushing narration late, gaps that
 * do not match what the timeline was told, word timings drifting against the audio, sample-rate or
 * channel mismatches on concatenation, and truncated tails. Every assertion here is on real sample
 * data, because those defects are inaudible to a test that only checks a duration number.
 *
 * The live end-to-end synthesis check is gated behind RUN_TTS_TESTS=1, following the existing
 * RUN_VISUAL_TESTS pattern, so the default suite stays fast and offline.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import {
  chunkTextForTTS,
  trimSilence,
  splitScriptIntoSegments,
  buildCaptionsVtt,
  produceAudioPipeline,
  buildFilmFromAudioResult,
} from "./audio";
import {
  applyEdgeFades,
  assembleSegments,
  decodeWav,
  deriveShotDurations,
  distributeWordTimings,
  encodeWav,
  longestSilenceSec,
  maxSampleStep,
  normalizePeak,
  type AssembleOptions,
  type PcmChunk,
} from "./pcm";
import { buildTimeline } from "../src/dl/camera";

const SR = 24000;

const TEST_ASSEMBLE: AssembleOptions = {
  sampleRate: SR,
  segmentGapMs: 200,
  chunkGapMs: 100,
  fadeMs: 6,
  silenceThreshold: 0.005,
};

/** Builds a chunk of loud, continuous tone padded with the leading and trailing silence TTS adds. */
function paddedChunk(text: string, speechSec: number, padSec: number): PcmChunk {
  const pad = Math.round(padSec * SR);
  const speech = Math.round(speechSec * SR);
  const samples = new Float32Array(pad * 2 + speech);
  for (let i = 0; i < speech; i++) {
    // Start and end on a large non-zero value so an unfaded join would step audibly.
    samples[pad + i] = 0.8 * Math.cos((2 * Math.PI * 110 * i) / SR);
  }
  return { text, samples };
}

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

// Unit test verifying no narration is lost when a chunk is split for a small backend limit
test("chunkTextForTTS: loses no words when splitting for Kokoro's 300-char limit", () => {
  const paragraph =
    "A U-Net is a funnel. It squeezes the image down through a stack of convolutions, then expands " +
    "it back up, and it does that at every single denoising step. That shape was inherited from " +
    "medical image segmentation, where the job really was to compress and reconstruct. Diffusion " +
    "borrowed the architecture before anyone checked whether the funnel was doing useful work.";

  const chunks = chunkTextForTTS(paragraph, 300);
  assert.ok(chunks.length >= 2, "Expected the paragraph to split at Kokoro's limit");
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 300, `Chunk of ${chunk.length} chars exceeds the backend limit`);
  }
  assert.equal(
    chunks.join(" ").replace(/\s+/g, " "),
    paragraph.replace(/\s+/g, " "),
    "Rejoining the chunks must reproduce the narration exactly - no word may be dropped",
  );
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

// Regression test for the click a butt-joined trimmed chunk leaves at every stitch point
test("applyEdgeFades: ramps both edges to silence so a join cannot step", () => {
  const loud = new Float32Array(SR);
  loud.fill(0.8);

  const faded = applyEdgeFades(loud, SR, 6);
  assert.equal(faded.length, loud.length, "Fading must not change the sample count");
  assert.equal(faded[0], 0, "The first sample must be silent");
  assert.equal(faded[faded.length - 1], 0, "The last sample must be silent");
  assert.ok(Math.abs(faded[Math.floor(SR / 2)] - 0.8) < 1e-6, "The middle must be untouched");
});

// Regression test: the silence a TTS engine pads onto each utterance must not survive assembly
test("assembleSegments: strips TTS silence padding instead of carrying it into the timeline", () => {
  const chunks = [[paddedChunk("padded", 1.0, 0.3)]];
  const assembled = assembleSegments(chunks, TEST_ASSEMBLE);

  assert.ok(
    Math.abs(assembled.totalSec - 1.0) < 0.01,
    `Expected ~1.0s of speech after trimming 0.6s of padding, got ${assembled.totalSec.toFixed(3)}s`,
  );
  assert.equal(assembled.segments[0].startSec, 0, "Speech must start at zero, not after the padding");
});

// Regression test: the gap the caller asked for is exactly the gap on the timeline
test("assembleSegments: places segments at exact sample offsets with the requested gap", () => {
  const chunks = [
    [paddedChunk("one", 1.0, 0.2)],
    [paddedChunk("two", 0.5, 0.2)],
    [paddedChunk("three", 0.75, 0.2)],
  ];
  const assembled = assembleSegments(chunks, TEST_ASSEMBLE);
  const gapSamples = Math.round((TEST_ASSEMBLE.segmentGapMs / 1000) * SR);

  assert.equal(assembled.samples.length, Math.round(assembled.totalSec * SR));
  for (let i = 1; i < assembled.segments.length; i++) {
    const prev = assembled.segments[i - 1];
    const gap = assembled.segments[i].startSample - (prev.startSample + prev.lengthSamples);
    assert.equal(gap, gapSamples, `Gap before segment ${i} must be exactly ${gapSamples} samples`);
  }

  const lastSegment = assembled.segments[assembled.segments.length - 1];
  assert.equal(
    lastSegment.startSample + lastSegment.lengthSamples,
    assembled.samples.length,
    "The final segment must run to the very end - a truncated tail cuts the last words off",
  );
});

// Regression test for the defect the ear actually hears: a step discontinuity at a stitch point
test("assembleSegments: leaves no click at any chunk or segment boundary", () => {
  const chunks = [
    [paddedChunk("a", 0.6, 0.15), paddedChunk("b", 0.6, 0.15)],
    [paddedChunk("c", 0.6, 0.15)],
  ];
  const assembled = assembleSegments(chunks, TEST_ASSEMBLE);

  // Inside a loud region the step between samples is large by nature; at a boundary it must not be.
  const midSpeechStep = maxSampleStep(assembled.samples.subarray(Math.round(0.2 * SR), Math.round(0.4 * SR)));
  assert.ok(midSpeechStep > 0.01, "Sanity check: the tone itself should have real sample-to-sample motion");

  for (const seg of assembled.segments) {
    for (const edge of [seg.startSample, seg.startSample + seg.lengthSamples]) {
      const from = Math.max(1, edge - 40);
      const to = Math.min(assembled.samples.length, edge + 40);
      const step = maxSampleStep(assembled.samples.subarray(from - 1, to));
      assert.ok(
        step < 0.02,
        `Boundary at sample ${edge} steps by ${step.toFixed(4)}; that is an audible click`,
      );
    }
  }
});

// Regression test: a silent chunk must not open a hole in the middle of the narration
test("assembleSegments: drops fully silent chunks rather than leaving dead air", () => {
  const silent: PcmChunk = { text: "silent", samples: new Float32Array(SR) };
  const chunks = [[paddedChunk("real", 1.0, 0.1), silent]];
  const assembled = assembleSegments(chunks, TEST_ASSEMBLE);

  assert.ok(
    longestSilenceSec(assembled.samples, SR) < 0.05,
    "A silent chunk must be dropped, not concatenated as a second of dead air",
  );
});

// Regression test for the sum-to-total invariant the film timeline is locked to
test("deriveShotDurations: tiles the whole narration with no gap and no overlap", () => {
  const chunks = [
    [paddedChunk("one", 1.2, 0.2)],
    [paddedChunk("two", 0.8, 0.2)],
    [paddedChunk("three", 1.5, 0.2)],
  ];
  const assembled = assembleSegments(chunks, TEST_ASSEMBLE);
  const durations = deriveShotDurations(assembled.segments, assembled.totalSec);

  const sum = durations.reduce((a, b) => a + b, 0);
  assert.ok(
    Math.abs(sum - assembled.totalSec) < 1e-9,
    `Shot durations sum to ${sum} but the audio is ${assembled.totalSec} long`,
  );

  let cursor = 0;
  assembled.segments.forEach((seg, i) => {
    assert.ok(
      Math.abs(cursor - seg.startSec) < 1e-9,
      `Shot ${i} starts at ${cursor} but its narration starts at ${seg.startSec}`,
    );
    cursor += durations[i];
  });
});

// Regression test: word timings must stay inside their segment and never run backwards
test("distributeWordTimings: produces monotonic, non-overlapping timings that close on the duration", () => {
  const text = "Attention is all you need, and the transformer proved it.";
  const words = distributeWordTimings(text, 4.0);

  assert.equal(words.length, 10);
  assert.equal(words[0].start, 0, "The first word must start at the segment start");
  assert.ok(Math.abs(words[words.length - 1].end - 4.0) < 0.002, "The last word must close on the duration");

  for (let i = 1; i < words.length; i++) {
    assert.ok(words[i].start >= words[i - 1].end - 0.002, `Word ${i} overlaps the one before it`);
    assert.ok(words[i].end > words[i].start, `Word ${i} has a non-positive span`);
  }
});

// Regression test: an even split puts short and long words on the same clock and drifts inside a sentence
test("distributeWordTimings: gives a long word more time than a short one", () => {
  const words = distributeWordTimings("a understanding", 2.0);
  const shortSpan = words[0].end - words[0].start;
  const longSpan = words[1].end - words[1].start;
  assert.ok(
    longSpan > shortSpan * 2,
    `"understanding" (${longSpan.toFixed(3)}s) must take much longer than "a" (${shortSpan.toFixed(3)}s)`,
  );
});

// Regression test: absolute word timings must land inside the audio they describe
test("distributeWordTimings: offsets stay within the segment when placed on the absolute timeline", () => {
  const words = distributeWordTimings("one two three four", 2.0, 10.5);
  assert.equal(words[0].start, 10.5);
  assert.ok(Math.abs(words[words.length - 1].end - 12.5) < 0.002);
});

// Regression test for the mismatch class: the written file must carry the layout assembly assumed
test("encodeWav/decodeWav: round-trips mono PCM at the declared sample rate without truncation", () => {
  const samples = new Float32Array(SR);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR);

  const decoded = decodeWav(encodeWav(samples, SR));
  assert.equal(decoded.sampleRate, SR, "A rate mismatch here plays the whole narration at the wrong speed");
  assert.equal(decoded.channels, 1, "A channel mismatch here silently halves or doubles the duration");
  assert.equal(decoded.samples.length, samples.length, "Sample count must survive the encode");

  let worst = 0;
  for (let i = 0; i < samples.length; i++) worst = Math.max(worst, Math.abs(decoded.samples[i] - samples[i]));
  assert.ok(worst < 1 / 32767 + 1e-9, `16-bit round trip drifted by ${worst}`);
});

// Regression test: normalization must raise level without ever clipping
test("normalizePeak: reaches the target peak and never exceeds full scale", () => {
  const quiet = new Float32Array([0.01, -0.02, 0.015, 0.0]);
  const loud = normalizePeak(quiet, 0.89);

  let peak = 0;
  for (const s of loud) peak = Math.max(peak, Math.abs(s));
  assert.ok(Math.abs(peak - 0.89) < 1e-6, `Expected a 0.89 peak, got ${peak}`);
  assert.ok(peak < 1, "Normalized audio must keep headroom below full scale");

  const silent = normalizePeak(new Float32Array(10), 0.89);
  assert.equal(silent.length, 10, "Silence must pass through rather than divide by zero");
});

// Regression test: captions must break into readable phrases rather than one cue per paragraph
test("buildCaptionsVtt: breaks cues on sentence ends and caps them at seven words", () => {
  const words = distributeWordTimings(
    "This is the first sentence. This second one runs on for quite a few more words indeed.",
    8.0,
  );
  const vtt = buildCaptionsVtt(words);
  const cues = vtt.split("\n\n").filter((block) => block.includes("-->"));

  assert.ok(vtt.startsWith("WEBVTT"), "A VTT file must declare itself");
  assert.ok(cues.length >= 3, `Expected several cues, got ${cues.length}`);
  for (const cue of cues) {
    const text = cue.split("\n")[1] ?? "";
    assert.ok(text.split(/\s+/).filter(Boolean).length <= 7, `Cue "${text}" is too long to read`);
  }
});

// Regression test for the drift that put the picture up to half a second off the narration
test("buildTimeline: shot starts stay within one frame of the narration across a long film", () => {
  const fps = 30;
  // Durations chosen so each one rounds to a fraction of a frame: the failure mode is the
  // accumulation of those fractions, which only shows up over a film's worth of shots.
  const durations = Array.from({ length: 60 }, (_, i) => 3 + ((i * 7) % 13) / 30 + 0.017);
  const film = {
    id: "drift-probe",
    title: "Drift Probe",
    fps,
    chapters: ["one"],
    canvas: {
      nodes: [
        { id: "a", label: "A", x: 0, y: 0, w: 190, h: 62 },
        { id: "b", label: "B", x: 400, y: 0, w: 190, h: 62 },
      ],
      edges: [{ from: "a", to: "b" }],
    },
    shots: durations.map((dur, i) => ({
      id: `s${i}`,
      dur,
      stage: "none" as const,
      look: "a",
      move: i === 0 ? ("cut" as const) : ("pan" as const),
      drift: false,
      zoom: 1,
      blocks: [],
    })),
  };

  const timeline = buildTimeline(film as never);
  let narrationSec = 0;
  timeline.forEach((t, i) => {
    const driftFrames = Math.abs(t.from - narrationSec * fps);
    assert.ok(
      driftFrames <= 1,
      `Shot ${i} sits ${driftFrames.toFixed(2)} frames from its narration start; drift accumulated`,
    );
    narrationSec += durations[i];
  });

  const totalDriftSec = Math.abs(timeline[timeline.length - 1].to / fps - narrationSec);
  assert.ok(totalDriftSec < 1 / fps, `The film ends ${totalDriftSec.toFixed(3)}s away from the narration`);
});

// Live end-to-end synthesis check. Opt-in so the default suite stays offline and fast.
test("live narration synthesis produces a clean, drift-free track", async (t) => {
  if (!process.env.RUN_TTS_TESTS) {
    t.skip("Set RUN_TTS_TESTS=1 to run live text-to-speech synthesis.");
    return;
  }

  const script = [
    "Every diffusion model you have heard of used to be built on a U-Net.",
    "Then, almost overnight, the entire field switched to transformers.",
    "A U-Net is a funnel. It squeezes an image down, then expands it back up.",
  ];
  const outDir = path.join(__dirname, "../out/test_narration");
  const result = await produceAudioPipeline(script, outDir);

  const wav = decodeWav(await fs.readFile(result.voiceoverPath));
  assert.equal(wav.channels, 1);
  assert.ok(
    Math.abs(wav.samples.length / wav.sampleRate - result.totalAudioDuration) < 0.001,
    "The written file's duration must equal the duration the timeline was built from",
  );

  const sum = result.shotDurations.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - result.totalAudioDuration) < 1e-6, "Shot durations must sum to the audio duration");

  const lastWord = result.words[result.words.length - 1];
  assert.ok(
    lastWord.end <= result.totalAudioDuration + 0.001,
    "The last word must not be timed past the end of the audio",
  );
  assert.ok(
    longestSilenceSec(wav.samples, wav.sampleRate) < 1.0,
    "No stretch of the narration should sit silent for a second",
  );

  const film = buildFilmFromAudioResult("Live Narration Test", result);
  const timeline = buildTimeline(film);
  film.shots.forEach((_, i) => {
    const expectedFrame = Math.round(result.segments[i].startOffset * film.fps);
    assert.ok(
      Math.abs(timeline[i].from - expectedFrame) <= 1,
      `Shot ${i} renders at frame ${timeline[i].from} but its narration starts at frame ${expectedFrame}`,
    );
  });

  await fs.rm(outDir, { recursive: true, force: true });
});
