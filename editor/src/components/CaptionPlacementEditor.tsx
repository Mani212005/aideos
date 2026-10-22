/**
 * File Description: Direct caption move/resize overlay and persistent scope, lock and reset bar.
 * Inputs and outputs: film, playhead and scaled Player -> draft preview and one labelled commit per gesture.
 * Used by: EditStage.
 */
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { createPortal } from "react-dom";
import type { PlayerRef } from "@remotion/player";
import {
  LockKeyhole,
  UnlockKeyhole,
  Move,
  GripVertical,
  RotateCcw,
} from "lucide-react";
import type { CaptionPlacement, Film } from "../../../src/dl/schema";
import { buildTimeline, shotAt } from "../../../src/dl/camera";
import {
  CAPTION_FRAMES,
  captionBounds,
  captionCardRect,
  captionRectsOverlap,
  dragCaption,
  resizeCaption,
  resolveCaptionPlacement,
  setCaptionPlacement,
  REEL_ACTION_ZONE,
  type CaptionFormat,
  type CaptionScope,
} from "../../../src/dl/captionPlacement";
import { getInsetRegion } from "../../../src/dl/fullScreenHeroLayout";
import { Button, SegmentedTabs } from "./ui";

const collisionResponse = z.object({
  findings: z.array(z.object({ rule: z.string(), message: z.string() })),
});
type Props = {
  film: Film;
  format: CaptionFormat;
  frame: number;
  playerRef: React.RefObject<PlayerRef | null>;
  host: HTMLDivElement | null;
  onDraft: (film: Film | null) => void;
  onCommit: (film: Film, label: string) => void;
};
type Gesture = {
  kind: "move" | "left" | "right";
  x: number;
  y: number;
  scale: number;
  placement: CaptionPlacement;
  film: Film;
  scope: CaptionScope;
  next: Film;
};
// Keeps all editor affordances outside the rendered composition and all changes in project history.
export function CaptionPlacementEditor({
  film,
  format,
  frame,
  playerRef,
  host,
  onDraft,
  onCommit,
}: Props) {
  const timeline = buildTimeline(film, film.voiceover?.durationSec);
  const shot = shotAt(timeline, frame).shot;
  const initialSource = resolveCaptionPlacement(film, format, shot.id).source;
  const [scopeKind, setScopeKind] = useState<"film" | "shot">(() =>
    resolveCaptionPlacement(film, format, shot.id).source === "shot"
      ? "shot"
      : "film",
  );
  const [draft, setDraft] = useState<Film | null>(null);
  const [viewport, setViewport] = useState<{
    left: number;
    top: number;
    scale: number;
  } | null>(null);
  const [artWarnings, setArtWarnings] = useState<string[]>([]);
  const gesture = useRef<Gesture | null>(null);
  const shownFilm = draft ?? film;
  const scope: CaptionScope =
    scopeKind === "shot" ? { kind: "shot", shotId: shot.id } : { kind: "film" };
  const placement = resolveCaptionPlacement(
    shownFilm,
    format,
    scopeKind === "shot" ? shot.id : undefined,
  );
  const { width, height } = CAPTION_FRAMES[format];
  const card = captionCardRect(format, width, height, placement);
  const bounds = captionBounds(format, width, height, placement.w, placement.y);
  const collision =
    shot.stage === "inset" &&
    captionRectsOverlap(card, getInsetRegion(format, width, height));
  const formatName = format === "long" ? "Wide" : "Reel";
  const scopeName = scopeKind === "film" ? "whole film" : `shot ${shot.id}`;

  // Debounces geometry measurement and discards stale responses while dragging.
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/caption-placement/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            film: shownFilm,
            format,
            shotId: shot.id,
            frame,
          }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const result = collisionResponse.parse(await response.json());
        if (!controller.signal.aborted)
          setArtWarnings(
            result.findings
              .filter((finding) => finding.rule === "caption-placement")
              .map((finding) => finding.message),
          );
      } catch {
        /* An unavailable design check does not block a manual placement gesture. */
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [shownFilm, format, shot.id, frame]);

  // Follow exceptions when changing shots or formats, without resetting an explicit scope choice mid-gesture.
  useEffect(() => {
    setScopeKind(initialSource === "shot" ? "shot" : "film");
    setDraft(null);
    onDraft(null);
  }, [film.id, format, shot.id, initialSource, onDraft]);

  // Track the real letterboxed composition, including media-bin and timeline resize changes.
  useEffect(() => {
    if (!host) return;
    // Maps composition coordinates into the editor matte's local coordinate system.
    const measure = () => {
      const container = playerRef.current?.getContainerNode();
      if (!container) return;
      const box = container.getBoundingClientRect();
      const parent = host.getBoundingClientRect();
      const scale = Math.min(box.width / width, box.height / height);
      setViewport({
        left: box.left - parent.left + (box.width - width * scale) / 2,
        top: box.top - parent.top + (box.height - height * scale) / 2,
        scale,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    const playerNode = playerRef.current?.getContainerNode();
    if (playerNode) observer.observe(playerNode);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [host, width, height, playerRef]);

  // Pointer listeners are present before a gesture can begin, including a fast release outside the card.
  useEffect(() => {
    // Produces a live composition draft without creating intermediate undo steps.
    const move = (event: PointerEvent) => {
      const active = gesture.current;
      if (!active) return;
      const args = {
        placement: active.placement,
        format,
        dx: event.clientX - active.x,
        scale: active.scale,
        snap: !event.altKey,
      };
      const nextPlacement =
        active.kind === "move"
          ? dragCaption({ ...args, dy: event.clientY - active.y })
          : resizeCaption({ ...args, edge: active.kind });
      active.next = setCaptionPlacement(active.film, {
        format,
        scope: active.scope,
        placement: nextPlacement,
        owner: true,
      });
      setDraft(active.next);
      onDraft(active.next);
    };
    // Saves a drop immediately as one owner operation.
    const finish = () => {
      const active = gesture.current;
      if (!active) return;
      gesture.current = null;
      if (active.next !== active.film)
        onCommit(
          active.next,
          `${active.kind === "move" ? "Move" : "Resize"} captions (${formatName}, ${active.scope.kind === "film" ? "whole film" : "this shot"})`,
        );
      setDraft(null);
      onDraft(null);
    };
    // Cancels draft motion without touching persistence or undo history.
    const cancel = () => {
      gesture.current = null;
      setDraft(null);
      onDraft(null);
    };
    // Escape rolls back an active drag before the timeline handles any keys.
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape);
    };
  }, [format, formatName, onCommit, onDraft]);

  // Captures the selected scope and initial placement so every pointer delta has one stable origin.
  function begin(
    event: React.PointerEvent<HTMLElement>,
    kind: Gesture["kind"],
  ) {
    if (!viewport || placement.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    gesture.current = {
      kind,
      x: event.clientX,
      y: event.clientY,
      scale: viewport.scale,
      placement,
      film,
      scope,
      next: film,
    };
  }
  // Switches scope at the current position, removing the current exception when following the whole film.
  function chooseScope(kind: "film" | "shot") {
    if (kind === scopeKind) return;
    const next = setCaptionPlacement(film, {
      format,
      scope: { kind: "shot", shotId: shot.id },
      placement:
        kind === "shot"
          ? resolveCaptionPlacement(film, format, shot.id)
          : undefined,
      owner: true,
    });
    setScopeKind(kind);
    onCommit(
      next,
      `${kind === "shot" ? "Create shot caption exception" : "Follow whole-film captions"} (${formatName})`,
    );
  }
  // Commits lock and keyboard edits through the same checked owner operation as dragging.
  function save(next?: CaptionPlacement, label = "Change") {
    onCommit(
      setCaptionPlacement(film, {
        format,
        scope,
        placement: next,
        owner: true,
      }),
      `${label} captions (${formatName}, ${scopeName})`,
    );
  }
  // Provides precise keyboard placement, width changes, lock and gesture cancellation.
  function keyDown(event: React.KeyboardEvent) {
    if (event.key.toLowerCase() === "l") {
      event.preventDefault();
      event.stopPropagation();
      save(
        { ...placement, locked: !placement.locked },
        placement.locked ? "Unlock" : "Lock",
      );
      return;
    }
    if (placement.locked || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 0.05 : 0.005;
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const direction =
      event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next =
      event.altKey && horizontal
        ? resizeCaption({
            placement,
            format,
            edge: "right",
            dx: direction * step * width,
            scale: 1,
            snap: false,
          })
        : dragCaption({
            placement,
            format,
            dx: horizontal ? direction * step * width : 0,
            dy: horizontal ? 0 : direction * step * height,
            scale: 1,
            snap: false,
          });
    save(next, event.altKey && horizontal ? "Resize" : "Move");
  }

  return (
    <>
      {host && viewport
        ? createPortal(
            <div
              data-caption-guides
              className="pointer-events-none absolute z-30 overflow-hidden"
              style={{
                left: viewport.left,
                top: viewport.top,
                width: width * viewport.scale,
                height: height * viewport.scale,
              }}
            >
              <div
                className="absolute border border-dashed border-info/70"
                style={{
                  left:
                    bounds.minX * width * viewport.scale -
                    (card.w * viewport.scale) / 2,
                  top: bounds.minY * height * viewport.scale,
                  width:
                    (bounds.maxX - bounds.minX + placement.w) *
                    width *
                    viewport.scale,
                  height:
                    (bounds.maxY - bounds.minY) * height * viewport.scale +
                    card.h * viewport.scale,
                }}
              />
              {format === "reel" ? (
                <div
                  aria-label="Platform action buttons"
                  className="absolute bg-warn/20"
                  style={{
                    left: REEL_ACTION_ZONE.x * width * viewport.scale,
                    top: (height * viewport.scale) / 2,
                    right: 0,
                    bottom: 0,
                    backgroundImage:
                      "repeating-linear-gradient(135deg, transparent, transparent 5px, var(--nb-warn) 5px, var(--nb-warn) 6px)",
                  }}
                />
              ) : null}
              {[bounds.minY, 0.45, bounds.maxY].map((y, i) => (
                <div
                  key={i}
                  className="absolute left-0 w-full border-t border-dashed border-select/50"
                  style={{ top: y * height * viewport.scale }}
                >
                  <span className="bg-paper px-1 font-mono text-[9px] text-ink">
                    {["Top", "Middle", "Bottom"][i]}
                  </span>
                </div>
              ))}
              <div
                className="absolute top-0 h-full border-l border-dashed border-select/50"
                style={{ left: (width * viewport.scale) / 2 }}
              />
              <div
                data-caption-handle
                role="button"
                aria-label={
                  placement.locked
                    ? "Caption placement locked"
                    : "Move caption card"
                }
                tabIndex={0}
                onKeyDown={keyDown}
                onPointerDown={(e) => begin(e, "move")}
                className={`pointer-events-auto absolute border-2 border-dashed outline-none focus:ring-2 focus:ring-select ${placement.locked ? "cursor-not-allowed border-warn" : "cursor-move border-primary"}`}
                style={{
                  touchAction: "none",
                  left: card.x * viewport.scale,
                  top: card.y * viewport.scale,
                  width: card.w * viewport.scale,
                  height: card.h * viewport.scale,
                }}
              >
                <span className="absolute bottom-full left-0 flex items-center gap-1 whitespace-nowrap border border-ink bg-primary px-1.5 py-0.5 font-mono text-[10px] text-ink">
                  {placement.locked ? (
                    <LockKeyhole size={11} />
                  ) : (
                    <Move size={11} />
                  )}
                  {placement.locked ? "Locked" : "Move / resize"} -{" "}
                  {scopeKind === "film" ? "Whole film" : shot.id}
                </span>
                {!placement.locked
                  ? (["left", "right"] as const).map((edge) => (
                      <button
                        key={edge}
                        aria-label={`Resize caption ${edge} edge`}
                        onPointerDown={(e) => begin(e, edge)}
                        className="absolute top-1/2 flex h-9 w-4 -translate-y-1/2 items-center justify-center border-2 border-ink bg-primary text-ink"
                        style={{
                          [edge]: -9,
                          cursor: "ew-resize",
                          touchAction: "none",
                        }}
                      >
                        <GripVertical size={12} />
                      </button>
                    ))
                  : null}
              </div>
            </div>,
            host,
          )
        : null}
      <div
        data-caption-bar
        className="flex shrink-0 flex-wrap items-center gap-2 border-t-2 border-ink bg-paper-2 px-3 py-2"
      >
        <span className="font-mono text-[10px] font-bold uppercase text-ink">
          {formatName} captions
        </span>
        <SegmentedTabs
          size="sm"
          ariaLabel="Caption edit scope"
          value={scopeKind}
          onChange={chooseScope}
          items={[
            {
              value: "film",
              label: "Whole film",
              title: `All ${formatName} shots`,
            },
            { value: "shot", label: "This shot only", title: shot.id },
          ]}
        />
        <span
          data-caption-readout
          className="font-mono text-[10px] tabular-nums text-ink-soft"
        >
          X {Math.round(placement.x * 100)}% / Y {Math.round(placement.y * 100)}
          % / W {Math.round(placement.w * 100)}%
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            active={placement.locked}
            onClick={() =>
              save(
                { ...placement, locked: !placement.locked },
                placement.locked ? "Unlock" : "Lock",
              )
            }
          >
            {placement.locked ? (
              <LockKeyhole size={12} />
            ) : (
              <UnlockKeyhole size={12} />
            )}
            {placement.locked ? "Unlock" : "Lock"}
          </Button>
          <Button size="sm" onClick={() => save(undefined, "Reset")}>
            <RotateCcw size={12} />
            Reset
          </Button>
        </div>
        {collision || artWarnings.length ? (
          <p
            role="status"
            className="w-full font-mono text-xs text-danger-text"
          >
            {artWarnings[0] ??
              "Caption overlaps this shot's inset. Move the card or the art."}
          </p>
        ) : null}
        <p className="w-full font-mono text-[9px] text-ink-mute">
          Drag to move. Edge handles resize. Drop saves. Arrows nudge, Shift
          moves faster, Alt bypasses snap, Alt + arrows resize, L locks. Esc
          cancels.
        </p>
      </div>
    </>
  );
}
