/**
 * File Description: Real studio journeys for caption move, edge resize, both scopes, lock, undo, reset and reload in both formats.
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
import { captionCardRect } from "../../src/dl/captionPlacement";
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
// Reads the authoritative saved film for assertions outside React state.
function film() {
  const result = readFilm(SLUG);
  assert.ok(result);
  return result;
}

// Compares the visible saved card and drag outline with the collision rectangle in composition pixels.
async function assertCardGeometry(
  page: StudioPage,
  format: "long" | "reel",
  placement: ReturnType<typeof resolveCaptionPlacement>,
): Promise<void> {
  const width = format === "long" ? 1920 : 1080;
  const rect = captionCardRect(format, width, format === "long" ? 1080 : 1920, placement);
  const widths = await page.eval<{ handle: number; card: number }>(
    `(() => { const frame = document.querySelector('[data-caption-guides]'); const handle = document.querySelector('[data-caption-handle]'); const card = document.querySelector('[data-caption-card]'); return { handle: handle.getBoundingClientRect().width / frame.getBoundingClientRect().width * ${width}, card: card.offsetWidth }; })()`,
  );
  assert.equal(rect.w, placement.w * width);
  assert.ok(Math.abs(widths.handle - rect.w) <= 1, "drag outline matches collision width");
  assert.ok(Math.abs(widths.card - rect.w) <= 1, "visible saved card matches collision width");
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
      for (const format of ["long", "reel"] as const) {
        console.info("[caption-journey] controls", format);
        await page.clickButton(format === "long" ? "Wide" : "Reel", {
          exact: false,
        });
        await page.clickButton("Move captions", { exact: true });
        await page.waitFor(
          `document.querySelector('[data-caption-handle]')`,
          "caption move overlay",
        );
        assert.equal(
          await page.eval(
            `!!document.querySelector('input[placeholder^="Ask AI to edit"]')`,
          ),
          false,
          "AI panel folds away",
        );
        const before = resolveCaptionPlacement(film(), format);
        await page.waitFor(
          `document.querySelector('[data-caption-card]')`,
          "caption before first saved edit",
        );
        const visibleDefaultWidth = await page.eval<number>(
          `document.querySelector('[data-caption-card]').getBoundingClientRect().width / document.querySelector('[data-caption-guides]').getBoundingClientRect().width * ${format === "long" ? 1920 : 1080}`,
        );
        await page.clickButton("Lock", { exact: true });
        await saved(page);
        const toolbarLocked = resolveCaptionPlacement(film(), format);
        assert.ok(Math.abs(toolbarLocked.w * (format === "long" ? 1920 : 1080) - visibleDefaultWidth) <= 1, `toolbar Lock saves the visible default width (${toolbarLocked.w * (format === "long" ? 1920 : 1080)} vs ${visibleDefaultWidth}; source ${before.source})`);
        await assertCardGeometry(page, format, toolbarLocked);
        await page.clickButton("Reset", { exact: true });
        await saved(page);
        assert.equal(resolveCaptionPlacement(film(), format).source, "default");
        await page.clickButton("This shot only", { exact: true });
        await saved(page);
        const scopedDefault = resolveCaptionPlacement(film(), format, film().shots[0].id);
        assert.ok(Math.abs(scopedDefault.w * (format === "long" ? 1920 : 1080) - visibleDefaultWidth) <= 1, `shot scope saves the visible default width (${scopedDefault.w * (format === "long" ? 1920 : 1080)} vs ${visibleDefaultWidth}; source ${scopedDefault.source})`);
        await assertCardGeometry(page, format, scopedDefault);
        await page.clickButton("Reset", { exact: true });
        await saved(page);
        await page.clickButton("Whole film", { exact: true });
        // Move above Reel's action-button strip so a saved w=.86 remains within bounds.
        const moveDy = await page.eval<number>(
          `-document.querySelector('[data-caption-guides]').getBoundingClientRect().height * 0.5`,
        );
        await drag(page, "[data-caption-handle]", 0, moveDy);
        await saved(page);
        assert.ok(resolveCaptionPlacement(film(), format).y < before.y);
        await page.clickButton("Undo");
        await saved(page);
        assert.equal(resolveCaptionPlacement(film(), format).y, before.y);
        await drag(page, "[data-caption-handle]", 0, moveDy);
        await saved(page);
        const moved = resolveCaptionPlacement(film(), format);
        assert.ok(moved.w < before.w, "the first gesture saves the rendered default card width");
        await assertCardGeometry(page, format, moved);
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
          resolveCaptionPlacement(film(), format).w < moved.w,
          "edge drag narrows the actual card",
        );
        await page.clickButton("This shot only", { exact: true });
        await saved(page);
        const shotId = film().shots[0].id;
        const whole = film().captionPlacement?.[format];
        await drag(page, "[data-caption-handle]", 10, -20);
        await saved(page);
        assert.deepEqual(film().captionPlacement?.[format], whole);
        assert.ok(film().shots[0].captionPlacement?.[format]);
        assert.equal(film().shots[1].captionPlacement?.[format], undefined);
        await page.clickButton("Lock", { exact: true });
        await saved(page);
        const locked = resolveCaptionPlacement(film(), format, shotId);
        await drag(page, "[data-caption-handle]", 35, -30);
        await saved(page);
        assert.deepEqual(
          resolveCaptionPlacement(film(), format, shotId),
          locked,
        );
        console.info("[caption-journey] reload", format);
        await page.reload();
        await page.waitFor(
          `document.querySelector('.__remotion-player')`,
          "reloaded preview",
        );
        if (format === "reel") await page.clickButton("Reel");
        await page.clickButton("Move captions", { exact: true });
        await page.waitFor(
          `document.querySelector('[aria-label="Caption placement locked"]')`,
          "persisted lock",
        );
        await page.clickButton("Unlock", { exact: true });
        await saved(page);
        await page.clickButton("Reset", { exact: true });
        await saved(page);
        assert.equal(film().shots[0].captionPlacement?.[format], undefined);
        await page.clickButton("Whole film", { exact: true });
        await page.clickButton("Reset", { exact: true });
        await saved(page);
        assert.equal(film().captionPlacement?.[format], undefined);
        // Leave a real placement for the independent native Player/export comparison.
        await drag(page, "[data-caption-handle]", 0, -45);
        await saved(page);
        await drag(page, 'button[aria-label="Resize caption right edge"]', -40, 0);
        await saved(page);
        await page.clickButton("Lock", { exact: true });
        await saved(page);
        await page.clickButton("Move captions", { exact: true });
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
