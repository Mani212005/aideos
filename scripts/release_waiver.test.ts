/**
 * File Description: Tests for the captain-attended waiver of the reel's Gemini verdict in npm run release.
 * Inputs and outputs: fake Gemini reports and release CLI invocations -> assertions on what is waived, refused and recorded.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import type { CriterionEvaluation, GeminiReviewReport } from "../backend/geminiReview/types";
import type { ReelGeminiWaiver } from "./releaseWaiver";
import { requireWaiverAllowed, reviewWithGemini, runReleaseGates, UNWAIVABLE_REEL_GATES, WAIVED_VERSION, waiveReelVerdict, waiverTagNote } from "./releaseWaiver";

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
