/**
 * File Description: The studio's per-shot design actions.
 * `designOverview` gathers what the Look stage shows about a film's design: who made it, the idea,
 * the artwork, each asset's motion grouped by the shot it happens in, and why every shot got its
 * visual. `swapShotVisual` redraws one shot as another visual kind through the same honest path the
 * design stage uses (a StatCounter read from the narration, any other chart authored and checked).
 * `requestShotRedesign` sends the connected agent a design task focused on one shot.
 */

import type { Block, Film, Shot } from "../../src/dl/schema";
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
  shots: Array<{ id: string; startSec: number; endSec: number; says: string; shown: string[]; motion: MotionBeat[]; choice?: VisualChoice }>;
  status: DesignBuildStatus | null;
}

// Collects a film's design overview for the Look stage.
export function designOverview(film: Film): DesignOverview {
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
export async function requestShotRedesign(film: Film, shotId: string, note: string, inboxDir?: string) {
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
    ...(inboxDir ? { inboxDir } : {}),
  });
}

// Sends the connected agent a design task for the whole film (a film still on the template design).
export async function requestFilmDesign(film: Film) {
  writeDesignBrief(film.id);
  return dispatchTask({ eventType: "design_film", filmId: film.id, filmTitle: film.title, enableFallback: false });
}
