/**
 * File Description: Audio-first narration pipeline. Splits a script into shot-scoped segments,
 * synthesizes each through a pluggable TTS backend, assembles the result in the sample domain
 * (trim, fade, exact-offset concatenation, peak normalization), and emits voiceover.wav,
 * captions.vtt, voiceover_words.json and the shot duration spine the film timeline is locked to.
 *
 * Assembly happens on samples rather than on encoded files on purpose: the old ffmpeg concat
 * path could stitch together chunks with different sample rates or channel layouts, left the
 * TTS engine's own leading and trailing silence in place, and measured the total back off the
 * encoded file. Those three together are what produced audible stutter at segment boundaries
 * and a growing drift between the narration and the visuals describing it.
 */

import { execSync } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { Film, parseFilm } from "../src/dl/schema";
import { extractSpokenBlocks, hasScreenplayTags } from "./scriptIntake";
import { createTtsBackend, PCM_SAMPLE_RATE, type TtsBackend, type TtsBackendName } from "./tts";
import {
  assembleSegments,
  deriveShotDurations,
  distributeWordTimings,
  encodeWav,
  normalizePeak,
  DEFAULT_ASSEMBLE_OPTIONS,
  type PcmChunk,
} from "./pcm";

export { trimSilence } from "./pcm";

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
}

/** Knobs the production pipeline and the editor both drive the narration synthesis with. */
export interface ProduceAudioOptions {
  /** Silence between two segments, in milliseconds. */
  gapMs?: number;
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

  // Claude-tagged screenplays ([VISUAL]/[NARRATION]/[ON SCREEN], VO:/Voiceover:/Narrator:) are
  // segmented strictly by their narration beats so visual and on-screen directions never leak
  // into TTS input. Untagged prose falls back to blank-line paragraph splitting.
  const rawSegments: string[] = hasScreenplayTags(trimmed)
    ? extractSpokenBlocks(trimmed)
    : trimmed.split(/\n\s*\n+/).map((p) => p.trim());

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

/**
 * Concatenate encoded audio files with fixed silence gaps through ffmpeg.
 *
 * Kept for callers that already hold encoded files. Every input is forced through aresample and
 * aformat first: ffmpeg's concat filter requires identical rate, layout and sample format on
 * every input, and feeding it mixed inputs is what used to yield silent channel drops or a hard
 * "Input link parameters differ" failure mid-run. The narration pipeline itself no longer uses
 * this path - it concatenates in the sample domain, where the result is exact by construction.
 */
export async function concatAudioSegments(
  audioFiles: string[],
  silenceWavPath: string,
  outWavPath: string,
): Promise<number> {
  if (audioFiles.length === 0) {
    throw new Error("No audio files provided to concatenate.");
  }

  if (audioFiles.length === 1) {
    execSync(`ffmpeg -y -i "${audioFiles[0]}" -ar 44100 -ac 2 "${outWavPath}"`);
    return await measureAudioDuration(outWavPath);
  }

  const inputs = audioFiles.flatMap((f, i) => (i === 0 ? [f] : [silenceWavPath, f]));
  const inputsStr = inputs.map((f) => `-i "${f}"`).join(" ");
  const normalize = inputs
    .map((_, i) => `[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[n${i}]`)
    .join(";");
  const filterStr = `${normalize};${inputs.map((_, i) => `[n${i}]`).join("")}concat=n=${inputs.length}:v=0:a=1[outa]`;

  execSync(
    `ffmpeg -y ${inputsStr} -filter_complex "${filterStr}" -map "[outa]" -ar 44100 -ac 2 "${outWavPath}"`,
  );

  return await measureAudioDuration(outWavPath);
}

/** Synthesize every segment's chunks through the backend, reporting progress as it goes. */
async function synthesizeSegments(
  segmentTexts: string[],
  backend: TtsBackend,
  onProgress?: ProduceAudioOptions["onProgress"],
): Promise<PcmChunk[][]> {
  const plan = segmentTexts.map((text) => chunkTextForTTS(text, backend.maxChars));
  const total = plan.reduce((sum, chunks) => sum + chunks.length, 0);
  let done = 0;

  const out: PcmChunk[][] = [];
  for (const chunks of plan) {
    const synthesized: PcmChunk[] = [];
    for (const text of chunks) {
      const samples = await backend.synthesize(text);
      if (samples.length === 0) {
        throw new Error(`TTS backend "${backend.name}" returned no audio for: "${text.slice(0, 60)}..."`);
      }
      synthesized.push({ text, samples });
      done += 1;
      onProgress?.(done, total, text.slice(0, 48));
    }
    out.push(synthesized);
  }
  return out;
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
 * The returned shot durations are boundary-to-boundary, so shot i starts at exactly the sample
 * where segment i's speech starts and the inter-segment gap lands at the tail of shot i rather
 * than pushing shot i+1's visuals late. Their sum equals the audio duration exactly.
 */
export async function produceAudioPipeline(
  script: string | string[],
  outDir: string,
  options?: ProduceAudioOptions,
): Promise<ProduceAudioResult> {
  const segmentTexts = splitScriptIntoSegments(script);
  const gapMs = options?.gapMs ?? DEFAULT_ASSEMBLE_OPTIONS.segmentGapMs;
  const chunkGapMs = options?.chunkGapMs ?? DEFAULT_ASSEMBLE_OPTIONS.chunkGapMs;

  await fs.mkdir(outDir, { recursive: true });

  const backend = await createTtsBackend({ backend: options?.backend, voice: options?.voice, speed: options?.speed });
  console.log(`[narration] synthesizing ${segmentTexts.length} segment(s) with ${backend.name}`);

  let segmentChunks: PcmChunk[][];
  try {
    segmentChunks = await synthesizeSegments(segmentTexts, backend, options?.onProgress);
  } finally {
    await backend.close?.();
  }

  const assembleOptions = {
    ...DEFAULT_ASSEMBLE_OPTIONS,
    sampleRate: PCM_SAMPLE_RATE,
    segmentGapMs: gapMs,
    chunkGapMs,
  };

  let assembled = assembleSegments(segmentChunks, assembleOptions);
  for (;;) {
    const merged = mergeShortSegments(segmentChunks, assembled.segments.map((s) => s.durationSec));
    if (!merged) break;
    console.log(`[narration] a segment fell under ${SCHEMA_MIN_DUR}s; merging it into its neighbour`);
    segmentChunks = merged;
    assembled = assembleSegments(segmentChunks, assembleOptions);
  }

  const normalized = normalizePeak(assembled.samples);

  const voiceoverPath = path.join(outDir, "voiceover.wav");
  await fs.writeFile(voiceoverPath, encodeWav(normalized, assembled.sampleRate));

  // Remotion resolves staticFile() against public/, so the render always needs a copy there.
  const publicDir = path.resolve(__dirname, "../public");
  if (path.resolve(outDir) !== publicDir) {
    await fs.mkdir(publicDir, { recursive: true });
    await fs.copyFile(voiceoverPath, path.join(publicDir, "voiceover.wav"));
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

  if (path.resolve(outDir) !== publicDir) {
    await fs.copyFile(captionsPath, path.join(publicDir, "captions.vtt"));
  }

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
      dur: Number(audioResult.shotDurations[i].toFixed(3)),
      stage: "frame" as const,
      look: targetNodeId,
      move: isChapterStart ? ("cut" as const) : ("pan" as const),
      scriptText: seg.text,
      visualDirection: brief.visualDirection,
      metaphor: brief.metaphor,
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
    captions: "captions.vtt",
    ...(options?.music ? { music: options.music } : {}),
    ...(options?.sfx ? { sfx: options.sfx } : {}),
  };

  return parseFilm(filmRaw);
}

/** Generate audio for film using the narration pipeline and rebuild the film around it. */
export async function processAudioForFilm(film: Film, outDir: string): Promise<Film> {
  const validShots = film.shots.map((s) => (s.scriptText || "").trim()).filter((t) => t.length > 0);

  if (validShots.length === 0) {
    return film;
  }

  const audioResult = await produceAudioPipeline(validShots, outDir);
  return buildFilmFromAudioResult(film.title, audioResult);
}
