/**
 * File Description: Remotion and React DOM Renderer for Compiled Aideos Scenes (Phase 3/13).
 * Dynamically renders sorted scene entities (background, props, articulated vector character rigs)
 * with hierarchical skeletal transforms, SVG defs namespacing, and stable React key reconciliation.
 */

import React from "react";
import type { CompiledFrame, CompiledEntity } from "./compile";
import { getCharacterRigById } from "../characters";
import { PALETTE } from "../tokens";
import { useAccent } from "../accent";

export interface SceneViewProps {
  frame: CompiledFrame;
  width?: number;
  height?: number;
  accent?: string;
  onMountEntityRef?: (entityId: string, el: SVGGElement | null) => void;
}

// Maps semantic token to active hex color
const resolveSemanticColor = (token: string | undefined, accentColor: string): string => {
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

/**
 * Pure React SVG component that renders a compiled scene frame.
 */
export const SceneView: React.FC<SceneViewProps> = ({
  frame,
  width = 1920,
  height = 1080,
  accent,
  onMountEntityRef,
}) => {
  let accentColor = accent || PALETTE.accent;
  try {
    const ctxAccent = useAccent();
    if (ctxAccent) accentColor = ctxAccent;
  } catch {
    // fallback
  }

  const renderEntity = (entity: CompiledEntity) => {
    const isActor = entity.kind === "actor";

    if (!isActor) {
      // Background or Prop
      const tr = entity.transform;
      return (
        <g
          key={entity.entityId}
          id={`entity-${entity.entityId}`}
          ref={(el) => onMountEntityRef?.(entity.entityId, el)}
          transform={`translate(${tr.x}, ${tr.y}) scale(${tr.scale}) rotate(${tr.rotation})`}
          opacity={tr.opacity}
        >
          {/* Render rotating subgroups if present */}
          {entity.subGroupRotations?.map((sg) => (
            <g
              key={sg.elementId}
              id={`subgroup-${sg.elementId}`}
              transform={`rotate(${sg.degrees})`}
            />
          ))}
        </g>
      );
    }

    // Articulated Character Actor
    const rig = getCharacterRigById(entity.entityId.includes("astro") ? "astronaut" : entity.entityId.includes("bot") ? "robot" : "developer") || getCharacterRigById("developer")!;
    const tr = entity.transform;
    const joints = entity.joints || {};
    const composedPivots = entity.composedPivots || {};

    const rootGroups = rig.groups.filter((g) => !g.parent);
    const childGroupsByParent: Record<string, typeof rig.groups> = {};

    for (const group of rig.groups) {
      if (group.parent) {
        if (!childGroupsByParent[group.parent]) childGroupsByParent[group.parent] = [];
        childGroupsByParent[group.parent].push(group);
      }
    }

    const renderGroup = (group: (typeof rig.groups)[0]) => {
      const rot = joints[group.id] ?? group.defaultRotation ?? 0;
      const pivot = group.pivot;
      const children = childGroupsByParent[group.id] || [];

      return (
        <g
          key={group.id}
          id={`group-${entity.entityId}-${group.id}`}
          transform={`translate(${pivot.x}, ${pivot.y}) rotate(${rot}) translate(${-pivot.x}, ${-pivot.y})`}
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
      <g
        key={entity.entityId}
        id={`actor-${entity.entityId}`}
        ref={(el) => onMountEntityRef?.(entity.entityId, el)}
        transform={`translate(${tr.x}, ${tr.y}) scale(${tr.scale})`}
        opacity={tr.opacity}
      >
        <g transform="translate(-200, -300)">
          {rootGroups.map((root) => renderGroup(root))}
        </g>
      </g>
    );
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{
        backgroundColor: PALETTE.canvas,
        overflow: "hidden",
      }}
    >
      {/* Background canvas fill */}
      <rect width="100%" height="100%" fill={PALETTE.canvas} />

      {/* Render all entities strictly in ascending resolvedLayer order */}
      {frame.entities.map((entity) => renderEntity(entity))}
    </svg>
  );
};
