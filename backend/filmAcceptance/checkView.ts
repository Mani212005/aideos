/**
 * File Description: The Check lens view of one film acceptance record. It turns an acceptance record and the hash of the film on screen into one short state (Draft, Fail, Pass, Old, OK), the six hard gates with a result each, and the reviewer score against the 9.0 bar. The module is pure (no filesystem, no clock) and free of Node imports, so the editor bundle and the dev server share it.
 * Inputs and outputs: an AcceptanceRecord (or null) and the current film hash -> a CheckView.
 * Used by: backend/filmAcceptance/store.ts, editor/src/screens/CheckStage.tsx.
 */

import { VERDICT_BAR, formatScore } from "../geminiReview/verdictPolicy";
import { currentDraws, effectiveState, type AcceptanceRecord } from "./machine";

/** The one word that names where a film stands. It maps unreviewed and rendered to draft, measured-failed and revise to fail, measured-passed and judged to pass, stale to old, accepted to ok. */
export type CheckState = "draft" | "fail" | "pass" | "old" | "ok";

/** What one gate or the bar reads: none means no valid result for the film on screen. */
export type CheckResult = "pass" | "fail" | "none";

/** One hard gate and its result. */
export interface CheckGate {
  key: string;
  label: string;
  result: CheckResult;
}

/** The reviewer score against the bar. */
export interface CheckScore {
  /** The score as shown to a person (for example "9.3"), or null when no reviewer score applies. */
  text: string | null;
  bar: string;
  result: CheckResult;
}

/** All the Check lens needs to draw the verdict. */
export interface CheckView {
  state: CheckState;
  gates: CheckGate[];
  score: CheckScore;
  /** True when the reviewer itself failed a hard gate: the six rows then show no result, because the reviewer does not name the gate. */
  reviewerGatesFail?: true;
}

/** The six hard gates of the measured review, in the order the lens lists them. Keys are the criterion keys in acceptance.json. */
export const HARD_GATES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "persistent-stage", label: "Stage" },
  { key: "camera", label: "Camera" },
  { key: "captions", label: "Captions" },
  { key: "readability", label: "Read" },
  { key: "overlap", label: "Overlap" },
  { key: "audio-sync", label: "Sync" },
];

/** The bar as a person reads it. */
const BAR_TEXT = VERDICT_BAR.toFixed(1);

// Gate rows with one result for every gate.
function gatesWith(result: (key: string) => CheckResult, extra: readonly string[] = []): CheckGate[] {
  const known = new Set(HARD_GATES.map((g) => g.key));
  return [
    ...HARD_GATES.map((g) => ({ key: g.key, label: g.label, result: result(g.key) })),
    // A failed gate this lens does not list (the reel length gate) still shows, by its key.
    ...extra.filter((key) => !known.has(key)).map((key) => ({ key, label: key, result: "fail" as const })),
  ];
}

// Builds the Check view of a record against the hash of the film on screen: a stale or missing record answers "Old" or "Draft" and shows no gate result, because an earlier verdict does not apply to another film.
export function checkView(record: AcceptanceRecord | null, currentFilmHash: string | null): CheckView {
  const none: CheckScore = { text: null, bar: BAR_TEXT, result: "none" };
  if (!record) return { state: "draft", gates: gatesWith(() => "none"), score: none };
  const state = effectiveState(record, currentFilmHash);
  const last = currentDraws(record).slice(-1)[0];
  const score: CheckScore =
    last === undefined ? none : { text: formatScore(last.combinedScore ?? last.score), bar: BAR_TEXT, result: last.passed ? "pass" : "fail" };
  const failed = record.measured?.gateFailures ?? [];
  switch (state) {
    case "stale":
      return { state: "old", gates: gatesWith(() => "none"), score: none };
    case "unreviewed":
    case "rendered":
      return { state: "draft", gates: gatesWith(() => "none"), score: none };
    case "measured-failed":
      return { state: "fail", gates: gatesWith((key) => (failed.includes(key) ? "fail" : "pass"), failed), score: none };
    case "measured-passed":
      return { state: "pass", gates: gatesWith(() => "pass"), score: none };
    case "revise":
      if (last?.gatesPassed === false) return { state: "fail", gates: gatesWith(() => "none"), score, reviewerGatesFail: true };
      return { state: "fail", gates: gatesWith(() => "pass"), score };
    case "judged":
      return { state: "pass", gates: gatesWith(() => "pass"), score };
    case "accepted":
      return { state: "ok", gates: gatesWith(() => "pass"), score };
  }
}
