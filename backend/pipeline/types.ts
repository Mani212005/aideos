/**
 * File Description: The typed contract for the Aideos production pipeline - the request that goes
 * in, the progress events that come out while it runs, the result it returns, and the stage-tagged
 * error it throws. Everything the CLI and the MCP server expose is expressed in these types, so a
 * caller can drive a whole film without knowing anything about the stages underneath.
 */

import type { TtsBackendName } from "../tts";

/** The ordered stages a production run moves through. */
export const PRODUCTION_STAGES = [
  "intake",
  "narrate",
  "design",
  "broll",
  "assemble",
  "render",
  "verify",
] as const;

export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

/** Which deliverable formats a run can produce. */
export type ProductionFormat = "long" | "reel";

/** Everything a caller can ask the pipeline for. */
export interface ProductionRequest {
  /** Narration script or Claude screenplay. The primary input. */
  script: string;
  /** Human-readable title; also the source of the package slug when none is given. */
  title?: string;
  /** Package slug under videos/. Derived from the title when omitted. */
  slug?: string;
  /** Which formats to render. Defaults to both. */
  formats?: ProductionFormat[];
  /** Where the finished mp4s land. Defaults to the repo's out/ directory. */
  outDir?: string;
  /** Generate B-roll footage on the GPU and wire it into the film. */
  broll?: boolean;
  /** Which VideoEngine renders B-roll. Defaults to ssh-wangp when broll is on. */
  brollEngine?: string;
  /** Cap on how many B-roll clips one run will generate. */
  brollMaxClips?: number;
  /** Length of each generated B-roll clip, in seconds. */
  brollSeconds?: number;
  /** Pin the speech synthesizer. Defaults to Kokoro running locally. */
  ttsBackend?: TtsBackendName;
  /** Voice id, interpreted by the chosen synthesizer. */
  voice?: string;
  /** Narration pace multiplier. Below 1 slows delivery. Defaults to 1. */
  speed?: number;
  /** Optional background music filename inside public/. */
  music?: string;
  /** Re-use completed stages from a previous run of the same slug. */
  resume?: boolean;
  /** Stages to re-run even when resuming. */
  force?: ProductionStage[];
  /** Stop cleanly after this stage instead of running to the end. */
  stopAfter?: ProductionStage;
  /** Skip the final frame-and-audio inspection pass. */
  skipVerify?: boolean;
  /**
   * Copy the synthesized voiceover and captions into public/ for the editor's live preview.
   * Defaults to true. Set false for a throwaway or test run so it cannot overwrite whatever
   * film's audio the editor is actually previewing.
   */
  syncToPreview?: boolean;
}


/** Lifecycle of one stage within a run. */
export type StageStatus = "pending" | "running" | "done" | "skipped" | "failed";

/** A progress event emitted as the run advances. */
export interface ProductionProgress {
  stage: ProductionStage;
  status: StageStatus;
  /** One human-readable line about what is happening. */
  message: string;
  /** 0..1 within the stage, when the stage can observe it. */
  progress?: number;
  /** Milliseconds since the run started. */
  elapsedMs: number;
}

/** What one stage did, recorded in the run state so a resume can skip it. */
export interface StageRecord {
  stage: ProductionStage;
  status: StageStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  /** Fingerprint of the stage's inputs; a change invalidates the cached result. */
  fingerprint?: string;
  error?: string;
}

/** One rendered deliverable. */
export interface RenderedOutput {
  format: ProductionFormat;
  path: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  sizeBytes: number;
}

/** One generated B-roll clip and where it landed in the film. */
export interface BrollClip {
  shotId: string;
  prompt: string;
  path: string;
  /** Path relative to public/, which is what staticFile() resolves. */
  staticPath: string;
  durationSec: number;
  width: number;
  height: number;
}

/** Everything a finished run produced. */
export interface ProductionResult {
  slug: string;
  title: string;
  packageDir: string;
  filmPath: string;
  scriptPath: string;
  voiceoverPath: string;
  captionsPath: string;
  wordsPath: string;
  ttsBackend: string;
  durationSec: number;
  shotCount: number;
  brollClips: BrollClip[];
  outputs: RenderedOutput[];
  stages: StageRecord[];
  warnings: string[];
  /** Set when the caller asked the run to stop before the end; outputs may be empty. */
  stoppedAfter?: ProductionStage;
}

/** An error that knows which stage it came from, so a caller can report it honestly. */
export class ProductionError extends Error {
  readonly stage: ProductionStage;
  readonly cause?: unknown;

  /** Wraps a failure with the stage that produced it. */
  constructor(stage: ProductionStage, message: string, cause?: unknown) {
    super(`[${stage}] ${message}`);
    this.name = "ProductionError";
    this.stage = stage;
    this.cause = cause;
  }
}

/** Persisted between runs so `resume` can skip work that is already done. */
export interface RunState {
  slug: string;
  title: string;
  updatedAt: string;
  stages: StageRecord[];
  brollClips: BrollClip[];
  outputs: RenderedOutput[];
}
