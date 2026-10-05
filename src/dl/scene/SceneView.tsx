/**
 * File Description: Remotion and React DOM Renderer for Compiled Aideos Scenes (Phase 3/13).
 * Renders sorted scene entities in layer order with camera transformation applied: environment assets are drawn from their own parsed
 * SVG documents with full transform, per-instance id namespacing and compiled element-level custom
 * animation applied; actors are drawn as articulated vector rigs with hierarchical skeletal
 * transforms and rotating subgroups (D1). Pure React with no Node imports, so the same component
 * renders inside Remotion's browser bundle and in server-side stills.
 * Inputs and outputs: compiled scene state and SVG assets -> rendered hierarchical SVG elements with transforms.
 * Used by: src/dl/scene/SceneClip.tsx, editor/src/screens/MotionStage.tsx.
 */

import React from "react";
import type { CompiledFrame, CompiledEntity } from "./compile";
import { PALETTE, useTokens } from "../tokens";
import { useAccent } from "../accent";
import { parseSvgDocument, type SvgDocument } from "./svgDocument";
import { renderSvgNodes } from "./svgReact";

export interface SceneViewProps {
  frame: CompiledFrame;
  /** Output width in pixels. */
  width?: number;
  /** Output height in pixels. */
  height?: number;
  /**
   * The scene's own coordinate space, which entity positions are expressed in.
   * Defaults to the output size. Setting it separately renders the same scene at a different
   * resolution by scaling rather than by cropping.
   */
  sceneSize?: { w: number; h: number };
  accent?: string;
  /**
   * SVG source text for each asset, keyed by the asset's svgSource path. Supplying this is what
   * lets an environment asset render as its own artwork. Node callers can build it with
   * backend/scene/loadSceneAssets.ts; browser callers can bundle or fetch it ahead of render.
   */
  svgSources?: Record<string, string>;
  onMountEntityRef?: (entityId: string, el: SVGGElement | null) => void;
}

// Maps semantic token to active hex color

/** Parsed-document cache keyed by source text, so a repeated asset parses once per process. */
const parsedDocumentCache = new Map<string, SvgDocument | null>();

/** Parses an asset's SVG source, memoized, returning null when the source will not parse. */
function getParsedDocument(source: string): SvgDocument | null {
  const cached = parsedDocumentCache.get(source);
  if (cached !== undefined) return cached;
  let doc: SvgDocument | null = null;
  try {
    doc = parseSvgDocument(source);
  } catch {
    doc = null;
  }
  parsedDocumentCache.set(source, doc);
  return doc;
}

/**
 * Pure React SVG component that renders a compiled scene frame.
 */
export const SceneView: React.FC<SceneViewProps> = ({
  frame,
  width = 1920,
  height = 1080,
  sceneSize,
  accent,
  svgSources,
  onMountEntityRef,
}) => {
  const palette = useTokens();
  let accentColor = accent || PALETTE.accent;
  try {
    const ctxAccent = useAccent();
    if (ctxAccent) accentColor = ctxAccent;
  } catch {
    // fallback
  }

  // Renders one environment asset from its own SVG document, or the placeholder when it has none.
  const renderEnvironmentAsset = (entity: CompiledEntity) => {
    const tr = entity.transform;
    const source = entity.svgSource ? svgSources?.[entity.svgSource] : undefined;
    const doc = source ? getParsedDocument(source) : null;
    const transform = `translate(${tr.x}, ${tr.y}) scale(${tr.scale}) rotate(${tr.rotation})`;

    if (doc) {
      // Sub-group rotation (D1) rides on top of the compiled element states so an asset can spin
      // one of its own groups while its other elements run custom animation clips.
      const elementStates = { ...(entity.elementStates ?? {}) };
      for (const sg of entity.subGroupRotations ?? []) {
        const existing = elementStates[sg.elementId];
        elementStates[sg.elementId] = {
          translateX: existing?.translateX ?? 0,
          translateY: existing?.translateY ?? 0,
          scaleX: existing?.scaleX ?? 1,
          scaleY: existing?.scaleY ?? 1,
          rotate: (existing?.rotate ?? 0) + sg.degrees,
          opacity: existing?.opacity ?? 1,
          drawOn: existing?.drawOn ?? 1,
          opacityDriven: existing?.opacityDriven ?? false,
          originX: existing?.originX ?? 0,
          originY: existing?.originY ?? 0,
        };
      }

      return (
        <g
          key={entity.entityId}
          id={`entity-${entity.entityId}`}
          ref={(el) => onMountEntityRef?.(entity.entityId, el)}
          transform={transform}
          opacity={tr.opacity}
        >
          {renderSvgNodes(doc.children, {
            instanceId: entity.entityId,
            elementStates,
          })}
        </g>
      );
    }

    // A background with no artwork contributes nothing but its canvas fill: drawing a placeholder
    // object across the whole frame would be worse than showing the empty stage.
    if (entity.kind === "background") {
      return (
        <g
          key={entity.entityId}
          id={`entity-${entity.entityId}`}
          ref={(el) => onMountEntityRef?.(entity.entityId, el)}
          opacity={tr.opacity}
        />
      );
    }

    // No usable artwork: draw the neutral placeholder prop so a missing asset is visible in the
    // frame rather than silently absent, and still honours its transform and sub-rotations.
    return (
      <g
        key={entity.entityId}
        id={`entity-${entity.entityId}`}
        ref={(el) => onMountEntityRef?.(entity.entityId, el)}
        transform={transform}
        opacity={tr.opacity}
      >
        <rect x="-4" y="-180" width="8" height="180" fill={palette.muted} />
        <circle cx="0" cy="0" r="35" fill={palette.surface} stroke={palette.ink} strokeWidth="4" />
        <circle cx="0" cy="0" r="14" fill={accentColor} />

        {entity.subGroupRotations?.map((sg) => (
          <g
            key={sg.elementId}
            id={`subgroup-${entity.entityId}-${sg.elementId}`}
            transform={`rotate(${sg.degrees})`}
          >
            <path d="M0 -15 L15 -70 Q0 -90 -15 -70 Z" fill={accentColor} stroke={palette.ink} strokeWidth="2" />
            <path d="M0 -15 L15 -70 Q0 -90 -15 -70 Z" transform="rotate(120)" fill={accentColor} stroke={palette.ink} strokeWidth="2" />
            <path d="M0 -15 L15 -70 Q0 -90 -15 -70 Z" transform="rotate(240)" fill={accentColor} stroke={palette.ink} strokeWidth="2" />
          </g>
        ))}
      </g>
    );
  };

  let cameraTransform = "";
  if (frame.camera) {
    const sw = sceneSize?.w ?? width;
    const sh = sceneSize?.h ?? height;
    const cx = frame.camera.center.x;
    const cy = frame.camera.center.y;
    const z = frame.camera.zoom;
    const r = frame.camera.rotation;
    cameraTransform = `translate(${sw / 2}, ${sh / 2}) rotate(${r}) scale(${z}) translate(${-cx}, ${-cy})`;
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${sceneSize?.w ?? width} ${sceneSize?.h ?? height}`}
      width={width}
      height={height}
      style={{
        backgroundColor: palette.canvas,
        overflow: "hidden",
      }}
    >
      {/* Background canvas fill */}
      <rect width="100%" height="100%" fill={palette.canvas} />

      <g transform={cameraTransform || undefined}>
        {/* Render all entities strictly in ascending resolvedLayer order */}
        {frame.entities.map((entity) => renderEnvironmentAsset(entity))}
      </g>
    </svg>
  );
};
