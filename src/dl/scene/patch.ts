/**
 * File Description: Pure transactional patch engine for the Aideos 2D Scene Graph (Phase 4).
 * Implements 12 granular patch operations with strict locality, validation gating, continuity gating,
 * and immutable state guarantees. (Axiom 1: pure data).
 */

import type { Scene, ActorInstance, Vec2 } from "./types";
import type { ActionParams } from "./actions";
import { validateScene } from "./validateScene";
import { compileScene } from "./compile";

export type PatchOp =
  | { op: "adjust_joint"; instanceId: string; joint: string; frame: number; deltaDegrees: number }
  | { op: "set_joint"; instanceId: string; joint: string; frame: number; valueDegrees: number }
  | { op: "retime_action"; instanceId: string; actionIndex: number; shiftFrames: number }
  | { op: "set_action"; instanceId: string; actionIndex: number; actionId: string; params: ActionParams }
  | { op: "move_entity"; entityId: string; to: Vec2 }
  | { op: "set_layer"; entityId: string; layer: number } // D5 explicit override
  | { op: "clear_layer"; entityId: string } // D5 revert to derived
  | { op: "set_scale"; entityId: string; scale: number }
  | { op: "set_facing"; instanceId: string; facing: "left" | "right" }
  | { op: "set_sub_rotation"; entityId: string; elementId?: string; degreesPerSecond: number } // D1
  | { op: "add_actor"; actor: ActorInstance }
  | { op: "remove_actor"; instanceId: string };

export interface PatchResult {
  scene: Scene;
  applied: PatchOp[];
  rejected: Array<{ op: PatchOp; reason: string }>;
  warnings: string[];
}

/**
 * Applies a batch of PatchOp operations to a Scene immutably.
 * Rejects invalid individual ops, and rolls back the entire patch if post-patch validation or continuity fails.
 * @param scene Input scene (never mutated).
 * @param ops Array of patch operations to apply in order.
 * @returns PatchResult containing the new scene or original on rollback.
 */
export function applyPatch(scene: Scene, ops: PatchOp[]): PatchResult {
  // Deep-clone scene to ensure 100% purity and immutability of input
  const workingScene: Scene = JSON.parse(JSON.stringify(scene));
  const applied: PatchOp[] = [];
  const rejected: Array<{ op: PatchOp; reason: string }> = [];
  const warnings: string[] = [];

  for (const op of ops) {
    try {
      switch (op.op) {
        case "adjust_joint":
        case "set_joint": {
          const actor = workingScene.actors.find((a) => a.instanceId === op.instanceId);
          if (!actor) {
            rejected.push({ op, reason: `Actor with instanceId "${op.instanceId}" not found in scene` });
            continue;
          }
          if (op.frame < 0 || op.frame >= workingScene.durationFrames) {
            rejected.push({
              op,
              reason: `Frame ${op.frame} is out of scene range [0, ${workingScene.durationFrames - 1}]`,
            });
            continue;
          }

          if (!actor.jointTracks) actor.jointTracks = {};
          if (!actor.jointTracks[op.joint]) {
            actor.jointTracks[op.joint] = { trackId: op.joint, keyframes: [] };
          }

          const track = actor.jointTracks[op.joint];
          const existingKf = track.keyframes.find((k) => k.frame === op.frame);
          if (existingKf) {
            existingKf.value = op.op === "adjust_joint" ? existingKf.value + op.deltaDegrees : op.valueDegrees;
          } else {
            const newVal = op.op === "adjust_joint" ? op.deltaDegrees : op.valueDegrees;
            track.keyframes.push({ frame: op.frame, value: newVal });
            track.keyframes.sort((a, b) => a.frame - b.frame);
          }
          applied.push(op);
          break;
        }

        case "retime_action": {
          const actor = workingScene.actors.find((a) => a.instanceId === op.instanceId);
          if (!actor) {
            rejected.push({ op, reason: `Actor with instanceId "${op.instanceId}" not found in scene` });
            continue;
          }
          if (!actor.actions || !actor.actions[op.actionIndex]) {
            rejected.push({
              op,
              reason: `Actor "${op.instanceId}" has no action at actionIndex ${op.actionIndex}`,
            });
            continue;
          }

          const action = actor.actions[op.actionIndex];
          const newStart = action.startFrame + op.shiftFrames;
          if (newStart < 0) {
            rejected.push({
              op,
              reason: `Shift of ${op.shiftFrames} frames pushes startFrame to negative value (${newStart})`,
            });
            continue;
          }
          if (newStart + action.durationFrames > workingScene.durationFrames) {
            rejected.push({
              op,
              reason: `Shift pushes action interval [${newStart}, ${newStart + action.durationFrames}] past available scene duration budget (${workingScene.durationFrames} frames). Scene duration is audio-locked (D4).`,
            });
            continue;
          }

          action.startFrame = newStart;
          applied.push(op);
          break;
        }

        case "set_action": {
          const actor = workingScene.actors.find((a) => a.instanceId === op.instanceId);
          if (!actor) {
            rejected.push({ op, reason: `Actor with instanceId "${op.instanceId}" not found in scene` });
            continue;
          }
          if (!actor.actions) actor.actions = [];
          if (op.actionIndex < 0 || op.actionIndex > actor.actions.length) {
            rejected.push({
              op,
              reason: `Invalid actionIndex ${op.actionIndex} (actions length: ${actor.actions.length})`,
            });
            continue;
          }

          const newAction = {
            actionId: op.actionId,
            startFrame: actor.actions[op.actionIndex]?.startFrame ?? 0,
            durationFrames: op.params.durationFrames,
            intensity: op.params.intensity,
            side: op.params.side,
          };

          if (op.actionIndex === actor.actions.length) {
            actor.actions.push(newAction);
          } else {
            actor.actions[op.actionIndex] = newAction;
          }
          applied.push(op);
          break;
        }

        case "move_entity": {
          // Check background, props, actors
          if (workingScene.background && workingScene.background.assetId === op.entityId) {
            workingScene.background.position = { ...op.to };
            applied.push(op);
            break;
          }
          const prop = workingScene.props?.find((p) => p.assetId === op.entityId);
          if (prop) {
            prop.position = { ...op.to };
            applied.push(op);
            break;
          }
          const actor = workingScene.actors.find((a) => a.instanceId === op.entityId);
          if (actor) {
            actor.position = { ...op.to };
            applied.push(op);
            break;
          }
          rejected.push({ op, reason: `Entity with entityId "${op.entityId}" not found in scene` });
          break;
        }

        case "set_layer": {
          let found = false;
          if (workingScene.background && workingScene.background.assetId === op.entityId) {
            workingScene.background.layer = op.layer;
            found = true;
          }
          const prop = workingScene.props?.find((p) => p.assetId === op.entityId);
          if (prop) {
            prop.layer = op.layer;
            found = true;
          }
          const actor = workingScene.actors.find((a) => a.instanceId === op.entityId);
          if (actor) {
            actor.layer = op.layer;
            found = true;
          }
          if (found) {
            applied.push(op);
          } else {
            rejected.push({ op, reason: `Entity "${op.entityId}" not found in scene for set_layer` });
          }
          break;
        }

        case "clear_layer": {
          let found = false;
          if (workingScene.background && workingScene.background.assetId === op.entityId) {
            delete workingScene.background.layer;
            found = true;
          }
          const prop = workingScene.props?.find((p) => p.assetId === op.entityId);
          if (prop) {
            delete prop.layer;
            found = true;
          }
          const actor = workingScene.actors.find((a) => a.instanceId === op.entityId);
          if (actor) {
            delete actor.layer;
            found = true;
          }
          if (found) {
            applied.push(op);
          } else {
            rejected.push({ op, reason: `Entity "${op.entityId}" not found in scene for clear_layer` });
          }
          break;
        }

        case "set_scale": {
          let found = false;
          if (workingScene.background && workingScene.background.assetId === op.entityId) {
            workingScene.background.scale = op.scale;
            found = true;
          }
          const prop = workingScene.props?.find((p) => p.assetId === op.entityId);
          if (prop) {
            prop.scale = op.scale;
            found = true;
          }
          const actor = workingScene.actors.find((a) => a.instanceId === op.entityId);
          if (actor) {
            actor.scale = op.scale;
            found = true;
          }
          if (found) {
            applied.push(op);
          } else {
            rejected.push({ op, reason: `Entity "${op.entityId}" not found in scene for set_scale` });
          }
          break;
        }

        case "set_facing": {
          const actor = workingScene.actors.find((a) => a.instanceId === op.instanceId);
          if (!actor) {
            rejected.push({ op, reason: `Actor with instanceId "${op.instanceId}" not found in scene` });
            continue;
          }
          actor.facing = op.facing;
          applied.push(op);
          break;
        }

        case "set_sub_rotation": {
          const asset =
            (workingScene.background?.assetId === op.entityId ? workingScene.background : null) ||
            workingScene.props?.find((p) => p.assetId === op.entityId);
          if (!asset) {
            rejected.push({ op, reason: `Asset "${op.entityId}" not found in scene for set_sub_rotation` });
            continue;
          }
          if (!asset.subGroups || asset.subGroups.length === 0) {
            rejected.push({ op, reason: `Asset "${op.entityId}" has no subGroups configured` });
            continue;
          }
          const subGroup = op.elementId
            ? asset.subGroups.find((sg) => sg.elementId === op.elementId)
            : asset.subGroups[0];
          if (!subGroup) {
            rejected.push({
              op,
              reason: `Subgroup "${op.elementId}" not found on asset "${op.entityId}"`,
            });
            continue;
          }
          delete subGroup.track;
          subGroup.degreesPerSecond = op.degreesPerSecond;
          applied.push(op);
          break;
        }

        case "add_actor": {
          if (workingScene.actors.some((a) => a.instanceId === op.actor.instanceId)) {
            rejected.push({
              op,
              reason: `Actor with duplicate instanceId "${op.actor.instanceId}" already exists in scene`,
            });
            continue;
          }
          if (workingScene.actors.length >= 15) {
            rejected.push({
              op,
              reason: `Cannot add actor: scene already at maximum ceiling of 15 articulated actors`,
            });
            continue;
          }
          workingScene.actors.push(JSON.parse(JSON.stringify(op.actor)));
          applied.push(op);
          break;
        }

        case "remove_actor": {
          const idx = workingScene.actors.findIndex((a) => a.instanceId === op.instanceId);
          if (idx === -1) {
            rejected.push({ op, reason: `Actor with instanceId "${op.instanceId}" not found in scene` });
            continue;
          }
          workingScene.actors.splice(idx, 1);
          applied.push(op);
          break;
        }

        default: {
          rejected.push({ op, reason: `Unknown patch operation: ${(op as PatchOp).op}` });
        }
      }
    } catch (err: unknown) {
      rejected.push({ op, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  // 2. Post-Patch Validation Gate (Atomic Rollback on Error)
  const validation = validateScene(workingScene);
  if (!validation.isValid) {
    const errorDetails = validation.errors.map((e) => `[Rule ${e.rule}] ${e.message}`).join("; ");
    return {
      scene: JSON.parse(JSON.stringify(scene)), // Rollback to original
      applied: [],
      rejected: [
        ...rejected,
        ...applied.map((op) => ({
          op,
          reason: `Patch transaction rolled back: Post-patch scene failed validation: ${errorDetails}`,
        })),
      ],
      warnings: validation.warnings.map((w) => w.message),
    };
  }

  // 3. Post-Patch Compilation & Continuity Gate (Atomic Rollback on Discontinuity)
  try {
    const compiled = compileScene(workingScene);
    warnings.push(...compiled.meta.warnings);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      scene: JSON.parse(JSON.stringify(scene)), // Rollback to original
      applied: [],
      rejected: [
        ...rejected,
        ...applied.map((op) => ({
          op,
          reason: `Patch transaction rolled back: Compiled scene failed continuity verification: ${errMsg}`,
        })),
      ],
      warnings: [],
    };
  }

  return {
    scene: workingScene,
    applied,
    rejected,
    warnings: Array.from(new Set([...warnings, ...validation.warnings.map((w) => w.message)])),
  };
}
