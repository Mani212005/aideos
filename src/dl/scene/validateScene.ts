/**
 * File Description: Comprehensive semantic validator for Aideos Scene Graph data (Phase 1).
 * Rejects unsupported actor rigs before applying scene integrity rules, custom SVG animation
 * timeline rules (Rule 20), and picture assets (Rule 11 with src/dl/scene/raster.ts: one pinned PNG, its one element
 * moved by placement, scale, rotation and opacity clips only).
 * 100% pure TypeScript validator with zero Node runtime dependencies.
 * Inputs and outputs: Scene data object -> validation diagnostics and errors.
 * Used by: backend/scene/validateSceneNode.ts, backend/scene/scene.test.ts.
 */

import type { Scene, EnvironmentAsset, Track } from "./types";
import { validateSvgTimeline } from "./svgAnimation";
import { validateStage } from "./validateStage";
import { rasterSourceProblems, rasterElementIds } from "./raster";

export interface ValidationError {
  rule: number;
  entityId?: string;
  message: string;
}

export interface ValidationWarning {
  warningId: string;
  entityId?: string;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export const SUPPORTED_SCHEMA_VERSION = "1.0.0";
const UNSUPPORTED_ACTOR_RULE = 21;

/** The instance id a legacy actor entry names, when it names one: the schema refuses actors, so their shape is unknown. */
function actorInstanceId(actor: unknown): string | undefined {
  if (typeof actor !== "object" || actor === null || !("instanceId" in actor)) return undefined;
  return typeof actor.instanceId === "string" ? actor.instanceId : undefined;
}

/**
 * Validates a Scene data object against the supported schema and physical integrity rules.
 * @param scene Complete Scene data object.
 * @returns ValidationResult with list of errors and warnings.
 */
export function validateScene(scene: Scene): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Rule 1: schemaVersion major version matches supported version
  if (!scene.schemaVersion || !scene.schemaVersion.startsWith("1.")) {
    errors.push({
      rule: 1,
      message: `Invalid schemaVersion "${scene.schemaVersion}". Expected version 1.x.x (supported: "${SUPPORTED_SCHEMA_VERSION}")`,
    });
  }

  // Actor tracks have no renderer yet, so reject them before validating or compiling the rest of the scene.
  if (Array.isArray(scene.actors) && scene.actors.length > 0) {
    return {
      isValid: false,
      errors: scene.actors.map(actorInstanceId).map((instanceId) => ({
        rule: UNSUPPORTED_ACTOR_RULE,
        entityId: instanceId,
        message: `Actor "${instanceId || "(missing instanceId)"}" cannot be rendered: character rigs are not supported; scene rendering currently supports SVG backgrounds and props only.`,
      })),
      warnings,
    };
  }

  errors.push(...validateStage(scene).map((message) => ({ rule: 22, message })));

  // Rule 2: actors field must be an array (non-empty actor arrays are rejected above under Rule 21).
  if (!Array.isArray(scene.actors)) {
    errors.push({
      rule: 2,
      message: "Scene actors must be an array.",
    });
  }

  // Rule 4: All assetId values unique within the scene
  const assetIds = new Set<string>();
  const allAssets: EnvironmentAsset[] = [];
  if (scene.background) allAssets.push(scene.background);
  if (Array.isArray(scene.props)) allAssets.push(...scene.props);

  for (const asset of allAssets) {
    if (!asset.assetId) {
      errors.push({ rule: 4, message: "Asset is missing required assetId" });
    } else if (assetIds.has(asset.assetId)) {
      errors.push({
        rule: 4,
        entityId: asset.assetId,
        message: `Duplicate assetId "${asset.assetId}" found in scene`,
      });
    } else {
      assetIds.add(asset.assetId);
    }
  }

  // Rule 5: Every present layer value is an integer
  const checkLayer = (layer: number | undefined, entityId: string) => {
    if (layer !== undefined && (!Number.isInteger(layer) || !Number.isFinite(layer))) {
      errors.push({
        rule: 5,
        entityId,
        message: `Entity "${entityId}" layer value must be an integer, got ${layer}`,
      });
    }
  };
  for (const asset of allAssets) checkLayer(asset.layer, asset.assetId);

  // Helper to validate tracks (Rules 8, 9)
  const validateTrack = (track: Track, entityId: string, trackName: string) => {
    if (!Array.isArray(track.keyframes)) {
      errors.push({
        rule: 8,
        entityId,
        message: `Track "${trackName}" on "${entityId}" has invalid keyframes array`,
      });
      return;
    }
    let prevFrame = -1;
    for (let i = 0; i < track.keyframes.length; i++) {
      const kf = track.keyframes[i];
      // Rule 8: Keyframe.frame is integer in [0, durationFrames - 1]
      if (!Number.isInteger(kf.frame) || kf.frame < 0 || kf.frame >= scene.durationFrames) {
        errors.push({
          rule: 8,
          entityId,
          message: `Track "${trackName}" on "${entityId}" keyframe ${i} has invalid frame ${kf.frame}. Must be integer in [0, ${scene.durationFrames - 1}]`,
        });
      }
      // Rule 9: Keyframes sorted strictly ascending by frame, no duplicates
      if (kf.frame <= prevFrame) {
        errors.push({
          rule: 9,
          entityId,
          message: `Track "${trackName}" on "${entityId}" keyframes are not strictly ascending at index ${i} (frame ${kf.frame} <= previous ${prevFrame})`,
        });
      }
      prevFrame = kf.frame;
    }
  };

  // Rule 10, 11, 15, 16: Validate environment assets
  for (const asset of allAssets) {
    // Rule 10: opacity in [0, 1], scale > 0
    if (asset.opacity !== undefined && (asset.opacity < 0 || asset.opacity > 1 || isNaN(asset.opacity))) {
      errors.push({
        rule: 10,
        entityId: asset.assetId,
        message: `Asset "${asset.assetId}" opacity ${asset.opacity} is outside valid range [0, 1]`,
      });
    }
    if (asset.scale !== undefined && (asset.scale <= 0 || isNaN(asset.scale))) {
      errors.push({
        rule: 10,
        entityId: asset.assetId,
        message: `Asset "${asset.assetId}" scale ${asset.scale} must be strictly positive (> 0)`,
      });
    }

    // Rule 11: exactly one artwork source: an svgSource ending with .svg, or a pinned picture.
    if (asset.raster !== undefined) {
      if (asset.svgSource) {
        errors.push({
          rule: 11,
          entityId: asset.assetId,
          message: `Asset "${asset.assetId}" sets both svgSource and a picture; an asset draws one or the other`,
        });
      }
      for (const message of rasterSourceProblems(asset.assetId, asset.raster)) errors.push({ rule: 11, entityId: asset.assetId, message });
      if (asset.subGroups?.length) {
        errors.push({ rule: 11, entityId: asset.assetId, message: `Asset "${asset.assetId}" is a picture, which has no sub-groups to rotate` });
      }
    } else if (!asset.svgSource) {
      errors.push({
        rule: 11,
        entityId: asset.assetId,
        message: `Asset "${asset.assetId}" missing required svgSource`,
      });
    } else if (!asset.svgSource.endsWith(".svg")) {
      errors.push({
        rule: 11,
        entityId: asset.assetId,
        message: `Asset "${asset.assetId}" svgSource must be an .svg file: "${asset.svgSource}"`,
      });
    }

    // Validate asset tracks
    if (asset.tracks) {
      for (const tr of asset.tracks) validateTrack(tr, asset.assetId, tr.trackId);
    }

    // Rules 15, 16: D1 RotatingSubGroups
    if (asset.subGroups && Array.isArray(asset.subGroups)) {
      const subGroupElementIds = new Set<string>();
      for (const sg of asset.subGroups) {
        // Rule 15: Exactly one of degreesPerSecond or track
        const hasDegPerSec = typeof sg.degreesPerSecond === "number";
        const hasTrack = Boolean(sg.track);
        if ((hasDegPerSec && hasTrack) || (!hasDegPerSec && !hasTrack)) {
          errors.push({
            rule: 15,
            entityId: asset.assetId,
            message: `RotatingSubGroup "${sg.elementId}" on asset "${asset.assetId}" must specify exactly one of degreesPerSecond or track`,
          });
        }
        if (sg.track) {
          validateTrack(sg.track, asset.assetId, `subGroup-${sg.elementId}`);
        }

        // Rule 16: Unique elementId within asset and exists in SVG document
        if (!sg.elementId) {
          errors.push({
            rule: 16,
            entityId: asset.assetId,
            message: `RotatingSubGroup on asset "${asset.assetId}" missing required elementId`,
          });
        } else if (subGroupElementIds.has(sg.elementId)) {
          errors.push({
            rule: 16,
            entityId: asset.assetId,
            message: `Duplicate RotatingSubGroup elementId "${sg.elementId}" on asset "${asset.assetId}"`,
          });
        } else {
          subGroupElementIds.add(sg.elementId);
        }
      }
    }

    // Rule 20: Custom element-level SVG animation timeline is internally consistent.
    // Target existence against the real SVG document is checked by validateSceneNode, which is
    // the layer that can read the asset off disk.
    if (asset.animation) {
      // A picture's one element is known without reading a file, so its targets are checked here.
      const timelineErrors = validateSvgTimeline(asset.animation, {
        durationFrames: scene.durationFrames,
        ...(asset.raster ? { availableElementIds: rasterElementIds(asset) } : {}),
      });
      for (const te of timelineErrors) {
        errors.push({
          rule: 20,
          entityId: asset.assetId,
          message: `Asset "${asset.assetId}" animation timeline "${asset.animation.timelineId}" clip "${te.clipId}": ${te.message}`,
        });
      }
      // Phase 1 pictures are placed, scaled, turned and faded; a stroke reveal has no meaning on pixels.
      for (const clip of asset.raster ? asset.animation.clips : []) {
        if (clip.property === "drawOn") {
          errors.push({ rule: 20, entityId: asset.assetId, message: `Asset "${asset.assetId}" clip "${clip.clipId}": a picture cannot be drawn on; move, scale, rotate or fade it instead` });
        }
      }
    }
  }

  // Rule 14

  if (scene.fps > 0 && scene.durationFrames > 0 && typeof scene.audioDurationMs === "number") {
    const computedDurationMs = (scene.durationFrames / scene.fps) * 1000;
    const diffMs = Math.abs(computedDurationMs - scene.audioDurationMs);
    if (diffMs > 50) {
      errors.push({
        rule: 14,
        message: `AUDIO_DURATION_MISMATCH: Scene duration (${computedDurationMs.toFixed(1)}ms across ${scene.durationFrames} frames @ ${scene.fps}fps) differs from audioDurationMs (${scene.audioDurationMs}ms) by ${diffMs.toFixed(1)}ms (exceeds ±50ms threshold)`,
      });
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
