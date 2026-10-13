/**
 * File Description: Rejects unsupported or inconsistent v2 cast/performance contracts without admitting legacy actors.
 * Inputs and outputs: Scene -> stage diagnostics naming asset, action and cue.
 * Used by: validateScene, design compiler and ThreeStage.
 */
import { castSchema, performanceSchema } from "./stageContract";
import { STAGE_RESOURCE_HASH } from "./rigs/registry";
import { createPerformanceEvaluator } from "../performance/evaluate";
import { IONA_RIG } from "../performance/iona";
import { critiquePerformance } from "../performance/critique";
import type { Scene } from "./types";

// Rejects missing bundled SVG planes rather than rendering the legacy placeholder as stage evidence.
export function validateStageSvgResources(scene: Scene, sources: Record<string, string>): string[] {
  return scene.renderer === "three" ? [scene.background, ...scene.props].flatMap((a) => sources[a.svgSource]?.trim() ? [] : [`Three stage ${a.assetId}: missing SVG resource ${a.svgSource}.`]) : [];
}

// Validates the deliberately narrow one-Iona, one-glider, one-receive stage and its numerical obligations.
export function validateStage(scene: Scene): string[] {
  const errors: string[] = [];
  if (scene.renderer !== "three") {
    if (scene.cast?.length || scene.performances?.length) errors.push("Three cast and performances require renderer three.");
    return errors;
  }
  if (scene.sceneSize.w !== 1920 || scene.sceneSize.h !== 1920) errors.push("Three stage requires the shared 1920 square.");
  if (scene.cast?.length !== 2 || scene.performances?.length !== 1) errors.push("P0 stage requires exactly one character, one prop and one receive writer.");
  const ids = new Set([scene.background.assetId, ...scene.props.map((p) => p.assetId)]);
  for (const item of scene.cast ?? []) {
    const parsed = castSchema.safeParse(item);
    if (!parsed.success) { errors.push(`cast ${item.id}: ${parsed.error.message}`); continue; }
    if (ids.has(item.id)) errors.push(`Duplicate cast/asset id ${item.id}.`);
    ids.add(item.id);
    if (item.resourceHash !== STAGE_RESOURCE_HASH) errors.push(`cast ${item.id}: missing or incompatible art/rig/material resource version.`);
  }
  for (const prop of scene.props) if (!prop.plane) errors.push(`SVG ${prop.assetId}: three stage requires explicit background/foreground plane.`);
  for (const p of scene.performances ?? []) {
    const parsed = performanceSchema.safeParse(p);
    if (!parsed.success) { errors.push(`performance ${p.id}: ${parsed.error.message}`); continue; }
    if (!scene.cast?.some((c) => c.id === p.actor && c.kind === "character")) errors.push(`performance ${p.id}: unknown character ${p.actor}.`);
    if (!scene.cast?.some((c) => c.id === p.prop && c.kind === "prop")) errors.push(`performance ${p.id}: unknown prop ${p.prop}.`);
    if (p.data.fps !== scene.fps) errors.push(`performance ${p.id}: action/film FPS mismatch.`);
    if (p.data.toFrame > scene.durationFrames || p.data.fromFrame < 0) errors.push(`performance ${p.id}: span exceeds narration.`);
    if (p.data.contact.frame !== p.decisive.frame) errors.push(`performance ${p.id}: contact differs from independent cue ${p.decisive.shotId}:"${p.decisive.phrase}".`);
    if (p.data.contact.frame - p.data.fromFrame < scene.fps) errors.push(`performance ${p.id}: preparation needs at least one second.`);
    if (Object.keys(p.data.secondary).sort().join(",") !== "coat,side,tuft") errors.push(`performance ${p.id}: unsupported or missing secondary channel.`);
    const tracks = [p.data.root.position, p.data.root.rotation, ...Object.values(p.data.positions), ...Object.values(p.data.rotations), ...Object.values(p.data.secondary), ...p.data.constraints.flatMap((c) => [c.target, c.pole, ...(c.tipRotation ? [c.tipRotation] : [])])];
    if ([...tracks.flat(), ...p.data.expressions].some((k) => k.frame < p.data.fromFrame || k.frame > p.data.toFrame)) errors.push(`performance ${p.id}: timed channel escapes span.`);
    try {
      const evaluate = createPerformanceEvaluator(IONA_RIG, p.data);
      const critique = critiquePerformance(IONA_RIG, p.data, evaluate, p.decisive.frame);
      for (const check of critique.checks.filter((c) => !c.passed)) errors.push(`performance ${p.id}: ${check.id} ${check.measured} exceeds ${check.limit} ${check.unit}.`);
    } catch (err) { errors.push(`performance ${p.id}: ${err instanceof Error ? err.message : String(err)}`); }
  }
  return errors;
}
