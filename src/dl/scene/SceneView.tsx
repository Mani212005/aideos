/**
 * File Description: Remotion and React DOM Renderer for Compiled Aideos Scenes (Phase 3/13).
 * Dynamically renders sorted scene entities (background, props, articulated vector character rigs)
 * with hierarchical skeletal transforms, rotating subgroups (D1), and stable React key reconciliation.
 */

import React from "react";
import fs from "fs";
import path from "path";
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

/** Cache of loaded SVG asset contents */
const svgAssetCache: Record<string, string> = {};

function getSvgContent(src: string): string {
  if (svgAssetCache[src]) return svgAssetCache[src];
  try {
    const resolved = path.isAbsolute(src) ? src : path.resolve(process.cwd(), src);
    if (fs.existsSync(resolved)) {
      const content = fs.readFileSync(resolved, "utf-8");
      svgAssetCache[src] = content;
      return content;
    }
  } catch {
    // Ignore read errors
  }
  return "";
}

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
      const svgRaw = entity.svgSource ? getSvgContent(entity.svgSource) : "";

      // If background has raw SVG content, extract inner elements
      if (entity.kind === "background" && svgRaw) {
        // Strip outer <svg> and </svg> tags to embed directly
        const innerSvg = svgRaw
          .replace(/<svg[^>]*>/i, "")
          .replace(/<\/svg>/i, "");

        return (
          <g
            key={entity.entityId}
            id={`entity-${entity.entityId}`}
            ref={(el) => onMountEntityRef?.(entity.entityId, el)}
            opacity={tr.opacity}
            dangerouslySetInnerHTML={{ __html: innerSvg }}
          />
        );
      }

      // Prop with rotating subgroups (D1)
      return (
        <g
          key={entity.entityId}
          id={`entity-${entity.entityId}`}
          ref={(el) => onMountEntityRef?.(entity.entityId, el)}
          transform={`translate(${tr.x}, ${tr.y}) scale(${tr.scale}) rotate(${tr.rotation})`}
          opacity={tr.opacity}
        >
          {/* Default Turbine/Prop Body */}
          <rect x="-4" y="-180" width="8" height="180" fill={PALETTE.muted} />
          <circle cx="0" cy="0" r="35" fill={PALETTE.surface} stroke={PALETTE.ink} strokeWidth="4" />
          <circle cx="0" cy="0" r="14" fill={accentColor} />

          {/* Rotating Subgroups (D1) */}
          {entity.subGroupRotations?.map((sg) => (
            <g
              key={sg.elementId}
              id={`subgroup-${entity.entityId}-${sg.elementId}`}
              transform={`rotate(${sg.degrees})`}
            >
              {/* 3 Blades */}
              <path d="M0 -15 L15 -70 Q0 -90 -15 -70 Z" fill={accentColor} stroke={PALETTE.ink} strokeWidth="2" />
              <path d="M0 -15 L15 -70 Q0 -90 -15 -70 Z" transform="rotate(120)" fill={accentColor} stroke={PALETTE.ink} strokeWidth="2" />
              <path d="M0 -15 L15 -70 Q0 -90 -15 -70 Z" transform="rotate(240)" fill={accentColor} stroke={PALETTE.ink} strokeWidth="2" />
            </g>
          ))}
        </g>
      );
    }

    // Articulated Character Actor
    const rigId = entity.rigId || "developer";
    const rig = getCharacterRigById(rigId) || getCharacterRigById("developer")!;
    const tr = entity.transform;
    const joints = entity.joints || {};

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
