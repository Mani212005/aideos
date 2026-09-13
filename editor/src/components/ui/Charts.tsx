/**
 * File Description: Hand-rolled SVG data visualisations for the Aideos editor.
 * Every chart is drawn with plain SVG in the editor's Neobrutalism language (ink outlines, flat
 * accent fills, mono numerals, no gradients or blur) so the editor gains no charting dependency.
 * Each one answers a specific editing question: where time is going, where narration is dense,
 * which script beats reached the timeline, and whether the project is ready to export.
 */

import { useId, useMemo, useState } from "react";
import { cn } from "./cn";

const INK = "var(--nb-ink)";

export interface BarChartDatum {
  /** Short label shown under the bar. */
  label: string;
  value: number;
  /** Fill token for the bar, defaults to the selection accent. */
  color?: string;
  /** Longer description surfaced on hover. */
  title?: string;
}

export interface BarChartProps {
  data: BarChartDatum[];
  height?: number;
  /** Unit suffix appended to value readouts, for example "s". */
  unit?: string;
  /** Draw a dashed reference line at this value, for example the mean. */
  reference?: number;
  referenceLabel?: string;
  onSelect?: (index: number) => void;
  selectedIndex?: number;
  className?: string;
  emptyLabel?: string;
}

/** Vertical bar chart used for per-shot pacing and duration breakdowns. */
export function BarChart({
  data,
  height = 120,
  unit = "",
  reference,
  referenceLabel,
  onSelect,
  selectedIndex,
  className,
  emptyLabel = "No data yet",
}: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.value)), [data]);

  if (data.length === 0) {
    return (
      <div
        className={cn(
          "nb-hatch flex items-center justify-center border-2 border-ink bg-sunken font-mono text-[10px] uppercase tracking-[0.08em] text-ink-mute",
          className,
        )}
        style={{ height }}
      >
        {emptyLabel}
      </div>
    );
  }

  const gap = data.length > 40 ? 1 : 2;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div
        className="relative flex items-end gap-[var(--bar-gap)] border-2 border-ink bg-paper-3 p-1"
        style={{ height, ["--bar-gap" as string]: `${gap}px` }}
      >
        {typeof reference === "number" && reference > 0 ? (
          <div
            className="pointer-events-none absolute inset-x-1 border-t-2 border-dashed border-ink/50"
            style={{ bottom: `${(reference / max) * (height - 8) + 4}px` }}
          >
            {referenceLabel ? (
              <span className="absolute -top-3 right-0 bg-paper-3 px-1 font-mono text-[8px] font-bold text-ink-soft">
                {referenceLabel}
              </span>
            ) : null}
          </div>
        ) : null}

        {data.map((d, i) => {
          const isActive = hover === i || selectedIndex === i;
          return (
            <button
              key={`${d.label}-${i}`}
              type="button"
              title={d.title ?? `${d.label}: ${d.value.toFixed(2)}${unit}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect?.(i)}
              className={cn(
                "relative min-w-[3px] flex-1 border-2 border-ink transition-[filter] duration-nb ease-nb",
                onSelect ? "cursor-pointer" : "cursor-default",
                isActive && "outline outline-2 outline-offset-1 outline-select",
              )}
              style={{
                height: `${Math.max(3, (d.value / max) * 100)}%`,
                backgroundColor: d.color ?? "var(--nb-select)",
              }}
            />
          );
        })}
      </div>

      <div className="flex items-baseline justify-between font-mono text-[9px] text-ink-mute">
        <span className="truncate">
          {hover !== null ? `${data[hover].label}: ` : ""}
          <span className="font-bold text-ink">
            {hover !== null ? `${data[hover].value.toFixed(2)}${unit}` : `peak ${max.toFixed(2)}${unit}`}
          </span>
        </span>
        <span>{data.length} items</span>
      </div>
    </div>
  );
}

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
export function Waveform({ peaks, width, height, color = INK, className }: WaveformProps) {
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

export interface DensityStripProps {
  /** Ordered spans of narration across the film, in seconds. */
  spans: Array<{ startSec: number; endSec: number; label?: string }>;
  totalSec: number;
  height?: number;
  className?: string;
  /** Marker drawn at this time, normally the playhead. */
  markerSec?: number;
}

/** Horizontal strip showing where narration sits against silence across the whole film. */
export function DensityStrip({ spans, totalSec, height = 26, className, markerSec }: DensityStripProps) {
  const safeTotal = Math.max(0.001, totalSec);
  const spokenSec = spans.reduce((acc, s) => acc + Math.max(0, s.endSec - s.startSec), 0);
  const coverage = Math.min(100, (spokenSec / safeTotal) * 100);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="relative w-full border-2 border-ink bg-sunken-2" style={{ height }}>
        {spans.map((s, i) => {
          const left = (Math.max(0, s.startSec) / safeTotal) * 100;
          const width = (Math.max(0, s.endSec - s.startSec) / safeTotal) * 100;
          if (width <= 0) return null;
          return (
            <div
              key={i}
              title={s.label ?? `${s.startSec.toFixed(1)}s to ${s.endSec.toFixed(1)}s`}
              className="absolute inset-y-0 bg-success"
              style={{ left: `${left}%`, width: `${Math.max(0.25, width)}%` }}
            />
          );
        })}
        {typeof markerSec === "number" ? (
          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-danger"
            style={{ left: `${Math.min(100, Math.max(0, (markerSec / safeTotal) * 100))}%` }}
          />
        ) : null}
      </div>
      <div className="flex items-baseline justify-between font-mono text-[9px] text-ink-mute">
        <span>
          narration <span className="font-bold text-ink">{coverage.toFixed(0)}%</span>
        </span>
        <span>
          silence <span className="font-bold text-ink">{(100 - coverage).toFixed(0)}%</span>
        </span>
      </div>
    </div>
  );
}

export interface CoverageMapProps {
  /** One cell per script beat, marked as reaching the timeline or not. */
  cells: Array<{ label: string; covered: boolean; detail?: string }>;
  className?: string;
}

/** Grid of script beats showing which ones actually made it into the timeline. */
export function CoverageMap({ cells, className }: CoverageMapProps) {
  const covered = cells.filter((c) => c.covered).length;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex flex-wrap gap-1">
        {cells.map((c, i) => (
          <span
            key={`${c.label}-${i}`}
            title={c.detail ?? `${c.label}: ${c.covered ? "on timeline" : "not placed"}`}
            className={cn(
              "h-4 w-4 border-2 border-ink",
              c.covered ? "bg-success" : "nb-hatch-dense bg-paper-3",
            )}
          />
        ))}
      </div>
      <p className="font-mono text-[9px] text-ink-mute">
        <span className="font-bold text-ink">
          {covered}/{cells.length}
        </span>{" "}
        script beats placed on the timeline
      </p>
    </div>
  );
}

export interface HealthGaugeProps {
  /** Score from 0 to 100. */
  value: number;
  label: string;
  size?: number;
  className?: string;
}

/** Stepped arc gauge used for the single project readiness score. */
export function HealthGauge({ value, label, size = 104, className }: HealthGaugeProps) {
  const clipId = useId();
  const pct = Math.max(0, Math.min(100, value));
  const segments = 10;
  const filled = Math.round((pct / 100) * segments);
  const tone = pct >= 80 ? "var(--nb-success)" : pct >= 50 ? "var(--nb-warn)" : "var(--nb-danger)";
  // The gauge is a half arc, so the drawing box is only as tall as the arc plus its stroke.
  const boxHeight = size / 2 + 4;
  const cx = size / 2;
  const cy = boxHeight - 2;
  const rOuter = size / 2 - 2;
  const rInner = rOuter - 14;

  /** Build the wedge path for one segment of the stepped arc. */
  const wedge = (index: number) => {
    const startAngle = Math.PI * (1 + index / segments);
    const endAngle = Math.PI * (1 + (index + 0.82) / segments);
    const x1 = cx + rOuter * Math.cos(startAngle);
    const y1 = cy + rOuter * Math.sin(startAngle);
    const x2 = cx + rOuter * Math.cos(endAngle);
    const y2 = cy + rOuter * Math.sin(endAngle);
    const x3 = cx + rInner * Math.cos(endAngle);
    const y3 = cy + rInner * Math.sin(endAngle);
    const x4 = cx + rInner * Math.cos(startAngle);
    const y4 = cy + rInner * Math.sin(startAngle);
    return `M${x1},${y1} A${rOuter},${rOuter} 0 0 1 ${x2},${y2} L${x3},${y3} A${rInner},${rInner} 0 0 0 ${x4},${y4} Z`;
  };

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <svg
        width={size}
        height={boxHeight}
        viewBox={`0 0 ${size} ${boxHeight}`}
        role="img"
        aria-label={`${label}: ${Math.round(pct)} percent`}
      >
        <clipPath id={clipId}>
          <rect x={0} y={0} width={size} height={boxHeight} />
        </clipPath>
        <g clipPath={`url(#${clipId})`}>
          {Array.from({ length: segments }).map((_, i) => (
            <path
              key={i}
              d={wedge(i)}
              fill={i < filled ? tone : "var(--nb-paper-3)"}
              stroke={INK}
              strokeWidth={2}
            />
          ))}
        </g>
      </svg>
      <div className="mt-1 flex flex-col items-center">
        <span className="font-mono text-xl font-bold tabular-nums leading-none text-ink">{Math.round(pct)}</span>
        <span className="mt-0.5 font-sans text-[9px] font-extrabold uppercase tracking-[0.1em] text-ink-soft">
          {label}
        </span>
      </div>
    </div>
  );
}

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

/** Compact trend line for inline readouts such as render cost over time. */
export function Sparkline({ values, width = 96, height = 24, color = "var(--nb-select-text)", className }: SparklineProps) {
  const path = useMemo(() => {
    if (values.length < 2) return "";
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = Math.max(1e-6, max - min);
    const step = width / (values.length - 1);
    return values
      .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)},${(height - ((v - min) / span) * (height - 2) - 1).toFixed(2)}`)
      .join(" ");
  }, [values, width, height]);

  if (!path) return null;

  return (
    <svg className={cn("block border-2 border-ink bg-paper-3", className)} width={width} height={height} aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="miter" />
    </svg>
  );
}
