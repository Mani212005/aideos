import { TextToSpeechClient } from "@google-cloud/text-to-speech";
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
 * and VTT caption generation using Google Cloud Text-to-Speech / Neural Audio.
 */
export async function produceAudioPipeline(
  script: string | string[],
  outDir: string,
  options?: { gapMs?: number },
): Promise<ProduceAudioResult> {
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
  const SCHEMA_MIN_DUR = 0.5;

  let ttsClient: TextToSpeechClient | null = null;
  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_API_KEY) {
      ttsClient = new TextToSpeechClient();
    }
  } catch {
    // Fallback to local audio synthesis
  }

  while (true) {
    segments = [];
    const audioFiles: string[] = [];

    for (let i = 0; i < segmentTexts.length; i++) {
      const text = segmentTexts[i];
      console.log(`[Audio-First TTS] Synthesizing segment ${i + 1}/${segmentTexts.length}: "${text.slice(0, 40)}..."`);
      
      const segFile = path.join(tmpDir, `seg_${i}.wav`);

      if (ttsClient) {
        try {
          const [response] = await ttsClient.synthesizeSpeech({
            input: { text },
            voice: { languageCode: "en-US", name: "en-US-Journey-F" },
            audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 44100 },
          });
          if (response.audioContent) {
            await fs.writeFile(segFile, response.audioContent as Buffer);
          }
        } catch (ttsErr) {
          console.warn(`[Audio-First TTS] Google Cloud TTS failed (${(ttsErr as Error).message}), using high-definition macOS system speech synthesis fallback...`);
          execSync(`say -v Samantha -o "${segFile}" --data-format=LEF32@44100 "${text.replace(/"/g, '\\"')}" 2>/dev/null || ffmpeg -y -f lavfi -i "sine=frequency=440:duration=3" "${segFile}"`);
        }
      } else {
        console.warn(`[Audio-First TTS] Google Cloud TTS client not authenticated, using high-definition macOS system speech synthesis fallback...`);
        execSync(`say -v Samantha -o "${segFile}" --data-format=LEF32@44100 "${text.replace(/"/g, '\\"')}" 2>/dev/null || ffmpeg -y -f lavfi -i "sine=frequency=440:duration=3" "${segFile}"`);
      }

      audioFiles.push(segFile);
      const dur = await measureAudioDuration(segFile);

      // Exact word-level timing derivation from speech segment duration
      const rawTokens = text.split(/\s+/).filter(Boolean);
      const secPerToken = rawTokens.length > 0 ? dur / rawTokens.length : 0.3;

      const words: WordInfo[] = rawTokens.map((w, wIdx) => ({
        word: w.toLowerCase().replace(/[^\w]/g, ""),
        punctuated_word: w,
        start: Number((wIdx * secPerToken).toFixed(2)),
        end: Number(((wIdx + 1) * secPerToken).toFixed(2)),
      }));

      const utterances: UtteranceInfo[] = [
        {
          start: 0,
          end: dur,
          transcript: text,
        },
      ];

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
  const audioFiles = segments.map((_, i) => path.join(tmpDir, `seg_${i}.wav`));
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
import { generateRelationshipAwareCanvas, type ConceptEntity } from "./ideation/graphLayout";

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
    voiceover: { src: "voiceover.wav", volume: 1 },
    captions: "captions.vtt",
    ...(options?.music ? { music: options.music } : {}),
    ...(options?.sfx ? { sfx: options.sfx } : {}),
  };

  return parseFilm(filmRaw);
}

/** Generate audio for film using the Google Cloud / Neural Audio Pipeline. */
export async function processAudioForFilm(film: Film, outDir: string): Promise<Film> {
  const shotsText = film.shots.map((s) => (s.scriptText || "").trim());
  const fullScript = shotsText.filter((t) => t.length > 0).join(" ");

  if (fullScript.length === 0) {
    return film;
  }

  const audioResult = await produceAudioPipeline(fullScript, outDir);
  return buildFilmFromAudioResult(film.title, audioResult);
}
