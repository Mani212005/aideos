/**
 * File Description: Aideos multi-lane timeline and trimmer.
 * Renders the real layer model (one row per layer, ordered by z-index) and drives every edit
 * through the layer engine so the preview, the export and the timeline always agree. Owns the
 * professional-NLE drag behaviour: pointer-event gestures with a ghost preview, live snap guides
 * measured in screen pixels, cross-lane drops, multi-select drags that preserve relative offsets,
 * trim handles that stay grabbable on short clips, edge auto-scroll, Escape to cancel, and one
 * undoable transaction per gesture. Clips outside the visible time window are not rendered, so a
 * film with thousands of subtitle cues stays responsive.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeftRight,
  ChevronsLeftRight,
  Layers,
  Magnet,
  Maximize2,
  Pause,
  Play,
  Plus,
  Redo2,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Unlink,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Film } from "../../../src/dl/schema";
import type { Clip } from "../../../src/dl/layeredSchema";
import type {
  AnimationPayload,
  AudioPayload,
  SubtitlePayload,
  TextPayload,
  VideoPayload,
} from "../../../src/dl/layeredSchema";
import {
  IDLE_DRAG,
  autoScrollVelocity,
  beginDrag,
  cancelDrag,
  endDrag,
  updateDrag,
  type DragState,
} from "../../../backend/timeline/drag_machine";
import {
  calculateClipSnap,
  calculateStickySnap,
  collectSnapTargets,
  type SnapTarget,
} from "../../../backend/timeline/snap";
import {
  clipDuration,
  clipEndSec,
} from "../../../backend/timeline/layer_engine";
import type { LayeredTimelineApi } from "../state/useLayeredTimeline";
import {
  Badge,
  Button,
  KeyHint,
  Toolbar,
  ToolbarDivider,
  ToolbarGroup,
  ToolbarLabel,
  cn,
} from "./ui";
import { ClipBody, type ClipPointerMode } from "./timeline/ClipBody";
import { LaneHeader } from "./timeline/LaneHeader";
import { TimelineRuler, formatFrameTimecode } from "./timeline/TimelineRuler";

/** Zoom bounds in pixels per second. */
const MIN_PX_PER_SEC = 2;
const MAX_PX_PER_SEC = 300;

/** Snap threshold in screen pixels, so snapping feels identical at every zoom level. */
const SNAP_TOLERANCE_PX = 10;

/** Width of the lane header column. */
const HEADER_WIDTH_PX = 184;

/** Extra seconds of empty runway drawn after the last clip so there is somewhere to drop things. */
const RUNWAY_SEC = 6;

export type TimelineTool = "select" | "razor";

export interface TimelineEditorProps {
  film: Film;
  api: LayeredTimelineApi;
  /** Authoritative total length of the film in seconds. */
  durationSec: number;
  currentFrame: number;
  isPlaying: boolean;
  selectedClipIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onSeekFrame: (frame: number) => void;
  onTogglePlay: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReject: (message: string) => void;
}

/** Short human label for a clip, used inside its body and in the inspector. */
export function clipLabel(clip: Clip): string {
  switch (clip.kind) {
    case "animation":
      return (clip.payload as AnimationPayload).shotId ?? clip.id;
    case "audio": {
      const src = (clip.payload as AudioPayload).src ?? "";
      return src.split("/").pop() || clip.id;
    }
    case "video": {
      const src = (clip.payload as VideoPayload).src ?? "";
      return src.split("/").pop() || clip.id;
    }
    case "text":
      return (clip.payload as TextPayload).text ?? clip.id;
    case "subtitle":
      return (clip.payload as SubtitlePayload).text ?? clip.id;
    default:
      return clip.id;
  }
}

/** Audio source a clip should draw a waveform from, when it has one. */
function waveformSourceFor(clip: Clip): string | undefined {
  if (clip.kind !== "audio") return undefined;
  const src = (clip.payload as AudioPayload).src;
  if (!src) return undefined;
  return src.startsWith("http") || src.startsWith("/") ? src : `/${src}`;
}

/** Subtitle cues are derived from the caption track, so the timeline shows them read-only. */
function isDraggable(clip: Clip): boolean {
  return clip.kind !== "subtitle";
}

/** Aideos multi-lane timeline: layer rows, clip slabs, playhead and the full drag interaction. */
export const TimelineEditor: React.FC<TimelineEditorProps> = ({
  film,
  api,
  durationSec,
  currentFrame,
  isPlaying,
  selectedClipIds,
  onSelectionChange,
  onSeekFrame,
  onTogglePlay,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onReject,
}) => {
  const fps = film.fps || 30;
  const scrollRef = useRef<HTMLDivElement>(null);
  const laneStackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>(IDLE_DRAG);
  const autoScrollRef = useRef<number | null>(null);

  const [pxPerSec, setPxPerSec] = useState(28);
  const [tool, setTool] = useState<TimelineTool>("select");
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [rippleEnabled, setRippleEnabled] = useState(false);
  const [drag, setDrag] = useState<DragState>(IDLE_DRAG);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ left: 0, width: 1200 });
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  const [dropHintSec, setDropHintSec] = useState<number | null>(null);
  const [dropHintLaneId, setDropHintLaneId] = useState<string | null>(null);

  const playheadSec = currentFrame / fps;
  const timelineSec = Math.max(durationSec, api.contentEndSec) + RUNWAY_SEC;
  const contentWidth = Math.max(viewport.width, timelineSec * pxPerSec);

  const selection = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);

  const clipById = useMemo(() => {
    const map = new Map<string, Clip>();
    for (const c of api.layered.clips) map.set(c.id, c);
    return map;
  }, [api.layered.clips]);

  const primarySelected =
    selectedClipIds.length > 0 ? clipById.get(selectedClipIds[0]) : undefined;

  // Track the horizontal viewport so only clips in view are rendered.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    /** Cache the scroll offsets and viewport width used for virtualisation and auto-scroll. */
    const sync = () => {
      setScrollTop(node.scrollTop);
      setViewport({ left: node.scrollLeft, width: node.clientWidth });
    };
    sync();
    node.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, []);

  /** Convert a client X coordinate into a timeline time in seconds. */
  const timeFromClientX = useCallback(
    (clientX: number) => {
      const node = scrollRef.current;
      if (!node) return 0;
      const rect = node.getBoundingClientRect();
      return Math.max(0, (clientX - rect.left + node.scrollLeft) / pxPerSec);
    },
    [pxPerSec],
  );

  /** Resolve which lane a client Y coordinate is over, for cross-lane drops. */
  const laneFromClientY = useCallback((clientY: number): string | null => {
    const stack = laneStackRef.current;
    if (!stack) return null;
    const rows = Array.from(
      stack.querySelectorAll<HTMLElement>("[data-lane-id]"),
    );
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom)
        return row.dataset.laneId ?? null;
    }
    return null;
  }, []);

  const snapTargets = useMemo(() => {
    if (drag.mode === "idle") return [] as SnapTarget[];
    return collectSnapTargets(
      api.layered,
      playheadSec,
      timelineSec,
      drag.clipIds,
      pxPerSec,
    );
  }, [
    api.layered,
    drag.mode,
    drag.clipIds,
    playheadSec,
    timelineSec,
    pxPerSec,
  ]);

  /** Stop any running auto-scroll loop. */
  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current !== null) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  }, []);

  /** Creep the timeline horizontally while a drag sits near the viewport edge. */
  const runAutoScroll = useCallback(() => {
    stopAutoScroll();
    /** One auto-scroll frame, re-queued while the pointer stays inside an edge zone. */
    const step = () => {
      const node = scrollRef.current;
      const state = dragRef.current;
      if (!node || state.mode === "idle") {
        autoScrollRef.current = null;
        return;
      }
      const rect = node.getBoundingClientRect();
      const velocity = autoScrollVelocity(
        state.pointerX,
        rect.left,
        rect.right,
      );
      if (velocity !== 0) node.scrollLeft += velocity;
      autoScrollRef.current = requestAnimationFrame(step);
    };
    autoScrollRef.current = requestAnimationFrame(step);
  }, [stopAutoScroll]);

  /** Push a new drag state into both the ref (for rAF loops) and React state (for rendering). */
  const setDragState = useCallback((next: DragState) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  /** Open a gesture on a clip: move it, or trim either of its edges. */
  const handleClipPointerDown = useCallback(
    (e: React.PointerEvent, clip: Clip, mode: ClipPointerMode) => {
      if (!isDraggable(clip)) return;
      const lane = api.layered.layers.find((l) => l.id === clip.layerId);
      if (lane?.locked) {
        onReject(
          `Lane "${lane.label}" is locked. Unlock it to edit its clips.`,
        );
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      if (tool === "razor") {
        const at = timeFromClientX(e.clientX);
        api.splitClip(clip.id, at);
        return;
      }

      // Find associated audio/video partner
      const partner = api.layered.clips.find(
        (c) =>
          c.id !== clip.id &&
          (c.id === clip.linkedClipId ||
            c.linkedClipId === clip.id ||
            (((c.kind === "audio" && clip.kind !== "audio") ||
              (c.kind !== "audio" && clip.kind === "audio")) &&
              (c.id === `clip-audio-${clip.id}` ||
                clip.id === `clip-audio-${c.id}` ||
                Math.abs(c.position - clip.position) < 0.05)))
      );

      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      let nextSelection: string[];
      if (additive) {
        if (selection.has(clip.id)) {
          const toRemove = new Set([clip.id, ...(partner ? [partner.id] : [])]);
          nextSelection = selectedClipIds.filter((id) => !toRemove.has(id));
        } else {
          nextSelection = [
            ...selectedClipIds,
            clip.id,
            ...(partner && !selectedClipIds.includes(partner.id) ? [partner.id] : []),
          ];
        }
      } else {
        nextSelection = partner ? [clip.id, partner.id] : [clip.id];
      }
      onSelectionChange(nextSelection);

      const participants =
        mode === "move"
          ? nextSelection
              .map((id) => clipById.get(id))
              .filter((c): c is Clip => Boolean(c) && isDraggable(c!))
          : partner && isDraggable(partner)
            ? [clip, partner]
            : [clip];

      setDragState(
        beginDrag({
          mode: mode === "move" ? "move" : mode,
          pointerX: e.clientX,
          pointerY: e.clientY,
          timeSec: timeFromClientX(e.clientX),
          clip: {
            id: clip.id,
            layerId: clip.layerId,
            position: clip.position,
            start: clip.start,
            end: clip.end,
          },
          selection: participants.map((c) => ({
            id: c.id,
            layerId: c.layerId,
            position: c.position,
            start: c.start,
            end: c.end,
          })),
          snapEnabled: snapEnabled && !e.altKey,
        }),
      );
      runAutoScroll();
    },
    [
      api,
      clipById,
      onReject,
      onSelectionChange,
      runAutoScroll,
      selectedClipIds,
      selection,
      setDragState,
      snapEnabled,
      timeFromClientX,
      tool,
    ],
  );

  /** Lane ids whose rows intersect a vertical client-coordinate band, used by marquee select. */
  const lanesBetweenClientY = useCallback(
    (y1: number, y2: number): string[] => {
      const stack = laneStackRef.current;
      if (!stack) return [];
      const top = Math.min(y1, y2);
      const bottom = Math.max(y1, y2);
      return Array.from(stack.querySelectorAll<HTMLElement>("[data-lane-id]"))
        .filter((row) => {
          const rect = row.getBoundingClientRect();
          return rect.bottom >= top && rect.top <= bottom;
        })
        .map((row) => row.dataset.laneId ?? "")
        .filter(Boolean);
    },
    [],
  );

  /**
   * Open a gesture on empty timeline space: Shift-drag rubber-bands a selection, a plain press
   * scrubs the playhead the way the ruler does.
   */
  const handleSurfacePointerDown = useCallback(
    (e: React.PointerEvent, clearSelection = true) => {
      if (e.button !== 0) return;
      const at = timeFromClientX(e.clientX);

      if (e.shiftKey) {
        e.preventDefault();
        setDragState(
          beginDrag({
            mode: "marquee",
            pointerX: e.clientX,
            pointerY: e.clientY,
            timeSec: at,
            snapEnabled: false,
          }),
        );
        return;
      }

      // Scrubbing on the ruler keeps the current selection: only pressing empty lane space clears
      // it, which is what makes "select a clip, park the playhead in it, split" work.
      if (clearSelection) onSelectionChange([]);
      onSeekFrame(Math.round(at * fps));
      setDragState(
        beginDrag({
          mode: "scrub",
          pointerX: e.clientX,
          pointerY: e.clientY,
          timeSec: at,
          snapEnabled: snapEnabled && !e.altKey,
        }),
      );
    },
    [
      fps,
      onSeekFrame,
      onSelectionChange,
      setDragState,
      snapEnabled,
      timeFromClientX,
    ],
  );

  // Global pointer handling. The listeners are always attached rather than being wired up once a
  // drag starts: attaching them lazily leaves a window between pointerdown and the next render in
  // which a fast release would be missed and the gesture would stick. They no-op while idle.
  useEffect(() => {
    /** Advance the gesture with the latest pointer sample, applying snapping where relevant. */
    const onMove = (e: PointerEvent) => {
      const state = dragRef.current;
      if (state.mode === "idle") return;
      const timeSec = timeFromClientX(e.clientX);
      const snapActive = snapEnabled && !e.altKey;

      let snapped: { timeSec: number; target: SnapTarget | null } | null = null;
      if (snapActive) {
        if (state.mode === "move" && state.primaryClipId) {
          // calculateClipSnap works in clip-position space, which is exactly what the machine
          // stores as its candidate, so the result is passed straight through.
          const origin = state.originById[state.primaryClipId];
          const dur = origin ? origin.end - origin.start : 0;
          const raw = timeSec - state.grabOffsetSec;
          const res = calculateClipSnap(
            raw,
            dur,
            snapTargets,
            pxPerSec,
            state.snapTarget,
            SNAP_TOLERANCE_PX,
          );
          snapped = res.hasSnapped
            ? { timeSec: res.snappedTimeSec, target: res.activeSnap }
            : null;
        } else {
          const res = calculateStickySnap(
            timeSec,
            snapTargets,
            pxPerSec,
            state.snapTarget,
            SNAP_TOLERANCE_PX,
          );
          snapped = res.hasSnapped
            ? { timeSec: res.snappedTimeSec, target: res.activeSnap }
            : null;
        }
      }

      setDragState(
        updateDrag(state, {
          pointerX: e.clientX,
          pointerY: e.clientY,
          timeSec,
          layerId:
            state.mode === "move" ? laneFromClientY(e.clientY) : undefined,
          snapEnabled: snapActive,
          snapped,
        }),
      );

      if (dragRef.current.mode === "scrub") {
        onSeekFrame(Math.round(dragRef.current.candidateSec * fps));
      }
    };

    /** Close the gesture and commit exactly one transaction for it. */
    const onUp = () => {
      if (dragRef.current.mode === "idle") return;
      stopAutoScroll();
      const { next, commit } = endDrag(dragRef.current);
      setDragState(next);
      if (!commit || !commit.hasMoved) return;

      if (commit.mode === "scrub") return;

      if (commit.mode === "marquee") {
        const box = commit.marquee;
        if (!box) return;
        const fromSec = Math.min(
          timeFromClientX(box.x1),
          timeFromClientX(box.x2),
        );
        const toSec = Math.max(
          timeFromClientX(box.x1),
          timeFromClientX(box.x2),
        );
        const laneIds = new Set(lanesBetweenClientY(box.y1, box.y2));
        const picked = api.layered.clips
          .filter(
            (c) =>
              laneIds.has(c.layerId) &&
              isDraggable(c) &&
              c.position < toSec &&
              clipEndSec(c) > fromSec,
          )
          .map((c) => c.id);
        onSelectionChange(picked);
        return;
      }

      const primaryId = commit.primaryClipId;
      if (!primaryId) return;
      const origin = commit.originById[primaryId];
      if (!origin) return;

      if (commit.mode === "move") {
        const laneChanged =
          commit.targetLayerId && commit.targetLayerId !== commit.originLayerId;
        if (commit.clipIds.length > 1 && !laneChanged) {
          api.moveClips(commit.clipIds, commit.candidateSec - origin.position);
        } else {
          api.moveClip(
            primaryId,
            commit.candidateSec,
            commit.targetLayerId ?? undefined,
          );
        }
        return;
      }

      if (commit.mode === "trim-start") {
        api.trimClip(primaryId, "left", commit.candidateSec - origin.position, rippleEnabled);
        return;
      }

      if (commit.mode === "trim-end") {
        const originEnd = origin.position + (origin.end - origin.start);
        api.trimClip(primaryId, "right", commit.candidateSec - originEnd, rippleEnabled);
      }
    };

    /** Abandon the gesture and leave the film exactly as it was. */
    const onCancel = () => {
      if (dragRef.current.mode === "idle") return;
      stopAutoScroll();
      setDragState(cancelDrag(dragRef.current).next);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragRef.current.mode !== "idle") {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [
    api,
    drag.mode,
    fps,
    laneFromClientY,
    lanesBetweenClientY,
    onSelectionChange,
    onSeekFrame,
    pxPerSec,
    setDragState,
    snapEnabled,
    snapTargets,
    stopAutoScroll,
    timeFromClientX,
  ]);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  /** Zoom so the whole film fits the current viewport width. */
  const zoomToFit = useCallback(() => {
    const width = scrollRef.current?.clientWidth ?? 1200;
    const next = Math.max(
      MIN_PX_PER_SEC,
      Math.min(MAX_PX_PER_SEC, (width - 24) / Math.max(1, timelineSec)),
    );
    setPxPerSec(Number(next.toFixed(2)));
  }, [timelineSec]);

  /** Zoom by a multiplicative step, keeping the playhead roughly under the cursor. */
  const zoomBy = useCallback((factor: number) => {
    setPxPerSec((prev) =>
      Number(
        Math.max(
          MIN_PX_PER_SEC,
          Math.min(MAX_PX_PER_SEC, prev * factor),
        ).toFixed(2),
      ),
    );
  }, []);

  // Ctrl or Cmd plus wheel zooms rather than scrolling, which is the NLE convention.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    /** Intercept modifier-wheel to zoom the time axis instead of scrolling it. */
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  /**
   * Split the selected clip at the playhead. With nothing selected, split the topmost clip the
   * playhead is inside, so "park and cut" hits what the user is looking at rather than whatever
   * happens to come first in the document.
   */
  const splitAtPlayhead = useCallback(() => {
    const inside = (c: Clip | undefined): c is Clip =>
      Boolean(c) && isDraggable(c!) && playheadSec > c!.position && playheadSec < clipEndSec(c!);

    let target: Clip | undefined = selectedClipIds.map((id) => clipById.get(id)).find(inside);

    if (!target) {
      const zOf = (clip: Clip) => api.layered.layers.find((l) => l.id === clip.layerId)?.number ?? 0;
      target = api.layered.clips
        .filter(inside)
        .sort((a, b) => zOf(b) - zOf(a))[0];
    }

    if (!target) {
      onReject("Move the playhead inside a clip to split it.");
      return;
    }
    api.splitClip(target.id, playheadSec);
  }, [api, clipById, onReject, playheadSec, selectedClipIds]);

  /** Delete every selected clip as one undoable step. */
  const deleteSelection = useCallback(() => {
    if (selectedClipIds.length === 0) return;
    if (api.removeClips(selectedClipIds, rippleEnabled)) onSelectionChange([]);
  }, [api, onSelectionChange, rippleEnabled, selectedClipIds]);

  /** Nudge the playhead by whole frames. */
  const nudgePlayhead = useCallback(
    (frames: number) => {
      onSeekFrame(Math.max(0, Math.round(currentFrame + frames)));
    },
    [currentFrame, onSeekFrame],
  );

  // Timeline keyboard shortcuts. Typing in a field never triggers them.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        onRedo();
        return;
      }
      if (mod) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          onTogglePlay();
          break;
        case "s":
          e.preventDefault();
          splitAtPlayhead();
          break;
        case "v":
          setTool("select");
          break;
        case "c":
          setTool("razor");
          break;
        case "n":
          setSnapEnabled((prev) => !prev);
          break;
        case "r":
        case "R":
          e.preventDefault();
          setRippleEnabled((prev) => !prev);
          break;
        case "Delete":
        case "Backspace":
          if (selectedClipIds.length > 0) {
            e.preventDefault();
            deleteSelection();
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          nudgePlayhead(e.shiftKey ? -fps : -1);
          break;
        case "ArrowRight":
          e.preventDefault();
          nudgePlayhead(e.shiftKey ? fps : 1);
          break;
        case "Home":
          e.preventDefault();
          onSeekFrame(0);
          break;
        case "End":
          e.preventDefault();
          onSeekFrame(Math.round(api.contentEndSec * fps));
          break;
        case "=":
        case "+":
          zoomBy(1.2);
          break;
        case "-":
          zoomBy(1 / 1.2);
          break;
        case "f":
          zoomToFit();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    api.contentEndSec,
    deleteSelection,
    fps,
    nudgePlayhead,
    onRedo,
    onSeekFrame,
    onTogglePlay,
    onUndo,
    selectedClipIds.length,
    splitAtPlayhead,
    zoomBy,
    zoomToFit,
  ]);

  /** Accept a media asset dropped from the asset bin onto a specific lane at a specific time. */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDropHintSec(null);
      setDropHintLaneId(null);
      try {
        const raw = e.dataTransfer.getData("application/json");
        if (!raw) return;
        const asset = JSON.parse(raw) as {
          filename?: string;
          src?: string;
          type?: "video" | "audio" | "image";
          duration?: number;
          width?: number;
          height?: number;
        };
        if (!asset.src || !asset.type) return;
        const at = timeFromClientX(e.clientX);
        const laneId = laneFromClientY(e.clientY) ?? undefined;
        api.importAsset(
          {
            filename: asset.filename ?? "asset",
            src: asset.src,
            type: asset.type,
            duration: asset.duration && asset.duration > 0 ? asset.duration : 5,
            width: asset.width,
            height: asset.height,
          },
          at,
          laneId,
        );
      } catch (err) {
        onReject(
          `Could not add that asset: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    [api, laneFromClientY, onReject, timeFromClientX],
  );

  const visibleFromSec = viewport.left / pxPerSec - 2;
  const visibleToSec = (viewport.left + viewport.width) / pxPerSec + 2;

  const dragGhost = useMemo(() => {
    if (drag.mode !== "move" || !drag.hasMoved || !drag.primaryClipId)
      return null;
    const clip = clipById.get(drag.primaryClipId);
    if (!clip) return null;
    return {
      clip,
      laneId: drag.targetLayerId ?? clip.layerId,
      positionSec: drag.candidateSec,
    };
  }, [clipById, drag]);

  const trimPreview = useMemo(() => {
    if (
      (drag.mode !== "trim-start" && drag.mode !== "trim-end") ||
      !drag.hasMoved ||
      !drag.primaryClipId
    )
      return null;
    const origin = drag.originById[drag.primaryClipId];
    if (!origin) return null;
    const originDur = origin.end - origin.start;
    if (drag.mode === "trim-start") {
      const start = Math.min(
        drag.candidateSec,
        origin.position + originDur - 0.05,
      );
      return {
        laneId: origin.layerId,
        startSec: Math.max(0, start),
        endSec: origin.position + originDur,
      };
    }
    const end = Math.max(drag.candidateSec, origin.position + 0.05);
    return { laneId: origin.layerId, startSec: origin.position, endSec: end };
  }, [drag]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-sunken">
      <Toolbar seam="bottom" className="gap-x-2 gap-y-1.5">
        <ToolbarGroup>
          <Button
            tone={isPlaying ? "warn" : "success"}
            size="sm"
            iconOnly
            onClick={onTogglePlay}
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <Button
            tone="ghost"
            size="sm"
            iconOnly
            onClick={() => onSeekFrame(0)}
            title="Go to start (Home)"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </Button>
          <Button
            tone="ghost"
            size="sm"
            iconOnly
            onClick={() => onSeekFrame(Math.round(api.contentEndSec * fps))}
            title="Go to end (End)"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </Button>
          <div className="flex items-baseline gap-1 border-2 border-ink bg-paper-3 px-2 py-1 font-mono text-[11px] font-bold tabular-nums text-ink shadow-nb-sm">
            <span>{formatFrameTimecode(playheadSec, fps)}</span>
            <span className="text-ink-mute">/</span>
            <span className="text-ink-soft">
              {formatFrameTimecode(timelineSec - RUNWAY_SEC, fps)}
            </span>
          </div>
        </ToolbarGroup>

        <ToolbarDivider />

        <ToolbarGroup>
          <ToolbarLabel>Tool</ToolbarLabel>
          <Button
            size="sm"
            tone={tool === "select" ? "select" : "default"}
            active={tool === "select"}
            onClick={() => setTool("select")}
            title="Select and move clips (V)"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Select
          </Button>
          <Button
            size="sm"
            tone={tool === "razor" ? "select" : "default"}
            active={tool === "razor"}
            onClick={() => setTool("razor")}
            title="Razor: click a clip to cut it there (C)"
          >
            <Scissors className="h-3.5 w-3.5" />
            Razor
          </Button>
          <Button
            size="sm"
            tone={snapEnabled ? "primary" : "default"}
            active={snapEnabled}
            onClick={() => setSnapEnabled((p) => !p)}
            title="Snap to clip edges, the playhead and the grid (N, hold Alt to bypass)"
          >
            <Magnet className="h-3.5 w-3.5" />
            Snap
          </Button>
          <Button
            size="sm"
            tone={rippleEnabled ? "primary" : "default"}
            active={rippleEnabled}
            onClick={() => setRippleEnabled((p) => !p)}
            title="Ripple mode: auto-close gaps when trimming or deleting clips (R)"
          >
            <ChevronsLeftRight className="h-3.5 w-3.5" />
            Ripple
          </Button>
        </ToolbarGroup>

        <ToolbarDivider />

        <ToolbarGroup>
          <Button
            size="sm"
            onClick={splitAtPlayhead}
            title="Split the clip under the playhead (S)"
          >
            <Scissors className="h-3.5 w-3.5" />
            Split
          </Button>
          <Button
            size="sm"
            tone="danger"
            disabled={selectedClipIds.length === 0}
            onClick={deleteSelection}
            title="Delete the selected clip (Backspace)"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            disabled={!primarySelected?.linkedClipId}
            onClick={() =>
              primarySelected && api.unlinkClip(primarySelected.id)
            }
            title="Unlink this video and audio pair so they move independently"
          >
            <Unlink className="h-3.5 w-3.5" />
          </Button>
        </ToolbarGroup>

        <ToolbarDivider />

        <ToolbarGroup>
          <Button
            size="sm"
            iconOnly
            disabled={!canUndo}
            onClick={onUndo}
            title="Undo (Cmd+Z)"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            iconOnly
            disabled={!canRedo}
            onClick={onRedo}
            title="Redo (Cmd+Shift+Z)"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </ToolbarGroup>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            onClick={() => api.addLane(`Lane ${api.lanes.length + 1}`)}
            title="Add a new timeline lane"
          >
            <Plus className="h-3.5 w-3.5" />
            Lane
          </Button>
          <ToolbarDivider />
          <Button
            size="sm"
            iconOnly
            onClick={() => zoomBy(1 / 1.25)}
            title="Zoom out (-)"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            iconOnly
            onClick={() => zoomBy(1.25)}
            title="Zoom in (+)"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            iconOnly
            onClick={zoomToFit}
            title="Fit the whole film (F)"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Badge tone="quiet" className="font-mono" title="Timeline zoom">
            {pxPerSec.toFixed(0)} px/s
          </Badge>
        </div>
      </Toolbar>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Lane headers, scrolled vertically in lockstep with the lane stack. */}
        <div
          className="relative shrink-0 overflow-hidden border-r-2 border-ink bg-paper"
          style={{ width: HEADER_WIDTH_PX }}
        >
          <div className="flex h-[26px] items-center gap-1.5 border-b-2 border-ink bg-sunken-2 px-2">
            <Layers className="h-3 w-3 text-ink-soft" />
            <span className="font-sans text-[9px] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
              Lanes
            </span>
          </div>
          <div style={{ transform: `translateY(${-scrollTop}px)` }}>
            {api.lanes.map((lane, idx) => (
              <LaneHeader
                key={lane.id}
                layer={lane}
                height={lane.height}
                clipCount={api.clipsByLayer.get(lane.id)?.length ?? 0}
                selected={selectedLaneId === lane.id}
                isDropTarget={
                  drag.mode === "move" &&
                  drag.hasMoved &&
                  drag.targetLayerId === lane.id
                }
                canMoveUp={idx > 0}
                canMoveDown={idx < api.lanes.length - 1}
                canDelete={api.lanes.length > 1}
                onSelect={() => setSelectedLaneId(lane.id)}
                onRename={(label) => api.renameLane(lane.id, label)}
                onToggle={(patch) => api.setLaneFlag(lane.id, patch)}
                onShift={(direction) => api.shiftLane(lane.id, direction)}
                onDelete={() => api.removeLane(lane.id)}
              />
            ))}
          </div>
        </div>

        {/* Scrolling lane stack. */}
        <div
          ref={scrollRef}
          className={cn(
            "relative min-w-0 flex-1 overflow-auto bg-sunken",
            tool === "razor" && "cursor-crosshair",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDropHintSec(timeFromClientX(e.clientX));
            setDropHintLaneId(laneFromClientY(e.clientY));
          }}
          onDragLeave={() => {
            setDropHintSec(null);
            setDropHintLaneId(null);
          }}
          onDrop={handleDrop}
        >
          <div className="relative" style={{ width: contentWidth }}>
            <div
              className="sticky top-0 z-30 cursor-ew-resize"
              onPointerDown={(e) => handleSurfacePointerDown(e, false)}
              title="Drag to scrub the playhead"
            >
              <TimelineRuler
                durationSec={timelineSec}
                pxPerSec={pxPerSec}
                widthPx={contentWidth}
              />
            </div>

            <div ref={laneStackRef} className="relative">
              {api.lanes.map((lane) => {
                const clips = api.clipsByLayer.get(lane.id) ?? [];
                const isDropTarget =
                  drag.mode === "move" &&
                  drag.hasMoved &&
                  drag.targetLayerId === lane.id;
                return (
                  <div
                    key={lane.id}
                    data-lane-id={lane.id}
                    style={{ height: lane.height }}
                    onPointerDown={handleSurfacePointerDown}
                    className={cn(
                      "relative border-b-2 border-ink",
                      lane.hidden ? "nb-hatch bg-sunken-3" : "bg-sunken",
                      lane.locked && "nb-hatch",
                      isDropTarget && "bg-primary/25",
                      dropHintLaneId === lane.id && "bg-primary/25",
                    )}
                  >
                    {clips.map((clip) => {
                      const dur = clipDuration(clip);
                      if (
                        clip.position > visibleToSec ||
                        clip.position + dur < visibleFromSec
                      )
                        return null;
                      const isBeingDragged =
                        drag.hasMoved && drag.clipIds.includes(clip.id);
                      return (
                        <ClipBody
                          key={clip.id}
                          clip={clip}
                          label={clipLabel(clip)}
                          pxPerSec={pxPerSec}
                          laneHeight={lane.height}
                          positionSec={clip.position}
                          durationSec={dur}
                          selected={selection.has(clip.id)}
                          locked={lane.locked || !isDraggable(clip)}
                          muted={lane.muted}
                          dimmed={isBeingDragged}
                          waveformSrc={waveformSourceFor(clip)}
                          onPointerDown={handleClipPointerDown}
                          onDoubleClick={(c) =>
                            onSeekFrame(Math.round(c.position * fps))
                          }
                        />
                      );
                    })}

                    {/* Drag ghost showing exactly where the clip will land. */}
                    {dragGhost && dragGhost.laneId === lane.id ? (
                      <ClipBody
                        clip={dragGhost.clip}
                        label={clipLabel(dragGhost.clip)}
                        pxPerSec={pxPerSec}
                        laneHeight={lane.height}
                        positionSec={dragGhost.positionSec}
                        durationSec={clipDuration(dragGhost.clip)}
                        selected
                        locked={false}
                        muted={false}
                        ghost
                      />
                    ) : null}

                    {/* Trim preview showing the candidate in or out point. */}
                    {trimPreview && trimPreview.laneId === lane.id ? (
                      <div
                        className="pointer-events-none absolute top-1 z-40 border-2 border-dashed border-select bg-select/20"
                        style={{
                          left: trimPreview.startSec * pxPerSec,
                          width: Math.max(
                            2,
                            (trimPreview.endSec - trimPreview.startSec) *
                              pxPerSec,
                          ),
                          height: Math.max(18, lane.height - 8),
                        }}
                      />
                    ) : null}

                    {clips.length === 0 ? (
                      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-sans text-[10px] font-bold uppercase tracking-[0.08em] text-ink-mute">
                        Drop media here
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Snap guide naming exactly what the drag is locking on to. */}
            {drag.snapTarget ? (
              <div
                className="pointer-events-none absolute inset-y-0 z-40 w-0.5 bg-select"
                style={{ left: drag.snapTarget.timeSec * pxPerSec }}
              >
                <span className="absolute top-7 left-1 whitespace-nowrap border-2 border-ink bg-select px-1 py-0.5 font-mono text-[9px] font-bold text-select-ink shadow-nb-sm">
                  {drag.snapTarget.label ?? drag.snapTarget.type}
                </span>
              </div>
            ) : null}

            {/* Asset drop indicator. */}
            {dropHintSec !== null ? (
              <div
                className="pointer-events-none absolute inset-y-0 z-40 w-0.5 bg-warn"
                style={{ left: dropHintSec * pxPerSec }}
              />
            ) : null}

            {/* Playhead. */}
            <div
              className="pointer-events-none absolute inset-y-0 z-50 w-0.5 bg-ink"
              style={{ left: playheadSec * pxPerSec }}
            >
              <div className="absolute -left-[7px] top-0 h-3 w-4 border-2 border-ink bg-danger shadow-nb-sm" />
            </div>

            {/* Rubber-band selection rectangle, drawn in client space over the whole app. */}
            {drag.mode === "marquee" && drag.marquee && drag.hasMoved ? (
              <div
                className="pointer-events-none fixed z-[60] border-2 border-dashed border-select bg-select/15"
                style={{
                  left: Math.min(drag.marquee.x1, drag.marquee.x2),
                  top: Math.min(drag.marquee.y1, drag.marquee.y2),
                  width: Math.abs(drag.marquee.x2 - drag.marquee.x1),
                  height: Math.abs(drag.marquee.y2 - drag.marquee.y1),
                }}
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t-2 border-ink bg-paper px-2.5 py-1.5">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink-soft">
          <span>
            <span className="font-bold text-ink">
              {api.layered.clips.length}
            </span>{" "}
            clips on{" "}
            <span className="font-bold text-ink">{api.lanes.length}</span> lanes
          </span>
          {selectedClipIds.length > 0 ? (
            <Badge tone="select">{selectedClipIds.length} selected</Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-ink-mute">
          <span className="inline-flex items-center gap-1">
            <KeyHint keys={["Space"]} /> play
          </span>
          <span className="inline-flex items-center gap-1">
            <KeyHint keys={["S"]} /> split
          </span>
          <span className="inline-flex items-center gap-1">
            <KeyHint keys={["Alt"]} /> bypass snap
          </span>
          <span className="inline-flex items-center gap-1">
            <KeyHint keys={["Esc"]} /> cancel drag
          </span>
        </div>
      </div>
    </div>
  );
};
