/**
 * File Description: The studio's per-shot design actions.
 * `designOverview` gathers the film's design, look plan, artwork, motion and shot visuals for the
 * Look stage. `approveLookPlan` records the captain's approval. `swapShotVisual` redraws one shot as
 * another visual kind through the design stage's honest authoring path. `requestShotRedesign` sends
 * the connected agent a design task focused on one shot.
 * Inputs and outputs: shot tool command and parameters -> tool execution result.
 * Used by: backend/agentBridge/dispatcher.ts, editor/vite.config.ts.
 * Inputs and outputs: shot tool command and parameters -> tool execution result.
 * Used by: backend/agentBridge/dispatcher.ts, editor/vite.config.ts.
 */

import type { Block, Film, Shot } from "../../src/dl/schema";
import fs from "node:fs";
import path from "node:path";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { parseLookPlan, type LookPlan } from "../lookPlan/schema";
import { SHOT_VISUALS, type ShotVisual } from "../jev";
import { buildBlocksForShotVisual } from "../pipeline/design";
import { authorDeviceData, AUTHORED_DEVICES, type DeviceLlmCaller, type DeviceReport } from "../pipeline/deviceData";
import { readVisualChoices, type VisualChoice } from "../pipeline/visualChoices";
import { narrationSupportsVisual } from "../shotVisualCues";
import { dispatchTask } from "../agentBridge/dispatcher";
import { readDesignStatus, type DesignBuildStatus } from "./build";
import { writeDesignBrief } from "./brief";

/** One animated change, placed in the shot where it starts. */
export interface MotionBeat {
  asset: string;
  clip: string;
  property: string;
  targets: string[];
  startSec: number;
  endSec: number;
}

/** Everything the studio shows about one film's design. */
export interface DesignOverview {
  design: Film["design"] | null;
  accent: string;
  artwork: Array<{ id: string; src: string }>;
  look: { plan: LookPlan; markdown: string | null } | null;
  lookError: string | null;
  shots: Array<{ id: string; startSec: number; endSec: number; says: string; shown: string[]; motion: MotionBeat[]; choice?: VisualChoice }>;
  status: DesignBuildStatus | null;
}

// Loads the checked look plan and its human-readable companion from the film package.
function readLookOverview(filmId: string): { look: DesignOverview["look"]; lookError: string | null } {
  const designDir = path.join(resolvePackageDir(filmId), "design");
  const planFile = path.join(designDir, "look.json");
  if (!fs.existsSync(planFile)) return { look: null, lookError: null };
  try {
    const plan = parseLookPlan(JSON.parse(fs.readFileSync(planFile, "utf8")));
    const markdownFile = path.join(designDir, "LOOK.md");
    return {
      look: { plan, markdown: fs.existsSync(markdownFile) ? fs.readFileSync(markdownFile, "utf8") : null },
      lookError: null,
    };
  } catch (err) {
    return { look: null, lookError: err instanceof Error ? err.message : String(err) };
  }
}

// Records the captain's approval in the authoritative look.json file.
export function approveLookPlan(filmId: string): LookPlan {
  const planFile = path.join(resolvePackageDir(filmId), "design", "look.json");
  if (!fs.existsSync(planFile)) throw new Error(`film "${filmId}" has no design/look.json`);
  const plan = parseLookPlan(JSON.parse(fs.readFileSync(planFile, "utf8")));
  const approved = parseLookPlan({ ...plan, approval: { ...plan.approval, captain: "Captain" } });
  fs.writeFileSync(planFile, `${JSON.stringify(approved, null, 2)}\n`, "utf8");
  return approved;
}

// Collects a film's design overview for the Look stage.
export function designOverview(film: Film): DesignOverview {
  const lookResult = readLookOverview(film.id);
  const fps = film.scene?.fps ?? film.fps ?? 30;
  const motion: MotionBeat[] = [];
  for (const prop of film.scene?.props ?? []) {
    for (const clip of prop.animation?.clips ?? []) {
      motion.push({
        asset: prop.assetId,
        clip: clip.clipId,
        property: clip.property,
        targets: clip.targets,
        startSec: clip.startFrame / fps,
        endSec: (clip.startFrame + clip.durationFrames) / fps,
      });
    }
  }
  const choices = readVisualChoices(film.id)?.shots ?? {};
  let t = 0;
  const shots = film.shots.map((shot) => {
    const startSec = t;
    t += shot.dur;
    return {
      id: shot.id,
      startSec,
      endSec: t,
      says: shot.scriptText ?? "",
      shown: shot.blocks.map((b) => b.c),
      motion: motion.filter((m) => m.startSec >= startSec - 1e-6 && m.startSec < t - 1e-6).sort((a, b) => a.startSec - b.startSec),
      ...(choices[shot.id] ? { choice: choices[shot.id] } : {}),
    };
  });
  return {
    design: film.design ?? null,
    accent: film.accent ?? "#635BFF",
    artwork: (film.scene?.props ?? []).map((p) => ({ id: p.assetId, src: p.svgSource })),
    ...lookResult,
    shots,
    status: readDesignStatus(film.id),
  };
}

// Recovers the on-screen copy a shot was built from (its headline, then its support line).
function onscreenCopy(shot: Shot): string[] {
  const out: string[] = [];
  for (const b of shot.blocks) if ((b.c === "TextReveal" || b.c === "Body") && b.text) out.push(b.text);
  return out;
}

/** The redrawn shot, or why the visual could not be drawn. */
export interface ShotSwap {
  ok: boolean;
  blocks: Block[];
  stage: Shot["stage"];
  report?: DeviceReport;
  reason?: string;
}

// Redraws one shot as another visual kind. Returns the new blocks; the caller commits them.
export async function swapShotVisual(film: Film, shotId: string, visual: string, caller: DeviceLlmCaller | null): Promise<ShotSwap> {
  const shot = film.shots.find((s) => s.id === shotId);
  const fail = (reason: string): ShotSwap => ({ ok: false, blocks: shot?.blocks ?? [], stage: shot?.stage ?? "frame", reason });
  if (!shot) return fail(`the film has no shot "${shotId}"`);
  if (!(SHOT_VISUALS as readonly string[]).includes(visual)) return fail(`"${visual}" is not a shot visual`);
  const kind = visual as ShotVisual;
  const narration = shot.scriptText ?? "";
  const onscreen = onscreenCopy(shot);
  if (onscreen.length === 0) return fail("the shot has no on-screen copy for a chart to sit under");

  let authored: Block | undefined;
  let report: DeviceReport | undefined;
  if (AUTHORED_DEVICES.includes(kind)) {
    if (!narrationSupportsVisual(kind, narration)) return fail(`the narration never describes anything a ${kind} would show`);
    if (!caller) return fail("no chart data model is configured (set GEMINI_API_KEY)");
    const result = await authorDeviceData([{ key: shotId, narration, onscreen, kinds: [kind] }], caller);
    authored = result.blocks.get(`${shotId}:${kind}`);
    const refusal = result.refusals.get(`${shotId}:${kind}`);
    report = authored ? { kind, state: "authored" } : { kind, state: "refused", reason: refusal };
    if (!authored) return { ...fail(refusal ?? "the chart could not be authored"), report };
  }
  const blocks = buildBlocksForShotVisual(kind, narration, onscreen, authored);
  const drewDevice = kind !== "Text" && blocks.some((b) => b.c === kind);
  if (kind !== "Text" && !drewDevice) return fail(`the narration carries no ${kind} data`);
  return { ok: true, blocks, stage: drewDevice ? "anchor" : "frame", ...(report ? { report } : {}) };
}

// Sends the connected agent a design task focused on one shot. Refreshes the brief first so the
// agent reads the film as it is now.
export async function requestShotRedesign(
  film: Film,
  shotId: string,
  note: string,
  options: { inboxDir?: string; ownerKey?: string } = {},
) {
  const shot = film.shots.find((s) => s.id === shotId);
  if (!shot) throw new Error(`the film has no shot "${shotId}"`);
  writeDesignBrief(film.id);
  return dispatchTask({
    eventType: "design_film",
    filmId: film.id,
    filmTitle: film.title,
    customInstruction: note.trim() || undefined,
    metadata: { shotId, says: shot.scriptText ?? "" },
    enableFallback: false,
    ...(options.inboxDir ? { inboxDir: options.inboxDir } : {}),
    ...(options.ownerKey ? { ownerKey: options.ownerKey } : {}),
  });
}

// Sends the connected agent a design task for the whole film (a film still on the template design).
export async function requestFilmDesign(film: Film, ownerKey?: string) {
  writeDesignBrief(film.id);
  return dispatchTask({ eventType: "design_film", filmId: film.id, filmTitle: film.title, enableFallback: false, ...(ownerKey ? { ownerKey } : {}) });
}
