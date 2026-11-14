/**
 * File Description: Studio export registry mapping the shared RenderJob lifecycle to the existing UI snapshots. The native renderer draws every film it supports; Remotion renders the rest (AIDEOS_RENDERER=remotion keeps every export on Remotion), and the server log names the choice.
 * Inputs and outputs: film snapshots and cancel calls -> export progress (from Remotion's or the native renderer's frame counts), notices and download locations.
 * Used by: editor/vite.config.ts export routes and backend/exportJobs.test.ts.
 */

import type { Film } from "../src/dl/schema";
import type { ExportJobSnapshot } from "./exportJobTypes";
import {
  createRenderJob,
  type Renderer,
  type RenderServices,
} from "./renderJob";
import { createRemotionRenderer } from "./remotionRenderer";
import { createNativeRenderer } from "./nativeRenderer";
import { createSelectedRenderer, rendererModeFromEnv } from "./rendererSelection";
import type { RenderProcessDeps } from "./renderProcess";
import type { MasterResult } from "./masterAudio";
export type { ExportStatus, ExportJobSnapshot } from "./exportJobTypes";

export interface ExportJobInput {
  film: Film;
  filmId: string;
  format: "long" | "reel";
  filmTitle: string;
  fps: number;
  durationInFrames: number;
  filename: string;
  outPath: string;
  downloadUrl: string;
  prepare?: (film: Film) => Promise<Film>;
  onMaster?: (master: MasterResult, film: Film) => string | void;
  cleanup?: () => void;
}

export interface ExportJobDeps extends RenderProcessDeps {
  now?: () => number;
  renderer?: () => Renderer;
  services?: Partial<RenderServices>;
}

interface Job {
  snapshot: ExportJobSnapshot;
  machine: ReturnType<typeof createRenderJob>;
  settled: Promise<void>;
}

/** Pulls the latest "Rendered a/b" and "Encoded a/b" counts out of Remotion output, or "frames a/b" (rendered and encoded) out of the native renderer's. */
export function parseRenderProgress(text: string): {
  rendered?: number;
  encoded?: number;
  total?: number;
} {
  const out: { rendered?: number; encoded?: number; total?: number } = {};
  for (const m of text.matchAll(/Rendered\s+(\d+)\s*\/\s*(\d+)/g)) {
    out.rendered = Number(m[1]);
    out.total = Number(m[2]);
  }
  for (const m of text.matchAll(/Encoded\s+(\d+)\s*\/\s*(\d+)/g)) {
    out.encoded = Number(m[1]);
    out.total = Number(m[2]);
  }
  // The native renderer reports a frame once it is encoded, so it counts as rendered and encoded.
  for (const m of text.matchAll(/^frames\s+(\d+)\/(\d+)$/gm)) {
    out.rendered = Number(m[1]);
    out.encoded = Number(m[1]);
    out.total = Number(m[2]);
  }
  return out;
}

/** Whole-job progress: rendering and encoding each count for half, and it reaches 1 only when the job is done. */
export function progressFraction(
  rendered: number,
  encoded: number,
  total: number,
): number {
  if (total <= 0) return 0;
  return Math.min(
    0.99,
    (Math.min(rendered, total) + Math.min(encoded, total)) / (2 * total),
  );
}

/** Creates the studio registry; all preparation, cancellation and terminal-state ownership live in RenderJob. */
export function createExportJobs(deps: ExportJobDeps = {}) {
  const jobs = new Map<string, Job>();
  const now = deps.now ?? Date.now;
  let counter = 0;

  /** Finds the export still in flight for the studio's existing busy response. */
  const active = (): Job | undefined =>
    [...jobs.values()].find(
      (job) => !["done", "failed", "cancelled"].includes(job.snapshot.status),
    );

  return {
    /** Starts a shared render job and immediately returns its UI snapshot. */
    start(input: ExportJobInput): { job: ExportJobSnapshot; busy: boolean } {
      const running = active();
      if (running) return { job: { ...running.snapshot }, busy: true };
      const snapshot: ExportJobSnapshot = {
        id: `exp-${now().toString(36)}-${(counter++).toString(36)}`,
        filmId: input.filmId,
        format: input.format,
        filmTitle: input.filmTitle,
        fps: input.fps,
        durationInFrames: input.durationInFrames,
        status: "preparing",
        progress: 0,
        renderedFrames: 0,
        encodedFrames: 0,
        totalFrames: 0,
        filename: input.filename,
        startedAt: now(),
      };
      let pending = "";
      /** Updates progress only from complete renderer output lines. */
      const read = (text: string): void => {
        const seen = parseRenderProgress(text);
        if (seen.total) snapshot.totalFrames = seen.total;
        if (seen.rendered !== undefined)
          snapshot.renderedFrames = Math.max(
            snapshot.renderedFrames,
            seen.rendered,
          );
        if (seen.encoded !== undefined)
          snapshot.encodedFrames = Math.max(
            snapshot.encodedFrames,
            seen.encoded,
          );
        snapshot.progress = Math.max(
          snapshot.progress,
          progressFraction(
            snapshot.renderedFrames,
            snapshot.encodedFrames,
            snapshot.totalFrames,
          ),
        );
      };
      const machine = createRenderJob(
        {
          film: input.film,
          format: input.format,
          outPath: input.outPath,
          profile: "final",
        },
        deps.renderer?.() ??
          createSelectedRenderer({
            mode: rendererModeFromEnv(),
            remotion: () => createRemotionRenderer({ caller: "studio" }, deps),
            native: () => createNativeRenderer({}, deps),
            onChoice: (_choice, message) => console.log(`[export] ${message}`),
          }),
        {
          prepareFilm: input.prepare,
          services: deps.services,
          onOutput: (text) => {
            pending += text;
            const lines = pending.split(/\r|\n/);
            pending = lines.pop() ?? "";
            read(lines.join("\n"));
          },
          onMaster: (master, film) => {
            const notice = input.onMaster?.(master, film);
            if (notice) snapshot.notice = notice;
          },
          onState: (state) => {
            snapshot.status =
              state === "queued"
                ? "preparing"
                : state === "mastering" || state === "probed"
                  ? "finishing"
                  : state;
            if (["done", "failed", "cancelled"].includes(state))
              snapshot.finishedAt = now();
            if (state === "done") {
              read(pending);
              snapshot.progress = 1;
              snapshot.downloadUrl = input.downloadUrl;
            }
          },
        },
      );
      const job: Job = { snapshot, machine, settled: Promise.resolve() };
      jobs.set(snapshot.id, job);
      job.settled = machine
        .run()
        .then(
          () => {},
          (error) => {
            if (machine.state === "failed")
              snapshot.error =
                error instanceof Error ? error.message : String(error);
          },
        )
        .finally(() => {
          try {
            input.cleanup?.();
          } catch {
            /* Preserve the completed job outcome when registry cleanup fails. */
          }
        });
      return { job: { ...snapshot }, busy: false };
    },

    /** Returns the existing UI snapshot for an export. */
    get(id: string): ExportJobSnapshot | undefined {
      const job = jobs.get(id);
      return job ? { ...job.snapshot } : undefined;
    },

    /** Finds the in-flight export after a page reload. */
    current(): ExportJobSnapshot | undefined {
      const job = active();
      return job ? { ...job.snapshot } : undefined;
    },

    /** Cancels through the shared machine and waits for teardown. */
    async cancel(id: string): Promise<ExportJobSnapshot | undefined> {
      const job = jobs.get(id);
      if (!job) return undefined;
      await job.machine.cancel();
      await job.settled;
      return { ...job.snapshot };
    },

    /** Requests cancellation of every in-flight export during server shutdown. */
    killAll(): void {
      for (const job of jobs.values()) job.machine.forceCancel();
    },
  };
}

export type ExportJobs = ReturnType<typeof createExportJobs>;
