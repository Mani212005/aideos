/**
 * File Description: Captures the real Remotion Player at composition size through the editor dev server using the same browser and GL settings as export.
 * Inputs and outputs: film id and composition -> seekable native-size PNG snapshots and visible failure status.
 * Used by: J3 preview/export parity and J8 unavailable-WebGL journeys.
 */
import fs from "node:fs";
import { openBrowser } from "@remotion/renderer";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import { glFlag } from "../pipeline/render";
import { startEditor } from "../../scripts/studioDriver";
import type { CompositionId } from "./remotionFrames";

// Opens a native-size Player with real seek controls and waits for the stage's committed absolute frame.
export async function openPlayer(slug: string, composition: CompositionId, options: { browserExecutable?: string } = {}) {
  const server = await startEditor(getVideosDir());
  let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
  try {
    browser = await openBrowser("chrome", { browserExecutable: options.browserExecutable, chromiumOptions: { gl: glFlag().replace("--gl=", "") as "angle" | "swangle" } });
    const errors: string[] = [];
    const page = await browser.newPage({ context: () => null, logLevel: "error", indent: false, pageIndex: 0, onBrowserLog: (log) => { if (log.type === "error") errors.push(log.text); }, onLog: () => undefined });
    page.on("error", (error) => { errors.push(error.message); });
    const [width, height] = composition === "Long" ? [1920, 1080] : [1080, 1920];
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto({ url: `${server.url}journeys/player.html?film=${encodeURIComponent(slug)}&format=${composition}`, timeout: 60000 });
    // Polls readiness, preserving the browser's actual error rather than capturing an incomplete canvas.
    const waitFor = async (predicate: () => Promise<boolean>, what: string) => {
      const end = Date.now() + 60000;
      while (Date.now() < end) {
        if (await predicate()) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`Player ${slug}: timed out waiting for ${what}; ${errors.join("; ")}`);
    };
    await waitFor(() => page.evaluate(() => !!document.getElementById("seek")), "seek control");
    return {
      errors,
      // Reads the visible Player failure; this is the same status the studio user sees.
      status: () => page.evaluate(() => document.querySelector('[role="status"]')?.textContent ?? ""),
      // Seeks using the fixture button and captures only after the exact requested stage frame and fonts are ready.
      snapshot: async (frame: number, output: string) => {
        await page.evaluate((f) => {
          (document.getElementById("frame") as HTMLInputElement).value = String(f);
          document.getElementById("seek")!.click();
        }, frame);
        await waitFor(() => page.evaluate((f) => document.querySelector("canvas[data-stage-frame]")?.getAttribute("data-stage-frame") === String(f) && !document.querySelector('[role="status"]'), frame), `drawn absolute frame ${frame}`);
        await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
        const shot = await page._client().send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } });
        fs.writeFileSync(output, Buffer.from(shot.value.data, "base64"));
      },
      // Hides one named stage object and waits for its replacement frame to draw in the same Player.
      setVisibility: async (frame: number, visibility: { character?: string; prop?: string }) => {
        await page.evaluate((detail) => {
          document.querySelector("canvas[data-stage-frame]")?.removeAttribute("data-stage-frame");
          window.dispatchEvent(new CustomEvent("aideos-test-stage-visibility", { detail }));
        }, visibility);
        await waitFor(() => page.evaluate((f) => document.querySelector("canvas[data-stage-frame]")?.getAttribute("data-stage-frame") === String(f), frame), `redrawn frame ${frame} with test visibility override`);
      },
      // Waits until context creation has failed visibly, avoiding a timing-dependent status assertion.
      waitForFailure: async () => {
        await waitFor(() => page.evaluate(() => /WebGL could not start/.test(document.querySelector('[role="status"]')?.textContent ?? "")), "named WebGL refusal");
      },
      // Releases only this journey's browser, server and temporary browser profile.
      close: async () => { await browser!.close({ silent: true }); server.stop(); },
    };
  } catch (error) {
    await browser?.close({ silent: true });
    server.stop();
    throw error;
  }
}
