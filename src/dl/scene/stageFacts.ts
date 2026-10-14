/**
 * File Description: Shared CPU geometry projection and numerical evidence for the opt-in Three stage.
 * Inputs and outputs: validated scene and viewport -> per-frame posed bounds and truthful stage facts.
 * Used by: design checks, measured review and Gemini grounding. Raster visibility remains unmeasured.
 */
import { Group, type Mesh } from "three";
import { createPerformanceEvaluator } from "../performance/evaluate";
import { IONA_RIG } from "../performance/iona";
import { critiquePerformance } from "../performance/critique";
import { createIona, applyIona } from "./rigs/iona";
import { projectMeshParts, unionPartBounds, sampleMeshDepth, stagePlacement } from "./stageGeometry";
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
    const art = createIona(), placement = new Group();
    placement.matrixAutoUpdate = false;
    placement.matrix.copy(stagePlacement(actor.position[0], actor.position[1], actor.depth, actor.unitsToStage, scene.sceneSize));
    placement.add(art.rig.root, art.rig.glider);
    const propMeshes: Mesh[] = [];
    art.rig.glider.traverse((node) => { if ((node as Mesh).isMesh && Object.values(art.parts.meshes).includes(node as Mesh)) propMeshes.push(node as Mesh); });
    const actorMeshes = Object.values(art.parts.meshes).filter((mesh) => !propMeshes.includes(mesh));
    return { p, actor, evaluate, art, placement, actorMeshes, propMeshes, numerical: critiquePerformance(IONA_RIG, p.data, evaluate, p.decisive.frame) };
  });
  // Applies every private pose before measuring, so all characters share the same depth query.
  const at = (frame: number, depth: false | "prop" | "all" = false) => {
    const f = Math.min(scene.durationFrames - 1, Math.max(0, frame));
    const evaluated = entries.map((entry) => {
      const state = entry.evaluate(f);
      applyIona(entry.art, state);
      entry.placement.updateMatrixWorld(true);
      return { ...entry, state };
    });
    const meshes = entries.flatMap((e) => [...e.actorMeshes, ...e.propMeshes]);
    return evaluated.map(({ p, actorMeshes, propMeshes, state }) => {
      const actorParts = projectMeshParts(actorMeshes, camera[Math.floor(f)], width, height, scene.sceneSize, CEL_TREATMENT.outlineUnits);
      const propParts = projectMeshParts(propMeshes, camera[Math.floor(f)], width, height, scene.sceneSize, CEL_TREATMENT.outlineUnits);
      const actorBounds = unionPartBounds(actorParts), propBounds = unionPartBounds(propParts);
      if (!actorBounds || !propBounds) throw new Error(`performance ${p.id}: ${!actorBounds ? p.actor : p.prop} has no drawable geometry at frame ${frame}`);
      return { id: p.id, actor: p.actor, prop: p.prop, phase: state.phase, ownership: state.contact.mode, afterState: state.contact.mode === "attached" ? p.afterState : "airborne", actorBounds, propBounds, actorParts, propParts,
        actorVisibility: depth === "all" ? sampleMeshDepth(actorMeshes, meshes) : undefined,
        propVisibility: depth ? sampleMeshDepth(propMeshes, meshes) : undefined,
        visibilityProvenance: "projected posed vertices with outline allowance; raster visibility unmeasured" as const };
    });
  };
  return {
    at, camera, materials: entries.map((e) => {
      const meshes: Mesh[] = [];
      e.placement.traverse((node) => { if ((node as Mesh).isMesh) meshes.push(node as Mesh); });
      return { actor: e.p.actor, asset: e.actor.asset, meshes };
    }),
    performances: entries.map(({ p, numerical }) => ({ id: p.id, actor: p.actor, prop: p.prop, decisive: p.decisive, anchors: p.data.anchors, afterState: p.afterState, numerical, visualQuality: "unmeasured" as const })),
    dispose: () => entries.forEach(({ art }) => art.dispose()),
  };
}

// Reports projected presence without claiming pixel visibility or depth occlusion was observed.
export function stageEvidence(scene: Scene, boundaryFrames: number[]) {
  return Object.fromEntries(([ ["long", 1920, 1080], ["reel", 1080, 1920] ] as const).map(([format, width, height]) => {
    const facts = prepareStageFacts(scene, width, height);
    try {
      return [format, { renderer: "three", viewport: { width, height }, cast: scene.cast, performances: facts.performances, boundaries: boundaryFrames.map((frame) => ({ frame, before: facts.at(frame - 1, "all"), after: facts.at(frame, "all") })), visibilityProvenance: "projected geometry and sampled mesh depth; pixel presence and unsampled occlusion unmeasured; foreground obstruction requires the design gate", facialAppeal: "unmeasured", fingerContact: "unmeasured" }];
    } finally { facts.dispose(); }
  }));
}
