/**
 * File Description: Thin Remotion adapter: every entry point encodes with the shared final flags and keeps its own active-film, GL and entry-point behavior.
 * Inputs and outputs: renderer-neutral requests and legacy caller options -> existing Remotion capture subprocesses.
 * Used by: pipeline, studio export registry, Gemini review and manual render CLI.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deliveryTimeline } from "../src/dl/delivery";
import { filmModule, FILMS_DIR, ROOT } from "./pipeline/generatedFiles";
import {
  readActiveFilmSource,
  restoreActiveFilmSource,
  setActiveFilm,
} from "./pipeline/filmStore";
import {
  ENCODE_FLAGS,
  FINAL_ENCODE_FLAGS,
  FORMAT_SPECS,
  glFlag,
  stagePublicDir,
} from "./pipeline/render";
import { checkRenderDiskBudget } from "./pipeline/renderDiskBudget";
import { runRenderCommand, type RenderProcessDeps } from "./renderProcess";
import type { Renderer } from "./renderJob";

export interface RemotionRendererDeps extends RenderProcessDeps {
  checkDiskBudget?: typeof checkRenderDiskBudget;
  run?: typeof runRenderCommand;
}

/** Builds the Remotion renderer for one caller; the shared final encode flags express the whole render profile. */
export function createRemotionRenderer(
  options: {
    caller: "pipeline" | "studio" | "review" | "manual";
    concurrency?: number;
    browserExecutable?: string;
    extraArgs?: string[];
    onLog?: (message: string, progress?: number) => void;
  },
  deps: RemotionRendererDeps = {},
): Renderer {
  let previous: string | undefined;
  let publicDir: ReturnType<typeof stagePublicDir>;
  return {
    profileSettingsApplied: {
      intermediate: true,
      codec: true,
      crf: true,
      pixelFormat: true,
      range: true,
      audioCodec: true,
      audioBitrate: true,
    },
    /** Performs only the active-film setup the existing caller performed. */
    prepare(request) {
      if (options.caller === "review") previous = readActiveFilmSource();
      if (options.caller === "studio") {
        fs.mkdirSync(FILMS_DIR, { recursive: true });
        fs.writeFileSync(
          path.join(FILMS_DIR, `${request.film.id}.ts`),
          filmModule(request.film),
          "utf8",
        );
      }
      if (options.caller !== "manual") setActiveFilm(request.film.id);
      publicDir = stagePublicDir();
    },
    /** Uses the existing measured disk estimator before capture. */
    async checkDiskBudget(request, context) {
      await (deps.checkDiskBudget ?? checkRenderDiskBudget)({
        film: request.film,
        format: request.format,
        range: request.frames ?? [
          0,
          deliveryTimeline(request.film, request.format).totalFrames - 1,
        ],
        dirs: [os.tmpdir(), path.dirname(request.outPath)],
        browserExecutable: options.browserExecutable,
        signal: context.signal,
        forceSignal: context.forceSignal,
      });
    },
    /** Runs the Remotion CLI with the final encode flags plus this caller's GL and entry-point choices. */
    async render(request, context) {
      const pipeline = options.caller === "pipeline";
      const args = [
        "remotion",
        "render",
        ...(pipeline ? [] : ["src/index.ts"]),
        FORMAT_SPECS[request.format].composition,
        request.outPath,
        ...(pipeline ? [...ENCODE_FLAGS, glFlag()] : FINAL_ENCODE_FLAGS),
        ...(pipeline || options.caller === "studio" ? [] : ["--gl=angle"]),
        ...(publicDir ? [`--public-dir=${publicDir.dir}`] : []),
        ...(request.frames
          ? [`--frames=${request.frames[0]}-${request.frames[1]}`]
          : []),
        ...(options.concurrency
          ? [`--concurrency=${options.concurrency}`]
          : []),
        ...(options.browserExecutable
          ? [`--browser-executable=${options.browserExecutable}`]
          : []),
        ...(options.extraArgs ?? []),
      ];
      await (deps.run ?? runRenderCommand)(
        { command: "npx", args, cwd: ROOT },
        request.outPath,
        {
          signal: context.signal,
          forceSignal: context.forceSignal,
          onOutput: (text) => {
            context.onOutput(text);
            const match = [...text.matchAll(/(\d+)\s*\/\s*(\d+)/g)].pop();
            if (match && Number(match[2]) > 0)
              options.onLog?.(
                `${request.format}: ${match[1]}/${match[2]} frames`,
                Math.min(0.99, Number(match[1]) / Number(match[2])),
              );
          },
        },
        deps,
      );
    },
    /** Restores only the review path's previous pointer, as before the adapter was introduced. */
    cleanup() {
      publicDir?.cleanup();
      publicDir = null;
      if (previous !== undefined) {
        restoreActiveFilmSource(previous);
        previous = undefined;
      }
    },
  };
}
