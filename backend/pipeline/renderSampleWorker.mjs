/**
 * File Description: Renders a few real frames of the active film with the same Remotion bundle, GL backend, image format and quality as the final render, and reports how many bytes each one wrote. It is a plain `node` ESM child, like kokoroWorker.mjs, so the editor dev server (which imports the pipeline) never bundles Remotion's bundler or renderer.
 * Inputs and outputs: one JSON request in argv[2] ({composition, frames, gl, imageFormat, jpegQuality, publicDir?, browserExecutable?}) -> one JSON line on stdout ({width, height, durationInFrames, frames: [{frame, bytes}]}); every temp bundle, still and browser is released before it exits.
 * Used by: backend/pipeline/renderDiskBudget.ts (sampleRenderFrames).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Bundles the project once, opens one browser, renders each requested frame and measures its bytes. */
async function main() {
  const request = JSON.parse(process.argv[2] ?? "{}");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-disk-sample-"));
  let browser;
  try {
    const serveUrl = await bundle({
      entryPoint: path.join(ROOT, "src/index.ts"),
      outDir: path.join(work, "bundle"),
      ...(request.publicDir ? { publicDir: request.publicDir } : {}),
    });
    const chromiumOptions = { gl: request.gl };
    browser = await openBrowser("chrome", { chromiumOptions, browserExecutable: request.browserExecutable ?? undefined });
    const composition = await selectComposition({ serveUrl, id: request.composition, inputProps: {}, puppeteerInstance: browser, chromiumOptions });

    const frames = [];
    for (const requested of request.frames) {
      const frame = Math.min(Math.max(0, requested), composition.durationInFrames - 1);
      const output = path.join(work, `frame-${frame}.${request.imageFormat === "jpeg" ? "jpg" : "png"}`);
      await renderStill({
        composition,
        serveUrl,
        frame,
        output,
        imageFormat: request.imageFormat,
        ...(request.imageFormat === "jpeg" ? { jpegQuality: request.jpegQuality } : {}),
        puppeteerInstance: browser,
        chromiumOptions,
        overwrite: true,
      });
      frames.push({ frame, bytes: fs.statSync(output).size });
    }
    process.stdout.write(`${JSON.stringify({ width: composition.width, height: composition.height, durationInFrames: composition.durationInFrames, frames })}\n`);
  } finally {
    if (browser) await browser.close({ silent: true }).catch(() => undefined);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
