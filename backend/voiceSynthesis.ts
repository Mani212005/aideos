/**
 * File Description: Voiceover synthesis for the studio's /api/generate-voiceover route.
 * Inputs and outputs: narration text and voice preferences -> synthesized audio buffer via provider chain.
 * Used by: editor/vite.config.ts (api/generate-voiceover).
 *
 * It tries providers in order (local Kokoro, Deepgram Aura, Google Cloud TTS, macOS `say`) and
 * returns one mono 16-bit WAV, or throws a VoiceSynthesisError that names why EVERY provider was
 * skipped or failed, so the studio can show a real reason instead of a bare "failed" message.
 *
 * Kokoro is only attempted on a host with the memory for it: its ONNX runtime holds ~400 MB, so
 * loading it inside the studio server on a 512 MB Render free instance OOM-killed the whole
 * container (every request then 502s while it restarts). The network, the model runtime and the
 * macOS `say` call are injectable so tests exercise the real routing without any of them.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Smallest container memory limit (bytes) on which the in-process Kokoro model is attempted. */
export const KOKORO_MIN_MEMORY_BYTES = 1.5 * 1024 ** 3;

/** One provider's outcome when it did not produce audio. */
export interface ProviderAttempt {
  provider: "kokoro" | "deepgram" | "google" | "say";
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
  /** Synthesizes text with local Kokoro and returns float samples. */
  kokoro: (text: string, voice: string) => Promise<{ samples: Float32Array; sampleRate: number }>;
  /** Synthesizes with macOS `say` and returns a WAV file's bytes. */
  say: (text: string, voice: string) => Promise<Buffer | null>;
  /** Container memory limit in bytes, or null when unknown. */
  memoryLimitBytes: () => number | null;
  platform: NodeJS.Platform;
}

/** Inputs for one synthesis run. */
export interface SynthesisRequest {
  text: string;
  voice: string;
  deepgramKey?: string;
  googleKey?: string;
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

/** Deepgram Aura: raw linear16 per chunk (its request limit is 2000 characters). */
async function synthesizeDeepgram(req: SynthesisRequest, deps: SynthesisDeps): Promise<PcmAudio> {
  const model = req.voice.startsWith("aura-") ? req.voice : "aura-helios-en";
  const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}&encoding=linear16&container=none&sample_rate=24000`;
  const parts: Buffer[] = [];
  for (const piece of req.chunk(req.text, 1800)) {
    if (!piece.trim()) continue;
    const res = await deps.fetch(url, {
      method: "POST",
      headers: { Authorization: `Token ${req.deepgramKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: piece }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    parts.push(Buffer.from(await res.arrayBuffer()));
  }
  if (parts.length === 0) throw new Error("no text to synthesize");
  return { pcm: Buffer.concat(parts), sampleRate: 24000 };
}

/** Google Cloud TTS over REST with an API key, one request per chunk (limit 5000 bytes). */
async function synthesizeGoogle(req: SynthesisRequest, deps: SynthesisDeps): Promise<PcmAudio> {
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(req.googleKey ?? "")}`;
  const parts: Buffer[] = [];
  for (const piece of req.chunk(req.text, 800)) {
    if (!piece.trim()) continue;
    const res = await deps.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: piece },
        voice: { languageCode: "en-US", name: "en-US-Journey-D" },
        audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000 },
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { audioContent?: string };
    if (!json.audioContent) throw new Error("response had no audioContent");
    parts.push(wavDataChunk(Buffer.from(json.audioContent, "base64")));
  }
  if (parts.length === 0) throw new Error("no text to synthesize");
  return { pcm: Buffer.concat(parts), sampleRate: 24000 };
}

/** Local Kokoro: chunks, trims and joins with 200 ms pauses between chunks. */
async function synthesizeKokoro(req: SynthesisRequest, deps: SynthesisDeps): Promise<PcmAudio> {
  const voice = req.voice.replace(/^kokoro-/, "");
  const pieces = req.chunk(req.text, 800).filter((p) => p.trim());
  const all: Float32Array[] = [];
  let rate = 24000;
  for (let i = 0; i < pieces.length; i++) {
    const out = await deps.kokoro(pieces[i].trim(), voice);
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

/** Runs the provider chain and returns a WAV, or throws VoiceSynthesisError with every reason. */
export async function synthesizeVoiceover(
  req: SynthesisRequest,
  deps: SynthesisDeps,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ wav: Buffer; provider: ProviderAttempt["provider"] }> {
  const attempts: ProviderAttempt[] = [];

  /** Runs one provider, recording why it was skipped or how it failed. */
  const tryPcm = async (provider: ProviderAttempt["provider"], run: () => Promise<PcmAudio>) => {
    try {
      const audio = await run();
      return { wav: pcm16ToWav(audio.pcm, audio.sampleRate), provider };
    } catch (err) {
      attempts.push({ provider, reason: err instanceof Error ? err.message : String(err) });
      return null;
    }
  };

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
      if (wav) return { wav, provider: "say" };
      attempts.push({ provider: "say", reason: "`say` produced no audio" });
    } catch (err) {
      attempts.push({ provider: "say", reason: err instanceof Error ? err.message : String(err) });
    }
  } else {
    attempts.push({ provider: "say", reason: `skipped: macOS only (running on ${deps.platform})` });
  }

  throw new VoiceSynthesisError(attempts);
}
