/**
 * File Description: Blocking design rules over character-independent evaluated Three geometry in both output formats.
 * Inputs and outputs: film, scene and camera intentions -> shot/rule diagnostics before design persistence.
 * Used by: checkFilmDesign; legacy SVG films keep their existing checks.
 */
import type { Film } from "../../src/dl/schema";
import type { Scene } from "../../src/dl/scene/types";
import { prepareStageFacts } from "../../src/dl/scene/stageFacts";
import { rectInside, projectStagePoint, SAFE_SQUARE, type SceneRect } from "../../src/dl/scene/projection";
import { undeclaredMaterialColours } from "../../src/dl/scene/stageGeometry";
import { getInsetRegion, getStageSafeRegion } from "../../src/dl/fullScreenHeroLayout";
import { buildTimeline } from "../../src/dl/camera";
import { prepareSvgProjection } from "./insetRegion";
import type { DesignCheckContext, DesignFinding, DesignRule } from "./designCheck";

// Reports a real geometric overlap, excluding antialias fringe and edge touching.
function overlaps(a: SceneRect, b: SceneRect): boolean {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 2 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 2;
}

// Requires a settled camera through the aftermath, including rotation as well as pan and zoom.
function cameraHeld(a: { center: { x: number; y: number }; zoom: number; rotation: number }, b: typeof a): boolean {
  return Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) < 0.3 && Math.abs(a.zoom - b.zoom) < 1e-4 && Math.abs(a.rotation - b.rotation) < 1e-4;
}

// Checks the complete moving stage without using character names, joint ids or placement anchors.
export function checkThreeStage(film: Film, scene: Scene, context: DesignCheckContext): DesignFinding[] {
  const findings: DesignFinding[] = [], reported = new Set<string>();
  const timeline = buildTimeline(film);
  // Names the shot at the defective frame and deduplicates only within that shot and rule.
  const add = (rule: DesignRule, frame: number, format: string, id: string, message: string) => {
    const shot = timeline.find((s) => frame >= s.from && frame < s.to)?.shot.id ?? scene.performances?.find((p) => p.id === id || p.actor === id || p.prop === id)?.decisive.shotId ?? "unknown";
    const key = `${rule}/${format}/${id}/${shot}`;
    if (reported.has(key)) return;
    reported.add(key);
    findings.push({ rule, severity: "error", where: `shot ${shot} / ${format} / ${id} / frame ${frame}`, message });
  };
  const owners = new Set<string>();
  for (const p of scene.performances ?? []) {
    for (const id of [p.actor, p.prop]) {
      if (owners.has(id)) add("continuity", p.decisive.frame, "both", id, "cast object has duplicate performance writers; one identity must survive contact");
      owners.add(id);
    }
  }
  for (const [format, width, height] of [["long", 1920, 1080], ["reel", 1080, 1920]] as const) {
    let dispose: (() => void) | undefined, checkedFrame = 0;
    try {
      const facts = prepareStageFacts(scene, width, height);
      dispose = facts.dispose;
      const svgAt = scene.props.some((p) => p.plane === "foreground") ? prepareSvgProjection(scene, width, height) : undefined;
      const foregroundIds = new Set(scene.props.filter((p) => p.plane === "foreground").map((p) => p.assetId));
      const safe = getStageSafeRegion(format, width, height, film.captions !== "off");
      for (const material of facts.materials) {
        for (const colour of undeclaredMaterialColours(material.meshes, material.palette)) add("palette", 0, format, material.actor, `undeclared 3D material colour ${colour}; declare it in character ${material.character}'s palette`);
      }
      const held = new Map((scene.performances ?? []).map((p) => [p.id, 0]));
      const starts = new Map((scene.performances ?? []).map((p) => [p.id, Math.ceil(p.data.holdFromFrame)]));
      for (let frame = 0; frame < scene.durationFrames; frame++) {
        checkedFrame = frame;
        const poses = facts.at(frame, "prop");
        const shot = timeline.find((s) => frame >= s.from && frame < s.to)?.shot;
        const inset = getInsetRegion(format, width, height);
        const insetBox = { x0: inset.x, y0: inset.y, x1: inset.x + inset.w, y1: inset.y + inset.h };
        const foreground = svgAt?.(frame).filter((s) => foregroundIds.has(s.id)).flatMap((s) => s.parts.map((p) => ({ ...p, id: s.id }))) ?? [];
        for (const pose of poses) {
          let clear = true;
          for (const [id, bounds, parts] of [[pose.actor, pose.actorBounds, pose.actorParts], [pose.prop, pose.propBounds, pose.propParts]] as const) {
            if (!rectInside(bounds, safe)) {
              add("safe-area", frame, format, id, "full posed silhouette including outlines crosses the shared safe square, output margin or caption band; move or scale the cast");
              clear = false;
            }
            if (shot?.stage === "inset" && parts.some((p) => overlaps(p.bounds, insetBox))) {
              add("inset", frame, format, id, "moving mesh silhouette reaches the device inset; reposition the cast or device shot");
              clear = false;
            }
            for (const plane of foreground) if (parts.some((p) => overlaps(p.bounds, plane.bounds))) {
              add("occlusion", frame, format, id, `foreground SVG ${plane.id}/${plane.name} may obscure essential geometry; projected evidence cannot claim hidden art is visible`);
              clear = false;
            }
          }
          if (pose.propVisibility?.status !== "exposed") {
            add("occlusion", frame, format, pose.prop, `prop depth evidence is ${pose.propVisibility?.status ?? "unmeasured"}; no exposed geometry sample supports visibility (raster visibility remains unmeasured)`);
            clear = false;
          }
          const performance = scene.performances!.find((p) => p.id === pose.id)!;
          const start = starts.get(pose.id)!;
          if (frame >= start && frame < start + 2 * scene.fps && clear && pose.ownership === "attached" && pose.afterState === performance.afterState && cameraHeld(facts.camera[start], facts.camera[frame])) held.set(pose.id, held.get(pose.id)! + 1);
        }
        if (frame > 0) {
          const previous = facts.camera[frame - 1], current = facts.camera[frame];
          let peak = 0, acceleration = 0;
          for (const x of [SAFE_SQUARE.x0, SAFE_SQUARE.x1]) for (const y of [SAFE_SQUARE.y0, SAFE_SQUARE.y1]) {
            const a = projectStagePoint({ x, y }, previous, width, height, scene.sceneSize), b = projectStagePoint({ x, y }, current, width, height, scene.sceneSize);
            peak = Math.max(peak, Math.hypot(b.x - a.x, b.y - a.y) * scene.fps / width);
            if (frame > 1) {
              const before = projectStagePoint({ x, y }, facts.camera[frame - 2], width, height, scene.sceneSize);
              acceleration = Math.max(acceleration, Math.hypot(b.x - 2 * a.x + before.x, b.y - 2 * a.y + before.y) * scene.fps * scene.fps / width);
            }
          }
          if (peak > 0.2 + 1e-6) add("camera", frame, format, "scene.camera", `compiled pan/zoom/rotation moves projected stage by ${(peak * 100).toFixed(1)}% of output width/s, above 20%; slow the move for this crop`);
          if (acceleration > 0.3 + 1e-6) add("camera", frame, format, "scene.camera acceleration", `compiled projection accelerates at ${acceleration.toFixed(2)} output widths/s^2, above 0.3; soften the move for this crop`);
        }
      }
      for (const p of scene.performances ?? []) if (held.get(p.id)! < 2 * scene.fps) add("carry-over", starts.get(p.id)!, format, p.prop, `after-state ${p.afterState} needs two full seconds of clear projected carry during a settled camera hold after recovery`);
      for (const target of context.cameraTargets ?? []) if (target.focus && scene.cast?.some((c) => c.id === target.focus)) {
        const frame = Math.max(0, Math.min(scene.durationFrames - 1, Math.round(target.frame)));
        const pose = facts.at(frame, "all").find((p) => p.actor === target.focus || p.prop === target.focus);
        const bounds = pose?.actor === target.focus ? pose.actorBounds : pose?.propBounds;
        const depth = pose?.actor === target.focus ? pose.actorVisibility : pose?.propVisibility;
        if (target.authoredFocus !== target.focus || depth?.status !== "exposed" || !bounds || !rectInside(bounds, safe) || Math.hypot((bounds.x0 + bounds.x1) / 2 - width / 2, (bounds.y0 + bounds.y1) / 2 - height / 2) > Math.min(width, height) / 3) add("camera", frame, format, target.focus, "focused cast silhouette is cropped, hidden, unnamed in the authored pose or away from the camera's subject region");
      }
    } catch (error) {
      add("scene", checkedFrame, format, "three stage", error instanceof Error ? error.message : String(error));
    } finally { dispose?.(); }
  }
  return findings;
}
