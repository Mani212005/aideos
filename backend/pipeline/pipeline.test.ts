/**
 * File Description: Tests for the production pipeline's pure stages - screenplay flattening,
 * footage-request selection, and the design compiler that turns a screenplay plus a measured
 * narration spine into a validated film. Each test pins a defect the pipeline has to keep out of
 * the finished video: stage directions leaking on screen, B-roll landing on a shot longer than the
 * clip that covers it, shot durations drifting away from the narration, and runsheet violations
 * that would fail validation only after a render had already been paid for.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { parseClaudeScript } from "../scriptIntake";
import { compileFilmFromScreenplay, flattenScreenplay } from "./design";
import { buildFootagePrompt } from "./run";
import { slugify, writeFilm, readFilm, wireFootageIntoFilm, VIDEOS_DIR, FILMS_DIR } from "./filmStore";
import { buildTimeline, totalFrames } from "../../src/dl/camera";
import type { SegmentAudioInfo } from "../audio";

const SCRIPT = `# Probe Film

## 0:00 - 0:20 - The Opening (opening)

[VISUAL] B-roll: a single drop of water falling in near darkness.
[ON SCREEN] The first idea
[NARRATION] This is the first thing the narrator says out loud.

[ON SCREEN] A second line
[NARRATION] This is the second thing, and it runs a little longer than the first one did.

## 0:20 - 0:44 - The Middle (middle)

[ON SCREEN] Seventy billion parameters
[NARRATION] To produce a single token the model reads seventy billion parameters out of memory.

[NARRATION] The arithmetic is trivial next to the move, so the chip spends its life waiting.

## 0:44 - 1:04 - The Close (close)

[ON SCREEN] Two to three times faster
[NARRATION] In practice this delivers two to three times the throughput on ordinary prose.

[NARRATION] Which is the lesson underneath all of it, and the reason the trick works at all.
`;

/** Builds a narration spine of the given per-segment durations, laid end to end with gaps. */
function spine(durations: number[], gapSec = 0.2): { segments: SegmentAudioInfo[]; shotDurations: number[] } {
  const segments: SegmentAudioInfo[] = [];
  let cursor = 0;
  durations.forEach((duration, i) => {
    segments.push({ text: `segment ${i}`, duration, startOffset: cursor, words: [], utterances: [] });
    cursor += duration + (i < durations.length - 1 ? gapSec : 0);
  });
  const shotDurations = segments.map((seg, i) => {
    const next = segments[i + 1];
    return (next ? next.startOffset : cursor) - seg.startOffset;
  });
  return { segments, shotDurations };
}

test("flattenScreenplay: yields one beat per narration line, in document order", () => {
  const beats = flattenScreenplay(parseClaudeScript(SCRIPT));
  assert.equal(beats.length, 6);
  assert.equal(beats[0].sectionId, "opening");
  assert.equal(beats[5].sectionId, "close");
  assert.ok(beats[0].narration.startsWith("This is the first thing"));
});

test("flattenScreenplay: a footage direction covers only the beat it introduces", () => {
  const beats = flattenScreenplay(parseClaudeScript(SCRIPT));
  assert.equal(beats[0].wantsFootage, true, "the beat the B-roll direction precedes wants footage");
  assert.equal(
    beats[1].wantsFootage,
    false,
    "the next beat must not inherit it, or the marker leaks down the whole section",
  );
});

test("compileFilmFromScreenplay: shot durations reproduce the narration spine exactly", () => {
  const { segments, shotDurations } = spine([6, 8, 9, 7, 8, 10]);
  const { film } = compileFilmFromScreenplay(SCRIPT, segments, shotDurations, { title: "Probe Film" });

  assert.equal(film.shots.length, shotDurations.length);
  film.shots.forEach((shot, i) => {
    assert.ok(Math.abs(shot.dur - shotDurations[i]) < 0.001, `shot ${i} drifted from its narration`);
  });

  const audioTotal = shotDurations.reduce((a, b) => a + b, 0);
  const renderedSec = totalFrames(buildTimeline(film)) / film.fps;
  assert.ok(
    Math.abs(renderedSec - audioTotal) < 1 / film.fps,
    `the render runs ${renderedSec.toFixed(3)}s against ${audioTotal.toFixed(3)}s of narration`,
  );
});

test("compileFilmFromScreenplay: narration goes to scriptText and visual direction never becomes on-screen copy", () => {
  const { segments, shotDurations } = spine([6, 8, 9, 7, 8, 10]);
  const { film } = compileFilmFromScreenplay(SCRIPT, segments, shotDurations, { title: "Probe Film" });
  const beats = flattenScreenplay(parseClaudeScript(SCRIPT));

  film.shots.forEach((shot, i) => {
    assert.equal(shot.scriptText, beats[i].narration);
  });

  const rendered = film.shots.flatMap((s) =>
    s.blocks.flatMap((b) => ("text" in b ? [b.text] : "caption" in b && b.caption ? [b.caption] : [])),
  );
  for (const text of rendered) {
    assert.ok(
      !text.toLowerCase().includes("b-roll: a single drop"),
      `stage direction "${text}" reached the screen; directions are instructions, not copy`,
    );
  }
});

test("compileFilmFromScreenplay: refuses a narration spine that does not match the screenplay", () => {
  const { segments, shotDurations } = spine([6, 8]);
  assert.throws(
    () => compileFilmFromScreenplay(SCRIPT, segments, shotDurations, { title: "Probe Film" }),
    /narration beat/,
  );
});

test("compileFilmFromScreenplay: only flags footage for beats a clip can cover end to end", () => {
  // Every beat runs longer than the clip budget, so nothing may be flagged: a clip that
  // runs out mid-shot leaves the frame black for the remainder.
  const { segments, shotDurations } = spine([20, 20, 20, 20, 20, 20]);
  const { footage } = compileFilmFromScreenplay(SCRIPT, segments, shotDurations, {
    title: "Probe Film",
    maxFootageSec: 8,
  });
  assert.equal(footage.length, 0);

  const short = spine([6, 6, 6, 6, 6, 6]);
  const result = compileFilmFromScreenplay(SCRIPT, short.segments, short.shotDurations, {
    title: "Probe Film",
    maxFootageSec: 8,
    maxFootageShots: 2,
  });
  assert.ok(result.footage.length > 0 && result.footage.length <= 2);
  for (const job of result.footage) {
    const shot = result.film.shots.find((s) => s.id === job.shotId);
    assert.ok(shot, "every footage job names a real shot");
    assert.ok(job.seconds >= (shot as { dur: number }).dur, "the clip must be at least as long as its shot");
  }
});

test("compileFilmFromScreenplay: honours maxFootageShots of zero", () => {
  const { segments, shotDurations } = spine([6, 6, 6, 6, 6, 6]);
  const { film, footage } = compileFilmFromScreenplay(SCRIPT, segments, shotDurations, {
    title: "Probe Film",
    maxFootageShots: 0,
  });
  assert.equal(footage.length, 0);
  assert.equal(film.shots.filter((s) => s.needsFootage).length, 0);
});

test("compileFilmFromScreenplay: sets the design language's accent on the film", () => {
  const { segments, shotDurations } = spine([6, 8, 9, 7, 8, 10]);
  const { film } = compileFilmFromScreenplay(SCRIPT, segments, shotDurations, { title: "Probe Film" });
  assert.equal(film.accent, "#635BFF");
  assert.equal(film.theme?.background, "smooth-dark");
});

test("compileFilmFromScreenplay: one chapter per section, and a cut opening each one", () => {
  const { segments, shotDurations } = spine([6, 8, 9, 7, 8, 10]);
  const { film } = compileFilmFromScreenplay(SCRIPT, segments, shotDurations, { title: "Probe Film" });

  assert.equal(film.chapters.length, 3);
  assert.equal(film.canvas.nodes.length, 3);
  assert.equal(
    film.shots.filter((s) => s.move === "cut").length,
    film.chapters.length,
    "the chapter rail reads its label off cut boundaries, so the counts have to agree",
  );
  assert.equal(film.shots[0].move, "cut");
});

test("compileFilmFromScreenplay: canvas nodes are tall enough for a wrapping title plus its sub-label", () => {
  const { segments, shotDurations } = spine([6, 8, 9, 7, 8, 10]);
  const { film } = compileFilmFromScreenplay(SCRIPT, segments, shotDurations, { title: "Probe Film" });
  for (const node of film.canvas.nodes) {
    assert.ok(node.h >= 110, `node "${node.id}" is ${node.h}px tall; its sub-label would clip outside the card`);
    assert.ok(node.w >= 240, `node "${node.id}" is ${node.w}px wide; its title would wrap to three lines`);
  }
});

test("buildFootagePrompt: strips the marker and bans hallucinated on-screen text", () => {
  const prompt = buildFootagePrompt("B-roll: sparks streaming off a grinding wheel in a dark workshop");
  assert.ok(!/b-roll/i.test(prompt), "the marker is an instruction to the pipeline, not to the model");
  assert.ok(prompt.startsWith("sparks streaming off"));
  assert.ok(prompt.includes("no text"), "the frame already carries typography; the plate must not");
});

test("writeFilm keeps the package manifest and its generated shadow in sync", () => {
  const slug = `probe-${Date.now().toString(36)}`;
  const { segments, shotDurations } = spine([6, 8, 9, 7, 8, 10]);
  const { film } = compileFilmFromScreenplay(SCRIPT, segments, shotDurations, { title: "Probe Film", slug });

  try {
    writeFilm(slug, film);
    const jsonPath = path.join(VIDEOS_DIR, slug, "film.json");
    const shadowPath = path.join(FILMS_DIR, `${slug}.ts`);
    assert.ok(fs.existsSync(jsonPath), "the authoritative manifest must be written");
    assert.ok(fs.existsSync(shadowPath), "the generated shadow must be written alongside it");

    const shadow = fs.readFileSync(shadowPath, "utf8");
    assert.ok(shadow.startsWith('import type { Film } from "../schema";'));
    const shadowFilm = JSON.parse(shadow.match(/=\s*(\{[\s\S]*\})\s*;/)?.[1] ?? "null");
    assert.deepEqual(shadowFilm, JSON.parse(fs.readFileSync(jsonPath, "utf8")));

    const wired = wireFootageIntoFilm(slug, film.shots[0].id, `videos/${slug}/footage/x.mp4`, "a caption");
    const inset = wired.shots[0].blocks.find((b) => b.c === "AnalogyInset");
    assert.ok(inset && "src" in inset && inset.src === `videos/${slug}/footage/x.mp4`);
    assert.equal(wired.shots[0].needsFootage, true);

    // Wiring twice must update the inset rather than stack a second one on the shot.
    const again = wireFootageIntoFilm(slug, film.shots[0].id, `videos/${slug}/footage/y.mp4`, "a caption");
    assert.equal(again.shots[0].blocks.filter((b) => b.c === "AnalogyInset").length, 1);
    assert.deepEqual(readFilm(slug), again);
  } finally {
    fs.rmSync(path.join(VIDEOS_DIR, slug), { recursive: true, force: true });
    fs.rmSync(path.join(FILMS_DIR, `${slug}.ts`), { force: true });
  }
});

test("slugify produces ids the film schema accepts", () => {
  assert.equal(slugify("Speculative Decoding"), "speculative-decoding");
  assert.equal(slugify("  Memory, Not Math!  "), "memory-not-math");
  assert.equal(slugify("***"), "film");
  assert.ok(/^[a-z0-9-]+$/.test(slugify("A Very Long Title That Runs Past The Slug Length Limit For Sure")));
});

test("packageDir refuses a slug that could escape the videos directory", async () => {
  const { packageDir } = await import("./filmStore");
  assert.throws(() => packageDir("../etc"), /invalid film id/);
  assert.throws(() => packageDir("Not A Slug"), /invalid film id/);
  assert.ok(packageDir("fine-slug").startsWith(VIDEOS_DIR));
  assert.ok(os.tmpdir().length > 0);
});
