/**
 * File Description: The one m:ss formatter for a span of seconds: screenplay timestamps, brief shot clocks,
 * look plan clocks, review evidence timestamps and the editor's compact timecode all print a second the same way.
 * Pure arithmetic with no Node imports, so the browser bundle (scriptIntake.ts, the editor) can import it.
 * Inputs and outputs: seconds (+ "round" or "floor") -> "m:ss"; negative or non-finite input reads as 0:00.
 * Used by: backend/scriptIntake.ts, backend/designSpec/brief.ts, backend/lookPlan/brief.ts, backend/lookPlan/render.ts,
 * backend/geminiReview/geminiReview.ts, editor/src/utils/time.ts.
 */

/** How a fractional second becomes a whole one: "round" to the nearest second, "floor" to the second that has begun. */
export type DurationRounding = "round" | "floor";

/** Format seconds as m:ss (seconds zero-padded, minutes unbounded); "round" is the default. */
export function formatDurationSec(sec: number, rounding: DurationRounding = "round"): string {
  const safe = Number.isFinite(sec) ? Math.max(0, sec) : 0;
  const whole = rounding === "floor" ? Math.floor(safe) : Math.round(safe);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
