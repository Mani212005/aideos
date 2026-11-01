/**
 * File Description: Real studio journeys for caption click-select, drag, edge resize, lock, undo, reset and reload in both formats.
 * Captain decision 6 (movable captions as a direct object: click selects, drag moves for the whole video): the old
 * Move-captions mode, scope-tab, wide-outline and locked-drag steps are replaced by click-select-drag steps. The save, undo,
 * reload, lock-persistence, AI-panel and preview-equals-export (2 px) checks are unchanged.
 * Inputs and outputs: deterministic short narrated film and native Chrome pointer events -> saved independent placements and matching preview/export pixels.
 * Used by: npm run test:journeys and the journeys CI job.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { journey, decodeFrame } from "./harness";
import { findChromeBinary } from "../scene/renderStill";
import { startEditor, StudioPage } from "../../scripts/studioDriver";
import { runProduction } from "../pipeline/run";
import { readFilm, writeFilm } from "../pipeline/filmStore";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import { renderFormat } from "../pipeline/render";
import { captionCardRect, DEFAULT_CAPTION_PLACEMENT_WIDTH } from "../../src/dl/captionPlacement";
import { openFilm } from "./remotionFrames";
import { resolveCaptionPlacement } from "../../src/dl/captionPlacement";

const SLUG = "journey-caption-placement";
const SCRIPT =
  "## 0:00 - Question\n[NARRATION] A cache keeps recent answers close so repeated questions skip the slow database.\n[VISUAL] One request arrives at the cache.\n## 0:08 - Answer\n[NARRATION] The next request finds the saved answer and returns it to the caller.\n[VISUAL] The request returns with its answer.";
// Dispatches real pointer input to a composition-scaled control, including a release away from its start.
async function drag(
  page: StudioPage,
  selector: string,
  dx: number,
  dy: number,
): Promise<void> {
  await page.waitFor(
    `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })()`,
    "caption control ready for pointer input",
  );
  const box = await page.eval<{ x: number; y: number }>(
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: box.x,
    y: box.y,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: box.x,
    y: box.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: box.x + dx,
    y: box.y + dy,
    buttons: 1,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: box.x + dx,
    y: box.y + dy,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}
// Waits for the real autosave before inspecting disk or reloading.
async function saved(page: StudioPage): Promise<void> {
  await page.eval(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  await page.waitFor(
    `[...document.querySelectorAll('button')].some((b) => (b.title || '').startsWith('Save the project') && /saved/i.test(b.textContent))`,
    "caption autosave",
    15000,
  );
}
// Selects geometry from the active preview rather than another mounted editor surface.
function previewSelector(selector: string): string {
  return `document.querySelector('[data-preview-host]').querySelector(${JSON.stringify(selector)})`;
}
// Reads the active caption phrase and layout width without animated child transforms.
async function readVisibleCard(page: StudioPage): Promise<{ phrase: string; width: number }> {
  return page.eval<{ phrase: string; width: number }>(
    `(() => { const phrase = ${previewSelector("[data-caption-phrase]")}; const card = ${previewSelector("[data-caption-card]")}; return { phrase: phrase.innerText, width: card.offsetWidth }; })()`,
  );
}
// Reads the authoritative saved film for assertions outside React state.
function film() {
  const result = readFilm(SLUG);
  assert.ok(result);
  return result;
}

// Confirms the selection ring hugs the rendered caption card (decision 6: the entire blue box is highlighted).
async function assertRingHugsCard(page: StudioPage): Promise<void> {
  const boxes = await page.eval<{ ring: number[]; card: number[] }>(
    `(() => { const ring = ${previewSelector("[data-caption-ring]")}.getBoundingClientRect(); const card = ${previewSelector("[data-caption-card]")}.getBoundingClientRect(); return { ring: [ring.x, ring.y, ring.width, ring.height], card: [card.x, card.y, card.width, card.height] }; })()`,
  );
  for (let i = 0; i < 4; i++)
    assert.ok(Math.abs(boxes.ring[i] - boxes.card[i]) <= 1, `selection ring must hug the rendered card: ${boxes.ring.join(",")} vs ${boxes.card.join(",")}`);
}
// Compares the visible saved card with the collision rectangle in composition pixels and checks the ring hugs it.
async function assertCardGeometry(
  page: StudioPage,
  format: "long" | "reel",
  placement: ReturnType<typeof resolveCaptionPlacement>,
): Promise<void> {
  const width = format === "long" ? 1920 : 1080;
  const rect = captionCardRect(format, width, format === "long" ? 1080 : 1920, placement);
  const cardWidth = await page.eval<number>(`${previewSelector("[data-caption-card]")}.offsetWidth`);
  assert.equal(rect.w, (placement.w ?? DEFAULT_CAPTION_PLACEMENT_WIDTH) * width);
  assert.ok(Math.abs(cardWidth - rect.w) <= 1, "visible saved card matches collision width");
  await assertRingHugsCard(page);
}
// Confirms an auto-width placement keeps its content-sized rendering and that the ring hugs that visible card.
async function assertAutoCardGeometry(
  page: StudioPage,
  format: "long" | "reel",
  placement: ReturnType<typeof resolveCaptionPlacement>,
): Promise<void> {
  const width = format === "long" ? 1920 : 1080;
  const rect = captionCardRect(format, width, format === "long" ? 1080 : 1920, placement);
  assert.equal(placement.w, undefined);
  assert.equal(rect.w, DEFAULT_CAPTION_PLACEMENT_WIDTH * width);
  await assertRingHugsCard(page);
}

// Measures visible caption-word ink within its declared card for a lossy mp4 comparison.
function brightBounds(
  rgb: ReturnType<typeof decodeFrame>,
  rect: { x: number; y: number; w: number; h: number },
): number[] | null {
  let left = rgb.width,
    top = rgb.height,
    right = -1,
    bottom = -1;
  for (
    let y = Math.max(0, Math.floor(rect.y));
    y < Math.min(rgb.height, Math.ceil(rect.y + rect.h));
    y++
  )
    for (
      let x = Math.max(0, Math.floor(rect.x));
      x < Math.min(rgb.width, Math.ceil(rect.x + rect.w));
      x++
    ) {
      const i = (y * rgb.width + x) * 3;
      if (Math.max(rgb.data[i], rgb.data[i + 1], rgb.data[i + 2]) < 160)
        continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  return right >= left ? [left, top, right, bottom] : null;
}

journey(
  "J13 captions: move resize scope lock undo reset reload and preview/export in Wide and Reel",
  async (ctx) => {
    const chrome = findChromeBinary();
    if (!chrome) {
      if (process.env.AIDEOS_SMOKE_REQUIRED === "1")
        throw new Error("Chrome required for caption placement");
      return;
    }
    const produced = await runProduction({
      slug: SLUG,
      title: "Caption journey",
      script: SCRIPT,
      ttsBackend: "tone",
      design: "templates",
      broll: false,
      skipAgent: true,
      stopAfter: "design",
      syncToPreview: false,
      deviceCaller: null,
    });
    assert.equal(produced.status, "stopped");
    const original = film();
    // A resumed production run must not inherit locks from an earlier journey.
    delete original.captionPlacement;
    for (const shot of original.shots) delete shot.captionPlacement;
    writeFilm(SLUG, original, { owner: true });
    writeFilm(
      "journey-caption-empty",
      { ...original, id: "journey-caption-empty", voiceover: undefined },
      { owner: true },
    );
    const server = await startEditor(getVideosDir());
    const page = await StudioPage.open(chrome);
    try {
      await page.goto(server.url);
      await page.eval(
        `localStorage.setItem('aideos_active_film_id', 'journey-caption-empty')`,
      );
      await page.goto(`${server.url}#edit`);
      await page.reload();
      await page.waitFor(
        `/no voiceover yet/i.test(document.body.innerText)`,
        "empty Edit stage",
      );
      await page.eval(
        `(() => { const select = document.querySelector('select'); select.value = '${SLUG}'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`,
      );
      await page.waitFor(
        `document.querySelector('.__remotion-player')`,
        "late mounted player",
      );
      await page.waitFor(
        `document.querySelector('audio')?.readyState >= 2`,
        "narration ready",
      );
      await drag(page, 'button[title="Play video"]', 0, 0);
      await page.waitFor(
        `document.querySelector('.__remotion-player').innerText.includes('00:01')`,
        "player progress",
      );
      const clock = await page.eval<string>(
        `document.querySelector('button[title="Go to end (End)"]').nextElementSibling.textContent`,
      );
      assert.ok(
        !clock.startsWith("0:00:00"),
        "late mounted player must update the timeline playhead",
      );
      await page.clickButton("Pause video");
      await page.clickButton("Go to start");
      await page.waitFor(
        `document.querySelector('input[placeholder^="Ask AI to edit"]')`,
        "AI editor expanded before caption placement",
      );
      const aiPanelPosition = await page.eval<{ position: string; bottom: string; right: string }>(
        `(() => { const style = getComputedStyle(document.querySelector('[data-ai-editor-panel]')); return { position: style.position, bottom: style.bottom, right: style.right }; })()`,
      );
      assert.deepEqual(aiPanelPosition, { position: "absolute", bottom: "16px", right: "16px" });
      for (const format of ["long", "reel"] as const) {
        console.info("[caption-journey] controls", format);
        await page.clickButton(format === "long" ? "Wide" : "Reel", {
          exact: false,
        });
        // Decision 6: a click on the captions selects them (no mode button) and must not start playback.
        await page.waitFor(
          `${previewSelector("[data-caption-object]")}`,
          "caption object in the preview",
        );
        await drag(page, "[data-caption-object]", 0, 0);
        await page.waitFor(
          `${previewSelector("[data-caption-object]")}.getAttribute('aria-pressed') === 'true'`,
          "click selects the captions",
        );
        assert.equal(
          await page.eval(`!!document.querySelector('button[title="Play video"]')`),
          true,
          "clicking the captions selects them and does not start playback",
        );
        assert.equal(
          await page.eval(
            `!!document.querySelector('input[placeholder^="Ask AI to edit"]')`,
          ),
          false,
          "AI panel folds away",
        );
        assert.equal(
          await page.eval(`getComputedStyle(document.querySelector('[data-ai-editor-panel]')).display`),
          "none",
          "AI panel folds away only while the captions are selected",
        );
        const before = resolveCaptionPlacement(film(), format);
        await page.waitFor(
          `${previewSelector("[data-caption-card]")}`,
          "caption before first saved edit",
        );
        const visibleDefaultCard = await readVisibleCard(page);
        await page.clickButton("Lock", { exact: true });
        await saved(page);
        const toolbarLocked = resolveCaptionPlacement(film(), format);
        assert.equal(film().captionPlacement?.[format]?.w, undefined, "Lock leaves auto width unset");
        const lockedCard = await readVisibleCard(page);
        assert.equal(lockedCard.phrase, visibleDefaultCard.phrase, "Lock keeps the same active phrase");
        assert.ok(Math.abs(lockedCard.width - visibleDefaultCard.width) <= 1, "Lock preserves the visible auto-width card");
        await assertAutoCardGeometry(page, format, toolbarLocked);
        await page.clickButton("Default position", { exact: true });
        await saved(page);
        assert.equal(resolveCaptionPlacement(film(), format).source, "default");
        // Move above Reel's action-button strip so a saved w=.86 remains within bounds.
        const moveDy = await page.eval<number>(
          `-${previewSelector("[data-caption-overlay]")}.getBoundingClientRect().height * 0.5`,
        );
        await drag(page, "[data-caption-object]", 0, moveDy);
        await saved(page);
        assert.ok(resolveCaptionPlacement(film(), format).y < before.y);
        assert.equal(film().shots[0].captionPlacement?.[format], undefined, "a drag never writes a shot-only position");
        await page.clickButton("Undo");
        await saved(page);
        assert.equal(resolveCaptionPlacement(film(), format).y, before.y);
        await drag(page, "[data-caption-object]", 0, moveDy);
        await saved(page);
        const moved = resolveCaptionPlacement(film(), format);
        assert.equal(film().captionPlacement?.[format]?.w, undefined, "moving an auto-width caption leaves w unset");
        assert.ok(moved.x !== before.x || moved.y !== before.y);
        await assertAutoCardGeometry(page, format, moved);
        await drag(
          page,
          'button[aria-label="Resize caption right edge"]',
          -35,
          0,
        );
        await saved(page);
        const resizedPlacement = resolveCaptionPlacement(film(), format);
        await assertCardGeometry(page, format, resizedPlacement);
        assert.ok(
          resolveCaptionPlacement(film(), format).w! < DEFAULT_CAPTION_PLACEMENT_WIDTH,
          "edge drag narrows the actual card",
        );
        // Decision 4: Lock only protects the captions from agents and rebuilds; the owner can still drag them.
        await page.clickButton("Lock", { exact: true });
        await saved(page);
        const locked = resolveCaptionPlacement(film(), format);
        assert.equal(locked.locked, true);
        await drag(page, "[data-caption-object]", 0, 30);
        await saved(page);
        const draggedWhileLocked = resolveCaptionPlacement(film(), format);
        assert.equal(draggedWhileLocked.locked, true, "the lock survives an owner drag");
        assert.ok(draggedWhileLocked.y !== locked.y, "an owner can still drag locked captions");
        assert.equal(film().shots[0].captionPlacement?.[format], undefined, "no shot-only position appears");
        console.info("[caption-journey] reload", format);
        await page.reload();
        await page.waitFor(
          `document.querySelector('.__remotion-player')`,
          "reloaded preview",
        );
        if (format === "reel") await page.clickButton("Reel");
        await page.clickButton("Captions", { exact: true });
        await page.waitFor(
          `document.querySelector('[aria-label="Caption placement locked"]')`,
          "persisted lock",
        );
        await page.clickButton("Unlock", { exact: true });
        await saved(page);
        await page.clickButton("Default position", { exact: true });
        await saved(page);
        assert.equal(film().shots[0].captionPlacement?.[format], undefined);
        assert.equal(film().captionPlacement?.[format], undefined);
        // Leave a real placement for the independent native Player/export comparison. A resize now starts from the
        // visible card, so widening keeps a card wide enough for the Player page and the export to wrap identically.
        await drag(page, "[data-caption-object]", 0, -45);
        await saved(page);
        await drag(page, 'button[aria-label="Resize caption right edge"]', 300, 0);
        await saved(page);
        await page.clickButton("Lock", { exact: true });
        await saved(page);
        await page.clickButton("Captions", { exact: true });
        await page.waitFor(
          `document.querySelector('input[placeholder^="Ask AI to edit"]')`,
          "AI editor expansion restored after caption placement",
        );
        console.info("[caption-journey] controls passed", format);
      }
      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
      server.stop();
    }

    const exported = await openFilm(SLUG);
    const comparisonServer = await startEditor(getVideosDir());
    const comparison = await StudioPage.open(chrome);
    try {
      for (const composition of ["Long", "Reel"] as const) {
        console.info("[caption-journey] export comparison", composition);
        const size =
          composition === "Long"
            ? { width: 1920, height: 1080 }
            : { width: 1080, height: 1920 };
        await comparison.send("Emulation.setDeviceMetricsOverride", {
          ...size,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await comparison.goto(
          `${comparisonServer.url}journeys/player.html?film=${SLUG}&format=${composition}&frame=45`,
        );
        await comparison.waitFor(
          `document.querySelector('[data-caption-card]')`,
          "caption at absolute frame",
        );
        await comparison.eval("document.fonts.ready");
        await comparison.eval(
          "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        );
        const preview = path.join(
          ctx.workDir,
          `${composition}-caption-preview.png`,
        );
        const output = path.join(
          ctx.workDir,
          `${composition}-caption-export.png`,
        );
        fs.writeFileSync(
          preview,
          await comparison.screenshot(".__remotion-player"),
        );
        await exported.still(composition, 45, output);
        ctx.keep(preview);
        ctx.keep(output);
        const mp4 = path.join(ctx.workDir, `${composition}-caption-export.mp4`);
        const format = composition === "Long" ? "long" : "reel";
        await renderFormat(format, mp4, { frames: [45, 45], concurrency: 2 });
        ctx.keep(mp4);
        const rect = captionCardRect(
          format,
          size.width,
          size.height,
          resolveCaptionPlacement(film(), format),
        );
        const renderedCardWidth = await comparison.eval<number>(
          `document.querySelector('[data-caption-card]').offsetWidth`,
        );
        assert.ok(
          Math.abs(renderedCardWidth - rect.w) <= 1,
          `${composition} visible caption card width differs from its collision rectangle`,
        );
        const previewBounds = brightBounds(decodeFrame(preview), rect);
        const stillBounds = brightBounds(decodeFrame(output), rect);
        assert.ok(
          previewBounds && stillBounds,
          "caption words must be present in Player and exported PNG",
        );
        for (let i = 0; i < previewBounds.length; i++)
          assert.ok(
            Math.abs(previewBounds[i] - stillBounds[i]) <= 2,
            `${composition} caption PNG box differs by more than 2 px: ${previewBounds.join(",")} vs ${stillBounds.join(",")}`,
          );
        const videoBounds = brightBounds(decodeFrame(mp4), rect);
        assert.ok(
          previewBounds && videoBounds,
          "caption words must be present in preview and mp4",
        );
        for (let i = 0; i < previewBounds.length; i++)
          assert.ok(
            Math.abs(previewBounds[i] - videoBounds[i]) <= 2,
            `${composition} caption mp4 box differs by more than 2 px`,
          );
      }
      assert.deepEqual(comparison.errors, []);
    } finally {
      await comparison.close();
      comparisonServer.stop();
      await exported.close();
    }
  },
);
