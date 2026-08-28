/**
 * File Description: Comprehensive semantic validator for Aideos Scene Graph data (Phase 1).
 * Enforces 18 strict error validation rules and normalized median scale warnings (W1).
 */

import fs from "fs";
import path from "path";
import type { Scene, EnvironmentAsset, ActorInstance, Track } from "./types";
import { getCharacterRigById } from "../characters";
import { getModelSheet } from "./modelSheet";
import { ACTION_METADATA, getAffectedJointsForAction } from "./actions";

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

/**
 * Validates a Scene data object against the 18 Phase 1 schema and physical integrity rules.
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

  // Rule 2: actors.length <= 15
  if (!Array.isArray(scene.actors) || scene.actors.length > 15) {
    errors.push({
      rule: 2,
      message: `Scene contains ${scene.actors?.length ?? 0} actors. Maximum allowed articulated actors per scene is 15.`,
    });
  }

  // Rule 3: All instanceId values unique within the scene
  const instanceIds = new Set<string>();
  if (Array.isArray(scene.actors)) {
    for (const actor of scene.actors) {
      if (!actor.instanceId) {
        errors.push({ rule: 3, message: "Actor is missing required instanceId" });
      } else if (instanceIds.has(actor.instanceId)) {
        errors.push({
          rule: 3,
          entityId: actor.instanceId,
          message: `Duplicate actor instanceId "${actor.instanceId}" found in scene`,
        });
      } else {
        instanceIds.add(actor.instanceId);
      }
    }
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
  if (Array.isArray(scene.actors)) {
    for (const actor of scene.actors) checkLayer(actor.layer, actor.instanceId);
  }

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

    // Rule 11: svgSource file exists on disk (Node runtime check)
    let svgContent = "";
    const isNode = typeof process !== "undefined" && Boolean(process?.versions?.node) && typeof window === "undefined";
    if (!asset.svgSource) {
      errors.push({
        rule: 11,
        entityId: asset.assetId,
        message: `Asset "${asset.assetId}" missing required svgSource`,
      });
    } else if (isNode) {
      const resolvedPath = path.isAbsolute(asset.svgSource)
        ? asset.svgSource
        : path.resolve(process.cwd(), asset.svgSource);
      if (!fs.existsSync(resolvedPath)) {
        errors.push({
          rule: 11,
          entityId: asset.assetId,
          message: `Asset "${asset.assetId}" svgSource file not found on disk: "${asset.svgSource}"`,
        });
      } else {
        try {
          svgContent = fs.readFileSync(resolvedPath, "utf-8");
        } catch {
          // Read failed
        }
      }
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
          if (svgContent) {
            const hasId =
              svgContent.includes(`id="${sg.elementId}"`) ||
              svgContent.includes(`id='${sg.elementId}'`) ||
              svgContent.includes(`id=${sg.elementId}`);
            if (!hasId) {
              errors.push({
                rule: 16,
                entityId: asset.assetId,
                message: `RotatingSubGroup elementId "${sg.elementId}" not found in SVG document "${asset.svgSource}"`,
              });
            }
          }
        }
      }
    }
  }

  // Rules 6, 7, 10, 12, 13, 17, 18: Validate actors
  if (Array.isArray(scene.actors)) {
    for (const actor of scene.actors) {
      // Rule 6: rigId resolves to a rig in cast library
      const rig = getCharacterRigById(actor.rigId);
      if (!rig) {
        errors.push({
          rule: 6,
          entityId: actor.instanceId,
          message: `Actor "${actor.instanceId}" references unknown rigId "${actor.rigId}"`,
        });
      }

      // Rule 17: rigId has corresponding ModelSheet
      const modelSheet = getModelSheet(actor.rigId);
      if (!modelSheet) {
        errors.push({
          rule: 17,
          entityId: actor.instanceId,
          message: `Actor "${actor.instanceId}" rigId "${actor.rigId}" has no corresponding ModelSheet registered`,
        });
      }

      // Rule 10: scale > 0
      if (actor.scale !== undefined && (actor.scale <= 0 || isNaN(actor.scale))) {
        errors.push({
          rule: 10,
          entityId: actor.instanceId,
          message: `Actor "${actor.instanceId}" scale ${actor.scale} must be strictly positive (> 0)`,
        });
      }

      // Rule 19: Actor position falls within sceneSize bounds
      if (scene.sceneSize && actor.position) {
        if (
          actor.position.x < 0 ||
          actor.position.x > scene.sceneSize.w ||
          actor.position.y < 0 ||
          actor.position.y > scene.sceneSize.h
        ) {
          errors.push({
            rule: 19,
            entityId: actor.instanceId,
            message: `Actor "${actor.instanceId}" position (${actor.position.x}, ${actor.position.y}) is out of canvas bounds [0..${scene.sceneSize.w}, 0..${scene.sceneSize.h}]`,
          });
        }
      }

      // Rule 7: Every key in jointTracks resolves to CharacterGroup.id
      if (actor.jointTracks && rig) {
        const validGroupIds = new Set(rig.groups.map((g) => g.id));
        for (const [jointName, tr] of Object.entries(actor.jointTracks)) {
          if (!validGroupIds.has(jointName)) {
            errors.push({
              rule: 7,
              entityId: actor.instanceId,
              message: `Actor "${actor.instanceId}" jointTrack references unknown joint group "${jointName}" for rig "${actor.rigId}"`,
            });
          }
          validateTrack(tr, actor.instanceId, `joint-${jointName}`);
        }
      }

      // Validate positionTracks
      if (actor.positionTracks) {
        for (const tr of actor.positionTracks) validateTrack(tr, actor.instanceId, `pos-${tr.trackId}`);
      }

      // Rules 12, 13, 18: Validate actions
      if (actor.actions && Array.isArray(actor.actions)) {
        // Collect actions starting at each frame for Rule 18
        const actionsByStartFrame = new Map<number, typeof actor.actions>();

        for (const act of actor.actions) {
          // Rule 12: actionId resolves to action registry
          if (!ACTION_METADATA[act.actionId]) {
            errors.push({
              rule: 12,
              entityId: actor.instanceId,
              message: `Actor "${actor.instanceId}" references unknown actionId "${act.actionId}"`,
            });
          }

          // Rule 13: startFrame + durationFrames <= durationFrames
          if (
            act.startFrame < 0 ||
            act.durationFrames <= 0 ||
            act.startFrame + act.durationFrames > scene.durationFrames
          ) {
            errors.push({
              rule: 13,
              entityId: actor.instanceId,
              message: `Actor "${actor.instanceId}" action "${act.actionId}" interval [${act.startFrame}, ${act.startFrame + act.durationFrames}] exceeds scene durationFrames (${scene.durationFrames})`,
            });
          }

          if (!actionsByStartFrame.has(act.startFrame)) {
            actionsByStartFrame.set(act.startFrame, []);
          }
          actionsByStartFrame.get(act.startFrame)!.push(act);
        }

        // Rule 18: Simultaneous Action Collision Rule
        // Two ScheduledActions on the same actor sharing startFrame and any joint in common is an error
        for (const [startFrame, startActions] of actionsByStartFrame.entries()) {
          if (startActions.length > 1) {
            const jointOwners = new Map<string, string>(); // jointId -> actionId
            for (const act of startActions) {
              const affected = getAffectedJointsForAction(act);
              for (const joint of affected) {
                if (jointOwners.has(joint)) {
                  const existingActionId = jointOwners.get(joint)!;
                  errors.push({
                    rule: 18,
                    entityId: actor.instanceId,
                    message: `SIMULTANEOUS_ACTION_COLLISION: Actor "${actor.instanceId}" has simultaneous actions "${existingActionId}" and "${act.actionId}" starting at frame ${startFrame} both affecting joint "${joint}"`,
                  });
                } else {
                  jointOwners.set(joint, act.actionId);
                }
              }
            }
          }
        }
      }
    }
  }

  // Rule 14 (D4): durationFrames / fps * 1000 within ±50ms of audioDurationMs
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

  // Warning W1: Normalized Median Scale Warning
  // Normalize each actor's scale by its canonicalScale, compute median, warn if > ±40% deviation
  if (Array.isArray(scene.actors) && scene.actors.length > 0) {
    const normalizedScales: Array<{ actor: ActorInstance; normScale: number }> = [];
    for (const actor of scene.actors) {
      const ms = getModelSheet(actor.rigId);
      const canonical = ms?.canonicalScale || 1.0;
      const effectiveScale = actor.scale || 1.0;
      normalizedScales.push({
        actor,
        normScale: effectiveScale / canonical,
      });
    }

    // Compute median normalized scale
    const sortedNormScales = [...normalizedScales].sort((a, b) => a.normScale - b.normScale);
    const midIdx = Math.floor(sortedNormScales.length / 2);
    const medianNormScale =
      sortedNormScales.length % 2 === 0
        ? (sortedNormScales[midIdx - 1].normScale + sortedNormScales[midIdx].normScale) / 2
        : sortedNormScales[midIdx].normScale;

    if (medianNormScale > 0) {
      for (const item of normalizedScales) {
        const deviation = Math.abs(item.normScale - medianNormScale) / medianNormScale;
        if (deviation > 0.4) {
          warnings.push({
            warningId: "W1_SCALE_DEVIATION",
            entityId: item.actor.instanceId,
            message: `Actor "${item.actor.instanceId}" normalized scale (${item.normScale.toFixed(2)}) deviates by ${(deviation * 100).toFixed(1)}% from scene median (${medianNormScale.toFixed(2)}) (exceeds ±40% threshold)`,
          });
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
