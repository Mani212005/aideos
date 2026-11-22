/**
 * File Description: The editor's timecode formatters: m:ss (optionally with tenths) and frame-accurate m:ss:ff.
 * Every panel that shows a time (timeline ruler, reel and soundtrack panels, design view, script editor, export
 * check, caption warnings) formats it here so the same second never reads differently in two places.
 * Inputs and outputs: seconds (and fps) -> timecode string; negative or non-finite input reads as 0:00.
 * Used by: editor/src/components/{timeline/TimelineRuler,TimelineEditor,ReelPanel,SoundtrackPanel,DesignView,ScriptEditor,CheckExport,captions/CaptionStrip}.tsx.
 */

// Clamps a time to a finite, non-negative number of seconds.
function safeSeconds(sec: number): number {
  return Number.isFinite(sec) ? Math.max(0, sec) : 0;
}

/** Format a time in seconds as a compact m:ss or m:ss.t timecode (whole seconds are floored). */
export function formatTimecode(sec: number, withTenths = false): string {
  const safe = safeSeconds(sec);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  if (!withTenths) return `${m}:${String(s).padStart(2, "0")}`;
  const t = Math.floor((safe % 1) * 10);
  return `${m}:${String(s).padStart(2, "0")}.${t}`;
}

/** Format a time in seconds as a frame-accurate m:ss:ff timecode. */
export function formatFrameTimecode(sec: number, fps: number): string {
  const safe = safeSeconds(sec);
  const totalFrames = Math.round(safe * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}
