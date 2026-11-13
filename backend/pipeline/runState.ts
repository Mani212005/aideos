/**
 * File Description: Loads and saves a package's run-state.json for the run state machine. Saves are
 * atomic (temp file then rename), a corrupt file is moved aside and reported instead of silently
 * replaced, and a stage left `running` by a dead process is closed as interrupted while a stage owned
 * by a live run is refused as already in flight.
 * Inputs and outputs: slug, title and run id -> RunState plus notices; RunState -> run-state.json.
 * Used by: backend/pipeline/run.ts.
 */

import fs from "fs";
import path from "path";
import { packageDir } from "./filmStore";
import { applyStageEvent } from "./runMachine";
import { PRODUCTION_STAGES, ProductionError, type RunState, type StageRecord } from "./types";

const STATES = new Set(["pending", "running", "done", "failed", "needs_input"]);

/** Where the run state for a package lives. */
export function runStatePath(slug: string): string {
  return path.join(packageDir(slug), "run-state.json");
}

// True when a stage record has a known stage name and state.
function validRecord(value: unknown): value is StageRecord {
  const record = value as Partial<StageRecord> | null;
  return typeof record === "object" && record !== null &&
    (PRODUCTION_STAGES as readonly string[]).includes(record.stage as string) && STATES.has(record.status as string);
}

// True when a process with this id is alive (a permission error still means it exists).
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Persists run state atomically so a kill mid-write never leaves a torn file. */
export function saveRunState(state: RunState): void {
  state.updatedAt = new Date().toISOString();
  const file = runStatePath(state.slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(temp, file);
}

/** What loading found: the state to run on and anything the caller should tell the user. */
export interface LoadedRunState { state: RunState; notices: string[] }

/**
 * Loads previous run state, or an empty one when there is none. A corrupt file is moved to
 * run-state.corrupt-<time>.json and reported; a `running` stage whose owner is gone becomes failed
 * (interrupted); a `running` stage owned by another live run refuses this run as already in flight.
 */
export function loadRunState(slug: string, title: string, runId: string): LoadedRunState {
  const file = runStatePath(slug);
  const empty = (): RunState => ({ slug, title, updatedAt: new Date().toISOString(), stages: [], brollClips: [], outputs: [] });
  const notices: string[] = [];
  if (!fs.existsSync(file)) return { state: empty(), notices };

  let parsed: RunState | null = null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as RunState;
    if (Array.isArray(raw.stages) && raw.stages.every(validRecord)) parsed = raw;
  } catch {
    parsed = null;
  }
  if (!parsed) {
    const aside = file.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
    fs.renameSync(file, aside);
    notices.push(`run-state.json could not be read; it was moved to ${path.basename(aside)} and this run starts from scratch`);
    return { state: empty(), notices };
  }

  const state: RunState = { ...empty(), ...parsed, slug, title: parsed.title ?? title, brollClips: parsed.brollClips ?? [], outputs: parsed.outputs ?? [] };
  let interrupted = false;
  state.stages = state.stages.map((record) => {
    if (record.status !== "running") return record;
    const owner = record.owner;
    if (owner && owner.runId !== runId && processAlive(owner.pid)) {
      throw new ProductionError(record.stage, `another run of "${slug}" is in flight (pid ${owner.pid}); wait for it to finish, or remove run-state.json if no run is active`);
    }
    interrupted = true;
    notices.push(`the ${record.stage} stage was left running by a run that did not finish; it will run again`);
    return applyStageEvent(record, { type: "interrupt", reason: "interrupted: the run that started this stage did not finish" });
  });
  if (interrupted) saveRunState(state);
  return { state, notices };
}
