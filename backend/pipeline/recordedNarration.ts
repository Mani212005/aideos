/**
 * File Description: Reads the narration a package already carries (voiceover.wav, captions.vtt,
 * voiceover_words.json and narration.json) and says whether it is complete and still spoken from the
 * package's script, so the narrate stage can resume it as is instead of synthesizing it again.
 * Inputs and outputs: package directory and script text -> the stored ProduceAudioResult, or null.
 * Used by: backend/pipeline/run.ts (narrate stage).
 */

import fs from "fs";
import path from "path";
import { splitScriptIntoSegments, type ProduceAudioResult } from "../audio";

/** Files a finished narration leaves in its package; narration.json is written last. */
const NARRATION_FILES = ["narration.json", "voiceover.wav", "captions.vtt", "voiceover_words.json"];

/** Collapses whitespace so segment joins and script line breaks compare equal. */
function spokenText(parts: string[]): string {
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Returns the package's stored narration when it is complete and matches the script, else null. */
export function readRecordedNarration(pkgDir: string, script: string): ProduceAudioResult | null {
  if (!NARRATION_FILES.every((file) => fs.existsSync(path.join(pkgDir, file)))) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(path.join(pkgDir, "narration.json"), "utf8")) as ProduceAudioResult;
    const words = JSON.parse(fs.readFileSync(path.join(pkgDir, "voiceover_words.json"), "utf8"));
    const complete = Array.isArray(cached.segments) && Array.isArray(cached.shotDurations) &&
      cached.segments.length === cached.shotDurations.length && cached.segments.length > 0 &&
      Array.isArray(words.words) && cached.totalAudioDuration > 0;
    if (!complete) return null;
    // Segments can be merged when one comes out too short, so compare the whole spoken text, not the count.
    const stored = spokenText(cached.segments.map((segment) => segment.text));
    return stored === spokenText(splitScriptIntoSegments(script)) ? cached : null;
  } catch {
    return null;
  }
}
