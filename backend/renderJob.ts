/**
 * File Description: Renderer-independent render lifecycle, delivery policy and output provenance.
 * Inputs and outputs: a film snapshot, renderer and cancellation -> a mastered, probed output and content sidecar (which names the renderer that drew it when the renderer says).
 * Used by: pipeline final renders, studio exports, review renders and the render CLI.
 */

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Film } from "../src/dl/schema";
import type { ProductionFormat, RenderedOutput } from "./pipeline/types";
import { resolvePackageDir } from "../src/dl/videoPackageLoader";
import { ensureRetimedAudio } from "./audio";
import { assertDeliverable } from "./deliveryGate";
import { masterAudio, type MasterResult } from "./masterAudio";
import { describeVideo } from "./pipeline/render";

export type RenderState =
  | "queued"
  | "preparing"
  | "rendering"
  | "mastering"
  | "probed"
  | "done"
  | "failed"
  | "cancelled";
export type RenderProfile = "draft" | "review" | "final";

/** Encoder policy shared with future native backends; adapters choose how to express it. */
export const RENDER_PROFILES = Object.freeze({
  draft: Object.freeze({
    intermediate: "lossless",
    codec: "h264",
    crf: 16,
    pixelFormat: "yuv420p",
    range: "limited",
    audioCodec: "aac",
    audioBitrate: 320_000,
  }),
  review: Object.freeze({
    intermediate: "lossless",
    codec: "h264",
    crf: 16,
    pixelFormat: "yuv420p",
    range: "limited",
    audioCodec: "aac",
    audioBitrate: 320_000,
  }),
  final: Object.freeze({
    intermediate: "lossless",
    codec: "h264",
    crf: 16,
    pixelFormat: "yuv420p",
    range: "limited",
    audioCodec: "aac",
    audioBitrate: 320_000,
  }),
});
export type RenderProfileSetting = keyof (typeof RENDER_PROFILES)["final"];

const NEXT: Partial<Record<RenderState, RenderState>> = {
  queued: "preparing",
  preparing: "rendering",
  rendering: "mastering",
  mastering: "probed",
  probed: "done",
};

/** Rejects impossible phase changes and makes terminal states immutable. */
export function transitionRenderJob(
  state: RenderState,
  next: RenderState,
): RenderState {
  if (
    !(state in NEXT) ||
    (next !== NEXT[state] && next !== "failed" && next !== "cancelled")
  ) {
    throw new Error(`Invalid RenderJob transition: ${state} -> ${next}`);
  }
  return next;
}

export interface RenderRequest {
  film: Film;
  format: ProductionFormat;
  outPath: string;
  profile: RenderProfile;
  frames?: [number, number];
}

export interface RenderContext {
  signal: AbortSignal;
  forceSignal: AbortSignal;
  onOutput: (text: string) => void;
}

/** A native renderer implements this contract without importing any capture-framework types. */
export interface Renderer {
  /** Which renderer drew the frames ("remotion" or "native"); recorded in the sidecar when known. */
  readonly name?: string;
  /** Identifies profile settings this adapter actually applies to its encoded output. */
  profileSettingsApplied?: Partial<Record<RenderProfileSetting, boolean>>;
  prepare?: (
    request: RenderRequest,
    context: RenderContext,
  ) => Promise<void> | void;
  checkDiskBudget: (
    request: RenderRequest,
    context: RenderContext,
  ) => Promise<void>;
  render: (request: RenderRequest, context: RenderContext) => Promise<void>;
  cleanup?: () => Promise<void> | void;
}

export interface RenderServices {
  checkDeliverable: (request: RenderRequest) => void;
  checkBroll: (film: Film) => void;
  retimeAudio: (film: Film) => void;
  master: (
    file: string,
    onLog?: (message: string) => void,
  ) => MasterResult | Promise<MasterResult>;
  probe: (
    format: ProductionFormat,
    file: string,
  ) => RenderedOutput | Promise<RenderedOutput>;
}

/** Refuses missing requested footage before invoking any renderer. */
export function assertBrollReady(film: Film): void {
  const pending = film.shots.filter(
    (shot) =>
      shot.needsFootage &&
      !fs.existsSync(
        path.join(resolvePackageDir(film.id), "footage", `${shot.id}.mp4`),
      ),
  );
  if (pending.length)
    throw new Error(
      `Cannot render video: GPU B-Roll footage is still pending for ${pending.length} shot(s) (${pending.map((shot) => shot.id).join(", ")}). Please complete B-roll generation first.`,
    );
}

const SERVICES: RenderServices = {
  checkDeliverable: ({ film, format }) => assertDeliverable([{ film, format }]),
  checkBroll: assertBrollReady,
  retimeAudio: ensureRetimedAudio,
  master: masterAudio,
  probe: describeVideo,
};

/** Hashes canonical film content so object key order does not change provenance. */
export function renderFilmHash(film: Film): string {
  return createHash("sha256")
    .update(
      JSON.stringify(film, (_key, value) => {
        if (value && typeof value === "object" && !Array.isArray(value))
          return Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, value[key]]),
          );
        return value;
      }),
    )
    .digest("hex");
}

/** Acquires a kernel-owned advisory lock so abandoned lock files cannot block or race reclamation. */
async function acquirePublicationLock(
  outPath: string,
  signal: AbortSignal,
): Promise<() => Promise<void>> {
  signal.throwIfAborted();
  const lockPath = `${path.resolve(outPath)}.publish.lock`;
  const child = spawn(
    "flock",
    ["-x", lockPath, "sh", "-c", "printf 'locked\\n'; cat"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  await new Promise<void>((resolve, reject) => {
    let ready = false;
    let output = "";
    const abort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
      if (!ready && output.includes("\n")) {
        ready = true;
        signal.removeEventListener("abort", abort);
        resolve();
      }
    });
    child.once("error", (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (ready) return;
      reject(
        signal.aborted
          ? signal.reason
          : new Error(`Unable to acquire publication lock (${code}): ${stderr}`),
      );
    });
    if (signal.aborted) abort();
  });
  return () =>
    new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", () => resolve());
      child.stdin.end();
    });
}

/** Creates a single-use job; cancellation waits for backend teardown before discarding partial output. */
export function createRenderJob(
  input: RenderRequest,
  renderer: Renderer,
  options: {
    prepareFilm?: (film: Film) => Promise<Film>;
    onState?: (state: RenderState) => void;
    onMaster?: (master: MasterResult, film: Film) => void;
    onOutput?: (text: string) => void;
    onLog?: (message: string) => void;
    services?: Partial<RenderServices>;
  } = {},
) {
  const request = structuredClone(input);
  const services = { ...SERVICES, ...options.services };
  const controller = new AbortController();
  const forceController = new AbortController();
  const context: RenderContext = {
    signal: controller.signal,
    forceSignal: forceController.signal,
    onOutput: options.onOutput ?? (() => {}),
  };
  let cleaned = false;
  let state: RenderState = "queued";
  let running:
    | Promise<{
        output: RenderedOutput;
        master: MasterResult;
        filmHash: string;
      }>
    | undefined;

  /** Publishes only validated lifecycle transitions. */
  const move = (next: RenderState): void => {
    state = transitionRenderJob(state, next);
    options.onState?.(state);
  };

  /** Stops between asynchronous phases as well as inside a cooperative backend. */
  const checkCancelled = (): void => controller.signal.throwIfAborted();

  /** Releases backend resources at most once, including a failing cleanup. */
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    await renderer.cleanup?.();
  };

  /** Executes the shared delivery steps exactly once for this immutable input snapshot. */
  const execute = async () => {
    let attemptDir: string | undefined;
    let attemptRequest = request;
    try {
      checkCancelled();
      if (request.format !== "long" && request.format !== "reel")
        throw new Error(
          `Invalid format "${request.format}". Supported formats are: long, reel`,
        );
      if (!Object.prototype.hasOwnProperty.call(RENDER_PROFILES, request.profile))
        throw new Error(`Invalid render profile "${request.profile}"`);
      move("preparing");
      if (options.prepareFilm)
        request.film = structuredClone(await options.prepareFilm(request.film));
      checkCancelled();
      services.checkDeliverable(request);
      services.checkBroll(request.film);
      services.retimeAudio(request.film);
      fs.mkdirSync(path.dirname(request.outPath), { recursive: true });
      attemptDir = fs.mkdtempSync(
        path.join(
          path.dirname(request.outPath),
          `.${path.basename(request.outPath)}.job-`,
        ),
      );
      attemptRequest = {
        ...request,
        outPath: path.join(attemptDir, path.basename(request.outPath)),
      };
      await renderer.prepare?.(attemptRequest, context);
      checkCancelled();
      await renderer.checkDiskBudget(attemptRequest, context);
      checkCancelled();
      const filmHash = renderFilmHash(request.film);
      move("rendering");
      checkCancelled();
      await renderer.render(attemptRequest, context);
      checkCancelled();
      if (!fs.existsSync(attemptRequest.outPath))
        throw new Error(
          `Render failed to create output file at ${attemptRequest.outPath}`,
        );
      move("mastering");
      checkCancelled();
      const master = await services.master(attemptRequest.outPath, options.onLog);
      checkCancelled();
      options.onMaster?.(master, request.film);
      const probed = await services.probe(request.format, attemptRequest.outPath);
      const output = { ...probed, path: request.outPath };
      checkCancelled();
      move("probed");
      checkCancelled();
      fs.writeFileSync(
        `${attemptRequest.outPath}.render.json`,
        JSON.stringify(
          {
            filmId: request.film.id,
            filmHash,
            ...(renderer.name ? { renderer: renderer.name } : {}),
            profile: request.profile,
            profilePolicy: RENDER_PROFILES[request.profile],
            profileSettingsApplied: Object.fromEntries(
              Object.keys(RENDER_PROFILES[request.profile]).map((setting) => [
                setting,
                renderer.profileSettingsApplied?.[
                  setting as RenderProfileSetting
                ] ?? false,
              ]),
            ),
            output,
          },
          null,
          2,
        ) + "\n",
      );
      await cleanup();
      checkCancelled();
      const releasePublication = await acquirePublicationLock(
        request.outPath,
        controller.signal,
      );
      try {
        checkCancelled();
        const attemptMasterReport = `${attemptRequest.outPath}.master.json`;
        if (fs.existsSync(attemptMasterReport))
          fs.renameSync(attemptMasterReport, `${request.outPath}.master.json`);
        else fs.rmSync(`${request.outPath}.master.json`, { force: true });
        fs.renameSync(
          `${attemptRequest.outPath}.render.json`,
          `${request.outPath}.render.json`,
        );
        fs.renameSync(attemptRequest.outPath, request.outPath);
      } finally {
        await releasePublication();
      }
      fs.rmSync(attemptDir, { recursive: true, force: true });
      move("done");
      return { output, master, filmHash };
    } catch (error) {
      await cleanup().catch(() => {});
      move(controller.signal.aborted ? "cancelled" : "failed");
      if (attemptDir) fs.rmSync(attemptDir, { recursive: true, force: true });
      throw error;
    }
  };

  return {
    /** Returns the current lifecycle state. */
    get state(): RenderState {
      return state;
    },
    /** Starts the job, or returns the original execution when called again. */
    run() {
      return (running ??= Promise.resolve().then(execute));
    },
    /** Cancels once and waits for the backend to release its resources. */
    async cancel(): Promise<void> {
      if (state === "done" || state === "failed" || state === "cancelled")
        return;
      controller.abort(new Error("Render cancelled"));
      if (!running) running = Promise.resolve().then(execute);
      await running.catch(() => {});
    },
    /** Immediately signals the renderer tree during process shutdown. */
    forceCancel(): void {
      if (state === "done" || state === "failed" || state === "cancelled")
        return;
      forceController.abort();
      controller.abort(new Error("Render cancelled"));
      if (!running) running = Promise.resolve().then(execute);
    },
  };
}
