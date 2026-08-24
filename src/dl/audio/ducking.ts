/*
File Description: Implements sidechain audio ducking calculation for Remotion music audio track under voiceover narration.
*/

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
  duckedFactor?: number;
  rampDurationSec?: number;
}

/**
 * Calculates ducked music volume for a specific frame based on speech activity intervals.
 * When voiceover is active, music volume attenuates (default: 25% of base music volume).
 * In gaps between speech, music volume returns to full base level.
 */
export function calculateDuckingVolume(options: DuckingOptions): number {
  const {
    frame,
    fps,
    totalFrames,
    musicVolume,
    duckUnderVoiceover = true,
    speechIntervals = [],
    duckedFactor = 0.25,
    rampDurationSec = 0.15,
  } = options;

  if (musicVolume <= 0) return 0;
  if (!duckUnderVoiceover || speechIntervals.length === 0) {
    const headIn = Math.min(1, frame / 24);
    const tailOut = Math.max(0, Math.min(1, (totalFrames - frame) / 45));
    return Number((musicVolume * headIn * tailOut).toFixed(4));
  }

  const timeSec = frame / fps;

  let isInsideSpeech = false;
  let minDistToSpeechStart = Infinity;
  let minDistToSpeechEnd = Infinity;

  for (const interval of speechIntervals) {
    if (timeSec >= interval.startSec && timeSec <= interval.endSec) {
      isInsideSpeech = true;
      break;
    }
    if (timeSec < interval.startSec) {
      minDistToSpeechStart = Math.min(minDistToSpeechStart, interval.startSec - timeSec);
    }
    if (timeSec > interval.endSec) {
      minDistToSpeechEnd = Math.min(minDistToSpeechEnd, timeSec - interval.endSec);
    }
  }

  let duckLevel = 1.0;
  if (isInsideSpeech) {
    duckLevel = duckedFactor;
  } else {
    if (minDistToSpeechStart <= rampDurationSec) {
      const t = minDistToSpeechStart / rampDurationSec;
      duckLevel = duckedFactor + (1.0 - duckedFactor) * t;
    } else if (minDistToSpeechEnd <= rampDurationSec) {
      const t = minDistToSpeechEnd / rampDurationSec;
      duckLevel = duckedFactor + (1.0 - duckedFactor) * t;
    } else {
      duckLevel = 1.0;
    }
  }

  const headIn = Math.min(1, frame / 24);
  const tailOut = Math.max(0, Math.min(1, (totalFrames - frame) / 45));
  return Number((musicVolume * duckLevel * headIn * tailOut).toFixed(4));
}
