/**
 * File Description: Audio-first narration pipeline. Splits a script into shot-scoped segments,
 * synthesizes each through a pluggable TTS backend with per-line caching (voiceover_lines/),
 * assembles the result in the sample domain (trim, fade, exact-offset concatenation, loudness
 * and peak normalization), and emits voiceover.wav, captions.vtt, voiceover_words.json and the
 * shot duration spine the film timeline is locked to. Script-to-synthesis callers share the
 * script-intake assertion, with this boundary covering pipeline resumes and Studio /api/voiceover.
 * Inputs and outputs: screenplay text and audio options -> voiceover.wav, captions.vtt, voiceover_words.json, and shot duration spine.
 * Used by: backend/pipeline/run.ts, backend/cli.ts, editor/vite.config.ts.
 *
 * Assembly happens on samples rather than on encoded files on purpose: the old ffmpeg concat
 * path could stitch together chunks with different sample rates or channel layouts, left the
 * TTS engine's own leading and trailing silence in place, and measured the total back off the
 * encoded file. Those three together are what produced audible stutter at segment boundaries
 * and a growing drift between the narration and the visuals describing it.
 */

import { execFileSync, execSync } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { type Film, parseFilm } from "../src/dl/schema";
import { getRetimedAudioFilename } from "../src/dl/audio/retime";
import { assertScriptReadyForSynthesis, detectChapterStartsFromScript, extractSpokenBlocks, hasScreenplayTags, plainTextToTaggedScript } from "./scriptIntake";
import type { ScriptIssue } from "./screenplayLines";
import { synthesizeLines } from "./voiceLines";
import { createTtsBackend, PCM_SAMPLE_RATE, type TtsBackend, type TtsBackendName } from "./tts";
import * as fsSync from "fs";
import {
  assembleSegments,
  deriveShotDurations,
  distributeWordTimings,
  encodeWav,
  decodeWav,
  shotDurationsOnMillisecondGrid,
  normalizePeak,
  DEFAULT_ASSEMBLE_OPTIONS,
  type PcmChunk,
} from "./pcm";

export { trimSilence, CHAPTER_BREATH_GAP_MS } from "./pcm";
export { detectChapterStartsFromScript } from "./scriptIntake";

export interface WordInfo {
  word: string;
  start: number;
  end: number;
  punctuated_word?: string;
}

export interface UtteranceInfo {
  start: number;
  end: number;
  transcript: string;
}

export interface SegmentAudioInfo {
  text: string;
  duration: number;
  startOffset: number;
  words: WordInfo[];
  utterances: UtteranceInfo[];
}

export interface ProduceAudioResult {
  segments: SegmentAudioInfo[];
  shotDurations: number[];
  totalAudioDuration: number;
  voiceoverPath: string;
  captionsPath: string;
  captionsVttContent: string;
  /** Absolute-timeline word list, mirrored to voiceover_words.json. */
  words: WordInfo[];
  /** Sidecar path holding the absolute word timings. */
  wordsPath: string;
  /** Which synthesizer produced the narration, for provenance in logs and manifests. */
  ttsBackend: string;
  /** The voice id the synthesizer used (null when it has no voices), so a later line can match it. */
  voice: string | null;
  /** The pace multiplier the synthesizer applied (null when it has no pace control). */
  speed: number | null;
  /** How many lines were recorded in this run and how many reused a stored recording. */
  lines?: { recorded: number; reused: number };
}

/** Knobs the production pipeline and the editor both drive the narration synthesis with. */
export interface ProduceAudioOptions {
  /** Original user input when the caller has already normalized the script for synthesis. */
  intakeSource?: string;
  /** Receives non-blocking line-classifier notices before any synthesis begins. */
  onIntakeNotice?: (issue: ScriptIssue) => void;
  /** Silence between two segments, in milliseconds. */
  gapMs?: number;
  /** Silence between segments at a chapter boundary, in milliseconds (decision D4). */
  chapterGapMs?: number;
  /**
   * Optional boolean array marking which segment indices start a new chapter.
   * If omitted and script is a screenplay, chapter boundaries are inferred from script sections.
   */
  isChapterStart?: boolean[];
  /** Silence between chunks inside one segment, in milliseconds. */
  chunkGapMs?: number;
  /** Pin a specific synthesizer instead of auto-selecting. */
  backend?: TtsBackendName;
  /** Voice id, interpreted by the chosen backend. */
  voice?: string;
  /** Narration pace multiplier. Below 1 slows delivery, which reads better for explainer copy. */
  speed?: number;
  /** Called once per synthesized chunk so long runs can report progress. */
  onProgress?: (done: number, total: number, label: string) => void;
  /** A synthesizer to use instead of creating one from `backend` (tests inject a counting one). */
  ttsBackendInstance?: TtsBackend;
  /**
   * Preview sync flag (legacy option retained for caller compatibility; voiceover and captions
   * are resolved directly from videos/<slug>/ via the public/videos symlink).
   */
  syncToPreview?: boolean;
}

/** Loudness target inside the measured review window, with safe true-peak headroom. */
export const NARRATION_LOUDNESS_TARGET = { integratedLufs: -16, truePeakDb: -1 } as const;

/** Normalizes a narration WAV to the review loudness target without changing its duration. */
export function normalizeNarrationLoudness(inputPath: string, outputPath: string): void {
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath,
    "-af", `loudnorm=I=${NARRATION_LOUDNESS_TARGET.integratedLufs}:TP=${NARRATION_LOUDNESS_TARGET.truePeakDb}:LRA=11`,
    "-ar", String(PCM_SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", outputPath,
  ], { stdio: "pipe" });
}

/** Shots shorter than the schema's floor get merged into their neighbour. */
const SCHEMA_MIN_DUR = 0.5;

/**
 * Splits text blocks exceeding maxChars at sentence boundaries.
 *
 * Kokoro truncates past its phoneme-token limit, so over-long input silently loses its tail.
 * Splitting on sentences (and only falling back to word splitting for text with no sentence
 * punctuation at all) keeps each piece prosodically whole.
 */
export function chunkTextForTTS(text: string, maxChars = 800): string[] {
  const rawParagraphs = text.split(/\r?\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];

  for (const p of rawParagraphs) {
    if (p.length <= maxChars) {
      chunks.push(p);
      continue;
    }
    // Match complete sentences preserving punctuation and sentence prosody
    const sentences = p.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [p];
    let currentChunk = "";

    for (const sentence of sentences) {
      const s = sentence.trim();
      if (!s) continue;

      if (s.length > maxChars) {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = "";
        }
        const words = s.split(/\s+/).filter(Boolean);
        let wordChunk = "";
        for (const w of words) {
          if (!wordChunk) {
            wordChunk = w;
          } else if ((wordChunk + " " + w).length <= maxChars) {
            wordChunk = wordChunk + " " + w;
          } else {
            chunks.push(wordChunk);
            wordChunk = w;
          }
        }
        if (wordChunk) {
          currentChunk = wordChunk;
        }
      } else {
        if (!currentChunk) {
          currentChunk = s;
        } else if ((currentChunk + " " + s).length <= maxChars) {
          currentChunk = currentChunk + " " + s;
        } else {
          chunks.push(currentChunk);
          currentChunk = s;
        }
      }
    }
    if (currentChunk) {
      chunks.push(currentChunk);
    }
  }

  return chunks.filter(Boolean);
}

/**
 * Split a narration script into distinct segments (one per shot/beat).
 * Accepts either an explicit string[] (one per shot) or a string script.
 * Rejects empty scripts or scripts containing mid-script empty/textless segments.
 */
export function splitScriptIntoSegments(script: string | string[]): string[] {
  if (Array.isArray(script)) {
    const list = script.map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) {
      throw new Error("A shot with no narration is not allowed mid-script in v1");
    }
    return list;
  }

  if (!script || typeof script !== "string") {
    throw new Error("A shot with no narration is not allowed mid-script in v1");
  }
  const trimmed = script.trim();
  if (!trimmed) {
    throw new Error("A shot with no narration is not allowed mid-script in v1");
  }

  // Tagged screenplays ([VISUAL]/[NARRATION]/[ON SCREEN], VO:/Voiceover:/Narrator:) are segmented
  // strictly by their narration beats so visual and on-screen directions never leak into TTS input.
  // A plain-text story is segmented by the same rule after its deterministic conversion, so its
  // paragraphs are the segments and a "#Start" style marker is never spoken.
  const rawSegments: string[] = hasScreenplayTags(trimmed)
    ? extractSpokenBlocks(trimmed)
    : extractSpokenBlocks(plainTextToTaggedScript(trimmed));

  for (const p of rawSegments) {
    if (!p) {
      // Empty paragraph mid-script
      throw new Error("A shot with no narration is not allowed mid-script in v1");
    }
  }

  if (rawSegments.length === 0) {
    throw new Error("A shot with no narration is not allowed mid-script in v1");
  }

  for (const seg of rawSegments) {
    if (!seg || seg.replace(/[^a-zA-Z0-9]/g, "").length === 0) {
      throw new Error("A shot with no narration is not allowed mid-script in v1");
    }
  }

  return rawSegments;
}

/** Format seconds to WEBVTT timestamp string (HH:MM:SS.mmm). */
export function formatTime(seconds: number): string {
  const pad = (n: number, z = 2) => String(n).padStart(z, "0");
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

/** Measure exact audio file duration using ffprobe. */
export async function measureAudioDuration(filePath: string): Promise<number> {
  try {
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
    )
      .toString()
      .trim();
    const dur = parseFloat(output);
    if (isNaN(dur) || dur <= 0) {
      throw new Error(`Invalid duration output: "${output}"`);
    }
    return dur;
  } catch (err) {
    throw new Error(`Failed to measure audio duration for ${filePath}: ${(err as Error).message}`);
  }
}

/** Synthesizes one segment's text as its chunks, each within the backend's length limit. */
async function synthesizeChunks(text: string, backend: TtsBackend, onChunk?: (text: string) => void): Promise<PcmChunk[]> {
  const synthesized: PcmChunk[] = [];
  for (const chunk of chunkTextForTTS(text, backend.maxChars)) {
    const samples = await backend.synthesize(chunk);
    if (samples.length === 0) {
      throw new Error(`TTS backend "${backend.name}" returned no audio for: "${chunk.slice(0, 60)}..."`);
    }
    synthesized.push({ text: chunk, samples });
    onChunk?.(chunk);
  }
  return synthesized;
}

/**
 * Synthesize every segment's chunks through the backend, reporting progress as it goes. With a line
 * store, a segment whose fingerprint (its words plus the voice, pace and chunk limit) already has a
 * recording is reused and the backend is not called for it.
 */
async function synthesizeSegments(
  segmentTexts: string[],
  backend: TtsBackend,
  onProgress?: ProduceAudioOptions["onProgress"],
  store?: { pkgDir: string },
): Promise<{ chunks: PcmChunk[][]; lines?: { recorded: number; reused: number } }> {
  const total = segmentTexts.reduce((sum, text) => sum + chunkTextForTTS(text, backend.maxChars).length, 0);
  let done = 0;
  const report = (text: string) => {
    done += 1;
    onProgress?.(done, total, text.slice(0, 48));
  };

  if (!store) {
    const out: PcmChunk[][] = [];
    for (const text of segmentTexts) out.push(await synthesizeChunks(text, backend, report));
    return { chunks: out };
  }

  const voiceKey = `${backend.name}|${backend.voice ?? ""}|${backend.speed ?? ""}|${backend.maxChars}|${PCM_SAMPLE_RATE}`;
  const result = await synthesizeLines({
    pkgDir: store.pkgDir,
    texts: segmentTexts,
    voiceKey,
    synthesize: async (text) => ({ sampleRate: PCM_SAMPLE_RATE, chunks: await synthesizeChunks(text, backend, report) }),
    onLine: (_n, _total, text, reused) => {
      if (reused) for (const chunk of chunkTextForTTS(text, backend.maxChars)) report(chunk);
    },
  });
  return { chunks: result.lines.map((line) => line.audio.chunks), lines: { recorded: result.recorded, reused: result.reused } };
}

/**
 * Merge any segment whose assembled audio falls under the schema's minimum shot duration
 * into its neighbour. Merging joins already-synthesized chunk lists rather than re-running
 * TTS, so the audio is bit-identical and the pass is effectively free.
 */
function mergeShortSegments(
  segmentChunks: PcmChunk[][],
  durations: number[],
): PcmChunk[][] | null {
  const shortIdx = durations.findIndex((d) => d < SCHEMA_MIN_DUR);
  if (shortIdx < 0 || segmentChunks.length < 2) return null;
  const target = shortIdx > 0 ? shortIdx - 1 : 0;
  const merged = segmentChunks.map((c) => c.slice());
  merged[target] = [...merged[target], ...merged[target + 1]];
  merged.splice(target + 1, 1);
  return merged;
}

/**
 * Audio-first synthesis: script in, narration track plus the exact timing spine out.
 *
 * Each narration line is cached under voiceover_lines/ by content fingerprint (backend/voiceLines.ts),
 * so only changed lines are re-recorded.
 *
 * The returned shot durations are boundary-to-boundary, so shot i starts at exactly the sample
 * where segment i's speech starts and the inter-segment gap lands at the tail of shot i rather
 * than pushing shot i+1's visuals late. Their sum equals the audio duration exactly.
 */
export async function produceAudioPipeline(
  script: string | string[],
  outDir: string,
  options?: ProduceAudioOptions,
): Promise<ProduceAudioResult> {
  const intakeSource = options?.intakeSource ?? (Array.isArray(script) ? script.join("\n") : script);
  assertScriptReadyForSynthesis(intakeSource, options?.onIntakeNotice);
  const segmentTexts = splitScriptIntoSegments(script);
  const gapMs = options?.gapMs ?? DEFAULT_ASSEMBLE_OPTIONS.segmentGapMs;
  const chapterGapMs = options?.chapterGapMs ?? DEFAULT_ASSEMBLE_OPTIONS.chapterGapMs;
  const chunkGapMs = options?.chunkGapMs ?? DEFAULT_ASSEMBLE_OPTIONS.chunkGapMs;

  let chapterStarts: boolean[] | undefined;
  if (options?.isChapterStart) {
    chapterStarts = [...options.isChapterStart];
  } else if (typeof script === "string" && hasScreenplayTags(script)) {
    chapterStarts = detectChapterStartsFromScript(script);
  }

  await fs.mkdir(outDir, { recursive: true });

  const backend = options?.ttsBackendInstance ?? (await createTtsBackend({ backend: options?.backend, voice: options?.voice, speed: options?.speed }));
  console.error(`[narration] synthesizing ${segmentTexts.length} segment(s) with ${backend.name}`);

  let segmentChunks: PcmChunk[][];
  let lineCounts: { recorded: number; reused: number } | undefined;
  try {
    const synthesized = await synthesizeSegments(segmentTexts, backend, options?.onProgress, { pkgDir: outDir });
    segmentChunks = synthesized.chunks;
    lineCounts = synthesized.lines;
    if (lineCounts) console.error(`[narration] ${lineCounts.recorded} line(s) recorded, ${lineCounts.reused} reused`);
  } finally {
    await backend.close?.();
  }

  const assembleOptions = {
    ...DEFAULT_ASSEMBLE_OPTIONS,
    sampleRate: PCM_SAMPLE_RATE,
    segmentGapMs: gapMs,
    chapterGapMs,
    isChapterStart: chapterStarts,
    chunkGapMs,
  };

  let assembled = assembleSegments(segmentChunks, assembleOptions);
  for (;;) {
    const shortIdx = assembled.segments.findIndex((s) => s.durationSec < SCHEMA_MIN_DUR);
    if (shortIdx < 0 || segmentChunks.length < 2) break;
    const target = shortIdx > 0 ? shortIdx - 1 : 0;
    const merged = mergeShortSegments(segmentChunks, assembled.segments.map((s) => s.durationSec));
    if (!merged) break;
    console.error(`[narration] a segment fell under ${SCHEMA_MIN_DUR}s; merging it into its neighbour`);
    segmentChunks = merged;
    if (chapterStarts && chapterStarts.length > target + 1) {
      chapterStarts.splice(target + 1, 1);
      assembleOptions.isChapterStart = chapterStarts;
    }
    assembled = assembleSegments(segmentChunks, assembleOptions);
  }

  const normalized = normalizePeak(assembled.samples);

  const voiceoverPath = path.join(outDir, "voiceover.wav");
  await fs.writeFile(voiceoverPath, encodeWav(normalized, assembled.sampleRate));
  const normalizedVoiceoverPath = `${voiceoverPath}.loudnorm.wav`;
  try {
    normalizeNarrationLoudness(voiceoverPath, normalizedVoiceoverPath);
    await fs.rename(normalizedVoiceoverPath, voiceoverPath);
  } finally {
    await fs.rm(normalizedVoiceoverPath, { force: true });
  }

  // Shot durations run boundary to boundary so every shot starts exactly where its narration
  // does, and the final shot absorbs the tail. Summing them reproduces the audio length exactly.
  const segments: SegmentAudioInfo[] = [];
  const shotDurations = deriveShotDurations(assembled.segments, assembled.totalSec);
  const absoluteWords: WordInfo[] = [];

  assembled.segments.forEach((seg) => {
    const relativeWords = distributeWordTimings(seg.text, seg.durationSec);
    relativeWords.forEach((w) => {
      absoluteWords.push({
        word: w.word,
        punctuated_word: w.punctuated_word,
        start: Number((seg.startSec + w.start).toFixed(3)),
        end: Number((seg.startSec + w.end).toFixed(3)),
      });
    });

    segments.push({
      text: seg.text,
      duration: seg.durationSec,
      startOffset: seg.startSec,
      words: relativeWords,
      utterances: [{ start: 0, end: seg.durationSec, transcript: seg.text }],
    });
  });

  const vttContent = buildCaptionsVtt(absoluteWords);
  const captionsPath = path.join(outDir, "captions.vtt");
  await fs.writeFile(captionsPath, vttContent, "utf-8");

  const wordsPath = path.join(outDir, "voiceover_words.json");
  await fs.writeFile(wordsPath, JSON.stringify({ words: absoluteWords }, null, 2), "utf-8");

  return {
    segments,
    shotDurations,
    totalAudioDuration: assembled.totalSec,
    voiceoverPath,
    captionsPath,
    captionsVttContent: vttContent,
    words: absoluteWords,
    wordsPath,
    ttsBackend: backend.name,
    voice: backend.voice ?? null,
    speed: backend.speed ?? null,
    ...(lineCounts ? { lines: lineCounts } : {}),
  };
}

/**
 * Builds readable WebVTT cues from absolute word timings.
 *
 * Cues break on sentence punctuation or after seven words, whichever comes first, so a cue is
 * a phrase a viewer can read rather than a whole ten-second paragraph pinned to the screen.
 */
export function buildCaptionsVtt(words: WordInfo[]): string {
  const lines = ["WEBVTT", ""];
  let chunk: WordInfo[] = [];

  const flush = () => {
    if (chunk.length === 0) return;
    lines.push(`${formatTime(chunk[0].start)} --> ${formatTime(chunk[chunk.length - 1].end)}`);
    lines.push(chunk.map((w) => w.punctuated_word || w.word).join(" "));
    lines.push("");
    chunk = [];
  };

  for (const word of words) {
    chunk.push(word);
    const text = word.punctuated_word || word.word;
    if (/[.!?]["')\]]?$/.test(text) || chunk.length >= 7) flush();
  }
  flush();

  return lines.join("\n");
}

import { buildBriefFromSegmentFallback } from "./ideation/segmentSync";
import { generateRelationshipAwareCanvas, type ConceptEntity } from "./ideation/graphLayout";
import { getVideosDir } from "../src/dl/videoPackageLoader";

/**
 * The part of a narration result a film is built from: the spoken segments and their
 * durations. Narrowed from ProduceAudioResult so callers (and tests) can construct a film
 * from a timing spine without also having to produce a wav on disk.
 */
export type FilmTimingSpine = Pick<
  ProduceAudioResult,
  "segments" | "shotDurations" | "totalAudioDuration"
>;

/** Construct a valid Film schema object from produce result. */
export function buildFilmFromAudioResult(
  title: string,
  audioResult: FilmTimingSpine,
  options?: {
    music?: { src: string; volume?: number; duckUnderVoiceover?: boolean };
    sfx?: Array<{ timeSec: number; src: string; volume?: number }>;
  },
): Film {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "produced-film";

  const numShots = audioResult.segments.length;
  // Create 2-6 concept entities reflecting screenplay structure
  const conceptEntities: ConceptEntity[] = audioResult.segments.slice(0, Math.min(8, Math.max(3, numShots))).map((seg, i) => {
    const words = seg.text.replace(/[^\w\s-]/g, "").split(/\s+/).filter(Boolean);
    const label = words.slice(0, 3).join(" ") || `Concept ${i + 1}`;
    const sub = words.slice(3, 7).join(" ");
    const isContrast = seg.text.toLowerCase().includes("contrast") || seg.text.toLowerCase().includes("versus") || seg.text.toLowerCase().includes("however");
    return {
      id: `concept-${i + 1}`,
      label: label.charAt(0).toUpperCase() + label.slice(1),
      sub: sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : undefined,
      chapterIndex: Math.floor((i * 3) / numShots),
      relationship: isContrast ? ("contrast" as const) : ("sequential" as const),
      relatedTo: i > 0 ? `concept-${i}` : undefined,
    };
  });

  const { nodes, edges } = generateRelationshipAwareCanvas(conceptEntities);
  const chapters = Array.from(new Set(conceptEntities.map((c) => `chapter-${(c.chapterIndex ?? 0) + 1}`)));

  // Shot lengths on the millisecond grid of the narration's own offsets, so rounding never accumulates behind its words.
  const gridDurations = shotDurationsOnMillisecondGrid(audioResult.segments.map((seg) => seg.startOffset), audioResult.shotDurations);

  // Create shots with segment-scoped visual brief mapping
  const shots = audioResult.segments.map((seg, i) => {
    const chIndex = Math.floor((i * chapters.length) / numShots);
    const chName = chapters[chIndex] || "chapter-1";
    const isChapterStart = i === 0 || Math.floor(((i - 1) * chapters.length) / numShots) !== chIndex;
    const targetNodeId = nodes[Math.min(i, nodes.length - 1)].id;
    const brief = buildBriefFromSegmentFallback(seg.text, `shot-${i + 1}`);

    return {
      id: `shot-${i + 1}`,
      ch: chName,
      dur: gridDurations[i],
      stage: "frame" as const,
      look: targetNodeId,
      move: isChapterStart ? ("cut" as const) : ("pan" as const),
      scriptText: seg.text,
      visualDirection: brief.visualDirection,
      blocks: brief.blocks,
    };
  });

  const filmRaw = {
    id: slug,
    title,
    fps: 30 as const,
    chapters,
    canvas: { nodes, edges },
    shots,
    voiceover: { src: "voiceover.wav", volume: 1, durationSec: audioResult.totalAudioDuration },
    captions: "bottom",
    ...(options?.music ? { music: options.music } : {}),
    ...(options?.sfx ? { sfx: options.sfx } : {}),
  };

  return parseFilm(filmRaw);
}

/** Result of pitch-corrected WSOLA time-stretching for an audio track. */
export interface RetimedAudioResult {
  filePath: string;
  durationSec: number;
}

/** Build an FFmpeg atempo filter chain supporting arbitrary playback speed factors. */
export function buildAtempoFilter(speed: number): string {
  if (speed <= 0) {
    throw new Error(`Invalid speed: ${speed}. Speed must be positive.`);
  }
  const filters: string[] = [];
  let s = speed;
  while (s > 2.0) {
    filters.push("atempo=2.0");
    s /= 2.0;
  }
  while (s < 0.5) {
    filters.push("atempo=0.5");
    s /= 0.5;
  }
  filters.push(`atempo=${s.toFixed(4)}`);
  return filters.join(",");
}

/**
 * Repo root, resolved from this module's own location rather than `process.cwd()`. The editor's
 * dev server is launched with `cd editor && npm run dev`, so its cwd is `editor/`, not the repo
 * root the pipeline CLI and tests run from; a cwd-only lookup silently failed to find any footage
 * asset (audio peaks, transcription) whenever the source was resolved from inside the editor.
 */
const REPO_ROOT = path.resolve(__dirname, "..");

/** Resolve an audio source URL or file reference to an absolute path on disk. */
export function resolveAudioSourcePath(src: string): string {
  const cleanSrc = src.split("?")[0].split("#")[0];
  const bases = [process.cwd(), REPO_ROOT];
  const candidates = [path.resolve(cleanSrc)];
  for (const base of bases) {
    candidates.push(
      path.resolve(base, cleanSrc.replace(/^\//, "")),
      path.resolve(base, "public", cleanSrc.replace(/^\//, "")),
      path.resolve(base, "videos", cleanSrc.replace(/^\/?videos\/?/, "")),
      path.resolve(getVideosDir(), cleanSrc.replace(/^\/?videos\/?/, "")),
      path.resolve(base, ".tmp_audio", cleanSrc.replace(/^\/?(\.tmp_audio|api\/audio)\/?/, "")),
    );
  }
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate) && fsSync.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error(`Audio source file not found: ${src}`);
}

/** Synchronously retimes an audio file using FFmpeg WSOLA-based atempo filter and caches the result. */
export function retimeAudioSync(
  src: string,
  speed: number,
  options?: { cacheDir?: string; outPath?: string }
): RetimedAudioResult {
  if (speed <= 0 || !Number.isFinite(speed)) {
    throw new Error(`Invalid speed: ${speed}`);
  }

  const resolved = resolveAudioSourcePath(src);
  const cacheDir = options?.cacheDir || path.resolve(process.cwd(), ".tmp_audio");
  if (!fsSync.existsSync(cacheDir)) {
    fsSync.mkdirSync(cacheDir, { recursive: true });
  }

  // If 1.0x speed, measure original duration and return original file
  if (Math.abs(speed - 1.0) < 0.001) {
    let dur = 0;
    try {
      const buf = fsSync.readFileSync(resolved);
      const dec = decodeWav(buf);
      dur = Number((dec.samples.length / dec.sampleRate).toFixed(3));
    } catch {
      dur = 0;
    }
    return { filePath: resolved, durationSec: dur };
  }

  const outFilename = getRetimedAudioFilename(src, speed);
  const outPath = options?.outPath || path.join(cacheDir, outFilename);

  // Return cached result if already rendered and valid
  if (fsSync.existsSync(outPath) && fsSync.statSync(outPath).size > 44) {
    let dur = 0;
    try {
      const buf = fsSync.readFileSync(outPath);
      const dec = decodeWav(buf);
      dur = Number((dec.samples.length / dec.sampleRate).toFixed(3));
    } catch {
      dur = 0;
    }
    return { filePath: outPath, durationSec: dur };
  }

  const filter = buildAtempoFilter(speed);
  execFileSync("ffmpeg", ["-y", "-i", resolved, "-filter:a", filter, "-vn", "-c:a", "pcm_s16le", outPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let durationSec = 0;
  try {
    const buf = fsSync.readFileSync(outPath);
    const decoded = decodeWav(buf);
    durationSec = Number((decoded.samples.length / decoded.sampleRate).toFixed(3));
  } catch {
    const durOutput = execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      outPath,
    ])
      .toString()
      .trim();
    durationSec = Number(parseFloat(durOutput).toFixed(3));
  }

  return { filePath: outPath, durationSec };
}

/** Retimes an audio file using FFmpeg WSOLA-based atempo filter and caches the result. */
export async function retimeAudio(
  src: string,
  speed: number,
  options?: { cacheDir?: string; outPath?: string }
): Promise<RetimedAudioResult> {
  return retimeAudioSync(src, speed, options);
}

/** Pre-renders all retimed audio tracks in a film so Remotion CLI can access them statically. */
export function ensureRetimedAudio(film: Film): void {
  if (film.voiceover?.src && film.voiceover.speed && Math.abs(film.voiceover.speed - 1.0) > 0.001) {
    try {
      retimeAudioSync(film.voiceover.src, film.voiceover.speed);
    } catch {
      // Best-effort pre-render
    }
  }
  if (film.audioClips) {
    for (const clip of film.audioClips) {
      if (clip.src && clip.speed && Math.abs(clip.speed - 1.0) > 0.001) {
        try {
          retimeAudioSync(clip.src, clip.speed);
        } catch {
          // Best-effort pre-render
        }
      }
    }
  }
}

