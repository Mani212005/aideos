/**
 * File Description: Unit tests encoding the captain's rules for the local cloned-voice (`vcd`)
 * speech backend: loopback-only URL enforcement, /v1/jobs submit-poll-audio flow for English and
 * Hindi/Hinglish, plain unreachable errors with no silent swap to another voice, cache fingerprints
 * carrying voice identity, and end-card voice recognition, plus owner-voice resolution that never
 * picks an arbitrary enrolled voice and one operation deadline over every vcd phase. HTTP calls are
 * injected, except the stalled-body case which uses a real loopback server.
 * Inputs and outputs: mocked fetch/sleep/clock deps and temp package dirs -> assertions on vcdClient, tts, voiceSynthesis, and audio pipeline.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  assertLoopbackVcdUrl,
  detectVcdLanguage,
  listVcdVoices,
  resolveVcdVoiceId,
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
    assert.deepEqual(narrationVoiceOf(first), { backend: "vcd", voice: "voice_alpha", speed: null, language: "auto" });

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

// Voice resolution: the owner's voice is explicit, uniquely named, or the only one enrolled; never an arbitrary pick.

const VCD = "http://127.0.0.1:8740";

/** Fetch that serves only GET /v1/voices with the given enrolled voices. */
function voicesOnlyFetch(voices: Array<{ id: string; name: string }>): typeof fetch {
  return (async () => new Response(JSON.stringify({ voices }), { status: 200 })) as unknown as typeof fetch;
}

test("vcd resolution picks the one owner-named voice among several, ignoring case", async () => {
  const deps = {
    fetch: voicesOnlyFetch([
      { id: "voice_guest", name: "guest" },
      { id: "voice_owner", name: "Me" },
    ]),
  };
  const resolved = await resolveVcdVoiceId({ url: VCD }, deps);
  assert.equal(resolved.voiceId, "voice_owner");
  assert.equal(resolved.voiceName, "Me");
});

test("vcd resolution uses the only enrolled voice even when it is not named like the owner", async () => {
  const resolved = await resolveVcdVoiceId({ url: VCD }, { fetch: voicesOnlyFetch([{ id: "voice_solo", name: "mani" }]) });
  assert.equal(resolved.voiceId, "voice_solo");
});

test("vcd resolution refuses to guess among several voices and lists the choices", async () => {
  const deps = {
    fetch: voicesOnlyFetch([
      { id: "voice_a", name: "alpha" },
      { id: "voice_b", name: "beta" },
    ]),
  };
  await assert.rejects(
    () => resolveVcdVoiceId({ url: VCD }, deps),
    (err: unknown) => {
      assert.ok(err instanceof VcdUnavailableError);
      assert.equal(err.code, "ambiguous_voice");
      assert.match(err.message, /alpha \(voice_a\)/);
      assert.match(err.message, /beta \(voice_b\)/);
      assert.match(err.message, /AIDEOS_VCD_VOICE_ID/);
      return true;
    },
  );
});

test("vcd resolution refuses two owner-named voices instead of taking the first", async () => {
  const deps = {
    fetch: voicesOnlyFetch([
      { id: "voice_1", name: "my-voice" },
      { id: "voice_2", name: "me" },
      { id: "voice_3", name: "guest" },
    ]),
  };
  await assert.rejects(
    () => resolveVcdVoiceId({ url: VCD }, deps),
    (err: unknown) => {
      assert.ok(err instanceof VcdUnavailableError);
      assert.equal(err.code, "ambiguous_voice");
      assert.match(err.message, /voice_1/);
      assert.match(err.message, /voice_2/);
      assert.doesNotMatch(err.message, /voice_3/, "only the competing owner-named voices are listed");
      return true;
    },
  );
});

test("vcd resolution matches a configured voice by id or name and rejects an unknown one with the choices", async () => {
  const deps = {
    fetch: voicesOnlyFetch([
      { id: "voice_a", name: "alpha" },
      { id: "voice_b", name: "beta" },
    ]),
  };
  assert.equal((await resolveVcdVoiceId({ url: VCD, voiceId: "voice_b" }, deps)).voiceName, "beta");
  assert.equal((await resolveVcdVoiceId({ url: VCD, voiceId: "alpha" }, deps)).voiceId, "voice_a");
  await assert.rejects(
    () => resolveVcdVoiceId({ url: VCD, voiceId: "voice_zzz" }, deps),
    (err: unknown) => {
      assert.ok(err instanceof VcdUnavailableError);
      assert.equal(err.code, "voice_not_found");
      assert.match(err.message, /alpha \(voice_a\)/);
      return true;
    },
  );
});

test("vcd resolution reports an empty service as no voice enrolled", async () => {
  await assert.rejects(
    () => resolveVcdVoiceId({ url: VCD }, { fetch: voicesOnlyFetch([]) }),
    (err: unknown) => err instanceof VcdUnavailableError && err.code === "no_voice_enrolled",
  );
});

test("synthesis without a voice id submits no job when the owner voice is ambiguous", async () => {
  const seenJobs: Array<{ voice_id: string; language: string; text: string }> = [];
  const fetchImpl = makeMockVcdFetch({
    voices: [
      { id: "voice_a", name: "alpha" },
      { id: "voice_b", name: "beta" },
    ],
    seenJobs,
  });
  await assert.rejects(
    () => synthesizeWithVcd({ text: "Hello there.", url: VCD }, { fetch: fetchImpl, sleep: async () => {} }),
    (err: unknown) => err instanceof VcdUnavailableError && err.code === "ambiguous_voice",
  );
  assert.equal(seenJobs.length, 0, "must not narrate as an arbitrary enrolled voice");
});

// Deadline: timeoutMs bounds the whole synthesis (discovery, submit and its retries, polling, audio download).

/** A manual clock plus a sleep that advances it, so deadline behaviour needs no real waiting. */
function manualClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

test("every vcd request carries an abort signal", async () => {
  const signals: Array<AbortSignal | null | undefined> = [];
  const inner = makeMockVcdFetch({ voices: [{ id: "voice_owner_1", name: "my-voice" }] });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    signals.push(init?.signal);
    return inner(input, init);
  }) as typeof fetch;
  await synthesizeWithVcd({ text: "Check signals.", url: VCD }, { fetch: fetchImpl, sleep: async () => {} });
  assert.ok(signals.length >= 4, "voices, submit, polls and audio");
  assert.ok(signals.every((s) => s instanceof AbortSignal));
});

test("a job that never finishes times out after timeoutMs of injected time, not before", async () => {
  const clock = manualClock();
  let polls = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/v1/jobs") && init?.method === "POST") return new Response(JSON.stringify({ id: "job_1" }), { status: 202 });
    if (url.endsWith("/v1/jobs/job_1")) {
      polls += 1;
      return new Response(JSON.stringify({ state: "running" }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  await assert.rejects(
    () =>
      synthesizeWithVcd(
        { text: "Never done.", url: VCD, voiceId: "voice_x", timeoutMs: 1000, pollIntervalMs: 250 },
        { fetch: fetchImpl, sleep: clock.sleep, now: clock.now },
      ),
    (err: unknown) => {
      assert.ok(err instanceof VcdUnavailableError);
      assert.equal(err.code, "timeout");
      assert.match(err.message, /job_1/);
      return true;
    },
  );
  assert.equal(polls, 4, "polls at 0, 250, 500 and 750 ms, then the 1000 ms budget is spent");
});

test("voice discovery counts against timeoutMs: a spent budget submits nothing", async () => {
  const clock = manualClock();
  const seenJobs: Array<{ voice_id: string; language: string; text: string }> = [];
  const inner = makeMockVcdFetch({ voices: [{ id: "voice_owner_1", name: "my-voice" }], seenJobs });
  const slowDiscovery = (async (input: string | URL | Request, init?: RequestInit) => {
    const res = await inner(input, init);
    if (String(input).endsWith("/v1/voices")) clock.advance(2000);
    return res;
  }) as typeof fetch;

  await assert.rejects(
    () => synthesizeWithVcd({ text: "Too slow.", url: VCD, timeoutMs: 1500 }, { fetch: slowDiscovery, sleep: clock.sleep, now: clock.now }),
    (err: unknown) => err instanceof VcdUnavailableError && err.code === "timeout",
  );
  assert.equal(seenJobs.length, 0);
});

test("a full queue (HTTP 429) retries within the budget and never sleeps past it", async () => {
  const clock = manualClock();
  const sleeps: number[] = [];
  let submits = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/v1/jobs") && init?.method === "POST") {
      submits += 1;
      return new Response("{}", { status: 429, headers: { "retry-after": "5" } });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  await assert.rejects(
    () =>
      synthesizeWithVcd(
        { text: "Queue full.", url: VCD, voiceId: "voice_x", timeoutMs: 7000 },
        {
          fetch: fetchImpl,
          sleep: async (ms) => {
            sleeps.push(ms);
            await clock.sleep(ms);
          },
          now: clock.now,
        },
      ),
    (err: unknown) => err instanceof VcdUnavailableError && err.code === "timeout",
  );
  assert.deepEqual(sleeps, [5000, 2000], "second wait is clamped to what is left of the 7000 ms budget");
  assert.equal(submits, 2, "with the budget spent no third request is even made");
});

test("a request that hangs forever is aborted by the budget and reported as a timeout", async (t) => {
  // A real hung socket keeps the event loop alive; this mock has none, so hold the loop open until the abort fires.
  const keepAlive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keepAlive));
  const hanging = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
    })) as typeof fetch;
  await assert.rejects(
    () => synthesizeWithVcd({ text: "Hang.", url: VCD, voiceId: "voice_x", timeoutMs: 50 }, { fetch: hanging, sleep: async () => {} }),
    (err: unknown) => err instanceof VcdUnavailableError && err.code === "timeout",
  );
  await assert.rejects(
    () => listVcdVoices(VCD, { fetch: hanging }, 50),
    (err: unknown) => err instanceof VcdUnavailableError && err.code === "timeout",
  );
});

test("an audio download whose body stalls is cut off by the budget (real loopback server)", async (t) => {
  const sockets = new Set<import("node:net").Socket>();
  const server = http.createServer((req, res) => {
    if (req.url === "/v1/jobs" && req.method === "POST") {
      res.writeHead(202, { "Content-Type": "application/json" }).end(JSON.stringify({ id: "job_1" }));
    } else if (req.url === "/v1/jobs/job_1") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ state: "succeeded", audio_seconds: 1 }));
    } else if (req.url === "/v1/jobs/job_1/audio") {
      // Promise a large body, send a little, then stall: only a deadline on the body read can end this.
      res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": "1000000" });
      res.write(Buffer.alloc(100));
    } else {
      res.writeHead(404).end();
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const port = (server.address() as AddressInfo).port;

  await assert.rejects(
    () => synthesizeWithVcd({ text: "Stalled body.", url: `http://127.0.0.1:${port}`, voiceId: "voice_x", timeoutMs: 400, pollIntervalMs: 10 }),
    (err: unknown) => err instanceof VcdUnavailableError && err.code === "timeout",
  );
});
