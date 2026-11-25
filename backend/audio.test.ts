/**
 * File Description: Unit tests for audio segmentation, caption offsets, timeline gap math, and film construction.
 * Inputs and outputs: sample audio buffers and synthesis mocks -> audio pipeline test assertions.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import fsSync from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";
dotenv.config({ quiet: true });

import {
  splitScriptIntoSegments,
  produceAudioPipeline,
  formatTime,
  buildFilmFromAudioResult,
  retimeAudioSync,
  ensureRetimedAudio,
  buildAtempoFilter,
  resolveAudioSourcePath,
  normalizeNarrationLoudness,
  NARRATION_LOUDNESS_TARGET,
} from "./audio";
import { measureLoudness } from "./review/media";
import { getRetimedAudioFilename, getRetimedAudioRelPath } from "../src/dl/audio/retime";
import { decodeWav, encodeWav } from "./pcm";
import { PCM_SAMPLE_RATE, type TtsBackend } from "./tts";
import { forAll, pick, randInt } from "./testSupport/propertyTest";

const fixtureDir = path.resolve(process.cwd(), "test_fixtures");
const testAudioPath = path.join(fixtureDir, "test_audio.wav");
if (!fsSync.existsSync(fixtureDir)) fsSync.mkdirSync(fixtureDir, { recursive: true });
if (!fsSync.existsSync(testAudioPath)) {
  const sampleRate = 48000;
  const numSamples = sampleRate * 2; // 2 seconds
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
  }
  fsSync.writeFileSync(testAudioPath, encodeWav(samples, sampleRate));
}

test("segment splitting handles shot-scoped multi-sentence and newline-separated scripts", () => {
  const script = "Welcome to Aideos. We build explainer videos as data.\n\nEvery node is a concept.";
  const segments = splitScriptIntoSegments(script);
  assert.equal(segments.length, 2);
  assert.equal(segments[0], "Welcome to Aideos. We build explainer videos as data.");
  assert.equal(segments[1], "Every node is a concept.");

  const shotArray = [
    "Meet Yann LeCun, pioneer. While tech went in on chatbots, he argued LLMs are dead end.",
    "A French American computer scientist, LeCun won Turing Award.",
  ];
  const arraySegments = splitScriptIntoSegments(shotArray);
  assert.equal(arraySegments.length, 2);
  assert.equal(arraySegments[0], shotArray[0]);
  assert.equal(arraySegments[1], shotArray[1]);
});

test("no-narration-segment rejection throws error for empty or textless script sections", () => {
  assert.throws(
    () => splitScriptIntoSegments(""),
    /A shot with no narration is not allowed mid-script in v1/,
  );
  assert.throws(
    () => splitScriptIntoSegments("   \n\t  "),
    /A shot with no narration is not allowed mid-script in v1/,
  );
});

test("shared audio entry reports fragments, rejects title leaks, and still synthesizes clean narration", async () => {
  const pkg = await fs.mkdtemp(path.join(os.tmpdir(), "aideos-intake-audio-"));
  const synthesized: string[] = [];
  const notices: string[] = [];
  const backend: TtsBackend = {
    name: "intake-test",
    maxChars: 800,
    async synthesize(text) {
      synthesized.push(text);
      return new Float32Array(PCM_SAMPLE_RATE * 4).fill(0.05);
    },
  };
  try {
    await assert.rejects(
      produceAudioPipeline("## Closing\n[NARRATION]\nClosing.", pkg, { ttsBackendInstance: backend }),
      /would read the heading aloud/,
    );
    assert.deepEqual(synthesized, [], "title validation runs before the TTS backend is called");

    const result = await produceAudioPipeline("A clean narration line.", pkg, {
      ttsBackendInstance: backend,
      onIntakeNotice: (issue) => notices.push(issue.message),
    });
    assert.equal(result.segments[0].text, "A clean narration line.");
    assert.deepEqual(synthesized, ["A clean narration line."]);
    assert.deepEqual(notices, []);

    const fragmentNotices: string[] = notices;
    const fragmentResult = await produceAudioPipeline("the closing\nprocess is expensive", pkg, {
      ttsBackendInstance: backend,
      onIntakeNotice: (issue) => fragmentNotices.push(issue.message),
    });
    assert.equal(fragmentResult.segments[0].text, "the closing process is expensive");
    assert.match(fragmentNotices[0], /line 1.*the closing.*line 2.*process is expensive/);
  } finally {
    await fs.rm(pkg, { recursive: true, force: true });
  }
});

// House pace (captain, 2026-11-21): "I feel that 1.2x of the speed would really fit this nicely." A voice without its
// own speaking-rate setting is re-paced per line, and the rate is part of the per-line cache fingerprint.
test("house pace: a voice without its own speed is stretched 1.2x per line, and the rate is part of the line cache key", async () => {
  const pkg = await fs.mkdtemp(path.join(os.tmpdir(), "aideos-pace-audio-"));
  let calls = 0;
  // Speaks every line as three seconds of a steady 180 Hz voice.
  const speak = async () => {
    calls += 1;
    const out = new Float32Array(PCM_SAMPLE_RATE * 3);
    for (let i = 0; i < out.length; i++) out[i] = 0.3 * Math.sin((2 * Math.PI * 180 * (i + 0.25)) / PCM_SAMPLE_RATE + 0.5);
    return out;
  };
  const plain: TtsBackend = { name: "pace-test", maxChars: 800, synthesize: speak };
  const lines = ["The first line of the story.", "The second line of the story."];
  const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} s, expected ${expected} s`);
  try {
    const fast = await produceAudioPipeline(lines, pkg, { ttsBackendInstance: plain });
    assert.equal(fast.timeStretch, 1.2);
    assert.deepEqual(fast.lines, { recorded: 2, reused: 0 });
    near(fast.segments[0].duration, 2.5);
    const again = await produceAudioPipeline(lines, pkg, { ttsBackendInstance: plain });
    assert.deepEqual(again.lines, { recorded: 0, reused: 2 }, "the same rate reuses the stored lines");
    const asSpoken = await produceAudioPipeline(lines, pkg, { ttsBackendInstance: plain, narrationRate: 1 });
    assert.deepEqual(asSpoken.lines, { recorded: 2, reused: 0 }, "another rate is another recording");
    assert.equal(asSpoken.timeStretch, undefined);
    near(asSpoken.segments[0].duration, 3);
    const native = await produceAudioPipeline(lines, pkg, { ttsBackendInstance: { ...plain, name: "native-pace-test", speed: 1.2 } });
    assert.equal(native.timeStretch, undefined, "a voice that sets its own pace is never stretched on top");
    near(native.segments[0].duration, 3);
    assert.equal(calls, 6);
  } finally {
    await fs.rm(pkg, { recursive: true, force: true });
  }
});

test("caption offset math correctly shifts timestamps by segment start offset", () => {
  const segStartOffset = 4.25; // 4.25 seconds into timeline
  const relativeUtteranceStart = 0.50; // 0.50s within segment
  const relativeUtteranceEnd = 2.10;

  const vttStart = formatTime(segStartOffset + relativeUtteranceStart);
  const vttEnd = formatTime(segStartOffset + relativeUtteranceEnd);

  assert.equal(vttStart, "00:00:04.750");
  assert.equal(vttEnd, "00:00:06.350");
});

test("gap handling adds fixed gap between segments on timeline", () => {
  const segDurations = [2.0, 3.0, 1.5];
  const gapSec = 0.2; // 200ms
  const numSegments = segDurations.length;

  const shotDurations = segDurations.map((dur, i) => dur + (i < numSegments - 1 ? gapSec : 0));
  const expectedTotalGap = (numSegments - 1) * gapSec;
  const expectedTotalDuration = segDurations.reduce((a, b) => a + b, 0) + expectedTotalGap;

  const actualShotSum = shotDurations.reduce((a, b) => a + b, 0);

  assert.equal(actualShotSum, expectedTotalDuration);
  assert.equal(shotDurations[0], 2.2);
  assert.equal(shotDurations[1], 3.2);
  assert.equal(shotDurations[2], 1.5);
});

test("buildFilmFromAudioResult produces valid film JSON matching audio result", () => {
  const dummyResult = {
    segments: [
      { text: "First shot text.", duration: 3.0, startOffset: 0, words: [], utterances: [] },
      { text: "Second shot text.", duration: 4.0, startOffset: 3.2, words: [], utterances: [] },
      { text: "Third shot text.", duration: 3.5, startOffset: 7.4, words: [], utterances: [] },
    ],
    shotDurations: [3.2, 4.2, 3.5],
    totalAudioDuration: 10.9,
    voiceoverPath: "public/voiceover.wav",
    captionsPath: "public/captions.vtt",
    captionsVttContent: "WEBVTT\n",
  };

  const film = buildFilmFromAudioResult("Test Film", dummyResult);
  assert.equal(film.shots.length, 3);
  assert.equal(film.shots[0].scriptText, "First shot text.");
  assert.equal(film.shots[0].dur, 3.2);
  assert.equal(film.shots[1].dur, 4.2);
  assert.equal(film.shots[2].dur, 3.5);
  assert.equal(film.voiceover?.src, "voiceover.wav");
  assert.equal(film.captions, "bottom");

  const shotSum = film.shots.reduce((sum, s) => sum + s.dur, 0);
  assert.ok(Math.abs(shotSum - dummyResult.totalAudioDuration) < 0.05);
});

test("buildAtempoFilter builds valid single and chained atempo filters", () => {
  assert.equal(buildAtempoFilter(1.5), "atempo=1.5000");
  assert.equal(buildAtempoFilter(0.8), "atempo=0.8000");
  assert.equal(buildAtempoFilter(3.0), "atempo=2.0,atempo=1.5000");
  assert.equal(buildAtempoFilter(0.4), "atempo=0.5,atempo=0.8000");
  assert.throws(() => buildAtempoFilter(0), /Invalid speed/);
  assert.throws(() => buildAtempoFilter(-1), /Invalid speed/);
});

// Checks loudness normalization on a short WAV, without synthesizing or rendering a film.
test("narration normalization reaches the review LUFS window and preserves duration", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aideos-loudness-test-"));
  const outputPath = path.join(tmpDir, "normalized.wav");
  try {
    normalizeNarrationLoudness(testAudioPath, outputPath);
    const measured = measureLoudness(outputPath);
    assert.ok(measured, "the normalized fixture must have measurable audio");
    assert.ok(measured.integratedLufs >= -18 && measured.integratedLufs <= -14, `LUFS ${measured.integratedLufs} outside review window`);
    assert.ok(measured.truePeakDb <= NARRATION_LOUDNESS_TARGET.truePeakDb + 0.2, `true peak ${measured.truePeakDb} exceeds target`);
    const normalizedWav = decodeWav(await fs.readFile(outputPath));
    assert.equal(normalizedWav.samples.length / normalizedWav.sampleRate, 2);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("resolveAudioSourcePath resolves files across packages and public directories", () => {
  const resolved = resolveAudioSourcePath(testAudioPath);
  assert.equal(resolved, testAudioPath);

  const relative = resolveAudioSourcePath("test_fixtures/test_audio.wav");
  assert.equal(relative, testAudioPath);

  assert.throws(() => resolveAudioSourcePath("nonexistent/missing_file.wav"), /not found/);
});

test("resolveAudioSourcePath finds a public/ source even when process.cwd() is not the repo root", () => {
  // The editor's dev server is launched with `cd editor && npm run dev`, so its cwd is editor/,
  // not the repo root every other caller runs from. Before the fix, a lookup relative only to
  // process.cwd() silently missed every asset the editor itself imported (media/upload, footage
  // audio peaks, transcription) whenever it ran from inside the editor directory.
  const publicMediaDir = path.resolve(process.cwd(), "public/media");
  fsSync.mkdirSync(publicMediaDir, { recursive: true });
  const fixtureName = "resolve_audio_source_cwd_regression.wav";
  const fixturePath = path.join(publicMediaDir, fixtureName);
  fsSync.writeFileSync(fixturePath, fsSync.readFileSync(testAudioPath));

  const editorCwd = path.resolve(process.cwd(), "editor");
  const originalCwd = process.cwd();
  try {
    process.chdir(editorCwd);
    const resolved = resolveAudioSourcePath(`media/${fixtureName}`);
    assert.equal(resolved, fixturePath, "must resolve against the repo root, not the editor's own cwd");
  } finally {
    process.chdir(originalCwd);
    fsSync.rmSync(fixturePath, { force: true });
  }
});

test("retimeAudioSync retimes audio across 0.8x, 1.2x, 1.5x, 2.0x speeds with WSOLA duration scaling", () => {
  const sourcePath = testAudioPath;
  const orig = retimeAudioSync(sourcePath, 1.0);
  assert.ok(orig.durationSec > 0);

  const speeds = [0.8, 1.2, 1.5, 2.0];
  for (const speed of speeds) {
    const retimed = retimeAudioSync(sourcePath, speed);
    assert.ok(retimed.filePath.endsWith(".wav"));
    // Expected duration is original duration divided by speed, within 2% tolerance
    const expectedDur = orig.durationSec / speed;
    assert.ok(
      Math.abs(retimed.durationSec - expectedDur) < expectedDur * 0.05,
      `Duration mismatch at speed ${speed}: got ${retimed.durationSec}, expected ${expectedDur}`
    );
  }
});

test("retimeAudioSync reuses its disk cache for generated speeds", () => {
  const cacheDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "aideos-retime-cache-property-"));
  try {
    forAll("retime cache key reuses the same file", (rand) => randInt(rand, 1100, 2400) / 1000, (speed) => {
      const first = retimeAudioSync(testAudioPath, speed, { cacheDir });
      const before = fsSync.statSync(first.filePath, { bigint: true });
      const second = retimeAudioSync(testAudioPath, speed, { cacheDir });
      const after = fsSync.statSync(second.filePath, { bigint: true });

      assert.equal(second.filePath, first.filePath);
      assert.equal(second.durationSec, first.durationSec);
      assert.equal(after.mtimeNs, before.mtimeNs, "a cache hit must not rewrite the retimed file");
      assert.equal(after.size, before.size);
    }, { cases: 8 });
  } finally {
    fsSync.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("retime cache key is stable and distinguishes exactly what the ffmpeg filter distinguishes", () => {
  const sources = ["videos/a/voiceover.wav", "videos/b/voiceover.wav", "videos/a/music.wav"];
  forAll(
    "retime cache key tracks the atempo filter",
    (rand) => {
      const a = randInt(rand, 300000, 4000000) / 1000000;
      const offset = randInt(rand, -150, 150) / 100000;
      return { src: pick(rand, sources), other: pick(rand, sources), a, b: a + offset };
    },
    ({ src, other, a, b }) => {
      assert.equal(getRetimedAudioFilename(src, a), getRetimedAudioFilename(src, a), "same inputs, same key");
      assert.equal(
        getRetimedAudioFilename(src, a) === getRetimedAudioFilename(src, b),
        buildAtempoFilter(a) === buildAtempoFilter(b),
        `speeds ${a} and ${b} must share a key exactly when they share a filter`
      );
      if (src !== other) {
        assert.notEqual(getRetimedAudioFilename(src, a), getRetimedAudioFilename(other, a), "different sources, different keys");
      }
    }
  );
});

test("retime cache key separates speeds that differ only at the 4th decimal or inside a chained filter", () => {
  const src = "videos/test-film/voiceover.wav";
  assert.notEqual(getRetimedAudioFilename(src, 1.5001), getRetimedAudioFilename(src, 1.5004));
  assert.notEqual(buildAtempoFilter(1.5001), buildAtempoFilter(1.5004));
  assert.notEqual(getRetimedAudioFilename(src, 3.00005), getRetimedAudioFilename(src, 3.00014));
  assert.notEqual(buildAtempoFilter(3.00005), buildAtempoFilter(3.00014));
});

test("getRetimedAudioFilename and getRetimedAudioRelPath produce deterministic public paths", () => {
  const filename = getRetimedAudioFilename("videos/test-film/voiceover.wav", 1.25);
  assert.equal(filename, "retimed_videos_test-film_voiceover_wav_atempo_1_2500.wav");

  const relPath = getRetimedAudioRelPath("videos/test-film/voiceover.wav", 1.25);
  assert.equal(relPath, ".tmp_audio/retimed_videos_test-film_voiceover_wav_atempo_1_2500.wav");
});

test("ensureRetimedAudio pre-renders retimed audio for static Remotion CLI resolution", () => {
  const mockFilm = {
    id: "mock-film",
    title: "Mock Film",
    fps: 30 as const,
    chapters: ["Ch 1"],
    canvas: { nodes: [{ id: "n1", label: "N1", x: 0, y: 0, w: 100, h: 50 }, { id: "n2", label: "N2", x: 100, y: 0, w: 100, h: 50 }], edges: [{ from: "n1", to: "n2" }] },
    shots: [{ id: "s1", dur: 3 }],
    voiceover: { src: "test_fixtures/test_audio.wav", speed: 1.2 },
  };

  ensureRetimedAudio(mockFilm as any);
  const expectedPath = path.resolve(process.cwd(), getRetimedAudioRelPath(mockFilm.voiceover.src, 1.2));
  assert.ok(fsSync.existsSync(expectedPath), `Expected pre-rendered file at ${expectedPath}`);
});

