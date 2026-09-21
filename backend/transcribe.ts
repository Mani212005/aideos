/**
 * File Description: Transcribes an imported video or audio source into word-level timings, via
 * Deepgram's prerecorded "listen" API when DEEPGRAM_API_KEY is configured or a local Whisper CLI
 * fallback otherwise, in the same WordInfo shape voiceover_words.json already uses so downstream
 * caption and edit-context code needs no new parsing path.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { WordInfo } from "./audio";
import { resolveAudioSourcePath, buildCaptionsVtt } from "./audio";

/** A transcribed word: the shared WordInfo shape plus the ASR backend's own confidence score. */
export interface TranscribedWord extends WordInfo {
  confidence?: number;
  /** Set once a filler-detection pass has run over the transcript. Absent until then. */
  filler?: boolean;
}

export interface TranscribeOptions {
  /** Deepgram API key. Resolved from the environment or .env, then falls back to Whisper. */
  deepgramApiKey?: string;
  deepgramModel?: string;
}

export interface TranscribeDeps {
  /** Injected so tests never hit the real network. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Extracts a mono 16kHz WAV from a video/audio source. Defaults to a real ffmpeg call. */
  extractAudioTrack?: (srcPath: string, outWavPath: string) => void;
  /** Runs the local Whisper fallback. Defaults to shelling out to the whisper CLI. */
  runWhisper?: (wavPath: string) => TranscribedWord[];
}

export interface TranscribeResult {
  words: TranscribedWord[];
  backend: "deepgram" | "whisper";
}

/** Extracts a mono 16kHz WAV track from any source ffmpeg can decode. */
function defaultExtractAudioTrack(srcPath: string, outWavPath: string): void {
  execFileSync("ffmpeg", ["-y", "-i", srcPath, "-vn", "-ac", "1", "-ar", "16000", outWavPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Reads DEEPGRAM_API_KEY from the environment or the repo's .env file, mirroring the TTS path. */
export function resolveDeepgramApiKey(): string {
  if (process.env.DEEPGRAM_API_KEY) return process.env.DEEPGRAM_API_KEY;
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const match = fs.readFileSync(envPath, "utf8").match(/DEEPGRAM_API_KEY\s*=\s*(\S+)/);
    if (match) return match[1];
  }
  return "";
}

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  punctuated_word?: string;
  confidence?: number;
}

interface DeepgramResponse {
  results?: {
    channels?: Array<{ alternatives?: Array<{ words?: DeepgramWord[] }> }>;
  };
}

/** Sends a WAV file to Deepgram's prerecorded "listen" API and maps the response to TranscribedWord[]. */
async function transcribeWithDeepgram(
  wavPath: string,
  apiKey: string,
  model: string,
  fetchImpl: typeof fetch,
): Promise<TranscribedWord[]> {
  const url = `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&smart_format=true&punctuate=true&filler_words=true&utterances=true`;
  const body = fs.readFileSync(wavPath);
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/wav" },
    body,
  } as RequestInit);
  if (!res.ok) {
    throw new Error(`Deepgram transcription failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as DeepgramResponse;
  const words = json.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  return words.map((w) => ({
    word: w.word,
    start: w.start,
    end: w.end,
    punctuated_word: w.punctuated_word,
    confidence: w.confidence,
  }));
}

/** Runs the local Whisper CLI (openai-whisper) with word-level timestamps and JSON output. */
function defaultRunWhisper(wavPath: string): TranscribedWord[] {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-whisper-"));
  try {
    execFileSync(
      "whisper",
      [wavPath, "--model", "base", "--output_format", "json", "--output_dir", outDir, "--word_timestamps", "True"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const base = path.basename(wavPath, path.extname(wavPath));
    const jsonPath = path.join(outDir, `${base}.json`);
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
      segments?: Array<{ words?: Array<{ word: string; start: number; end: number; probability?: number }> }>;
    };
    const words: TranscribedWord[] = [];
    for (const seg of parsed.segments ?? []) {
      for (const w of seg.words ?? []) {
        const clean = w.word.trim();
        if (!clean) continue;
        words.push({
          word: clean.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ""),
          start: w.start,
          end: w.end,
          punctuated_word: clean,
          confidence: w.probability,
        });
      }
    }
    return words;
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

/**
 * Transcribes a video or audio source into word-level timings, preferring Deepgram and falling
 * back to a local Whisper CLI when no API key is configured. The words-shape is identical either
 * way, so downstream code never needs to know which backend produced them.
 */
export async function transcribe(
  src: string,
  opts: TranscribeOptions = {},
  deps: TranscribeDeps = {},
): Promise<TranscribeResult> {
  const resolvedSrc = resolveAudioSourcePath(src);
  const extractAudioTrack = deps.extractAudioTrack ?? defaultExtractAudioTrack;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-transcribe-"));
  try {
    const tmpWav = path.join(tmpDir, "audio.wav");
    extractAudioTrack(resolvedSrc, tmpWav);

    const apiKey = opts.deepgramApiKey ?? resolveDeepgramApiKey();
    if (apiKey) {
      const fetchImpl = deps.fetchImpl ?? fetch;
      const words = await transcribeWithDeepgram(tmpWav, apiKey, opts.deepgramModel ?? "nova-2", fetchImpl);
      return { words, backend: "deepgram" };
    }

    const runWhisper = deps.runWhisper ?? defaultRunWhisper;
    const words = runWhisper(tmpWav);
    return { words, backend: "whisper" };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Persists transcribed words plus a caption sidecar to a video package's own directory. */
export function writeImportWords(
  slug: string,
  words: TranscribedWord[],
  videosDir: string = path.resolve(process.cwd(), "videos"),
): { wordsPath: string; vttPath: string } {
  const dir = path.join(videosDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  const wordsPath = path.join(dir, "import_words.json");
  fs.writeFileSync(wordsPath, JSON.stringify({ words }, null, 2), "utf8");
  const vttPath = path.join(dir, "import_captions.vtt");
  fs.writeFileSync(vttPath, buildCaptionsVtt(words), "utf8");
  return { wordsPath, vttPath };
}
