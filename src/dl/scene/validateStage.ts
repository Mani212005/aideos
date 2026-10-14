/**
 * File Description: Rejects unsupported or inconsistent v2 cast/performance contracts, unverified character specs and legacy actors.
 * Inputs and outputs: Scene -> stage diagnostics naming cast, character field, action and cue.
 * Used by: validateScene, design compiler and ThreeStage (which refuses to allocate geometry for an invalid stage).
 */
import { castSchema, isCharacterCast, performanceSchema, type CharacterCast } from "./stageContract";
import { STAGE_RESOURCE_HASH } from "./rigs/registry";
import { createPerformanceEvaluator } from "../performance/evaluate";
import { critiquePerformance } from "../performance/critique";
import { RECEIVE_EXPRESSIONS, RECEIVE_SECONDARY_CHANNELS } from "../performance/receive";
import { actionCompatibility, formatIssues, parseCharacter } from "../characters/validate";
import { characterRigId } from "../characters/hash";
import { rigFromCharacter } from "../characters/rig";
import type { Scene } from "./types";

/** What receive-v1 needs from any character that performs it. */
export const RECEIVE_NEEDS = { action: "receive-v1", expressions: RECEIVE_EXPRESSIONS, channels: RECEIVE_SECONDARY_CHANNELS } as const;

// Rejects missing bundled SVG planes rather than rendering the legacy placeholder as stage evidence.
export function validateStageSvgResources(scene: Scene, sources: Record<string, string>): string[] {
  return scene.renderer === "three" ? [scene.background, ...scene.props].flatMap((a) => sources[a.svgSource]?.trim() ? [] : [`Three stage ${a.assetId}: missing SVG resource ${a.svgSource}.`]) : [];
}

// Verifies one embedded character spec: schema, semantics, content hash and receive compatibility.
export function validateCastCharacter(cast: CharacterCast): string[] {
  const where = `cast ${cast.id} character ${cast.character.id}`;
  const parsed = parseCharacter(cast.character, { requireHash: true });
  if (!parsed.spec) return formatIssues(parsed.errors, `${where}: `);
  return [...formatIssues(parsed.errors, `${where}: `), ...formatIssues(actionCompatibility(parsed.spec, RECEIVE_NEEDS), `${where}: `)];
}

// Validates the stage's cast, every performer's verified character and each receive's numerical obligations.
export function validateStage(scene: Scene): string[] {
  const errors: string[] = [];
  if (scene.renderer !== "three") {
    if (scene.cast?.length || scene.performances?.length) errors.push("Three cast and performances require renderer three.");
    return errors;
  }
  if (scene.sceneSize.w !== 1920 || scene.sceneSize.h !== 1920) errors.push("Three stage requires the shared 1920 square.");
  if (!scene.performances?.length) errors.push("Three stage requires at least one receive performance.");
  const ids = new Set([scene.background.assetId, ...scene.props.map((p) => p.assetId)]);
  const verified = new Map<string, CharacterCast>();
  for (const item of scene.cast ?? []) {
    const parsed = castSchema.safeParse(item);
    if (!parsed.success) { errors.push(`cast ${item.id}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`); continue; }
    if (ids.has(item.id)) errors.push(`Duplicate cast/asset id ${item.id}.`);
    ids.add(item.id);
    if (item.resourceHash !== STAGE_RESOURCE_HASH) errors.push(`cast ${item.id}: missing or incompatible art/rig/material resource version.`);
    if (parsed.data.kind === "character" && !isCharacterCast(parsed.data)) {
      errors.push(`cast ${item.id}: compiled from the P0 Iona fixture (asset iona-art-v1) before characters were data; rebuild the design (aideos design-build <film>) so the film embeds the character spec.`);
      continue;
    }
    if (isCharacterCast(parsed.data)) {
      const problems = validateCastCharacter(parsed.data);
      errors.push(...problems);
      if (!problems.length) verified.set(item.id, parsed.data);
    }
  }
  for (const prop of scene.props) if (!prop.plane) errors.push(`SVG ${prop.assetId}: three stage requires explicit background/foreground plane.`);
  const actors = new Set<string>(), props = new Set<string>();
  for (const p of scene.performances ?? []) {
    const parsed = performanceSchema.safeParse(p);
    if (!parsed.success) { errors.push(`performance ${p.id}: ${parsed.error.message}`); continue; }
    const actor = scene.cast?.find((c) => c.id === p.actor && c.kind === "character");
    if (!actor) errors.push(`performance ${p.id}: unknown character ${p.actor}.`);
    if (!scene.cast?.some((c) => c.id === p.prop && c.kind === "prop")) errors.push(`performance ${p.id}: unknown prop ${p.prop}.`);
    if (actors.has(p.actor)) errors.push(`performance ${p.id}: ${p.actor} already performs another receive; one writer per character.`);
    if (props.has(p.prop)) errors.push(`performance ${p.id}: prop ${p.prop} is already owned by another performance.`);
    actors.add(p.actor); props.add(p.prop);
    if (p.data.fps !== scene.fps) errors.push(`performance ${p.id}: action/film FPS mismatch.`);
    if (p.data.toFrame > scene.durationFrames || p.data.fromFrame < 0) errors.push(`performance ${p.id}: span exceeds narration.`);
    if (p.data.contact.frame !== p.decisive.frame) errors.push(`performance ${p.id}: contact differs from independent cue ${p.decisive.shotId}:"${p.decisive.phrase}".`);
    if (p.data.contact.frame - p.data.fromFrame < scene.fps) errors.push(`performance ${p.id}: preparation needs at least one second.`);
    if (Object.keys(p.data.secondary).sort().join(",") !== [...RECEIVE_SECONDARY_CHANNELS].sort().join(",")) errors.push(`performance ${p.id}: unsupported or missing secondary channel.`);
    const tracks = [p.data.root.position, p.data.root.rotation, ...Object.values(p.data.positions), ...Object.values(p.data.rotations), ...Object.values(p.data.secondary), ...p.data.constraints.flatMap((c) => [c.target, c.pole, ...(c.tipRotation ? [c.tipRotation] : [])])];
    if ([...tracks.flat(), ...p.data.expressions].some((k) => k.frame < p.data.fromFrame || k.frame > p.data.toFrame)) errors.push(`performance ${p.id}: timed channel escapes span.`);
    const character = verified.get(p.actor)?.character;
    if (!character) continue;
    if (p.data.rigId !== characterRigId(character)) { errors.push(`performance ${p.id}: the action was fitted to rig ${p.data.rigId} but ${p.actor} is ${characterRigId(character)}; rebuild the design.`); continue; }
    try {
      const rig = rigFromCharacter(character);
      const evaluate = createPerformanceEvaluator(rig, p.data);
      const critique = critiquePerformance(rig, p.data, evaluate, p.decisive.frame);
      for (const check of critique.checks.filter((c) => !c.passed)) errors.push(`performance ${p.id}: ${check.id} ${check.measured} exceeds ${check.limit} ${check.unit}.`);
    } catch (err) { errors.push(`performance ${p.id}: ${err instanceof Error ? err.message : String(err)}`); }
  }
  for (const item of scene.cast ?? []) {
    if (item.kind === "character" && !actors.has(item.id)) errors.push(`cast ${item.id}: a character must perform; nothing would pose it.`);
    if (item.kind === "prop" && !props.has(item.id)) errors.push(`cast ${item.id}: a prop must belong to a performance; nothing would place it.`);
  }
  return errors;
}
