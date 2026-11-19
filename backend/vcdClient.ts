/**
 * File Description: HTTP client for the local Voice-cloned (`vcd`) service. Talks only to loopback
 * addresses (default http://127.0.0.1:8740), resolves the enrolled owner voice id, submits synthesis
 * jobs for English or Hindi/Hinglish text, polls until completion, and fetches the resulting 24 kHz
 * mono WAV. Network calls and polling waits are injectable so unit tests never touch the network.
 * Inputs and outputs: loopback URL, enrolled voice id, language and text -> WAV audio buffer and provenance, or a plain-language VcdUnavailableError.
 * Used by: backend/tts.ts, backend/voiceSynthesis.ts, backend/aideosConfig.ts, editor/vite.config.ts.
 */

/** Default loopback URL where the local vcd voice-clone service listens. */
export const DEFAULT_VCD_URL = "http://127.0.0.1:8740";

/** Studio voice key for the owner's cloned voice (auto-detects Devanagari Hindi, defaults to English). */
export const VCD_DEFAULT_VOICE_KEY = "vcd-my-voice";

/** Studio voice key for the owner's cloned voice speaking Hindi or Romanized Hinglish. */
export const VCD_HINDI_VOICE_KEY = "vcd-my-voice-hi";

/** Languages accepted by vcd /v1/jobs. */
export type VcdLanguage = "en" | "hi";

/** Language preference exposed in config, CLI, and Studio ("auto" detects Devanagari -> "hi", else "en"). */
export type VcdLanguagePreference = "auto" | VcdLanguage;

/** Summary of an enrolled voice returned by GET /v1/voices. */
export interface VcdVoiceSummary {
  id: string;
  name: string;
  reference_language?: string;
  reference_seconds?: number;
  reference_sha256?: string;
  created_at?: string;
}

/** Non-throwing availability summary for Studio UI and status probes. */
export interface VcdServiceStatus {
  available: boolean;
  url: string;
  voiceId: string | null;
  voiceName: string | null;
  message: string | null;
}

/** Injectable I/O for deterministic tests without network traffic or real sleeps. */
export interface VcdHttpDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Successful synthesis output from vcd. */
export interface VcdSynthesisResult {
  wav: Buffer;
  voiceId: string;
  language: VcdLanguage;
  jobId: string;
  audioSeconds: number | null;
  sampleRate: number;
}

/** Machine-readable reason why the local vcd service could not synthesize audio. */
export type VcdErrorCode =
  | "invalid_url"
  | "unreachable"
  | "no_voice_enrolled"
  | "voice_not_found"
  | "job_failed"
  | "timeout"
  | "bad_response";

/** Plain-language error raised when the local vcd voice service cannot run; never swaps to another voice. */
export class VcdUnavailableError extends Error {
  code: VcdErrorCode;
  url: string;

  constructor(code: VcdErrorCode, url: string, message: string) {
    super(message);
    this.name = "VcdUnavailableError";
    this.code = code;
    this.url = url;
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const DEVANAGARI_RE = /[\u0900-\u097F]/;
const DEFAULT_POLL_MS = 250;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const MAX_QUEUE_RETRIES = 6;
const VCD_START_HINT = "Start the local voice service with `vcd serve` on 127.0.0.1:8740, or choose another voice explicitly (such as Kokoro or macOS in Studio, or `--tts kokoro` / `--tts say` in the CLI).";

// Waits for the given number of milliseconds.
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Validates that a configured vcd URL is HTTP on a local loopback host and strips any trailing slash.
export function assertLoopbackVcdUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new VcdUnavailableError(
      "invalid_url",
      trimmed,
      `Invalid local voice service URL "${trimmed}". Use a loopback URL such as ${DEFAULT_VCD_URL}.`,
    );
  }
  if (parsed.protocol !== "http:") {
    throw new VcdUnavailableError(
      "invalid_url",
      trimmed,
      `Local voice service URL "${trimmed}" must use http:// on loopback (for example ${DEFAULT_VCD_URL}).`,
    );
  }
  const host = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new VcdUnavailableError(
      "invalid_url",
      trimmed,
      `Refusing non-loopback voice service URL "${trimmed}": voice recordings and synthesis must stay on this machine (127.0.0.1, localhost, or [::1]).`,
    );
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

// True when a Studio voice identifier targets the owner's local cloned voice.
export function isVcdStudioVoice(voice: string): boolean {
  return voice === "vcd" || voice.startsWith("vcd-");
}

// Returns the language preference implied by a Studio voice id.
export function vcdStudioVoiceLanguage(
  voice: string,
  fallback: VcdLanguagePreference = "auto",
): VcdLanguagePreference {
  if (voice === VCD_HINDI_VOICE_KEY || voice.endsWith("-hi")) return "hi";
  if (voice.endsWith("-en")) return "en";
  return fallback;
}

// Picks the vcd language code ("en" or "hi") for one narration line.
export function detectVcdLanguage(
  text: string,
  preference: VcdLanguagePreference = "auto",
): VcdLanguage {
  if (preference === "en" || preference === "hi") return preference;
  return DEVANAGARI_RE.test(text) ? "hi" : "en";
}

// Builds the per-line cache voice key that embeds both the enrolled voice id and language.
export function vcdVoiceCacheKey(voiceId: string, language: VcdLanguage | VcdLanguagePreference): string {
  return `vcd:${voiceId}:${language}`;
}

// Builds a plain-English unreachable message for vcd network errors.
function unreachableError(url: string, detail?: string): VcdUnavailableError {
  const why = detail ? ` (${detail})` : "";
  return new VcdUnavailableError(
    "unreachable",
    url,
    `My voice (local vcd service) is not reachable at ${url}${why}. ${VCD_START_HINT}`,
  );
}

// Wraps fetch to turn low-level socket failures into a plain VcdUnavailableError.
async function vcdFetch(
  url: string,
  baseUrl: string,
  init: RequestInit | undefined,
  fetchImpl: typeof fetch,
): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw unreachableError(baseUrl, msg);
  }
}

// Reads a vcd application/problem+json or text error body into a short plain string.
async function readProblemDetail(res: Response): Promise<{ code?: string; detail: string }> {
  try {
    const raw = await res.text();
    if (!raw.trim()) return { detail: `HTTP ${res.status}` };
    try {
      const parsed = JSON.parse(raw) as { code?: string; detail?: string; title?: string };
      return {
        code: typeof parsed.code === "string" ? parsed.code : undefined,
        detail: parsed.detail || parsed.title || `HTTP ${res.status}`,
      };
    } catch {
      return { detail: raw.slice(0, 200) };
    }
  } catch {
    return { detail: `HTTP ${res.status}` };
  }
}

// Lists enrolled voices from GET /v1/voices on the local vcd service.
export async function listVcdVoices(
  rawUrl: string = DEFAULT_VCD_URL,
  deps: VcdHttpDeps = {},
): Promise<VcdVoiceSummary[]> {
  const baseUrl = assertLoopbackVcdUrl(rawUrl);
  const fetchImpl = deps.fetch ?? fetch;
  const res = await vcdFetch(`${baseUrl}/v1/voices`, baseUrl, { method: "GET" }, fetchImpl);
  if (!res.ok) {
    const problem = await readProblemDetail(res);
    throw new VcdUnavailableError(
      "bad_response",
      baseUrl,
      `Local voice service at ${baseUrl} rejected /v1/voices (${problem.detail}). ${VCD_START_HINT}`,
    );
  }
  const payload = (await res.json()) as { voices?: VcdVoiceSummary[] };
  return Array.isArray(payload.voices) ? payload.voices : [];
}

// Selects the enrolled voice id from explicit config, or auto-discovers the owner's enrolled voice from vcd.
export async function resolveVcdVoiceId(
  options: { url?: string; voiceId?: string },
  deps: VcdHttpDeps = {},
): Promise<{ voiceId: string; voiceName: string | null; url: string }> {
  const baseUrl = assertLoopbackVcdUrl(options.url || DEFAULT_VCD_URL);
  const configured = (options.voiceId ?? "").trim();
  const voices = await listVcdVoices(baseUrl, deps);

  if (configured) {
    const match = voices.find((v) => v.id === configured || v.name === configured);
    if (!match) {
      const known = voices.length > 0 ? ` Enrolled voice(s): ${voices.map((v) => `${v.name} (${v.id})`).join(", ")}.` : "";
      throw new VcdUnavailableError(
        "voice_not_found",
        baseUrl,
        `Configured voice "${configured}" is not enrolled in the local voice service at ${baseUrl}.${known} Set voiceClone.voiceId in aideos.config.json (or AIDEOS_VCD_VOICE_ID), or choose another voice.`,
      );
    }
    return { voiceId: match.id, voiceName: match.name, url: baseUrl };
  }

  if (voices.length === 0) {
    throw new VcdUnavailableError(
      "no_voice_enrolled",
      baseUrl,
      `Local voice service at ${baseUrl} is running, but no voice is enrolled yet. Enroll your own voice with POST /v1/consents and POST /v1/voices, or choose another voice explicitly.`,
    );
  }

  const preferred =
    voices.find((v) => v.name.toLowerCase() === "my-voice" || v.name.toLowerCase() === "me") ??
    voices[0];
  return { voiceId: preferred.id, voiceName: preferred.name, url: baseUrl };
}

// Probes local vcd availability without throwing, for Studio status indicators and line status checks.
export async function probeVcdService(
  options: { url?: string; voiceId?: string },
  deps: VcdHttpDeps = {},
): Promise<VcdServiceStatus> {
  const rawUrl = options.url || DEFAULT_VCD_URL;
  try {
    const resolved = await resolveVcdVoiceId({ url: rawUrl, voiceId: options.voiceId }, deps);
    return {
      available: true,
      url: resolved.url,
      voiceId: resolved.voiceId,
      voiceName: resolved.voiceName,
      message: null,
    };
  } catch (err) {
    return {
      available: false,
      url: rawUrl,
      voiceId: options.voiceId?.trim() || null,
      voiceName: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// Parses the sample rate out of a RIFF/WAVE header, defaulting to 24000 Hz if unreadable.
function wavSampleRate(wav: Buffer): number {
  if (wav.length >= 28 && wav.toString("ascii", 0, 4) === "RIFF" && wav.toString("ascii", 8, 12) === "WAVE") {
    return wav.readUInt32LE(24) || 24000;
  }
  return 24000;
}

// Submits a synthesis job to vcd, polls until it finishes, and fetches the resulting WAV buffer.
export async function synthesizeWithVcd(
  req: {
    text: string;
    url?: string;
    voiceId?: string;
    language?: VcdLanguagePreference;
    pollIntervalMs?: number;
    timeoutMs?: number;
  },
  deps: VcdHttpDeps = {},
): Promise<VcdSynthesisResult> {
  const baseUrl = assertLoopbackVcdUrl(req.url || DEFAULT_VCD_URL);
  const fetchImpl = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const pollIntervalMs = req.pollIntervalMs ?? DEFAULT_POLL_MS;
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const trimmedText = req.text.trim();
  if (!trimmedText) {
    throw new VcdUnavailableError("bad_response", baseUrl, "Cannot synthesize empty text with My voice.");
  }

  let voiceId = (req.voiceId ?? "").trim();
  if (!voiceId) {
    const resolved = await resolveVcdVoiceId({ url: baseUrl }, deps);
    voiceId = resolved.voiceId;
  }

  const language = detectVcdLanguage(trimmedText, req.language ?? "auto");
  const deadline = Date.now() + timeoutMs;

  // Submit the job, retrying briefly if vcd's single-slot queue is temporarily full (HTTP 429).
  let jobId = "";
  for (let attempt = 0; attempt <= MAX_QUEUE_RETRIES; attempt++) {
    const submitRes = await vcdFetch(
      `${baseUrl}/v1/jobs`,
      baseUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice_id: voiceId, language, text: trimmedText }),
      },
      fetchImpl,
    );

    if (submitRes.status === 429 && attempt < MAX_QUEUE_RETRIES) {
      const retryAfterSec = Number(submitRes.headers.get("retry-after") || "1");
      const waitMs = Math.min(5000, Math.max(250, Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : 1000));
      await sleep(waitMs);
      continue;
    }

    if (submitRes.status === 404) {
      throw new VcdUnavailableError(
        "voice_not_found",
        baseUrl,
        `Voice "${voiceId}" was not found in the local voice service at ${baseUrl}. Check voiceClone.voiceId in aideos.config.json (or AIDEOS_VCD_VOICE_ID), enroll your voice, or choose another voice.`,
      );
    }

    if (!submitRes.ok) {
      const problem = await readProblemDetail(submitRes);
      throw new VcdUnavailableError(
        "job_failed",
        baseUrl,
        `Local voice service at ${baseUrl} could not start synthesis (${problem.detail}).`,
      );
    }

    const created = (await submitRes.json()) as { id?: string };
    if (!created.id) {
      throw new VcdUnavailableError(
        "bad_response",
        baseUrl,
        `Local voice service at ${baseUrl} returned a job without an id.`,
      );
    }
    jobId = created.id;
    break;
  }

  if (!jobId) {
    throw new VcdUnavailableError(
      "job_failed",
      baseUrl,
      `Local voice service queue at ${baseUrl} stayed full. Wait for running jobs to finish and try again.`,
    );
  }

  // Poll until the job completes.
  let audioSeconds: number | null = null;
  for (;;) {
    const pollRes = await vcdFetch(`${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}`, baseUrl, { method: "GET" }, fetchImpl);
    if (!pollRes.ok) {
      const problem = await readProblemDetail(pollRes);
      throw new VcdUnavailableError(
        "job_failed",
        baseUrl,
        `Local voice service at ${baseUrl} failed while checking job ${jobId} (${problem.detail}).`,
      );
    }
    const status = (await pollRes.json()) as {
      state?: string;
      error_code?: string | null;
      audio_seconds?: number | null;
    };
    if (status.state === "succeeded") {
      audioSeconds = typeof status.audio_seconds === "number" ? status.audio_seconds : null;
      break;
    }
    if (status.state === "failed" || status.state === "cancelled") {
      const code = status.error_code || status.state;
      throw new VcdUnavailableError(
        "job_failed",
        baseUrl,
        `Local voice service at ${baseUrl} failed to synthesize this line (${code}).`,
      );
    }
    if (Date.now() >= deadline) {
      throw new VcdUnavailableError(
        "timeout",
        baseUrl,
        `Local voice service at ${baseUrl} timed out while synthesizing job ${jobId}.`,
      );
    }
    await sleep(pollIntervalMs);
  }

  // Download the completed 24 kHz mono WAV.
  const audioRes = await vcdFetch(
    `${baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/audio`,
    baseUrl,
    { method: "GET" },
    fetchImpl,
  );
  if (!audioRes.ok) {
    const problem = await readProblemDetail(audioRes);
    throw new VcdUnavailableError(
      "bad_response",
      baseUrl,
      `Local voice service at ${baseUrl} could not deliver audio for job ${jobId} (${problem.detail}).`,
    );
  }
  const wav = Buffer.from(await audioRes.arrayBuffer());
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new VcdUnavailableError(
      "bad_response",
      baseUrl,
      `Local voice service at ${baseUrl} returned invalid WAV audio for job ${jobId}.`,
    );
  }

  return {
    wav,
    voiceId,
    language,
    jobId,
    audioSeconds,
    sampleRate: wavSampleRate(wav),
  };
}
