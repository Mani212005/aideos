/**
 * File Description: A deterministic stand-in for the owner's local voice service (`vcd`) so every
 * test speaks in the voice of choice without a voice service, a recording or any real speech. It
 * answers the same loopback HTTP API as the real service (GET /v1/voices, POST /v1/jobs, GET
 * /v1/jobs/:id and /audio), so the real vcd client, backend name ("vcd:<voice id>:<language>"), line
 * cache fingerprints and narration.json metadata are the ones production writes. Only the audio is
 * fake: a quiet modulated tone sized from the word count, never speech. Installed by wrapping
 * globalThis.fetch for the default loopback vcd URL only; every other request passes through, and a
 * test can never reach a real service on that address. It carries no voice data of any kind.
 * Inputs and outputs: HTTP requests to http://127.0.0.1:8740 (or localhost) -> fake enrolled voice list, jobs and tone WAV audio.
 * Used by: backend/testSupport/fixtureVideosDir.ts (the npm test preload), backend/testSupport/fakeVcdPreload.ts, backend/voiceOfChoice.test.ts, and every test or script that narrates.
 */

import path from "node:path";
import { encodeWav } from "../pcm";
import { DEFAULT_VCD_URL } from "../vcdClient";

/** The enrolled voice id the fake service reports (the owner's cloned voice, as `voice_...` ids look). */
export const FAKE_OWNER_VOICE_ID = "voice_test_owner_fake";

/** The name the fake voice carries; the client prefers "my-voice" when no id is configured. */
export const FAKE_OWNER_VOICE_NAME = "my-voice";

/** The backend name a default test narration reports, exactly as the real client builds it. */
export const FAKE_OWNER_BACKEND_NAME = `vcd:${FAKE_OWNER_VOICE_ID}:auto`;

const SAMPLE_RATE = 24000;
const WORDS_PER_MINUTE = 150;
const MIN_SECONDS = 0.4;
const LOOPBACK_ALIASES = new Set(["127.0.0.1", "localhost"]);

/** One synthesis job the fake service accepted. */
interface FakeJob {
  text: string;
  language: string;
  seconds: number;
}

/** The fetch signature the fake implements, so it can stand in for global fetch or a client dependency. */
export type FakeFetch = typeof fetch;

// Builds a JSON response.
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Builds an application/problem+json style error like the real service sends.
function problem(status: number, code: string, detail: string): Response {
  return new Response(JSON.stringify({ code, detail, title: detail }), { status, headers: { "Content-Type": "application/problem+json" } });
}

// Sizes a fake line from its word count, matching the pacing the tone placeholder always had.
function secondsFor(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length || 1;
  return Math.max(MIN_SECONDS, (words / WORDS_PER_MINUTE) * 60);
}

// Renders the quiet, slowly modulated tone for a line as a 24 kHz mono 16-bit WAV (never speech).
function toneWav(seconds: number): Buffer {
  const length = Math.round(seconds * SAMPLE_RATE);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    samples[i] = 0.05 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 1.7 * t));
  }
  return encodeWav(samples, SAMPLE_RATE);
}

// Creates a fresh fake voice service: a fetch that answers the vcd API and keeps its jobs in memory.
export function createFakeVcdFetch(): FakeFetch {
  const jobs = new Map<string, FakeJob>();
  let counter = 0;

  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const route = url.pathname.replace(/\/+$/, "");

    if (method === "GET" && route === "/v1/voices") {
      return json({ voices: [{ id: FAKE_OWNER_VOICE_ID, name: FAKE_OWNER_VOICE_NAME, reference_language: "en" }] });
    }

    if (method === "POST" && route === "/v1/jobs") {
      let body: { voice_id?: string; language?: string; text?: string };
      try {
        body = JSON.parse(String(init?.body ?? "{}"));
      } catch {
        return problem(400, "bad_request", "request body is not JSON");
      }
      if (body.voice_id !== FAKE_OWNER_VOICE_ID) return problem(404, "voice_not_found", `voice ${String(body.voice_id)} is not enrolled`);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return problem(422, "empty_text", "text is empty");
      const id = `job_fake_${(++counter).toString().padStart(6, "0")}`;
      jobs.set(id, { text, language: body.language === "hi" ? "hi" : "en", seconds: secondsFor(text) });
      return json({ id, state: "queued" }, 202);
    }

    const jobMatch = /^\/v1\/jobs\/([^/]+)(\/audio)?$/.exec(route);
    if (method === "GET" && jobMatch) {
      const job = jobs.get(decodeURIComponent(jobMatch[1]));
      if (!job) return problem(404, "job_not_found", "unknown job");
      if (jobMatch[2]) return new Response(new Uint8Array(toneWav(job.seconds)), { status: 200, headers: { "Content-Type": "audio/wav" } });
      return json({ id: jobMatch[1], state: "succeeded", error_code: null, audio_seconds: job.seconds });
    }

    return problem(404, "not_found", `the fake voice service has no route ${method} ${route}`);
  };
}

// True when a request targets the default loopback voice service address.
function targetsDefaultVcd(input: Parameters<typeof fetch>[0]): boolean {
  try {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
    const home = new URL(DEFAULT_VCD_URL);
    return LOOPBACK_ALIASES.has(url.hostname) && url.port === home.port;
  } catch {
    return false;
  }
}

// Makes the voice of choice the test default: points the voice settings at the fake service and clears any narrator override from the developer's shell.
export function installVoiceOfChoiceForTests(env: NodeJS.ProcessEnv = process.env): void {
  env.AIDEOS_VCD_URL = DEFAULT_VCD_URL;
  env.AIDEOS_VCD_VOICE_ID = FAKE_OWNER_VOICE_ID;
  env.AIDEOS_VCD_LANGUAGE = "auto";
  // Deterministic tests synthesize fake sine tones with no local cleanup weights; dedicated cleanup tests override this explicitly.
  env.AIDEOS_NARRATION_CLEANUP = "off";
  // The fake service speaks tones, not words, so there is nothing for offline speech recognition to verify; dedicated pronunciation tests inject a transcriber.
  env.AIDEOS_PRONUNCIATION_CHECK = "off";
  for (const name of ["AIDEOS_TTS", "AIDEOS_TTS_VOICE", "AIDEOS_ALLOW_OTHER_VOICE"]) delete env[name];
  installFakeVoiceService();
}

// Returns an environment for a spawned child process that loads the fake voice service first, so the child narrates in the owner voice without a real service.
// Node children read NODE_OPTIONS; bun children (the bun toolchain) ignore it and read BUN_OPTIONS, which splits on
// whitespace and has no quoting, so under bun a checkout path with whitespace is refused rather than left unfaked.
export function voiceOfChoiceChildEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const preload = path.join(__dirname, "fakeVcdPreload.ts");
  const options = [base.NODE_OPTIONS?.trim(), "--import tsx", `--import ${JSON.stringify(preload)}`].filter(Boolean).join(" ");
  if (/\s/.test(preload)) {
    if (process.versions.bun) throw new Error(`BUN_OPTIONS cannot carry a preload path with whitespace (${preload}); move the checkout to a path without spaces`);
    return { ...base, NODE_OPTIONS: options };
  }
  const bunOptions = [base.BUN_OPTIONS?.trim(), `--preload ${preload}`].filter(Boolean).join(" ");
  return { ...base, NODE_OPTIONS: options, BUN_OPTIONS: bunOptions };
}

// Replaces globalThis.fetch so requests for the default vcd address reach the fake and everything else passes through; safe to call repeatedly.
export function installFakeVoiceService(): void {
  const marker = Symbol.for("aideos.fakeVcdInstalled");
  const holder = globalThis as unknown as Record<symbol, unknown>;
  if (holder[marker]) return;
  const real = globalThis.fetch.bind(globalThis);
  const fake = createFakeVcdFetch();
  holder[marker] = true;
  globalThis.fetch = ((input, init) => (targetsDefaultVcd(input) ? fake(input, init) : real(input, init))) as typeof fetch;
}
