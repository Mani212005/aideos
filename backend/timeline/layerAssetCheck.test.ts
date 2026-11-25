/**
 * File Description: Behavioural tests of the write-time Rule 6 guard: a film write may not introduce a media source that is missing on disk, but a film that already names a missing file stays writable.
 * Inputs and outputs: films written against a throwaway public/ folder with real and absent files -> thrown Rule 6 violations or silence.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertFilmWriteAssetsExist } from "./layerAssetCheck";
import type { Film } from "../../src/dl/schema";

/** A minimal valid film that carries the given audio clip sources. */
function filmWithAudio(...sources: string[]): Film {
  return {
    id: "asset-guard-film",
    title: "Asset guard film",
    fps: 30,
    chapters: ["Ch 1"],
    canvas: { nodes: [{ id: "n1", label: "Node 1", x: 0, y: 0, w: 190, h: 62 }], edges: [] },
    shots: [{ id: "shot-1", dur: 20, stage: "frame", look: "n1", move: "cut", drift: false, zoom: 1, blocks: [] }],
    audioClips: sources.map((src, i) => ({ id: `clip-${i}`, src, position: 0, start: 0, end: 2, volume: 1, channel: "external" as const })),
  } as Film;
}

/** Runs `body` with a throwaway public/ folder that holds `files`, then removes it. */
function withPublicDir(files: string[], body: (publicDir: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-asset-guard-"));
  const publicDir = path.join(root, "public");
  try {
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(publicDir, file)), { recursive: true });
      fs.writeFileSync(path.join(publicDir, file), "x");
    }
    fs.mkdirSync(publicDir, { recursive: true });
    body(publicDir);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("a write that introduces a missing source is refused and names the file", () => {
  withPublicDir(["media/here.wav"], (baseDir) => {
    const previous = filmWithAudio("media/here.wav");
    const next = filmWithAudio("media/here.wav", "media/gone.wav");
    assert.throws(() => assertFilmWriteAssetsExist(next, previous, { baseDir }), /Rule 6 violation.*"media\/gone\.wav"/);
  });
});

test("a write whose new sources exist on disk is accepted", () => {
  withPublicDir(["media/here.wav", "media/also-here.wav"], (baseDir) => {
    assert.doesNotThrow(() => assertFilmWriteAssetsExist(filmWithAudio("media/here.wav", "media/also-here.wav"), filmWithAudio("media/here.wav"), { baseDir }));
    assert.doesNotThrow(() => assertFilmWriteAssetsExist(filmWithAudio("media/here.wav"), null, { baseDir }));
  });
});

test("a film that already names a missing file can still be saved, so it can be fixed", () => {
  withPublicDir([], (baseDir) => {
    const broken = filmWithAudio("media/long-gone.wav");
    assert.doesNotThrow(() => assertFilmWriteAssetsExist(broken, broken, { baseDir }));
  });
});

test("a brand new film with a missing source is refused", () => {
  withPublicDir([], (baseDir) => {
    assert.throws(() => assertFilmWriteAssetsExist(filmWithAudio("media/never-uploaded.wav"), null, { baseDir }), /never-uploaded\.wav/);
  });
});

test("a remote URL source is not judged against the disk", () => {
  withPublicDir([], (baseDir) => {
    assert.doesNotThrow(() => assertFilmWriteAssetsExist(filmWithAudio("https://cdn.example.com/a.wav"), null, { baseDir }));
  });
});

test("a soundtrack library item that is not fetched yet is not a missing file", () => {
  withPublicDir([], (baseDir) => {
    const film = { ...filmWithAudio(), soundtrack: { sections: [{ role: "hook", item: "mk-556", from: 0, to: 5 }], speech: [], sfx: [], credits: [] } } as unknown as Film;
    assert.doesNotThrow(() => assertFilmWriteAssetsExist(film, null, { baseDir }));
  });
});

test("a project media file is found when a write runs from another directory", () => {
  withPublicDir(["media/elsewhere.wav"], (publicDir) => {
    const previousRoot = process.env.AIDEOS_PROJECT_ROOT;
    const previousCwd = process.cwd();
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-asset-cwd-"));
    try {
      process.env.AIDEOS_PROJECT_ROOT = path.dirname(publicDir);
      process.chdir(otherDir);
      assert.doesNotThrow(() => assertFilmWriteAssetsExist(filmWithAudio("media/elsewhere.wav"), null));
    } finally {
      process.chdir(previousCwd);
      if (previousRoot === undefined) delete process.env.AIDEOS_PROJECT_ROOT;
      else process.env.AIDEOS_PROJECT_ROOT = previousRoot;
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});
