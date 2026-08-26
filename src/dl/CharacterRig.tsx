/**
 * File Description: Remotion and React DOM renderer for pure TypeScript vector character rigs.
 * Computes 2-level skeletal transforms, interpolates pose keyframes via ease-out-expo,
 * and dynamically binds the 6-value design system palette tokens with safe context fallbacks.
 */

import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { EXPO } from "./motion";
import { PALETTE } from "./tokens";
import { useAccent } from "./accent";
import type { CharacterRig, PoseKeyframe, PoseTransform, SemanticToken } from "./characters/types";
import { getCharacterRigById } from "./characters";

export interface CharacterBeatProps {
  characterId: string;
  poses?: PoseKeyframe[];
  start?: number;
  durationInFrames?: number;
  progress?: number;
  accent?: string;
  className?: string;
}

// Safely reads Remotion current frame with fallback when rendered outside Composition.
function useSafeCurrentFrame(): number {
  try {
    return useCurrentFrame();
  } catch {
    return 0;
  }
}

// Safely reads Remotion video config with fallback when rendered outside Composition.
function useSafeVideoConfig(): { durationInFrames: number; fps: number; width: number; height: number } {
  try {
    return useVideoConfig();
  } catch {
    return { durationInFrames: 300, fps: 30, width: 1920, height: 1080 };
  }
}

// Maps semantic design tokens to active theme color values.
const resolveSemanticColor = (token: SemanticToken | undefined, accentColor: string): string => {
  switch (token) {
    case "surface":
      return PALETTE.surface;
    case "ink":
      return PALETTE.ink;
    case "muted":
      return PALETTE.muted;
    case "hairline":
      return PALETTE.hairline;
    case "accent":
      return accentColor;
    case "canvas":
      return PALETTE.canvas;
    case "none":
    default:
      return "none";
  }
};

// Interpolates a single numeric value between two keyframe values using ease-out-expo.
const interpolateValue = (
  from: number | undefined,
  to: number | undefined,
  defaultVal: number,
  progress: number,
): number => {
  const start = from ?? defaultVal;
  const end = to ?? defaultVal;
  if (start === end) return start;
  return interpolate(progress, [0, 1], [start, end], {
    easing: EXPO,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
};

// Evaluates the active pose transform for a joint group at the current normalized progress t.
const evaluateGroupTransform = (
  groupId: string,
  keyframes: PoseKeyframe[],
  t: number,
): PoseTransform => {
  if (keyframes.length === 0) return { rotate: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };

  // Sort keyframes by time
  const sorted = [...keyframes].sort((a, b) => a.t - b.t);

  // If before first keyframe
  if (t <= sorted[0].t) {
    const k0 = sorted[0].groups[groupId] ?? {};
    return {
      rotate: k0.rotate ?? 0,
      x: k0.x ?? 0,
      y: k0.y ?? 0,
      scaleX: k0.scaleX ?? 1,
      scaleY: k0.scaleY ?? 1,
    };
  }

  // If after last keyframe
  if (t >= sorted[sorted.length - 1].t) {
    const kEnd = sorted[sorted.length - 1].groups[groupId] ?? {};
    return {
      rotate: kEnd.rotate ?? 0,
      x: kEnd.x ?? 0,
      y: kEnd.y ?? 0,
      scaleX: kEnd.scaleX ?? 1,
      scaleY: kEnd.scaleY ?? 1,
    };
  }

  // Find surrounding interval [k0, k1]
  let prev = sorted[0];
  let next = sorted[sorted.length - 1];

  for (let i = 0; i < sorted.length - 1; i++) {
    if (t >= sorted[i].t && t <= sorted[i + 1].t) {
      prev = sorted[i];
      next = sorted[i + 1];
      break;
    }
  }

  const span = next.t - prev.t;
  const localT = span > 0 ? (t - prev.t) / span : 1;

  const g0 = prev.groups[groupId] ?? {};
  const g1 = next.groups[groupId] ?? {};

  return {
    rotate: interpolateValue(g0.rotate, g1.rotate, 0, localT),
    x: interpolateValue(g0.x, g1.x, 0, localT),
    y: interpolateValue(g0.y, g1.y, 0, localT),
    scaleX: interpolateValue(g0.scaleX, g1.scaleX, 1, localT),
    scaleY: interpolateValue(g0.scaleY, g1.scaleY, 1, localT),
  };
};

// Renders an animated SVG character rig driven by pose keyframes and design tokens.
export const CharacterRigView: React.FC<CharacterBeatProps> = ({
  characterId,
  poses = [],
  start,
  durationInFrames,
  progress,
  accent,
  className = "",
}) => {
  const frame = useSafeCurrentFrame();
  const videoConfig = useSafeVideoConfig();

  let accentColor = accent || PALETTE.accent;
  try {
    const ctxAccent = useAccent();
    if (ctxAccent) accentColor = ctxAccent;
  } catch {
    // fallback to default
  }

  const rig: CharacterRig | null = getCharacterRigById(characterId);
  if (!rig) {
    return (
      <div style={{ color: PALETTE.muted, fontFamily: "sans-serif" }}>
        Character &quot;{characterId}&quot; not found
      </div>
    );
  }

  // Calculate local shot timeline progress in [0, 1]
  let normalizedProgress = 0;
  if (typeof progress === "number") {
    normalizedProgress = Math.min(1, Math.max(0, progress));
  } else {
    const startFrame = start ?? 0;
    const shotTotalFrames = durationInFrames ?? videoConfig.durationInFrames;
    const localFrame = Math.max(0, frame - startFrame);
    const total = Math.max(1, shotTotalFrames - 1);
    normalizedProgress = Math.min(1, Math.max(0, localFrame / total));
  }

  // Compute active transforms for each group
  const transforms: Record<string, PoseTransform> = {};
  for (const group of rig.groups) {
    transforms[group.id] = evaluateGroupTransform(group.id, poses, normalizedProgress);
  }

  // Separate root groups from child groups
  const rootGroups = rig.groups.filter((g) => !g.parent);
  const childGroupsByParent: Record<string, typeof rig.groups> = {};

  for (const group of rig.groups) {
    if (group.parent) {
      if (!childGroupsByParent[group.parent]) childGroupsByParent[group.parent] = [];
      childGroupsByParent[group.parent].push(group);
    }
  }

  // Renders a single rig group with hierarchical SVG transforms
  const renderGroup = (group: (typeof rig.groups)[0]) => {
    const tr = transforms[group.id] || { rotate: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
    const pivot = group.pivot;
    const rot = tr.rotate ?? group.defaultRotation ?? 0;
    const tx = tr.x ?? 0;
    const ty = tr.y ?? 0;
    const sx = tr.scaleX ?? 1;
    const sy = tr.scaleY ?? 1;

    const children = childGroupsByParent[group.id] || [];

    return (
      <g
        key={group.id}
        id={`group-${group.id}`}
        transform={`translate(${pivot.x + tx}, ${pivot.y + ty}) rotate(${rot}) scale(${sx}, ${sy}) translate(${-pivot.x}, ${-pivot.y})`}
      >
        {group.paths.map((p, idx) => {
          const fill = resolveSemanticColor(p.fill, accentColor);
          const stroke = resolveSemanticColor(p.stroke, accentColor);
          return (
            <path
              key={idx}
              d={p.d}
              fill={fill}
              stroke={stroke}
              strokeWidth={p.strokeWidth ?? (stroke !== "none" ? 2 : 0)}
              fillRule={p.fillRule}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
        {children.map((child) => renderGroup(child))}
      </g>
    );
  };

  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        maxHeight: "100%",
      }}
    >
      <svg
        viewBox={rig.viewBox}
        style={{
          height: "100%",
          maxHeight: 420,
          width: "auto",
          maxWidth: "100%",
          filter: "drop-shadow(0 12px 24px rgba(0, 0, 0, 0.25))",
          overflow: "visible",
        }}
      >
        {rootGroups.map((root) => renderGroup(root))}
      </svg>
    </div>
  );
};
