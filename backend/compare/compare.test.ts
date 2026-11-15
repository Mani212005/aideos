/**
 * File Description: Behavioural tests of `aideos compare` on short synthetic clips generated here with ffmpeg: known differences in luma, cut cadence and camera motion give the
 * expected agreed deltas within stated tolerances, a metric the study could not agree on gets no delta and stays out of the summary, the contact sheet has the right size, labels,
 * side order and swatches, a URL is refused, and a file compared with itself has zero deltas. Written at the captain's request (reference follow-up, step B of ideas 1 and 2:
 * a compare board and metric diff built on the two-method agreement rule of `aideos study`).
 * Inputs and outputs: generated synthetic mp4 files -> assertions on CompareReport rows, the files a run writes and the contact sheet pixels.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { resolveMetric } from "../study/agreement";
import type { StudyBible } from "../study/types";
import { buildRows } from "./diff";
import { decodePng } from "./png";
import { runCompare } from "./run";
import { buildSummary } from "./summary";
import type { CompareReport, CompareRow } from "./types";

const HAVE_FFMPEG = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-compare-test-"));
/** No OCR: it is the slowest step and caption presence is not what these tests measure. */
const NO_OCR = { hasTesseract: () => false };

// Runs ffmpeg and fails the test with its message when it cannot make a fixture.
function ffmpeg(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

// Finds one row of a report by metric id.
function row(report: CompareReport, id: string): CompareRow {
  const found = report.rows.find((r) => r.id === id);
  assert.ok(found, `row ${id} is in the report`);
  return found;
}

// Asserts a number is within a stated absolute tolerance of the known truth.
function near(actual: number | null, expected: number, tolerance: number, what: string): void {
  assert.ok(actual !== null && Math.abs(actual - expected) <= tolerance, `${what}: measured ${actual}, known ${expected} +- ${tolerance}`);
}

const TEXTURE = path.join(TMP, "texture.png");
/** REF: 4 s, the camera still, bright (luma code values compressed to half and lifted by 70). */
const REF_STILL = path.join(TMP, "ref-still.mp4");
/** OURS: 4 s, a pan of 1 px per frame from 1 s to 3 s, dark (lifted by 20, so exactly 50 luma codes below REF). */
const OURS_PAN = path.join(TMP, "ours-pan.mp4");
/** OURS: 4.5 s of three shots of 1.5 s (hard cuts at 1.5 s and 3.0 s), the same lift as REF_STILL. */
const OURS_CUTS = path.join(TMP, "ours-cuts.mp4");

before(() => {
  if (!HAVE_FFMPEG) return;
  ffmpeg(["-f", "lavfi", "-i", "color=c=gray:s=1600x900:d=1", "-vf", "geq=lum='random(1)*255':cb=128:cr=128,gblur=sigma=5", "-frames:v", "1", TEXTURE]);
  const encode = ["-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", "-an"];
  ffmpeg(["-loop", "1", "-framerate", "30", "-i", TEXTURE, "-t", "4", "-vf", "crop=480:270:200:200,eq=contrast=2.2,lutyuv=y='val*0.5+70'", ...encode, REF_STILL]);
  ffmpeg(["-loop", "1", "-framerate", "30", "-i", TEXTURE, "-t", "4", "-vf", "crop=480:270:'200+30*clip(t-1,0,2)':200,eq=contrast=2.2,lutyuv=y='val*0.5+20'", ...encode, OURS_PAN]);
  ffmpeg([
    "-loop", "1", "-framerate", "30", "-i", TEXTURE, "-t", "4.5",
    "-filter_complex",
    "[0:v]crop=480:270:0:0,eq=brightness=-0.25,trim=duration=1.5,setpts=PTS-STARTPTS[a];[0:v]crop=480:270:800:300,eq=brightness=0.25:contrast=1.5,trim=duration=1.5,setpts=PTS-STARTPTS[b];[0:v]crop=480:270:300:500,eq=contrast=2,trim=duration=1.5,setpts=PTS-STARTPTS[c];[a][b][c]concat=n=3:v=1:a=0,lutyuv=y='val*0.5+70'",
    ...encode, OURS_CUTS,
  ]);
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let panReport: CompareReport;
let panDir: string;

test("luma and camera: a darker clip with a 2 s pan against a bright still clip gives the known agreed deltas", { skip: !HAVE_FFMPEG }, async () => {
  const result = await runCompare({ ours: OURS_PAN, ref: REF_STILL, out: path.join(TMP, "out-pan"), deps: NO_OCR });
  panReport = result.report;
  panDir = result.dir;
  // Known truth: OURS is exactly 50 luma codes below REF, on the study scale (Y - 16) / 219: -50 / 219 = -0.228.
  for (const id of ["tone.meanLuma", "tone.blackPoint"]) {
    const r = row(panReport, id);
    assert.equal(r.status, "agreed", `${id}: ${r.reason ?? ""}`);
    near(r.delta, -50 / 219, 0.03, `${id} delta (ours minus ref)`);
    assert.equal(r.differs, true);
  }
  // The same texture and contrast on both sides: contrast and saturation do not differ.
  assert.equal(row(panReport, "tone.saturation").differs, false);
  // Known truth: the pan moves for 2 s of 4 (60 of about 119 frame pairs) at 0.0625 frame widths per second, one move of 60 frames; REF is still.
  const share = row(panReport, "camera.movingShare");
  assert.equal(share.status, "agreed", share.reason ?? "");
  near(share.delta, 60 / 119, 0.07, "moving share delta");
  near(row(panReport, "camera.framesPerMove").delta, 60, 6, "frames per move delta");
  near(row(panReport, "camera.medianSpeedWidthsPerSec").delta, 0.0625, 0.01, "median camera speed delta");
  // The summary states the largest agreed deltas and no unresolved number as a delta.
  assert.ok(panReport.summary.some((b) => /Mean luma: ours is .* lower/.test(b)), panReport.summary.join("\n"));
  assert.ok(panReport.summary.some((b) => /camera moves: ours is .* higher/.test(b)), panReport.summary.join("\n"));
});

test("cut cadence: three shots in 4.5 s against a clip with no cut gives a cut count delta of exactly 2 and the known cadence", { skip: !HAVE_FFMPEG }, async () => {
  const { report } = await runCompare({ ours: OURS_CUTS, ref: REF_STILL, out: path.join(TMP, "out-cuts"), deps: NO_OCR });
  const count = row(report, "cuts.count");
  assert.equal(count.status, "agreed", count.reason ?? "");
  assert.equal(count.delta, 2);
  assert.equal(row(report, "cuts.count").ref?.value, 0);
  near(row(report, "cuts.perMinute").ours?.value ?? null, (2 / 4.5) * 60, 1, "cuts per minute of ours");
  near(row(report, "shots.medianLengthSec").delta, 1.5 - 4, 0.15, "median shot length delta");
  near(row(report, "media.durationSec").delta, 0.5, 0.1, "duration delta");
  assert.ok(report.summary.some((b) => /Hard cuts \(agreed by both methods\): ours is 2 cuts/.test(b)), report.summary.join("\n"));
  // The sheet shows ours' two cut points under their own heading; the reference has none, so its cells say so.
  assert.ok(report.sheet);
  const cuts = report.sheet.cells.filter((c) => c.kind === "cut");
  assert.deepEqual(cuts.map((c) => c.side), ["ours", "ours"]);
  assert.deepEqual(cuts.map((c) => c.frameId), [45, 90], "cut frames are 1.5 s and 3.0 s at 30 fps");
  assert.ok(cuts.every((c) => /^OURS CUT \d F\d+ T\d\.\d\dS/.test(c.label)), cuts.map((c) => c.label).join(" | "));
});

test("disagreement: a metric the study could not agree on gets no delta, keeps both readings and stays out of the summary", { skip: !HAVE_FFMPEG }, () => {
  const ours = JSON.parse(fs.readFileSync(path.join(panDir, "bibles", "ours.json"), "utf8")) as StudyBible;
  const ref = JSON.parse(fs.readFileSync(path.join(panDir, "bibles", "ref.json"), "utf8")) as StudyBible;
  // The study's own rule makes the disagreeing reading: two methods that differ by far more than the tolerance.
  const liar = resolveMetric({ id: "tone.meanLuma", label: "Mean luma", unit: "0..1", a: { method: "A", value: 0.2 }, b: { method: "B", value: 0.8 }, tolerance: { abs: 0.05 } });
  assert.equal(liar.status, "unresolved");
  const rows = buildRows({ ...ours, metrics: ours.metrics.map((m) => (m.id === "tone.meanLuma" ? liar : m)) }, ref);
  const luma = rows.find((r) => r.id === "tone.meanLuma");
  assert.ok(luma);
  assert.equal(luma.status, "unresolved");
  assert.equal(luma.delta, null, "no delta is stated");
  assert.equal(luma.differs, null);
  assert.deepEqual(luma.ours?.readings.map((r) => r.value), [0.2, 0.8], "both readings are kept");
  assert.match(luma.reason ?? "", /not used/);
  const summary = buildSummary(rows, []).join("\n");
  assert.doesNotMatch(summary, /Mean luma:/, "an unresolved metric is never stated as a delta");
  assert.match(summary, /Not used: .*tone\.meanLuma/);
  // The disagreeing metric is the only change: the other tone rows still have deltas.
  assert.equal(rows.find((r) => r.id === "tone.blackPoint")?.status, "agreed");
  // A metric one side lacks (here a word list) is not measured, not a zero.
  const wpm = rows.find((r) => r.id === "audio.wpm");
  assert.equal(wpm?.status, "not-measured");
  assert.equal(wpm?.delta, null);
});

test("contact sheet: REF on the left, OURS on the right, labelled with frame ids and times, with palette swatches, at the size the manifest states", { skip: !HAVE_FFMPEG }, () => {
  const sheet = panReport.sheet;
  assert.ok(sheet, "the run drew a sheet");
  const file = path.join(panDir, "contact-sheet.png");
  const png = decodePng(fs.readFileSync(file));
  assert.deepEqual([png.width, png.height], [sheet.width, sheet.height], "the PNG has the size the manifest states");
  assert.equal(sheet.width, 1008);
  // Five matched moments per side at equal fractions of the duration.
  const moments = sheet.cells.filter((c) => c.kind === "moment");
  assert.equal(moments.length, 10);
  for (const side of ["ref", "ours"] as const) {
    const cells = moments.filter((c) => c.side === side);
    assert.deepEqual(cells.map((c) => c.fraction), [0.1, 0.3, 0.5, 0.7, 0.9]);
    assert.deepEqual(cells.map((c) => c.frameId), [12, 36, 60, 84, 108], "frame ids are the frames at 10, 30, 50, 70 and 90 percent of 4 s at 30 fps");
    for (const c of cells) assert.ok(c.label.startsWith(side === "ref" ? "REF F" : "OURS F") && /T\d\.\d\dS \(\d+%\)$/.test(c.label), c.label);
  }
  const left = moments.filter((c) => c.side === "ref");
  const right = moments.filter((c) => c.side === "ours");
  assert.ok(left.every((c) => c.x + c.width <= sheet.width / 2) && right.every((c) => c.x >= sheet.width / 2), "REF is the left column and OURS the right column");
  assert.ok(sheet.heading[0].startsWith("REF (LEFT) VS OURS (RIGHT)"));
  assert.ok(sheet.heading.some((h) => /NUMBERS, NOT A VERDICT/.test(h)));
  // Pixels: a swatch is filled with exactly its stated colour, the left frame is the brighter one, and the heading text is drawn.
  const px = (x: number, y: number): number[] => Array.from(png.rgb.slice((y * png.width + x) * 3, (y * png.width + x) * 3 + 3));
  for (const c of moments.slice(0, 4)) {
    assert.ok(c.swatches.length >= 1);
    const s = c.swatches[0];
    assert.deepEqual(px(s.x + 1, s.y + 1), [1, 3, 5].map((i) => parseInt(s.hex.slice(i, i + 2), 16)), `swatch ${s.hex} is drawn in its own colour`);
  }
  const meanLuma = (c: { x: number; y: number; width: number; height: number }): number => {
    let sum = 0;
    for (let y = c.y; y < c.y + c.height; y += 4) for (let x = c.x; x < c.x + c.width; x += 4) sum += px(x, y)[1];
    return sum / (Math.ceil(c.height / 4) * Math.ceil(c.width / 4));
  };
  assert.ok(meanLuma(left[0]) > meanLuma(right[0]) + 20, "the bright reference is drawn on the left and the dark video on the right");
  let ink = 0;
  for (let y = 0; y < 40; y++) for (let x = 0; x < png.width; x++) if (px(x, y)[0] === 235) ink++;
  assert.ok(ink > 100, "the heading is drawn");
});

test("files: the folder holds the sheet, the diff table with method names, the summary and the JSON, all with the craft-only boundary", { skip: !HAVE_FFMPEG }, () => {
  for (const f of ["contact-sheet.png", "diff.md", "summary.md", "compare.json", "bibles/ours.json", "bibles/ref.json"]) assert.ok(fs.existsSync(path.join(panDir, f)), `${f} is written`);
  const json = JSON.parse(fs.readFileSync(path.join(panDir, "compare.json"), "utf8")) as CompareReport;
  assert.equal(json.schema, "aideos.compare/1");
  assert.match(json.boundary, /No identity, likeness, script, voice, character or channel cloning/);
  assert.deepEqual(json.summary, panReport.summary);
  const diff = fs.readFileSync(path.join(panDir, "diff.md"), "utf8");
  assert.match(diff, /\| tone\.meanLuma \|/);
  assert.match(diff, /ffmpeg signalstats/, "the method names are in the table");
  assert.match(diff, /No identity, likeness/);
  assert.match(fs.readFileSync(path.join(panDir, "summary.md"), "utf8"), /^- Mean luma/m);
  // Every pixel-derived metric of a delta row came from an agreed reading on both sides.
  for (const r of json.rows.filter((x) => x.delta !== null)) assert.ok(["agreed", "not-pixel"].includes(r.ref?.status ?? "") && ["agreed", "not-pixel"].includes(r.ours?.status ?? ""), r.id);
});

test("a URL is refused for either side, nothing is written, the network is never used and the CLI exits 2", { skip: !HAVE_FFMPEG }, async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("the network was used"); }) as typeof fetch;
  try {
    const out = path.join(TMP, "out-url");
    await assert.rejects(runCompare({ ours: "https://example.com/a.mp4", ref: REF_STILL, out }), /URL.*local files only.*never downloads/);
    await assert.rejects(runCompare({ ours: REF_STILL, ref: "www.youtube.com/watch?v=abc", out }), /URL/);
    await assert.rejects(runCompare({ ours: REF_STILL, ref: path.join(TMP, "absent.mp4"), out }), /no video file/);
    assert.equal(fs.existsSync(out), false, "a refused run writes nothing");
  } finally {
    globalThis.fetch = realFetch;
  }
  const cli = spawnSync("npx", ["tsx", "backend/cli.ts", "compare", REF_STILL, "https://example.com/ref.mp4"], { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" });
  assert.equal(cli.status, 2, "the CLI exits 2 when a comparison cannot run");
  assert.match(cli.stderr, /URL/);
});

test("the same file against itself gives zero deltas and no difference", { skip: !HAVE_FFMPEG }, async () => {
  const { report } = await runCompare({ ours: REF_STILL, ref: REF_STILL, out: path.join(TMP, "out-self"), noSheet: true, deps: NO_OCR });
  const agreed = report.rows.filter((r) => r.status === "agreed");
  assert.ok(agreed.length >= 10, `most metrics are agreed (${agreed.length})`);
  for (const r of agreed) {
    assert.equal(r.delta, 0, `${r.id} delta`);
    assert.equal(r.differs, false, `${r.id} differs`);
  }
  assert.ok(report.facts.every((f) => f.same));
  assert.match(report.summary[0], /No agreed metric differs/);
  assert.equal(report.sheet, null, "--no-sheet writes no sheet");
});
