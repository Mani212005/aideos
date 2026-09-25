/**
 * File Description: Regression tests for the voiceover provider chain. It pins the hosted failure:
 * on a 512 MB container the Kokoro model must never be loaded (it OOM-killed the server), the
 * chain must fall through to a configured cloud provider, and a total failure must say why.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { synthesizeVoiceover, VoiceSynthesisError, kokoroFits, pcm16ToWav, wavDataChunk } from "./voiceSynthesis.ts";
import type { SynthesisDeps, SynthesisRequest } from "./voiceSynthesis.ts";

const MB = 1024 ** 2;

/** Builds a request with trivial chunking. */
function request(overrides: Partial<SynthesisRequest> = {}): SynthesisRequest {
  return { text: "Hello there.", voice: "kokoro-am_adam", chunk: (t) => [t], trimSilence: (s) => s, ...overrides };
}

/** Builds deps where every provider fails loudly unless a test replaces it. */
function deps(overrides: Partial<SynthesisDeps> = {}): SynthesisDeps {
  return {
    fetch: (async () => {
      throw new Error("network must not be used");
    }) as unknown as typeof fetch,
    kokoro: async () => {
      throw new Error("kokoro must not be used");
    },
    say: async () => null,
    memoryLimitBytes: () => 512 * MB,
    platform: "linux",
    ...overrides,
  };
}

test("kokoro is never loaded on a 512 MB container and Deepgram serves the request", async () => {
  let kokoroCalls = 0;
  const pcm = Buffer.alloc(200);
  const out = await synthesizeVoiceover(
    request({ deepgramKey: "k" }),
    deps({
      kokoro: async () => {
        kokoroCalls++;
        throw new Error("boom");
      },
      fetch: (async () => new Response(pcm)) as unknown as typeof fetch,
    }),
    {},
  );
  assert.equal(kokoroCalls, 0);
  assert.equal(out.provider, "deepgram");
  assert.equal(wavDataChunk(out.wav).length, 200);
});

test("kokoro runs when the host has the memory", async () => {
  const out = await synthesizeVoiceover(
    request(),
    deps({ memoryLimitBytes: () => 4096 * MB, kokoro: async () => ({ samples: new Float32Array(2400).fill(0.1), sampleRate: 24000 }) }),
    {},
  );
  assert.equal(out.provider, "kokoro");
});

test("no provider available reports every reason", async () => {
  await assert.rejects(
    () => synthesizeVoiceover(request(), deps(), {}),
    (err: unknown) => {
      assert.ok(err instanceof VoiceSynthesisError);
      assert.deepEqual(err.attempts.map((a) => a.provider), ["kokoro", "deepgram", "google", "say"]);
      assert.match(err.message, /DEEPGRAM_API_KEY is not set/);
      assert.match(err.message, /host limit is 512 MB/);
      return true;
    },
  );
});

test("a rejecting Deepgram falls through to Google and long text is chunked", async () => {
  const calls: string[] = [];
  const wav = pcm16ToWav(Buffer.alloc(100), 24000).toString("base64");
  const out = await synthesizeVoiceover(
    request({ deepgramKey: "d", googleKey: "g", chunk: () => ["a", "b"] }),
    deps({
      fetch: (async (url: string) => {
        calls.push(url);
        if (url.includes("deepgram")) return new Response("bad key", { status: 401 });
        return new Response(JSON.stringify({ audioContent: wav }));
      }) as unknown as typeof fetch,
    }),
    {},
  );
  assert.equal(out.provider, "google");
  assert.equal(calls.filter((c) => c.includes("deepgram")).length, 1);
  assert.equal(wavDataChunk(out.wav).length, 200);
});

test("kokoroFits honours the override and the memory limit", () => {
  assert.equal(kokoroFits(512 * MB, {}), false);
  assert.equal(kokoroFits(8192 * MB, {}), true);
  assert.equal(kokoroFits(512 * MB, { AIDEOS_KOKORO: "1" }), true);
  assert.equal(kokoroFits(8192 * MB, { AIDEOS_KOKORO: "0" }), false);
});
