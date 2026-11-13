/**
 * File Description: Implements sidechain audio ducking calculation for the music track under voiceover narration, reading the shared voice activity timeline.
 * Inputs and outputs: speech intervals or a voice timeline, current frame, and ducking options -> calculated music audio volume.
 * Used by: src/dl/Film.tsx, src/dl/Soundtrack.tsx, backend/sync.test.ts.
*/

import { buildVoiceTimeline, voiceContextAt, type VoiceTimeline } from "./voiceActivity";

export interface SpeechInterval {
  startSec: number;
  endSec: number;
}

export interface DuckingOptions {
  frame: number;
  fps: number;
  totalFrames: number;
  musicVolume: number;
  duckUnderVoiceover?: boolean;
  speechIntervals?: SpeechInterval[];
  /** Prebuilt voice timeline; takes precedence over speechIntervals so a per-frame caller builds it once. */
  voice?: VoiceTimeline;
  duckedFactor?: number;
  rampDurationSec?: number;
}

/**
 * Calculates ducked music volume for a specific frame from the shared voice activity states.
 * When voiceover is active, music volume attenuates (default: 25% of base music volume).
 * In a gap (silence of at least the shared hold time), music volume returns to full base level.
 */
export function calculateDuckingVolume(options: DuckingOptions): number {
  const {
    frame,
    fps,
    totalFrames,
    musicVolume,
    duckUnderVoiceover = true,
    speechIntervals = [],
    voice,
    duckedFactor = 0.25,
    rampDurationSec = 0.15,
  } = options;

  if (musicVolume <= 0) return 0;
  const timeline = voice ?? buildVoiceTimeline(speechIntervals);
  if (!duckUnderVoiceover || timeline.phrases.length === 0) {
    const headIn = Math.min(1, frame / 24);
    const tailOut = Math.max(0, Math.min(1, (totalFrames - frame) / 45));
    return Number((musicVolume * headIn * tailOut).toFixed(4));
  }

  const timeSec = frame / fps;
  // Speech and pauses inside a phrase keep the music down; only a gap lets it ramp back up.
  const context = voiceContextAt(timeline, timeSec);
  let duckLevel = 1.0;
  if (context.state !== "gap") {
    duckLevel = duckedFactor;
  } else {
    const untilSpeech = context.nextStartSec - timeSec;
    const sinceSpeech = timeSec - context.previousEndSec;
    if (untilSpeech <= rampDurationSec) {
      duckLevel = duckedFactor + (1.0 - duckedFactor) * (untilSpeech / rampDurationSec);
    } else if (sinceSpeech <= rampDurationSec) {
      duckLevel = duckedFactor + (1.0 - duckedFactor) * (sinceSpeech / rampDurationSec);
    }
  }

  const headIn = Math.min(1, frame / 24);
  const tailOut = Math.max(0, Math.min(1, (totalFrames - frame) / 45));
  return Number((musicVolume * duckLevel * headIn * tailOut).toFixed(4));
}
