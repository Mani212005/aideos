/**
 * File Description: Renderer-independent look contract ledger and design judgment transitions.
 * Inputs and outputs: planned items and measured evidence -> legal item states and acceptance decisions.
 * Used by: designSpec/build.ts, designSpec/designer.ts and pipeline/run.ts.
 */


import type { Film } from "../../src/dl/schema";
import type { DesignSpec } from "../designSpec/spec";
import type { LookPlan } from "./schema";
import type { Cues } from "../sceneKit/timing";
import type { VisualChoices } from "../pipeline/visualChoices";
import { performanceStartIssue, resolveCue } from "../designSpec/cues";
import { CAMERA_CUE_LANDING_TOLERANCE_SECONDS } from "../../src/dl/scene/cameraTrack";

export type PlanItemState = "planned" | "bound" | "realized" | "dropped";
export type PlanItemKind = "cast" | "change" | "camera" | "performance" | "device" | "motion";

export interface PlanItem {
  id: string;
  kind: PlanItemKind;
  subject: string;
  state: PlanItemState;
  reason: string;
  binding?: string;
}

export type PlanItemEvent =
  | { type: "bind"; binding: string; reason: string }
  | { type: "realize"; reason: string }
  | { type: "drop"; reason: string };

// Creates the initial row for one independently enforceable look intention.
export function plannedItem(id: string, kind: PlanItemKind, subject: string): PlanItem {
  return { id, kind, subject, state: "planned", reason: "awaiting design evidence" };
}

// Applies only legal ledger transitions, keeping terminal rows immutable until the next build.
export function transitionPlanItem(item: PlanItem, event: PlanItemEvent): PlanItem {
  const legal = event.type === "bind" ? item.state === "planned"
    : event.type === "realize" ? item.state === "bound"
      : item.state === "planned" || item.state === "bound";
  if (!legal) throw new Error(`look contract ${item.id}: cannot ${event.type} from ${item.state}`);
  if (!event.reason.trim()) throw new Error(`look contract ${item.id}: a transition needs a reason`);
  if (event.type === "bind" && !event.binding.trim()) throw new Error(`look contract ${item.id}: binding is empty`);
  return { ...item, state: event.type === "bind" ? "bound" : event.type === "realize" ? "realized" : "dropped",
    reason: event.reason, ...(event.type === "bind" ? { binding: event.binding } : {}) };
}

// Reports every unresolved or dropped intention, so an empty error list proves full realization.
export function contractErrors(ledger: readonly PlanItem[]): string[] {
  return ledger.filter((item) => item.state !== "realized").map((item) =>
    `${item.id}: ${item.reason}`);
}

export interface CameraEvidence { frame: number; focus?: string }

// Binds only keyframes inside the shared cue tolerance, preferring the closest eligible pose.
export function matchCameraPose(target: CameraEvidence, poses: readonly CameraEvidence[], toleranceFrames: number): CameraEvidence | undefined {
  return poses.filter((pose) => Math.abs(pose.frame - target.frame) <= toleranceFrames)
    .reduce<CameraEvidence | undefined>((nearest, pose) => !nearest ||
      Math.abs(pose.frame - target.frame) < Math.abs(nearest.frame - target.frame) ? pose : nearest, undefined);
}

export type JudgeState = "passed" | "failed" | "skipped";
export type DesignJudgment = { state: "built" } | { state: "judged"; judge: JudgeState; reason: string };

// Records a judge ruling once per built design, rejecting contradictory or empty judgment evidence.
export function judgeBuiltDesign(current: DesignJudgment, evidence: { passed: boolean | null; skipped?: string }): DesignJudgment & { state: "judged" } {
  if (current.state !== "built") throw new Error("look contract: judgment requires a newly built design");
  if (evidence.skipped && evidence.passed !== null) throw new Error("look contract: skipped judgment cannot pass or fail");
  const judge = evidence.skipped || evidence.passed === null ? "skipped" : evidence.passed ? "passed" : "failed";
  return { state: "judged", judge, reason: evidence.skipped ?? (judge === "skipped" ? "visual judgment unavailable" : `vision judge ${judge}`) };
}

// Keeps unavailable visual evidence distinct from passing evidence and blocks failed designs.
export function designAcceptance(judge: JudgeState): "accepted" | "needs_design" | "unjudged" {
  return judge === "passed" ? "accepted" : judge === "failed" ? "needs_design" : "unjudged";
}

export interface LookEvidence {
  idsByAsset: ReadonlyMap<string, readonly string[]>;
  cues: Cues;
  choices: VisualChoices["shots"];
  collapsed?: ReadonlyMap<string, number>;
}

// Binds each planned intention to authored evidence, preserving a row and a reason for every refusal.
export function bindLookContract(film: Film, spec: DesignSpec, plan: LookPlan, evidence: LookEvidence): { ledger: PlanItem[]; errors: string[] } {
  const ledger: PlanItem[] = [], errors: string[] = [];
  const { idsByAsset, cues } = evidence;
  // Records one intention even when resolving its evidence throws.
  const assess = (id: string, kind: PlanItemKind, subject: string, verify: () => string | undefined): void => {
    const row = plannedItem(id, kind, subject);
    let reason: string | undefined;
    try { reason = verify(); } catch (error) { reason = error instanceof Error ? error.message : String(error); }
    ledger.push(transitionPlanItem(row, reason ? { type: "drop", reason } : { type: "bind", binding: subject, reason: "authored evidence matches the plan" }));
    if (reason) errors.push(reason);
  };
  // Tests whether a changing clip actually targets the planned cast object.
  const carries = (id: string, clip: DesignSpec["clips"][number]): boolean =>
    clip.from !== clip.to && (id === clip.asset || !!idsByAsset.get(clip.asset)?.includes(id) && clip.targets.some((target) => target === id || target === "*"));
  for (const item of plan.film.cast) {
    assess(`cast:${item.id}`, "cast", item.id, () => {
      if (!idsByAsset.has(item.id) && ![...idsByAsset.values()].some((ids) => ids.includes(item.id))) return `look cast "${item.id}" has no asset or SVG element in design.json`;
      if (plan.schema === "aideos.look/2") {
        const intended = plan.film.cast.find((cast) => cast.id === item.id)!;
        const authored = spec.assets.find((asset) => asset.id === item.id);
        const character = intended.character ?? (intended.asset === "iona-art-v1" ? "iona" : undefined);
        if (intended.renderer === "three" && (!authored || !("renderer" in authored) || authored.renderer !== "three" ||
          (authored.treatment ?? ("treatment" in spec ? spec.treatment : undefined) ?? "cel-v1") !== (intended.treatment ?? plan.film.treatment ?? "cel-v1") ||
          (authored.kind === "character" ? authored.character !== character : authored.asset !== intended.asset))) return `look cast ${item.id}: design identity or treatment mismatch`;
      }
      return undefined;
    });
    item.changes.forEach((change, index) => assess(`change:${item.id}:${index}`, "change", `${item.id} at ${change.at}`, () => {
      const hasClip = spec.clips.some((clip) => carries(item.id, clip) && resolveCue(clip.start, cues) < cues.to(change.at) && resolveCue(clip.end, cues) >= cues.from(change.at));
      const hasPerformance = plan.schema === "aideos.look/2" && "performances" in spec && spec.performances.some((performance) =>
        (performance.actor === item.id || performance.prop === item.id) && performance.decisive.shotId === change.at && (!change.state || performance.afterState === change.state));
      return hasClip || hasPerformance ? undefined : `look change ${item.id} at ${change.at}: planned state "${change.state ?? change.how}" has no changing clip or performance`;
    }));
  }
  if (plan.schema === "aideos.look/2") {
    if (!("performances" in spec)) errors.push("Three look requires aideos.design/2 performances.");
    if (("treatment" in spec ? spec.treatment ?? "cel-v1" : "cel-v1") !== (plan.film.treatment ?? "cel-v1")) errors.push("design.treatment: differs from look film.treatment");
    for (const shot of plan.shots) {
      const override = spec.shots?.[shot.id];
      const treatment = override && "stageTreatment" in override ? override.stageTreatment : undefined;
      if ((treatment ?? ("treatment" in spec ? spec.treatment : undefined) ?? "cel-v1") !== (shot.stageTreatment ?? plan.film.treatment ?? "cel-v1")) errors.push(`design.shots.${shot.id}.stageTreatment: differs from look shot stageTreatment`);
    }
    for (const intended of plan.film.performances) assess(`performance:${intended.id}`, "performance", intended.id, () => {
      const delivered = "performances" in spec ? spec.performances.filter((performance) => performance.id === intended.id) : [];
      if (delivered.length > 1) return `design performance "${intended.id}" is duplicated`;
      const actual = delivered[0];
      if (!actual || ["action", "actor", "prop", "start", "afterState"].some((key) => actual[key as keyof typeof actual] !== intended[key as keyof typeof intended]) ||
        actual.decisive.shotId !== intended.decisive.shotId || actual.decisive.phrase !== intended.decisive.phrase || actual.decisive.edge !== intended.decisive.edge || actual.decisive.event !== intended.decisive.event) return `look performance ${intended.id}: design differs from action, actor, prop, start, decisive cue or after-state intention`;
      return performanceStartIssue(intended, cues) ?? undefined;
    });
    const seen = new Set<string>();
    for (const delivered of "performances" in spec ? spec.performances : []) {
      if (seen.has(delivered.id)) errors.push(`design performance "${delivered.id}" is duplicated`);
      seen.add(delivered.id);
      if (!plan.film.performances.some((intended) => intended.id === delivered.id)) errors.push(`design performance "${delivered.id}" has no matching look performance`);
    }
  }
  for (const shot of plan.shots) {
    if (evidence.collapsed?.has(shot.id)) continue;
    if (shot.treatment === "scene" && !(plan.schema === "aideos.look/2" && "performances" in shot && shot.performances.length)) {
      assess(`motion:${shot.id}`, "motion", shot.id, () => {
        let cue: number;
        try { cue = cues.word(shot.id, shot.cue); } catch { return `look scene shot "${shot.id}" cue "${shot.cue}" was not found in narration word timings`; }
        const timely = spec.clips.some((clip) => {
          const frame = resolveCue(clip.start, cues);
          return shot.carries.some((id) => carries(id, clip)) && frame >= cues.from(shot.id) && frame < cues.to(shot.id) && Math.abs(frame - cue) / film.fps <= 0.4;
        });
        return timely ? undefined : `look scene shot "${shot.id}" cue "${shot.cue}" needs a changing clip on a carried object starting within 0.4s of the cue`;
      });
    }
    if (shot.treatment === "device") assess(`device:${shot.id}:${shot.device}`, "device", shot.device ?? shot.id, () => {
      const override = spec.shots?.[shot.id];
      if (override?.stage === "inset" && override.blocks?.some((block) => block.c === shot.device)) return undefined;
      const choice = evidence.choices[shot.id];
      const reason = choice?.device?.state === "refused" && (choice.rawChoice ?? choice.visual) === shot.device ? `; ${choice.device.reason}` : "";
      return `look device shot "${shot.id}" needs a matching "${shot.device}" shots override with stage "inset"${reason}; edit the look plan to change this intention`;
    });
  }
  plan.film.camera.forEach((pose, index) => assess(`camera:${index}`, "camera", pose.at, () => {
    // Three's fixed stage camera has a real establishing pose even without an authored move.
    const authored = spec.camera?.map((candidate) => ({ frame: Math.min(resolveCue(candidate.at, cues), cues.durationFrames - 1), focus: candidate.focus })) ??
      (plan.schema === "aideos.look/2" ? [{ frame: 0 }] : []);
    if (!authored.length) return "look camera poses require camera keyframes in design.json";
    const target = { frame: Math.min(resolveCue(pose.at, cues), cues.durationFrames - 1), focus: pose.focus };
    const match = matchCameraPose(target, authored, CAMERA_CUE_LANDING_TOLERANCE_SECONDS * film.fps);
    if (!match) return `look camera ${index} at ${pose.at}: no camera keyframe within ${CAMERA_CUE_LANDING_TOLERANCE_SECONDS}s of planned cue`;
    if (pose.focus && pose.focus !== match.focus) return `look camera ${index} at ${pose.at}: authored pose does not focus on "${pose.focus}"`;
    return undefined;
  }));
  return { ledger, errors };
}

// Advances bound intentions only after the compiled design passes its measured checks.
export function realizeLookContract(ledger: readonly PlanItem[], failures: ReadonlyMap<string, string> = new Map()): PlanItem[] {
  return ledger.map((item) => item.state !== "bound" ? item : transitionPlanItem(item,
    failures.has(item.id) ? { type: "drop", reason: failures.get(item.id)! } : { type: "realize", reason: "compiled design satisfies the planned intention" }));
}
