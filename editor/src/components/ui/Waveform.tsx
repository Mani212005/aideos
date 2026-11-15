/**
 * File Description: Mirrored amplitude waveform drawn as one filled SVG path, for audio clip bodies on the Cut timeline.
 * Inputs and outputs: normalised amplitude peaks and a pixel size -> an SVG waveform.
 * Used by: editor/src/components/timeline/ClipBody.tsx.
 */

import { useMemo } from "react";
import { cn } from "./cn";

export interface WaveformProps {
  /** Normalised amplitude peaks in the range 0 to 1. */
  peaks: number[];
  /** Width in CSS pixels the waveform must fill. */
  width: number;
  height: number;
  /** Stroke colour token for the waveform body. */
  color?: string;
  className?: string;
}

/** Mirrored amplitude waveform drawn as a single filled path, for audio clip bodies. */
export function Waveform({ peaks, width, height, color = "var(--nb-select, #635BFF)", className }: WaveformProps) {
  const path = useMemo(() => {
    if (peaks.length === 0 || width <= 0) return "";
    const mid = height / 2;
    const step = width / peaks.length;
    const top: string[] = [];
    const bottom: string[] = [];
    for (let i = 0; i < peaks.length; i++) {
      const x = Number((i * step).toFixed(2));
      const amp = Math.max(0.02, Math.min(1, peaks[i])) * (height / 2 - 1);
      top.push(`${x},${Number((mid - amp).toFixed(2))}`);
      bottom.unshift(`${x},${Number((mid + amp).toFixed(2))}`);
    }
    return `M${top.join(" L")} L${bottom.join(" L")} Z`;
  }, [peaks, width, height]);

  if (!path) return null;

  return (
    <svg
      className={cn("pointer-events-none block", className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={path} fill={color} fillOpacity={0.55} />
      <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={color} strokeOpacity={0.35} strokeWidth={1} />
    </svg>
  );
}
