/**
 * File Description: Shared caption placement resolution, gesture geometry and owner persistence policy.
 * Inputs and outputs: film, format, scope and pointer deltas -> safe card rectangles and updated films.
 * Used by: FilmView, studio caption controls, film writers, design checks and review.
 */
import type {
  CaptionPlacement,
  CaptionPlacementByFormat,
  Film,
} from "./schema";
import {
  getFrameMargins,
  subtitleCardHeight as captionCardHeight,
} from "./fullScreenHeroLayout";
export type CaptionFormat = "long" | "reel";
export type CaptionScope = { kind: "film" } | { kind: "shot"; shotId: string };
export type ResolvedCaptionPlacement = CaptionPlacement & {
  source: "shot" | "film" | "default";
};
export const DEFAULT_CAPTION_PLACEMENT_WIDTH = 0.86;
export const DEFAULT_CAPTION_PLACEMENT: CaptionPlacement = {
  x: 0.5,
  y: 0.78,
  locked: false,
};
export const CAPTION_FRAMES = {
  long: { width: 1920, height: 1080 },
  reel: { width: 1080, height: 1920 },
};
export const MIN_CAPTION_WIDTH = { long: 0.4, reel: 0.6 };
// Conservative lower-half right-hand action-button strip; the legacy default remains unchanged.
export const REEL_ACTION_ZONE = { x: 0.88, y: 0.5 };
export type CaptionRect = { x: number; y: number; w: number; h: number };
export { captionCardHeight };
// Keeps absent widths content-sized while reserving the default envelope for editor and collision geometry.
export function resolveCaptionCardWidth(
  placement: CaptionPlacement & { source?: ResolvedCaptionPlacement["source"] },
  frameWidth: number,
) {
  const width = (placement.w ?? DEFAULT_CAPTION_PLACEMENT_WIDTH) * frameWidth;
  const fixed = placement.w !== undefined;
  return { width, fixed, innerWidth: (fixed ? width : width * 0.92) - 58 };
}
// Clamps a normalized value between its safe limits.
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
// Returns safe placement limits for one format and chosen width.
export function captionBounds(
  format: CaptionFormat,
  width: number,
  height: number,
  w: number,
  y = 0.2,
  minimumWidth = MIN_CAPTION_WIDTH[format],
) {
  const margins = getFrameMargins(format, width);
  const right =
    format === "reel" &&
    y + captionCardHeight(width, height) / height > REEL_ACTION_ZONE.y
      ? Math.min(1 - margins.right / width, REEL_ACTION_ZONE.x)
      : 1 - margins.right / width;
  const left = margins.left / width;
  const maxWidth = right - left;
  const safeWidth = clamp(w, minimumWidth, maxWidth);
  return {
    minX: left + safeWidth / 2,
    maxX: right - safeWidth / 2,
    minY: margins.top / height,
    maxY: Math.min(
      0.78,
      (height - margins.bottom - captionCardHeight(width, height)) / height,
    ),
    minW: minimumWidth,
    maxW: maxWidth,
    w: safeWidth,
  };
}
// Preserves absent auto width and clamps every explicit width to the format bounds.
export function clampCaptionPlacement(
  placement: CaptionPlacement,
  format: CaptionFormat,
): CaptionPlacement {
  const { width, height } = CAPTION_FRAMES[format];
  const hasExplicitWidth = placement.w !== undefined;
  const bounds = captionBounds(
    format,
    width,
    height,
    placement.w ?? DEFAULT_CAPTION_PLACEMENT_WIDTH,
    placement.y,
    hasExplicitWidth ? MIN_CAPTION_WIDTH[format] : 0,
  );
  return {
    x: clamp(placement.x, bounds.minX, bounds.maxX),
    y: clamp(placement.y, bounds.minY, bounds.maxY),
    ...(hasExplicitWidth ? { w: bounds.w } : {}),
    locked: placement.locked,
  };
}
// Resolves shot, film and legacy default independently in each format.
export function resolveCaptionPlacement(
  film: Pick<Film, "captionPlacement" | "shots">,
  format: CaptionFormat,
  shotId?: string,
): ResolvedCaptionPlacement {
  const shot = film.shots.find((s) => s.id === shotId)?.captionPlacement?.[
    format
  ];
  const entry = shot ?? film.captionPlacement?.[format];
  return entry
    ? {
        ...clampCaptionPlacement(entry, format),
        source: shot ? "shot" : "film",
      }
    : { ...DEFAULT_CAPTION_PLACEMENT, source: "default" };
}
// Returns a conservative reserved band for legacy defaults and the visible fixed box for saved placements.
export function captionCardRect(
  _format: CaptionFormat,
  width: number,
  height: number,
  placement: CaptionPlacement,
  lines = 2,
): CaptionRect {
  const card = resolveCaptionCardWidth(placement, width);
  return {
    x: placement.x * width - card.width / 2,
    y: placement.y * height,
    w: card.width,
    h: captionCardHeight(width, height, lines),
  };
}
// Tests a pair of output-space rectangles for visible intersection.
export function captionRectsOverlap(a: CaptionRect, b: CaptionRect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}
// Snaps a coordinate near an alignment target unless the caller bypasses it.
function snapTo(value: number, targets: number[], enabled: boolean): number {
  return enabled
    ? (targets.find((target) => Math.abs(value - target) <= 0.015) ?? value)
    : value;
}
type Gesture = {
  placement: CaptionPlacement;
  format: CaptionFormat;
  dx: number;
  scale: number;
  snap: boolean;
};
// Converts scaled pointer motion into a clamped and optionally snapped 2D placement.
export function dragCaption({
  placement,
  format,
  dx,
  dy,
  scale,
  snap,
}: Gesture & { dy: number }): CaptionPlacement {
  if (placement.locked) return placement;
  const { width, height } = CAPTION_FRAMES[format];
  const next = {
    ...placement,
    x: placement.x + dx / scale / width,
    y: placement.y + dy / scale / height,
  };
  const bounds = captionBounds(
    format,
    width,
    height,
    next.w ?? DEFAULT_CAPTION_PLACEMENT_WIDTH,
    next.y,
    next.w === undefined ? 0 : undefined,
  );
  next.x = snapTo(next.x, [bounds.minX, 0.5, bounds.maxX], snap && dx !== 0);
  next.y = snapTo(next.y, [bounds.minY, 0.45, bounds.maxY], snap && dy !== 0);
  const clamped = clampCaptionPlacement(next, format);
  return {
    ...clamped,
    x: dx === 0 && next.x === placement.x ? placement.x : clamped.x,
    y: dy === 0 && next.y === placement.y ? placement.y : clamped.y,
  };
}
// Resizes from one edge while retaining the opposite edge and the fixed font size.
export function resizeCaption({
  placement,
  format,
  edge,
  dx,
  scale,
  snap,
}: Gesture & { edge: "left" | "right" }): CaptionPlacement {
  if (placement.locked) return placement;
  const { width, height } = CAPTION_FRAMES[format];
  const baseWidth = placement.w ?? DEFAULT_CAPTION_PLACEMENT_WIDTH;
  const bounds = captionBounds(format, width, height, baseWidth, placement.y);
  const opposite = placement.x + ((edge === "left" ? 1 : -1) * baseWidth) / 2;
  const margin = getFrameMargins(format, width).left / width;
  const limit =
    edge === "left" ? opposite - margin : bounds.maxX + bounds.w / 2 - opposite;
  const delta = (dx / scale / width) * (edge === "left" ? -1 : 1);
  const w = clamp(
    snapTo(baseWidth + delta, [DEFAULT_CAPTION_PLACEMENT_WIDTH], snap && dx !== 0),
    bounds.minW,
    Math.max(bounds.minW, limit),
  );
  const clamped = clampCaptionPlacement(
    { ...placement, w, x: opposite + ((edge === "left" ? -1 : 1) * w) / 2 },
    format,
  );
  return { ...clamped, y: placement.y };
}
// Sets or resets one scope, refusing agent writes to a pinned effective card.
export function setCaptionPlacement(
  film: Film,
  {
    format,
    scope,
    placement,
    owner,
  }: {
    format: CaptionFormat;
    scope: CaptionScope;
    placement?: CaptionPlacement;
    owner: boolean;
  },
): Film {
  if (scope.kind === "shot" && !film.shots.some((s) => s.id === scope.shotId))
    throw new Error(`Unknown caption shot ${scope.shotId}`);
  if (
    !owner &&
    resolveCaptionPlacement(
      film,
      format,
      scope.kind === "shot" ? scope.shotId : undefined,
    ).locked
  )
    throw new Error(
      "Caption placement is locked. Unlock it in the studio first.",
    );
  // Writes only the selected format and removes empty optional fields on reset.
  const update = (
    entries?: CaptionPlacementByFormat,
  ): CaptionPlacementByFormat | undefined => {
    const result = { ...entries };
    if (placement) result[format] = clampCaptionPlacement(placement, format);
    else delete result[format];
    return result.long || result.reel ? result : undefined;
  };
  return scope.kind === "film"
    ? { ...film, captionPlacement: update(film.captionPlacement) }
    : {
        ...film,
        shots: film.shots.map((shot) =>
          shot.id === scope.shotId
            ? { ...shot, captionPlacement: update(shot.captionPlacement) }
            : shot,
        ),
      };
}
// Recognizes the generated ID shape used by timeline split descendants.
function isSplitDescendant(parentId: string, candidateId: string): boolean {
  return candidateId.startsWith(`${parentId}-`) &&
    /^-[ab][a-z0-9]{4}(?:-[ab][a-z0-9]{4})*$/.test(candidateId.slice(parentId.length));
}
// Returns timeline shots created by splitting the given parent shot.
export function splitCaptionDescendants<T extends { id: string; captionPlacement?: CaptionPlacementByFormat }>(
  shots: readonly T[],
  parentId: string,
): T[] {
  return shots.filter((shot) => isSplitDescendant(parentId, shot.id));
}
// Compares the serialized placement fields independent of object key order.
function sameCaptionPlacement(a: CaptionPlacement | undefined, b: CaptionPlacement | undefined): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w &&
    a.locked === b.locked;
}
// Carries omitted entries across rebuilds and lets only owner writes alter locked entries.
export function carryCaptionPlacement(
  previous: Film | null,
  next: Film,
  { owner, agentEdit = false }: { owner: boolean; agentEdit?: boolean },
): Film {
  if (!previous || owner) return next;
  const nextShots = next.shots.flatMap((shot) => {
    const descendants = splitCaptionDescendants(previous.shots, shot.id);
    return descendants.some((descendant) => descendant.captionPlacement)
      ? descendants
      : [shot];
  });
  const mergedNext = { ...next, shots: nextShots };
  // Merges the two format entries without introducing fields on untouched films.
  const carry = (
    prev?: CaptionPlacementByFormat,
    incoming?: CaptionPlacementByFormat,
  ): CaptionPlacementByFormat | undefined => {
    if (!prev) return incoming;
    const result = { ...incoming };
    for (const format of ["long", "reel"] as const) {
      if (prev[format] && (!agentEdit || prev[format].locked || !incoming?.[format]))
        result[format] = prev[format];
    }
    return result;
  };
  const orphans = previous.shots.filter((shot) => {
    if (!shot.captionPlacement || mergedNext.shots.some((s) => s.id === shot.id)) return false;
    const descendants = splitCaptionDescendants(mergedNext.shots, shot.id);
    return descendants.length === 0 || descendants.some((candidate) =>
      (["long", "reel"] as const).some((format) =>
        shot.captionPlacement?.[format] &&
        !sameCaptionPlacement(shot.captionPlacement?.[format], candidate.captionPlacement?.[format]),
      ),
    );
  });
  if (orphans.length)
    throw new Error(
      `caption-placement: rebuild removes shots with owner placement: ${orphans.map((s) => s.id).join(", ")}. Reset those exceptions before rebuilding.`,
    );
  const filmPlacement = carry(previous.captionPlacement, mergedNext.captionPlacement);
  return {
    ...mergedNext,
    ...(filmPlacement ? { captionPlacement: filmPlacement } : {}),
    shots: mergedNext.shots.map((shot) => {
      const previousShot = previous.shots.find((s) => s.id === shot.id);
      const placement = carry(
        previousShot?.captionPlacement,
        shot.captionPlacement,
      );
      if (!placement) return shot;
      const effective = { ...placement };
      for (const format of ["long", "reel"] as const) {
        if (
          previous.captionPlacement?.[format]?.locked &&
          !previousShot?.captionPlacement?.[format]
        )
          delete effective[format];
      }
      return {
        ...shot,
        captionPlacement:
          effective.long || effective.reel ? effective : undefined,
      };
    }),
  };
}
