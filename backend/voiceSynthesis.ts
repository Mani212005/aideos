/**
 * File Description: Voiceover synthesis for the studio's /api/generate-voiceover route.
 * Inputs and outputs: narration text and voice preferences -> synthesized WAV audio buffer via provider chain.
 * Used by: editor/vite.config.ts (api/generate-voiceover, api/narration), backend/voiceSynthesis.test.ts.
 *
 * A vcd studio voice (My voice) goes only to the local vcd service and never falls through to
 * another provider. Other voices try providers in order: local Kokoro (for kokoro-* voices when
 * host memory fits), Deepgram Aura and Google Cloud TTS (for non-macos-* voices), and macOS `say`
 * on darwin. Returns one mono 16-bit WAV, or throws a VoiceSynthesisError naming why every
 * attempted or skipped provider did not produce audio.
 *
 * Kokoro is only attempted on a host with the memory for it: its ONNX runtime holds ~400 MB, so
 * loading it inside the studio server on a 512 MB Render free instance OOM-killed the whole
 * container (every request then 502s while it restarts). It runs in its own process through
 * backend/kokoroWorker.mjs (kokoroWorkerSynthesizer), never inside the studio server. The network,
 * the model runtime and the macOS `say` call are injectable so tests exercise the real routing
 * without any of them.
 *
 * Every result names the voice that actually spoke (`voiceKey`), so a line one provider failed and
 * another spoke is never stored or reported as the requested voice.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveVoiceCloneSettings } from "./aideosConfig";
import { fetchWithin, HTTP_DEADLINES, readWithin, startDeadline, type NowFn } from "./httpDeadline";
import { KOKORO_MAX_CHARS, PCM_SAMPLE_RATE, startKokoroWorker, type KokoroWorker } from "./tts";
import {
  isVcdStudioVoice,
  synthesizeWithVcd,
  vcdStudioVoiceLanguage,
  type VcdLanguagePreference,
} from "./vcdClient";

/** Smallest container memory limit (bytes) on which the Kokoro model is attempted. */
export const KOKORO_MIN_MEMORY_BYTES = 1.5 * 1024 ** 3;

/**
 * The studio's Kokoro pace, passed explicitly to the worker: 1.0 (owner decision, 2026-11-21: "Studio Kokoro speed
 * 1.0 explicit"). The studio re-paces every line to the house narration rate by time-stretch after synthesis, so this
 * keeps the pace the studio had while Kokoro ran in-process at its own default of 1.0. The pipeline's
 * DEFAULT_KOKORO_SPEED in backend/tts.ts is a separate setting.
 */
export const STUDIO_KOKORO_SPEED = 1;

/** The Deepgram Aura model used when the requested voice is not an Aura voice. */
const DEEPGRAM_FALLBACK_MODEL = "aura-helios-en";

/** The Google Cloud TTS voice every Google request speaks with. */
const GOOGLE_VOICE_NAME = "en-US-Journey-D";

/** One provider's outcome when it did not produce audio. */
export interface ProviderAttempt {
  provider: "vcd" | "kokoro" | "deepgram" | "google" | "say";
  reason: string;
}

/** Thrown when no provider could produce audio; `attempts` says why for each. */
export class VoiceSynthesisError extends Error {
  attempts: ProviderAttempt[];

  constructor(attempts: ProviderAttempt[]) {
    super(`No voice provider produced audio. ${attempts.map((a) => `${a.provider}: ${a.reason}`).join("; ")}`);
    this.name = "VoiceSynthesisError";
    this.attempts = attempts;
  }
}

/** Raw mono 16-bit PCM plus its sample rate: the common currency between providers. */
export interface PcmAudio {
  pcm: Buffer;
  sampleRate: number;
}

/** Injectable I/O so tests never touch the network, ONNX or `say`. */
export interface SynthesisDeps {
  fetch: typeof fetch;
  /** Synthesizes text with the local vcd cloned-voice service and returns a mono WAV buffer. */
  vcd?: (text: string, options: { url?: string; voiceId?: string; language?: VcdLanguagePreference }) => Promise<Buffer>;
  /** Synthesizes text with local Kokoro at the given pace and returns float samples. */
  kokoro: (text: string, voice: string, speed: number) => Promise<{ samples: Float32Array; sampleRate: number }>;
  /** Synthesizes with macOS `say` and returns a WAV file's bytes. */
  say: (text: string, voice: string) => Promise<Buffer | null>;
  /** Container memory limit in bytes, or null when unknown. */
  memoryLimitBytes: () => number | null;
  platform: NodeJS.Platform;
  /** Clock behind the per-provider time budget; defaults to Date.now. */
  now?: NowFn;
}

/** Inputs for one synthesis run. */
export interface SynthesisRequest {
  text: string;
  voice: string;
  /** Optional language preference for multi-language voices such as vcd ("auto", "en", or "hi"). */
  language?: VcdLanguagePreference;
  /** Optional loopback URL override for the local vcd service. */
  vcdUrl?: string;
  /** Optional enrolled vcd voice id override. */
  vcdVoiceId?: string;
  /** Kokoro pace multiplier; defaults to STUDIO_KOKORO_SPEED. */
  kokoroSpeed?: number;
  deepgramKey?: string;
  googleKey?: string;
  /** Time budget (ms) for each network provider attempt (vcd, Deepgram, Google); a stalled one fails over instead of hanging. */
  timeoutMs?: number;
  /** Splits text into provider-sized chunks. */
  chunk: (text: string, maxChars: number) => string[];
  /** Trims leading and trailing silence from a Kokoro chunk. */
  trimSilence: (samples: Float32Array, threshold: number) => Float32Array;
}

/** Reads the cgroup (v2 then v1) memory limit, ignoring the "unlimited" sentinels. */
export function readContainerMemoryLimit(): number | null {
  for (const file of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const raw = fs.readFileSync(file, "utf8").trim();
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0 && n < 2 ** 50) return n;
    } catch {
      // not present on this platform
    }
  }
  return null;
}

/** True when this host can hold the in-process Kokoro model; AIDEOS_KOKORO=1/0 overrides the guess. */
export function kokoroFits(limit: number | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.AIDEOS_KOKORO === "1") return true;
  if (env.AIDEOS_KOKORO === "0") return false;
  return (limit ?? os.totalmem()) >= KOKORO_MIN_MEMORY_BYTES;
}

/** Encodes mono 16-bit little-endian PCM as a WAV file. */
export function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Converts float samples in [-1, 1] to 16-bit PCM bytes. */
export function floatToPcm16(samples: Float32Array): Buffer {
  const out = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out.writeInt16LE(Math.floor(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
  }
  return out;
}

/** Returns the PCM payload of a WAV file (the bytes after its "data" chunk header). */
export function wavDataChunk(wav: Buffer): Buffer {
  let pos = 12;
  while (pos + 8 <= wav.length) {
    const id = wav.toString("ascii", pos, pos + 4);
    const size = wav.readUInt32LE(pos + 4);
    if (id === "data") return wav.subarray(pos + 8, size > 0 && pos + 8 + size <= wav.length ? pos + 8 + size : undefined);
    pos += 8 + size + (size % 2);
  }
  throw new Error("response was not a WAV file");
}

/** The Deepgram Aura model a request speaks with: the requested Aura voice, or the fallback model. */
function deepgramModel(voice: string): string {
  return voice.startsWith("aura-") ? voice : DEEPGRAM_FALLBACK_MODEL;
}

/**
 * The line-cache voice key of audio a provider spoke for `voice`: it names the voice that actually spoke, and for
 * Kokoro the pace and request size that shape its audio. A vcd voice keeps the requested key (vcd never falls back;
 * the studio keys vcd lines by vcdVoiceCacheKey). A Kokoro voice's own key is `<voice>|speed=<n>|chars=<n>`, so
 * recordings made in-process with 800-character requests (which dropped words) are not reused.
 */
export function spokenVoiceKey(
  provider: ProviderAttempt["provider"],
  voice: string,
  kokoroSpeed: number = STUDIO_KOKORO_SPEED,
): string {
  switch (provider) {
    case "vcd":
      return voice;
    case "kokoro":
      return `kokoro-${voice.replace(/^kokoro-/, "")}|speed=${kokoroSpeed}|chars=${KOKORO_MAX_CHARS}`;
    case "deepgram":
      return deepgramModel(voice);
    case "google":
      return `google-${GOOGLE_VOICE_NAME}`;
    case "say":
      return `macos-${macVoiceFor(voice).toLowerCase()}`;
  }
}

/** The line-cache voice key a studio voice has when its own provider speaks it (what the studio looks stored lines up by). */
export function requestedVoiceKey(voice: string, kokoroSpeed: number = STUDIO_KOKORO_SPEED): string {
  if (voice.startsWith("kokoro-")) return spokenVoiceKey("kokoro", voice, kokoroSpeed);
  return voice;
}

/**
 * The studio's Kokoro dependency: one shared worker process (backend/kokoroWorker.mjs), started on first use and
 * started again when it has died. A voice the model does not have is refused, never swapped for another voice.
 */
export function kokoroWorkerSynthesizer(start: () => Promise<KokoroWorker> = startKokoroWorker): SynthesisDeps["kokoro"] {
  let worker: Promise<KokoroWorker> | null = null;

  /** Returns a live worker, starting one when there is none or the last one died. */
  const live = async (): Promise<KokoroWorker> => {
    if (worker) {
      const current = await worker.catch(() => null);
      if (current && !current.dead) return current;
    }
    const starting = start();
    worker = starting;
    try {
      return await starting;
    } catch (err) {
      if (worker === starting) worker = null;
      throw err;
    }
  };

  return async (text, voice, speed) => {
    const current = await live();
    if (!current.voices.includes(voice)) throw new Error(`Kokoro has no voice "${voice}"`);
    return { samples: await current.synthesize(text, voice, speed), sampleRate: PCM_SAMPLE_RATE };
  };
}

/** Deepgram Aura: raw linear16 per chunk (its request limit is 2000 characters). */
async function synthesizeDeepgram(req: SynthesisRequest, deps: SynthesisDeps): Promise<PcmAudio> {
  const model = deepgramModel(req.voice);
  const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}&encoding=linear16&container=none&sample_rate=24000`;
  const deadline = startDeadline(req.timeoutMs ?? HTTP_DEADLINES.speechProviderMs, deps.now);
  const parts: Buffer[] = [];
  for (const piece of req.chunk(req.text, 1800)) {
    if (!piece.trim()) continue;
    const res = await fetchWithin(
      deadline,
      deps.fetch,
      url,
      {
        method: "POST",
        headers: { Authorization: `Token ${req.deepgramKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: piece }),
      },
      { what: "Deepgram speech request", capMs: HTTP_DEADLINES.speechRequestMs },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await readWithin(deadline, "Deepgram speech request", () => res.text(), HTTP_DEADLINES.speechRequestMs)).slice(0, 200)}`);
    parts.push(Buffer.from(await readWithin(deadline, "Deepgram speech request", () => res.arrayBuffer(), HTTP_DEADLINES.speechRequestMs)));
  }
  if (parts.length === 0) throw new Error("no text to synthesize");
  return { pcm: Buffer.concat(parts), sampleRate: 24000 };
}

/** Google Cloud TTS over REST with an API key, one request per chunk (limit 5000 bytes). */
async function synthesizeGoogle(req: SynthesisRequest, deps: SynthesisDeps): Promise<PcmAudio> {
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(req.googleKey ?? "")}`;
  const deadline = startDeadline(req.timeoutMs ?? HTTP_DEADLINES.speechProviderMs, deps.now);
  const parts: Buffer[] = [];
  for (const piece of req.chunk(req.text, 800)) {
    if (!piece.trim()) continue;
    const res = await fetchWithin(
      deadline,
      deps.fetch,
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text: piece },
          voice: { languageCode: "en-US", name: GOOGLE_VOICE_NAME },
          audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000 },
        }),
      },
      { what: "Google speech request", capMs: HTTP_DEADLINES.speechRequestMs },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await readWithin(deadline, "Google speech request", () => res.text(), HTTP_DEADLINES.speechRequestMs)).slice(0, 200)}`);
    const json = await readWithin(deadline, "Google speech request", () => res.json() as Promise<{ audioContent?: string }>, HTTP_DEADLINES.speechRequestMs);
    if (!json.audioContent) throw new Error("response had no audioContent");
    parts.push(wavDataChunk(Buffer.from(json.audioContent, "base64")));
  }
  if (parts.length === 0) throw new Error("no text to synthesize");
  return { pcm: Buffer.concat(parts), sampleRate: 24000 };
}

/** Local Kokoro: chunks within its request limit, trims and joins with 200 ms pauses between chunks. */
async function synthesizeKokoro(req: SynthesisRequest, deps: SynthesisDeps): Promise<PcmAudio> {
  const voice = req.voice.replace(/^kokoro-/, "");
  const speed = req.kokoroSpeed ?? STUDIO_KOKORO_SPEED;
  const pieces = req.chunk(req.text, KOKORO_MAX_CHARS).filter((p) => p.trim());
  const all: Float32Array[] = [];
  let rate = 24000;
  for (let i = 0; i < pieces.length; i++) {
    const out = await deps.kokoro(pieces[i].trim(), voice, speed);
    rate = out.sampleRate;
    const trimmed = req.trimSilence(out.samples, 0.005);
    if (trimmed.length > 0) all.push(trimmed);
    if (i < pieces.length - 1) all.push(new Float32Array(Math.floor(rate * 0.2)));
  }
  const merged = new Float32Array(all.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const a of all) {
    merged.set(a, offset);
    offset += a.length;
  }
  if (merged.length === 0) throw new Error("model produced no audio");
  return { pcm: floatToPcm16(merged), sampleRate: rate };
}

/** Default macOS `say` implementation: AIFF to 48k mono WAV through ffmpeg. */
export async function sayToWav(text: string, voice: string): Promise<Buffer | null> {
  const stamp = Date.now();
  const txt = path.join(os.tmpdir(), `aideos_script_${stamp}.txt`);
  const aiff = path.join(os.tmpdir(), `aideos_voice_${stamp}.aiff`);
  const wav = path.join(os.tmpdir(), `aideos_voice_${stamp}.wav`);
  try {
    fs.writeFileSync(txt, text, "utf8");
    const say = spawnSync("say", ["-v", voice, "-f", txt, "-o", aiff]);
    if (say.status !== 0 || !fs.existsSync(aiff)) return null;
    spawnSync("ffmpeg", ["-y", "-i", aiff, "-ar", "48000", "-ac", "1", wav]);
    return fs.existsSync(wav) ? fs.readFileSync(wav) : null;
  } finally {
    for (const f of [txt, aiff, wav]) fs.rmSync(f, { force: true });
  }
}

/** Maps a studio voice id to the macOS voice name `say` understands. */
export function macVoiceFor(voice: string): string {
  const v = voice.toLowerCase();
  for (const name of ["daniel", "alex", "eddy", "flo", "fred"]) {
    if (v.includes(name)) return name[0].toUpperCase() + name.slice(1);
  }
  return "Samantha";
}

/** What one synthesis produced: the WAV, the provider that spoke it and the voice key of the voice that spoke. */
export interface SpokenVoiceover {
  wav: Buffer;
  provider: ProviderAttempt["provider"];
  /** spokenVoiceKey of the provider that spoke; differs from requestedVoiceKey when the chain fell through. */
  voiceKey: string;
}

/** Runs the provider chain and returns a WAV, or throws VoiceSynthesisError with every reason. */
export async function synthesizeVoiceover(
  req: SynthesisRequest,
  deps: SynthesisDeps,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SpokenVoiceover> {
  const attempts: ProviderAttempt[] = [];
  /** The result for audio `provider` spoke. */
  const spoken = (wav: Buffer, provider: ProviderAttempt["provider"]): SpokenVoiceover => ({
    wav,
    provider,
    voiceKey: spokenVoiceKey(provider, req.voice, req.kokoroSpeed),
  });

  /** Runs one provider, recording why it was skipped or how it failed. */
  const tryPcm = async (provider: ProviderAttempt["provider"], run: () => Promise<PcmAudio>) => {
    try {
      const audio = await run();
      return spoken(pcm16ToWav(audio.pcm, audio.sampleRate), provider);
    } catch (err) {
      attempts.push({ provider, reason: err instanceof Error ? err.message : String(err) });
      return null;
    }
  };

  if (isVcdStudioVoice(req.voice)) {
    // Owner's cloned voice: never silently swap to another voice when vcd is unreachable.
    try {
      const settings = resolveVoiceCloneSettings(
        {
          ...(req.vcdUrl ? { url: req.vcdUrl } : {}),
          ...(req.vcdVoiceId ? { voiceId: req.vcdVoiceId } : {}),
          ...(req.language ? { language: req.language } : {}),
        },
        env,
      );
      const language = req.language ?? vcdStudioVoiceLanguage(req.voice, settings.language);
      const wav = deps.vcd
        ? await deps.vcd(req.text, { url: settings.url, voiceId: settings.voiceId || undefined, language })
        : (
            await synthesizeWithVcd(
              {
                text: req.text,
                url: settings.url,
                voiceId: settings.voiceId || undefined,
                language,
                ...(req.timeoutMs ? { timeoutMs: req.timeoutMs } : {}),
              },
              { fetch: deps.fetch, now: deps.now },
            )
          ).wav;
      return spoken(wav, "vcd");
    } catch (err) {
      attempts.push({ provider: "vcd", reason: err instanceof Error ? err.message : String(err) });
      throw new VoiceSynthesisError(attempts);
    }
  }

  if (req.voice.startsWith("kokoro-")) {
    const limit = deps.memoryLimitBytes();
    if (kokoroFits(limit, env)) {
      const done = await tryPcm("kokoro", () => synthesizeKokoro(req, deps));
      if (done) return done;
    } else {
      const mb = limit ? Math.round(limit / 1024 ** 2) : "unknown";
      attempts.push({ provider: "kokoro", reason: `skipped: needs ~${Math.round(KOKORO_MIN_MEMORY_BYTES / 1024 ** 2)} MB, host limit is ${mb} MB` });
    }
  }

  if (!req.voice.startsWith("macos-")) {
    if (req.deepgramKey) {
      const done = await tryPcm("deepgram", () => synthesizeDeepgram(req, deps));
      if (done) return done;
    } else {
      attempts.push({ provider: "deepgram", reason: "skipped: DEEPGRAM_API_KEY is not set" });
    }
    if (req.googleKey) {
      const done = await tryPcm("google", () => synthesizeGoogle(req, deps));
      if (done) return done;
    } else {
      attempts.push({ provider: "google", reason: "skipped: GOOGLE_API_KEY is not set" });
    }
  }

  if (deps.platform === "darwin") {
    try {
      const wav = await deps.say(req.text, macVoiceFor(req.voice));
      if (wav) return spoken(wav, "say");
      attempts.push({ provider: "say", reason: "`say` produced no audio" });
    } catch (err) {
      attempts.push({ provider: "say", reason: err instanceof Error ? err.message : String(err) });
    }
  } else {
    attempts.push({ provider: "say", reason: `skipped: macOS only (running on ${deps.platform})` });
  }

  throw new VoiceSynthesisError(attempts);
}
