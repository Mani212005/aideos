/**
 * File Description: Shared contracts for film design checks.
 * Inputs and outputs: Design context and finding types -> typed check results.
 * Used by: design checks and their callers.
 */

import type { LookPlan } from "../lookPlan/schema";
import type { AudioLibrary } from "../audioLibrary/schema";

/** One word an OCR reader found in a picture. */
export interface PictureWord {
  text: string;
  conf: number;
}

/** Reads the words in a picture composited over the canvas (grey levels, rows top to bottom). */
export type PictureOcr = (gray: Uint8Array, width: number, height: number) => PictureWord[] | { unavailable: string };

export type DesignRule =
  | "stage-hold"
  | "caption-placement"
  | "schema"
  | "scene"
  | "camera"
  | "static-art"
  | "palette"
  | "accent"
  | "typography"
  | "continuity"
  | "origin"
  | "audio-lock"
  | "honest-data"
  | "safe-area"
  | "inset"
  | "carry-over"
  | "occlusion"
  | "soundtrack"
  | "look"
  | "provenance"
  | "picture-text"
  | "contrast"
  | "resolution"
  | "callout-anchor"
  | "picture-cover"
  | "voice-of-choice";

/** One problem found in a film's design. Errors block shipping; warnings are worth a look. */
export interface DesignFinding {
  rule: DesignRule;
  severity: "error" | "warning";
  where: string;
  message: string;
}

/** The result of checking one film. */
export interface DesignReport {
  filmId: string;
  ok: boolean;
  findings: DesignFinding[];
  stats: { shots: number; assets: number; clips: number };
}

/** Optional approved look data used to check authored camera and carry-over intent. */
export interface DesignCheckContext {
  formats?: ReadonlyArray<"long" | "reel">;
  collapsedClips?: Array<{ asset: string; clipId: string; shotId: string; frame: number }>;
  lookPlan?: LookPlan;
  cameraTargets?: Array<{ frame: number; focus?: string; authoredFocus?: string }>;
  library?: AudioLibrary;
  /** Reads words in a picture for the no-text rule; tesseract by default. */
  pictureOcr?: PictureOcr;
  /** What the package recorded about its narrator (narration.json), for the voice-of-choice rule; absent when there is no narration yet. */
  narration?: { ttsBackend?: unknown } | null;
  /** True when the run is explicitly allowed to keep a narrator other than the voice of choice (the captain's word). */
  allowOtherVoice?: boolean;
}
