/**
 * File Description: End-to-end test of the live Studio save route against the Rule 6 asset guard: saving a film that names a media file missing on disk is refused with 422 and writes nothing, while the same film pointing at a real file saves.
 * Inputs and outputs: POST /api/films/:id against a real Studio dev server on a throwaway videos folder -> status codes and the package folder contents.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startEditor } from "../scripts/studioDriver";
import { FILMS_DIR, readActiveFilmSource, restoreActiveFilmSource } from "./pipeline/filmStore";

const FILM_ID = "asset-guard-live";

/** A minimal valid film whose one audio clip points at `src`. */
function filmWithAudio(src: string) {
  return {
    id: FILM_ID,
    title: "Asset guard live",
    fps: 30,
    chapters: ["Ch 1"],
    canvas: {
      nodes: [
        { id: "n1", label: "Node 1", x: 0, y: 0, w: 190, h: 62 },
        { id: "n2", label: "Node 2", x: 300, y: 0, w: 190, h: 62 },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
    shots: [{ id: "shot-1", dur: 20, stage: "frame", look: "n1", move: "cut", drift: false, zoom: 1, blocks: [{ c: "StatCounter", to: 90, label: "Speed", format: "plain" }] }],
    audioClips: [{ id: "clip-0", src, position: 0, start: 0, end: 2, volume: 1, channel: "external" }],
  };
}

test("Live Studio save refuses a film that names a missing media file and saves one that names a real file", async () => {
  const videosDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-save-assets-"));
  const activeFilmBefore = readActiveFilmSource();
  const server = await startEditor(videosDir);
  const origin = new URL(server.url).origin;
  const save = (film: unknown) =>
    fetch(new URL(`/api/films/${FILM_ID}`, server.url), { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ film }) });

  try {
    const refused = await save(filmWithAudio("media/never-uploaded-xyz.wav"));
    const text = await refused.clone().text();
    assert.equal(refused.status, 422, text);
    const body = (await refused.json()) as { error: string; code: string };
    assert.equal(body.code, "missing_asset");
    assert.match(body.error, /never-uploaded-xyz\.wav/);
    assert.equal(fs.existsSync(path.join(videosDir, FILM_ID, "film.json")), false, "a refused save writes no film.json");

    const accepted = await save(filmWithAudio("test_fixtures/test_audio.wav"));
    assert.equal(accepted.status, 200, `the same film with a real file saves (server log: ${server.log().slice(-500)})`);
    assert.equal(fs.existsSync(path.join(videosDir, FILM_ID, "film.json")), true);
  } finally {
    server.stop();
    restoreActiveFilmSource(activeFilmBefore);
    fs.rmSync(path.join(FILMS_DIR, `${FILM_ID}.ts`), { force: true });
    fs.rmSync(videosDir, { recursive: true, force: true });
  }
});
