/**
 * File Description: Records why each shot shows what it shows.
 * The design stage writes videos/<id>/design/visual-choices.json: for every shot Jev was asked
 * about, the visual it picked, its confidence and runner-ups, whether the pick survived gating,
 * and whether the chart's data was authored or why it was refused. The studio reads it to explain
 * a shot ("why this visual") and to offer the runner-ups as swaps.
 */

import fs from "node:fs";
import path from "node:path";
import type { Film } from "../../src/dl/schema";
import type { ShotVisualResult } from "../jev";
import type { DeviceReport } from "./deviceData";

const REPO_ROOT = path.resolve(__dirname, "../..");

/** One shot's recorded visual decision. */
export interface VisualChoice extends ShotVisualResult {
  /** The block kinds the shot finally carries, in order. */
  shown: string[];
  device?: DeviceReport;
}

/** The whole file. */
export interface VisualChoices {
  filmId: string;
  at: string;
  shots: Record<string, VisualChoice>;
}

// Returns the file path for a film's visual choices.
export function visualChoicesFile(filmId: string): string {
  return path.join(REPO_ROOT, "videos", filmId, "design", "visual-choices.json");
}

// Writes the visual choices for a freshly compiled film.
export function writeVisualChoices(
  filmId: string,
  film: Film,
  decisions: Map<string, ShotVisualResult>,
  devices: Map<string, DeviceReport>,
): VisualChoices {
  const shots: Record<string, VisualChoice> = {};
  for (const shot of film.shots) {
    const decision = decisions.get(shot.id);
    if (!decision) continue;
    const device = devices.get(shot.id);
    shots[shot.id] = { ...decision, shown: shot.blocks.map((b) => b.c), ...(device ? { device } : {}) };
  }
  const out: VisualChoices = { filmId, at: new Date().toISOString(), shots };
  const file = visualChoicesFile(filmId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  return out;
}

// Reads a film's visual choices, or null when the design stage never recorded any.
export function readVisualChoices(filmId: string): VisualChoices | null {
  const file = visualChoicesFile(filmId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as VisualChoices;
  } catch {
    return null;
  }
}
