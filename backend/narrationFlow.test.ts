/**
 * File Description: Tests for natural narration sentence flow, internal pause compaction, the standing
 * in-sentence silence gate in produceAudioPipeline and aideos review, and the silent-window guard in
 * music-under-voice review (owner feedback 2026-11-28). Every audio test uses synthetic PCM signals
 * with known gap positions and durations; no voice audio is committed and no network is touched.
 * Inputs and outputs: synthetic PCM signals, multi-sentence scripts and review inputs -> flow gate assertions.
 * Used by: bun run test / npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  checkNarrationFlow,
  compactInternalPauses,
  DEFAULT_MAX_IN_SENTENCE_GAP_SEC,
  detectInSentenceAudioGaps,
  detectInSentenceSilences,
  detectInSentenceWordGaps,
  isSentenceEndingWord,
  NarrationFlowError,
  splitIntoSentences,
  splitSentencesForTTS,
} from "./narrationFlow";
import { produceAudioPipeline } from "./audio";
import { assembleSegments, DEFAULT_ASSEMBLE_OPTIONS, maxSampleStep, type PcmChunk } from "./pcm";
import { PCM_SAMPLE_RATE, type TtsBackend } from "./tts";
import { evaluateCriteria, narrationFlow, type ReviewInputs } from "./review/criteria";
import { compareStemFrames } from "./review/music";
import type { Narration } from "./review/speech";
import type { RenderFacts } from "./review/renderFacts";
import type { VideoFacts } from "./review/types";

const SR = PCM_SAMPLE_RATE;

// Builds a synthetic speech-like tone (440 Hz + 220 Hz) of `seconds` length with an optional silence gap in the middle.
function speechWithGap(beforeSec: number, gapSec: number, afterSec: number, amplitude = 0.25): Float32Array {
  const nBefore = Math.round(beforeSec * SR);
  const nGap = Math.round(gapSec * SR);
  const nAfter = Math.round(afterSec * SR);
  const out = new Float32Array(nBefore + nGap + nAfter);
  for (let i = 0; i < nBefore; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / SR);
  }
  for (let i = 0; i < nAfter; i++) {
    out[nBefore + nGap + i] = amplitude * Math.sin((2 * Math.PI * 240 * i) / SR);
  }
  return out;
}

// Decision 2026-11-28 (owner feedback): synthesize and place each sentence whole, breaking pauses only at sentence and clause ends.
test("splitIntoSentences and splitSentencesForTTS keep sentences whole, preserve decimals and abbreviations, and break over-long sentences at clauses", () => {
  const multi =
    "Now, here is where things get interesting. Training these models is extremely expensive. " +
    "And compute is one of the biggest reasons why only a handful of companies can train frontier models.";
  assert.deepEqual(splitIntoSentences(multi), [
    "Now, here is where things get interesting.",
    "Training these models is extremely expensive.",
    "And compute is one of the biggest reasons why only a handful of companies can train frontier models.",
  ]);

  const withNumbers = "Meta reported that training Llama 3.1 405B required around 30.84 million H100 GPU hours. Dr. Hinton called it dark knowledge.";
  assert.deepEqual(splitIntoSentences(withNumbers), [
    "Meta reported that training Llama 3.1 405B required around 30.84 million H100 GPU hours.",
    "Dr. Hinton called it dark knowledge.",
  ]);
  assert.equal(isSentenceEndingWord("30.84"), false);
  assert.equal(isSentenceEndingWord("Dr."), false);
  assert.equal(isSentenceEndingWord("U.S."), false);
  assert.equal(isSentenceEndingWord("knowledge."), true);

  // An over-long single sentence breaks at clause boundaries before word boundaries.
  const longClauseSentence =
    "A smaller lab might not have access to high-quality licensed data, " +
    "it might lack the compute needed to process huge datasets, " +
    "and it cannot easily buy thousands of GPUs.";
  const chunks = splitSentencesForTTS(longClauseSentence, 90);
  assert.equal(chunks.length, 3);
  assert.ok(chunks[0].endsWith(","), `expected clause break on comma, got "${chunks[0]}"`);
  assert.ok(chunks[1].endsWith(","), `expected clause break on comma, got "${chunks[1]}"`);
  assert.equal(chunks.join(" "), longClauseSentence);
});

// Decision 2026-11-28 (owner feedback, 1:41 distillation bug reproduction): a 0.65 s silence inside a sentence fails the standing flow gate; compaction fixes it without clicks.
test("narration flow: detects a real 0.65 s mid-sentence gap fixture and compaction removes it without clicks", () => {
  const sentence = "And compute is one of the biggest reasons why only a handful of companies can train frontier models.";
  // Reproduce the 1:41 mid-sentence stall: 2.0 s speech, 0.65 s silence mid-clause, 1.8 s speech.
  const broken = speechWithGap(2.0, 0.65, 1.8);
  const rawReport = checkNarrationFlow(broken, SR, [
    { text: sentence, startSec: 0, endSec: broken.length / SR, segmentIndex: 0, sentenceIndex: 0 },
  ]);
  assert.equal(rawReport.passed, false);
  assert.equal(rawReport.gaps.length, 1);
  assert.ok(rawReport.gaps[0].durationSec >= 0.6 && rawReport.gaps[0].durationSec <= 0.68, `got ${rawReport.gaps[0].durationSec} s`);
  assert.match(rawReport.summary, /And compute is one of the biggest reasons/);

  // Compacting internal pauses removes the mid-clause stall and leaves no click at the splice.
  const fixed = compactInternalPauses(broken, SR, { sentenceText: sentence });
  assert.ok(fixed.length < broken.length - Math.round(0.45 * SR), "excess mid-sentence dead air was removed");
  const fixedReport = checkNarrationFlow(fixed, SR, [
    { text: sentence, startSec: 0, endSec: fixed.length / SR, segmentIndex: 0, sentenceIndex: 0 },
  ]);
  assert.equal(fixedReport.passed, true, fixedReport.summary);

  // Verify the splice boundary inside the compacted signal has no audible step discontinuity.
  const spliceCenter = Math.round(2.0 * SR);
  const boundaryStep = maxSampleStep(fixed.subarray(Math.max(0, spliceCenter - 400), Math.min(fixed.length, spliceCenter + 3000)));
  assert.ok(boundaryStep < 0.05, `compaction left a boundary step of ${boundaryStep}`);
});

// Decision 2026-11-28: clause-boundary pauses (comma/colon) are capped to a crisp clause breath rather than deleted, while mid-clause stalls are compacted tightly.
test("compactInternalPauses: keeps a brief breath near a comma while capping 0.7 s dead air", () => {
  const withComma = "For example, imagine a question has three possible answers.";
  // Put a 0.70 s silence near the comma (roughly 20% into the sentence).
  const raw = speechWithGap(0.6, 0.7, 2.4);
  const compacted = compactInternalPauses(raw, SR, { sentenceText: withComma });
  const gaps = detectInSentenceAudioGaps(
    compacted,
    SR,
    [{ text: withComma, startSec: 0, endSec: compacted.length / SR, segmentIndex: 0, sentenceIndex: 0 }],
    0.15,
  );
  // A crisp clause breath (~0.22 s) survives, well under the 0.35 s flow gate.
  assert.equal(gaps.length, 1);
  assert.ok(gaps[0].durationSec >= 0.18 && gaps[0].durationSec <= 0.25, `expected ~0.22 s clause pause, got ${gaps[0].durationSec} s`);
  const report = checkNarrationFlow(compacted, SR, [
    { text: withComma, startSec: 0, endSec: compacted.length / SR, segmentIndex: 0, sentenceIndex: 0 },
  ]);
  assert.equal(report.passed, true, report.summary);
});

// Decision 2026-11-28: produceAudioPipeline synthesizes each sentence whole, compacts engine stalls, and fails the flow gate if a mid-sentence gap survives.
test("produceAudioPipeline: synthesizes each sentence whole and enforces the standing in-sentence flow gate", async () => {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-flow-pipeline-"));
  const spokenCalls: string[] = [];
  // Fake backend that injects a 0.65 s mid-sentence pause into the third sentence (reproducing vcd's 1:41 stall).
  const gappyBackend: TtsBackend = {
    name: "flow-test",
    maxChars: 1800,
    async synthesize(text) {
      spokenCalls.push(text);
      if (text.includes("compute is one of the biggest reasons")) {
        return speechWithGap(1.5, 0.65, 1.5);
      }
      return speechWithGap(1.2, 0, 0);
    },
  };
  const multiSentenceShot =
    "Now, here is where things get interesting. Training these models is extremely expensive. " +
    "And compute is one of the biggest reasons why only a handful of companies can train frontier models.";

  try {
    // Default path: synthesizes each sentence whole, compacts the 0.65 s engine stall, and passes the standing flow gate.
    const ok = await produceAudioPipeline([multiSentenceShot], pkg, {
      ttsBackendInstance: gappyBackend,
      narrationRate: 1,
    });
    assert.deepEqual(spokenCalls, [
      "Now, here is where things get interesting.",
      "Training these models is extremely expensive.",
      "And compute is one of the biggest reasons why only a handful of companies can train frontier models.",
    ]);
    assert.equal(ok.flowCheck?.passed, true);
    assert.equal(ok.flowCheck?.sentencesChecked, 3);
    assert.equal(ok.flowCheck?.gaps.length, 0);

    // With compaction disabled on the same gappy audio, the standing flow gate rejects the narration before rendering.
    await assert.rejects(
      () =>
        produceAudioPipeline([multiSentenceShot], pkg, {
          ttsBackendInstance: gappyBackend,
          narrationRate: 1,
          compactInternalPauses: false,
        }),
      (err: unknown) => {
        assert.ok(err instanceof NarrationFlowError);
        assert.equal(err.report.passed, false);
        assert.equal(err.report.gaps.length, 1);
        assert.ok(err.report.gaps[0].durationSec > DEFAULT_MAX_IN_SENTENCE_GAP_SEC);
        return true;
      },
    );
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});

// Decision 2026-11-28: aideos review runs narration-flow as a standing gate when timed punctuated narration is present.
test("review gate (narration-flow): fails mid-sentence silences and word gaps, passes inter-sentence pauses, and skips unpunctuated timings", () => {
  const video: VideoFacts = { path: "x.mp4", durationSec: 12, width: 1920, height: 1080, fps: 30, hasAudio: true, audioDurationSec: 12 };
  const render: RenderFacts = {
    persistence: { median: 0.9, p10: 0.7, min: 0.5, weakest: [], samples: 50 },
    stageClearTimes: [],
    hardCutTimes: [],
    staticRuns: [],
    meanCoverage: 0.05,
    samples: [],
    ocrRan: false,
  };
  const narration: Narration = {
    timed: true,
    text: "Compute is the only reason there is. That is why.",
    words: [
      { word: "Compute", start: 0.0, end: 0.5 },
      { word: "is", start: 0.5, end: 0.7 },
      { word: "the", start: 0.7, end: 0.9 },
      { word: "only", start: 0.9, end: 1.2 },
      { word: "reason", start: 1.2, end: 1.7 },
      { word: "there", start: 1.7, end: 2.1 },
      { word: "is.", start: 2.1, end: 2.6 },
      // 0.75 s chapter/sentence pause between sentences is allowed by narration-flow.
      { word: "That", start: 3.35, end: 3.65 },
      { word: "is", start: 3.65, end: 3.85 },
      { word: "why.", start: 3.85, end: 4.3 },
    ],
  };

  const base: ReviewInputs = { video, render, film: null, narration, loudness: { integratedLufs: -16, truePeakDb: -2 }, silences: [] };

  // Clean narration with a 0.75 s pause ONLY between sentences passes the gate.
  const pass = evaluateCriteria({ ...base, silences: [{ start: 2.6, end: 3.35 }] }).find((c) => c.key === "narration-flow");
  assert.ok(pass);
  assert.equal(pass.gate, true);
  assert.equal(pass.status, "pass");
  assert.equal(pass.metrics.inSentenceGaps, 0);

  // Acoustic 0.60 s silence strictly inside sentence 1 (between "reason" and "there") fails the gate.
  const acousticFail = evaluateCriteria({ ...base, silences: [{ start: 1.4, end: 2.0 }] }).find((c) => c.key === "narration-flow");
  assert.ok(acousticFail);
  assert.equal(acousticFail.gate, true);
  assert.equal(acousticFail.status, "fail");
  assert.equal(acousticFail.metrics.inSentenceGaps, 1);
  assert.equal(acousticFail.evidence[0].t, 1.4);
  assert.equal(detectInSentenceSilences(narration.words, [{ start: 1.4, end: 2.0 }]).length, 1);

  // Word-timing gap inside a sentence (0.65 s between "reason" and "there") also fails the gate.
  const gappyWords = narration.words.map((w, idx) => (idx >= 5 ? { ...w, start: w.start + 0.65, end: w.end + 0.65 } : w));
  assert.equal(detectInSentenceWordGaps(gappyWords).length, 1);
  const wordFail = narrationFlow({ ...base, narration: { ...narration, words: gappyWords } });
  assert.equal(wordFail.status, "fail");
  assert.equal(wordFail.gate, true);

  // Words without sentence punctuation cannot delimit sentences, so the check is skipped rather than passed.
  const unpunctuated: Narration = {
    timed: true,
    text: "compute is the only reason",
    words: [
      { word: "compute", start: 0, end: 0.5 },
      { word: "is", start: 0.5, end: 0.8 },
    ],
  };
  assert.equal(narrationFlow({ ...base, narration: unpunctuated }).status, "skipped");
});

// Finding 6 (distill-long report): a 400 ms pause window whose voice level sits at -71 dB is not masked speech.
test("music review: silent pause window at -71 dB is not counted as masked speech", () => {
  // Window 0: active speech (-18 dB). Window 1: 10 ms edge tick at -39 dB then 390 ms silence at -71 dB (rolled-up RMS ~ -55 dB <= -40 dB floor).
  const narrationFrames = [
    ...Array<number>(40).fill(-18),
    -39,
    ...Array<number>(39).fill(-71),
    ...Array<number>(40).fill(-18),
  ];
  const musicWindows = [-38, -32, -38];
  const measured = compareStemFrames(narrationFrames, musicWindows);
  assert.equal(measured.status, "measured");
  if (measured.status !== "measured") return;
  assert.equal(measured.speechWindows, 2, "the silent pause window must not count as a speech window");
  assert.ok(Math.abs(measured.minimumGapDb - 20) < 1e-9, `expected 20 dB gap, got ${measured.minimumGapDb}`);
});

// AssembleSegments keeps per-chunk sentence placements aligned with sample-exact offsets.
test("assembleSegments: records per-sentence chunk placements with compaction enabled", () => {
  const chunks: PcmChunk[][] = [
    [
      { text: "First sentence.", samples: speechWithGap(1.0, 0, 0) },
      { text: "Second sentence with stall.", samples: speechWithGap(0.8, 0.65, 0.8) },
    ],
  ];
  const assembled = assembleSegments(chunks, { ...DEFAULT_ASSEMBLE_OPTIONS, sampleRate: SR });
  assert.equal(assembled.segments.length, 1);
  assert.equal(assembled.segments[0].chunks?.length, 2);
  const second = assembled.segments[0].chunks![1];
  assert.ok(second.durationSec < 1.8, `expected compacted second sentence under 1.8 s, got ${second.durationSec.toFixed(2)} s`);
});
