/**
 * File Description: Text-to-speech backends for the Aideos narration pipeline. Every backend
 * returns raw mono Float32 PCM at one fixed sample rate, so concatenation happens on samples
 * rather than on encoded files. That removes the whole class of stitching defects (sample-rate
 * and channel-layout mismatches at a chunk boundary, container padding, re-encode drift) that
 * used to surface as stutter and clicks in the finished voiceover.
 * Inputs and outputs: narration text segments and voice options -> raw Float32 PCM audio chunks.
 * Used by: backend/audio.ts, backend/sceneKit/voiceover.ts.
 */

import { execFileSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { resolveVoiceCloneSettings } from "./aideosConfig";
import { decodeWav } from "./pcm";
import {
  isVcdStudioVoice,
  resolveVcdVoiceId,
  synthesizeWithVcd,
  vcdStudioVoiceLanguage,
  vcdVoiceCacheKey,
  type VcdHttpDeps,
  type VcdLanguagePreference,
} from "./vcdClient";
import { resampleLinear } from "./voiceLines";

/** The one sample rate every backend normalizes to before assembly. Kokoro's native rate. */
export const PCM_SAMPLE_RATE = 24000;

/** Kokoro default chosen to keep explainer narration within the measured pacing limit. */
export const DEFAULT_KOKORO_SPEED = 0.75;

/** A synthesis backend: text in, mono Float32 PCM at PCM_SAMPLE_RATE out. */
export interface TtsBackend {
  name: string;
  /** The voice id this backend actually speaks with, when it has voices. */
  voice?: string;
  /** The pace multiplier this backend actually applies, when it has pace control. */
  speed?: number;
  /** The language preference applied by this backend, when it supports multiple languages. */
  language?: VcdLanguagePreference;
  /** Longest text one call may receive; the caller chunks above this. */
  maxChars: number;
  synthesize(text: string): Promise<Float32Array>;
  /** Releases any worker process the backend holds. Safe to call more than once. */
  close?(): Promise<void>;
}

/** Names the pipeline understands for AIDEOS_TTS and --tts. */
export type TtsBackendName = "vcd" | "kokoro" | "google" | "say" | "tone";

/**
 * Decodes any audio file ffmpeg understands into mono Float32 PCM at PCM_SAMPLE_RATE.
 * Centralizing the conversion is what guarantees every backend's output is layout-identical.
 */
export function decodeToPcm(filePath: string): Float32Array {
  const raw = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", filePath, "-f", "f32le", "-ac", "1", "-ar", String(PCM_SAMPLE_RATE), "-"],
    { maxBuffer: 1024 * 1024 * 512 },
  );
  // Copy rather than alias: Buffer.buffer is a pooled allocation whose byteOffset
  // is rarely 0, and a bare Float32Array view over it would read neighbouring data.
  const out = new Float32Array(Math.floor(raw.length / 4));
  for (let i = 0; i < out.length; i++) {
    out[i] = raw.readFloatLE(i * 4);
  }
  return out;
}

/** Synthesizes one chunk through a temp file and decodes it to the canonical PCM layout. */
async function synthesizeViaFile(
  run: (outPath: string) => void | Promise<void>,
  extension = ".wav",
): Promise<Float32Array> {
  const tmp = path.join(os.tmpdir(), `aideos-tts-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${extension}`);
  try {
    await run(tmp);
    return decodeToPcm(tmp);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

/** One pending synthesis request waiting on the Kokoro worker's reply. */
interface PendingRequest {
  resolve: (samples: Float32Array) => void;
  reject: (err: Error) => void;
  outPath: string;
}

/**
 * Kokoro-82M running locally through a persistent ESM worker process (see
 * scripts/kokoro_worker.mjs for why it is a separate process). The default backend: no API key,
 * deterministic output, and raw Float32 samples so nothing is encoded and re-decoded.
 */
async function createKokoroBackend(voice: string, speed: number): Promise<TtsBackend> {
  const { spawn } = await import("child_process");
  const workerPath = path.resolve(__dirname, "kokoroWorker.mjs");

  const child = spawn(process.execPath, [workerPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  const pending = new Map<number, PendingRequest>();
  let nextId = 1;
  let stderrTail = "";
  let ready: { voices: string[] } | null = null;
  let fatal: Error | null = null;

  child.stderr.on("data", (d: Buffer) => {
    stderrTail = (stderrTail + d.toString()).slice(-2000);
  });

  let rejectReady: ((err: Error) => void) | null = null;

  /** Fails every in-flight request when the worker dies, so no caller hangs forever. */
  const failAll = (err: Error) => {
    fatal = err;
    if (!ready && rejectReady) {
      rejectReady(err);
      rejectReady = null;
    }
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  };

  child.on("error", (err) => failAll(err));
  child.on("exit", (code) => {
    if (pending.size > 0 || !ready) {
      failAll(new Error(`kokoro worker exited with code ${code}: ${stderrTail.trim()}`));
    }
  });

  const readyPromise = new Promise<{ voices: string[] }>((resolve, reject) => {
    rejectReady = reject;
    let buffer = "";
    child.stdout.on("data", (d: Buffer) => {
      buffer += d.toString();
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;

        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }

        if (message.ready !== undefined) {
          if (message.ready) {
            ready = { voices: (message.voices as string[]) ?? [] };
            resolve(ready);
          } else {
            reject(new Error(String(message.error ?? "kokoro worker failed to load the model")));
          }
          continue;
        }

        const entry = pending.get(message.id as number);
        if (!entry) continue;
        pending.delete(message.id as number);
        if (message.ok) {
          void fs
            .readFile(entry.outPath)
            .then((raw) => {
              const samples = new Float32Array(message.samples as number);
              for (let i = 0; i < samples.length; i++) samples[i] = raw.readFloatLE(i * 4);
              return fs.rm(entry.outPath, { force: true }).then(() => entry.resolve(samples));
            })
            .catch((err) => entry.reject(err as Error));
        } else {
          entry.reject(new Error(String(message.error ?? "kokoro synthesis failed")));
        }
      }
    });
  });

  const info = await readyPromise;
  const chosen = info.voices.includes(voice) ? voice : "af_heart";
  // The worker has done its job; let the parent exit without waiting on it.
  child.unref();

  return {
    name: `kokoro:${chosen}`,
    voice: chosen,
    speed,
    // Kokoro truncates past ~510 phoneme tokens. 300 characters of English narration
    // stays comfortably inside that even for phoneme-dense text.
    maxChars: 300,
    async synthesize(text: string): Promise<Float32Array> {
      if (fatal) throw fatal;
      const id = nextId++;
      const outPath = path.join(os.tmpdir(), `aideos-kokoro-${id}-${Date.now().toString(36)}.f32`);
      return new Promise<Float32Array>((resolve, reject) => {
        pending.set(id, { resolve, reject, outPath });
        child.stdin.write(`${JSON.stringify({ id, text, voice: chosen, speed, out: outPath })}\n`);
      });
    },
    async close(): Promise<void> {
      child.stdin.end();
      child.kill();
    },
  };
}

/** Google Cloud Text-to-Speech, used only when credentials are configured and requested. */
async function createGoogleBackend(voiceName: string): Promise<TtsBackend> {
  const { TextToSpeechClient } = await import("@google-cloud/text-to-speech");
  const apiKey = process.env.GOOGLE_API_KEY;
  const client = new TextToSpeechClient(apiKey ? { apiKey } : undefined);

  return {
    name: `google:${voiceName}`,
    voice: voiceName,
    maxChars: 800,
    async synthesize(text: string): Promise<Float32Array> {
      const [response] = await client.synthesizeSpeech({
        input: { text },
        voice: { languageCode: "en-US", name: voiceName },
        audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: PCM_SAMPLE_RATE },
      });
      if (!response.audioContent) {
        throw new Error("Google Cloud TTS returned no audio content");
      }
      return synthesizeViaFile(async (out) => {
        await fs.writeFile(out, response.audioContent as Buffer);
      });
    },
  };
}

/** macOS `say`, the offline fallback when Kokoro's model cannot be fetched. */
function createSayBackend(voice: string): TtsBackend {
  return {
    name: `say:${voice}`,
    voice,
    maxChars: 800,
    async synthesize(text: string): Promise<Float32Array> {
      return synthesizeViaFile((out) => {
        execFileSync("say", ["-v", voice, "-o", out, "--data-format=LEF32@24000", text], {
          stdio: "ignore",
        });
      });
    },
  };
}

/**
 * Silent placeholder sized from the word count. Exists so tests and CI can exercise the
 * assembly, timing and film-build code paths with no model download and no network.
 */
function createToneBackend(): TtsBackend {
  return {
    name: "tone",
    maxChars: 800,
    async synthesize(text: string): Promise<Float32Array> {
      const words = text.split(/\s+/).filter(Boolean).length || 1;
      const seconds = Math.max(0.4, (words / 150) * 60);
      const length = Math.round(seconds * PCM_SAMPLE_RATE);
      const samples = new Float32Array(length);
      // A quiet, slowly modulated tone: non-silent so silence trimming has something
      // to keep, but never mistaken for narration by a listener.
      for (let i = 0; i < length; i++) {
        const t = i / PCM_SAMPLE_RATE;
        samples[i] = 0.05 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 1.7 * t));
      }
      return samples;
    },
  };
}

/**
 * Owner's own cloned voice running locally via the loopback `vcd` HTTP service.
 * Resolves the enrolled voice id up front so an unreachable service fails plainly before
 * synthesis starts, and embeds voice id plus language in the backend name so per-line caches
 * never serve audio from a different voice.
 */
export async function createVcdBackend(options?: {
  url?: string;
  voiceId?: string;
  language?: VcdLanguagePreference;
  deps?: VcdHttpDeps;
}): Promise<TtsBackend> {
  const settings = resolveVoiceCloneSettings({
    ...(options?.url ? { url: options.url } : {}),
    ...(options?.voiceId ? { voiceId: options.voiceId } : {}),
    ...(options?.language ? { language: options.language } : {}),
  });
  const resolved = await resolveVcdVoiceId(
    { url: settings.url, voiceId: settings.voiceId },
    options?.deps,
  );
  const language = settings.language;

  return {
    name: vcdVoiceCacheKey(resolved.voiceId, language),
    voice: resolved.voiceId,
    language,
    // vcd enforces a 2000-char job cap and splits chunks internally with language-aware word limits.
    maxChars: 1800,
    async synthesize(text: string): Promise<Float32Array> {
      const result = await synthesizeWithVcd(
        {
          text,
          url: resolved.url,
          voiceId: resolved.voiceId,
          language,
        },
        options?.deps,
      );
      const decoded = decodeWav(result.wav);
      return decoded.sampleRate === PCM_SAMPLE_RATE
        ? decoded.samples
        : resampleLinear(decoded.samples, decoded.sampleRate, PCM_SAMPLE_RATE);
    },
  };
}

/**
 * Picks a synthesis backend. Defaults to "vcd" (My voice, the owner's local cloned voice).
 * When the owner's voice is requested or selected by default and vcd is not reachable, it fails
 * plainly rather than silently swapping to another voice. Pass --tts kokoro, google, say, or tone
 * (or set AIDEOS_TTS) to explicitly pick another voice.
 */
export async function createTtsBackend(options?: {
  backend?: TtsBackendName;
  voice?: string;
  /** Narration pace multiplier. Below 1 slows delivery, which reads better for explainer copy. */
  speed?: number;
  /** Language preference for multi-language backends such as vcd ("auto", "en", or "hi"). */
  language?: VcdLanguagePreference;
  /** Loopback URL override for the local vcd voice service. */
  vcdUrl?: string;
  /** Injectable HTTP dependencies for vcd tests. */
  vcdDeps?: VcdHttpDeps;
}): Promise<TtsBackend> {
  const requested = (options?.backend ?? (process.env.AIDEOS_TTS as TtsBackendName | undefined)) || undefined;
  const explicitVoice = options?.voice ?? process.env.AIDEOS_TTS_VOICE;
  const voice = explicitVoice ?? "af_heart";
  const envSpeed = Number(process.env.AIDEOS_TTS_SPEED);
  const requestedSpeed = options?.speed ?? (Number.isFinite(envSpeed) && envSpeed > 0 ? envSpeed : DEFAULT_KOKORO_SPEED);
  const speed = Math.min(2, Math.max(0.5, requestedSpeed));

  if (requested === "tone") return createToneBackend();
  if (requested === "say") return createSayBackend(voice === "af_heart" ? "Samantha" : voice);
  if (requested === "google") return createGoogleBackend(voice === "af_heart" ? "en-US-Journey-F" : voice);
  if (requested === "kokoro") return createKokoroBackend(voice, speed);

  const studioVoice = explicitVoice && isVcdStudioVoice(explicitVoice) ? explicitVoice : undefined;
  const enrolledVoiceId = explicitVoice && !studioVoice && (requested === "vcd" || explicitVoice.startsWith("voice_")) ? explicitVoice : undefined;
  const nonVcdVoiceWithoutBackend = requested === undefined && explicitVoice && !studioVoice && !enrolledVoiceId;
  if (nonVcdVoiceWithoutBackend) return createKokoroBackend(voice, speed);

  if (requested === "vcd" || requested === undefined) {
    return createVcdBackend({
      url: options?.vcdUrl,
      voiceId: enrolledVoiceId,
      language: studioVoice ? vcdStudioVoiceLanguage(studioVoice, options?.language) : options?.language,
      deps: options?.vcdDeps,
    });
  }

  throw new Error(
    `[tts] Unknown speech backend "${String(requested)}". Use vcd (My voice), kokoro, google, say, or tone.`,
  );
}
