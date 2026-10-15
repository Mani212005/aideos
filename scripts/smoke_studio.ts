/**
 * File Description: Browser smoke check and scrub-save-reload journey (J3) for the Aideos Studio.
 * Starts the editor dev server on a throwaway videos folder holding a film made by the real pipeline, loads the studio in headless Chrome and fails when the page does not render or throws. Then does what a user does in the Edit stage: jump to the end, step and scrub backwards and forwards with the keyboard (the frame readout must move by exactly the frames pressed), return to a frame and require the identical preview picture, split a clip, wait for the autosave, reload the page and require the edit to have survived.
 * Unit tests run in Node and cannot see a crash that only happens in the browser bundle (for example a Node-only import leaking into client code, which blanked the studio after #43), so this loads the real page the way a user does.
 * Inputs and outputs: none -> launches dev server and headless Chrome, returns exit code 0 on success.
 * Used by: npm run smoke:studio, npm run ci (journeys job).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findChromeBinary } from "../backend/scene/renderStill";
import { startEditor, StudioPage } from "./studioDriver";

const ROOT = path.resolve(__dirname, "..");
const SLUG = "smoke-studio";
// An element that only exists once the React app has rendered its shell.
const RENDERED_SELECTOR = 'nav[aria-label="Production stages"]';
const SCRIPT = [
  "## 0:00 - Idea",
  "[NARRATION] A load balancer shares incoming requests across several servers so that no single machine is overwhelmed by traffic.",
  "[VISUAL] A row of servers",
  "## 0:10 - Check",
  "[NARRATION] Every few seconds it asks each server whether it is healthy, and it stops sending work to any server that stays silent.",
  "[VISUAL] A heartbeat line",
].join("\n");

/** Reads the timeline's `m:ss:ff` readouts (playhead, then total) and returns them as frame numbers. */
async function readFrames(page: StudioPage, fps: number): Promise<{ at: number; total: number }> {
  const stamps = await page.eval<string[]>(
    `[...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && /^\\d+:\\d\\d:\\d\\d$/.test((e.textContent || '').trim())).map((e) => e.textContent.trim())`,
  );
  if (stamps.length < 2) throw new Error(`the timeline did not show its frame readouts (found ${JSON.stringify(stamps)})`);
  const frames = (s: string) => {
    const [m, sec, f] = s.split(":").map(Number);
    return (m * 60 + sec) * fps + f;
  };
  return { at: frames(stamps[0]), total: frames(stamps[1]) };
}

/** How many clips the inspector says the film has. */
async function clipCount(page: StudioPage): Promise<number> {
  const text = await page.eval<string>("document.body.innerText");
  const m = /CLIPS\s+(\d+)/.exec(text);
  if (!m) throw new Error("the inspector does not show a clip count");
  return Number(m[1]);
}

/** The preview picture, the part of the page that must be a pure function of the frame; kept under .ci-artifacts/studio/ so a failing run can be looked at. */
async function previewShot(page: StudioPage, name: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 500));
  const png = await page.screenshot(".__remotion-player");
  const dir = path.join(process.env.AIDEOS_CI_ARTIFACTS ?? path.join(ROOT, ".ci-artifacts"), "studio");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  fs.writeFileSync(file, png);
  return file;
}

/**
 * Share of pixels that differ between two same-size PNGs. The Player draws its own seek bar over the
 * picture and rounds the played portion by a pixel or two, so equality is "no more than 0.05%".
 */
function changedShare(a: string, b: string): number {
  const decode = (file: string) => spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 256 * 1024 * 1024 }).stdout;
  const [x, y] = [decode(a), decode(b)];
  if (x.length === 0 || x.length !== y.length) return 1;
  let changed = 0;
  for (let i = 0; i < x.length; i += 3) if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2]) changed++;
  return changed / (x.length / 3);
}

/** Waits until the playhead sits on `frame` (the keyboard seek is applied asynchronously). */
async function expectFrame(page: StudioPage, fps: number, frame: number, why: string): Promise<void> {
  const deadline = Date.now() + 5000;
  let seen = -1;
  while (Date.now() < deadline) {
    seen = (await readFrames(page, fps)).at;
    if (seen === frame) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${why}: expected the playhead on frame ${frame}, it is on ${seen}`);
}

/** The scrub, return, edit, autosave, reload journey in the Edit stage; returns what went wrong. */
async function scrubSaveReload(page: StudioPage, url: string, filmFile: string): Promise<string[]> {
  const problems: string[] = [];
  const fps = 30;
  await page.goto(url);
  await page.eval(`localStorage.setItem('aideos_active_film_id', ${JSON.stringify(SLUG)})`);
  await page.goto(`${url}#edit`);
  await page.reload();
  await page.waitFor(`document.querySelector('.__remotion-player')`, "the preview player");
  await page.waitFor(`document.body.innerText.includes(${JSON.stringify(SLUG)}) || document.querySelector('select, [role=combobox]')`, "the project switcher");
  const { total } = await readFrames(page, fps);
  if (total < fps * 5) problems.push(`the opened film is only ${total} frames; the narrated fixture should be longer`);
  await expectFrame(page, fps, 0, "a freshly opened film starts at frame 0");

  // Scrub forwards with real keys: each press moves exactly one frame, shift moves a second.
  for (let i = 0; i < 45; i++) await page.key("ArrowRight");
  await expectFrame(page, fps, 45, "45 ArrowRight presses");
  const atFrame45 = await previewShot(page, "frame-45-first");

  // Away to the end and back by different routes, then onto the same frame again.
  await page.clickButton("Go to end");
  const end = (await readFrames(page, fps)).at;
  if (end <= 45) problems.push(`"Go to end" left the playhead on frame ${end}`);
  await page.key("ArrowLeft", { shift: true });
  await expectFrame(page, fps, end - fps, "shift+ArrowLeft goes back one second");
  await page.key("Home");
  await expectFrame(page, fps, 0, "Home");
  const atFrame0 = await previewShot(page, "frame-0");
  for (let i = 0; i < 45; i++) await page.key("ArrowRight");
  await expectFrame(page, fps, 45, "scrubbing back onto frame 45");
  const again = await previewShot(page, "frame-45-again");
  const drift = changedShare(atFrame45, again);
  if (drift > 0.0005) problems.push(`preview at frame 45 is not the same picture after scrubbing away and back (${(drift * 100).toFixed(3)}% of pixels differ; compare ${atFrame45} with ${again})`);
  if (changedShare(atFrame45, atFrame0) < 0.005) problems.push("preview at frame 0 and frame 45 are the same picture, so the equality check above proves nothing");

  // Edit, wait for the autosave, reload: the edit must still be there.
  const before = await clipCount(page);
  const savedBefore = fs.statSync(filmFile).mtimeMs;
  await page.key("s");
  await page.waitFor(`document.body.innerText.includes('CLIPS')`, "the inspector");
  const after = await clipCount(page);
  if (after <= before) problems.push(`splitting at the playhead did not add a clip (${before} before, ${after} after)`);
  await page.waitFor(`[...document.querySelectorAll('button')].some((b) => (b.getAttribute('title') || '').startsWith('Save the project') && /saved/i.test(b.textContent))`, "the autosave to finish", 15000);
  if (fs.statSync(filmFile).mtimeMs <= savedBefore) problems.push("the autosave reported success but film.json on disk did not change");

  await page.reload();
  await page.waitFor(`document.querySelector('.__remotion-player')`, "the preview player after reload");
  await expectFrame(page, fps, 0, "a reloaded studio starts at frame 0");
  await page.waitFor(`document.body.innerText.includes('CLIPS')`, "the inspector after reload");
  const reloaded = await clipCount(page);
  if (reloaded !== after) problems.push(`the split did not survive a reload (${after} clips before, ${reloaded} after)`);
  await page.clickButton("Go to end");
  if ((await readFrames(page, fps)).at <= 0) problems.push("scrubbing does not work after a reload");
  return problems;
}

// Runs the smoke check and exits non-zero when the studio fails to render or the journey breaks.
async function main(): Promise<void> {
  const chrome = findChromeBinary();
  if (!chrome) {
    if (process.env.AIDEOS_SMOKE_REQUIRED === "1") throw new Error("no Chrome or Chromium found; set AIDEOS_CHROME_PATH");
    console.warn("[smoke] skipped: no Chrome or Chromium found (set AIDEOS_CHROME_PATH to enable)");
    return;
  }

  // The film is made by the real pipeline (tone narration, template design) in a throwaway videos
  // folder, so the journey never touches anyone's own videos and needs no model or key.
  const videosDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-smoke-videos-"));
  process.env.AIDEOS_VIDEOS_DIR = videosDir;
  const shadow = path.join(ROOT, "src/dl/films", `${SLUG}.ts`);
  // The studio server rewrites the generated active-film module when a project is opened; put it back afterwards.
  const activeFile = path.join(ROOT, "src/dl/activeFilm.ts");
  const activeBefore = fs.existsSync(activeFile) ? fs.readFileSync(activeFile, "utf8") : null;
  let server: Awaited<ReturnType<typeof startEditor>> | undefined;
  let page: StudioPage | undefined;
  try {
    const { runProduction } = await import("../backend/pipeline/run");
    const produced = await runProduction({ script: SCRIPT, title: "Smoke studio", slug: SLUG, ttsBackend: "tone", design: "templates", broll: false, skipAgent: true, stopAfter: "design", syncToPreview: false, deviceCaller: null });
    if (produced.status !== "stopped") throw new Error(`could not prepare the smoke film: ${produced.status} ${produced.warnings.join("; ")}`);

    server = await startEditor(videosDir);
    page = await StudioPage.open(chrome);
    const problems: string[] = [];

    await page.goto(server.url, 8000);
    if (!(await page.eval<boolean>(`!!document.querySelector('${RENDERED_SELECTOR}')`))) problems.push("the studio shell did not render (blank page)");

    problems.push(...(await scrubSaveReload(page, server.url, path.join(videosDir, SLUG, "film.json"))));

    if (page.errors.length) problems.push(`errors in the browser:\n  ${page.errors.slice(0, 5).join("\n  ")}`);
    const serverErrors = server.log().split("\n").filter((line) => /\[vite\].*(error|Error)/.test(line));
    if (serverErrors.length) problems.push(`dev server errors:\n  ${serverErrors.slice(0, 5).join("\n  ")}`);
    if (problems.length) throw new Error(`studio smoke check failed:\n- ${problems.join("\n- ")}`);
    console.log(`[smoke] studio rendered at ${server.url}; scrub, return, split, autosave and reload all behaved, with no uncaught errors`);
  } finally {
    await page?.close();
    server?.stop();
    fs.rmSync(shadow, { force: true });
    if (activeBefore !== null && fs.readFileSync(activeFile, "utf8") !== activeBefore) fs.writeFileSync(activeFile, activeBefore);
    fs.rmSync(videosDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
