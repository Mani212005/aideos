/**
 * File Description: Prompt generator for LLM Scene Authoring and Targeted Patch Revision (Phase 5).
 * Dynamically injects cast libraries, canonical model sheets (D2), action registries (D3),
 * audio clocking frame budgets (D4), and D5 layer rules into system prompts with zero registry drift.
 */

import { getAllCharacterRigs } from "../../src/dl/characters";
import { MODEL_SHEETS } from "../../src/dl/scene/modelSheet";
import { ACTION_METADATA } from "../../src/dl/scene/actions";
import type { Scene } from "../../src/dl/scene/types";

export interface ScenePromptContext {
  audioSource: string;
  audioDurationMs: number;
  fps?: number;
  sceneSize?: { w: number; h: number };
}

/**
 * Builds the system authoring prompt for generating a complete new Scene graph.
 * Dynamically binds cast library, model sheets, action registries, and audio clocking.
 */
export function buildSceneAuthoringPrompt(userDescription: string, ctx: ScenePromptContext): string {
  const fps = ctx.fps || 30;
  const durationFrames = Math.round((ctx.audioDurationMs / 1000) * fps);
  const size = ctx.sceneSize || { w: 1920, h: 1080 };

  // 1. Programmatically serialize Cast Library & Model Sheets (D2)
  const rigs = getAllCharacterRigs();
  const castList = rigs
    .map((r) => {
      const ms = MODEL_SHEETS[r.id];
      return `- **rigId**: "${r.id}" (${r.name}) | Canonical Height: ${ms?.canonicalHeight || 400}px | Canonical Scale: ${ms?.canonicalScale || 1.0} | Ref Pose: "${ms?.referencePose || "idle"}" | Facing: "${ms?.defaultFacing || "right"}"`;
    })
    .join("\n");

  // 2. Programmatically serialize Action Registry (D3)
  const actionList = Object.entries(ACTION_METADATA)
    .map(([id, meta]) => {
      return `- **actionId**: "${id}" | Description: ${meta.description} | Affected Joints: [${meta.affectedJoints("right").join(", ")}]`;
    })
    .join("\n");

  return `You are the Aideos 2D Scene Graph Architect.
Your task is to author a complete, valid Scene JSON object clocked to the provided voiceover audio.

---
### AUDIO & MASTER CLOCK SPECIFICATIONS (Axiom 2 / D4)
- **Audio Source**: "${ctx.audioSource}"
- **Audio Duration**: ${ctx.audioDurationMs} ms
- **Frame Rate**: ${fps} FPS
- **Duration Frames Budget**: Exactly ${durationFrames} frames (Must match audio duration within ±50ms)
- **Virtual Scene Canvas**: ${size.w} x ${size.h} pixels

---
### AVAILABLE CAST LIBRARY & CANONICAL MODEL SHEETS (D2)
${castList}

---
### AVAILABLE MOTION VOCABULARY ACTIONS (D3)
The LLM emits action specifications and entity placements. NEVER emit raw per-frame numeric angles.
${actionList}

---
### SCENE GRAPH ARCHITECTURE & RULES
1. **Schema Version**: "1.0.0"
2. **Layer Ordering (D5)**: Omit 'layer' property on actors and props by default so the compiler derives layering automatically from scene-space Y (nearer objects render in front). Set explicit 'layer' integer only if overriding (e.g. background occluder, flying bird, lying down).
3. **Actor Limits**: At most 15 articulated actors per scene.
4. **Action Scheduling**: Each actor has an 'actions' array. Every action must have startFrame >= 0 and startFrame + durationFrames <= ${durationFrames}.
5. **No Collision Rule (Rule 18)**: NEVER schedule two actions on the same actor sharing the exact same startFrame and overlapping joints.
6. **Environment Props (D1)**: Background and props must specify valid committed svgSource file paths. Rotating subgroups (wheels, fans) use 'subGroups'.

---
### USER SCENE REQUEST:
"${userDescription}"

Emit ONLY valid, parseable JSON conforming strictly to the Scene schema.`;
}

/**
 * Builds the revision prompt for targeted critique refinement into PatchOp[] operations.
 */
export function buildSceneRevisionPrompt(currentScene: Scene, userCritique: string): string {
  return `You are the Aideos Scene Revision Specialist.
The user has provided a critique of an existing Scene.
Your task is to emit a targeted JSON array of PatchOp operations to refine the scene.
DO NOT regenerate the whole scene. Emit ONLY a JSON array of PatchOp objects.

---
### CURRENT SCENE DATA:
\`\`\`json
${JSON.stringify(currentScene, null, 2)}
\`\`\`

---
### AVAILABLE PATCH OPERATIONS:
1. { "op": "adjust_joint", "instanceId": string, "joint": string, "frame": number, "deltaDegrees": number }
2. { "op": "set_joint", "instanceId": string, "joint": string, "frame": number, "valueDegrees": number }
3. { "op": "retime_action", "instanceId": string, "actionIndex": number, "shiftFrames": number }
4. { "op": "set_action", "instanceId": string, "actionIndex": number, "actionId": string, "params": { "durationFrames": number, "intensity": number, "side"?: "left"|"right" } }
5. { "op": "move_entity", "entityId": string, "to": { "x": number, "y": number } }
6. { "op": "set_layer", "entityId": string, "layer": number }
7. { "op": "clear_layer", "entityId": string }
8. { "op": "set_scale", "entityId": string, "scale": number }
9. { "op": "set_facing", "instanceId": string, "facing": "left" | "right" }
10. { "op": "set_sub_rotation", "entityId": string, "elementId"?: string, "degreesPerSecond": number }
11. { "op": "add_actor", "actor": ActorInstance }
12. { "op": "remove_actor", "instanceId": string }

---
### USER CRITIQUE:
"${userCritique}"

Emit ONLY a raw JSON array of PatchOp objects (e.g. \`[ { "op": "retime_action", ... } ]\`).`;
}
