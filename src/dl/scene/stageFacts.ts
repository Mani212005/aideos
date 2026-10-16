/**
 * File Description: Shared CPU geometry projection and numerical evidence for the opt-in Three stage.
 * Inputs and outputs: validated scene and viewport -> per-frame posed bounds, sampled depth and truthful stage facts with character identity.
 * Used by: design checks, measured review and Gemini grounding. Raster visibility remains unmeasured.
 */
import { Group, type Mesh } from "three";
import { createPerformanceEvaluator } from "../performance/evaluate";
import { critiquePerformance } from "../performance/critique";
import { rigFromCharacter } from "../characters/rig";
import { characterRigId } from "../characters/hash";
import type { CharacterSpec } from "../characters/schema";
import { buildCharacter } from "./characters/build";
import { applyCharacter } from "./characters/apply";
import { applyProp, buildProp } from "./props/paperGlider";
import type { StageCast } from "./stageContract";
import { resolveStageCharacter } from "../characters/resolve";
import { projectMeshParts, unionPartBounds, sampleMeshDepth, stagePlacement } from "./stageGeometry";
import { declaredMaterialPalette } from "./stageMaterials";
import { compileCameraTrack } from "./cameraTrack";
import type { Scene } from "./types";
import { stageTreatmentAt } from "./materials/treatment";
import { CEL_TREATMENT } from "./rigs/registry";

/** Names a character by id, version, rig and content hash: what facts and prompts need, not its whole spec. */
export function characterIdentity(character: CharacterSpec) {
  return { id: character.id, version: character.version, name: character.name, rig: characterRigId(character), hash: character.hash ?? null };
}

/** Compact cast identity for facts and prompts. */
export function castIdentity(cast: StageCast) {
  if (cast.kind !== "character") return cast;
  const resolved = resolveStageCharacter(cast);
  if (!resolved) return cast;
  return { id: resolved.cast.id, renderer: resolved.cast.renderer, treatment: resolved.cast.treatment, resourceHash: resolved.cast.resourceHash, kind: resolved.cast.kind, position: resolved.cast.position, unitsToStage: resolved.cast.unitsToStage, depth: resolved.cast.depth, character: characterIdentity(resolved.spec) };
}

// Prepares private CPU geometry and evaluators once, then projects the actual posed mesh bounds without WebGL.
export function prepareStageFacts(scene: Scene, width: number, height: number) {
  const camera = compileCameraTrack(scene.camera, scene.durationFrames, scene.sceneSize);
  const entries = (scene.performances ?? []).map((p) => {
    const actor = scene.cast?.find((c) => c.id === p.actor && c.kind === "character");
    const resolved = actor?.kind === "character" ? resolveStageCharacter(actor) : undefined;
    if (!resolved) throw new Error(`performance ${p.id}: missing actor ${p.actor}`);
    const { cast: resolvedActor, spec: character } = resolved;
    const propCast = scene.cast?.find((c) => c.id === p.prop);
    if (!propCast || propCast.kind !== "prop") throw new Error(`performance ${p.id}: missing prop ${p.prop}`);
    const rig = rigFromCharacter(character);
    const evaluate = createPerformanceEvaluator(rig, p.data);
    const art = buildCharacter(character), prop = buildProp(propCast.asset), placement = new Group();
    placement.matrixAutoUpdate = false;
    placement.matrix.copy(stagePlacement(resolvedActor.position[0], resolvedActor.position[1], resolvedActor.depth, resolvedActor.unitsToStage, scene.sceneSize));
    placement.add(art.rig.root, prop.root);
    const actorMeshes = Object.values(art.parts.meshes), propMeshes = Object.values(prop.meshes);
    return { p, actor: resolvedActor, character, evaluate, art, prop, placement, actorMeshes, propMeshes, palette: declaredMaterialPalette(resolvedActor, propCast.asset), numerical: critiquePerformance(rig, p.data, evaluate, p.decisive.frame) };
  });
  // Applies every private pose before measuring, so all characters share the same depth query.
  const at = (frame: number, depth: false | "prop" | "all" = false) => {
    const f = Math.min(scene.durationFrames - 1, Math.max(0, frame));
    const evaluated = entries.map((entry) => {
      const state = entry.evaluate(f);
      applyCharacter(entry.art, state);
      applyProp(entry.prop, state);
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
      return { actor: e.p.actor, character: e.character.id, palette: e.palette, meshes };
    }),
    performances: entries.map(({ p, character, numerical }) => ({ id: p.id, actor: p.actor, character: characterIdentity(character), prop: p.prop, decisive: p.decisive, anchors: p.data.anchors, afterState: p.afterState, retarget: p.retarget ?? null, numerical, visualQuality: "unmeasured" as const })),
    dispose: () => entries.forEach(({ art, prop }) => { art.dispose(); prop.dispose(); }),
  };
}

// Reports projected presence without claiming pixel visibility or depth occlusion was observed.
export function stageEvidence(scene: Scene, boundaryFrames: number[]) {
  return Object.fromEntries(([ ["long", 1920, 1080], ["reel", 1080, 1920] ] as const).map(([format, width, height]) => {
    const facts = prepareStageFacts(scene, width, height);
    try {
      return [format, { renderer: "three", treatments: { default: scene.treatment ?? "cel-v1", spans: scene.treatments ?? [], cast: (scene.cast ?? []).map((c) => ({ id: c.id, treatment: stageTreatmentAt(scene, 0, c.treatment) })) }, viewport: { width, height }, cast: (scene.cast ?? []).map(castIdentity), performances: facts.performances, boundaries: boundaryFrames.map((frame) => ({ frame, before: facts.at(frame - 1, "all"), after: facts.at(frame, "all") })), visibilityProvenance: "projected geometry and sampled mesh depth; pixel presence and unsampled occlusion unmeasured; foreground obstruction requires the design gate", facialAppeal: "unmeasured", fingerContact: "unmeasured" }];
    } finally { facts.dispose(); }
  }));
}
