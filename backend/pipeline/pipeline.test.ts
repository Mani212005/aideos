/**
 * File Description: Tests for the production pipeline's pure stages - screenplay flattening,
 * footage-request selection, and the design compiler that turns a screenplay plus a measured
 * narration spine into a validated film. Each test pins a defect the pipeline has to keep out of
 * the finished video: stage directions leaking on screen, B-roll landing on a shot longer than the
 * clip that covers it, shot durations drifting away from the narration, and runsheet violations
 * that would fail validation only after a render had already been paid for.
 * Inputs and outputs: screenplay and timing fixtures -> compilation pipeline test assertions.
 * Used by: npm test.
 */

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { parseClaudeScript } from "../scriptIntake";
import { compileFilmFromScreenplayAsync, flattenScreenplay } from "./design";
import { buildFootagePrompt, runProduction } from "./run";
import {
  slugify,
  writeFilm,
  readFilm,
  wireFootageIntoFilm,
  readActiveFilmSource,
  restoreActiveFilmSource,
  VIDEOS_DIR,
  FILMS_DIR,
} from "./filmStore";
import { buildTimeline, totalFrames } from "../../src/dl/camera";
import type { SegmentAudioInfo } from "../audio";
import { clearMockShotVisualHandler, heuristicShotVisualSelection, setMockShotVisualHandler } from "../jev";
import type { LookPlan } from "../lookPlan/schema";
import { buildDesign, readCheckedLookPlan } from "../designSpec/build";
import { generationCaller } from "../aideosConfig";
import { spawnSync } from "node:child_process";
import type { ProductionProgress, ProductionRequest } from "./types";

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

// Every design-stage call in this file, including the ones runProduction makes, gets the
// deterministic heuristic instead of a live Jev request, whatever keys the environment holds.
before(() => {
  setMockShotVisualHandler((state) => ({ choice: heuristicShotVisualSelection(state), confidence: 1, probabilities: {} }));
});
after(() => clearMockShotVisualHandler());

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

test("compileFilmFromScreenplayAsync: shot durations reproduce the narration spine exactly", async () => {
  const { segments, shotDurations } = spine([6, 8, 9, 7, 8, 10]);
  const { film } = await compileFilmFromScreenplayAsync(SCRIPT, segments, shotDurations, { title: "Probe Film" });

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

test("compileFilmFromScreenplayAsync: narration goes to scriptText and visual direction never becomes on-screen copy", async () => {
  const { segments, shotDurations } = spine([6, 8, 9, 7, 8, 10]);
  const { film } = await compileFilmFromScreenplayAsync(SCRIPT, segments, shotDurations, { title: "Probe Film" });
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

test("compileFilmFromScreenplayAsync: refuses a narration spine that does not match the screenplay", async () => {
  const { segments, shotDurations } = spine([6, 8]);
  await assert.rejects(
    () => compileFilmFromScreenplayAsync(SCRIPT, segments, shotDurations, { title: "Probe Film" }),
    /narration beat/,
  );
});

test("compileFilmFromScreenplayAsync: only flags footage for beats a clip can cover end to end", async () => {
  // Every beat runs longer than the clip budget, so nothing may be flagged: a clip that
  // runs out mid-shot leaves the frame black for the remainder.
  const { segments, shotDurations } = spine([20, 20, 20, 20, 20, 20]);
  const { footage } = await compileFilmFromScreenplayAsync(SCRIPT, segments, shotDurations, {
    title: "Probe Film",
    maxFootageSec: 8,
  });
  assert.equal(footage.length, 0);

  const short = spine([6, 6, 6, 6, 6, 6]);
  const result = await compileFilmFromScreenplayAsync(SCRIPT, short.segments, short.shotDurations, {
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

test("compileFilmFromScreenplayAsync: honours maxFootageShots of zero", async () => {
  const { segments, shotDurations } = spine([6, 6, 6, 6, 6, 6]);
  const { film, footage } = await compileFilmFromScreenplayAsync(SCRIPT, segments, shotDurations, {
    title: "Probe Film",
    maxFootageShots: 0,
  });
  assert.equal(footage.length, 0);
  assert.equal(film.shots.filter((s) => s.needsFootage).length, 0);
});

test("compileFilmFromScreenplayAsync: sets the design language's accent on the film", async () => {
  const { segments, shotDurations } = spine([6, 8, 9, 7, 8, 10]);
  const { film } = await compileFilmFromScreenplayAsync(SCRIPT, segments, shotDurations, { title: "Probe Film" });
  assert.equal(film.accent, "#635BFF");
  assert.equal(film.theme?.background, "smooth-dark");
});

test("compileFilmFromScreenplayAsync: one chapter per section, and a cut opening each one", async () => {
  const { segments, shotDurations } = spine([6, 8, 9, 7, 8, 10]);
  const { film } = await compileFilmFromScreenplayAsync(SCRIPT, segments, shotDurations, { title: "Probe Film" });

  assert.equal(film.chapters.length, 3);
  assert.equal(film.canvas.nodes.length, 3);
  assert.equal(
    film.shots.filter((s) => s.move === "cut").length,
    film.chapters.length,
    "the chapter rail reads its label off cut boundaries, so the counts have to agree",
  );
  assert.equal(film.shots[0].move, "cut");
});

test("compileFilmFromScreenplayAsync: canvas nodes are tall enough for a wrapping title plus its sub-label", async () => {
  const { segments, shotDurations } = spine([6, 8, 9, 7, 8, 10]);
  const { film } = await compileFilmFromScreenplayAsync(SCRIPT, segments, shotDurations, { title: "Probe Film" });
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

test("writeFilm keeps the package manifest and its generated shadow in sync", async () => {
  const slug = `probe-${Date.now().toString(36)}`;
  const { segments, shotDurations } = spine([6, 8, 9, 7, 8, 10]);
  const { film } = await compileFilmFromScreenplayAsync(SCRIPT, segments, shotDurations, { title: "Probe Film", slug });

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

// Regression test for the defect that hung a validation run: B-roll is opt-in, and a caller
// that does not ask for it must never reach the GPU engine. The engine name here is deliberately
// one createEngine() rejects, so if the stage ever runs the test fails loudly instead of
// silently submitting jobs to a shared box and blocking on them.
test("runProduction: never touches the b-roll engine unless b-roll was asked for", async () => {
  const slug = `probe-noboll-${Date.now().toString(36)}`;
  const events: ProductionProgress[] = [];

  try {
    const result = await runProduction(
      {
        script: SCRIPT,
        title: "Probe Film",
        slug,
        ttsBackend: "tone",
        design: "templates",
        brollEngine: "engine-that-does-not-exist",
        stopAfter: "assemble",
        resume: false,
        syncToPreview: false,
      },
      (event) => events.push(event),
    );

    assert.equal(result.stoppedAfter, "assemble");
    assert.equal(result.brollClips.length, 0, "no clips may be produced when b-roll was not requested");

    const film = readFilm(slug);
    assert.ok(film, "the film must be written");
    assert.equal(
      film.shots.filter((s) => s.needsFootage).length,
      0,
      "no shot may be flagged for footage when b-roll was not requested",
    );

    const brollMessages = events.filter((e) => e.stage === "broll").map((e) => e.message);
    assert.ok(
      brollMessages.some((m) => m.includes("no footage requested")),
      `the b-roll stage must report that it had nothing to do, got: ${JSON.stringify(brollMessages)}`,
    );
  } finally {
    fs.rmSync(path.join(VIDEOS_DIR, slug), { recursive: true, force: true });
    fs.rmSync(path.join(FILMS_DIR, `${slug}.ts`), { force: true });
  }
});

// The narration timing spine is what every later stage is locked to, so a run has to produce
// a package whose audio, word timings and film all agree before anything is rendered.
test("runProduction: writes a package whose film matches the narration it synthesized", async () => {
  const slug = `probe-spine-${Date.now().toString(36)}`;

  try {
    const result = await runProduction(
      { script: SCRIPT, title: "Probe Film", slug, ttsBackend: "tone", design: "templates", broll: false, stopAfter: "design", resume: false, syncToPreview: false },
      () => undefined,
    );

    const pkgDir = path.join(VIDEOS_DIR, slug);
    for (const name of ["script.md", "voiceover.wav", "captions.vtt", "voiceover_words.json", "film.json"]) {
      assert.ok(fs.existsSync(path.join(pkgDir, name)), `${name} must be written`);
    }

    const film = readFilm(slug);
    assert.ok(film);
    assert.equal(film.shots.length, flattenScreenplay(parseClaudeScript(SCRIPT)).length);

    const shotSum = film.shots.reduce((sum, s) => sum + s.dur, 0);
    assert.ok(
      Math.abs(shotSum - result.durationSec) < 0.01,
      `film runs ${shotSum.toFixed(3)}s against ${result.durationSec.toFixed(3)}s of narration`,
    );

    const words = JSON.parse(fs.readFileSync(path.join(pkgDir, "voiceover_words.json"), "utf8")).words as Array<{
      start: number;
      end: number;
    }>;
    assert.ok(words.length > 0, "word timings must be written");
    assert.ok(
      words[words.length - 1].end <= result.durationSec + 0.01,
      "no word may be timed past the end of the audio",
    );
  } finally {
    fs.rmSync(path.join(VIDEOS_DIR, slug), { recursive: true, force: true });
    fs.rmSync(path.join(FILMS_DIR, `${slug}.ts`), { force: true });
  }
});

// A resumed run must reuse the stages whose inputs have not changed rather than redoing them.
test("runProduction: resuming reuses the stages whose inputs have not changed", async () => {
  const slug = `probe-resume-${Date.now().toString(36)}`;

  try {
    await runProduction(
      { script: SCRIPT, title: "Probe Film", slug, ttsBackend: "tone", design: "templates", broll: false, stopAfter: "design", resume: false, syncToPreview: false },
      () => undefined,
    );

    const events: ProductionProgress[] = [];
    await runProduction(
      { script: SCRIPT, title: "Probe Film", slug, ttsBackend: "tone", design: "templates", broll: false, stopAfter: "design", resume: true, syncToPreview: false },
      (event) => events.push(event),
    );

    for (const stage of ["intake", "narrate", "design"]) {
      const statuses = events.filter((e) => e.stage === stage).map((e) => e.status);
      assert.ok(statuses.includes("skipped"), `${stage} should have been reused, saw ${JSON.stringify(statuses)}`);
    }
  } finally {
    fs.rmSync(path.join(VIDEOS_DIR, slug), { recursive: true, force: true });
    fs.rmSync(path.join(FILMS_DIR, `${slug}.ts`), { force: true });
  }
});

// Regression test: a run that stops before rendering must not repoint the repository's active
// film. setActiveFilm rewrites src/dl/activeFilm.ts, which Remotion's CLI bundles, so doing it
// during assembly left the tree importing a film that a partial run never produced.
test("runProduction: a run that stops before rendering leaves the active film alone", async () => {
  const slug = `probe-active-${Date.now().toString(36)}`;
  const before = readActiveFilmSource();

  try {
    await runProduction(
      { script: SCRIPT, title: "Probe Film", slug, ttsBackend: "tone", design: "templates", broll: false, stopAfter: "assemble", resume: false, syncToPreview: false },
      () => undefined,
    );
    assert.equal(readActiveFilmSource(), before, "src/dl/activeFilm.ts must be untouched by a partial run");
  } finally {
    restoreActiveFilmSource(before);
    fs.rmSync(path.join(VIDEOS_DIR, slug), { recursive: true, force: true });
    fs.rmSync(path.join(FILMS_DIR, `${slug}.ts`), { force: true });
  }
});


// Makes a look plan for the actual synthesized beats, with one persistent cast object.
function probeLook(slug: string): LookPlan {
  const film = readFilm(slug)!;
  return {
    schema: "aideos.look/1", decidedBy: { agent: "fixture", model: "fake", at: new Date().toISOString() },
    film: {
      mode: "scene", stage: "One carrier changes position on a persistent stage.",
      cast: [{ id: "carrier", what: "a visible carrier", enters: film.shots[0].id, changes: [] }],
      camera: [
        { at: film.shots[0].id, pose: "wide establishing view", why: "establish" },
        { at: film.shots[film.shots.length - 1].id, pose: "wide payoff view", why: "payoff" },
      ],
      palette: { bg: "#0A0A0B", accent: "#635BFF", extra: {} },
      captions: { position: "bottom", kineticColumn: false }, headlines: "none",
    },
    shots: film.shots.map((shot) => ({ id: shot.id, treatment: "scene", carries: ["carrier"], cue: shot.scriptText!.split(/\s+/)[0], criterion: "1-mechanism", why: "the carried object moves" })),
  };
}

// Writes a valid fixture look and a cue-timed scene design into an isolated test package.
function writeProbeDesign(slug: string): void {
  const pkg = path.join(VIDEOS_DIR, slug);
  const look = probeLook(slug);
  fs.mkdirSync(path.join(pkg, "design"), { recursive: true });
  fs.mkdirSync(path.join(pkg, "visuals"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "design/look.json"), JSON.stringify(look));
  fs.writeFileSync(path.join(pkg, "visuals/carrier.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-300 -200 600 400" preserveAspectRatio="xMidYMid meet"><rect id="carrier" x="-60" y="-40" width="120" height="80" fill="#635BFF"/></svg>');
  fs.writeFileSync(path.join(pkg, "design/design.json"), JSON.stringify({
    brief: { concept: look.film.stage }, accent: look.film.palette.accent,
    assets: [{ id: "carrier", file: "visuals/carrier.svg", position: [960, 760], scale: 1 }],
    clips: look.shots.map((shot, i) => ({ id: `motion-${i}`, asset: "carrier", targets: ["carrier"], property: "translateX", from: i % 2 ? 20 : 0, to: i % 2 ? 0 : 20, start: shot.id, end: `${shot.id}@end`, easing: "expoOut" })),
    camera: [{ at: look.shots[0].id, center: [960, 960], zoom: 1 }, { at: "end", center: [980, 960], zoom: 1 }],
    shots: Object.fromEntries(look.shots.map((s) => [s.id, { blocks: [], stage: "none" }])),
  }));
}

// Removes only packages and generated shadows this test created.
function cleanProbe(slug: string): void {
  fs.rmSync(path.join(VIDEOS_DIR, slug), { recursive: true, force: true });
  fs.rmSync(path.join(FILMS_DIR, `${slug}.ts`), { force: true });
}

// Supplies deterministic production inputs while forbidding server and live-agent work.
function inlineRequest(slug: string): ProductionRequest {
  return { script: SCRIPT, title: "Probe Film", slug, ttsBackend: "tone", brollEngine: "null", broll: false,
    skipAgent: true, deviceCaller: null, designLlmCaller: async () => { throw new Error("inline must never call the server"); },
    syncToPreview: false, stopAfter: "assemble" };
}

test("runProduction: default needs_look has exact next steps and resumes an externally built agent design", async () => {
  const slug = `probe-look-${Date.now().toString(36)}`;
  try {
    const request = inlineRequest(slug);
    const first = await runProduction(request);
    assert.equal(first.status, "needs_look");
    assert.equal(first.outputs.length, 0);
    assert.deepEqual(first.nextSteps, [
      `Read ${path.join(first.packageDir, "design/LOOK_BRIEF.md")}`,
      `Write ${path.join(first.packageDir, "design/look.json")}`,
      `Run aideos look check ${slug}`, "Re-run the same command to continue.",
    ]);
    assert.equal(first.stages.find((s) => s.stage === "look")?.status, "needs_input");
    assert.equal(first.stages.some((s) => s.stage === "design"), false);
    writeProbeDesign(slug);
    const built = buildDesign(slug);
    assert.equal(built.state, "passed", JSON.stringify(built));
    const events: ProductionProgress[] = [];
    const resumed = await runProduction(request, (event) => events.push(event));
    assert.equal(resumed.status, "stopped");
    assert.equal(resumed.stoppedAfter, "assemble");
    assert.equal(readFilm(slug)?.design?.source, "agent");
    assert.ok(readFilm(slug)?.scene);
    assert.ok(events.some((e) => e.stage === "narrate" && e.status === "skipped"));
    const unchanged: ProductionProgress[] = [];
    await runProduction(request, (event) => unchanged.push(event));
    for (const stage of ["intake", "narrate", "look", "design", "broll", "assemble"]) {
      assert.ok(unchanged.some((e) => e.stage === stage && e.status === "skipped"), `${stage} should be cached`);
    }
  } finally { cleanProbe(slug); }
});

test("runProduction: valid look without a design stops at needs_design and never reports templates", async () => {
  const slug = `probe-needs-design-${Date.now().toString(36)}`;
  try {
    const request = inlineRequest(slug);
    await runProduction(request);
    fs.writeFileSync(path.join(VIDEOS_DIR, slug, "design/look.json"), JSON.stringify(probeLook(slug)));
    const result = await runProduction(request);
    assert.equal(result.status, "needs_design");
    assert.ok(result.nextSteps?.includes(`Run aideos design build ${slug}`));
    assert.notEqual(readFilm(slug)?.design?.source, "templates");
    assert.equal(result.stages.find((s) => s.stage === "design")?.status, "needs_input");
    writeProbeDesign(slug);
    const resumed = await runProduction(request);
    assert.equal(resumed.stoppedAfter, "assemble", JSON.stringify(resumed.warnings));
    assert.equal(readFilm(slug)?.design?.source, "agent");
  } finally { cleanProbe(slug); }
});

test("runProduction: look edits reopen design and assembly; invalid edits cannot reuse a completed stage", async () => {
  const slug = `probe-look-edits-${Date.now().toString(36)}`;
  try {
    const request = inlineRequest(slug);
    await runProduction(request);
    writeProbeDesign(slug);
    const first = await runProduction(request);
    const oldFingerprint = first.stages.find((s) => s.stage === "design")?.fingerprint;
    const file = path.join(VIDEOS_DIR, slug, "design/look.json");
    const look = probeLook(slug);
    look.film.stage = "The same carrier now represents a different mechanism.";
    fs.writeFileSync(file, JSON.stringify(look));
    const events: ProductionProgress[] = [];
    const changed = await runProduction(request, (e) => events.push(e));
    assert.notEqual(changed.stages.find((s) => s.stage === "design")?.fingerprint, oldFingerprint);
    for (const stage of ["design", "assemble"]) assert.ok(events.some((e) => e.stage === stage && e.status === "running"));
    fs.writeFileSync(file, "{}");
    const invalid = await runProduction(request);
    assert.equal(invalid.status, "needs_look");
    assert.equal(invalid.stages.find((s) => s.stage === "design")?.status, "pending");
    assert.equal(invalid.outputs.length, 0);
  } finally { cleanProbe(slug); }
});

test("runProduction: changed narration refreshes base-film; forced upstream work invalidates cached downstream stages", async () => {
  const slug = `probe-retime-${Date.now().toString(36)}`;
  try {
    const request = inlineRequest(slug);
    await runProduction(request);
    writeProbeDesign(slug);
    await runProduction(request);
    const script = SCRIPT.replace("Which is the lesson underneath all of it", "Which is the final lesson");
    const events: ProductionProgress[] = [];
    const result = await runProduction({ ...request, script }, (e) => events.push(e));
    assert.equal(result.stoppedAfter, "assemble", JSON.stringify(result.warnings));
    const base = JSON.parse(fs.readFileSync(path.join(VIDEOS_DIR, slug, "design/base-film.json"), "utf8"));
    assert.equal(base.shots[base.shots.length - 1].scriptText, readFilm(slug)?.shots.slice(-1)[0]?.scriptText);
    assert.match(base.shots[base.shots.length - 1].scriptText, /final lesson/);
    assert.ok(events.some((e) => e.stage === "design" && e.status === "running"));
    const forced: ProductionProgress[] = [];
    await runProduction({ ...request, script, force: ["narrate"] }, (e) => forced.push(e));
    assert.ok(forced.some((e) => e.stage === "design" && e.status === "running"));
    assert.ok(forced.some((e) => e.stage === "assemble" && e.status === "running"));
  } finally { cleanProbe(slug); }
});

test("runProduction: templates and the legacy alias explicitly keep the template path", async () => {
  for (const policy of [{ design: "templates" as const }, { bespoke: false }]) {
    const slug = `probe-templates-${Date.now().toString(36)}-${policy.design ?? "alias"}`;
    try {
      const result = await runProduction({ ...inlineRequest(slug), ...policy });
      assert.equal(result.stoppedAfter, "assemble");
      assert.equal(readFilm(slug)?.design?.source, "templates");
      assert.equal(readFilm(slug)?.scene, undefined);
      assert.equal(fs.existsSync(path.join(result.packageDir, "design/look.json")), false);
    } finally { cleanProbe(slug); }
  }
});

test("runProduction: server failures return needs input; agent mode fails instead of falling back", async () => {
  const slug = `probe-policies-${Date.now().toString(36)}`;
  try {
    const request = inlineRequest(slug);
    const result = await runProduction({ ...request, design: "server", designLlmCaller: async () => "invalid" });
    assert.equal(result.status, "needs_look");
    writeProbeDesign(slug);
    fs.rmSync(path.join(VIDEOS_DIR, slug, "design/design.json"));
    const designResult = await runProduction({ ...request, design: "server", designLlmCaller: async () => "invalid" });
    assert.equal(designResult.status, "needs_design");
    assert.notEqual(readFilm(slug)?.design?.source, "templates");
    fs.rmSync(path.join(VIDEOS_DIR, slug, "design/look.json"));
    await assert.rejects(() => runProduction({ ...request, design: "agent" }), /agent mode requires a delivered coding agent/);
  } finally { cleanProbe(slug); }
});

test("CLI: the direct executable and launcher preserve exit 3 and continuation instructions", () => {
  const root = path.resolve(__dirname, "../..");
  for (const executable of ["tsx", "launcher"]) {
    const slug = `probe-cli-${executable}-${Date.now().toString(36)}`;
    try {
      const args = ["film", "--script", SCRIPT, "--title", "Probe Film", "--slug", slug, "--tts", "tone", "--stop-after", "assemble"];
      const env = { ...process.env, NODE_TEST_CONTEXT: "child-v8" };
      const child = executable === "tsx"
        ? spawnSync(process.execPath, ["--import", "tsx", "backend/cli.ts", ...args], { cwd: root, env, encoding: "utf8" })
        : spawnSync("bash", ["bin/aideos", ...args], { cwd: root, env, encoding: "utf8" });
      assert.equal(child.status, 3, child.stdout + child.stderr);
      assert.match(child.stdout, /needs_look:/);
      assert.match(child.stdout, /LOOK_BRIEF.md/);
      assert.match(child.stdout, /Re-run the same command to continue/);
      writeProbeDesign(slug);
      fs.rmSync(path.join(VIDEOS_DIR, slug, "design/design.json"));
      const resumed = executable === "tsx"
        ? spawnSync(process.execPath, ["--import", "tsx", "backend/cli.ts", ...args], { cwd: root, env, encoding: "utf8" })
        : spawnSync("bash", ["bin/aideos", ...args], { cwd: root, env, encoding: "utf8" });
      assert.equal(resumed.status, 3, resumed.stdout + resumed.stderr);
      assert.match(resumed.stdout, /needs_design:/);
      assert.match(resumed.stdout, /design\/BRIEF.md/);
      assert.match(resumed.stdout, /Run aideos design build/);
    } finally { cleanProbe(slug); }
  }
});

test("generationCaller: server text uses the configured Claude model and propagates command failure", async () => {
  const file = path.join(VIDEOS_DIR, "generation-test-config.json");
  try {
    fs.writeFileSync(file, JSON.stringify({ videoModels: {
      generation: { agent: "claude", model: "claude-test-model" },
      reviewer: { agent: "agy", model: "gemini-review" }, forbiddenGenerationModels: [],
    } }));
    const calls: Array<{ command: string; args: string[] }> = [];
    const caller = generationCaller(file, async (command, args) => { calls.push({ command, args }); return "a reply"; });
    assert.equal(await caller("prompt", "system"), "a reply");
    assert.equal(calls[0].command, "claude");
    assert.equal(calls[0].args[calls[0].args.indexOf("--model") + 1], "claude-test-model");
    assert.equal(calls[0].args[calls[0].args.indexOf("--tools") + 1], "");
    assert.ok(calls[0].args.includes("system") && calls[0].args.includes("prompt"));
    const failing = generationCaller(file, async () => { throw new Error("CLI unavailable"); });
    await assert.rejects(() => failing("prompt", "system"), /CLI unavailable/);
    for (const generation of [{ agent: "agy", model: "gemini-test" }, { agent: "claude", model: "gemini-test" }]) {
      fs.writeFileSync(file, JSON.stringify({ videoModels: { generation, reviewer: { agent: "agy", model: "gemini-review" } } }));
      assert.throws(() => generationCaller(file), /allowed Claude generation model/);
    }
  } finally { fs.rmSync(file, { force: true }); }
});


test("Design build: the look's cast, motion, device override and camera are enforced before writing", async () => {
  const slug = `probe-plan-build-${Date.now().toString(36)}`;
  try {
    await runProduction(inlineRequest(slug));
    writeProbeDesign(slug);
    const pkg = path.join(VIDEOS_DIR, slug);
    const specFile = path.join(pkg, "design/design.json");
    const lookFile = path.join(pkg, "design/look.json");
    const originalSpec = JSON.parse(fs.readFileSync(specFile, "utf8"));
    const originalLook = JSON.parse(fs.readFileSync(lookFile, "utf8"));
    const cases = [
      { name: "missing cast", change: () => { const plan = structuredClone(originalLook); plan.film.cast.push({ id: "ghost", what: "missing object", enters: "beat-01", changes: [] }); fs.writeFileSync(lookFile, JSON.stringify(plan)); }, error: /look cast "ghost" has no asset/ },
      { name: "missing carried motion", change: () => { fs.writeFileSync(specFile, JSON.stringify({ ...originalSpec, clips: [] })); }, error: /look scene shot "beat-01" needs a changing clip/ },
      { name: "missing device override", change: () => { const plan = structuredClone(originalLook); plan.shots[0].treatment = "device"; plan.shots[0].device = "StatCounter"; fs.writeFileSync(lookFile, JSON.stringify(plan)); }, error: /look device shot "beat-01" needs a matching "StatCounter" shots override/ },
      { name: "missing camera", change: () => { const design = { ...originalSpec }; delete design.camera; fs.writeFileSync(specFile, JSON.stringify(design)); }, error: /look camera poses require camera keyframes/ },
    ];
    for (const fixture of cases) {
      fs.writeFileSync(specFile, JSON.stringify(originalSpec));
      fs.writeFileSync(lookFile, JSON.stringify(originalLook));
      const before = fs.readFileSync(path.join(pkg, "film.json"), "utf8");
      fixture.change();
      const status = buildDesign(slug);
      assert.equal(status.state, "failed", fixture.name);
      assert.match(status.errors.join("\n"), fixture.error, fixture.name);
      assert.equal(fs.readFileSync(path.join(pkg, "film.json"), "utf8"), before, "a refused design cannot replace the film");
    }
    // A carried object can also be an element of a larger stage asset.
    const design = structuredClone(originalSpec);
    design.assets[0].id = "whole-stage";
    for (const clip of design.clips) clip.asset = "whole-stage";
    fs.writeFileSync(specFile, JSON.stringify(design));
    fs.writeFileSync(lookFile, JSON.stringify(originalLook));
    const status = buildDesign(slug);
    assert.equal(status.state, "passed", JSON.stringify(status));
  } finally { cleanProbe(slug); }
});

test("runProduction: broken and missing design artifacts reopen design rather than using a cached scene", async () => {
  const slug = `probe-broken-artifacts-${Date.now().toString(36)}`;
  try {
    const request = inlineRequest(slug);
    await runProduction(request);
    writeProbeDesign(slug);
    await runProduction(request);
    const file = path.join(VIDEOS_DIR, slug, "design/design.json");
    fs.writeFileSync(file, "bad JSON");
    assert.equal((await runProduction(request)).status, "needs_design");
    writeProbeDesign(slug);
    await runProduction(request);
    fs.rmSync(path.join(VIDEOS_DIR, slug, "visuals/carrier.svg"));
    const missing = await runProduction(request);
    assert.equal(missing.status, "needs_design");
    assert.match(missing.warnings.join("\n"), /artwork .* does not exist/);
    assert.equal(missing.stages.find((s) => s.stage === "assemble")?.status, "pending");
  } finally { cleanProbe(slug); }
});

test("runProduction: server mode plans, validates, designs and completes the authoring stages with one fake caller", async () => {
  const slug = `probe-server-success-${Date.now().toString(36)}`;
  try {
    const systems: string[] = [];
    const caller = async (_prompt: string, system: string): Promise<string> => {
      systems.push(system);
      if (systems.length === 1) return JSON.stringify(probeLook(slug));
      writeProbeDesign(slug);
      const pkg = path.join(VIDEOS_DIR, slug);
      return JSON.stringify({
        design: JSON.parse(fs.readFileSync(path.join(pkg, "design/design.json"), "utf8")),
        svgs: { "visuals/carrier.svg": fs.readFileSync(path.join(pkg, "visuals/carrier.svg"), "utf8") },
      });
    };
    const result = await runProduction({ ...inlineRequest(slug), design: "server", designLlmCaller: caller });
    assert.equal(result.stoppedAfter, "assemble", JSON.stringify(result.warnings));
    assert.equal(readFilm(slug)?.design?.source, "server-model");
    assert.equal(systems.length, 2);
    assert.match(systems[0], /The 6 Look Questions/);
    assert.match(systems[1], /Accepted look plan/);
    assert.match(systems[1], /One carrier changes position/);
  } finally { cleanProbe(slug); }
});

test("Compile: a plan controls scene and card treatments without asking Jev; dishonest devices become cards with a refusal", async () => {
  const slug = `probe-treatments-${Date.now().toString(36)}`;
  try {
    await runProduction(inlineRequest(slug));
    const look = probeLook(slug);
    look.shots[1].treatment = "scene+card";
    look.shots[3].treatment = "device";
    look.shots[3].device = "StatCounter";
    const narration = JSON.parse(fs.readFileSync(path.join(VIDEOS_DIR, slug, "narration.json"), "utf8"));
    const compiled = await compileFilmFromScreenplayAsync(SCRIPT, narration.segments, narration.shotDurations, { title: "Probe Film", slug, lookPlan: look, deviceCaller: null });
    assert.equal(compiled.shotVisuals.size, 1, "scene and card beats do not make visual-choice requests");
    assert.equal(compiled.film.shots[0].stage, "none");
    assert.equal(compiled.film.shots[0].blocks.length, 0);
    assert.equal(compiled.film.shots[1].stage, "frame");
    assert.equal(compiled.film.shots[1].blocks[0].c, "TextReveal");
    assert.equal(compiled.film.shots[3].stage, "none", "a refused device with no card copy leaves the scene visible");
    assert.equal(compiled.deviceReports.get("beat-04")?.state, "refused");
    assert.match(compiled.deviceReports.get("beat-04")?.reason ?? "", /using scene\+card/);
  } finally { cleanProbe(slug); }
});

test("runProduction: lost narration artifacts and legacy state without a look stage resume safely", async () => {
  const slug = `probe-resume-artifacts-${Date.now().toString(36)}`;
  try {
    const request = inlineRequest(slug);
    await runProduction(request);
    writeProbeDesign(slug);
    await runProduction(request);
    const pkg = path.join(VIDEOS_DIR, slug);
    fs.rmSync(path.join(pkg, "voiceover_words.json"));
    const events: ProductionProgress[] = [];
    const restored = await runProduction(request, (e) => events.push(e));
    assert.equal(restored.stoppedAfter, "assemble", JSON.stringify(restored.warnings));
    assert.ok(events.some((e) => e.stage === "narrate" && e.status === "running"));
    assert.ok(fs.existsSync(path.join(pkg, "voiceover_words.json")));
    const file = path.join(pkg, "run-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    state.stages = state.stages.filter((s: { stage: string }) => s.stage !== "look");
    state.brollClips = [{ shotId: "beat-01", path: path.join(pkg, "script.md"), staticPath: "obsolete-footage", durationSec: 60 }];
    fs.writeFileSync(file, JSON.stringify(state));
    const legacy = await runProduction(request);
    assert.equal(legacy.stoppedAfter, "assemble", JSON.stringify(legacy.warnings));
    assert.equal(legacy.stages.find((s) => s.stage === "look")?.status, "done");
    assert.deepEqual(legacy.brollClips, [], "a scene resume cannot revive obsolete template footage");
    assert.equal(readFilm(slug)?.design?.source, "agent");
  } finally { cleanProbe(slug); }
});

test("runProduction: valid SVG edits invalidate design and assembly; corrupt status cannot claim templates", async () => {
  const slug = `probe-authored-edit-${Date.now().toString(36)}`;
  try {
    const request = inlineRequest(slug);
    await runProduction(request);
    writeProbeDesign(slug);
    const first = await runProduction(request);
    const pkg = path.join(VIDEOS_DIR, slug);
    const svg = path.join(pkg, "visuals/carrier.svg");
    fs.writeFileSync(svg, fs.readFileSync(svg, "utf8").replace('width="120"', 'width="100"'));
    fs.writeFileSync(path.join(pkg, "design/status.json"), JSON.stringify({ state: "passed", source: "templates" }));
    const events: ProductionProgress[] = [];
    const edited = await runProduction(request, (e) => events.push(e));
    assert.equal(edited.stoppedAfter, "assemble", JSON.stringify(edited.warnings));
    assert.notEqual(edited.stages.find((s) => s.stage === "design")?.fingerprint, first.stages.find((s) => s.stage === "design")?.fingerprint);
    assert.ok(events.some((e) => e.stage === "design" && e.status === "running"));
    assert.ok(events.some((e) => e.stage === "assemble" && e.status === "running"));
    assert.equal(readFilm(slug)?.design?.source, "agent");
  } finally { cleanProbe(slug); }
});

test("Look intake: every narrated shot needs a treatment and camera phrase cues use actual word timings", async () => {
  const slug = `probe-look-coverage-${Date.now().toString(36)}`;
  try {
    await runProduction(inlineRequest(slug));
    writeProbeDesign(slug);
    const plan = probeLook(slug);
    plan.shots.pop();
    const file = path.join(VIDEOS_DIR, slug, "design/look.json");
    fs.writeFileSync(file, JSON.stringify(plan));
    assert.match(readCheckedLookPlan(readFilm(slug)!).errors.join("\n"), /missing treatment for shot "beat-06"/);
    const complete = probeLook(slug);
    complete.film.camera[0].at = 'beat-01:"first thing"';
    fs.writeFileSync(file, JSON.stringify(complete));
    assert.ok(readCheckedLookPlan(readFilm(slug)!).plan);
  } finally { cleanProbe(slug); }
});

test("runProduction: an honesty-refused planned device completes as scene+card with its warning", async () => {
  const slug = `probe-refused-device-${Date.now().toString(36)}`;
  try {
    const request = inlineRequest(slug);
    await runProduction(request);
    writeProbeDesign(slug);
    const plan = probeLook(slug);
    plan.shots[3].treatment = "device";
    plan.shots[3].device = "StatCounter";
    fs.writeFileSync(path.join(VIDEOS_DIR, slug, "design/look.json"), JSON.stringify(plan));
    const result = await runProduction(request);
    assert.equal(result.stoppedAfter, "assemble", JSON.stringify(result.warnings));
    assert.ok(result.warnings.some((w) => /beat-04:.*using scene\+card/.test(w)));
    assert.equal(readFilm(slug)?.design?.source, "agent");
    assert.deepEqual(readFilm(slug)?.shots[3].blocks, []);
  } finally { cleanProbe(slug); }
});
