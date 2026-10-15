/**
 * File Description: Renders exact PNG frames of a film through Remotion's Node API (one bundle, one browser) so journeys and golden tests can compare lossless pixels instead of H.264. Offers a cold single-frame still and a concurrent image sequence, which is how a frame rendered out of order is checked against the same frame rendered alone.
 * Inputs and outputs: a film slug, composition (Long or Reel), frame numbers -> PNG files on disk; every temp bundle, public dir and browser is released by close().
 * Used by: backend/journeys/*.journey.ts, backend/journeys/legacy.golden.ts, scripts/nightly_budget.ts.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, openBrowser, renderFrames, renderStill, selectComposition, type HeadlessBrowser } from "@remotion/renderer";
import { ensureGenerated, setActiveFilm } from "../pipeline/generatedFiles";
import { glFlag, stagePublicDir } from "../pipeline/render";

const ROOT = path.resolve(__dirname, "../..");

/** The two compositions every film renders in. */
export type CompositionId = "Long" | "Reel";

/** An open film: its bundle and browser stay alive until close(). */
export interface OpenFilm {
  /** Frame count of the film's composition. */
  durationInFrames: number;
  /** Renders one frame as a PNG in its own page, so nothing carries over from any earlier frame. */
  still: (composition: CompositionId, frame: number, out: string, scale?: number) => Promise<void>;
  /** Renders an inclusive range as numbered PNGs at the given concurrency, which is how an export renders them. */
  sequence: (composition: CompositionId, range: [number, number], outDir: string, concurrency: number) => Promise<string[]>;
  /** Releases the browser, the bundle and the staged public dir. */
  close: () => Promise<void>;
}

/** The GL backend name shared with the CLI render path (AIDEOS_GL, default angle). */
function glName(): "angle" | "swangle" {
  return glFlag().replace("--gl=", "") as "angle" | "swangle";
}

/**
 * Points the generated active film at `slug`, bundles the project once and opens one headless
 * browser. The caller restores src/dl/activeFilm.ts (the journey harness does this for you).
 */
export async function openFilm(slug: string, options: { browserExecutable?: string } = {}): Promise<OpenFilm> {
  ensureGenerated();
  setActiveFilm(slug);
  await ensureBrowser();
  const staged = stagePublicDir();
  let outDir: string | undefined;
  let browser: HeadlessBrowser | undefined;
  try {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-journey-bundle-"));
    const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src/index.ts"), outDir, ...(staged ? { publicDir: staged.dir } : {}) });
    const chromiumOptions = { gl: glName() };
    browser = await openBrowser("chrome", { chromiumOptions, browserExecutable: options.browserExecutable });
    const composition = (id: CompositionId) => selectComposition({ serveUrl, id, inputProps: {}, puppeteerInstance: browser!, chromiumOptions });
    const probe = await composition("Long");

    return {
      durationInFrames: probe.durationInFrames,
      still: async (id, frame, out, scale = 1) => {
        fs.mkdirSync(path.dirname(out), { recursive: true });
        await renderStill({ composition: await composition(id), serveUrl, frame, output: out, imageFormat: "png", scale, puppeteerInstance: browser!, chromiumOptions, overwrite: true });
        if (!fs.existsSync(out) || fs.statSync(out).size < 200) throw new Error(`still ${id} frame ${frame} of ${slug} produced no usable PNG`);
      },
      sequence: async (id, range, dir, concurrency) => {
        fs.mkdirSync(dir, { recursive: true });
        await renderFrames({
          composition: await composition(id),
          serveUrl,
          outputDir: dir,
          frameRange: range,
          imageFormat: "png",
          concurrency,
          inputProps: {},
          onStart: () => undefined,
          onFrameUpdate: () => undefined,
          puppeteerInstance: browser!,
          chromiumOptions,
        });
        return fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort().map((f) => path.join(dir, f));
      },
      close: async () => {
        await browser?.close({ silent: true }).catch(() => undefined);
        if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
        staged?.cleanup();
      },
    };
  } catch (err) {
    if (browser) await browser.close({ silent: true }).catch(() => undefined);
    if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
    staged?.cleanup();
    throw err;
  }
}
