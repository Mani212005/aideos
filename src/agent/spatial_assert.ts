/**
 * File Description: Deterministic spatial assertion validator module.
 * Takes element bounding box keyframes (x, y, width, height, timestamp) and computes
 * bounding box overlaps, viewport canvas overflows, and element collisions without visual model calls.
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  timestamp?: number;
  frame?: number;
}

export interface ElementKeyframe {
  elementId: string;
  zIndex?: number;
  bounds: BoundingBox;
}

export interface FrameSnapshot {
  frame: number;
  timestamp: number;
  elements: ElementKeyframe[];
}

export interface ViewportConfig {
  width: number;
  height: number;
  safeZoneMargin?: number;
}

export type SpatialViolationType =
  | "OVERLAP"
  | "CANVAS_OVERFLOW"
  | "COLLISION"
  | "OUT_OF_SAFE_ZONE";

export interface SpatialViolation {
  type: SpatialViolationType;
  frame: number;
  timestamp: number;
  elementIds: string[];
  severity: "CRITICAL" | "WARNING";
  description: string;
}

export interface SpatialAssertResult {
  passed: boolean;
  totalFramesChecked: number;
  violations: SpatialViolation[];
}

// Checks if two 2D bounding boxes overlap on the canvas.
export function checkRectOverlap(boxA: BoundingBox, boxB: BoundingBox): boolean {
  const aLeft = boxA.x;
  const aRight = boxA.x + boxA.width;
  const aTop = boxA.y;
  const aBottom = boxA.y + boxA.height;

  const bLeft = boxB.x;
  const bRight = boxB.x + boxB.width;
  const bTop = boxB.y;
  const bBottom = boxB.y + boxB.height;

  return !(aRight <= bLeft || aLeft >= bRight || aBottom <= bTop || aTop >= bBottom);
}

// Checks if a bounding box exceeds the viewport boundaries or safe zone.
export function checkCanvasOverflow(
  box: BoundingBox,
  viewport: ViewportConfig
): { overflow: boolean; outOfSafeZone: boolean } {
  const margin = viewport.safeZoneMargin ?? 20;

  const overflow =
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.width > viewport.width ||
    box.y + box.height > viewport.height;

  const outOfSafeZone =
    box.x < margin ||
    box.y < margin ||
    box.x + box.width > viewport.width - margin ||
    box.y + box.height > viewport.height - margin;

  return { overflow, outOfSafeZone };
}

// Validates bounding boxes, collisions, and overflows for a single frame snapshot.
export function validateFrameSpatialAssertions(
  snapshot: FrameSnapshot,
  viewport: ViewportConfig
): SpatialViolation[] {
  const violations: SpatialViolation[] = [];
  const { frame, timestamp, elements } = snapshot;

  for (const elem of elements) {
    const { overflow, outOfSafeZone } = checkCanvasOverflow(elem.bounds, viewport);

    if (overflow) {
      violations.push({
        type: "CANVAS_OVERFLOW",
        frame,
        timestamp,
        elementIds: [elem.elementId],
        severity: "CRITICAL",
        description: `Element ${elem.elementId} overflows viewport boundaries (${elem.bounds.x}, ${elem.bounds.y}, ${elem.bounds.width}, ${elem.bounds.height}).`,
      });
    } else if (outOfSafeZone) {
      violations.push({
        type: "OUT_OF_SAFE_ZONE",
        frame,
        timestamp,
        elementIds: [elem.elementId],
        severity: "WARNING",
        description: `Element ${elem.elementId} breaches safe zone margin (${viewport.safeZoneMargin ?? 20}px).`,
      });
    }
  }

  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const elemA = elements[i];
      const elemB = elements[j];

      if ((elemA.zIndex ?? 0) === (elemB.zIndex ?? 0)) {
        if (checkRectOverlap(elemA.bounds, elemB.bounds)) {
          violations.push({
            type: "OVERLAP",
            frame,
            timestamp,
            elementIds: [elemA.elementId, elemB.elementId],
            severity: "CRITICAL",
            description: `Element ${elemA.elementId} overlaps with element ${elemB.elementId} at zIndex ${elemA.zIndex ?? 0}.`,
          });
        }
      }
    }
  }

  return violations;
}

// Runs deterministic spatial math assertions across all continuous keyframe snapshots.
export function runSpatialAssertions(
  snapshots: FrameSnapshot[],
  viewport?: ViewportConfig
): SpatialAssertResult {
  const activeViewport: ViewportConfig = viewport ?? {
    width: 1920,
    height: 1080,
    safeZoneMargin: 20,
  };

  const allViolations: SpatialViolation[] = [];

  for (const snapshot of snapshots) {
    const frameViolations = validateFrameSpatialAssertions(snapshot, activeViewport);
    allViolations.push(...frameViolations);
  }

  const criticalCount = allViolations.filter((v) => v.severity === "CRITICAL").length;

  return {
    passed: criticalCount === 0,
    totalFramesChecked: snapshots.length,
    violations: allViolations,
  };
}
