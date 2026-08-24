import { createClient } from "@deepgram/sdk";
import * as fs from "fs/promises";
import * as path from "path";
import { execSync } from "child_process";
import { Film, parseFilm } from "../src/dl/schema";

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
}

/**
 * Split a narration script into distinct segments (one per shot/beat).
 * Sentences or explicit blank lines / newlines define segments.
 * Rejects empty scripts or scripts containing mid-script empty/textless segments.
 */
export function splitScriptIntoSegments(script: string): string[] {
  if (!script || typeof script !== "string") {
    throw new Error("A shot with no narration is not allowed mid-script in v1");
  }
  const trimmed = script.trim();
  if (!trimmed) {
    throw new Error("A shot with no narration is not allowed mid-script in v1");
  }

  // Check if text has explicit blank line separators or line breaks
  const paragraphs = trimmed.split(/\n\s*\n+/);
  const rawSegments: string[] = [];

  for (const para of paragraphs) {
    const p = para.trim();
    if (!p) {
      // Empty paragraph mid-script
      throw new Error("A shot with no narration is not allowed mid-script in v1");
    }
    const lines = p.split(/\n+/);
    for (const line of lines) {
      const l = line.trim();
      if (!l) {
        throw new Error("A shot with no narration is not allowed mid-script in v1");
      }
      // Split line into sentences on punctuation (. ! ?) followed by whitespace or end
      const sentences = l
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      rawSegments.push(...sentences);
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

/** Concatenate segment audio files with fixed silence gaps using ffmpeg filter_complex. */
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

  const inputsStr = audioFiles
    .flatMap((f, i) => (i === 0 ? [`-i "${f}"`] : [`-i "${silenceWavPath}"`, `-i "${f}"`]))
    .join(" ");

  const count = audioFiles.length * 2 - 1;
  const filterStr =
    Array.from({ length: count }, (_, i) => `[${i}:a]`).join("") +
    `concat=n=${count}:v=0:a=1[outa]`;

  execSync(
    `ffmpeg -y ${inputsStr} -filter_complex "${filterStr}" -map "[outa]" -ar 44100 -ac 2 "${outWavPath}"`,
  );

  return await measureAudioDuration(outWavPath);
}

/**
 * Phase 1 & 2: Audio-first synthesis, timeline offset calculation, gap handling,
 * and VTT caption generation.
 */
export async function produceAudioPipeline(
  script: string,
  outDir: string,
  options?: { gapMs?: number },
): Promise<ProduceAudioResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY is not set.");
  }
  const deepgram = createClient(apiKey);

  let segmentTexts = splitScriptIntoSegments(script);
  const gapMs = options?.gapMs ?? 200;
  const gapSec = gapMs / 1000;

  await fs.mkdir(outDir, { recursive: true });
  const tmpDir = path.join(outDir, ".tmp_audio");
  await fs.mkdir(tmpDir, { recursive: true });

  const silencePath = path.join(tmpDir, "silence.wav");
  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${gapSec} "${silencePath}"`);

  let segments: SegmentAudioInfo[] = [];

  // Loop to synthesize and check segment durations.
  // If any segment is under schema minimum (0.5s), merge with neighbor and retry.
  const SCHEMA_MIN_DUR = 0.5;

  while (true) {
    segments = [];
    const audioFiles: string[] = [];

    for (let i = 0; i < segmentTexts.length; i++) {
      const text = segmentTexts[i];
      console.log(`[Audio-First TTS] Synthesizing segment ${i + 1}/${segmentTexts.length}: "${text.slice(0, 40)}..."`);
      
      const ttsResponse = await deepgram.speak.request(
        { text },
        { model: "aura-asteria-en" },
      );
      const stream = await ttsResponse.getStream();
      if (!stream) {
        throw new Error(`Failed to get TTS stream for segment ${i + 1}`);
      }
      const audioBuffer = await stream2buffer(stream);
      const segFile = path.join(tmpDir, `seg_${i}.mp3`);
      await fs.writeFile(segFile, audioBuffer);
      audioFiles.push(segFile);

      const dur = await measureAudioDuration(segFile);

      // Transcribe segment via Deepgram Nova to get word-level / utterance timestamps
      const sttResponse = await deepgram.listen.prerecorded.transcribeFile(
        audioBuffer,
        {
          model: "nova-2",
          smart_format: true,
          utterances: true,
        },
      );

      let words: WordInfo[] = [];
      let utterances: UtteranceInfo[] = [];

      if (!sttResponse.error && sttResponse.result?.results) {
        const alt = sttResponse.result.results.channels[0]?.alternatives[0];
        if (alt?.words) {
          words = alt.words;
        }
        if (sttResponse.result.results.utterances) {
          utterances = sttResponse.result.results.utterances;
        }
      }

      segments.push({
        text,
        duration: dur,
        startOffset: 0,
        words,
        utterances,
      });
    }

    // Check if any segment's measured duration + gap share is < SCHEMA_MIN_DUR
    let underMinIndex = -1;
    for (let i = 0; i < segments.length; i++) {
      const segDur = segments[i].duration + (i < segments.length - 1 ? gapSec : 0);
      if (segDur < SCHEMA_MIN_DUR) {
        underMinIndex = i;
        break;
      }
    }

    if (underMinIndex >= 0 && segmentTexts.length > 1) {
      console.log(`Segment ${underMinIndex + 1} (${segments[underMinIndex].duration.toFixed(2)}s) under schema minimum ${SCHEMA_MIN_DUR}s; merging with neighbor.`);
      const newSegmentsText: string[] = [];
      const mergeTarget = underMinIndex > 0 ? underMinIndex - 1 : underMinIndex;
      for (let i = 0; i < segmentTexts.length; i++) {
        if (i === mergeTarget) {
          newSegmentsText.push(`${segmentTexts[mergeTarget]} ${segmentTexts[mergeTarget + 1]}`);
          i++; // Skip merged next segment
        } else {
          newSegmentsText.push(segmentTexts[i]);
        }
      }
      segmentTexts = newSegmentsText;
      // Loop again with merged segments
      continue;
    }

    break;
  }

  // Concatenate all audio segments into voiceover.wav
  const voiceoverPath = path.join(outDir, "voiceover.wav");
  const audioFiles = segments.map((_, i) => path.join(tmpDir, `seg_${i}.mp3`));
  const totalAudioDuration = await concatAudioSegments(audioFiles, silencePath, voiceoverPath);

  // Also copy to public/ directory if outDir is not public/
  const publicDir = path.resolve(__dirname, "../public");
  if (path.resolve(outDir) !== publicDir) {
    await fs.mkdir(publicDir, { recursive: true });
    await fs.copyFile(voiceoverPath, path.join(publicDir, "voiceover.wav"));
  }

  // Calculate timeline start offsets and shot durations
  let currentOffset = 0;
  const shotDurations: number[] = [];

  for (let i = 0; i < segments.length; i++) {
    segments[i].startOffset = currentOffset;
    const isLast = i === segments.length - 1;
    const dur = segments[i].duration + (isLast ? 0 : gapSec);
    shotDurations.push(dur);
    currentOffset += dur;
  }

  // Adjust total sum of shotDurations to equal totalAudioDuration exact by construction
  const sumShotDur = shotDurations.reduce((a, b) => a + b, 0);
  const diff = totalAudioDuration - sumShotDur;
  if (Math.abs(diff) > 0.0001 && shotDurations.length > 0) {
    shotDurations[shotDurations.length - 1] += diff;
  }

  // Generate captions.vtt
  console.log("Generating captions.vtt on concatenated timeline...");
  const vttLines = ["WEBVTT", ""];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.utterances && seg.utterances.length > 0) {
      for (const u of seg.utterances) {
        const startTime = formatTime(seg.startOffset + u.start);
        const endTime = formatTime(seg.startOffset + u.end);
        vttLines.push(`${startTime} --> ${endTime}`);
        vttLines.push(u.transcript);
        vttLines.push("");
      }
    } else if (seg.words && seg.words.length > 0) {
      for (let w = 0; w < seg.words.length; w += 5) {
        const chunk = seg.words.slice(w, w + 5);
        const startTime = formatTime(seg.startOffset + chunk[0].start);
        const endTime = formatTime(seg.startOffset + chunk[chunk.length - 1].end);
        vttLines.push(`${startTime} --> ${endTime}`);
        vttLines.push(chunk.map((cw) => cw.punctuated_word || cw.word).join(" "));
        vttLines.push("");
      }
    }
  }

  const vttContent = vttLines.join("\n");
  const captionsPath = path.join(outDir, "captions.vtt");
  await fs.writeFile(captionsPath, vttContent, "utf-8");

  if (path.resolve(outDir) !== publicDir) {
    await fs.copyFile(captionsPath, path.join(publicDir, "captions.vtt"));
  }

  return {
    segments,
    shotDurations,
    totalAudioDuration,
    voiceoverPath,
    captionsPath,
    captionsVttContent: vttContent,
  };
}

import { buildBriefFromSegmentFallback } from "./ideation/segmentSync";

/** Construct a valid Film schema object from produce result. */
export function buildFilmFromAudioResult(
  title: string,
  audioResult: ProduceAudioResult,
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
  // Create 1-4 chapters depending on number of shots
  const numChapters = Math.max(1, Math.min(4, Math.ceil(numShots / 3)));
  const chapters = Array.from({ length: numChapters }, (_, i) => `chapter-${i + 1}`);

  // Create canvas nodes & edges
  const nodes = chapters.map((ch, i) => ({
    id: `node-${i + 1}`,
    label: ch,
    x: 100 + i * 400,
    y: 200,
    w: 190,
    h: 62,
  }));

  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i].id, to: nodes[i + 1].id, dashed: false });
  }
  if (edges.length === 0 && nodes.length === 1) {
    // Add dummy node for schema min(2)
    nodes.push({ id: "node-2", label: "conclusion", x: 500, y: 200, w: 190, h: 62 });
    edges.push({ from: "node-1", to: "node-2", dashed: false });
  }

  // Create shots with segment-scoped visual brief mapping
  const shots = audioResult.segments.map((seg, i) => {
    const chIndex = Math.floor((i * numChapters) / numShots);
    const chName = chapters[chIndex];
    const isChapterStart = i === 0 || Math.floor(((i - 1) * numChapters) / numShots) !== chIndex;
    const targetNodeId = nodes[Math.min(chIndex, nodes.length - 1)].id;
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
    voiceover: { src: "voiceover.wav", volume: 1 },
    captions: "captions.vtt",
    ...(options?.music ? { music: options.music } : {}),
    ...(options?.sfx ? { sfx: options.sfx } : {}),
  };

  return parseFilm(filmRaw);
}

/** Existing generate entry point - preserved for compatibility. */
export async function processAudioForFilm(film: Film, outDir: string): Promise<Film> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY is not set.");
  }
  const deepgram = createClient(apiKey);

  const shotsText = film.shots.map(s => (s.scriptText || "").trim());
  const fullScript = shotsText.filter(t => t.length > 0).join(" ");

  if (fullScript.length === 0) {
    return film;
  }

  console.log("Generating TTS audio via Deepgram Aura...");
  const ttsResponse = await deepgram.speak.request(
    { text: fullScript },
    { model: "aura-asteria-en" }
  );

  const stream = await ttsResponse.getStream();
  if (!stream) {
    throw new Error("Failed to get TTS stream from Deepgram");
  }

  const audioBuffer = await stream2buffer(stream);
  const audioPath = path.join(outDir, "voiceover.wav");
  await fs.writeFile(audioPath, audioBuffer);
  console.log(`Saved TTS to ${audioPath}`);

  console.log("Running STT via Deepgram Nova to get word timings...");
  const sttResponse = await deepgram.listen.prerecorded.transcribeFile(
    audioBuffer,
    {
      model: "nova-2",
      smart_format: true,
      utterances: true,
    }
  );

  if (sttResponse.error) {
    throw new Error(`STT failed: ${sttResponse.error.message}`);
  }

  const result = sttResponse.result;
  if (!result || !result.results || !result.results.channels[0].alternatives[0]) {
    throw new Error("No STT results returned from Deepgram.");
  }

  const words = result.results.channels[0].alternatives[0].words;

  // Generate VTT
  console.log("Generating captions.vtt...");
  const vttLines = ["WEBVTT", ""];
  const utterances = result.results.utterances;
  if (utterances && utterances.length > 0) {
    for (const u of utterances) {
      vttLines.push(`${formatTime(u.start)} --> ${formatTime(u.end)}`);
      vttLines.push(u.transcript);
      vttLines.push("");
    }
  } else {
    for (let i = 0; i < words.length; i += 5) {
      const chunk = words.slice(i, i + 5);
      vttLines.push(`${formatTime(chunk[0].start)} --> ${formatTime(chunk[chunk.length - 1].end)}`);
      vttLines.push(chunk.map(w => w.punctuated_word || w.word).join(" "));
      vttLines.push("");
    }
  }

  const vttPath = path.join(outDir, "captions.vtt");
  await fs.writeFile(vttPath, vttLines.join("\n"));
  console.log(`Saved captions to ${vttPath}`);

  // Dense Character Mapping Algorithm
  console.log("Applying Dense Character Mapping...");
  const shotAlphaTargets = film.shots.map(s => {
    return (s.scriptText || "").replace(/[^a-zA-Z0-9]/g, "").length;
  });

  let wordIndex = 0;
  let previousEnd = 0;

  for (let i = 0; i < film.shots.length; i++) {
    const targetAlpha = shotAlphaTargets[i];
    
    let shotAlpha = 0;
    let currentEnd = previousEnd;

    while (wordIndex < words.length && shotAlpha < targetAlpha) {
      const w = words[wordIndex];
      const wAlpha = w.word.replace(/[^a-zA-Z0-9]/g, "").length;
      shotAlpha += wAlpha;
      currentEnd = w.end;
      wordIndex++;
    }

    let dur = currentEnd - previousEnd;
    
    if (dur < 2) dur = 2;
    if (dur > 45) dur = 45;

    previousEnd = currentEnd;

    film.shots[i].dur = Number(dur.toFixed(2));
  }

  film.voiceover = { src: "voiceover.wav", volume: 1 };
  film.captions = "captions.vtt";

  return film;
}

// Utility functions
async function stream2buffer(stream: ReadableStream): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}
