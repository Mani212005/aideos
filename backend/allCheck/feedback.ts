/**
 * File Description: Delivers the review result of an all-check round (the REVISE verdict and its findings)
 * to the agent session the user started the film with, as a prompt in that session's Herdr pane, so the
 * fix happens there with that agent's own harness and model and no new agent is started. When the round
 * runs inside that very session the command output already is the delivery, so nothing is typed twice.
 * Inputs and outputs: slug, round records and the recorded origin session -> a prompt in the origin pane, or a stated reason it was not sent.
 * Used by: backend/allCheck/cli.ts.
 */

import { readOriginSession } from "../agentSession/originSession";
import { herdrSocket, herdrJson, paneInfo, realHerdr, type HerdrRun } from "./herdr";
import type { FormatRoundRecord } from "./types";
import { z } from "zod";

/** The outside world delivery touches; the defaults are real. */
export interface FeedbackDeps {
  herdr: HerdrRun;
  env: NodeJS.ProcessEnv;
}

/** What delivery did. */
export interface FeedbackOutcome {
  delivered: boolean;
  /** Plain words on why it was or was not sent. */
  reason: string;
}

// Formats the failing records as the message the originating session reads and acts on.
export function formatFeedbackMessage(slug: string, records: FormatRoundRecord[]): string {
  const failing = records.filter((r) => !r.passed);
  const lines = [`all-check review for "${slug}": ${failing.length ? "REVISE" : "passed"}. Fix it in this session, then run the next round (aideos all-check round ${slug} --format <long|reel|both>).`];
  for (const rec of failing) {
    const score = rec.review.score === null ? "n/a" : rec.review.score.toFixed(1);
    lines.push(`[${rec.format}] round ${rec.round}: reviewer ${rec.review.error ? "ERROR" : `${score} ${rec.review.verdict}`}, measured ${rec.measured.error ? "ERROR" : rec.measured.passed ? "pass" : "FAIL"}`);
    for (const f of rec.failing) lines.push(`  - ${f}`);
    for (const fb of rec.review.feedback.slice(0, 8)) lines.push(`  - ${fb.timestamp ? `${fb.timestamp}: ` : ""}${fb.issue} (${fb.recommendation})`);
    lines.push(`  details: ${rec.videoPath.replace(/\.mp4$/, ".md")}`);
  }
  return lines.join("\n");
}

// Sends the review result to the originating session's pane when that session is alive and is not the caller.
export function deliverFeedbackToOrigin(
  slug: string,
  records: FormatRoundRecord[],
  deps: FeedbackDeps = { herdr: realHerdr, env: process.env },
): FeedbackOutcome {
  if (records.every((r) => r.passed)) return { delivered: false, reason: "the round passed: nothing to revise" };
  const origin = readOriginSession(slug);
  if (!origin?.herdr) return { delivered: false, reason: "no originating session pane is recorded for this film" };
  const here = deps.env.HERDR_ENV === "1" ? deps.env.HERDR_PANE_ID : undefined;
  if (here && here === origin.herdr.paneId && herdrSocket(deps.env) === origin.herdr.socketPath) {
    return { delivered: false, reason: "this round ran in the originating session itself: its output is the delivery" };
  }
  let pane: ReturnType<typeof paneInfo>;
  try {
    pane = paneInfo(origin.herdr, deps.herdr);
  } catch (err) {
    return { delivered: false, reason: `cannot reach the originating session's Herdr pane ${origin.herdr.paneId}: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!pane?.agent) return { delivered: false, reason: `the originating session's pane ${origin.herdr.paneId} is gone or no longer runs an agent` };
  try {
    herdrJson(deps.herdr, origin.herdr.socketPath, ["agent", "prompt", origin.herdr.paneId, formatFeedbackMessage(slug, records)], z.object({ result: z.unknown() }).passthrough());
  } catch (err) {
    return { delivered: false, reason: `sending to the originating session failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { delivered: true, reason: `sent to the ${pane.agent} session that started the film (pane ${origin.herdr.paneId})` };
}
