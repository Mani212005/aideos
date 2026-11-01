/**
 * File Description: Pure screen-space snap, guide and safe-area math for dragging the caption card in the Edit preview.
 * Inputs and outputs: start placement, pointer deltas, preview scale and card height -> clamped placement, active snap guides, limit hits and safe-area rectangles.
 * Used by: CaptionObject.
 */
import type { CaptionPlacement } from "../../../../src/dl/schema";
import {
  CAPTION_FRAMES,
  DEFAULT_CAPTION_PLACEMENT,
  DEFAULT_CAPTION_PLACEMENT_WIDTH,
  REEL_ACTION_ZONE,
  captionBounds,
  captionCardHeight,
  clampCaptionPlacement,
  dragCaption,
  type CaptionFormat,
} from "../../../../src/dl/captionPlacement";
import { getFrameMargins } from "../../../../src/dl/fullScreenHeroLayout";

/** Screen pixels within which a dragged caption snaps to a guide, so snapping feels the same at any preview size. */
export const SNAP_DISTANCE_PX = 6;
/** Screen pixels a pointer must travel before a press becomes a drag, so a click with hand jitter never moves the caption. */
export const DRAG_SLOP_PX = 4;

export interface SnapGuide {
  axis: "x" | "y";
  /** Placement value the box snaps to (x is the box centre, y is the box top), normalized 0 to 1. */
  value: number;
  /** Position of the drawn line along its axis, normalized 0 to 1. */
  line: number;
  label: string;
}
export interface MoveLimits {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}
export interface DragGuideResult {
  placement: CaptionPlacement;
  guides: SnapGuide[];
  limits: MoveLimits;
}
export interface SafeAreaRect {
  id: string;
  kind: "margin" | "zone";
  label?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Returns the placement bounds exactly as dragCaption computes them for this placement.
function boundsFor(format: CaptionFormat, placement: CaptionPlacement) {
  const { width, height } = CAPTION_FRAMES[format];
  return captionBounds(
    format,
    width,
    height,
    placement.w ?? DEFAULT_CAPTION_PLACEMENT_WIDTH,
    placement.y,
    placement.w === undefined ? 0 : undefined,
  );
}
// Lists the vertical snap targets: the default position, the frame middle and the top safe line.
export function verticalSnapTargets(
  format: CaptionFormat,
  placement: CaptionPlacement,
  cardHeight = captionCardHeight(CAPTION_FRAMES[format].width, CAPTION_FRAMES[format].height),
): SnapGuide[] {
  const { height } = CAPTION_FRAMES[format];
  const bounds = boundsFor(format, placement);
  const middle = (height - cardHeight) / 2 / height;
  const targets: SnapGuide[] = [
    { axis: "y", value: DEFAULT_CAPTION_PLACEMENT.y, line: DEFAULT_CAPTION_PLACEMENT.y, label: "Default" },
    { axis: "y", value: middle, line: 0.5, label: "Middle" },
    { axis: "y", value: bounds.minY, line: bounds.minY, label: "Top" },
  ];
  return targets.filter((target) => target.value >= bounds.minY - 1e-9 && target.value <= bounds.maxY + 1e-9);
}
// Lists the horizontal snap target: frame centre when reachable, otherwise the centre of the allowed range.
export function horizontalSnapTargets(format: CaptionFormat, placement: CaptionPlacement, cardHeight?: number): SnapGuide[] {
  const { width, height } = CAPTION_FRAMES[format];
  const bounds = boundsFor(format, placement);
  if (bounds.minX <= 0.5 && bounds.maxX >= 0.5)
    return [{ axis: "x", value: 0.5, line: 0.5, label: "Center" }];
  const centre = (bounds.minX + bounds.maxX) / 2;
  const height2 = cardHeight ?? captionCardHeight(width, height);
  const besideButtons = format === "reel" && placement.y + height2 / height > REEL_ACTION_ZONE.y;
  return [{ axis: "x", value: centre, line: centre, label: besideButtons ? "Centered beside Reel buttons" : "Centered in safe area" }];
}
// Picks the guide whose position is closest to the value, if it lies within the screen-space snap distance.
function nearest(value: number, guides: SnapGuide[], pxPerUnit: number): SnapGuide | undefined {
  let best: SnapGuide | undefined;
  for (const guide of guides) {
    const distance = Math.abs(value - guide.value) * pxPerUnit;
    if (distance <= SNAP_DISTANCE_PX && (!best || distance < Math.abs(value - best.value) * pxPerUnit)) best = guide;
  }
  return best;
}
// Moves a caption by pointer deltas, snapping in screen pixels and reporting the active guides and limits.
export function dragWithGuides({
  start,
  dx,
  dy,
  scale,
  format,
  cardHeight,
  bypassSnap,
}: {
  start: CaptionPlacement;
  dx: number;
  dy: number;
  scale: number;
  format: CaptionFormat;
  cardHeight?: number;
  bypassSnap: boolean;
}): DragGuideResult {
  const { width, height } = CAPTION_FRAMES[format];
  let placement = dragCaption({ placement: start, format, dx, dy, scale, snap: false });
  const guides: SnapGuide[] = [];
  if (!bypassSnap && dy !== 0) {
    const target = nearest(placement.y, verticalSnapTargets(format, placement, cardHeight), height * scale);
    if (target) {
      placement = clampCaptionPlacement({ ...placement, y: target.value }, format);
      guides.push(target);
    }
  }
  if (!bypassSnap && dx !== 0) {
    const target = nearest(placement.x, horizontalSnapTargets(format, placement, cardHeight), width * scale);
    if (target) {
      placement = clampCaptionPlacement({ ...placement, x: target.value }, format);
      guides.push(target);
    }
  }
  const bounds = boundsFor(format, placement);
  const wantedX = start.x + dx / scale / width;
  const wantedY = start.y + dy / scale / height;
  const slackX = SNAP_DISTANCE_PX / scale / width;
  const slackY = SNAP_DISTANCE_PX / scale / height;
  return {
    placement,
    guides,
    limits: {
      left: wantedX < bounds.minX - slackX,
      right: wantedX > bounds.maxX + slackX,
      top: wantedY < bounds.minY - slackY,
      bottom: wantedY > bounds.maxY + slackY,
    },
  };
}
// Returns the regions outside the safe placement area, with the Reel platform zones labelled, in composition pixels.
export function safeAreaRects(format: CaptionFormat): SafeAreaRect[] {
  const { width, height } = CAPTION_FRAMES[format];
  const margins = getFrameMargins(format, width);
  const middleHeight = height - margins.top - margins.bottom;
  const rects: SafeAreaRect[] = [
    { id: "top", kind: "margin", label: format === "reel" ? "Top of frame" : undefined, x: 0, y: 0, w: width, h: margins.top },
    {
      id: "bottom",
      kind: "margin",
      label: format === "reel" ? "Reel title and description" : undefined,
      x: 0,
      y: height - margins.bottom,
      w: width,
      h: margins.bottom,
    },
    { id: "left", kind: "margin", x: 0, y: margins.top, w: margins.left, h: middleHeight },
    { id: "right", kind: "margin", x: width - margins.right, y: margins.top, w: margins.right, h: middleHeight },
  ];
  if (format === "reel") {
    const zoneX = REEL_ACTION_ZONE.x * width;
    rects.push({
      id: "reel-buttons",
      kind: "zone",
      label: "Reel buttons",
      x: zoneX,
      y: REEL_ACTION_ZONE.y * height,
      w: width - margins.right - zoneX,
      h: height - margins.bottom - REEL_ACTION_ZONE.y * height,
    });
  }
  return rects;
}
// Returns the safe-area edges a drag is pressing against, as lines in composition pixels, so the limit can be brightened.
export function limitLines(format: CaptionFormat, limits?: MoveLimits): { id: string; vertical: boolean; at: number }[] {
  if (!limits) return [];
  const { width, height } = CAPTION_FRAMES[format];
  const margins = getFrameMargins(format, width);
  const lines: { id: string; vertical: boolean; at: number }[] = [];
  if (limits.left) lines.push({ id: "left", vertical: true, at: margins.left });
  if (limits.right) lines.push({ id: "right", vertical: true, at: width - margins.right });
  if (limits.top) lines.push({ id: "top", vertical: false, at: margins.top });
  if (limits.bottom) lines.push({ id: "bottom", vertical: false, at: height - margins.bottom });
  return lines;
}
// Describes which sideways or vertical limits a drag is pressing against, in plain words, or null when none.
export function limitHint(limits: MoveLimits): string | null {
  if (limits.left || limits.right)
    return "Make the box narrower with its side handles to move it sideways.";
  if (limits.top) return "The top safe line stops the captions here.";
  if (limits.bottom) return "The bottom safe line stops the captions here.";
  return null;
}
