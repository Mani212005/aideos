/**
 * File Description: Shared CPU geometry projection and numerical evidence for the opt-in Three stage.
 * Inputs and outputs: validated scene and viewport -> per-frame posed bounds and truthful stage facts.
 * Used by: design checks, measured review and Gemini grounding. Raster visibility remains unmeasured.
 */
import { Box3, Vector3 } from "three";
import { createPerformanceEvaluator } from "../performance/evaluate";
import { IONA_RIG } from "../performance/iona";
import { critiquePerformance } from "../performance/critique";
import { createIona, applyIona } from "./rigs/iona";
import { projectStagePoint, type SceneRect } from "./projection";
import { compileCameraTrack } from "./cameraTrack";
import type { Scene } from "./types";
import { CEL_TREATMENT } from "./rigs/registry";

// Prepares private CPU geometry and evaluators once, then projects the actual posed mesh bounds without WebGL.
export function prepareStageFacts(scene: Scene, width: number, height: number) {
  const camera = compileCameraTrack(scene.camera, scene.durationFrames, scene.sceneSize);
  const entries = (scene.performances ?? []).map((p) => {
    const actor = scene.cast?.find((c) => c.id === p.actor && c.kind === "character");
    if (!actor || actor.kind !== "character") throw new Error(`performance ${p.id}: missing actor ${p.actor}`);
    const evaluate = createPerformanceEvaluator(IONA_RIG, p.data);
    return { p, actor, evaluate, art: createIona(), numerical: critiquePerformance(IONA_RIG, p.data, evaluate, p.decisive.frame) };
  });
  // Measures all transformed per-mesh box corners, including the outline extrusion allowance.
  const at = (frame: number) => entries.map(({ p, actor, evaluate, art }) => {
    const f = Math.min(scene.durationFrames - 1, Math.max(0, frame));
    const state = evaluate(f);
    applyIona(art, state);
    // Projects one set of actual mesh-space extents through its complete world matrix and stage placement.
    const bounds = (prop: boolean): SceneRect => {
      const pixels: Array<{ x: number; y: number }> = [];
      for (const mesh of Object.values(art.parts.meshes)) {
        const isProp = mesh.name.startsWith("glider");
        if (prop !== isProp) continue;
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox!.clone().expandByScalar(CEL_TREATMENT.outlineUnits);
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          const point = new Vector3(x, y, z).applyMatrix4(mesh.matrixWorld);
          pixels.push(projectStagePoint({ x: actor.position[0] + point.x * actor.unitsToStage, y: actor.position[1] - point.y * actor.unitsToStage }, camera[Math.floor(f)], width, height, scene.sceneSize));
        }
      }
      const box = new Box3().setFromPoints(pixels.map((v) => new Vector3(v.x, v.y, 0)));
      return { x0: box.min.x, y0: box.min.y, x1: box.max.x, y1: box.max.y };
    };
    return { id: p.id, actor: p.actor, prop: p.prop, phase: state.phase, ownership: state.contact.mode, afterState: state.contact.mode === "attached" ? p.afterState : "airborne", actorBounds: bounds(false), propBounds: bounds(true) };
  });
  return {
    at, camera,
    performances: entries.map(({ p, numerical }) => ({ id: p.id, actor: p.actor, prop: p.prop, decisive: p.decisive, anchors: p.data.anchors, afterState: p.afterState, numerical, visualQuality: "unmeasured" as const })),
    dispose: () => entries.forEach(({ art }) => art.dispose()),
  };
}

// Reports projected presence without claiming pixel visibility or depth occlusion was observed.
export function stageEvidence(scene: Scene, boundaryFrames: number[]) {
  return Object.fromEntries(([ ["long", 1920, 1080], ["reel", 1080, 1920] ] as const).map(([format, width, height]) => {
    const facts = prepareStageFacts(scene, width, height);
    try {
      return [format, { renderer: "three", viewport: { width, height }, cast: scene.cast, performances: facts.performances, boundaries: boundaryFrames.map((frame) => ({ frame, before: facts.at(frame - 1), after: facts.at(frame) })), visibilityProvenance: "projected geometry; pixel presence and depth occlusion unmeasured", facialAppeal: "unmeasured", fingerContact: "unmeasured" }];
    } finally { facts.dispose(); }
  }));
}
