/**
 * File Description: Deterministic path and filename helpers for pitch-corrected WSOLA retimed audio tracks.
 * Browser-safe module for Remotion player and render components.
 * Inputs and outputs: audio source path, speed multiplier, and pitch setting -> deterministic cache file path and key.
 * Used by: src/dl/Film.tsx, editor/src/components/AssetBin.tsx, backend/audio.ts.
 */

/** Sanitize an audio source path into a safe filesystem identifier. */
export function sanitizeAudioName(src: string): string {
  const clean = src.split("?")[0].split("#")[0].replace(/^[./]+/, "");
  return clean.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Compute the deterministic filename for a retimed audio track. */
export function getRetimedAudioFilename(src: string, speed: number): string {
  const base = sanitizeAudioName(src);
  const speedStr = speed.toFixed(3).replace(".", "_");
  return `retimed_${base}_${speedStr}x.wav`;
}

/** Compute the relative path for a retimed audio track. */
export function getRetimedAudioRelPath(src: string, speed: number): string {
  return `.tmp_audio/${getRetimedAudioFilename(src, speed)}`;
}
