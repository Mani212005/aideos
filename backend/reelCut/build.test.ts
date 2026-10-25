/**
 * File Description: Approved plan section 7 coverage for reel compilation, delivery, caps and pipeline resume.
 * Inputs and outputs: isolated fixture packages, measured narration stubs and injected writers -> derived reels and production outcomes.
 * Used by: npm test.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import { loadFixtureFilm } from "../testSupport/fixtureFilms";
import { parseFilm, type Film } from "../../src/dl/schema";
import { clampCaptionPlacement } from "../../src/dl/captionPlacement";
import { deliveryTimeline } from "../../src/dl/delivery";
import { buildCaptionsVtt, splitScriptIntoSegments, type ProduceAudioResult } from "../audio";
import { designSpecSchema } from "../designSpec/spec";
import { createCues } from "../sceneKit/timing";
import { narrationTimingForFilm } from "../designSpec/compile";
import { resolveCue } from "../designSpec/cues";
import { createReelContext } from "./constraints";
import type { ReelCut } from "./schema";
import { buildReel, compileReel } from "./build";
import { deliverReel } from "./writer";
import { assertReelCap, reelForRender, reelSourceFingerprint } from "./store";
import { ProductionError } from "../pipeline/types";
import { runProduction } from "../pipeline/run";
import { setMockShotVisualHandler, clearMockShotVisualHandler } from "../jev";

// Makes a narration spine with exact shot boundaries and words for the actual cue matcher.
function narration(texts: string[], durations: number[], dir = ""): ProduceAudioResult {
  let cursor = 0;
  const segments = texts.map((text, index) => {
    const startOffset = cursor, duration = durations[index];
    const tokens = text.split(/\s+/);
    const words = tokens.map((word, k) => ({ word, punctuated_word: word, start: k * duration / tokens.length, end: (k + 1) * duration / tokens.length }));
    cursor += duration;
    return { text, duration, startOffset, words, utterances: [] };
  });
  const words = segments.flatMap((s) => s.words.map((w) => ({ ...w, start: s.startOffset + w.start, end: s.startOffset + w.end })));
  return { segments, words, shotDurations: durations, totalAudioDuration: cursor,
    captionsVttContent: buildCaptionsVtt(words), ttsBackend: "kokoro:af_heart", voice: "af_heart", speed: 0.75,
    voiceoverPath: path.join(dir, "voiceover.wav"), wordsPath: path.join(dir, "voiceover_words.json"), captionsPath: path.join(dir, "captions.vtt") };
}

// Builds a small legacy node-graph package with a measured long narration and no external media.
function packageFilm(slug: string, duration = 210): Film {
  const base = parseFilm(loadFixtureFilm("fixture-canvas-a"));
  const film: Film = { ...base, id: slug, scene: undefined,
    voiceover: { src: `videos/${slug}/voiceover.wav`, volume: 1, durationSec: duration },
    shots: ["intro", "middle", "outro"].map((id, index) => ({ ...base.shots[0], id, dur: duration / 3,
      look: "all", stage: index === 1 ? "none" : "frame", blocks: [{ c: "TextReveal", text: "Paper moves.", size: "headline" }], scriptText: "Paper moves and stays in your hands." })) };
  const dir = path.join(TEST_VIDEOS_DIR, slug);
  fs.mkdirSync(path.join(dir, "reel"), { recursive: true });
  fs.writeFileSync(path.join(dir, "film.json"), JSON.stringify(film));
  fs.writeFileSync(path.join(dir, "narration.json"), JSON.stringify({ ttsBackend: "kokoro:af_heart", voice: "af_heart", speed: 0.75 }));
  return film;
}

// Creates a checked condensed cut from the authoritative source hashes.
function cutFor(film: Film): ReelCut {
  const context = createReelContext({ film });
  return { schema: "aideos.reelcut/1", source: "agent", long: { shots: Object.fromEntries(context.shots.map((s) => [s.id, s.hash])) },
    shots: context.shots.map((s) => ({ id: s.id, narration: "Paper moves and stays." })) };
}

test("reel compile: cues and end resolve to reel timing, owner captions and footage copy from the long", () => {
  const pkg = path.join(TEST_VIDEOS_DIR, "speculative-decoding-designed");
  const long = parseFilm(JSON.parse(fs.readFileSync(path.join(pkg, "film.json"), "utf8")));
  const base = parseFilm(JSON.parse(fs.readFileSync(path.join(pkg, "design/base-film.json"), "utf8")));
  const spec = designSpecSchema.parse(JSON.parse(fs.readFileSync(path.join(pkg, "design/design.json"), "utf8")));
  const context = createReelContext({ film: long, design: spec });
  const cut: ReelCut = { schema: "aideos.reelcut/1", source: "owner", long: { shots: Object.fromEntries(context.shots.map((s) => [s.id, s.hash])) },
    shots: context.shots.map((s) => ({ id: s.id, narration: s.narration })) };
  long.captionPlacement = { reel: clampCaptionPlacement({ x: 0.5, y: 0.08, locked: true }, "reel") };
  long.shots[0].captionPlacement = { reel: clampCaptionPlacement({ x: 0.5, y: 0.12, locked: true }, "reel") };
  long.shots[0].blocks.push({ c: "AnalogyInset", caption: "Paper", src: "videos/shared/footage.mp4", fullScreenHero: true });
  const originalWords = JSON.parse(fs.readFileSync(path.join(pkg, "voiceover_words.json"), "utf8")).words;
  const audio = narration(long.shots.map((s) => s.scriptText ?? ""), long.shots.map((s) => s.dur * 0.98));
  audio.words = originalWords.map((w: { word: string; start: number; end: number }) => ({ ...w, start: w.start * 0.98, end: w.end * 0.98 }));
  const result = compileReel({ long, base, cut, narration: audio, spec, pkg });
  assert.ok(result.film, JSON.stringify(result));
  assert.deepEqual(result.film.captionPlacement, long.captionPlacement);
  assert.deepEqual(result.film.shots[0].captionPlacement, long.shots[0].captionPlacement);
  assert.ok(result.film.shots[0].blocks.some((b) => b.c === "AnalogyInset" && b.src === "videos/shared/footage.mp4"));
  assert.equal(result.film.scene?.durationFrames, Math.round(audio.totalAudioDuration * long.fps));
  const cues = createCues(narrationTimingForFilm(result.film, audio.words), long.fps);
  assert.equal(resolveCue("end", cues), result.film.scene?.durationFrames);
  const clip = spec.clips.find((c) => typeof c.start === "string" && c.start.includes(':"'))!;
  const compiledClip = result.film.scene?.props.flatMap((a) => a.animation?.clips ?? []).find((c) => c.clipId === clip.id);
  assert.equal(compiledClip?.startFrame, resolveCue(clip.start, cues));
  assert.equal(result.film.voiceover?.src, `videos/${long.id}/reel/voiceover.wav`);
});

test("captain decision 2026-10-22: explicit checked drops remove node-graph shots without losing long caption ownership", () => {
  const long = packageFilm("reel-node-drop");
  long.shots[1].captionPlacement = { reel: { x: 0.5, y: 0.7, locked: true } };
  const cut = cutFor(long);
  cut.shots[1] = { id: "middle", drop: true, reason: "restates the opening" };
  const result = compileReel({ long, base: long, cut, narration: narration(["Paper moves.", "Paper moves."], [35, 35]), pkg: path.join(TEST_VIDEOS_DIR, long.id) });
  assert.ok(result.film, JSON.stringify(result));
  assert.deepEqual(result.film.shots.map((s) => s.id), ["intro", "outro"]);
  assert.ok(long.shots[1].captionPlacement?.reel?.locked);
});

test("captain decision 2026-10-22: a dropped shot's visible scene motion is rejected with the shot and element named", () => {
  const pkg = path.join(TEST_VIDEOS_DIR, "speculative-decoding-designed");
  const long = parseFilm(JSON.parse(fs.readFileSync(path.join(pkg, "film.json"), "utf8")));
  const base = parseFilm(JSON.parse(fs.readFileSync(path.join(pkg, "design/base-film.json"), "utf8")));
  const spec = designSpecSchema.parse(JSON.parse(fs.readFileSync(path.join(pkg, "design/design.json"), "utf8")));
  // Use a single visible change to isolate the approved dropped-shot snap rule.
  spec.camera = [{ at: "beat-01", center: [960, 960], zoom: 1 }, { at: "end", center: [960, 960], zoom: 1 }];
  spec.clips = [{ id: "dropped-move", asset: "memory", targets: ["memory"], property: "translateX", from: 0, to: 40, start: "beat-02", end: "beat-02@end" }];
  const context = createReelContext({ film: long });
  const cut: ReelCut = { ...cutFor(long), shots: context.shots.map((s) => s.id === "beat-02" ? { id: s.id, drop: true, reason: "restates the hook" } : { id: s.id, narration: s.narration }) };
  const kept = long.shots.filter((s) => s.id !== "beat-02");
  const result = compileReel({ long, base, cut, narration: narration(kept.map((s) => s.scriptText ?? ""), kept.map((s) => s.dur)), spec, pkg });
  assert.equal(result.film, undefined);
  assert.ok(result.findings.some((f) => f.rule === "continuity" && /beat-02.*memory/.test(f.where) && /visible snap/.test(f.message)), JSON.stringify(result));
});

test("captain decision 2026-10-22: identity reel reuses the long narration when story plus reel card fits", async () => {
  const long = packageFilm("reel-identity", 100);
  const result = await deliverReel(long.id, { synthesize: async () => { throw new Error("identity must reuse narration"); } });
  assert.equal(result.status, "passed");
  if (result.status !== "passed") return;
  assert.equal(result.film.voiceover?.src, long.voiceover?.src);
  assert.equal(deliveryTimeline(result.film, "reel").totalFrames / long.fps, 103);
  const status = JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, long.id, "reel/status.json"), "utf8"));
  assert.equal(status.mode, "identity");
});

test("captain decision 2026-10-22: measured over-cap reels fail with exact overage and longest shots, and inline returns needs_reel_cut", async () => {
  const long = packageFilm("reel-measured-cap");
  fs.writeFileSync(path.join(TEST_VIDEOS_DIR, long.id, "reel/cut.json"), JSON.stringify(cutFor(long)));
  const synthesize = async (script: string, dir: string) => narration(splitScriptIntoSegments(script), [60, 60, 60], dir);
  await assert.rejects(buildReel(long.id, { synthesize }), (error: unknown) => error instanceof ProductionError && error.stage === "reel" && /183\.000 s.*story 180\.000 s.*end card 3\.000 s.*4\.000 s over.*179\.0 s cap.*intro \(60\.0 s\)/.test(error.message));
  const result = await deliverReel(long.id, { synthesize });
  assert.equal(result.status, "needs_reel_cut");
  if (result.status === "needs_reel_cut") assert.match(result.note, /4\.000 s over/);
  assert.throws(() => assertReelCap(long, "render"), /\[render\].*over the 179.0 s cap/);
  assert.throws(() => reelForRender(long.id), /needs reel cut/);
});

test("reel delivery: server validates and retries measured cap failures using the long's own voice and speed", async () => {
  const long = packageFilm("reel-server-retry");
  const prompts: string[] = [];
  let syntheses = 0;
  const outcome = await deliverReel(long.id, { mode: "server", llmCaller: async (prompt) => {
    prompts.push(prompt);
    return JSON.stringify(cutFor(long));
  }, synthesize: async (script, dir, options) => {
    assert.equal(options.backend, "kokoro");
    assert.equal(options.voice, "af_heart");
    assert.equal(options.speed, 0.75);
    syntheses++;
    return narration(splitScriptIntoSegments(script), syntheses === 1 ? [60, 60, 60] : [40, 40, 40], dir);
  } });
  assert.equal(outcome.status, "passed", JSON.stringify(outcome));
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /4\.000 s over the 179\.0 s cap/);
  const hash = reelSourceFingerprint(long.id);
  fs.writeFileSync(path.join(TEST_VIDEOS_DIR, long.id, "film.json"), JSON.stringify({ ...long, title: "Changed long" }));
  assert.notEqual(reelSourceFingerprint(long.id), hash);
  assert.throws(() => reelForRender(long.id), /stale/);
});

test("runProduction reel stage: inline stop resumes with an injected writer and invalidates after a long change", async (t) => {
  setMockShotVisualHandler(() => ({ choice: "Text", confidence: 1, probabilities: {} }));
  t.after(clearMockShotVisualHandler);
  const slug = "reel-pipeline-resume";
  const text = "Paper moves and stays in your hands. ".repeat(13);
  const script = `# Reel pipeline\n## Paper\n${`[ON SCREEN]\nPaper moves.\n[NARRATION]\n${text}\n`.repeat(6)}`;
  const request = { script, slug, title: "Reel pipeline", ttsBackend: "tone" as const, design: "templates" as const,
    stopAfter: "reel" as const, skipAgent: true, deviceCaller: null };
  const first = await runProduction(request);
  assert.equal(first.status, "needs_reel_cut", JSON.stringify(first));
  const long = parseFilm(JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, slug, "film.json"), "utf8")));
  const resumed = await runProduction({ ...request, reel: "server", reelLlmCaller: async () => JSON.stringify(cutFor(long)),
    reelSynthesizer: async (s, dir) => { const texts = splitScriptIntoSegments(s); return narration(texts, texts.map(() => 20), dir); } });
  assert.equal(resumed.stoppedAfter, "reel", JSON.stringify(resumed));
  assert.equal(resumed.stages.find((s) => s.stage === "reel")?.status, "done");
  const changed = { ...long, title: "Changed title" };
  fs.writeFileSync(path.join(TEST_VIDEOS_DIR, slug, "film.json"), JSON.stringify(changed));
  const events: string[] = [];
  await runProduction({ ...request, reel: "server", reelLlmCaller: async () => JSON.stringify(cutFor(changed)),
    reelSynthesizer: async (s, dir) => { const texts = splitScriptIntoSegments(s); return narration(texts, texts.map(() => 20), dir); } }, (e) => { if (e.stage === "reel") events.push(e.status); });
  assert.ok(events.includes("running"));
});
