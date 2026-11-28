/**
 * File Description: Tests for the standing brand and technical-name pronunciation lexicon, spoken-form
 * TTS conversion, line-cache invalidation on lexicon updates, and offline ASR pronunciation verification
 * (owner feedback 2026-11-28). Every test injects a deterministic transcriber or tests pure functions
 * and CLI argument guards; no real ASR model, voice audio or network is touched.
 * Inputs and outputs: scripts with brand/technical names, mock transcripts and bad CLI args -> pronunciation gate assertions.
 * Used by: bun run test / npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  checkNarrationPronunciation,
  countLexiconTermsInScript,
  DEFAULT_PRONUNCIATION_LEXICON,
  lexiconFingerprint,
  mergePronunciationLexicon,
  PronunciationAsrUnavailableError,
  PronunciationCheckError,
  stripSpokenMarkup,
  toSpokenForm,
  verifyPronunciationTranscript,
  type PronunciationEntry,
} from "./narrationPronunciation";
import { lineVoiceKey, produceAudioPipeline } from "./audio";
import { PCM_SAMPLE_RATE, type TtsBackend } from "./tts";
import { spawnSyncBounded } from "./proc";

const TRANSCRIBE_SCRIPT = path.join(__dirname, "narrationTranscribe.py");

// Builds a steady non-silent synthetic speech buffer so produceAudioPipeline's flow check passes cleanly.
function steadyTone(seconds = 1.4): Float32Array {
  const out = new Float32Array(Math.round(seconds * PCM_SAMPLE_RATE));
  for (let i = 0; i < out.length; i++) {
    out[i] = 0.2 * Math.sin((2 * Math.PI * 210 * i) / PCM_SAMPLE_RATE);
  }
  return out;
}

// Decision 2026-11-28 (owner feedback): convert brand and technical names to spoken form for TTS without altering captions or script text.
test("toSpokenForm: rewrites brand, AI, hardware and Riemann names in a single pass while preserving possessives and inline overrides", () => {
  const line =
    "OpenAI's Codex competes with Anthropic, DeepSeek-R1, DeepSeek-V3, Llama 3.1 405B, Claude and Gemini on H100 and H800 GPUs for LLMs.";
  const spoken = toSpokenForm(line);
  assert.equal(
    spoken,
    "Open A.I.'s Codex competes with Anthropic, DeepSeek R 1, DeepSeek V 3, Llama 3.1 405 B, Claude and Gemini on H 100 and H 800 G.P.U.s for L.L.M.s.",
  );

  assert.equal(toSpokenForm("Epoch AI estimated training costs."), "Epoch A.I. estimated training costs.");
  assert.equal(toSpokenForm("Euler and Dirichlet studied the Riemann zeta function."), "Oiler and Deer-ish-lay studied the Riemann zeta function.");

  // Inline {written|spoken} overrides win for TTS while stripSpokenMarkup keeps the clean written spelling.
  const annotated = "Meet {HNSW|H N S W} from OpenAI.";
  assert.equal(stripSpokenMarkup(annotated), "Meet HNSW from OpenAI.");
  assert.equal(toSpokenForm(annotated), "Meet H N S W from Open A.I..");
});

// Decision 2026-11-28: standing transcript check fails on known mispronunciations ("OpenEye", "Entropic") and passes when heard cleanly.
test("verifyPronunciationTranscript: fails when OpenAI or Anthropic is misheard and passes when every lexicon term is heard as intended", () => {
  const script = "How do smaller AI labs compete with companies like OpenAI, Google and Anthropic?";

  // Reproduce the exact mispronunciations measured from the 2026-11-28 distill-long narration.
  const bad = verifyPronunciationTranscript(
    script,
    "How do smaller AI labs compete with companies like OpenEye? Google and Entropic?",
  );
  assert.equal(bad.status, "failed");
  assert.equal(bad.terms.find((t) => t.written === "OpenAI")?.passed, false);
  assert.deepEqual(bad.terms.find((t) => t.written === "OpenAI")?.rejectedHits, ["openeye"]);
  assert.equal(bad.terms.find((t) => t.written === "Anthropic")?.passed, false);
  assert.deepEqual(bad.terms.find((t) => t.written === "Anthropic")?.rejectedHits, ["entropic"]);
  assert.equal(bad.failures.length, 2);

  // Corrected narration: Whisper hears "OpenAI" (or "Open AI") and "Anthropic".
  const goodExact = verifyPronunciationTranscript(
    script,
    "How do smaller AI labs compete with companies like OpenAI, Google and Anthropic?",
  );
  assert.equal(goodExact.status, "passed");
  assert.deepEqual(goodExact.failures, []);

  const goodSpaced = verifyPronunciationTranscript(
    script,
    "How do smaller AI labs compete with companies like Open AI, Google and Anthropic?",
  );
  assert.equal(goodSpaced.status, "passed");

  // Multi-occurrence scripts require every occurrence of a lexicon term to be heard cleanly.
  const repeatedScript = "OpenAI builds Codex. OpenAI also reported distillation campaigns.";
  const onlyOneHeard = verifyPronunciationTranscript(
    repeatedScript,
    "OpenAI builds Codex. OpenEye also reported distillation campaigns.",
  );
  assert.equal(onlyOneHeard.status, "failed");
  assert.match(onlyOneHeard.failures[0], /OpenAI/);

  // Longest-first counting avoids double-counting DeepSeek-V3 as both DeepSeek-V3 and DeepSeek.
  const counts = countLexiconTermsInScript("DeepSeek trained DeepSeek-V3 using DeepSeek-R1.");
  assert.deepEqual(
    counts.map((c) => [c.entry.written, c.count]),
    [
      ["DeepSeek", 1],
      ["DeepSeek-V3", 1],
      ["DeepSeek-R1", 1],
    ],
  );
});

// Decision 2026-11-28: produceAudioPipeline sends spoken form to TTS, preserves written form in captions/words, invalidates cache on lexicon edits, and gates on ASR check.
test("produceAudioPipeline: speaks lexicon spoken forms, preserves written captions, and enforces the standing pronunciation gate", async () => {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-pron-pipeline-"));
  const spokenSentToTts: string[] = [];
  const backend: TtsBackend = {
    name: "pron-test",
    maxChars: 1800,
    async synthesize(text) {
      spokenSentToTts.push(text);
      return steadyTone(1.5);
    },
  };
  const line = "Companies like OpenAI and Anthropic train models on H100 GPUs.";

  try {
    // Passing ASR transcript: succeeds, TTS received spoken form, captions and words kept exact written form.
    const ok = await produceAudioPipeline([line], pkg, {
      ttsBackendInstance: backend,
      narrationRate: 1,
      pronunciationTranscriber: async () => ({
        engine: "test-whisper",
        model: "small.en",
        transcript: "Companies like OpenAI and Anthropic train models on H100 GPUs.",
      }),
    });
    assert.deepEqual(spokenSentToTts, ["Companies like Open A.I. and Anthropic train models on H 100 G.P.U.s."]);
    assert.equal(ok.segments[0].text, line, "written spelling stays intact in narration segments");
    assert.match(ok.captionsVttContent, /OpenAI/, "written spelling stays intact in captions");
    assert.equal(ok.pronunciationCheck?.status, "passed");
    assert.match(ok.pronunciationCheck?.method ?? "", /no audio output on headless host/);

    // Failing ASR transcript ("OpenEye"): standing gate rejects before rendering.
    await assert.rejects(
      () =>
        produceAudioPipeline([line], pkg, {
          ttsBackendInstance: backend,
          narrationRate: 1,
          pronunciationTranscriber: async () => ({
            engine: "test-whisper",
            model: "small.en",
            transcript: "Companies like OpenEye and Anthropic train models on H100 GPUs.",
          }),
        }),
      (err: unknown) => {
        assert.ok(err instanceof PronunciationCheckError);
        assert.equal(err.report.status, "failed");
        assert.match(err.message, /OpenAI/);
        assert.match(err.message, /openeye/i);
        return true;
      },
    );

    // Changing a lexicon entry changes lineVoiceKey so stale cached recordings are never reused.
    const custom: PronunciationEntry[] = [
      { written: "OpenAI", spoken: "Open A I", acceptedHeard: ["openai", "open ai", "open a i"] },
    ];
    const merged = mergePronunciationLexicon(custom);
    assert.notEqual(lexiconFingerprint(DEFAULT_PRONUNCIATION_LEXICON), lexiconFingerprint(merged));
    assert.notEqual(lineVoiceKey(backend, 1), lineVoiceKey(backend, 1, undefined, merged));
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});

// Missing local speech recognition is reported as skipped, never as a silent pass; strict mode rejects it.
test("checkNarrationPronunciation: missing ASR engine is reported as skipped, never passed", async () => {
  const script = "OpenAI and Anthropic build frontier models.";
  const skipped = await checkNarrationPronunciation(script, "/tmp/unused.wav", {
    transcriber: async () => {
      throw new PronunciationAsrUnavailableError("no local speech-to-text engine installed");
    },
  });
  assert.equal(skipped.status, "skipped");
  assert.match(skipped.reason ?? "", /no local speech-to-text engine/);
  assert.equal(skipped.terms.length, 2);

  // Scripts with no lexicon terms pass immediately without calling ASR.
  let asrCalled = false;
  const plain = await checkNarrationPronunciation("The quick brown fox jumps over the lazy dog.", "/tmp/unused.wav", {
    transcriber: async () => {
      asrCalled = true;
      return { engine: "test", model: "small", transcript: "" };
    },
  });
  assert.equal(plain.status, "passed");
  assert.equal(asrCalled, false);
});

// Argument checks on narrationTranscribe.py stop immediately with a one-line message and no traceback (needs no whisper install).
test("narrationTranscribe.py refuses unusable arguments with a one-line message instead of a traceback", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-transcribe-args-"));
  try {
    const wav = path.join(dir, "vo.wav");
    const out = path.join(dir, "out.json");
    fs.writeFileSync(wav, "not audio");
    const cases: Array<[string[], RegExp]> = [
      [[], /usage: narrationTranscribe\.py/],
      [[path.join(dir, "missing.wav"), out], /audio file not found/],
      [[wav, path.join(dir, "nope", "out.json")], /output folder not found/],
    ];
    for (const [args, expected] of cases) {
      const r = spawnSyncBounded("python3", ["-I", TRANSCRIBE_SCRIPT, ...args], { encoding: "utf8", timeout: 20_000 });
      assert.equal(r.status, 1, `${args.join(" ")}: ${r.stderr}`);
      assert.match(r.stderr, expected);
      assert.doesNotMatch(r.stderr, /Traceback/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
