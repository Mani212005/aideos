/**
 * File Description: Audio-first narration step for the film "Still Talking".
 * Declares this film's delivery choices (pace, gaps, tail handle) and hands the beat sheet to the
 * shared scene-kit voiceover step (backend/sceneKit/voiceover.ts), which synthesizes, masters and
 * records shot-spine.json. The film's picture is compiled from that measurement, so a re-recorded
 * take retimes the film instead of drifting away from it.
 */

import { BEATS, spokenWordCount } from "./beats";
import { produceVoiceover as produceKitVoiceover, readVoiceoverTiming as readKitTiming, type VoiceoverTiming } from "../sceneKit/voiceover";

export type { VoiceoverTiming };

/** The video package this film lives in (videos/<slug>). */
export const SLUG = "still-talking";

/** Narration pace: slightly under one reads as narration rather than conversation, which suits a fifty-year voyage. */
const NARRATION_SPEED = 0.94;

/** Silence held between narration beats, which is also the film's smallest breathing space. */
const BEAT_GAP_MS = 520;

/** Silence appended after the last word so the closing card can be read and the scene stays clocked to its audio. */
const TAIL_HANDLE_MS = 2200;

/** Synthesizes the narration and records the shot spine it produced. */
export async function produceVoiceover(): Promise<VoiceoverTiming> {
  console.log(`[${SLUG}] ${BEATS.length} narration beats, ${spokenWordCount()} spoken words.`);
  return produceKitVoiceover({
    slug: SLUG,
    beats: BEATS.map((beat) => ({ id: beat.id, narration: beat.narration })),
    speed: NARRATION_SPEED,
    gapMs: BEAT_GAP_MS,
    tailMs: TAIL_HANDLE_MS,
    alignment: "synthesizer",
  });
}

/** Reads back the measured shot spine, failing loudly when the audio step has not run yet. */
export function readVoiceoverTiming(): VoiceoverTiming {
  return readKitTiming(SLUG);
}

if (typeof require !== "undefined" && require.main === module) {
  produceVoiceover().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
