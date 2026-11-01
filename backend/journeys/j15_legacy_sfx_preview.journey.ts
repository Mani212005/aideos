/**
 * File Description: Real studio journey for a film whose legacy sfx entries carry durationSec: the preview must play through them without mounting more Html5Audio tags than the Player allows.
 * Inputs and outputs: short film with voiceover, music and eight legacy sfx, played in headless Chrome -> no Html5Audio mount error and a preview that keeps advancing.
 * Used by: npm run test:journeys (the CI journeys job).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { journey, REPO_ROOT } from "./harness";
import { findChromeBinary } from "../scene/renderStill";
import { startEditor, StudioPage } from "../../scripts/studioDriver";
import { writeFilm, packageDir } from "../pipeline/filmStore";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import type { Film } from "../../src/dl/schema";

const SLUG = "journey-legacy-sfx-preview";
const SFX_COUNT = 8;

// Writes a silent mono WAV so the journey needs no recording and no tone synthesis.
function silentWav(file: string, seconds: number): void {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", String(seconds), file]);
}

journey("legacy sfx with durationSec: the studio preview plays past more effects than the Player has audio tags", async () => {
  const chrome = findChromeBinary();
  if (!chrome) {
    if (process.env.AIDEOS_SMOKE_REQUIRED === "1") throw new Error("Chrome required for the legacy sfx preview journey");
    return;
  }
  const pkgDir = packageDir(SLUG);
  fs.mkdirSync(path.join(pkgDir, "audio"), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, "examples/hello-scene/visuals"), path.join(pkgDir, "visuals"), { recursive: true });
  silentWav(path.join(pkgDir, "voiceover.wav"), 12);
  silentWav(path.join(pkgDir, "audio/music.wav"), 12);
  silentWav(path.join(pkgDir, "audio/sfx-tick.wav"), 0.2);

  const film: Film = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "examples/hello-scene/film.json"), "utf8"));
  film.id = SLUG;
  film.voiceover = { src: `videos/${SLUG}/voiceover.wav`, volume: 0.7 };
  film.music = { src: `videos/${SLUG}/audio/music.wav`, volume: 1, duckUnderVoiceover: true };
  // Eight short effects inside the first four seconds: with voiceover and music that is ten tags if none unmounts.
  film.sfx = Array.from({ length: SFX_COUNT }, (_, i) => ({
    timeSec: 0.2 + i * 0.4,
    src: `videos/${SLUG}/audio/sfx-tick.wav`,
    volume: 0.35,
    durationSec: 0.2,
  }));
  writeFilm(SLUG, film, { owner: true });

  const server = await startEditor(getVideosDir());
  let page: StudioPage | undefined;
  try {
    page = await StudioPage.open(chrome);
    await page.goto(server.url);
    await page.eval(`localStorage.setItem('aideos_active_film_id', ${JSON.stringify(SLUG)})`);
    await page.goto(`${server.url}#edit`);
    await page.reload();
    await page.waitFor(`document.querySelector('button[title="Play (Space)"]')`, "Edit stage play button");
    // A real pointer press gives the page the user activation Chrome requires before audio may play.
    const box = await page.eval<{ x: number; y: number }>(
      `(() => { const r = document.querySelector('button[title="Play (Space)"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    );
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", buttons: 0, clickCount: 1 });
    // Time on the transport readout moving past the last effect (3.0s plus its length) proves the preview did not stop.
    await page.waitFor(
      `(() => { const m = /0:0*(\\d+) \\/ /.exec(document.body.innerText); return m && Number(m[1]) >= 4; })()`,
      "playhead past the last effect",
      30000,
    );
    const audioErrors = page.errors.filter((e) => /Html5Audio|simultaneously mount/.test(e));
    assert.deepEqual(audioErrors, [], "the preview mounted more Html5Audio tags than the Player allows");
    assert.deepEqual(page.errors, [], "the preview played without a browser error");
  } finally {
    await page?.close();
    server.stop();
  }
});
