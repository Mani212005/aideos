/**
 * File Description: Unit tests encoding the captain's rules for the local cloned-voice (`vcd`)
 * speech backend: loopback-only URL enforcement, /v1/jobs submit-poll-audio flow for English and
 * Hindi/Hinglish, plain unreachable errors with no silent swap to another voice, cache fingerprints
 * carrying voice identity, and end-card voice recognition. All HTTP calls are injected.
 * Inputs and outputs: mocked fetch/sleep deps and temp package dirs -> assertions on vcdClient, tts, voiceSynthesis, and audio pipeline.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertLoopbackVcdUrl,
  detectVcdLanguage,
  synthesizeWithVcd,
  VcdUnavailableError,
  vcdVoiceCacheKey,
} from "./vcdClient";
import { createTtsBackend, PCM_SAMPLE_RATE } from "./tts";
import { synthesizeVoiceover, VoiceSynthesisError, pcm16ToWav } from "./voiceSynthesis";
import { produceAudioPipeline } from "./audio";
import { encodeWav } from "./pcm";
import { narrationVoiceOf } from "./endCard/voice";

/** Builds a valid 0.6s 24 kHz mono WAV buffer containing an audible sine tone. */
function toneWav(freqHz = 220, durationSec = 0.6): Buffer {
  const length = Math.round(PCM_SAMPLE_RATE * durationSec);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    samples[i] = 0.25 * Math.sin((2 * Math.PI * freqHz * i) / PCM_SAMPLE_RATE);
  }
  return encodeWav(samples, PCM_SAMPLE_RATE);
}

/** Builds a mocked vcd HTTP fetch that handles /v1/voices, /v1/jobs, poll, and /audio. */
function makeMockVcdFetch(options: {
  voices: Array<{ id: string; name: string }>;
  wavByVoice?: Record<string, Buffer>;
  seenJobs?: Array<{ voice_id: string; language: string; text: string }>;
}): typeof fetch {
  let jobCounter = 0;
  const polls = new Map<string, number>();
  const jobVoice = new Map<string, string>();

  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";

    if (url.endsWith("/v1/voices") && method === "GET") {
      return new Response(JSON.stringify({ voices: options.voices }), { status: 200 });
    }
    if (url.endsWith("/v1/jobs") && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { voice_id: string; language: string; text: string };
      options.seenJobs?.push(body);
      jobCounter += 1;
      const id = `job_test_${jobCounter}`;
      polls.set(id, 0);
      jobVoice.set(id, body.voice_id);
      return new Response(JSON.stringify({ id, state: "queued" }), { status: 202 });
    }
    const audioMatch = url.match(/\/v1\/jobs\/([^/]+)\/audio$/);
    if (audioMatch && method === "GET") {
      const vid = jobVoice.get(audioMatch[1]) ?? "";
      const wav = options.wavByVoice?.[vid] ?? toneWav();
      return new Response(new Uint8Array(wav), { status: 200, headers: { "Content-Type": "audio/wav" } });
    }
    const pollMatch = url.match(/\/v1\/jobs\/([^/]+)$/);
    if (pollMatch && method === "GET") {
      const id = pollMatch[1];
      const count = (polls.get(id) ?? 0) + 1;
      polls.set(id, count);
      const state = count >= 2 ? "succeeded" : "running";
      return new Response(JSON.stringify({ id, state, audio_seconds: state === "succeeded" ? 0.6 : null }), { status: 200 });
    }
    return new Response(JSON.stringify({ detail: "not found" }), { status: 404 });
  }) as unknown as typeof fetch;
}

test("vcd URL validation enforces loopback-only addresses", () => {
  assert.equal(assertLoopbackVcdUrl("http://127.0.0.1:8740/"), "http://127.0.0.1:8740");
  assert.equal(assertLoopbackVcdUrl("http://localhost:8740"), "http://localhost:8740");
  assert.equal(assertLoopbackVcdUrl("http://[::1]:8740"), "http://[::1]:8740");
  assert.throws(() => assertLoopbackVcdUrl("http://192.168.1.20:8740"), /non-loopback/);
  assert.throws(() => assertLoopbackVcdUrl("https://example.com"), /http:\/\//);
});

test("vcd synthesizes English, Devanagari Hindi, and explicit Hinglish via /v1/jobs -> poll -> audio", async () => {
  const seenJobs: Array<{ voice_id: string; language: string; text: string }> = [];
  const mockFetch = makeMockVcdFetch({
    voices: [{ id: "voice_owner_1", name: "my-voice" }],
    seenJobs,
  });
  const deps = { fetch: mockFetch, sleep: async () => {} };

  const en = await synthesizeWithVcd({ text: "Audio drives the timeline.", url: "http://127.0.0.1:8740" }, deps);
  assert.equal(en.voiceId, "voice_owner_1");
  assert.equal(en.language, "en");
  assert.equal(en.sampleRate, 24000);

  const devanagari = await synthesizeWithVcd({ text: "नमस्ते, यह मेरी आवाज़ है।", url: "http://127.0.0.1:8740" }, deps);
  assert.equal(devanagari.language, "hi");

  const hinglish = await synthesizeWithVcd(
    { text: "Namaste, aaj hum audio sync dekhenge.", url: "http://127.0.0.1:8740", language: "hi" },
    deps,
  );
  assert.equal(hinglish.language, "hi");

  assert.deepEqual(
    seenJobs.map((j) => [j.voice_id, j.language]),
    [
      ["voice_owner_1", "en"],
      ["voice_owner_1", "hi"],
      ["voice_owner_1", "hi"],
    ],
  );
  assert.equal(detectVcdLanguage("Hello world", "auto"), "en");
  assert.equal(detectVcdLanguage("नमस्ते दुनिया", "auto"), "hi");
  assert.equal(detectVcdLanguage("Namaste duniya", "hi"), "hi");
});

test("unreachable vcd fails plainly and never silently swaps to another voice in CLI or Studio", async () => {
  const refusingFetch = (async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:8740");
  }) as unknown as typeof fetch;

  await assert.rejects(
    () => createTtsBackend({ vcdUrl: "http://127.0.0.1:8740", vcdDeps: { fetch: refusingFetch, sleep: async () => {} } }),
    (err: unknown) => {
      assert.ok(err instanceof VcdUnavailableError);
      assert.equal(err.code, "unreachable");
      assert.match(err.message, /vcd serve/);
      assert.match(err.message, /127\.0\.0\.1:8740/);
      return true;
    },
  );

  let fallbackCalled = 0;
  await assert.rejects(
    () =>
      synthesizeVoiceover(
        {
          text: "Do not swap my voice.",
          voice: "vcd-my-voice",
          vcdUrl: "http://127.0.0.1:8740",
          deepgramKey: "dg-key",
          googleKey: "g-key",
          chunk: (t) => [t],
          trimSilence: (s) => s,
        },
        {
          fetch: refusingFetch,
          kokoro: async () => {
            fallbackCalled += 1;
            return { samples: new Float32Array(2400), sampleRate: 24000 };
          },
          say: async () => {
            fallbackCalled += 1;
            return pcm16ToWav(Buffer.alloc(200), 24000);
          },
          memoryLimitBytes: () => 8 * 1024 ** 3,
          platform: "darwin",
        },
        {},
      ),
    (err: unknown) => {
      assert.ok(err instanceof VoiceSynthesisError);
      assert.deepEqual(err.attempts.map((a) => a.provider), ["vcd"]);
      assert.match(err.attempts[0].reason, /vcd serve/);
      return true;
    },
  );
  assert.equal(fallbackCalled, 0, "must never silently fall back to Kokoro, Deepgram, Google, or say");
});

test("per-line cache fingerprint includes vcd voice identity and switching voice never reuses another voice's audio", async () => {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-vcd-cache-"));
  try {
    const seenJobs: Array<{ voice_id: string; language: string; text: string }> = [];
    const mockFetch = makeMockVcdFetch({
      voices: [
        { id: "voice_alpha", name: "alpha" },
        { id: "voice_beta", name: "beta" },
      ],
      wavByVoice: {
        voice_alpha: toneWav(220, 0.7),
        voice_beta: toneWav(440, 0.9),
      },
      seenJobs,
    });
    const vcdDeps = { fetch: mockFetch, sleep: async () => {} };

    const backendA = await createTtsBackend({
      backend: "vcd",
      voice: "voice_alpha",
      vcdUrl: "http://127.0.0.1:8740",
      vcdDeps,
    });
    const first = await produceAudioPipeline(["First line of narration.", "Second line of narration."], pkg, {
      ttsBackendInstance: backendA,
    });
    assert.equal(first.ttsBackend, vcdVoiceCacheKey("voice_alpha", "auto"));
    assert.deepEqual(first.lines, { recorded: 2, reused: 0 });
    assert.deepEqual(narrationVoiceOf(first), { backend: "vcd", voice: "voice_alpha", speed: null });

    // Re-running with the same voice reuses both cached lines without calling vcd again.
    seenJobs.length = 0;
    const repeat = await produceAudioPipeline(["First line of narration.", "Second line of narration."], pkg, {
      ttsBackendInstance: backendA,
    });
    assert.deepEqual(repeat.lines, { recorded: 0, reused: 2 });
    assert.equal(seenJobs.length, 0);

    // Switching to another enrolled voice id must re-record instead of reusing voice_alpha's cache.
    const backendB = await createTtsBackend({
      backend: "vcd",
      voice: "voice_beta",
      vcdUrl: "http://127.0.0.1:8740",
      vcdDeps,
    });
    const switched = await produceAudioPipeline(["First line of narration.", "Second line of narration."], pkg, {
      ttsBackendInstance: backendB,
    });
    assert.deepEqual(switched.lines, { recorded: 2, reused: 0 });
    assert.equal(seenJobs.length, 2);
    assert.ok(switched.totalAudioDuration > first.totalAudioDuration);
  } finally {
    fs.rmSync(pkg, { recursive: true, force: true });
  }
});
