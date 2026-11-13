/**
 * File Description: Behavioural tests of the Gemini verdict policy chosen by the captain (option C): the verdict is the
 * mean of the individual criteria scores, never the reviewer's own overall number; a mean within 0.5 of the 9.0 bar
 * (8.5 up to 9.5) earns exactly one second draw of the same video, and the verdict is decided on both draws. The
 * reviewer is injected through the runner, so no model is called.
 * Inputs and outputs: scripted reviewer replies -> the report's verdict, scores, draws and the number of reviewer calls.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { reviewVideo, formatReviewSummary } from "./geminiReview";
import { RUBRIC_CRITERIA } from "./rubric";
import type { AgyRunner } from "./types";
import { criteriaMean, decideReview, formatScore, needsSecondDraw } from "./verdictPolicy";

/** One scripted reply of the reviewer: every criterion scored `mean` (so the criteria mean is exactly that), with the reviewer's own overall number. */
interface Reply {
  mean: number;
  overall: number;
  /** Fails the first hard gate (the reviewer says so itself). */
  gateFails?: boolean;
  /** Leaves every criterion without a timestamp. */
  noTimestamps?: boolean;
}

// Builds the JSON a reviewer would return for a scripted reply.
function replyJson(reply: Reply): string {
  let gateFailed = false;
  const criteria = RUBRIC_CRITERIA.map((def) => {
    const fails = Boolean(reply.gateFails) && def.isGate && !gateFailed;
    if (fails) gateFailed = true;
    return {
      name: def.name, title: def.title, isGate: def.isGate,
      score: reply.mean, passed: !fails,
      evidenceTimestamps: reply.noTimestamps ? [] : ["0:12"],
      reason: reply.noTimestamps ? "Looks fine." : `Seen at 0:12: ${def.title}`,
    };
  });
  return JSON.stringify({ overallScore: reply.overall, verdict: reply.overall >= 9 ? "ACCEPT" : "REVISE", summary: "s", criteria, feedback: [] });
}

// Reviews a tiny stand-in video with a reviewer that answers the scripted replies in order and counts its calls.
async function review(replies: Reply[], opts: { failAfter?: number } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-verdict-policy-"));
  const video = path.join(dir, "video.mp4");
  fs.writeFileSync(video, Buffer.alloc(256, 7));
  let calls = 0;
  const runner: AgyRunner = async () => {
    calls++;
    if (opts.failAfter !== undefined && calls > opts.failAfter) throw new Error("agy quota exceeded");
    return replyJson(replies[Math.min(calls - 1, replies.length - 1)]);
  };
  const messages: string[] = [];
  try {
    const report = await reviewVideo(video, { runner, skipFacts: true, maxValidationAttempts: 1, onProgress: (m) => messages.push(m) });
    return { report, calls: () => calls, messages };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("policy: the verdict is the mean of the criteria scores, not the reviewer's own overall number", async () => {
  // The reviewer claims 8.0 (REVISE) but every criterion is 9.6: the mean decides.
  const up = await review([{ mean: 9.6, overall: 8.0 }]);
  assert.equal(up.report.verdict, "ACCEPT");
  assert.ok(Math.abs((up.report.criteriaMeanScore ?? 0) - 9.6) < 1e-9);
  assert.equal(up.report.overallScore, 8.0, "the reviewer's own number is kept for the record");
  // The reviewer claims 9.9 (ACCEPT) but every criterion is 8.0: the mean decides.
  const down = await review([{ mean: 8.0, overall: 9.9 }]);
  assert.equal(down.report.verdict, "REVISE");
  assert.equal(down.report.overallScore, 9.9);
  assert.ok(Math.abs((down.report.criteriaMeanScore ?? 0) - 8.0) < 1e-9);
});

test("policy: a mean outside the band is settled by one reviewer call", async () => {
  for (const mean of [9.6, 10, 8.4, 6]) {
    const result = await review([{ mean, overall: mean }]);
    assert.equal(result.calls(), 1, `mean ${mean} needs no second draw`);
    assert.equal(result.report.draws?.length, 1);
    assert.equal(result.report.verdict, mean >= 9 ? "ACCEPT" : "REVISE");
  }
});

test("policy: a mean within 0.5 of the bar (both ends included) triggers exactly one second draw, never a loop", async () => {
  for (const mean of [8.5, 8.81, 9.0, 9.2, 9.5]) {
    // Every draw stays in the band: still two calls, never three.
    const result = await review([{ mean, overall: mean }]);
    assert.equal(result.calls(), 2, `mean ${mean} earns one second draw and no more`);
    assert.equal(result.report.draws?.length, 2);
    assert.match(result.messages.join("\n"), /running one second draw/);
    assert.match(result.messages.join("\n"), /scored draw 2 of at most 2/);
  }
});

test("policy: combined decision both ways, on the 0.5.0 numbers (9.2 then 8.6 by the reviewer's own count, criteria averaging 8.81)", async () => {
  // First draw in band at 9.2, second draw's twelve criteria average 8.81 (the reviewer wrote 8.6): (9.2 + 8.81) / 2 = 9.005 >= 9.0.
  const accept = await review([{ mean: 9.2, overall: 9.2 }, { mean: 8.81, overall: 8.6 }]);
  assert.equal(accept.calls(), 2);
  assert.equal(accept.report.verdict, "ACCEPT");
  assert.ok(Math.abs((accept.report.criteriaMeanScore ?? 0) - 9.005) < 1e-9);
  assert.deepEqual(accept.report.draws?.map((d) => d.verdict), ["ACCEPT", "REVISE"], "each draw keeps what it alone would have been");
  // The same first draw with a second draw whose criteria average 8.6: (9.2 + 8.6) / 2 = 8.9 < 9.0.
  const revise = await review([{ mean: 9.2, overall: 9.2 }, { mean: 8.6, overall: 8.6 }]);
  assert.equal(revise.report.verdict, "REVISE");
  assert.ok(Math.abs((revise.report.criteriaMeanScore ?? 0) - 8.9) < 1e-9);
  // A weak first draw rescued by a strong second one: (8.6 + 9.5) / 2 = 9.05.
  const rescued = await review([{ mean: 8.6, overall: 8.6 }, { mean: 9.5, overall: 9.5 }]);
  assert.equal(rescued.report.verdict, "ACCEPT");
  assert.ok(Math.abs((rescued.report.criteriaMeanScore ?? 0) - 9.05) < 1e-9);
});

test("policy: both draws and the call count are visible in the report and the summary", async () => {
  const result = await review([{ mean: 9.2, overall: 9.2 }, { mean: 8.6, overall: 8.6 }]);
  assert.equal(result.report.draws?.[0].draw, 1);
  assert.equal(result.report.draws?.[1].draw, 2);
  assert.match(result.report.drawNote ?? "", /2 reviewer draws of the same video \(9\.20 and 8\.60\)/);
  const text = formatReviewSummary(result.report);
  assert.match(text, /Draws: 2 reviewer draws/);
  assert.match(text, /does not decide/);
  const single = await review([{ mean: 9.6, overall: 9.6 }]);
  assert.match(single.report.drawNote ?? "", /1 reviewer draw .*no second draw was needed/);
});

test("policy: the hard gates and the timestamps rule are unchanged, and a doomed draw costs no second call", async () => {
  // A failed hard gate in an in-band draw cannot be rescued by a second draw: one call, REVISE.
  const gate = await review([{ mean: 9.2, overall: 9.2, gateFails: true }]);
  assert.equal(gate.calls(), 1);
  assert.equal(gate.report.verdict, "REVISE");
  assert.ok((gate.report.criteriaMeanScore ?? 10) <= 8.5, "a failed gate never reads as the bar");
  // Missing timestamp evidence is never an ACCEPT, and costs no second call either.
  const stamps = await review([{ mean: 9.2, overall: 9.2, noTimestamps: true }]);
  assert.equal(stamps.calls(), 1);
  assert.equal(stamps.report.verdict, "REVISE");
  // A gate that fails only in the second draw still makes the combined verdict a REVISE, whatever the mean.
  const second = await review([{ mean: 9.4, overall: 9.4 }, { mean: 9.6, overall: 9.6, gateFails: true }]);
  assert.equal(second.calls(), 2);
  assert.equal(second.report.verdict, "REVISE");
  assert.equal(second.report.draws?.[1].gatesPassed, false);
});

test("policy: a second draw that cannot run leaves the review unfinished, never a pass on one in-band draw", async () => {
  await assert.rejects(
    review([{ mean: 9.2, overall: 9.2 }], { failAfter: 1 }),
    /first review draw scored 9\.20, within 0\.5 of the 9\.0 bar, and the second draw that settles it could not run: agy quota exceeded/,
  );
});

test("policy: pure rules, the band edges and score display", () => {
  assert.equal(criteriaMean([{ score: 9 }, { score: 8 }]), 8.5);
  assert.equal(needsSecondDraw({ score: 8.5, gatesPassed: true, timestampsValid: true }), true);
  assert.equal(needsSecondDraw({ score: 9.5, gatesPassed: true, timestampsValid: true }), true);
  assert.equal(needsSecondDraw({ score: 8.49, gatesPassed: true, timestampsValid: true }), false);
  assert.equal(needsSecondDraw({ score: 9.51, gatesPassed: true, timestampsValid: true }), false);
  assert.equal(decideReview([{ score: 9, gatesPassed: true, timestampsValid: true }]).verdict, "ACCEPT");
  assert.equal(decideReview([{ score: 8.99, gatesPassed: true, timestampsValid: true }]).verdict, "REVISE");
  assert.equal(decideReview([]).verdict, "REVISE");
  // A failing score never displays as the bar it missed.
  assert.equal(formatScore(8.999), "8.99");
  assert.equal(formatScore(9.005), "9.00");
});
