/**
 * File Description: J3 studio edit journeys in a real headless Chrome: (1) the AI edit Apply gesture, (2) new project, script save and reload. Before this, Apply Edits rolled back in the browser on a Node-only import (`path.resolve` externalized by Vite) while every Node test passed, and the script-save path had no browser coverage at all.
 * The journey makes the model-backed `/api/ai-edit` endpoint deterministic by answering it from the test (a valid `set_accent` plan) and leaves every other request real: the click on Apply Edits runs the real interpreter in the page, and the save, the edit log and the reload hit the real dev server and disk.
 * Inputs and outputs: a throwaway videos folder with a film made by the real pipeline (tone narration, template design, no model or key) -> asserts the edit is applied, written to film.json, logged, and still there after a reload; a new project's script is on disk and in the editor after a reload.
 * Used by: npm run test:journeys and npm run ci journeys (needs Chrome; AIDEOS_SMOKE_REQUIRED=1 turns a missing Chrome into a failure).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { journey } from "./harness";
import { findChromeBinary } from "../scene/renderStill";
import { startEditor, StudioPage } from "../../scripts/studioDriver";

const ROOT = path.resolve(__dirname, "../..");
const AI_SLUG = "journey-ai-edit";
const NEW_SLUG = "journey-new-project";
const NEW_ACCENT = "#ff5500";
const SCRIPT = [
  "## 0:00 - Idea",
  "[NARRATION] A load balancer shares incoming requests across several servers so that no single machine is overwhelmed by traffic.",
  "[VISUAL] A row of servers",
  "## 0:10 - Check",
  "[NARRATION] Every few seconds it asks each server whether it is healthy, and it stops sending work to any server that stays silent.",
  "[VISUAL] A heartbeat line",
].join("\n");

/** Runs `body` against a live studio on a throwaway videos folder, then restores the env, the generated shadows and the processes. */
async function withStudio(slugs: string[], body: (studio: { page: StudioPage; url: string; videosDir: string; serverLog: () => string }) => Promise<void>): Promise<void> {
  const chrome = findChromeBinary();
  if (!chrome) {
    if (process.env.AIDEOS_SMOKE_REQUIRED === "1") throw new Error("no Chrome or Chromium found; set AIDEOS_CHROME_PATH");
    console.warn("[journey] skipped: no Chrome or Chromium found (set AIDEOS_CHROME_PATH to enable)");
    return;
  }
  const videosDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-journey-studio-"));
  const envBefore = process.env.AIDEOS_VIDEOS_DIR;
  process.env.AIDEOS_VIDEOS_DIR = videosDir;
  let server: Awaited<ReturnType<typeof startEditor>> | undefined;
  let page: StudioPage | undefined;
  try {
    const { runProduction } = await import("../pipeline/run");
    const produced = await runProduction({ script: SCRIPT, title: "Journey studio", slug: AI_SLUG, ttsBackend: "tone", design: "templates", broll: false, skipAgent: true, stopAfter: "design", syncToPreview: false, deviceCaller: null });
    assert.equal(produced.status, "stopped", `could not prepare the journey film: ${produced.status} ${produced.warnings.join("; ")}`);
    server = await startEditor(videosDir);
    page = await StudioPage.open(chrome);
    await body({ page, url: server.url, videosDir, serverLog: server.log });
  } finally {
    await page?.close();
    server?.stop();
    for (const slug of slugs) fs.rmSync(path.join(ROOT, "src/dl/films", `${slug}.ts`), { force: true });
    if (envBefore === undefined) delete process.env.AIDEOS_VIDEOS_DIR;
    else process.env.AIDEOS_VIDEOS_DIR = envBefore;
    fs.rmSync(videosDir, { recursive: true, force: true });
  }
}

/** Opens the studio on one project at one stage with a fresh app state. */
async function openProject(page: StudioPage, url: string, slug: string, stage: string): Promise<void> {
  await page.goto(url);
  await page.eval(`localStorage.setItem('aideos_active_film_id', ${JSON.stringify(slug)})`);
  await page.goto(`${url}#${stage}`);
  await page.reload();
}

/** Fails with every browser error and dev-server error seen, so a journey that "passed" through a swallowed exception cannot. */
function assertNoErrors(page: StudioPage, serverLog: string): void {
  assert.deepEqual(page.errors, [], "errors in the browser");
  const serverErrors = serverLog.split("\n").filter((line) => /\[vite\].*(error|Error)/.test(line));
  assert.deepEqual(serverErrors, [], "dev server errors");
}

/** Waits for the header save button to report the autosave finished. */
async function waitForSaved(page: StudioPage): Promise<void> {
  await page.waitFor(`[...document.querySelectorAll('button')].some((b) => (b.getAttribute('title') || '').startsWith('Save the project') && /saved/i.test(b.textContent))`, "the autosave to finish", 15000);
}

journey("J3 studio: Apply Edits on an AI edit plan applies, saves and survives a reload", async () => {
  await withStudio([AI_SLUG], async ({ page, url, videosDir, serverLog }) => {
    const filmFile = path.join(videosDir, AI_SLUG, "film.json");
    const accentBefore = (JSON.parse(fs.readFileSync(filmFile, "utf8")) as { accent: string }).accent;
    assert.notEqual(accentBefore.toLowerCase(), NEW_ACCENT, "the fixture plan must change something");

    const planRequests: Array<{ request?: string; dryRun?: boolean; film?: { id?: string } }> = [];
    await page.intercept("POST", "/api/ai-edit", (req) => {
      planRequests.push(JSON.parse(req.body ?? "{}"));
      return { json: { ok: true, dryRun: true, plan: "Set the accent colour to orange.", ops: [{ op: "set_accent", hex: NEW_ACCENT }], warnings: [], attempts: 1 } };
    });

    await openProject(page, url, AI_SLUG, "edit");
    await page.waitFor(`document.querySelector('.__remotion-player')`, "the preview player");

    // The user asks, reviews the plan, and clicks Apply Edits.
    await page.waitFor(`document.querySelector('input[placeholder^="Ask AI to edit"]')`, "the AI edit prompt");
    await page.focus('input[placeholder^="Ask AI to edit"]');
    await page.typeText("make the accent orange");
    await page.clickButton("Plan", { exact: true });
    await page.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Apply Edits')`, "the plan to be shown");
    assert.equal(planRequests.length, 1, "the studio asked for exactly one plan");
    assert.equal(planRequests[0].request, "make the accent orange");
    assert.equal(planRequests[0].film?.id, AI_SLUG);
    await page.clickButton("Apply Edits", { exact: true });

    await page.waitFor(`document.body.innerText.includes('Applied AI edit successfully') || document.body.innerText.includes('Application rejected')`, "the apply to finish");
    const shown = await page.eval<string>("document.body.innerText");
    assert.ok(!shown.includes("Application rejected"), `Apply Edits was rejected: ${/Application rejected[^\n]*/.exec(shown)?.[0]}`);
    assert.ok(shown.includes("Applied AI edit successfully"), "the studio did not confirm the edit");

    // It is on disk (the apply gesture's own save and the autosave), and the edit is logged as committed.
    await waitForSaved(page);
    const saved = JSON.parse(fs.readFileSync(filmFile, "utf8")) as { accent: string };
    assert.equal(saved.accent.toLowerCase(), NEW_ACCENT, "film.json on disk does not carry the applied edit");
    const log = fs.readFileSync(path.join(videosDir, AI_SLUG, "edit_log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { dryRun?: boolean; source?: string; ops?: Array<{ op: string }> });
    const committed = log.filter((r) => r.dryRun === false);
    assert.equal(committed.length, 1, "the committed edit is in edit_log.jsonl exactly once");
    assert.equal(committed[0].ops?.[0]?.op, "set_accent");

    // Reload: the studio reads the film back and shows the new accent on its own controls.
    await page.reload();
    await page.waitFor(`document.querySelector('.__remotion-player')`, "the preview player after reload");
    await page.waitFor(`document.querySelector('input[placeholder^="Ask AI to edit"]')`, "the AI edit prompt after reload");
    await page.focus('input[placeholder^="Ask AI to edit"]');
    await page.typeText("x");
    const planBackground = await page.eval<string>(`getComputedStyle([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Plan')).backgroundColor`);
    assert.equal(planBackground, "rgb(255, 85, 0)", "after a reload the studio does not show the applied accent");
    assertNoErrors(page, serverLog());
  });
});

journey("J3 studio: a new project's script saves to disk and is still there after a reload", async () => {
  await withStudio([AI_SLUG, NEW_SLUG], async ({ page, url, videosDir, serverLog }) => {
    await openProject(page, url, AI_SLUG, "edit");
    await page.waitFor(`document.querySelector('.__remotion-player')`, "the preview player");

    // Create an empty project from the dialog, the way the header button does.
    await page.clickButton("Create a new project");
    await page.waitFor(`document.querySelector('#np-title')`, "the new project dialog");
    await page.focus("#np-title");
    await page.typeText("Journey new project");
    assert.equal(await page.eval<string>(`document.querySelector('#np-slug').value`), NEW_SLUG, "the identifier follows the title");
    await page.clickButton("Empty project");
    await page.clickButton("Create project", { exact: true });
    await page.waitFor(`document.querySelector('textarea[aria-label="Screenplay text"]')`, "the script stage of the new project");
    assert.ok(fs.existsSync(path.join(videosDir, NEW_SLUG, "script.md")), "creating the project did not write script.md");

    // Write a script and save it with the Save Script button.
    const written = "## 0:00 - Cache\n[NARRATION] A cache keeps recent answers close so that repeated questions skip the slow database.\n[VISUAL] A box in front of a database";
    await page.focus('textarea[aria-label="Screenplay text"]');
    await page.eval(`document.querySelector('textarea[aria-label="Screenplay text"]').select()`);
    await page.typeText(written);
    await page.clickButton("Save Script", { exact: true });
    const scriptFile = path.join(videosDir, NEW_SLUG, "script.md");
    const deadline = Date.now() + 10000;
    while (fs.readFileSync(scriptFile, "utf8").trim() !== written && Date.now() < deadline) await new Promise((r) => setTimeout(r, 150));
    assert.equal(fs.readFileSync(scriptFile, "utf8").trim(), written, "script.md on disk is not the script the user saved");

    await page.reload();
    await page.waitFor(`document.querySelector('textarea[aria-label="Screenplay text"]')`, "the script stage after reload");
    await page.waitFor(`document.querySelector('textarea[aria-label="Screenplay text"]').value.includes('A cache keeps recent answers')`, "the saved script to be shown after reload");
    assertNoErrors(page, serverLog());
  });
});
