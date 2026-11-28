/**
 * File Description: Tests for local post-synthesis narration voice cleanup (owner decision 2026-11-28).
 * Verifies default-ON refusal when unconfigured (never silently skips), the explicit off switch
 * (AIDEOS_NARRATION_CLEANUP=off and narrationCleanup.enabled=false), single cleaned output with no
 * plain-and-cleaned pair, and that the standing in-sentence flow and pronunciation checks run on the
 * FINAL cleaned audio. Uses fake local commands and synthetic tones; no voice audio or model weights.
 * Inputs and outputs: synthetic WAV narration, fake cleanup commands and config/env -> cleanup and gate assertions.
 * Used by: bun run test / npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyNarrationCleanup,
  NarrationCleanupError,
  narrationCleanupFingerprint,
  NARRATION_CLEANUP_CMD_ENV,
  NARRATION_CLEANUP_ENV,
  resolveNarrationCleanupConfig,
} from "./narrationCleanup";
import { loadAideosConfig } from "./aideosConfig";
import { produceAudioPipeline } from "./audio";
import { NarrationFlowError } from "./narrationFlow";
import { PronunciationAsrUnavailableError, PronunciationCheckError } from "./narrationPronunciation";
import { decodeWav, encodeWav } from "./pcm";
import { PCM_SAMPLE_RATE, type TtsBackend } from "./tts";

// Builds a steady non-silent synthetic speech signal at PCM_SAMPLE_RATE.
function steadyTone(seconds = 1.6, amplitude = 0.25): Float32Array {
  const out = new Float32Array(Math.round(seconds * PCM_SAMPLE_RATE));
  for (let i = 0; i < out.length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / PCM_SAMPLE_RATE);
  }
  return out;
}

// Decision 2026-11-28: cleanup is ON by default; when unconfigured it must fail plainly naming the setting rather than silently skipping, and AIDEOS_NARRATION_CLEANUP=off turns it off.
test("narration cleanup: ON by default fails plainly when unconfigured; off switch disables cleanly", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-cleanup-cfg-"));
  const wavPath = path.join(dir, "voiceover.wav");
  fs.writeFileSync(wavPath, encodeWav(steadyTone(1.2), PCM_SAMPLE_RATE));
  const emptyConfig = path.join(dir, "aideos.config.json");
  fs.writeFileSync(
    emptyConfig,
    JSON.stringify({
      schema: "aideos.config/1",
      videoModels: { reviewer: { agent: "agy", model: "gemini-3.8-flash-low" }, forbiddenGenerationModels: [] },
    }),
  );

  try {
    // Default ON with no command -> fails plainly naming the env var, config key and off switch.
    const defaultCfg = resolveNarrationCleanupConfig({ env: {}, configFile: emptyConfig });
    assert.equal(defaultCfg.enabled, true);
    assert.equal(defaultCfg.command, "");

    await assert.rejects(
      () => applyNarrationCleanup(wavPath, { env: {}, configFile: emptyConfig }),
      (err: unknown) => {
        assert.ok(err instanceof NarrationCleanupError);
        assert.equal(err.code, "not_configured");
        assert.match(err.message, new RegExp(NARRATION_CLEANUP_CMD_ENV));
        assert.match(err.message, /narrationCleanup\.command/);
        assert.match(err.message, new RegExp(`${NARRATION_CLEANUP_ENV}=off`));
        return true;
      },
    );

    // Explicit off switch via env disables cleanly.
    const disabled = await applyNarrationCleanup(wavPath, {
      env: { [NARRATION_CLEANUP_ENV]: "off" },
      configFile: emptyConfig,
    });
    assert.equal(disabled.status, "disabled");
    assert.equal(disabled.commandHash, null);

    // Invalid toggle or command template missing {in}/{out} fails plainly.
    assert.throws(
      () => resolveNarrationCleanupConfig({ env: { [NARRATION_CLEANUP_ENV]: "maybe" }, configFile: emptyConfig }),
      NarrationCleanupError,
    );
    await assert.rejects(
      () => applyNarrationCleanup(wavPath, { enabled: true, command: "cp only-in {in}", env: {}, configFile: emptyConfig }),
      (err: unknown) => err instanceof NarrationCleanupError && err.code === "invalid_config",
    );

    // aideos.config.json narrationCleanup section is parsed and honoured.
    const customConfig = path.join(dir, "custom.config.json");
    fs.writeFileSync(
      customConfig,
      JSON.stringify({
        schema: "aideos.config/1",
        videoModels: { reviewer: { agent: "agy", model: "gemini-3.8-flash-low" }, forbiddenGenerationModels: [] },
        narrationCleanup: { enabled: false, command: "clean {in} {out}", timeoutSec: 120 },
      }),
    );
    const parsed = loadAideosConfig(customConfig);
    assert.deepEqual(parsed.narrationCleanup, { enabled: false, command: "clean {in} {out}", timeoutSec: 120 });
    assert.equal(narrationCleanupFingerprint({ env: {}, configFile: customConfig }), "cleanup:off");
    assert.match(
      narrationCleanupFingerprint({ env: { [NARRATION_CLEANUP_ENV]: "on" }, configFile: customConfig }),
      /^cleanup:on:[a-f0-9]{12}$/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Decision 2026-11-28: cleanup runs as the last step on generated narration only, leaves a single cleaned file (no pair), and flow + pronunciation checks run on the FINAL cleaned audio.
test("produceAudioPipeline: runs fake local cleanup command on generated narration only, leaves no pair, and verifies final cleaned audio", async () => {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-cleanup-e2e-"));
  const backend: TtsBackend = {
    name: "cleanup-test",
    maxChars: 1800,
    async synthesize() {
      return steadyTone(2.4);
    },
  };
  const line = "OpenAI and Anthropic build frontier models.";

  try {
    // 1) Clean fake local shell command (copies {in} to {out} through /bin/sh): succeeds and leaves ONLY voiceover.wav (no plain/cleaned pair).
    let transcribedBytes = 0;
    const ok = await produceAudioPipeline([line], pkg, {
      ttsBackendInstance: backend,
      narrationRate: 1,
      cleanup: {
        enabled: true,
        command: "cp {in} {out}",
        env: {},
      },
      pronunciationTranscriber: async (wavPath) => {
        transcribedBytes = fs.statSync(wavPath).size;
        return {
          engine: "test-whisper",
          model: "small.en",
          transcript: "OpenAI and Anthropic build frontier models.",
        };
      },
    });
    assert.equal(ok.cleanup?.status, "applied");
    assert.ok(ok.cleanup?.commandHash);
    assert.equal(ok.flowCheck?.passed, true);
    assert.equal(ok.pronunciationCheck?.status, "passed");
    assert.ok(transcribedBytes > 44);
    const wavFiles = fs.readdirSync(pkg).filter((f) => f.endsWith(".wav"));
    assert.deepEqual(wavFiles, ["voiceover.wav"], "only the single cleaned voiceover.wav must remain (no plain-and-cleaned pair)");

    // 2) A broken cleanup command that injects a 0.70 s mid-sentence silence into the cleaned WAV fails the post-cleanup flow gate.
    await assert.rejects(
      () =>
        produceAudioPipeline([line], pkg, {
          ttsBackendInstance: backend,
          narrationRate: 1,
          cleanup: {
            enabled: true,
            command: "fake-gap-cleaner {in} {out}",
            env: {},
            runner: (_cmd, inPath, outPath) => {
              const decoded = decodeWav(fs.readFileSync(inPath));
              const broken = Float32Array.from(decoded.samples);
              const gapStart = Math.round(0.8 * decoded.sampleRate);
              const gapEnd = Math.min(broken.length, Math.round(1.5 * decoded.sampleRate));
              broken.fill(0, gapStart, gapEnd);
              fs.writeFileSync(outPath, encodeWav(broken, decoded.sampleRate));
            },
          },
          pronunciationTranscriber: async () => ({
            engine: "test-whisper",
            model: "small.en",
            transcript: "OpenAI and Anthropic build frontier models.",
          }),
        }),
      (err: unknown) => {
        assert.ok(err instanceof NarrationFlowError, `expected NarrationFlowError on post-cleanup gap, got ${String(err)}`);
        assert.equal(err.report.passed, false);
        assert.equal(err.report.gaps.length, 1);
        return true;
      },
    );

    // 3) A broken cleanup command that alters speech so ASR hears "OpenEye" fails the post-cleanup pronunciation gate.
    await assert.rejects(
      () =>
        produceAudioPipeline([line], pkg, {
          ttsBackendInstance: backend,
          narrationRate: 1,
          cleanup: {
            enabled: true,
            command: "cp {in} {out}",
            env: {},
          },
          pronunciationTranscriber: async () => ({
            engine: "test-whisper",
            model: "small.en",
            transcript: "OpenEye and Anthropic build frontier models.",
          }),
        }),
      (err: unknown) => {
        assert.ok(err instanceof PronunciationCheckError, `expected PronunciationCheckError, got ${String(err)}`);
        assert.match(err.message, /OpenAI/);
        return true;
      },
    );
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});

// Review finding: cleanup that changes the narration length breaks timings and the sentence checks, so it must fail plainly and publish nothing.
test("produceAudioPipeline: a cleanup that changes the narration length, or a missing ASR engine, fails plainly and leaves no voiceover.wav", async () => {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-cleanup-drift-"));
  const backend: TtsBackend = {
    name: "cleanup-test",
    maxChars: 1800,
    async synthesize() {
      return steadyTone(2.4);
    },
  };
  const line = "OpenAI and Anthropic build frontier models.";
  const passingTranscriber = async () => ({ engine: "test-whisper", model: "small.en", transcript: "OpenAI and Anthropic build frontier models." });

  try {
    await assert.rejects(
      () =>
        produceAudioPipeline([line], pkg, {
          ttsBackendInstance: backend,
          narrationRate: 1,
          cleanup: {
            enabled: true,
            command: "fake-trimmer {in} {out}",
            env: {},
            runner: (_cmd, inPath, outPath) => {
              const decoded = decodeWav(fs.readFileSync(inPath));
              const padded = new Float32Array(decoded.samples.length + Math.round(0.4 * decoded.sampleRate));
              padded.set(decoded.samples);
              fs.writeFileSync(outPath, encodeWav(padded, decoded.sampleRate));
            },
          },
          pronunciationTranscriber: passingTranscriber,
        }),
      (err: unknown) => {
        assert.ok(err instanceof NarrationCleanupError);
        assert.equal(err.code, "invalid_output");
        assert.match(err.message, /changed the narration length/);
        assert.match(err.message, /AIDEOS_NARRATION_CLEANUP=off/);
        return true;
      },
    );
    assert.deepEqual(fs.readdirSync(pkg).filter((f) => f.endsWith(".wav")), [], "no uncleaned or unverified wav may be left behind");

    await assert.rejects(
      () =>
        produceAudioPipeline([line], pkg, {
          ttsBackendInstance: backend,
          narrationRate: 1,
          cleanup: { enabled: true, command: "cp {in} {out}", env: {} },
          pronunciationTranscriber: async () => {
            throw new PronunciationAsrUnavailableError("no local speech-to-text engine installed for python3");
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof PronunciationAsrUnavailableError);
        assert.match(err.message, /AIDEOS_PRONUNCIATION_CHECK=off/);
        return true;
      },
    );
    assert.deepEqual(fs.readdirSync(pkg).filter((f) => f.endsWith(".wav")), [], "an unverified wav may not be published");

    // The tone placeholder carries no speech: the report says so explicitly instead of staying silent.
    const tone = await produceAudioPipeline([line], pkg, {
      ttsBackendInstance: { ...backend, name: "tone" },
      narrationRate: 1,
      cleanup: { enabled: false, env: {} },
    });
    assert.equal(tone.pronunciationCheck?.status, "not_applicable");
    assert.deepEqual(fs.readdirSync(pkg).filter((f) => f.endsWith(".wav")), ["voiceover.wav"]);
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});
