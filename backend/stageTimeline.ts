/**
 * File Description: Renderer-independent stage timeline with explicit motion and delivery segment transitions.
 * Inputs and outputs: film, format and compiled scene -> moving/holding spans within story/end-card segments and visible element identities.
 * Used by: design check, measured pacing, Gemini facts and pipeline verification.
 */
import fs from "node:fs";
import { resolveRepoAssetPath } from "../src/dl/videoPackageLoader";
import { buildTimeline } from "../src/dl/camera";
import { deliveryTimeline, type DeliveryFormat } from "../src/dl/delivery";
import type { Film } from "../src/dl/schema";
import { compileScene, type CompiledScene, type CompiledEntity } from "../src/dl/scene/compile";
import type { Scene } from "../src/dl/scene/types";
import { stageProjection } from "../src/dl/scene/projection";
import { elementVisible, VISIBLE_OPACITY_MIN } from "../src/dl/scene/visibility";
import { projectedSvgParts } from "./designCheck/insetRegion";
import { prepareStageFacts } from "../src/dl/scene/stageFacts";
import { partsInViewport } from "../src/dl/scene/stageGeometry";

export type StageState = { motion: "moving" | "holding"; segment: "story" | "end-card" };
export interface StageSpan extends StageState { from: number; to: number }
export interface TimeRange { start: number; end: number }
/** Shared maximum story stillness, seconds, for preflight and measured review. */
export const STORY_HOLD_MAX_SEC = 3;

// Applies the legal forward transitions; returning from the end card to the story is impossible.
export function transitionStage(state: StageState, next: StageState): StageState {
  if (state.segment === "end-card" && next.segment === "story") throw new Error("Invalid stage transition: end-card -> story");
  return next;
}

// Resolves story and end-card segments from the delivery contract, without compiling artwork.
export function stageSegments(film: Film, format: DeliveryFormat) {
  const delivery = deliveryTimeline(film, format);
  const segments: Array<{ segment: StageState["segment"]; from: number; to: number }> = [
    { segment: "story", from: 0, to: delivery.storyFrames },
    ...(delivery.card ? [{ segment: "end-card" as const, from: delivery.card.from, to: delivery.card.to }] : []),
  ];
  return { ...delivery, segments };
}

// Clips measured intervals to story time, retaining a run that crosses the card boundary only up to that boundary.
export function storyRanges(ranges: TimeRange[], storyEndSec: number): TimeRange[] {
  return ranges.map(({ start, end }) => ({ start: Math.max(0, start), end: Math.min(end, storyEndSec) })).filter((r) => r.end > r.start);
}

// Builds visible stage state from compiled curves, never from captions, pixels or a renderer's capture path.
export function stageTimeline(film: Film, format: DeliveryFormat, options: { compiled?: CompiledScene } = {}) {
  const delivery = stageSegments(film, format);
  const scene = film.scene as Scene | undefined;
  const compiled = scene ? options.compiled ?? compileScene(scene, { clockMs: 0 }) : undefined;
  const width = format === "long" ? 1920 : 1080, height = format === "long" ? 1080 : 1920;
  const performanceGeometry = scene?.performances?.length ? prepareStageFacts(scene, width, height) : undefined;
  // Projects only changed targets, preserving ancestor opacity and this output's crop.
  const inkAt = (entity: CompiledEntity, frame: number, targets?: ReadonlySet<string>) => {
    const current = compiled!.frames[frame];
    const camera = current.camera ?? { center: { x: scene!.sceneSize.w / 2, y: scene!.sceneSize.h / 2 }, zoom: 1, rotation: 0 };
    const matrix = stageProjection(camera, width, height, scene!.sceneSize);
    return projectedSvgParts(entity, matrix, undefined, { includeAncestry: true, minOpacity: VISIBLE_OPACITY_MIN, targets })
      .filter((part) => part.bounds.x1 > 0 && part.bounds.y1 > 0 && part.bounds.x0 < width && part.bounds.y0 < height)
      .map((part) => ({ ...part, signature: JSON.stringify([part.bounds, entity.transform.opacity,
        (part.ancestors ?? []).map((id) => [entity.elementStates?.[id], entity.subGroupRotations?.find((s) => s.elementId === id)])]) }));
  };
  const missingArtwork = new Set(compiled?.frames[0].entities.filter((entity) => !entity.svgSource || !fs.existsSync(resolveRepoAssetPath(entity.svgSource))).map((entity) => entity.entityId));
  // Lists compiled visible identities at a frame for continuity and review consumers.
  const visibleAt = (frame: number) => {
    if (!compiled) return [] as string[];
    const f = Math.max(0, Math.min(compiled.durationFrames - 1, frame));
    return compiled.frames[f].entities.flatMap((entity) => {
      // Facts can still describe declared targets when source-only callers have no artwork on disk.
      if (missingArtwork.has(entity.entityId)) {
        if (!elementVisible(entity.transform.opacity)) return [];
        const states = Object.entries(entity.elementStates ?? {});
        const visible = states.filter(([, state]) => elementVisible(state.opacity)).map(([id]) => `${entity.entityId}::${id}`);
        return states.length && !visible.length ? [] : [entity.entityId, ...visible];
      }
      const parts = inkAt(entity, f);
      return parts.length ? [entity.entityId, ...parts.flatMap((part) => (part.ancestors ?? []).map((id) => `${entity.entityId}::${id}`))] : [];
    });
  };
  const assets = new Map([...(scene?.background ? [scene.background] : []), ...(scene?.props ?? [])].map((asset) => [asset.assetId, asset]));
  const spans: StageSpan[] = [];
  for (let frame = 0; compiled && frame < delivery.storyFrames; frame++) {
    const f = Math.min(frame, compiled.durationFrames - 1), n = Math.min(frame + 1, compiled.durationFrames - 1);
    const current = compiled.frames[f], next = compiled.frames[n];
    let moving = JSON.stringify(current.camera) !== JSON.stringify(next.camera);
    for (let index = 0; !moving && index < current.entities.length; index++) {
      const before = current.entities[index], after = next.entities.find((entity) => entity.entityId === before.entityId)!;
      if (!elementVisible(before.transform.opacity) && !elementVisible(after.transform.opacity)) continue;
      const transformed = JSON.stringify(before.transform) !== JSON.stringify(after.transform);
      const candidates = new Set((before.subGroupRotations ?? []).map((s) => s.elementId));
      for (const clip of assets.get(before.entityId)?.animation?.clips ?? []) {
        clip.targets.forEach((target, index) => {
          const start = clip.startFrame + index * (clip.staggerFrames ?? 0);
          if (n >= start && f <= start + clip.durationFrames) candidates.add(target);
        });
      }
      const targets = new Set([...candidates].filter((id) =>
        JSON.stringify([before.elementStates?.[id], before.subGroupRotations?.find((s) => s.elementId === id)]) !==
        JSON.stringify([after.elementStates?.[id], after.subGroupRotations?.find((s) => s.elementId === id)])));
      if (!transformed && !targets.size) continue;
      moving = JSON.stringify(inkAt(before, f, transformed ? undefined : targets)) !== JSON.stringify(inkAt(after, n, transformed ? undefined : targets));
    }
    if (!moving && performanceGeometry) {
      // Returns changed geometry only when its projected rendered bounds intersect the output crop.
      const visibleParts = (frame: number) => performanceGeometry.at(frame, false, true).map((performance) => {
        const actorParts = partsInViewport(performance.actorParts, width, height);
        const propParts = partsInViewport(performance.propParts, width, height);
        return [
          ...(actorParts.length ? [["actor", actorParts.map((part) => [part.name, part.bounds, part.signature])] as const] : []),
          ...(propParts.length ? [["prop", propParts.map((part) => [part.name, part.bounds, part.signature])] as const] : []),
        ];
      });
      const before = visibleParts(f), after = visibleParts(n);
      moving = (before.length > 0 || after.length > 0) && JSON.stringify(before) !== JSON.stringify(after);
    }
    const state: StageState = { segment: "story", motion: moving ? "moving" : "holding" };
    const last = spans[spans.length - 1];
    if (last) transitionStage(last, state);
    if (last && last.motion === state.motion) last.to = frame + 1;
    else spans.push({ ...state, from: frame, to: frame + 1 });
  }
  if (delivery.card) {
    const state: StageState = { segment: "end-card", motion: "holding" };
    if (spans.length) transitionStage(spans[spans.length - 1], state);
    spans.push({ ...state, from: delivery.card.from, to: delivery.card.to });
  }
  const shots = buildTimeline(film, film.voiceover?.durationSec);
  const holds = spans.filter((span) => span.segment === "story" && span.motion === "holding" && span.to - span.from > STORY_HOLD_MAX_SEC * film.fps)
    .map((span) => ({ start: span.from / film.fps, end: span.to / film.fps, shots: shots.filter((shot) => shot.to > span.from && shot.from < span.to).map((shot) => shot.shot.id) }));
  performanceGeometry?.dispose();
  return { ...delivery, spans, holds, visibleAt };
}
