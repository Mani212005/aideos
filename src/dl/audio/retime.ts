/**
 * File Description: Deterministic path and filename helpers for pitch-corrected WSOLA retimed audio tracks.
 * Browser-safe module for Remotion player and render components.
 * Inputs and outputs: audio source path, speed multiplier, and pitch setting -> deterministic cache file path and key.
 * Used by: src/dl/Soundtrack.tsx, backend/audio.ts, backend/renderIr/emit.ts, backend/audio.test.ts.
 */

/** Sanitize an audio source path into a safe filesystem identifier. */
export function sanitizeAudioName(src: string): string {
  const clean = src.split("?")[0].split("#")[0].replace(/^[./]+/, "");
  return clean.replace(/[^a-zA-Z0-9_-]/g, "_");
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

/** Compute the deterministic filename for a retimed audio track, keyed on the exact atempo filter chain ffmpeg runs. */
export function getRetimedAudioFilename(src: string, speed: number): string {
  const base = sanitizeAudioName(src);
  const filterKey = buildAtempoFilter(speed).replace(/[^a-zA-Z0-9]/g, "_");
  return `retimed_${base}_${filterKey}.wav`;
}

/** Compute the relative path for a retimed audio track. */
export function getRetimedAudioRelPath(src: string, speed: number): string {
  return `.tmp_audio/${getRetimedAudioFilename(src, speed)}`;
}
