/**
 * File Description: The studio's design tools.
 * `designOverview` gathers the film's design, look plan, artwork, motion and shot visuals for the
 * Look stage. `approveLookPlan` records the captain's approval. `requestFilmDesign` sends the
 * connected agent a whole-film design task.
 * Inputs and outputs: shot tool command and parameters -> tool execution result.
 * Used by: editor/vite.config.ts (designOverview, approveLookPlan, requestFilmDesign), backend/designSpec/shotTools.test.ts.
 */

import { DEFAULT_FPS } from "../../src/dl/defaults";

import type { Film } from "../../src/dl/schema";
import fs from "node:fs";
import path from "node:path";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { parseLookPlan, type LookPlan } from "../lookPlan/schema";
import { readVisualChoices, type VisualChoice } from "../pipeline/visualChoices";
import { dispatchTask } from "../agentBridge/dispatcher";
import { readDesignStatus, type DesignBuildStatus } from "./build";
import { writeDesignBrief } from "./brief";
import { DEFAULT_PROJECT_ACCENT } from "../../src/projectTheme";

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
  const fps = film.scene?.fps ?? film.fps ?? DEFAULT_FPS;
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
    accent: film.accent ?? DEFAULT_PROJECT_ACCENT,
    artwork: (film.scene?.props ?? []).map((p) => ({ id: p.assetId, src: p.svgSource ?? p.raster?.src ?? "" })),
    ...lookResult,
    shots,
    status: readDesignStatus(film.id),
  };
}

// Sends the connected agent a design task for the whole film (a film still on the template design).
export async function requestFilmDesign(film: Film, ownerKey?: string) {
  writeDesignBrief(film.id);
  return dispatchTask({ eventType: "design_film", filmId: film.id, filmTitle: film.title, enableFallback: false, ...(ownerKey ? { ownerKey } : {}) });
}
