/**
 * File Description: Behavioural tests of the film acceptance machine (audit machine M4): the pure state transitions
 * (including impossible ones), the persisted record, the all-check rounds that feed it, the Export summary, and the
 * design-build guard that refuses to silently drop a hand-edited film.json. Uses tiny synthetic packages and stub
 * renders only: no model, no render and no network.
 * Inputs and outputs: events, stub round dependencies and fixture packages -> assertions on states, files and errors.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import { formatReviewSummary, reviewVideo as geminiReviewVideo, type GeminiReviewReport, type PairwiseRunReport } from "../geminiReview";
import { RUBRIC_CRITERIA } from "../geminiReview/rubric";
import type { AgyRunner } from "../geminiReview/types";
import type { ReviewReport } from "../review/types";
import { recordFrameCheck, runRound, type RoundDeps } from "../allCheck/round";
import { allCheckDir, type AllCheckConfig } from "../allCheck/types";
import { buildDesign } from "../designSpec/build";
import { readFilm, writeFilm } from "../pipeline/filmStore";
import {
  classifyFilmEdit,
  currentDraws,
  effectiveState,
  filmDifferences,
  ImpossibleTransitionError,
  initialRecord,
  summarize,
  transition,
  type AcceptanceEvent,
  type AcceptanceRecord,
  type JudgeDraw,
} from "./machine";
import { acceptancePath, acceptanceSummary, acceptanceSummaryForFilm, applyEvents, filmEditState, hashBytes, hashFileOrNull, noteFilmWrite, readAcceptance, readRecord } from "./store";

const AT = "2026-11-13T00:00:00.000Z";
const FILM = "film-hash-1";
const MP4 = "mp4-hash-1";

// A draw of the given bytes.
function draw(key: string, passed: boolean, over: Partial<JudgeDraw> = {}): JudgeDraw {
  return { key, mp4Hash: MP4, score: passed ? 9.3 : 8.6, verdict: passed ? "ACCEPT" : "REVISE", gatesPassed: true, passed, at: AT, ...over };
}

// Runs a list of events through the machine from an empty record.
function run(events: AcceptanceEvent[], start: AcceptanceRecord = initialRecord("long")): AcceptanceRecord {
  return events.reduce(transition, start);
}

const RENDERED: AcceptanceEvent = { type: "rendered", filmHash: FILM, mp4Hash: MP4, at: AT };
const MEASURED_OK: AcceptanceEvent = { type: "measured", mp4Hash: MP4, passed: true, gateFailures: [], at: AT };

test("machine: the happy path walks unreviewed to accepted, and every step is a named state", () => {
  let record = initialRecord("long");
  assert.equal(record.state, "unreviewed");
  record = transition(record, RENDERED);
  assert.equal(record.state, "rendered");
  record = transition(record, MEASURED_OK);
  assert.equal(record.state, "measured-passed");
  record = transition(record, { type: "judged", draw: draw("round-1", true) });
  assert.equal(record.state, "judged");
  record = transition(record, { type: "approved", mp4Hash: MP4, at: AT });
  assert.equal(record.state, "accepted");
  assert.equal(effectiveState(record, FILM), "accepted");
});

test("machine: measured gates decide first, so a passing review cannot rescue failed measured checks", () => {
  const record = run([RENDERED, { type: "measured", mp4Hash: MP4, passed: false, gateFailures: ["captions"], at: AT }, { type: "judged", draw: draw("round-1", true) }]);
  assert.equal(record.state, "measured-failed");
  assert.throws(() => transition(record, { type: "approved", mp4Hash: MP4, at: AT }), ImpossibleTransitionError);
});

test("machine: a REVISE verdict is its own state and cannot be approved", () => {
  const record = run([RENDERED, MEASURED_OK, { type: "judged", draw: draw("round-1", false) }]);
  assert.equal(record.state, "revise");
  assert.throws(() => transition(record, { type: "approved", mp4Hash: MP4, at: AT }), /impossible acceptance transition: approved while revise/);
});

test("machine: impossible transitions throw and name the state and the event", () => {
  const fresh = initialRecord("long");
  assert.throws(() => transition(fresh, MEASURED_OK), /measured while unreviewed: no rendered video/);
  assert.throws(() => transition(fresh, { type: "approved", mp4Hash: MP4, at: AT }), ImpossibleTransitionError);
  const rendered = transition(fresh, RENDERED);
  assert.throws(() => transition(rendered, { type: "approved", mp4Hash: MP4, at: AT }), /approval needs passed measured gates/);
  assert.throws(() => transition(rendered, { type: "revoked", mp4Hash: MP4, at: AT }), /only an accepted record can be revoked/);
  assert.throws(() => transition(rendered, { ...MEASURED_OK, mp4Hash: "other-bytes" } as AcceptanceEvent), /holds/, "evidence about other bytes never lands on these bytes");
  assert.equal(rendered.state, "rendered", "a refused event leaves the record as it was");
});

test("machine: a re-review of unchanged bytes is a recorded second draw, and replaying a draw is not a second draw", () => {
  let record = run([RENDERED, MEASURED_OK, { type: "judged", draw: draw("round-1", true) }, { type: "approved", mp4Hash: MP4, at: AT }]);
  assert.equal(record.state, "accepted");
  // The same render in the next round keeps the first draw.
  record = transition(record, RENDERED);
  assert.equal(record.state, "accepted", "rendering identical bytes again does not erase what was learned");
  record = transition(record, { type: "judged", draw: draw("round-2", false) });
  assert.equal(currentDraws(record).length, 2, "both draws are kept");
  assert.equal(record.state, "revise", "the newest draw of these bytes decides (today's rule, kept in one place)");
  assert.equal(record.drawsDisagree, true);
  assert.equal(record.approved, false, "new evidence withdraws an earlier approval");
  const summary = summarize(record, FILM);
  assert.equal(summary.state, "revise", "the current verdict rule remains the newest draw");
  assert.equal(summary.drawsDisagree, true);
  assert.match(summary.message, /2 reviews of these exact bytes disagree: ACCEPT 9\.3, REVISE 8\.6/);
  const replayed = transition(record, { type: "judged", draw: draw("round-2", false) });
  assert.equal(currentDraws(replayed).length, 2);
});

test("machine: review history is append-only beyond fifty draws", () => {
  let record = run([RENDERED, MEASURED_OK]);
  for (let i = 0; i < 60; i++) {
    record = transition(record, { type: "judged", draw: draw(`round-${i}`, i % 2 === 0) });
  }
  assert.equal(record.judged.length, 60);
  assert.equal(record.judged[0].key, "round-0", "the first draw remains in the append-only history");
  assert.equal(record.judged[59].key, "round-59", "the newest draw remains in the history");
  assert.equal(record.drawsDisagree, true);
  assert.equal(record.state, "revise", "the newest REVISE draw controls the existing verdict rule");
});

test("machine: new bytes start without evidence, and draws of the old bytes stay as history but do not decide", () => {
  const first = run([RENDERED, MEASURED_OK, { type: "judged", draw: draw("round-1", true) }]);
  const second = transition(first, { type: "rendered", filmHash: "film-hash-2", mp4Hash: "mp4-hash-2", at: AT });
  assert.equal(second.state, "rendered");
  assert.equal(second.measured, null);
  assert.equal(second.judged.length, 1, "the history is kept");
  assert.equal(currentDraws(second).length, 0, "but it is not evidence about the new bytes");
});

test("machine: a changed film makes reviewed bytes stale, and restoring the reviewed film revives the verdict", () => {
  const accepted = run([RENDERED, MEASURED_OK, { type: "judged", draw: draw("round-1", true) }, { type: "approved", mp4Hash: MP4, at: AT }]);
  assert.equal(effectiveState(accepted, FILM), "accepted");
  assert.equal(effectiveState(accepted, "film-hash-edited"), "stale");
  assert.equal(effectiveState(accepted, null), "stale", "a missing film is not the reviewed film");
  assert.equal(effectiveState(accepted, FILM), "accepted");
  assert.equal(effectiveState(initialRecord("long"), "anything"), "unreviewed");
});

test("machine: the summary tells the captain whether the exported film is the reviewed one", () => {
  const accepted = run([RENDERED, MEASURED_OK, { type: "judged", draw: draw("round-1", true) }, { type: "approved", mp4Hash: MP4, at: AT }]);
  assert.deepEqual([summarize(accepted, FILM).state, summarize(accepted, FILM).reviewed], ["accepted", true]);
  assert.match(summarize(accepted, FILM).message, /Reviewed and accepted.*9\.3/);
  assert.match(summarize(accepted, "edited").message, /Changed since review/);
  assert.equal(summarize(accepted, "edited").reviewed, false);
  assert.match(summarize(null, FILM).message, /has not been reviewed/);
  const revise = run([RENDERED, MEASURED_OK, { type: "judged", draw: draw("round-1", false) }]);
  assert.match(summarize(revise, FILM).message, /asked for revisions \(reviewer score 8\.6\)/);
  const failed = run([RENDERED, { type: "measured", mp4Hash: MP4, passed: false, gateFailures: ["captions", "overlap"], at: AT }]);
  assert.match(summarize(failed, FILM).message, /measured checks failed: captions, overlap/);
  assert.match(summarize(run([RENDERED]), FILM).message, /review did not finish/);
});

test("machine: hand edits are told apart from tool writes, and an unknown history is never called an edit", () => {
  assert.equal(classifyFilmEdit([], "h1"), "untracked");
  assert.equal(classifyFilmEdit(["h1", "h2"], "h2"), "clean");
  assert.equal(classifyFilmEdit(["h1", "h2"], "h3"), "hand-edited");
  assert.equal(classifyFilmEdit(["h1"], null), "untracked");
  assert.deepEqual(filmDifferences({ title: "a", shots: [{ id: "s1", dur: 1 }, { id: "s2", dur: 2 }] }, { title: "b", shots: [{ id: "s1", dur: 1 }, { id: "s2", dur: 3 }, { id: "s3" }] }), ['field "title"', "shot order", 'shot "s2"', 'shot "s3"']);
  assert.deepEqual(filmDifferences({ title: "a", shots: [] }, { title: "a", shots: [] }), []);
  assert.deepEqual(filmDifferences({ shots: [{ id: "a" }, { id: "b" }] }, { shots: [{ id: "b" }, { id: "a" }] }), ["shot order"]);
});

// Makes a throwaway package folder with the given film text.
function makePackage(slug: string, filmText = JSON.stringify({ id: slug, title: slug })): string {
  const dir = path.join(getVideosDir(), slug);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "film.json"), filmText);
  return dir;
}

test("store: events persist per format, a refused event saves nothing, and a corrupt file reads as empty", () => {
  const dir = makePackage("acc-store");
  try {
    assert.equal(readRecord(dir, "long").state, "unreviewed");
    applyEvents(dir, "long", [RENDERED, MEASURED_OK]);
    assert.equal(readRecord(dir, "long").state, "measured-passed");
    assert.equal(readRecord(dir, "reel").state, "unreviewed", "formats are separate records");
    const before = fs.readFileSync(acceptancePath(dir), "utf8");
    assert.throws(() => applyEvents(dir, "long", [{ type: "judged", draw: draw("round-1", true) }, { type: "approved", mp4Hash: "wrong", at: AT }]), ImpossibleTransitionError);
    assert.equal(fs.readFileSync(acceptancePath(dir), "utf8"), before, "a batch with an impossible event is all-or-nothing");
    fs.writeFileSync(acceptancePath(dir), "{not json");
    assert.deepEqual(readAcceptance(dir), { schema: "aideos.acceptance/1", toolWrites: [], formats: {} });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("store: film.json written by the tools is clean, an edit by hand is flagged, and restoring a tool-written film is clean again", () => {
  const slug = "acc-ledger";
  const dir = makeRunPackage(slug);
  try {
    assert.equal(filmEditState(dir), "untracked", "a package with no ledger is never accused of a hand edit");
    const film = readFilm(slug);
    assert.ok(film);
    writeFilm(slug, { ...film, title: "Ledger" });
    assert.equal(filmEditState(dir), "clean");
    const written = fs.readFileSync(path.join(dir, "film.json"), "utf8");
    fs.writeFileSync(path.join(dir, "film.json"), written.replace('"Ledger"', '"Fixed by hand"'));
    assert.equal(filmEditState(dir), "hand-edited");
    fs.writeFileSync(path.join(dir, "film.json"), written);
    assert.equal(filmEditState(dir), "clean", "a rollback to a film a tool wrote is not a hand edit");
    noteFilmWrite(dir, "x");
    assert.equal(readAcceptance(dir).toolWrites.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(allCheckDir(slug), { recursive: true, force: true });
  }
});

// Stub round dependencies: renders fixed bytes, returns the given scores.
function stubRound(over: { score?: number; measuredOk?: boolean; video?: string; report?: GeminiReviewReport } = {}): RoundDeps {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acceptance-render-"));
  return {
    render: async (slug, format) => {
      const file = path.join(tmp, `${slug}-${format}.mp4`);
      fs.writeFileSync(file, over.video ?? `video-${format}`);
      return file;
    },
    measure: async (req) => {
      fs.mkdirSync(req.outDir, { recursive: true });
      fs.writeFileSync(path.join(req.outDir, "review.json"), "{}");
      const passed = over.measuredOk ?? true;
      return { passed, gateFailures: passed ? [] : ["overlap"], softFailures: [], recommendations: [] } as unknown as ReviewReport;
    },
    gemini: async () => {
      if (over.report) return over.report;
      const score = over.score ?? 9.3;
      return {
        overallScore: score, verdict: score >= 9 ? "ACCEPT" : "REVISE", summary: "s",
        criteria: [{ name: "persistent_stage", title: "Persistent stage", isGate: true, score: 9, passed: true, evidenceTimestamps: ["0:10"], reason: "r" }],
        feedback: [], model: "m", evaluatedAt: "t", videoHash: "h", videoPath: "p",
      } as unknown as GeminiReviewReport;
    },
    pairwise: async () => ({ winner: "Tie", videoA: { finalRating: 9 }, videoB: { finalRating: 9 } }) as unknown as PairwiseRunReport,
    durationOf: () => 10,
    still: (_video, _t, out) => {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, "jpg");
      return out;
    },
    onProgress: () => {},
  };
}

// Writes a package and an all-check run config for it.
function makeRunPackage(slug: string): string {
  const dir = makePackage(slug, JSON.stringify({
    id: slug, title: slug, fps: 30, chapters: ["Chapter"],
    canvas: { nodes: [{ id: "a", label: "A", x: 0, y: 0 }, { id: "b", label: "B", x: 200, y: 0 }], edges: [{ from: "a", to: "b" }] },
    shots: [{ id: "a", dur: 10, stage: "none", look: "a", move: "cut" }],
    voiceover: { src: `videos/${slug}/voiceover.wav` },
  }));
  fs.writeFileSync(path.join(dir, "voiceover.wav"), "RIFF");
  const config: AllCheckConfig = { schema: "aideos.all-check.config/1", slug, rounds: 4, target: 9, agent: "agy", startedAt: AT, studioWasRunning: false };
  fs.mkdirSync(allCheckDir(slug), { recursive: true });
  fs.writeFileSync(path.join(allCheckDir(slug), "config.json"), JSON.stringify(config));
  return dir;
}

test("all-check: a passing round is accepted only after the frame check, and a film edit afterwards makes it stale", async () => {
  const slug = "acc-round";
  const dir = makeRunPackage(slug);
  try {
    const [long] = await runRound({ slug, format: "long" }, stubRound());
    const filmHash = hashFileOrNull(path.join(dir, "film.json"));
    assert.equal(readRecord(dir, "long").state, "judged", "measured and reviewed, but the frame check is still pending");
    assert.equal(summarize(readRecord(dir, "long"), filmHash).reviewed, false);

    recordFrameCheck({ slug, round: long.round, format: "long", issues: [] });
    const accepted = readRecord(dir, "long");
    assert.equal(accepted.state, "accepted");
    assert.equal(accepted.filmHash, filmHash, "the approval is keyed to the exact film bytes");
    assert.equal(accepted.mp4Hash, hashFileOrNull(long.videoPath));
    assert.equal(acceptanceSummary(dir, "long", filmHash).reviewed, true);

    // A fix made by hand after approval: the verdict no longer applies to the film on disk.
    fs.writeFileSync(path.join(dir, "film.json"), fs.readFileSync(path.join(dir, "film.json"), "utf8").replace(`"title":"${slug}"`, '"title":"edited"'));
    const edited = hashFileOrNull(path.join(dir, "film.json"));
    assert.equal(acceptanceSummary(dir, "long", edited).state, "stale");
    assert.match(acceptanceSummary(dir, "long", edited).message, /Changed since review/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(allCheckDir(slug), { recursive: true, force: true });
  }
});

// A reviewer report the verdict policy produced from two draws of the same bytes (scores are the criteria means).
function twoDrawReport(first: number, second: number, verdict: "ACCEPT" | "REVISE"): GeminiReviewReport {
  const criteria = [{ name: "persistent_stage", title: "Persistent stage", isGate: true, score: 9, passed: true, evidenceTimestamps: ["0:10"], reason: "r" }];
  const draw = (n: number, score: number) => ({ draw: n, overallScore: score, score, gatesPassed: true, timestampsValid: true, verdict: score >= 9 ? "ACCEPT" : "REVISE", criteria, evaluatedAt: "t" });
  return {
    overallScore: first, criteriaMeanScore: (first + second) / 2, verdict, summary: "s", criteria, feedback: [], model: "m", evaluatedAt: "t",
    draws: [draw(1, first), draw(2, second)],
    drawNote: `2 reviewer draws of the same video (${first} and ${second})`,
  } as unknown as GeminiReviewReport;
}

test("all-check: a two-draw review appends both draws to the same acceptance record and the Export read says so in words", async () => {
  const slug = "acc-two-draws";
  const dir = makeRunPackage(slug);
  try {
    // The 0.5.0 case: the first draw 9.2 (in band), the second 8.81; combined 9.005 reaches the 9.0 target.
    const [long] = await runRound({ slug, format: "long" }, stubRound({ report: twoDrawReport(9.2, 8.81, "ACCEPT") }));
    recordFrameCheck({ slug, round: long.round, format: "long", issues: [] });
    const record = readRecord(dir, "long");
    const draws = currentDraws(record);
    assert.deepEqual(draws.map((d) => d.key), ["round-1", "round-1-draw-2"], "both draws live in the one record");
    assert.deepEqual(draws.map((d) => d.drawNumber), [1, 2]);
    assert.equal(draws[0].combinedScore, undefined);
    assert.ok(Math.abs((draws[1].combinedScore ?? 0) - 9.005) < 1e-9, "the last draw carries the combined score the decision used");
    assert.equal(draws[1].passed, true);
    assert.equal(record.state, "accepted");
    assert.equal(record.drawsDisagree, false, "the two draws of one review are settled by the policy, not a disagreement");
    const message = summarize(record, record.filmHash).message;
    assert.match(message, /reviewer score 9\.00/);
    assert.match(message, /asked 2 times about these exact bytes \(scores 9\.2 and 8\.81\) because the first was within 0\.5 of the 9\.0 bar; their mean, 9\.00, decided/);
    // Replaying the same round never counts a draw twice.
    const after = readRecord(dir, "long").judged.length;
    const { recordRoundAcceptance } = await import("../allCheck/round");
    recordRoundAcceptance(slug, long, 9);
    assert.equal(readRecord(dir, "long").judged.length, after);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(allCheckDir(slug), { recursive: true, force: true });
  }
});

test("all-check: a two-draw review whose combined score misses the bar is a revise, with both draws kept", async () => {
  const slug = "acc-two-draws-revise";
  const dir = makeRunPackage(slug);
  try {
    // Same first draw, second draw 8.6: combined 8.9 is under 9.0.
    const [long] = await runRound({ slug, format: "long" }, stubRound({ report: twoDrawReport(9.2, 8.6, "REVISE") }));
    assert.equal(long.passed, false);
    assert.match(long.failing.join("\n"), /reviewer score 8\.9 is under the 9\.0 target/);
    const record = readRecord(dir, "long");
    assert.equal(currentDraws(record).length, 2);
    assert.equal(record.state, "revise");
    assert.match(summarize(record, record.filmHash).message, /asked for revisions \(reviewer score 8\.9\)\. Fix the findings and run aideos all-check again\. The reviewer was asked 2 times/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(allCheckDir(slug), { recursive: true, force: true });
  }
});

// Reviews a stand-in video with a reviewer that scores the twelve criteria as given, through the real verdict policy.
async function reviewWithCriteria(scores: number[], untimed: number = -1): Promise<GeminiReviewReport> {
  assert.equal(scores.length, RUBRIC_CRITERIA.length);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acceptance-criteria-"));
  const video = path.join(dir, "video.mp4");
  fs.writeFileSync(video, Buffer.alloc(256, 3));
  const criteria = RUBRIC_CRITERIA.map((def, i) => ({ name: def.name, title: def.title, isGate: def.isGate, score: scores[i], passed: true, evidenceTimestamps: i === untimed ? [] : ["0:05"], reason: i === untimed ? "Looks fine." : `Seen at 0:05: ${def.title}` }));
  const runner: AgyRunner = async () => JSON.stringify({ overallScore: 9, verdict: "ACCEPT", summary: "s", criteria, feedback: [] });
  try {
    return await geminiReviewVideo(video, { runner, skipFacts: true, maxValidationAttempts: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("all-check: a criteria mean a float hair under 9.0 passes the round exactly as the verdict says, and a mean truly under 9.0 fails both", async () => {
  // Decision (captain, review round 1): one tolerant bar comparison for the verdict and the all-check round.
  const scores = [9.3, 8.7, 9, 9.4, 8.1, 9.3, 9.6, 9.4, 8.1, 8.8, 10, 8.3];
  const atBar = await reviewWithCriteria(scores);
  assert.equal(atBar.criteriaMeanScore, 8.999999999999998, "the float mean of these one-decimal scores lands under 9 by noise only");
  assert.equal(atBar.verdict, "ACCEPT");
  const slug = "acc-float-bar";
  const dir = makeRunPackage(slug);
  try {
    const [long] = await runRound({ slug, format: "long" }, stubRound({ report: atBar }));
    assert.doesNotMatch(long.failing.join("\n"), /under the 9\.0 target/);
    recordFrameCheck({ slug, round: long.round, format: "long", issues: [] });
    const record = readRecord(dir, "long");
    assert.equal(record.state, "accepted", "the round agrees with the ACCEPT verdict");
    assert.ok(currentDraws(record).every((d) => d.passed && d.verdict === "ACCEPT"));
    assert.match(summarize(record, record.filmHash).message, /accepted.*reviewer score 9\.0\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(allCheckDir(slug), { recursive: true, force: true });
  }

  const below = await reviewWithCriteria(scores.map((score) => (score === 10 ? 9.9 : score)));
  assert.equal(below.verdict, "REVISE");
  const belowSlug = "acc-float-bar-below";
  const belowDir = makeRunPackage(belowSlug);
  try {
    const [long] = await runRound({ slug: belowSlug, format: "long" }, stubRound({ report: below }));
    assert.equal(long.passed, false);
    assert.match(long.failing.join("\n"), /reviewer score 8\.99 is under the 9\.0 target/);
    assert.equal(readRecord(belowDir, "long").state, "revise");
  } finally {
    fs.rmSync(belowDir, { recursive: true, force: true });
    fs.rmSync(allCheckDir(belowSlug), { recursive: true, force: true });
  }
});

test("all-check: a criteria mean of 8.97 shows as 8.97, never 9.0, and fails the verdict, the round and the acceptance record", async () => {
  // Decision (captain, review round 2): a computed mean is never displayed as reaching the bar when it is under it.
  // One non-gate criterion carries no timestamp, so the draw cannot accept, no second draw runs, and 8.97 decides alone.
  const untimed = RUBRIC_CRITERIA.findIndex((def) => !def.isGate);
  const report = await reviewWithCriteria(RUBRIC_CRITERIA.map((_, i) => (i === untimed ? 8.64 : 9)), untimed);
  assert.ok(Math.abs((report.criteriaMeanScore ?? 0) - 8.97) < 1e-9);
  assert.equal(report.draws?.length ?? 1, 1);
  assert.equal(report.verdict, "REVISE");
  assert.match(formatReviewSummary(report), /Score: 8\.97 \/ 10\.0/);
  const slug = "acc-float-bar-897";
  const dir = makeRunPackage(slug);
  try {
    const [long] = await runRound({ slug, format: "long" }, stubRound({ report }));
    assert.equal(long.passed, false);
    const failing = long.failing.join("\n");
    assert.match(failing, /reviewer score 8\.97 is under the 9\.0 target/);
    assert.doesNotMatch(failing, /score 9\.0/);
    const record = readRecord(dir, "long");
    assert.equal(record.state, "revise");
    const message = summarize(record, record.filmHash).message;
    assert.match(message, /asked for revisions \(reviewer score 8\.97\)/);
    assert.doesNotMatch(message, /score 9\.0/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(allCheckDir(slug), { recursive: true, force: true });
  }
});

test("export acceptance: status follows the posted film when it differs from film.json", () => {
  const slug = "acc-posted-film";
  const dir = makeRunPackage(slug);
  try {
    const posted = { ...JSON.parse(fs.readFileSync(path.join(dir, "film.json"), "utf8")), title: "editor render film" };
    const postedHash = hashBytes(JSON.stringify(posted, null, 2));
    applyEvents(dir, "long", [
      { type: "rendered", filmHash: postedHash, mp4Hash: MP4, at: AT },
      { type: "measured", mp4Hash: MP4, passed: true, gateFailures: [], at: AT },
      { type: "judged", draw: draw("posted", true) },
      { type: "approved", mp4Hash: MP4, at: AT },
    ]);
    const beforeFilm = fs.readFileSync(path.join(dir, "film.json"), "utf8");
    const beforeAcceptance = fs.readFileSync(acceptancePath(dir), "utf8");
    assert.equal(acceptanceSummaryForFilm(dir, "long", posted).reviewed, true);
    assert.equal(acceptanceSummary(dir, "long", hashFileOrNull(path.join(dir, "film.json"))).reviewed, false);
    assert.equal(fs.readFileSync(path.join(dir, "film.json"), "utf8"), beforeFilm);
    assert.equal(fs.readFileSync(acceptancePath(dir), "utf8"), beforeAcceptance);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("export acceptance: derived reel status hashes the exact manifest bytes", () => {
  const slug = "acc-reel-bytes";
  const dir = makeRunPackage(slug);
  try {
    const reelFile = path.join(dir, "reel", "film.json");
    fs.mkdirSync(path.dirname(reelFile), { recursive: true });
    const reelText = `${JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, "film.json"), "utf8")), null, 2)}\n`;
    fs.writeFileSync(reelFile, reelText);
    const reelHash = hashBytes(reelText);
    applyEvents(dir, "reel", [
      { type: "rendered", filmHash: reelHash, mp4Hash: MP4, at: AT },
      { type: "measured", mp4Hash: MP4, passed: true, gateFailures: [], at: AT },
      { type: "judged", draw: draw("reel", true) },
      { type: "approved", mp4Hash: MP4, at: AT },
    ]);

    const parsedReel = JSON.parse(fs.readFileSync(reelFile, "utf8"));
    assert.equal(acceptanceSummary(dir, "reel", hashFileOrNull(reelFile)).reviewed, true);
    assert.equal(acceptanceSummaryForFilm(dir, "reel", parsedReel).reviewed, false, "reserialization drops the manifest newline used in the recorded hash");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("all-check: a frame-check issue after approval revokes it, and a second round of identical bytes is a second recorded draw", async () => {
  const slug = "acc-redraw";
  const dir = makeRunPackage(slug);
  try {
    const [first] = await runRound({ slug, format: "long" }, stubRound());
    recordFrameCheck({ slug, round: first.round, format: "long", issues: [] });
    assert.equal(readRecord(dir, "long").state, "accepted");

    recordFrameCheck({ slug, round: first.round, format: "long", issues: ["12s: text clipped"] });
    assert.equal(readRecord(dir, "long").state, "judged", "approval is withdrawn while the evidence stays");

    recordFrameCheck({ slug, round: first.round, format: "long", issues: [] });
    const [second] = await runRound({ slug, format: "long" }, stubRound({ score: 8.6 }));
    const record = readRecord(dir, "long");
    assert.equal(second.round, 2);
    assert.equal(currentDraws(record).length, 2, "the same bytes were judged twice and both draws are kept");
    assert.equal(record.state, "revise", "the newer draw of the same bytes was REVISE");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(allCheckDir(slug), { recursive: true, force: true });
  }
});

test("all-check: failed measured gates leave the bytes measured-failed even with a high review score", async () => {
  const slug = "acc-measured";
  const dir = makeRunPackage(slug);
  try {
    const [rec] = await runRound({ slug, format: "long" }, stubRound({ measuredOk: false }));
    assert.equal(readRecord(dir, "long").state, "measured-failed");
    assert.equal(readRecord(dir, "long").measured?.gateFailures[0], "overlap");
    recordFrameCheck({ slug, round: rec.round, format: "long", issues: [] });
    assert.equal(readRecord(dir, "long").state, "measured-failed", "a clean frame check does not approve failed measured gates");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(allCheckDir(slug), { recursive: true, force: true });
  }
});

// Copies the designed fixture package under a new slug, without its look plan.
function designedPackage(slug: string): string {
  const dir = path.join(getVideosDir(), slug);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(getVideosDir(), "speculative-decoding-designed"), dir, { recursive: true });
  fs.rmSync(path.join(dir, "design/look.json"), { force: true });
  fs.rmSync(path.join(dir, "acceptance.json"), { force: true });
  const film = { ...JSON.parse(fs.readFileSync(path.join(dir, "film.json"), "utf8")), id: slug };
  fs.writeFileSync(path.join(dir, "film.json"), JSON.stringify(film));
  const base = { ...JSON.parse(fs.readFileSync(path.join(dir, "design/base-film.json"), "utf8")), id: slug };
  fs.writeFileSync(path.join(dir, "design/base-film.json"), JSON.stringify(base));
  return dir;
}

test("design build: a hand-edited film.json is not silently dropped by a rebuild", () => {
  const slug = "acc-rebuild";
  const dir = designedPackage(slug);
  try {
    // A package with no tool-write history is built as before.
    const first = buildDesign(slug);
    assert.equal(first.state, "passed", JSON.stringify(first.errors));
    assert.equal(filmEditState(dir), "clean", "the build's own write is recorded as a tool write");

    // An unchanged film rebuilds without a word.
    assert.equal(buildDesign(slug).state, "passed");

    // A fix made by hand (as an all-check agent does) is refused, and the message names what would be lost.
    const built = JSON.parse(fs.readFileSync(path.join(dir, "film.json"), "utf8"));
    fs.writeFileSync(path.join(dir, "film.json"), JSON.stringify({ ...built, title: "Approved hand fix" }, null, 2));
    const refused = buildDesign(slug);
    assert.equal(refused.state, "failed");
    assert.match(refused.errors.join(" "), /edited by hand.*would drop: field "title".*restore film\.json from design\/base-film\.json/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "film.json"), "utf8")).title, "Approved hand fix", "a refused build leaves the hand fix on disk");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("design build: an edit the rebuild would reproduce anyway is not a loss and does not block it", () => {
  const slug = "acc-same";
  const dir = designedPackage(slug);
  try {
    assert.equal(buildDesign(slug).state, "passed");
    // Same content, different whitespace: the hash changed, nothing would be dropped.
    const text = fs.readFileSync(path.join(dir, "film.json"), "utf8");
    fs.writeFileSync(path.join(dir, "film.json"), JSON.stringify(JSON.parse(text), null, 4));
    assert.equal(filmEditState(dir), "hand-edited");
    const again = buildDesign(slug);
    assert.equal(again.state, "passed", JSON.stringify(again.errors));
    assert.equal(fs.existsSync(path.join(dir, "design/hand-edited")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
