/**
 * File Description: Tests for the captain-attended one-time waivers of the reel's and the long film's Gemini verdicts in npm run release.
 * Inputs and outputs: fake Gemini reports and release CLI invocations -> assertions on what is waived, refused and recorded.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import type { CriterionEvaluation, GeminiReviewReport } from "../backend/geminiReview/types";
import type { GeminiWaiver, ReelGeminiWaiver } from "./releaseWaiver";
import {
  announceWaiver, requireWaiverAllowed, reviewFilmsWithGemini, reviewWithGemini, runReleaseGates, UNWAIVABLE_LONG_GATES, UNWAIVABLE_REEL_GATES,
  WAIVED_VERSION, WAIVER_RULE, waiveLongVerdict, waiveReelVerdict, waiverTagNote,
} from "./releaseWaiver";

const ROOT = path.resolve(__dirname, "..");
const NOW = new Date("2026-11-04T10:00:00.000Z");

/** Builds one reviewed criterion that cites a timestamp. */
function criterion(name: string, isGate: boolean, score = 9, passed = true): CriterionEvaluation {
  return { name, title: name, isGate, score, passed, evidenceTimestamps: ["0:10"], reason: "seen at 0:10" };
}

/** Builds a reel review that is REVISE only because the overall score and pacing fall short, as in the 0.5.0 acceptance. */
function reelReport(overrides: Partial<GeminiReviewReport> = {}, changed: Record<string, Partial<CriterionEvaluation>> = {}): GeminiReviewReport {
  const criteria = [...UNWAIVABLE_REEL_GATES.map((name) => criterion(name, true)), criterion("pacing", false, 5.5, false)]
    .map((item) => ({ ...item, ...changed[item.name] }));
  return { overallScore: 8.1, verdict: "REVISE", summary: "dead air and music ducking", criteria, feedback: [], model: "m", evaluatedAt: NOW.toISOString(), ...overrides };
}

/** Runs the release gate sequence with spies, returning what was reviewed how. */
async function sequence(reel: GeminiReviewReport, reason?: string, longFails = false) {
  const calls: string[] = [];
  const waiver = await reviewWithGemini(
    [{ format: "reel", path: "reel.mp4" }, { format: "long", path: "long.mp4" }],
    {
      strictReview: (video) => { calls.push(`strict:${video}`); if (longFails) throw new Error("Command failed: gemini-review long.mp4"); },
      reelReview: async (video) => { calls.push(`reel:${video}`); return reel; },
      print: () => calls.push("print"), now: () => NOW,
    },
    reason,
  );
  return { calls, waiver };
}

test("the waiver is applied only with the flag and a reason, and only to the reel", async () => {
  const withFlag = await sequence(reelReport(), "captain watched both");
  assert.deepEqual(withFlag.calls, ["strict:long.mp4", "reel:reel.mp4", "print"]);
  assert.equal(withFlag.waiver?.reason, "captain watched both");
  assert.equal(withFlag.waiver?.verdict, "REVISE");
  assert.equal(withFlag.waiver?.overallScore, 8.1);
  assert.equal(withFlag.waiver?.waivedAt, NOW.toISOString());

  const without = await sequence(reelReport());
  assert.deepEqual(without.calls, ["strict:long.mp4", "strict:reel.mp4"]);
  assert.equal(without.waiver, undefined);
});

test("a reel that already passes records no waiver", () => {
  assert.equal(waiveReelVerdict(reelReport({ verdict: "ACCEPT", overallScore: 9.3 }), "unused", NOW), undefined);
});

test("the waiver is refused without a reason, without a terminal and without acceptance", () => {
  const base = { version: WAIVED_VERSION, acceptance: "/film", interactive: true };
  assert.equal(requireWaiverAllowed({ ...base, reason: " fine " }), "fine");
  assert.throws(() => requireWaiverAllowed({ ...base, reason: "" }), /needs a reason/);
  assert.throws(() => requireWaiverAllowed({ ...base, reason: "   " }), /needs a reason/);
  assert.throws(() => requireWaiverAllowed({ ...base, reason: "--dry-run" }), /needs a reason/);
  assert.throws(() => requireWaiverAllowed({ ...base, reason: "ok", acceptance: undefined }), /only valid with --acceptance/);
  assert.throws(() => requireWaiverAllowed({ ...base, reason: "ok", interactive: false }), /interactive terminal/);
});

test("the waiver is accepted for the one approved version only", () => {
  assert.equal(WAIVED_VERSION, "0.5.0");
  const request = { acceptance: "/film", interactive: true, reason: "captain watched both" };
  assert.equal(requireWaiverAllowed({ ...request, version: "0.5.0" }), "captain watched both");
  for (const version of ["0.5.1", "0.6.0", "1.0.0", "9.9.9"]) {
    assert.throws(() => requireWaiverAllowed({ ...request, version }), /one-time exception for 0\.5\.0 only.*mandatory/, version);
  }
});

test("npm run release refuses the waiver before doing any work for another version, without a terminal or with an empty reason", () => {
  const script = path.join(ROOT, "scripts/release.ts");
  const run = (version: string, args: string[]) => spawnSync(path.join(ROOT, "node_modules/.bin/tsx"), [script, "release", version, ...args], { cwd: ROOT, encoding: "utf8", input: "" });
  for (const version of ["0.5.1", "1.0.0"]) {
    const other = run(version, ["--acceptance", "/dev/null", "--waive-reel-gemini", "captain watched both"]);
    assert.equal(other.status, 1, version);
    assert.match(other.stderr, /one-time exception for 0\.5\.0 only/, version);
    assert.match(other.stderr, /Gemini review of every video and reel is mandatory/, version);
    assert.doesNotMatch(other.stdout, /Acceptance evidence/, version);
  }
  const piped = run(WAIVED_VERSION, ["--acceptance", "/dev/null", "--waive-reel-gemini", "captain watched both"]);
  assert.equal(piped.status, 1);
  assert.match(piped.stderr, /requires an interactive terminal/);
  assert.doesNotMatch(piped.stdout, /Acceptance evidence/);
  const empty = run(WAIVED_VERSION, ["--acceptance", "/dev/null", "--waive-reel-gemini", ""]);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /needs a reason/);
  const noAcceptance = run(WAIVED_VERSION, ["--waive-reel-gemini", "captain watched both"]);
  assert.equal(noAcceptance.status, 1);
  assert.match(noAcceptance.stderr, /--acceptance/);
});

test("a failing hard gate or reel length still stops the release", async () => {
  for (const name of UNWAIVABLE_REEL_GATES) {
    const failing = reelReport({}, { [name]: { passed: false, score: 4 } });
    await assert.rejects(sequence(failing, "captain watched both"), /cannot be waived/, name);
  }
  const lowScore = reelReport({}, { readability: { passed: true, score: 5.9 } });
  await assert.rejects(sequence(lowScore, "captain watched both"), /cannot be waived/);
  const missing = reelReport();
  missing.criteria = missing.criteria.filter((item) => item.name !== "reel_length");
  await assert.rejects(sequence(missing, "captain watched both"), /reel_length was not reviewed/);
});

test("a reel review without timestamp evidence is not waived", async () => {
  const report = reelReport();
  report.criteria[report.criteria.length - 1] = { ...report.criteria[report.criteria.length - 1], evidenceTimestamps: [], reason: "slow" };
  await assert.rejects(sequence(report, "captain watched both"), /no timestamp evidence/);
});

test("a failing long film stops the release and the reel is never reached", async () => {
  const calls: string[] = [];
  await assert.rejects(reviewWithGemini(
    [{ format: "reel", path: "reel.mp4" }, { format: "long", path: "long.mp4" }],
    { strictReview: () => { calls.push("strict"); throw new Error("long REVISE"); }, reelReview: async () => { calls.push("reel"); return reelReport(); }, print: () => {}, now: () => NOW },
    "captain watched both",
  ), /long REVISE/);
  assert.deepEqual(calls, ["strict"]);
});

test("the waiver is recorded in the tag annotation with its reason, verdict, score and time", async () => {
  const { waiver } = await sequence(reelReport(), "captain watched both");
  const note = waiverTagNote(waiver);
  for (const part of ["captain watched both", "REVISE", "8.1/10", NOW.toISOString()]) assert.ok(note.includes(part), part);
  assert.equal(waiverTagNote(undefined), "");
});

test("nothing is promoted unless every review passes and the typed approval succeeds, waiver or not", async () => {
  const { waiver } = await sequence(reelReport(), "captain watched both");
  assert.ok(waiver);
  const order: string[] = [];
  const steps = (approve: () => Promise<void>, acceptance: () => Promise<ReelGeminiWaiver | undefined>) => ({
    acceptance, approve: async () => { order.push("approve"); await approve(); }, promote: async (w: ReelGeminiWaiver | undefined) => { order.push(`promote:${w?.reason}`); },
  });
  await runReleaseGates(steps(async () => {}, async () => waiver));
  assert.deepEqual(order, ["approve", "promote:captain watched both"]);

  order.length = 0;
  await assert.rejects(runReleaseGates(steps(async () => { throw new Error("Confirmation did not match; nothing promoted."); }, async () => waiver)), /nothing promoted/);
  assert.deepEqual(order, ["approve"]);

  order.length = 0;
  await assert.rejects(runReleaseGates(steps(async () => {}, async () => { throw new Error("cannot be waived"); })), /cannot be waived/);
  assert.deepEqual(order, []);
});

/** Builds a long film review that is REVISE with all six hard gates passing, as in the real 0.5.0 acceptance (8.6/10). */
function longReport(overrides: Partial<GeminiReviewReport> = {}, changed: Record<string, Partial<CriterionEvaluation>> = {}): GeminiReviewReport {
  const criteria = [...UNWAIVABLE_LONG_GATES.map((name) => criterion(name, true)), criterion("pacing", false, 7, true)]
    .map((item) => ({ ...item, ...changed[item.name] }));
  return { overallScore: 8.6, verdict: "REVISE", summary: "slightly slow middle", criteria, feedback: [], model: "m", evaluatedAt: NOW.toISOString(), ...overrides };
}

/** Runs the release review sequence with each film's own report and waiver reason, returning what was reviewed how. */
async function bothSequence(reports: { long: GeminiReviewReport; reel: GeminiReviewReport }, reasons: { long?: string; reel?: string }, strictFails: string[] = [], calls: string[] = []) {
  const waivers = await reviewFilmsWithGemini(
    [{ format: "reel", path: "reel.mp4" }, { format: "long", path: "long.mp4" }],
    {
      strictReview: (video) => { calls.push(`strict:${video}`); if (strictFails.includes(video)) throw new Error(`Command failed: gemini-review ${video}`); },
      review: async (video) => { calls.push(`review:${video}`); return video === "long.mp4" ? reports.long : reports.reel; },
      print: () => calls.push("print"), now: () => NOW,
    },
    reasons,
  );
  return { calls, waivers };
}

test("the long film waiver covers a REVISE with all six hard gates passing, runs the review and records the verdict", async () => {
  const { calls, waivers } = await bothSequence({ long: longReport(), reel: reelReport({ verdict: "ACCEPT", overallScore: 9.2 }) }, { long: "captain published the film" });
  assert.deepEqual(calls, ["review:long.mp4", "print", "strict:reel.mp4"]);
  assert.equal(waivers.length, 1);
  const [waiver] = waivers;
  assert.equal(waiver.kind, "long-gemini-verdict");
  assert.equal(waiver.reason, "captain published the film");
  assert.equal(waiver.verdict, "REVISE");
  assert.equal(waiver.overallScore, 8.6);
  assert.equal(waiver.waivedAt, NOW.toISOString());
  assert.equal(waiver.rule, WAIVER_RULE);
  assert.deepEqual(waiver.criteria.filter((item) => item.isGate).map((item) => item.name), [...UNWAIVABLE_LONG_GATES]);
});

test("the long film has no reel_length gate, so its six hard gates alone decide the waiver", () => {
  assert.ok(!(UNWAIVABLE_LONG_GATES as readonly string[]).includes("reel_length"));
  assert.deepEqual([...UNWAIVABLE_REEL_GATES], [...UNWAIVABLE_LONG_GATES, "reel_length"]);
  assert.ok(waiveLongVerdict(longReport(), "ok", NOW));
});

test("a long film that already passes records no waiver", async () => {
  assert.equal(waiveLongVerdict(longReport({ verdict: "ACCEPT", overallScore: 9.2 }), "unused", NOW), undefined);
  const { waivers } = await bothSequence({ long: longReport({ verdict: "ACCEPT", overallScore: 9.2 }), reel: reelReport() }, { long: "unused" });
  assert.deepEqual(waivers, []);
});

test("the long film waiver is refused for any version but 0.5.0, without a reason, without acceptance and without a terminal", () => {
  const base = { film: "long" as const, acceptance: "/film", interactive: true };
  assert.equal(requireWaiverAllowed({ ...base, version: WAIVED_VERSION, reason: " fine " }), "fine");
  for (const version of ["0.5.1", "0.6.0", "1.0.0", "0.4.9", "9.9.9"]) {
    assert.throws(() => requireWaiverAllowed({ ...base, version, reason: "ok" }), /--waive-long-gemini is a one-time exception for 0\.5\.0 only.*mandatory/, version);
  }
  for (const reason of ["", "   ", "--dry-run", undefined]) {
    assert.throws(() => requireWaiverAllowed({ ...base, version: WAIVED_VERSION, reason }), /--waive-long-gemini needs a reason.*long film's Gemini verdict/);
  }
  assert.throws(() => requireWaiverAllowed({ ...base, version: WAIVED_VERSION, reason: "ok", acceptance: undefined }), /--waive-long-gemini is only valid with --acceptance/);
  assert.throws(() => requireWaiverAllowed({ ...base, version: WAIVED_VERSION, reason: "ok", interactive: false }), /--waive-long-gemini requires an interactive terminal/);
});

test("npm run release refuses --waive-long-gemini before doing any work for another version, without a terminal, with an empty reason or without acceptance", () => {
  const script = path.join(ROOT, "scripts/release.ts");
  const run = (version: string, args: string[]) => spawnSync(path.join(ROOT, "node_modules/.bin/tsx"), [script, "release", version, ...args], { cwd: ROOT, encoding: "utf8", input: "" });
  for (const version of ["0.5.1", "0.6.0", "1.0.0"]) {
    const other = run(version, ["--acceptance", "/dev/null", "--waive-long-gemini", "captain published the film"]);
    assert.equal(other.status, 1, version);
    assert.match(other.stderr, /--waive-long-gemini is a one-time exception for 0\.5\.0 only/, version);
    assert.match(other.stderr, /Gemini review of every video and reel is mandatory/, version);
    assert.doesNotMatch(other.stdout, /Acceptance evidence/, version);
  }
  const piped = run(WAIVED_VERSION, ["--acceptance", "/dev/null", "--waive-long-gemini", "captain published the film"]);
  assert.equal(piped.status, 1);
  assert.match(piped.stderr, /--waive-long-gemini requires an interactive terminal/);
  assert.doesNotMatch(piped.stdout, /Acceptance evidence/);
  const empty = run(WAIVED_VERSION, ["--acceptance", "/dev/null", "--waive-long-gemini", ""]);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /--waive-long-gemini needs a reason/);
  const noAcceptance = run(WAIVED_VERSION, ["--waive-long-gemini", "captain published the film"]);
  assert.equal(noAcceptance.status, 1);
  assert.match(noAcceptance.stderr, /--acceptance/);
});

test("a failed hard gate, a low gate score, a missing criterion, a non-numeric score or missing timestamps stop a long film waiver", async () => {
  for (const name of UNWAIVABLE_LONG_GATES) {
    await assert.rejects(bothSequence({ long: longReport({}, { [name]: { passed: false, score: 4 } }), reel: reelReport() }, { long: "ok" }), /long film's Gemini review cannot be waived/, name);
  }
  await assert.rejects(bothSequence({ long: longReport({}, { readability: { passed: true, score: 5.9 } }), reel: reelReport() }, { long: "ok" }), /cannot be waived/);
  const missing = longReport();
  missing.criteria = missing.criteria.filter((item) => item.name !== "audio_sync");
  await assert.rejects(bothSequence({ long: missing, reel: reelReport() }, { long: "ok" }), /audio_sync was not reviewed/);
  await assert.rejects(bothSequence({ long: longReport({ overallScore: Number.NaN }), reel: reelReport() }, { long: "ok" }), /no numeric overall score/);
  const noEvidence = longReport();
  noEvidence.criteria[0] = { ...noEvidence.criteria[0], evidenceTimestamps: [], reason: "slow" };
  await assert.rejects(bothSequence({ long: noEvidence, reel: reelReport() }, { long: "ok" }), /no timestamp evidence/);
});

test("a missing long film review stops the waiver", async () => {
  await assert.rejects(reviewFilmsWithGemini(
    [{ format: "long", path: "long.mp4" }],
    { strictReview: () => {}, review: async () => { throw new Error("Gemini review of long.mp4 printed no readable report."); }, print: () => {}, now: () => NOW },
    { long: "ok" },
  ), /no readable report/);
});

test("the long waiver does not waive the reel and the reel waiver does not waive the long film", async () => {
  const reelOnly: string[] = [];
  await assert.rejects(bothSequence({ long: longReport(), reel: reelReport() }, { reel: "reel only" }, ["long.mp4"], reelOnly), /gemini-review long\.mp4/);
  assert.deepEqual(reelOnly, ["strict:long.mp4"]);

  const longOnly: string[] = [];
  await assert.rejects(bothSequence({ long: longReport(), reel: reelReport() }, { long: "long only" }, ["reel.mp4"], longOnly), /gemini-review reel\.mp4/);
  assert.deepEqual(longOnly, ["review:long.mp4", "print", "strict:reel.mp4"]);

  const neither: string[] = [];
  await assert.rejects(bothSequence({ long: longReport(), reel: reelReport() }, {}, ["long.mp4"], neither), /gemini-review long\.mp4/);
  assert.deepEqual(neither, ["strict:long.mp4"]);

  const wrongFilm = longReport();
  await assert.rejects(bothSequence({ long: wrongFilm, reel: wrongFilm }, { reel: "reel only", long: "long only" }), /reel's Gemini review cannot be waived: .*reel_length was not reviewed/);
});

test("both waivers together are independent, recorded in order and worded per film in the tag note and announcement", async () => {
  const calls: string[] = [];
  const { waivers } = await bothSequence({ long: longReport(), reel: reelReport() }, { long: "long reason", reel: "reel reason" }, [], calls);
  assert.deepEqual(calls, ["review:long.mp4", "print", "review:reel.mp4", "print"]);
  assert.deepEqual(waivers.map((waiver) => waiver.kind), ["long-gemini-verdict", "reel-gemini-verdict"]);

  const note = waiverTagNote(waivers);
  assert.ok(note.includes("Captain-attended waiver of the long film's Gemini verdict (REVISE, 8.6/10)"));
  assert.ok(note.includes("Captain-attended waiver of the reel's Gemini verdict (REVISE, 8.1/10)"));
  for (const part of ["long reason", "reel reason", NOW.toISOString()]) assert.ok(note.includes(part), part);
  assert.equal(note.split(WAIVER_RULE).length - 1, 2);
  assert.equal(waiverTagNote([]), "");
  assert.equal(waiverTagNote(waivers.slice(0, 1)).includes("reel's Gemini verdict"), false);

  const lines: string[] = [];
  for (const waiver of waivers) announceWaiver(waiver, (line) => lines.push(line));
  assert.match(lines[0], /WAIVED: the long film's Gemini verdict/);
  assert.match(lines[0], /all six hard gates, timestamp evidence, measured reviews/);
  assert.doesNotMatch(lines[0], /reel delivered length/);
  assert.match(lines[1], /WAIVED: the reel's Gemini verdict/);
  assert.match(lines[1], /all six hard gates, reel delivered length/);
});

test("the rule text keeps review mandatory elsewhere, ties the exception to 0.5.0 and says the review still runs and is recorded", () => {
  assert.match(WAIVER_RULE, /Gemini review of every video and reel stays mandatory/);
  assert.match(WAIVER_RULE, /every release other than 0\.5\.0 and for every other video/);
  assert.match(WAIVER_RULE, /one-time captain-attended exception for 0\.5\.0 only/);
  assert.match(WAIVER_RULE, /review itself still runs and its verdict is recorded/);
  assert.equal(waiveLongVerdict(longReport(), "r", NOW)?.rule, WAIVER_RULE);
});

test("the legacy reel-only review form still ignores a long film that would be waivable", async () => {
  const calls: string[] = [];
  const waiver = await reviewWithGemini(
    [{ format: "reel", path: "reel.mp4" }, { format: "long", path: "long.mp4" }],
    { strictReview: (video) => { calls.push(`strict:${video}`); }, reelReview: async (video) => { calls.push(`reel:${video}`); return reelReport(); }, print: () => {}, now: () => NOW },
    "captain watched both",
  );
  assert.equal(waiver?.kind, "reel-gemini-verdict");
  assert.deepEqual(calls, ["strict:long.mp4", "reel:reel.mp4"]);
});

test("the gate order is unchanged with both waivers: acceptance, then typed approval, then promotion with both waivers", async () => {
  const { waivers } = await bothSequence({ long: longReport(), reel: reelReport() }, { long: "long reason", reel: "reel reason" });
  const order: string[] = [];
  const steps = (approve: () => Promise<void>, acceptance: () => Promise<GeminiWaiver[]>) => ({
    acceptance, approve: async () => { order.push("approve"); await approve(); },
    promote: async (given: GeminiWaiver[]) => { order.push(`promote:${given.map((waiver) => waiver.kind).join(",")}`); },
  });
  await runReleaseGates(steps(async () => {}, async () => waivers));
  assert.deepEqual(order, ["approve", "promote:long-gemini-verdict,reel-gemini-verdict"]);

  order.length = 0;
  await assert.rejects(runReleaseGates(steps(async () => { throw new Error("Confirmation did not match; nothing promoted."); }, async () => waivers)), /nothing promoted/);
  assert.deepEqual(order, ["approve"]);

  order.length = 0;
  await assert.rejects(runReleaseGates(steps(async () => {}, async () => { throw new Error("cannot be waived"); })), /cannot be waived/);
  assert.deepEqual(order, []);
});
