/**
 * File Description: Time ruler for the Aideos timeline.
 * Draws a tick scale whose label density adapts to the current zoom so the ruler is readable from
 * a ten second close-up to a five minute overview, and hosts the playhead grab target. Labels are
 * mono timecodes so they line up column-wise with every other number in the editor.
 */

import { cn } from "../ui";

/** Candidate tick intervals in seconds, chosen so labelled ticks stay about 90 pixels apart. */
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** Pick the tick interval that keeps labels comfortably spaced at the current zoom. */
export function tickStepForZoom(pxPerSec: number, targetPx = 90): number {
  for (const step of TICK_STEPS) {
    if (step * pxPerSec >= targetPx) return step;
  }
  return TICK_STEPS[TICK_STEPS.length - 1];
}

/** Format a time in seconds as a compact m:ss or m:ss.t timecode. */
export function formatTimecode(sec: number, withTenths = false): string {
  const safe = Math.max(0, sec);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  if (!withTenths) return `${m}:${String(s).padStart(2, "0")}`;
  const t = Math.floor((safe % 1) * 10);
  return `${m}:${String(s).padStart(2, "0")}.${t}`;
}

/** Format a time in seconds as a frame-accurate m:ss:ff timecode. */
export function formatFrameTimecode(sec: number, fps: number): string {
  const safe = Math.max(0, sec);
  const totalFrames = Math.round(safe * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

export interface TimelineRulerProps {
  durationSec: number;
  pxPerSec: number;
  widthPx: number;
  height?: number;
  className?: string;
}

/** Adaptive time ruler drawn above the timeline lanes. */
export function TimelineRuler({ durationSec, pxPerSec, widthPx, height = 26, className }: TimelineRulerProps) {
  const step = tickStepForZoom(pxPerSec);
  const minorStep = step / 5;
  const ticks: Array<{ sec: number; major: boolean }> = [];

  for (let sec = 0; sec <= durationSec + step; sec += minorStep) {
    const rounded = Number(sec.toFixed(3));
    const isMajor = Math.abs(rounded / step - Math.round(rounded / step)) < 1e-6;
    ticks.push({ sec: rounded, major: isMajor });
  }

  return (
    <div
      className={cn("relative shrink-0 border-b-2 border-ink bg-sunken-2 select-none", className)}
      style={{ height, width: widthPx }}
    >
      {ticks.map(({ sec, major }) => (
        <div
          key={sec}
          className={cn("absolute bottom-0 w-px bg-ink", major ? "h-3 opacity-100" : "h-1.5 opacity-40")}
          style={{ left: sec * pxPerSec }}
        >
          {major ? (
            <span className="absolute -top-[15px] left-1 whitespace-nowrap font-mono text-[9px] font-bold leading-none text-ink-soft">
              {formatTimecode(sec, step < 1)}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
