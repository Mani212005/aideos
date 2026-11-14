/**
 * File Description: Turns an emitted film into a farm task and submits it. The Render IR, every package asset and the film snapshot go into the content store by digest; the spec names them; the queue answers a repeat with a cache hit as long as the finished output is still stored. The farm renders native films only in this phase, so the caller emits the IR first (a film the native renderer cannot draw never gets here).
 * Inputs and outputs: a film, its emitted IR and package files, a format and a priority -> stored inputs and a SubmitResult.
 * Used by: scripts/farm.ts (submit command), backend/farm/loadTest.ts and the farm tests.
 */

import type { Film } from "../../src/dl/schema";
import type { EmitResult } from "../renderIr/emit";
import type { RenderProfile } from "../renderJob";
import type { ProductionFormat } from "../pipeline/types";
import type { ContentStore } from "./contentStore";
import type { SubmitResult, TaskQueue } from "./queue";
import { canonicalJson, type Digest, type PriorityClass, type TaskPayload, type TaskSpec } from "./taskSpec";

export interface FilmTaskRequest {
  film: Film;
  emitted: EmitResult;
  format: ProductionFormat;
  profile: RenderProfile;
  frameRange?: [number, number] | null;
  rendererVersion: string;
  owner: string;
  priorityClass: PriorityClass;
  maxAttempts?: number;
}

/** Stores the IR, the package files and the film snapshot, and returns the spec and payload that name them. */
export async function stageFilmTask(store: ContentStore, request: FilmTaskRequest): Promise<{ spec: TaskSpec; payload: TaskPayload }> {
  const ir = await store.putBytes(canonicalJson(request.emitted.ir));
  const assetDigests: Record<string, Digest> = {};
  for (const file of request.emitted.files) {
    const stored = "text" in file ? await store.putBytes(file.text) : await store.putFile(file.from);
    assetDigests[file.path] = stored.digest;
  }
  const filmSnapshot = await store.putBytes(canonicalJson(request.film));
  return {
    spec: { irHash: ir.digest, assetDigests, format: request.format, profile: request.profile, frameRange: request.frameRange ?? null, rendererVersion: request.rendererVersion },
    payload: { filmId: request.film.id, filmDigest: filmSnapshot.digest },
  };
}

/** Stages and submits one film in one format. A repeat is a cache hit while its output is still in the store. */
export async function submitFilmTask(deps: { queue: TaskQueue; store: ContentStore }, request: FilmTaskRequest): Promise<SubmitResult> {
  /** Stages the inputs and enqueues the task. */
  const submitOnce = async (): Promise<SubmitResult> => {
    const staged = await stageFilmTask(deps.store, request);
    return deps.queue.submit({
      spec: staged.spec,
      payload: staged.payload,
      owner: request.owner,
      priorityClass: request.priorityClass,
      maxAttempts: request.maxAttempts,
      isResultValid: (result) => deps.store.has(result.outputDigest),
    });
  };
  const result = await submitOnce();
  // A collection that ran between staging and enqueueing could have removed a reused input; stage again once.
  if (result.outcome === "enqueued" || result.outcome === "parked" || result.outcome === "coalesced") {
    const task = await deps.queue.get(result.id);
    const missing = task ? [task.spec.irHash, ...Object.values(task.spec.assetDigests), task.payload.filmDigest].filter((d) => !deps.store.has(d)) : [];
    if (missing.length) await submitOnce();
  }
  return result;
}
