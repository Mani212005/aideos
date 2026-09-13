/**
 * File Description: Pure pointer-drag state machine for the Aideos timeline.
 * Owns every transition a timeline gesture can make (grab, move, trim either edge, scrub the
 * playhead, marquee select, cancel, drop) without touching the DOM, so the transitions can be
 * regression tested directly. The editor drives it from pointer events and reads the resulting
 * candidate geometry to draw the drag ghost, the target lane and the active snap guide.
 *
 * Invariants the machine guarantees:
 * - A gesture only becomes "moved" once the pointer passes the drag threshold, so a click that
 *   wobbles by a pixel selects rather than nudges.
 * - Cancelling always returns the exact origin geometry, so Escape restores prior state.
 * - Ending or cancelling always lands back on IDLE, so an interrupted gesture can never stick.
 */

import type { SnapTarget } from "./snap";

/** Pointer travel in screen pixels before a press is treated as a drag rather than a click. */
export const DRAG_THRESHOLD_PX = 3;

export type DragMode = "idle" | "move" | "trim-start" | "trim-end" | "scrub" | "marquee";

export interface DragClipGeometry {
  id: string;
  layerId: string;
  position: number;
  start: number;
  end: number;
}

export interface DragState {
  mode: DragMode;
  /** Screen coordinates of the press that opened the gesture. */
  startX: number;
  startY: number;
  /** Latest pointer screen coordinates. */
  pointerX: number;
  pointerY: number;
  /** Timeline time under the pointer when the gesture opened. */
  originTimeSec: number;
  /** Latest timeline time under the pointer. */
  pointerTimeSec: number;
  /** Distance from the primary clip's position to the pointer at grab time. */
  grabOffsetSec: number;
  primaryClipId: string | null;
  /** Every clip travelling with this gesture, primary first. */
  clipIds: string[];
  /** Geometry each participating clip had when the gesture opened. */
  originById: Record<string, DragClipGeometry>;
  originLayerId: string | null;
  /** Lane the pointer is currently over, which a move gesture would drop onto. */
  targetLayerId: string | null;
  /** Proposed timeline position for the primary clip, or the proposed edge time when trimming. */
  candidateSec: number;
  /** Signed seconds the gesture has travelled after snapping. */
  deltaSec: number;
  snapEnabled: boolean;
  snapTarget: SnapTarget | null;
  /** True once the pointer passed DRAG_THRESHOLD_PX. */
  hasMoved: boolean;
  /** Marquee rectangle in screen coordinates, only meaningful in marquee mode. */
  marquee: { x1: number; y1: number; x2: number; y2: number } | null;
}

export const IDLE_DRAG: DragState = {
  mode: "idle",
  startX: 0,
  startY: 0,
  pointerX: 0,
  pointerY: 0,
  originTimeSec: 0,
  pointerTimeSec: 0,
  grabOffsetSec: 0,
  primaryClipId: null,
  clipIds: [],
  originById: {},
  originLayerId: null,
  targetLayerId: null,
  candidateSec: 0,
  deltaSec: 0,
  snapEnabled: true,
  snapTarget: null,
  hasMoved: false,
  marquee: null,
};

export interface BeginDragInput {
  mode: Exclude<DragMode, "idle">;
  pointerX: number;
  pointerY: number;
  /** Timeline time under the pointer at press. */
  timeSec: number;
  /** The clip being grabbed, for move and trim gestures. */
  clip?: DragClipGeometry;
  /** Every clip that should travel with the gesture, including the primary one. */
  selection?: DragClipGeometry[];
  snapEnabled?: boolean;
}

/** Open a gesture, recording the origin geometry every later transition is measured against. */
export function beginDrag(input: BeginDragInput): DragState {
  const participants = input.selection?.length
    ? input.selection
    : input.clip
      ? [input.clip]
      : [];

  const originById: Record<string, DragClipGeometry> = {};
  for (const clip of participants) {
    originById[clip.id] = { ...clip };
  }

  const primary = input.clip ?? participants[0] ?? null;

  return {
    ...IDLE_DRAG,
    mode: input.mode,
    startX: input.pointerX,
    startY: input.pointerY,
    pointerX: input.pointerX,
    pointerY: input.pointerY,
    originTimeSec: input.timeSec,
    pointerTimeSec: input.timeSec,
    grabOffsetSec: primary ? input.timeSec - primary.position : 0,
    primaryClipId: primary?.id ?? null,
    clipIds: participants.map((c) => c.id),
    originById,
    originLayerId: primary?.layerId ?? null,
    targetLayerId: primary?.layerId ?? null,
    candidateSec:
      input.mode === "trim-end" && primary
        ? primary.position + (primary.end - primary.start)
        : (primary?.position ?? input.timeSec),
    deltaSec: 0,
    snapEnabled: input.snapEnabled ?? true,
    snapTarget: null,
    hasMoved: false,
    marquee: input.mode === "marquee" ? { x1: input.pointerX, y1: input.pointerY, x2: input.pointerX, y2: input.pointerY } : null,
  };
}

export interface UpdateDragInput {
  pointerX: number;
  pointerY: number;
  /** Timeline time under the pointer now. */
  timeSec: number;
  /** Lane the pointer is over now, when the surface can resolve one. */
  layerId?: string | null;
  /** False while the snap-bypass modifier is held. */
  snapEnabled?: boolean;
  /**
   * Result of running the snap engine over this frame's raw candidate. When omitted the raw
   * candidate is used, which is what happens while the bypass modifier is held.
   */
  snapped?: { timeSec: number; target: SnapTarget | null } | null;
}

/** Advance an open gesture with the latest pointer sample. */
export function updateDrag(state: DragState, input: UpdateDragInput): DragState {
  if (state.mode === "idle") return state;

  const travelledPx = Math.hypot(input.pointerX - state.startX, input.pointerY - state.startY);
  const hasMoved = state.hasMoved || travelledPx >= DRAG_THRESHOLD_PX;
  const snapEnabled = input.snapEnabled ?? state.snapEnabled;

  if (state.mode === "marquee") {
    return {
      ...state,
      pointerX: input.pointerX,
      pointerY: input.pointerY,
      pointerTimeSec: input.timeSec,
      hasMoved,
      snapEnabled,
      marquee: { x1: state.startX, y1: state.startY, x2: input.pointerX, y2: input.pointerY },
    };
  }

  if (state.mode === "scrub") {
    const candidate = input.snapped?.timeSec ?? input.timeSec;
    return {
      ...state,
      pointerX: input.pointerX,
      pointerY: input.pointerY,
      pointerTimeSec: input.timeSec,
      candidateSec: Math.max(0, candidate),
      snapTarget: input.snapped?.target ?? null,
      snapEnabled,
      hasMoved,
    };
  }

  const origin = state.primaryClipId ? state.originById[state.primaryClipId] : undefined;
  const rawCandidate =
    state.mode === "move"
      ? input.timeSec - state.grabOffsetSec
      : input.timeSec;

  const candidate = Math.max(0, input.snapped?.timeSec ?? rawCandidate);
  const reference =
    state.mode === "move"
      ? (origin?.position ?? 0)
      : state.mode === "trim-end"
        ? (origin ? origin.position + (origin.end - origin.start) : 0)
        : (origin?.position ?? 0);

  return {
    ...state,
    pointerX: input.pointerX,
    pointerY: input.pointerY,
    pointerTimeSec: input.timeSec,
    targetLayerId: state.mode === "move" ? (input.layerId ?? state.targetLayerId) : state.targetLayerId,
    candidateSec: candidate,
    deltaSec: Number((candidate - reference).toFixed(4)),
    snapTarget: input.snapped?.target ?? null,
    snapEnabled,
    hasMoved,
  };
}

/** Abandon a gesture. The caller re-reads originById to restore the exact prior geometry. */
export function cancelDrag(state: DragState): { next: DragState; restored: DragClipGeometry[] } {
  return {
    next: IDLE_DRAG,
    restored: Object.values(state.originById).map((g) => ({ ...g })),
  };
}

export interface DragCommit {
  mode: Exclude<DragMode, "idle">;
  primaryClipId: string | null;
  clipIds: string[];
  /** Geometry each participating clip had when the gesture opened. */
  originById: Record<string, DragClipGeometry>;
  /** Proposed position for a move, or the proposed edge time for a trim. */
  candidateSec: number;
  /** Signed change in seconds the gesture produced. */
  deltaSec: number;
  /** Lane a move gesture should drop onto, when it differs from the origin lane. */
  targetLayerId: string | null;
  originLayerId: string | null;
  /** False when the gesture never passed the drag threshold, so it should select rather than edit. */
  hasMoved: boolean;
  marquee: DragState["marquee"];
}

/** Close a gesture and hand back everything the caller needs to commit exactly one transaction. */
export function endDrag(state: DragState): { next: DragState; commit: DragCommit | null } {
  if (state.mode === "idle") return { next: IDLE_DRAG, commit: null };

  return {
    next: IDLE_DRAG,
    commit: {
      mode: state.mode,
      primaryClipId: state.primaryClipId,
      clipIds: state.clipIds,
      originById: state.originById,
      candidateSec: state.candidateSec,
      deltaSec: state.deltaSec,
      targetLayerId: state.targetLayerId,
      originLayerId: state.originLayerId,
      hasMoved: state.hasMoved,
      marquee: state.marquee,
    },
  };
}

/**
 * Horizontal auto-scroll speed in pixels per frame while a drag sits near a viewport edge.
 * Returns 0 in the comfortable middle so the timeline only creeps when the user asks it to.
 */
export function autoScrollVelocity(
  pointerX: number,
  viewportLeft: number,
  viewportRight: number,
  edgePx = 48,
  maxSpeedPx = 22,
): number {
  if (pointerX < viewportLeft + edgePx) {
    const depth = Math.min(edgePx, viewportLeft + edgePx - pointerX);
    return -Math.round((depth / edgePx) * maxSpeedPx);
  }
  if (pointerX > viewportRight - edgePx) {
    const depth = Math.min(edgePx, pointerX - (viewportRight - edgePx));
    return Math.round((depth / edgePx) * maxSpeedPx);
  }
  return 0;
}
