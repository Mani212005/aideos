/**
 * File Description: Explicit Drag State Machine for Aideos Timeline.
 * Implements Pattern 4 (OpenShot / Premiere state architecture):
 * - Disjoint lifecycle states (idle, drag-clip, resize-left, resize-right, playhead-scrub, box-select, vo-trim).
 * - Enforces clean entry/exit transitions preventing half-finished drags or stuck cursor states.
 */

export type TimelineDragMode =
  | "idle"
  | "drag-clip"
  | "resize-left"
  | "resize-right"
  | "playhead-scrub"
  | "box-select"
  | "vo-trim";

export interface DragContext {
  mode: TimelineDragMode;
  shotIndex?: number;
  startX: number;
  startY?: number;
  initialPositionSec?: number;
  initialInSec?: number;
  initialOutSec?: number;
  initialDur?: number;
  currentDeltaPx: number;
  currentDeltaSec: number;
  edge?: "left" | "right";
  selectedShotIds?: string[];
}

export class TimelineDragStateMachine {
  private currentContext: DragContext = {
    mode: "idle",
    startX: 0,
    currentDeltaPx: 0,
    currentDeltaSec: 0,
  };

  private listeners: Array<(context: DragContext) => void> = [];

  getState(): DragContext {
    return { ...this.currentContext };
  }

  isIdle(): boolean {
    return this.currentContext.mode === "idle";
  }

  subscribe(listener: (context: DragContext) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    const ctx = this.getState();
    this.listeners.forEach((l) => l(ctx));
  }

  startDragClip(
    shotIndex: number,
    clientX: number,
    initialPositionSec: number,
    selectedShotIds: string[] = []
  ): void {
    this.currentContext = {
      mode: "drag-clip",
      shotIndex,
      startX: clientX,
      initialPositionSec,
      currentDeltaPx: 0,
      currentDeltaSec: 0,
      selectedShotIds,
    };
    this.notify();
  }

  startResize(
    shotIndex: number,
    edge: "left" | "right",
    clientX: number,
    initialInSec: number,
    initialOutSec: number,
    initialDur: number,
    initialPositionSec: number
  ): void {
    this.currentContext = {
      mode: edge === "left" ? "resize-left" : "resize-right",
      shotIndex,
      edge,
      startX: clientX,
      initialInSec,
      initialOutSec,
      initialDur,
      initialPositionSec,
      currentDeltaPx: 0,
      currentDeltaSec: 0,
    };
    this.notify();
  }

  startPlayheadScrub(clientX: number): void {
    this.currentContext = {
      mode: "playhead-scrub",
      startX: clientX,
      currentDeltaPx: 0,
      currentDeltaSec: 0,
    };
    this.notify();
  }

  startVoTrim(edge: "left" | "right", clientX: number, initialInSec: number, initialDur: number): void {
    this.currentContext = {
      mode: "vo-trim",
      edge,
      startX: clientX,
      initialInSec,
      initialDur,
      currentDeltaPx: 0,
      currentDeltaSec: 0,
    };
    this.notify();
  }

  updateDelta(clientX: number, zoomLevel: number): void {
    if (this.currentContext.mode === "idle") return;
    const deltaPx = clientX - this.currentContext.startX;
    this.currentContext.currentDeltaPx = deltaPx;
    this.currentContext.currentDeltaSec = deltaPx / zoomLevel;
    this.notify();
  }

  reset(): DragContext {
    const previous = { ...this.currentContext };
    this.currentContext = {
      mode: "idle",
      startX: 0,
      currentDeltaPx: 0,
      currentDeltaSec: 0,
    };
    this.notify();
    return previous;
  }
}
