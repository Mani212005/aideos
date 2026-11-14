/**
 * File Description: Behavioural tests of `aideos study` on short synthetic references generated here with ffmpeg (known cuts, a known camera move, known luma and
 * saturation, a known tone track with pauses, known burned-in captions): the measured numbers within stated tolerances, the two-method agreement rule including a
 * case where the methods disagree and the metric is excluded from the seed, URL refusal, no network, and the film-package seed rules. Written at the captain's request
 * (reference follow-up, ideas 1 and 13: a measured style bible whose pixel metrics need two independent methods).
 * Inputs and outputs: generated synthetic mp4 files -> assertions on StudyBible metrics, the seed and the files a run writes.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import { matchTimes, resolveMetric, withinTolerance } from "./agreement";
import { analyzeAudio } from "./audio";
import { runStudy } from "./run";
import { buildSeed } from "./seed";
import { studyReference } from "./study";
import { measureTone } from "./tone";
import type { Metric, StudyBible } from "./types";

const hasBin = (bin: string) => spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0 || spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0;
const HAVE_FFMPEG = hasBin("ffmpeg");
const HAVE_TESSERACT = hasBin("tesseract");
const FONT = ["/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].find((f) => fs.existsSync(f));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-study-test-"));
/** No OCR in the tests that do not measure captions: it is the slowest step. */
const NO_OCR = { hasTesseract: () => false };

// Runs ffmpeg and fails the test with its message when it cannot make a fixture.
function ffmpeg(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

// Finds one metric of a bible by id, failing the test when it is missing.
function metric(bible: StudyBible, id: string): Metric {
  const found = bible.metrics.find((m) => m.id === id);
  assert.ok(found, `metric ${id} is in the bible`);
  return found;
}

// Asserts a number is within a stated absolute tolerance of the known truth.
function near(actual: number | null, expected: number, tolerance: number, what: string): void {
  assert.ok(actual !== null && Math.abs(actual - expected) <= tolerance, `${what}: measured ${actual}, known ${expected} +- ${tolerance}`);
}

const TEXTURE = path.join(TMP, "texture.png");
const PAN = path.join(TMP, "pan.mp4");
const CUTS = path.join(TMP, "cuts.mp4");
const TINY = path.join(TMP, "tiny.mp4");

before(() => {
  if (!HAVE_FFMPEG) return;
  // A smooth random texture to pan over (blurred noise, so sub-pixel motion is measurable).
  ffmpeg(["-f", "lavfi", "-i", "color=c=gray:s=1600x900:d=1", "-vf", "geq=lum='random(1)*255':cb=128:cr=128,gblur=sigma=5", "-frames:v", "1", TEXTURE]);
  // 7 s at 30 fps: still 2 s, a pan of exactly 1 px per frame (30 px/s on a 480 px wide frame, 0.0625 frame widths/s) for 3 s, still 2 s.
  // Tone track: sound 0.5 to 1.5 s, 2.0 to 3.5 s and 4.5 to 6.5 s, so pauses of 0.5 s and 1.0 s and a first sound at 0.5 s.
  ffmpeg([
    "-loop", "1", "-framerate", "30", "-i", TEXTURE,
    "-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*220*t)*(between(t,0.5,1.5)+between(t,2,3.5)+between(t,4.5,6.5))':s=16000:d=7",
    "-t", "7", "-vf", "crop=480:270:'200+30*clip(t-2,0,3)':200,eq=contrast=2.2",
    "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", PAN,
  ]);
  // 3 s with a pan from 1 s on: the smallest reference, for the tests of the run and the files it writes.
  ffmpeg(["-loop", "1", "-framerate", "30", "-i", TEXTURE, "-f", "lavfi", "-i", "sine=frequency=220:duration=3", "-t", "3", "-vf", "crop=480:270:'200+30*clip(t-1,0,2)':200,eq=contrast=2.2", "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", TINY]);
  // 7.5 s of three different shots of 2.5 s: hard cuts at exactly 2.5 s and 5.0 s.
  ffmpeg([
    "-loop", "1", "-framerate", "30", "-i", TEXTURE, "-t", "7.5",
    "-filter_complex",
    "[0:v]crop=480:270:0:0,eq=brightness=-0.25,trim=duration=2.5,setpts=PTS-STARTPTS[a];[0:v]crop=480:270:800:300,eq=brightness=0.25:contrast=1.5,trim=duration=2.5,setpts=PTS-STARTPTS[b];[0:v]crop=480:270:300:500,eq=contrast=2,trim=duration=2.5,setpts=PTS-STARTPTS[c];[a][b][c]concat=n=3:v=1:a=0",
    "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", CUTS,
  ]);
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test("agreement rule: readings inside the stated tolerance agree, outside it the metric is unresolved with both numbers and excluded from the seed", () => {
  assert.equal(withinTolerance(10, 10.4, { abs: 0.5 }), true);
  assert.equal(withinTolerance(10, 11, { abs: 0.5 }), false);
  assert.equal(withinTolerance(100, 125, { rel: 0.25 }), true, "relative tolerance is a share of the larger reading");
  const agreed = resolveMetric({ id: "x", label: "x", unit: "s", a: { method: "A", value: 1 }, b: { method: "B", value: 1.02 }, tolerance: { abs: 0.05 } });
  assert.equal(agreed.status, "agreed");
  assert.equal(agreed.seedEligible, true);
  assert.equal(agreed.value, 1);
  const disagreed = resolveMetric({ id: "x", label: "x", unit: "s", a: { method: "A", value: 1 }, b: { method: "B", value: 2 }, tolerance: { abs: 0.05 } });
  assert.equal(disagreed.status, "unresolved");
  assert.equal(disagreed.seedEligible, false);
  assert.equal(disagreed.value, null);
  assert.deepEqual(disagreed.methods.map((m) => m.value), [1, 2], "both readings are kept");
  assert.match(disagreed.reason ?? "", /disagree/);
  const missing = resolveMetric({ id: "x", label: "x", unit: "s", a: { method: "A", value: 1 }, b: { method: "B", value: null, note: "no tesseract" }, tolerance: { abs: 0.05 } });
  assert.equal(missing.status, "unresolved", "a metric one method could not read is not agreed");
  const match = matchTimes([1, 5], [1.05, 9], 0.1);
  assert.deepEqual(match.matched, [{ a: 1, b: 1.05 }]);
  assert.deepEqual([match.onlyA, match.onlyB], [[5], [9]]);
});

test("study refuses a URL, a missing file and never touches the network", { skip: !HAVE_FFMPEG }, async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("the network was used"); }) as typeof fetch;
  try {
    await assert.rejects(studyReference("https://example.com/video.mp4"), /URL.*local files only.*never downloads/);
    await assert.rejects(studyReference("www.youtube.com/watch?v=abc"), /URL/);
    await assert.rejects(studyReference(path.join(TMP, "absent.mp4")), /no video file/);
    await assert.rejects(runStudy({ references: ["https://example.com/a.mp4"], outRoot: path.join(TMP, "out-url") }), /URL/);
    assert.equal(fs.existsSync(path.join(TMP, "out-url")), false, "a refused run writes nothing");
    // A real study runs with the network call trapped: nothing in the study path may fetch.
    const bible = await studyReference(TINY, { deps: NO_OCR });
    assert.equal(bible.proposal, true);
  } finally {
    globalThis.fetch = realFetch;
  }
  const cli = spawnSync("npx", ["tsx", "backend/cli.ts", "study", "https://example.com/video.mp4"], { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" });
  assert.equal(cli.status, 2, "the CLI exits 2 when a study cannot run");
  assert.match(cli.stderr, /URL/);
});

test("camera: a 1 px per frame pan for 3 of 7 seconds is measured by both methods within tolerance of the known truth", { skip: !HAVE_FFMPEG }, async () => {
  const bible = await studyReference(PAN, { deps: NO_OCR });
  // Known truth: 3 s of 7 moving (90 of about 209 frame pairs), 1 px per frame at 480 px = 0.0625 frame widths per second, one move of 90 frames.
  const share = metric(bible, "camera.movingShare");
  const speed = metric(bible, "camera.medianSpeedWidthsPerSec");
  const frames = metric(bible, "camera.framesPerMove");
  for (const m of [share, speed, frames, metric(bible, "camera.moveCount")]) assert.equal(m.status, "agreed", `${m.id}: ${m.reason ?? ""}`);
  near(share.value, 90 / 209, 0.03, "moving share");
  near(speed.value, 0.0625, 0.006, "median speed in frame widths per second");
  near(frames.value, 90, 4, "frames per move");
  assert.equal(metric(bible, "camera.moveCount").value, 1);
  for (const reading of [...share.methods, ...speed.methods]) assert.notEqual(reading.value, null, "both methods read it");
  assert.equal(share.methods.length, 2);
  assert.notEqual(share.methods[0].method, share.methods[1].method, "the two methods are different methods");
  assert.equal(bible.series.moves.length, 1);
  assert.equal(bible.media.aspect, "16:9");
  assert.equal(bible.media.width, 480);
  near(metric(bible, "media.durationSec").value, 7, 0.1, "duration");
});

test("cuts: hard cuts at 2.5 s and 5.0 s are found by both methods, with cut cadence and shot lengths", { skip: !HAVE_FFMPEG }, async () => {
  const bible = await studyReference(CUTS, { deps: NO_OCR });
  const count = metric(bible, "cuts.count");
  assert.equal(count.status, "agreed", count.reason ?? "");
  assert.equal(count.value, 2);
  assert.deepEqual(bible.series.cuts.map((c) => c.agreed), [true, true]);
  near(bible.series.cuts[0].t, 2.5, 0.1, "first cut time");
  near(bible.series.cuts[1].t, 5, 0.1, "second cut time");
  near(metric(bible, "cuts.perMinute").value, 16, 0.5, "cuts per minute");
  near(metric(bible, "shots.medianLengthSec").value, 2.5, 0.1, "median shot length");
  assert.match(count.methods[0].method, /scene score above 0\.3/, "the threshold is stated");
  assert.equal(count.methods[0].value, 2);
  assert.equal(count.methods[1].value, 2);
  // The cut is not read as camera motion: no moves in a clip of static shots.
  assert.equal(metric(bible, "camera.moveCount").value, 0);
});

test("tone: a gray frame and a gradient of known luma, and a saturated frame of known colour, are measured by both methods", { skip: !HAVE_FFMPEG }, async () => {
  const gray = path.join(TMP, "gray.mp4");
  const red = path.join(TMP, "red.mp4");
  const grad = path.join(TMP, "grad.mp4");
  ffmpeg(["-f", "lavfi", "-i", "color=c=0x606060:s=480x270:r=30:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", gray]);
  ffmpeg(["-f", "lavfi", "-i", "color=c=0xc03030:s=480x270:r=30:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", red]);
  // Luma codes 40 to 200 across the width: mean (120 - 16) / 219 = 0.475, 10th percentile 0.183, 90th 0.767, contrast 0.584.
  ffmpeg(["-f", "lavfi", "-i", "color=c=black:s=480x270:r=30:d=3,geq=lum='40+160*X/W':cb=128:cr=128", "-c:v", "libx264", "-pix_fmt", "yuv420p", grad]);
  const toneBible = async (file: string) => ({ metrics: await measureTone(file, 480, 270) }) as StudyBible;
  const g = await toneBible(gray);
  const r = await toneBible(red);
  const d = await toneBible(grad);
  for (const bible of [g, r, d]) for (const id of ["tone.meanLuma", "tone.blackPoint", "tone.contrast", "tone.saturation"]) assert.equal(metric(bible, id).status, "agreed", `${id}: ${metric(bible, id).reason ?? ""}`);
  near(metric(g, "tone.meanLuma").value, 0x60 / 255, 0.02, "gray 0x60 luma (96 of 255 on the limited range)");
  near(metric(g, "tone.saturation").value, 0, 0.02, "gray saturation");
  assert.ok((metric(r, "tone.saturation").value ?? 0) > 0.3, "a saturated red measures far above gray");
  near(metric(d, "tone.meanLuma").value, 0.475, 0.03, "gradient mean luma");
  near(metric(d, "tone.blackPoint").value, 0.183, 0.03, "gradient black point");
  near(metric(d, "tone.contrast").value, 0.584, 0.06, "gradient contrast");
});

test("audio: first sound, pause map and pace come from the tone track; wpm only from supplied word timings", { skip: !HAVE_FFMPEG }, async () => {
  const bible = await studyReference(PAN, { deps: NO_OCR });
  near(metric(bible, "audio.firstSpeechSec").value, 0.5, 0.1, "first sound");
  assert.equal(metric(bible, "audio.pauseCount").value, 2);
  near(metric(bible, "audio.longestPauseSec").value, 1, 0.1, "longest pause");
  near(metric(bible, "audio.pauseTotalSec").value, 1.5, 0.2, "total pause time");
  assert.equal(bible.series.pauseMap.length, 2);
  near(bible.series.pauseMap[1].start, 3.5, 0.1, "second pause starts");
  assert.equal(bible.metrics.find((m) => m.id === "audio.wpm"), undefined, "no words, no wpm");
  assert.ok(bible.notMeasured.some((n) => /words per minute/.test(n.what) && /no offline transcription/.test(n.why)), "the missing wpm is stated, not guessed");
  const words = path.join(TMP, "pan.words.json");
  fs.writeFileSync(words, JSON.stringify({ words: [{ word: "a", start: 0, end: 0.4 }, { word: "b", start: 0.5, end: 0.9 }, { word: "c", start: 1, end: 1.4 }, { word: "d", start: 1.5, end: 2 }] }));
  const timed = analyzeAudio(PAN, 7, true, words);
  const wpm = timed.metrics.find((m) => m.id === "audio.wpm");
  near(wpm?.value ?? null, 120, 0.5, "4 words over 2 s");
  assert.equal(wpm?.status, "not-pixel");
});

test("captions: burned-in captions on half of the video agree between the review OCR and the band ink test", { skip: !(HAVE_FFMPEG && HAVE_TESSERACT && FONT) }, async () => {
  const captioned = path.join(TMP, "captioned.mp4");
  ffmpeg(["-f", "lavfi", "-i", "color=c=0x0a0a0b:s=1280x720:r=10:d=12", "-vf", `drawtext=fontfile=${FONT}:text='the quick brown fox jumps over':fontsize=54:fontcolor=white:x=(w-text_w)/2:y=620:enable='lt(t,6)'`, "-c:v", "libx264", "-pix_fmt", "yuv420p", captioned]);
  const bible = await studyReference(captioned);
  const presence = metric(bible, "captions.presenceShare");
  assert.equal(presence.status, "agreed", presence.reason ?? "");
  near(presence.value, 0.5, 0.11, "caption presence share (captions on for 6 of 12 s, sampled every 2 s, so within one sample of 0.5)");
  assert.equal(presence.methods[0].value, presence.methods[1].value, "OCR and the band ink test saw the same samples");
  assert.ok(bible.notMeasured.some((n) => /caption cadence/.test(n.what)), "caption cadence is stated as not measured");
});

test("disagreement: when the second camera method contradicts the first, the camera metric is unresolved, both numbers are kept and the seed excludes it", { skip: !HAVE_FFMPEG }, async () => {
  // A second method that claims the frame is always moving fast contradicts the first (which sees the still seconds).
  const liar = { estimateBlocks: () => ({ tx: 3, ty: 0, scale: 0 }), ...NO_OCR };
  const bible = await studyReference(PAN, { deps: liar });
  const share = metric(bible, "camera.movingShare");
  assert.equal(share.status, "unresolved");
  assert.equal(share.value, null);
  assert.equal(share.seedEligible, false);
  assert.ok((share.methods[0].value ?? 1) < 0.6 && (share.methods[1].value ?? 0) > 0.9, `both readings are kept: ${JSON.stringify(share.methods)}`);
  assert.deepEqual(bible.series.moves, [], "moves are not published from an unresolved camera");
  const seed = buildSeed(bible);
  assert.equal(seed.entries.some((e) => e.metric.startsWith("camera.")), false, "no camera number enters the seed");
  assert.ok(seed.excluded.some((e) => e.metric === "camera.movingShare" && /disagree/.test(e.reason)));
  assert.equal(JSON.stringify(seed.partialLook).includes("movingShare"), false);
  assert.match(seed.brief, /Not agreed, therefore not used:.*camera\.movingShare/);
  // Metrics both methods agree on still seed a look: tone and audio from the same bible.
  assert.ok(seed.entries.some((e) => e.metric === "audio.longestPauseSec"));
});

test("seed and run: writes a study folder, a numbers-only proposal, and writes into a film package only with --into, never over look.json or an earlier seed", { skip: !HAVE_FFMPEG }, async () => {
  const outRoot = path.join(TMP, "runs");
  const other = path.join(TMP, "other.mp4");
  fs.copyFileSync(TINY, other);
  const result = await runStudy({ references: [TINY, other], name: "Two Refs", outRoot, deps: NO_OCR });
  assert.equal(result.studyDir, path.join(outRoot, "two-refs"));
  for (const slug of ["tiny", "other"]) for (const file of ["bible.json", "bible.md", "seed.json", "seed.md"]) assert.ok(fs.existsSync(path.join(result.studyDir, slug, file)), `${slug}/${file}`);
  const bible = JSON.parse(fs.readFileSync(path.join(result.studyDir, "tiny", "bible.json"), "utf8")) as StudyBible;
  assert.equal(bible.schema, "aideos.study/1");
  assert.match(bible.boundary, /Craft measurements only.*No identity, likeness, script/);
  const md = fs.readFileSync(path.join(result.studyDir, "tiny", "bible.md"), "utf8");
  assert.match(md, /PROPOSAL, numbers only/);
  assert.match(md, /Craft measurements only/);
  const seed = JSON.parse(fs.readFileSync(path.join(result.studyDir, "tiny", "seed.json"), "utf8"));
  assert.equal(seed.proposal, true);
  assert.match(seed.brief, /^PROPOSAL from measured numbers/);
  assert.ok(seed.entries.length > 0);
  for (const entry of seed.entries) assert.ok(bible.metrics.find((m: Metric) => m.id === entry.metric)?.seedEligible, `${entry.metric} was agreed`);
  assert.equal(fs.existsSync(path.join(TEST_VIDEOS_DIR, "study-seed-film")), false, "nothing is written into a film package without --into");

  // --into writes next to look.json, leaves an existing look.json byte-for-byte alone, and refuses to overwrite its own seed.
  const slug = "study-seed-film";
  const design = path.join(TEST_VIDEOS_DIR, slug, "design");
  fs.mkdirSync(design, { recursive: true });
  fs.writeFileSync(path.join(TEST_VIDEOS_DIR, slug, "film.json"), "{}");
  fs.writeFileSync(path.join(design, "look.json"), '{"keep":"me"}');
  const into = await runStudy({ references: [TINY], name: "into", outRoot, into: slug, deps: NO_OCR });
  assert.equal(fs.readFileSync(path.join(design, "look.json"), "utf8"), '{"keep":"me"}');
  assert.deepEqual(into.seededInto, [path.join(design, "look.seed.json"), path.join(design, "STUDY_SEED.md")]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(design, "look.seed.json"), "utf8")).proposal, true);
  await assert.rejects(runStudy({ references: [TINY], name: "into2", outRoot, into: slug, deps: NO_OCR }), /already exists.*never overwritten/);
  await assert.rejects(runStudy({ references: [TINY, TINY], name: "into3", outRoot, into: slug, deps: NO_OCR }), /exactly one reference/);
  await assert.rejects(runStudy({ references: [TINY], name: "into4", outRoot, into: "no-such-film", deps: NO_OCR }), /no film package/);
  assert.equal(fs.readFileSync(path.join(design, "look.json"), "utf8"), '{"keep":"me"}');
  fs.rmSync(path.join(TEST_VIDEOS_DIR, slug), { recursive: true, force: true });
});
