/**
 * File Description: A stand-in renderer for the farm tests and the load test: it sits behind the real RenderJob and the real worker, writes deterministic bytes derived from the task's IR (the same task always gives the same file, as the native CPU path does), can take a set time, can be told to fail, and records every render start in an append-only ledger so duplicate work can be counted. No model, key or network is involved.
 * Inputs and outputs: a seed and options -> a small valid Render IR package, a film stand-in, and a Renderer and delivery services for createRenderJobExecutor.
 * Used by: backend/farm/*.test.ts, backend/farm/loadTest.ts, scripts/farm.ts (the stub executor of the load test).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import type { Film } from "../../src/dl/schema";
import type { EmitResult } from "../renderIr/emit";
import { parseRenderIr } from "../renderIr/validate";
import type { Renderer, RenderServices } from "../renderJob";
import type { ExecutionContext } from "../farm/worker";
import { canonicalJson } from "../farm/taskSpec";

/** A minimal valid Render IR for film `seed`, with `frames` frames, and one package text file. */
export function stubEmit(seed: string | number, frames = 30): EmitResult {
  const parsed = parseRenderIr(
    JSON.stringify({
      schema: "aideos.render/1",
      film: { id: `film-${seed}`, fps: 30, durationFrames: frames },
      scene: { width: 1920, height: 1920 },
      formats: { long: { width: 1920, height: 1080 }, reel: { width: 1080, height: 1920 } },
      background: "#0B0D10",
      assets: [],
      stage: [],
      overlay: [],
      audio: [],
    }),
  );
  if (!parsed.ok) throw new Error(`the stub IR is invalid: ${JSON.stringify(parsed.error)}`);
  return { ir: parsed.ir, files: [{ path: "fonts/shared.ttf", text: "one font shared by every film\n" }, { path: `notes/${seed}.txt`, text: `notes for film ${seed}\n` }] };
}

/** A film stand-in: the worker only reads its id and hashes it. */
export function stubFilm(seed: string | number): Film {
  return { id: `film-${seed}`, title: `Film ${seed}`, fps: 30 } as unknown as Film;
}

export interface StubRendererOptions {
  /** Append-only file that gets one line per render start: task id, attempt, process id. */
  ledgerFile?: string;
  /** How long a render takes. */
  renderMs?: number;
  /** Size of the output file. */
  bytes?: number;
  /** Returns an error message to fail this render with, or null. */
  failure?: (context: ExecutionContext) => string | null;
  /** Extra bytes to write next to the output while rendering (to exercise the disk budget). */
  junkBytes?: number;
  /** Throws from the disk check, as the real renderers do when the disk is under the reserve. */
  diskLow?: (context: ExecutionContext) => boolean;
}

/** Waits `ms` milliseconds or until the signal aborts. */
function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    /** Ends the wait and removes the abort listener. */
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Deterministic bytes: a SHA-256 chain seeded with the IR and the format, `size` bytes long. */
export function stubBytes(seed: string, size: number): Buffer {
  const out = Buffer.alloc(size);
  let block = createHash("sha256").update(seed).digest();
  for (let offset = 0; offset < size; offset += block.length) {
    block.copy(out, offset, 0, Math.min(block.length, size - offset));
    block = createHash("sha256").update(block).digest();
  }
  return out;
}

/** Builds the makeRenderer function for createRenderJobExecutor. */
export function createStubRendererFactory(options: StubRendererOptions = {}): (emitted: EmitResult, context: ExecutionContext) => Renderer {
  return (emitted, context) => ({
    name: "stub",
    profileSettingsApplied: { intermediate: true, codec: true, crf: true, pixelFormat: true, range: true, audioCodec: true, audioBitrate: true },
    /** Throws the disk-low error when told to. */
    async checkDiskBudget(request) {
      if (options.diskLow?.(context)) throw new Error(`RENDER_DISK_LOW: the stub render of ${request.format} needs more room than is free`);
    },
    /** Writes the deterministic output after the configured time. */
    async render(request, renderContext) {
      if (options.ledgerFile) fs.appendFileSync(options.ledgerFile, `${context.task.id} ${context.attempt} ${process.pid}\n`);
      const message = options.failure?.(context);
      if (message) throw new Error(message);
      if (options.junkBytes) fs.writeFileSync(`${request.outPath}.junk`, Buffer.alloc(options.junkBytes, 1));
      await waitFor(options.renderMs ?? 0, renderContext.signal);
      if (renderContext.signal.aborted) throw renderContext.signal.reason ?? new Error("Render cancelled");
      fs.rmSync(`${request.outPath}.junk`, { force: true });
      fs.writeFileSync(request.outPath, stubBytes(`${canonicalJson(emitted.ir)}|${request.format}|${request.profile}`, options.bytes ?? 4096));
      renderContext.onOutput("frames 30/30\n");
    },
  });
}

/** Delivery services that need no ffmpeg: mastering is skipped and the probe reports the file size. */
export const stubServices: Partial<RenderServices> = {
  master: () => ({ status: "skipped", reason: "synthetic audio" }),
  probe: (format, file) => ({ format, path: file, width: 16, height: 16, fps: 30, durationSec: 0.1, sizeBytes: fs.statSync(file).size }),
};
