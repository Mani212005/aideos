/**
 * File Description: Deterministic path and filename helpers for pitch-corrected WSOLA retimed audio tracks.
 * Browser-safe module for Remotion player and render components.
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

/** Compute the relative public path for a retimed audio track. */
export function getRetimedAudioRelPath(src: string, speed: number): string {
  return `.tmp_audio/${getRetimedAudioFilename(src, speed)}`;
}
