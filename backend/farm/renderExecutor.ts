/**
 * File Description: The farm executor that renders one task with the existing RenderJob. It reads the stored film snapshot and Render IR, hands the native renderer the already staged package files instead of emitting again, and runs the shared lifecycle (preparing, rendering, mastering, probed, done) inside the worker's attempt directory. Delivery checks and audio retiming ran when the task was submitted, so they are off here.
 * Inputs and outputs: an ExecutionContext (task, attempt directory, local input paths) -> the rendered mp4 and its `.render.json` sidecar in the attempt directory.
 * Used by: scripts/farm.ts (worker command), backend/farm/farm.test.ts.
 */

import fs from "node:fs";
import path from "node:path";
import type { Film } from "../../src/dl/schema";
import { createNativeRenderer } from "../nativeRenderer";
import { createRenderJob, type Renderer, type RenderServices } from "../renderJob";
import type { EmitResult } from "../renderIr/emit";
import { parseRenderIr } from "../renderIr/validate";
import type { ExecutionContext, ExecutionResult, Executor } from "./worker";

export interface RenderExecutorOptions {
  /** Builds the renderer for the staged package; defaults to the native renderer over the stored IR. */
  makeRenderer?: (emitted: EmitResult, context: ExecutionContext) => Renderer;
  /** Replaces the delivery services (mastering and probe) in tests. */
  services?: Partial<RenderServices>;
}

/** Services that were already run at submission: the farm renders packages, not live films. */
const SUBMITTED_CHECKS: Partial<RenderServices> = {
  checkDeliverable: () => {},
  checkBroll: () => {},
  retimeAudio: () => {},
};

/** Rebuilds the emit result (IR and package file locations) from the task's stored inputs. */
export function emittedFromInputs(context: ExecutionContext): EmitResult {
  const { spec } = context.task;
  const irPath = context.inputs.get(spec.irHash);
  if (!irPath) throw new Error(`the Render IR ${spec.irHash} was not fetched`);
  const parsed = parseRenderIr(fs.readFileSync(irPath, "utf8"));
  if (!parsed.ok) throw new Error(`the stored Render IR is invalid: ${JSON.stringify(parsed.error)}`);
  const files = Object.entries(spec.assetDigests).map(([assetPath, digest]) => {
    const from = context.inputs.get(digest);
    if (!from) throw new Error(`the asset ${assetPath} (${digest}) was not fetched`);
    return { path: assetPath, from };
  });
  return { ir: parsed.ir, files };
}

/** Creates the executor: one RenderJob per attempt. */
export function createRenderJobExecutor(options: RenderExecutorOptions = {}): Executor {
  return async (context: ExecutionContext): Promise<ExecutionResult> => {
    const { task, attemptDir } = context;
    const emitted = emittedFromInputs(context);
    const filmPath = context.inputs.get(task.payload.filmDigest);
    if (!filmPath) throw new Error("the film snapshot was not fetched");
    // The snapshot was written by the submitter from a parsed film; the worker only reads its id and hashes it.
    const film = JSON.parse(fs.readFileSync(filmPath, "utf8")) as Film;
    const outPath = path.join(attemptDir, "out", `${task.id}.mp4`);
    const renderer = options.makeRenderer ? options.makeRenderer(emitted, context) : createNativeRenderer({ emit: () => emitted });
    const job = createRenderJob(
      { film, format: task.spec.format, outPath, profile: task.spec.profile, ...(task.spec.frameRange ? { frames: task.spec.frameRange } : {}) },
      renderer,
      {
        services: { ...SUBMITTED_CHECKS, ...options.services },
        onState: (state) => {
          if (state === "preparing" || state === "rendering" || state === "mastering" || state === "probed" || state === "done") context.stage(state);
        },
        onOutput: context.onOutput,
        onLog: (message) => context.log("render", { message }),
      },
    );
    const onAbort = (): void => void job.cancel();
    context.signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (context.signal.aborted) onAbort();
      await job.run();
    } finally {
      context.signal.removeEventListener("abort", onAbort);
    }
    context.signal.throwIfAborted();
    return { outputPath: outPath, sidecarPath: `${outPath}.render.json` };
  };
}
