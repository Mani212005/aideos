/**
 * File Description: One clip slab on an Aideos timeline lane.
 * Draws a clip as an outlined, kind-coloured block with grabbable trim handles at both edges, a
 * label that degrades gracefully as the clip narrows, a real waveform for audio, and a link badge
 * for clips that belong to a video plus audio pair. Pointer gestures are reported upward; the clip
 * itself owns no state so a drag can render a ghost copy of it at any candidate position.
 */

import React from "react";
import { Link2, Lock, Volume2, VolumeX } from "lucide-react";
import type { Clip } from "../../../../src/dl/layeredSchema";
import { Waveform, cn } from "../ui";
import { slicePeaks, useAudioPeaks } from "./useAudioPeaks";

/** Below this width a clip stops showing text and becomes a pure coloured block. */
const LABEL_MIN_WIDTH_PX = 44;

/** Below this width the heavy outline would swallow the clip, so it drops to a hairline. */
const HAIRLINE_WIDTH_PX = 16;

/** Trim handles never shrink below this, so short clips stay trimmable. */
const HANDLE_WIDTH_PX = 10;

const KIND_FILL: Record<Clip["kind"], string> = {
  animation: "bg-clip-anim",
  video: "bg-clip-video",
  audio: "bg-clip-audio",
  text: "bg-clip-text",
  subtitle: "bg-clip-subtitle",
  image: "bg-clip-image",
};

export type ClipPointerMode = "move" | "trim-start" | "trim-end";

export interface ClipBodyProps {
  clip: Clip;
  /** Clip label shown inside the body, usually the shot id or file name. */
  label: string;
  pxPerSec: number;
  laneHeight: number;
  /** Timeline position to draw at, which during a drag is the candidate rather than the stored one. */
  positionSec: number;
  durationSec: number;
  selected: boolean;
  locked: boolean;
  muted: boolean;
  /** Render as the translucent original while its ghost is being dragged elsewhere. */
  dimmed?: boolean;
  /** Render as the drag ghost: dashed outline, no pointer events. */
  ghost?: boolean;
  /** Audio source to draw a waveform from, when this clip plays audio. */
  waveformSrc?: string;
  onPointerDown?: (e: React.PointerEvent, clip: Clip, mode: ClipPointerMode) => void;
  onDoubleClick?: (clip: Clip) => void;
}

/** A single clip rendered on a timeline lane. */
export function ClipBody({
  clip,
  label,
  pxPerSec,
  laneHeight,
  positionSec,
  durationSec,
  selected,
  locked,
  muted,
  dimmed = false,
  ghost = false,
  waveformSrc,
  onPointerDown,
  onDoubleClick,
}: ClipBodyProps) {
  const width = Math.max(6, durationSec * pxPerSec);
  const showLabel = width >= LABEL_MIN_WIDTH_PX;
  const bodyHeight = Math.max(18, laneHeight - 8);
  const handleWidth = Math.min(HANDLE_WIDTH_PX, Math.max(4, width / 3));

  const { peaks, durationSec: sourceDuration, status } = useAudioPeaks(waveformSrc);
  const waveformPeaks =
    waveformSrc && status === "ready"
      ? slicePeaks(peaks, sourceDuration, clip.start, clip.end, Math.max(8, Math.floor(width / 2)))
      : [];

  return (
    <div
      data-clip-id={clip.id}
      role={ghost ? undefined : "button"}
      tabIndex={ghost ? undefined : -1}
      aria-label={ghost ? undefined : `${label}, ${durationSec.toFixed(2)} seconds`}
      onPointerDown={ghost ? undefined : (e) => onPointerDown?.(e, clip, "move")}
      onDoubleClick={ghost ? undefined : () => onDoubleClick?.(clip)}
      className={cn(
        "absolute top-1 select-none border-ink",
        width < HAIRLINE_WIDTH_PX ? "border-r" : "border-2",
        KIND_FILL[clip.kind],
        ghost
          ? "pointer-events-none z-40 border-dashed opacity-90 shadow-nb"
          : locked
            ? "cursor-not-allowed"
            : "cursor-grab active:cursor-grabbing",
        dimmed && "opacity-30",
        selected && !ghost && "z-20 shadow-nb ring-2 ring-select ring-offset-0",
        muted && "nb-hatch",
      )}
      style={{ left: positionSec * pxPerSec, width, height: bodyHeight }}
      title={`${label}\n${positionSec.toFixed(2)}s to ${(positionSec + durationSec).toFixed(2)}s (${durationSec.toFixed(2)}s)`}
    >
      {waveformPeaks.length > 0 ? (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <Waveform peaks={waveformPeaks} width={width - 4} height={bodyHeight - 4} />
        </div>
      ) : null}

      {showLabel ? (
        <div className="pointer-events-none relative flex h-full items-center justify-between gap-1 px-1.5">
          <span className="flex min-w-0 items-center gap-1">
            {clip.linkedClipId ? <Link2 className="h-3 w-3 shrink-0 text-ink" /> : null}
            {locked ? <Lock className="h-3 w-3 shrink-0 text-ink" /> : null}
            <span className="truncate font-sans text-[10px] font-bold leading-none text-ink">{label}</span>
          </span>
          {width >= 96 ? (
            <span className="flex shrink-0 items-center gap-1 font-mono text-[9px] font-bold tabular-nums text-ink/80">
              {clip.kind === "audio" ? (
                (clip.volume ?? 1) > 0 ? (
                  <Volume2 className="h-2.5 w-2.5" />
                ) : (
                  <VolumeX className="h-2.5 w-2.5" />
                )
              ) : null}
              {durationSec.toFixed(2)}s
            </span>
          ) : null}
        </div>
      ) : null}

      {!ghost && !locked ? (
        <>
          <div
            data-trim="start"
            onPointerDown={(e) => {
              e.stopPropagation();
              onPointerDown?.(e, clip, "trim-start");
            }}
            style={{ width: handleWidth }}
            className="absolute inset-y-0 left-0 cursor-ew-resize border-r-2 border-ink/40 bg-ink/10 hover:bg-ink/35"
            title="Drag to trim the in point"
          />
          <div
            data-trim="end"
            onPointerDown={(e) => {
              e.stopPropagation();
              onPointerDown?.(e, clip, "trim-end");
            }}
            style={{ width: handleWidth }}
            className="absolute inset-y-0 right-0 cursor-ew-resize border-l-2 border-ink/40 bg-ink/10 hover:bg-ink/35"
            title="Drag to trim the out point"
          />
        </>
      ) : null}
    </div>
  );
}
