/**
 * File Description: The captions as a direct-manipulation object in the Edit preview: hover ring, click to select, drag to move for the whole video, edge handles, snap guides while dragging, keyboard and touch support, plus the strip under the preview.
 * Inputs and outputs: film, playhead and scaled Player -> a selection ring that hugs the rendered caption card, live drafts while dragging and one labelled undo step per gesture.
 * Used by: EditStage.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { z } from "zod";
import type { PlayerRef } from "@remotion/player";
import { measureText } from "@remotion/layout-utils";
import { LockKeyhole } from "lucide-react";
import type { CaptionPlacement, Film } from "../../../../src/dl/schema";
import { shotAt, type TimedShot } from "../../../../src/dl/camera";
import {
  CAPTION_FRAMES,
  DEFAULT_CAPTION_PLACEMENT_WIDTH,
  captionCardRect,
  captionRectsOverlap,
  clampCaptionPlacement,
  dragCaption,
  resizeCaption,
  resolveCaptionPlacement,
  setCaptionPlacement,
  type CaptionFormat,
} from "../../../../src/dl/captionPlacement";
import { getInsetRegion } from "../../../../src/dl/fullScreenHeroLayout";
import { captionWordsForFilm } from "../../../../src/dl/captionsParser";
import { buildCaptionPhrases, captionPhraseAtFrame } from "../../../../src/dl/captionPhrases";
import { SANS } from "../../../../src/dl/tokens";
import { CaptionStrip, describeArtWarning } from "./CaptionStrip";
import {
  DRAG_SLOP_PX,
  dragWithGuides,
  limitHint as describeLimit,
  limitLines,
  safeAreaRects,
  type MoveLimits,
  type SnapGuide,
} from "./captionGuides";

const collisionResponse = z.object({
  findings: z.array(z.object({ rule: z.string(), message: z.string() })),
});
/** Pixels added around the rendered card so a click that just misses the box still selects it. */
const HIT_PAD = 6;
/** Keyboard nudges within this many milliseconds merge into one undo step. */
const NUDGE_MERGE_MS = 700;

export interface CaptionTargetRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
type Props = {
  film: Film;
  previewFilm: Film;
  previewTimeline: TimedShot[];
  format: CaptionFormat;
  frame: number;
  playerRef: React.RefObject<PlayerRef | null>;
  host: HTMLDivElement | null;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  onDraft: (film: Film | null) => void;
  onCommit: (film: Film, label: string) => void;
  /** Reports the caption box in preview-host pixels so floating panels can tell whether they cover it. */
  onTargetRect?: (rect: CaptionTargetRect | null) => void;
  /** Reports whether the pointer or keyboard focus is on the caption, so a floating panel can step aside. */
  onHotChange?: (hot: boolean) => void;
};
type GestureKind = "move" | "left" | "right";
type Gesture = {
  kind: GestureKind;
  pointerId: number;
  x: number;
  y: number;
  scale: number;
  start: CaptionPlacement;
  /** Visible card width as a fraction of the frame, used as the resize origin of an auto-width card. */
  visibleWidth: number;
  cardHeight: number;
  film: Film;
  next: Film;
  moved: boolean;
};
type Viewport = { left: number; top: number; scale: number };
type DragView = { kind: GestureKind; guides: SnapGuide[]; limits: MoveLimits; placement: CaptionPlacement; startX: number };

// Compares two placements by value so a drag that ends where it began leaves no empty undo step.
function samePlacement(a: CaptionPlacement, b: CaptionPlacement): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.locked === b.locked;
}
// Keeps the owner able to drag a locked card: the lock only protects against agents and rebuilds.
function ownerMove(placement: CaptionPlacement, run: (unlocked: CaptionPlacement) => CaptionPlacement): CaptionPlacement {
  return { ...run({ ...placement, locked: false }), locked: placement.locked };
}

// Draws the caption selection object over the preview, outside the composition so editor chrome never reaches an export.
export function CaptionObject({
  film,
  previewFilm,
  previewTimeline,
  format,
  frame,
  playerRef,
  host,
  selected,
  onSelectedChange,
  onDraft,
  onCommit,
  onTargetRect,
  onHotChange,
}: Props) {
  const timeline = previewTimeline;
  const shot = shotAt(timeline, frame).shot;
  const [draft, setDraft] = useState<Film | null>(null);
  const shownFilm = draft ?? film;
  // Phrase layout reads the live film through a ref so a pointer-move draft does not rebuild every phrase.
  const shownFilmRef = useRef(shownFilm);
  shownFilmRef.current = shownFilm;
  const latest = useRef({ onCommit, onDraft });
  latest.current = { onCommit, onDraft };
  const fps = film.fps || 30;
  const words = useMemo(() => captionWordsForFilm(previewFilm), [previewFilm]);
  const phraseLayoutKey = JSON.stringify([
    resolveCaptionPlacement(shownFilm, format).w,
    ...shownFilm.shots.map((item) => {
      const resolved = resolveCaptionPlacement(shownFilm, format, item.id);
      return [resolved.source, resolved.w];
    }),
  ]);
  // phraseLayoutKey is the only film-derived input that changes phrase wrapping, so it stands in for the film here.
  const phrases = useMemo(() => buildCaptionPhrases({
    words, fps, width: CAPTION_FRAMES[format].width, fontSize: 45,
    placementAt: (startFrame) => resolveCaptionPlacement(shownFilmRef.current, format, shotAt(timeline, startFrame)?.shot.id),
    measure: (text) => measureText({ text, fontFamily: SANS, fontSize: 45, fontWeight: 700 }).width,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [words, fps, format, phraseLayoutKey, timeline]);
  const activePhrase = captionPhraseAtFrame(phrases, frame);
  const editingShot = activePhrase ? shotAt(timeline, activePhrase.startFrame).shot : shot;
  const { width, height } = CAPTION_FRAMES[format];
  const formatName = format === "long" ? "Wide" : "Reel";
  const otherFormat: CaptionFormat = format === "long" ? "reel" : "long";
  const otherFormatName = format === "long" ? "Reel" : "Wide";
  /** The position the phrase on screen really uses, and the whole-video entry this object edits. */
  const effective = resolveCaptionPlacement(shownFilm, format, editingShot.id);
  const wholeVideo = resolveCaptionPlacement(shownFilm, format);
  const shotException = effective.source === "shot";

  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [cardBox, setCardBox] = useState<{ w: number; h: number } | null>(null);
  const lastCardBox = useRef<{ w: number; h: number } | null>(null);
  const [dragView, setDragView] = useState<DragView | null>(null);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [artWarnings, setArtWarnings] = useState<string[]>([]);
  const gesture = useRef<Gesture | null>(null);
  const nudge = useRef<{ film: Film; next: Film; label: string; timer: number } | null>(null);
  const targetRef = useRef<HTMLDivElement>(null);

  // Debounces geometry measurement and discards stale responses while dragging.
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/caption-placement/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ film: shownFilm, previewFilm, format, shotId: editingShot.id, frame }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const result = collisionResponse.parse(await response.json());
        if (!controller.signal.aborted)
          setArtWarnings(result.findings.filter((finding) => finding.rule === "caption-placement").map((finding) => finding.message));
      } catch {
        /* An unavailable design check does not block a manual placement gesture. */
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [shownFilm, previewFilm, format, editingShot.id, frame]);

  // Clears any draft when the open film or format changes, and never leaves a stale draft in the preview on unmount.
  useEffect(() => {
    setDraft(null);
    onDraft(null);
    setLimitMessage(null);
    return () => onDraft(null);
  }, [film.id, format, onDraft]);

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

  // Reads the size of the card the renderer actually drew, so the ring hugs it and cannot disagree with it.
  const measureCard = useCallback(() => {
    const card = host?.querySelector<HTMLElement>("[data-caption-card]");
    const next = card ? { w: card.offsetWidth, h: card.offsetHeight } : null;
    if (next) lastCardBox.current = next;
    setCardBox((previous) => (previous?.w === next?.w && previous?.h === next?.h ? previous : next));
  }, [host]);
  useLayoutEffect(measureCard);
  // Follows whichever Player is mounted now, including one replaced by Refresh preview.
  const mountedPlayer = playerRef.current;
  useEffect(() => {
    if (!mountedPlayer) return;
    const onFrame = () => window.requestAnimationFrame(measureCard);
    mountedPlayer.addEventListener("frameupdate", onFrame);
    return () => mountedPlayer.removeEventListener("frameupdate", onFrame);
  }, [mountedPlayer, measureCard]);

  // Where the box sits comes from the placement data so it never lags a drag; how big it is comes from the rendered card.
  const ghost = selected && !cardBox;
  const sizeSource = cardBox ?? lastCardBox.current;
  const band = captionCardRect(format, width, height, effective);
  const boxW = cardBox?.w ?? (sizeSource && effective.w === undefined ? sizeSource.w : (effective.w ?? DEFAULT_CAPTION_PLACEMENT_WIDTH) * width);
  const boxH = cardBox?.h ?? sizeSource?.h ?? band.h;
  const box = { x: effective.x * width - boxW / 2, y: effective.y * height, w: boxW, h: boxH };
  const visible = viewport && (cardBox || ghost);
  const shownBox = visible && viewport
    ? {
        left: box.x * viewport.scale,
        top: box.y * viewport.scale,
        width: box.w * viewport.scale,
        height: box.h * viewport.scale,
      }
    : null;

  // Lets floating panels stay clear of the caption.
  const hostRect = shownBox && viewport ? { left: viewport.left + shownBox.left, top: viewport.top + shownBox.top, width: shownBox.width, height: shownBox.height } : null;
  const hostRectRef = useRef(hostRect);
  hostRectRef.current = hostRect;
  const hostRectKey = hostRect ? `${hostRect.left}|${hostRect.top}|${hostRect.width}|${hostRect.height}` : "";
  useEffect(() => onTargetRect?.(hostRectRef.current), [onTargetRect, hostRectKey]);
  useEffect(() => () => {
    onTargetRect?.(null);
    onHotChange?.(false);
  }, [onTargetRect, onHotChange]);

  // A caption that leaves the screen cannot fire a pointer-leave, so clear the hover state explicitly.
  const hasBox = shownBox !== null;
  useEffect(() => {
    if (!hasBox) onHotChange?.(false);
  }, [hasBox, onHotChange]);

  const collision = shot.stage === "inset" && captionRectsOverlap(band, getInsetRegion(format, width, height));
  const artNotes = useMemo(() => {
    const notes = artWarnings.map((message) => describeArtWarning(message, fps));
    if (!notes.length && collision)
      notes.push({ text: "Covers part of the artwork in this shot", detail: "Caption overlaps this shot's inset. Move the card or the art." });
    return notes;
  }, [artWarnings, collision, fps]);

  // Commits a pending keyboard nudge burst as a single undo step.
  const flushNudge = useCallback(() => {
    const pending = nudge.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    nudge.current = null;
    latest.current.onCommit(pending.next, pending.label);
    setDraft(null);
    latest.current.onDraft(null);
  }, []);
  useEffect(() => flushNudge, [flushNudge]);

  // Pointer listeners are present before a gesture can begin, including a fast release outside the card.
  useEffect(() => {
    // Produces a live composition draft without creating intermediate undo steps.
    const move = (event: PointerEvent) => {
      const active = gesture.current;
      if (!active || event.pointerId !== active.pointerId) return;
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      if (!active.moved) {
        if (Math.hypot(dx, dy) < DRAG_SLOP_PX) return;
        active.moved = true;
      }
      let placement: CaptionPlacement;
      let guides: SnapGuide[] = [];
      let limits: MoveLimits = { left: false, right: false, top: false, bottom: false };
      if (active.kind === "move") {
        const result = dragWithGuides({
          start: { ...active.start, locked: false },
          dx,
          dy,
          scale: active.scale,
          format,
          cardHeight: active.cardHeight,
          bypassSnap: event.altKey,
        });
        placement = { ...result.placement, locked: active.start.locked };
        guides = result.guides;
        limits = result.limits;
      } else {
        const base = { ...active.start, w: active.start.w ?? active.visibleWidth };
        placement = ownerMove(base, (unlocked) =>
          resizeCaption({ placement: unlocked, format, edge: active.kind as "left" | "right", dx, scale: active.scale, snap: !event.altKey }),
        );
      }
      active.next = setCaptionPlacement(active.film, { format, scope: { kind: "film" }, placement, owner: true });
      setDraft(active.next);
      onDraft(active.next);
      setDragView({ kind: active.kind, guides, limits, placement, startX: active.start.x });
      setLimitMessage(describeLimit(limits));
    };
    // Saves a drop immediately as one owner operation, and leaves a plain click as a selection only.
    const finish = (event: PointerEvent) => {
      const active = gesture.current;
      if (!active || event.pointerId !== active.pointerId) return;
      gesture.current = null;
      const nextPlacement = resolveCaptionPlacement(active.next, format);
      if (active.moved && !samePlacement(nextPlacement, active.start) ) {
        onCommit(active.next, `${active.kind === "move" ? "Move" : "Resize"} captions (${formatName}, whole video)`);
        setAnnouncement(`Captions ${active.kind === "move" ? "moved" : "resized"} to ${Math.round(nextPlacement.y * 100)}% from top, whole video, ${formatName}`);
      }
      setDraft(null);
      onDraft(null);
      setDragView(null);
    };
    // Cancels draft motion without touching persistence or undo history.
    const cancel = () => {
      if (!gesture.current) return;
      gesture.current = null;
      setDraft(null);
      onDraft(null);
      setDragView(null);
    };
    // Escape rolls back an active drag; with nothing active it deselects the captions.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (gesture.current) {
        event.preventDefault();
        cancel();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (selected && !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
        flushNudge();
        onSelectedChange(false);
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
  }, [format, formatName, onCommit, onDraft, onSelectedChange, selected, flushNudge]);

  // A click on empty video deselects the captions instead of starting playback.
  useEffect(() => {
    if (!selected) return;
    // Treats a pointer press on the composition itself, outside the caption and the strip, as deselection.
    const press = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.closest("[data-caption-object], [data-caption-bar]")) return;
      if (target.closest(".__remotion-player")) onSelectedChange(false);
    };
    window.addEventListener("pointerdown", press, true);
    return () => window.removeEventListener("pointerdown", press, true);
  }, [selected, onSelectedChange]);

  // Captures the whole-video placement so every pointer delta has one stable origin, and selects the captions.
  function begin(event: React.PointerEvent<HTMLElement>, kind: GestureKind) {
    if (!viewport || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    flushNudge();
    playerRef.current?.pause();
    onSelectedChange(true);
    targetRef.current?.focus({ preventScroll: true });
    setLimitMessage(null);
    if (shotException) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* A synthetic or already-released pointer cannot be captured; window listeners still follow the gesture. */
    }
    gesture.current = {
      kind,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scale: viewport.scale,
      start: wholeVideo,
      visibleWidth: (cardBox ?? lastCardBox.current)?.w ? (cardBox ?? lastCardBox.current)!.w / width : DEFAULT_CAPTION_PLACEMENT_WIDTH,
      cardHeight: (cardBox ?? lastCardBox.current)?.h ?? band.h,
      film,
      next: film,
      moved: false,
    };
  }
  // Commits one owner operation on the whole-video entry (or clears it when no placement is given).
  function save(placement: CaptionPlacement | undefined, label: string, target: CaptionFormat = format) {
    flushNudge();
    onCommit(setCaptionPlacement(film, { format: target, scope: { kind: "film" }, placement, owner: true }), `${label} (${target === "long" ? "Wide" : "Reel"}, whole video)`);
  }
  // Centers the box sideways within what the format allows.
  function center() {
    save(clampCaptionPlacement({ ...wholeVideo, x: 0.5 }, format), "Center captions");
  }
  // Returns to the standard bottom position and automatic width.
  function useDefault() {
    save(undefined, "Default position for captions");
  }
  // Writes the same position, clamped to the other format's safe area, to the other format.
  function copyToOther() {
    const other = resolveCaptionPlacement(film, otherFormat);
    save(
      wholeVideo.source === "default" ? undefined : clampCaptionPlacement({ x: wholeVideo.x, y: wholeVideo.y, ...(wholeVideo.w === undefined ? {} : { w: wholeVideo.w }), locked: other.locked }, otherFormat),
      `Copy captions to ${otherFormatName}`,
      otherFormat,
    );
  }
  // Locks the whole-video position against agents and rebuilds without changing the visible width.
  function toggleLock() {
    save({ x: wholeVideo.x, y: wholeVideo.y, ...(wholeVideo.w === undefined ? {} : { w: wholeVideo.w }), locked: !wholeVideo.locked }, wholeVideo.locked ? "Unlock captions" : "Lock captions");
  }
  // Removes this shot's own position so the shot follows the whole-video position again.
  function followWholeVideo() {
    flushNudge();
    onCommit(
      setCaptionPlacement(film, { format, scope: { kind: "shot", shotId: editingShot.id }, placement: undefined, owner: true }),
      `Follow whole video captions (${formatName})`,
    );
  }
  // Provides precise keyboard placement, width changes and lock for the focused caption; Space keeps play and pause.
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      onSelectedChange(true);
      return;
    }
    if (!selected) return;
    if (event.key.toLowerCase() === "l" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      toggleLock();
      return;
    }
    if (shotException || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 0.05 : 0.005;
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const current = resolveCaptionPlacement(nudge.current?.next ?? film, format);
    const visibleWidth = (cardBox ?? lastCardBox.current)?.w ? (cardBox ?? lastCardBox.current)!.w / width : DEFAULT_CAPTION_PLACEMENT_WIDTH;
    const resizing = event.altKey && horizontal;
    const next = resizing
      ? ownerMove({ ...current, w: current.w ?? visibleWidth }, (unlocked) =>
          resizeCaption({ placement: unlocked, format, edge: "right", dx: direction * step * width, scale: 1, snap: false }),
        )
      : ownerMove(current, (unlocked) =>
          dragCaption({
            placement: unlocked,
            format,
            dx: horizontal ? direction * step * width : 0,
            dy: horizontal ? 0 : direction * step * height,
            scale: 1,
            snap: false,
          }),
        );
    const base = nudge.current?.film ?? film;
    const nextFilm = setCaptionPlacement(base, { format, scope: { kind: "film" }, placement: next, owner: true });
    if (nudge.current) window.clearTimeout(nudge.current.timer);
    nudge.current = {
      film: base,
      next: nextFilm,
      label: `${resizing ? "Resize" : "Move"} captions (${formatName}, whole video)`,
      timer: window.setTimeout(() => {
        setAnnouncement(`Captions ${resizing ? "resized" : "moved"} to ${Math.round(next.y * 100)}% from top, whole video, ${formatName}`);
        flushNudge();
      }, NUDGE_MERGE_MS),
    };
    setDraft(nextFilm);
    onDraft(nextFilm);
  }

  const lockedBadge = selected && wholeVideo.locked;
  const chipBelow = shownBox ? shownBox.top < 26 : false;
  const dragging = dragView !== null;
  const guideLayer =
    dragging && viewport ? (
      <div aria-hidden data-caption-guides className="pointer-events-none absolute inset-0 overflow-hidden">
        {safeAreaRects(format).map((rect) =>
          rect.w > 0 && rect.h > 0 ? (
            <div
              key={rect.id}
              data-caption-safe-area={rect.id}
              className="absolute"
              style={{
                left: rect.x * viewport.scale,
                top: rect.y * viewport.scale,
                width: rect.w * viewport.scale,
                height: rect.h * viewport.scale,
                // The matte is near black, so the outside-the-safe-area haze is a light tint of the matte text colour.
                background: rect.kind === "zone" ? "color-mix(in srgb, var(--nb-warn) 22%, transparent)" : "color-mix(in srgb, var(--nb-matte-text) 11%, transparent)",
                ...(rect.kind === "zone"
                  ? { backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 5px, var(--nb-warn) 5px, var(--nb-warn) 6px)" }
                  : {}),
              }}
            >
              {rect.label ? (
                <span
                  className={`absolute top-1 whitespace-nowrap bg-paper px-1 font-mono text-[9px] text-ink ${rect.kind === "zone" ? "right-full mr-1" : "left-1"}`}
                >
                  {rect.label}
                </span>
              ) : null}
            </div>
          ) : null,
        )}
        {limitLines(format, dragView?.limits).map((line) => (
          <div
            key={line.id}
            data-caption-limit={line.id}
            className={`absolute bg-select ${line.vertical ? "top-0 h-full w-0.5" : "left-0 h-0.5 w-full"}`}
            style={line.vertical ? { left: line.at * viewport.scale } : { top: line.at * viewport.scale }}
          />
        ))}
        {dragView?.guides.map((guide) =>
          guide.axis === "x" ? (
            <div key="x" data-caption-snap="x" className="absolute top-0 h-full w-px bg-select" style={{ left: guide.line * width * viewport.scale }}>
              <span className="absolute left-1 top-1 whitespace-nowrap bg-select px-1 font-mono text-[9px] text-select-ink">{guide.label}</span>
            </div>
          ) : (
            <div key="y" data-caption-snap="y" className="absolute left-0 h-px w-full bg-select" style={{ top: guide.line * height * viewport.scale }}>
              <span className="absolute right-1 top-1 whitespace-nowrap bg-select px-1 font-mono text-[9px] text-select-ink">{guide.label}</span>
            </div>
          ),
        )}
      </div>
    ) : null;

  return (
    <>
      {host && viewport
        ? createPortal(
            <div
              data-caption-overlay
              className="pointer-events-none absolute z-[45]"
              style={{ left: viewport.left, top: viewport.top, width: width * viewport.scale, height: height * viewport.scale }}
            >
              {guideLayer}
              {shownBox ? (
                <div
                  ref={targetRef}
                  data-caption-object
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={`Captions, ${formatName}, whole video, ${Math.round(effective.y * 100)}% from top${wholeVideo.locked ? ", locked" : ""}`}
                  title={shotException ? "This shot has its own caption position" : "Click to select captions, drag to move"}
                  onKeyDown={keyDown}
                  onPointerEnter={() => onHotChange?.(true)}
                  onPointerLeave={() => onHotChange?.(false)}
                  onFocus={() => onHotChange?.(true)}
                  onBlur={() => onHotChange?.(false)}
                  onPointerDown={(event) => begin(event, "move")}
                  className={`group pointer-events-auto absolute outline-none ${dragging ? "cursor-grabbing" : shotException ? "cursor-pointer" : "cursor-grab"}`}
                  style={{
                    touchAction: "none",
                    left: shownBox.left - HIT_PAD,
                    top: shownBox.top - HIT_PAD,
                    width: shownBox.width + HIT_PAD * 2,
                    height: shownBox.height + HIT_PAD * 2,
                  }}
                >
                  <div
                    data-caption-ring
                    className={`absolute border-select ${ghost ? "border-dashed" : "border-solid"} ${
                      selected ? "border-2" : "border-[1.5px] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                    }`}
                    style={{
                      inset: HIT_PAD,
                      borderRadius: 16 * viewport.scale,
                      boxShadow: selected
                        ? "inset 0 0 0 1px var(--nb-select-ink), 0 0 0 4px color-mix(in srgb, var(--nb-select) 28%, transparent)"
                        : "0 0 0 1px color-mix(in srgb, var(--nb-select-ink) 60%, transparent)",
                    }}
                  />
                  {selected ? (
                    <span
                      data-caption-chip
                      className={`pointer-events-none absolute left-1.5 flex items-center gap-1 whitespace-nowrap bg-select px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-select-ink ${chipBelow ? "top-full mt-2" : "bottom-full mb-2"}`}
                    >
                      {lockedBadge ? <LockKeyhole role="img" aria-label="Caption placement locked" size={11} /> : null}
                      {dragView && dragView.kind === "move"
                        ? `Y ${Math.round(dragView.placement.y * 100)}%${dragView.placement.x !== dragView.startX ? ` / X ${Math.round(dragView.placement.x * 100)}%` : ""}`
                        : dragView
                          ? `W ${Math.round((dragView.placement.w ?? DEFAULT_CAPTION_PLACEMENT_WIDTH) * 100)}%`
                          : ghost
                            ? "No caption at this moment"
                            : shotException
                              ? "Captions - this shot only"
                              : "Captions - whole video"}
                    </span>
                  ) : null}
                  {selected && !shotException
                    ? (["left", "right"] as const).map((edge) => (
                        <button
                          key={edge}
                          type="button"
                          aria-label={`Resize caption ${edge} edge`}
                          onPointerDown={(event) => begin(event, edge)}
                          className="absolute top-1/2 flex h-10 w-6 -translate-y-1/2 items-center justify-center"
                          style={{ [edge]: HIT_PAD - 12, cursor: "ew-resize", touchAction: "none" }}
                        >
                          <span aria-hidden className="block h-6 w-2.5 rounded-sm border border-select-ink bg-select" />
                        </button>
                      ))
                    : null}
                </div>
              ) : null}
            </div>,
            host,
          )
        : null}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      <CaptionStrip
        selected={selected}
        formatName={formatName}
        otherFormatName={otherFormatName}
        shotCount={film.shots.length}
        locked={wholeVideo.locked}
        shotException={shotException}
        limitHint={limitMessage}
        artWarnings={artNotes}
        unfittableWords={activePhrase?.unfittableWords.map((word) => word.text) ?? []}
        onCenter={center}
        onDefault={useDefault}
        onCopy={copyToOther}
        onToggleLock={toggleLock}
        onFollowWholeVideo={followWholeVideo}
      />
    </>
  );
}
