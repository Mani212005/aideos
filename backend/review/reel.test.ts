/**
 * File Description: Approved plan section 7 tests for per-format review inputs, report paths and the delivered reel cap.
 * Inputs and outputs: isolated package, tiny rendered deliveries and measured durations -> review reports and cap verdicts.
 * Used by: npm test.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import { loadFixtureFilm } from "../testSupport/fixtureFilms";
import { parseFilm } from "../../src/dl/schema";
import { resolveTarget, reviewFormats } from "./review";
import { reelLength } from "./criteria";
import { extractDeterministicFacts } from "../geminiReview/facts";
import { decideVerdict } from "../allCheck/finish";
import type { FormatRoundRecord } from "../allCheck/types";

// Makes a measured passing record whose identity belongs to exactly one delivery.
function record(format: "long" | "reel", filmHash: string): FormatRoundRecord {
  return { schema: "aideos.all-check.round/1", format, filmHash, round: 1, videoPath: `${format}.mp4`, createdAt: "now",
    passed: true, failing: [], review: { score: 9.5, verdict: "ACCEPT", gatesPassed: true, summary: "pass", failedCriteria: [], feedback: [], reportPath: null },
    measured: { passed: true, gateFailures: [], softFailures: [], recommendations: [], reportPath: null },
    frameCheck: { status: "clean", issues: [], stillsDir: "frames", stills: [] } };
}

test("captain decision 2026-10-22: rendered reel length includes its card and has a hard 179 s ceiling", () => {
  assert.equal(reelLength(179).status, "pass");
  const fail = reelLength(179.001);
  assert.equal(fail.status, "fail");
  assert.equal(fail.gate, true);
  assert.equal(fail.metrics.durationSec, 179.001);
  assert.match(fail.summary, /including the end card/);
});

test("all-check verdict requires passing long and reel at their own current film hashes", () => {
  const records = [record("long", "long-hash"), record("reel", "reel-hash")];
  assert.equal(decideVerdict(records, { long: "long-hash", reel: "reel-hash" }).passed, true);
  assert.equal(decideVerdict(records, { long: "changed", reel: "reel-hash" }).passed, false);
  assert.equal(decideVerdict(records, { long: "long-hash", reel: "changed" }).passed, false);
});

test("review --format reel selects reel inputs; default reviews both and preserves review.json for long", async () => {
  const slug = "review-reel-inputs", pkg = path.join(TEST_VIDEOS_DIR, slug);
  fs.mkdirSync(path.join(pkg, "reel"), { recursive: true });
  fs.mkdirSync(path.join(pkg, "renders"), { recursive: true });
  const base = parseFilm(loadFixtureFilm("fixture-canvas-a"));
  const long = { ...base, id: slug, captions: "off", voiceover: { src: `videos/${slug}/voiceover.wav`, volume: 1, durationSec: 210 } };
  const reel = { ...long, voiceover: { ...long.voiceover, src: `videos/${slug}/reel/voiceover.wav`, durationSec: 10 } };
  fs.writeFileSync(path.join(pkg, "film.json"), JSON.stringify(long));
  fs.writeFileSync(path.join(pkg, "reel/film.json"), JSON.stringify(reel));
  fs.writeFileSync(path.join(pkg, "voiceover_words.json"), JSON.stringify({ words: [{ word: "long", start: 0, end: 1 }] }));
  fs.writeFileSync(path.join(pkg, "reel/voiceover_words.json"), JSON.stringify({ words: [{ word: "reel", start: 0, end: 1 }] }));
  for (const [format, size] of [["long", "192x108"], ["reel", "108x192"]]) {
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `color=c=black:s=${size}:r=10`, "-t", "0.6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", path.join(pkg, `renders/${format}.mp4`)]);
  }
  const selected = resolveTarget({ target: slug, format: "reel" });
  assert.equal(selected.film, path.join(pkg, "reel/film.json"));
  assert.equal(selected.words, path.join(pkg, "reel/voiceover_words.json"));
  const reports = await reviewFormats({ target: slug, skipOcr: true });
  assert.deepEqual(reports.map((r) => r.format), ["long", "reel"]);
  assert.equal(reports[0].sources.film, path.join(pkg, "film.json"));
  assert.equal(reports[1].sources.words, path.join(pkg, "reel/voiceover_words.json"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(pkg, "review.json"), "utf8")).format, "long");
  assert.equal(JSON.parse(fs.readFileSync(path.join(pkg, "review.reel.json"), "utf8")).format, "reel");
  const facts = await extractDeterministicFacts(path.join(pkg, "renders/reel.mp4"), { skipOcr: true });
  assert.equal(facts.reelLength?.capSec, 179);
  assert.ok(facts.endCard);
  assert.equal(facts.endCard.endSec - facts.endCard.startSec, 3);
  assert.match(facts.rawSummaryText, /179 s hard cap/);
  assert.equal(facts.endCard.startSec, 10);
});
