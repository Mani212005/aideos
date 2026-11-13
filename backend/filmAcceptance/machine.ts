/**
 * File Description: The film acceptance state machine (audit machine M4). One acceptance record per film and
 * format, keyed by the content hashes of the film manifest and the rendered mp4: approval belongs to those exact
 * bytes, never to a name. The module is pure (no filesystem, no clock, no renderer) and owns every state, every
 * transition and the wording of what a state means; callers only feed it events and read the result.
 * Inputs and outputs: an AcceptanceRecord plus an AcceptanceEvent -> the next record, or an ImpossibleTransitionError.
 * Used by: backend/filmAcceptance/store.ts, backend/allCheck/round.ts, backend/allCheck/finish.ts,
 * backend/designSpec/build.ts, editor/vite.config.ts.
 */

/** The two deliverables of a film. */
export type AcceptanceFormat = "long" | "reel";

/**
 * Where the exact bytes of one format stand. `stale` is not stored: it is what any state becomes when the film on
 * disk no longer hashes to the film that was reviewed (see effectiveState), so restoring the reviewed film revives it.
 */
export type AcceptanceState =
  | "unreviewed"
  | "rendered"
  | "measured-failed"
  | "measured-passed"
  | "revise"
  | "judged"
  | "accepted";

/** A state as seen against the film that is on disk now. */
export type EffectiveState = AcceptanceState | "stale";

/** One review of one set of mp4 bytes. Several draws of the same bytes are all kept. */
export interface JudgeDraw {
  /** Identity of the draw (for example "round-3"), so replaying the same draw is a no-op, not a second draw. */
  key: string;
  mp4Hash: string;
  score: number;
  verdict: "ACCEPT" | "REVISE";
  gatesPassed: boolean;
  /** Whether the caller's own bar (target score and hard gates) was met by this draw. */
  passed: boolean;
  at: string;
}

/** The measured (deterministic) review of one set of mp4 bytes. */
export interface MeasuredResult {
  mp4Hash: string;
  passed: boolean;
  gateFailures: string[];
  at: string;
}

/** The acceptance record of one film in one format. */
export interface AcceptanceRecord {
  format: AcceptanceFormat;
  state: AcceptanceState;
  /** SHA-256 of the film manifest the current mp4 was rendered from. */
  filmHash: string | null;
  /** SHA-256 of the rendered mp4 the evidence below belongs to. */
  mp4Hash: string | null;
  measured: MeasuredResult | null;
  /** Every draw ever recorded, newest last; only draws of the current mp4Hash decide the state. */
  judged: JudgeDraw[];
  /** Whether reviews of the current mp4 bytes disagree on their verdict. */
  drawsDisagree: boolean;
  /** True only while all checks of these exact bytes passed and the caller approved them. */
  approved: boolean;
  updatedAt: string | null;
}

/** What can happen to a record. */
export type AcceptanceEvent =
  | { type: "rendered"; filmHash: string; mp4Hash: string; at: string }
  | { type: "measured"; mp4Hash: string; passed: boolean; gateFailures: string[]; at: string }
  | { type: "judged"; draw: JudgeDraw }
  | { type: "approved"; mp4Hash: string; at: string }
  | { type: "revoked"; mp4Hash: string; at: string };

/** Thrown when an event cannot happen in the record's state: a caller bug or a record that lost its evidence. */
export class ImpossibleTransitionError extends Error {
  readonly state: AcceptanceState;
  readonly event: AcceptanceEvent["type"];

  constructor(state: AcceptanceState, event: AcceptanceEvent["type"], reason: string) {
    super(`impossible acceptance transition: ${event} while ${state}: ${reason}`);
    this.name = "ImpossibleTransitionError";
    this.state = state;
    this.event = event;
  }
}

// A record with no evidence yet.
export function initialRecord(format: AcceptanceFormat): AcceptanceRecord {
  return { format, state: "unreviewed", filmHash: null, mp4Hash: null, measured: null, judged: [], drawsDisagree: false, approved: false, updatedAt: null };
}

// The draws of the bytes the record currently holds.
export function currentDraws(record: AcceptanceRecord): JudgeDraw[] {
  return record.judged.filter((draw) => draw.mp4Hash === record.mp4Hash);
}

// Reports whether draws of one set of bytes contain conflicting verdicts.
export function drawsDisagree(draws: readonly JudgeDraw[]): boolean {
  return new Set(draws.map((draw) => draw.verdict)).size > 1;
}

// Adds the current byte set's disagreement summary without changing its state or verdict.
function withDisagreement(summary: AcceptanceSummary, draws: JudgeDraw[]): AcceptanceSummary {
  const disagree = drawsDisagree(draws);
  if (!disagree) return { ...summary, drawsDisagree: false };
  const evidence = `${draws.length} reviews of these exact bytes disagree: ${draws.map((item) => `${item.verdict} ${item.score.toFixed(1)}`).join(", ")}. `;
  return { ...summary, drawsDisagree: true, message: `${evidence}${summary.message}` };
}

/**
 * The judged verdict rule over recorded draws: the newest draw of the current bytes decides. This is today's
 * behaviour ("the latest review says ACCEPT") kept as one named place, so a stricter policy (for example two
 * draws when within 0.5 of the bar) is a change to this function alone.
 */
export function judgedPasses(draws: JudgeDraw[]): boolean | null {
  return draws.length === 0 ? null : draws[draws.length - 1].passed;
}

// The state the evidence of the current bytes puts a record in; measured gates decide first, then the judge.
function settle(record: AcceptanceRecord): AcceptanceState {
  if (record.mp4Hash === null) return "unreviewed";
  if (record.measured === null) return "rendered";
  if (!record.measured.passed) return "measured-failed";
  const judged = judgedPasses(currentDraws(record));
  if (judged === null) return "measured-passed";
  if (!judged) return "revise";
  return record.approved ? "accepted" : "judged";
}

// Rejects an event that names different bytes than the record holds.
function requireBytes(record: AcceptanceRecord, event: AcceptanceEvent, mp4Hash: string): void {
  if (record.mp4Hash === null) throw new ImpossibleTransitionError(record.state, event.type, "no rendered video is recorded yet");
  if (record.mp4Hash !== mp4Hash) {
    throw new ImpossibleTransitionError(record.state, event.type, `the event is about ${mp4Hash.slice(0, 12)} but the record holds ${record.mp4Hash.slice(0, 12)}`);
  }
}

// Applies one event to a record and returns the next record; the input is never changed.
export function transition(record: AcceptanceRecord, event: AcceptanceEvent): AcceptanceRecord {
  const at = event.type === "judged" ? event.draw.at : event.at;
  let next: AcceptanceRecord;
  switch (event.type) {
    case "rendered":
      // The same bytes rendered again keep their evidence; new bytes start without any (earlier draws stay as history).
      if (record.mp4Hash === event.mp4Hash && record.filmHash === event.filmHash) return record;
      next = { ...record, filmHash: event.filmHash, mp4Hash: event.mp4Hash, measured: null, drawsDisagree: drawsDisagree(record.judged.filter((draw) => draw.mp4Hash === event.mp4Hash)), approved: false };
      break;
    case "measured":
      requireBytes(record, event, event.mp4Hash);
      next = { ...record, measured: { mp4Hash: event.mp4Hash, passed: event.passed, gateFailures: event.gateFailures, at: event.at }, approved: false };
      break;
    case "judged": {
      requireBytes(record, event, event.draw.mp4Hash);
      if (record.judged.some((draw) => draw.key === event.draw.key && draw.mp4Hash === event.draw.mp4Hash)) return record;
      const judged = [...record.judged, event.draw];
      next = { ...record, judged, drawsDisagree: drawsDisagree(judged.filter((draw) => draw.mp4Hash === record.mp4Hash)), approved: false };
      break;
    }
    case "approved": {
      requireBytes(record, event, event.mp4Hash);
      if (record.approved) return record;
      if (record.state !== "judged") {
        throw new ImpossibleTransitionError(record.state, event.type, "approval needs passed measured gates and a passing review of these exact bytes");
      }
      next = { ...record, approved: true };
      break;
    }
    case "revoked":
      requireBytes(record, event, event.mp4Hash);
      if (record.state !== "accepted") throw new ImpossibleTransitionError(record.state, event.type, "only an accepted record can be revoked");
      next = { ...record, approved: false };
      break;
  }
  return { ...next, state: settle(next), updatedAt: at };
}

// Whether the film on disk is the exact film that was reviewed (the one place that question is answered).
export function isReviewedFilm(reviewedHash: string | null, currentHash: string | null): boolean {
  return reviewedHash !== null && currentHash !== null && reviewedHash === currentHash;
}

// The state of a record against the film hash on disk now: any change to the film makes reviewed bytes stale.
export function effectiveState(record: AcceptanceRecord, currentFilmHash: string | null): EffectiveState {
  if (record.state === "unreviewed") return "unreviewed";
  return currentFilmHash !== null && currentFilmHash === record.filmHash ? record.state : "stale";
}

/** What a person is told about the thing they are about to export. */
export interface AcceptanceSummary {
  state: EffectiveState;
  /** True only when these exact bytes passed every check. */
  reviewed: boolean;
  /** True when recorded reviews of the current mp4 bytes have conflicting verdicts. */
  drawsDisagree: boolean;
  /** One plain sentence for the Export dialog and the terminal. */
  message: string;
}

// Says in plain words whether the film that would be exported is the film that was reviewed.
export function summarize(record: AcceptanceRecord | null, currentFilmHash: string | null): AcceptanceSummary {
  if (!record || record.state === "unreviewed") {
    return { state: "unreviewed", reviewed: false, drawsDisagree: false, message: "This film has not been reviewed. Run aideos all-check to measure and review it." };
  }
  const state = effectiveState(record, currentFilmHash);
  const draws = currentDraws(record);
  const score = draws.slice(-1)[0]?.score;
  const scoreText = score === undefined ? "" : ` (reviewer score ${score.toFixed(1)})`;
  const result = (reviewed: boolean, message: string): AcceptanceSummary => withDisagreement({
    state, reviewed, drawsDisagree: false, message,
  }, draws);
  switch (state) {
    case "accepted":
      return result(true, `Reviewed and accepted: the film being exported is the one that passed the measured checks and the reviewer${scoreText}.`);
    case "stale":
      return result(false, "Changed since review: film.json is no longer the film that was reviewed, so the earlier verdict does not apply. Run aideos all-check again.");
    case "revise":
      return result(false, `Reviewed, and the reviewer asked for revisions${scoreText}. Fix the findings and run aideos all-check again.`);
    case "measured-failed":
      return result(false, `The measured checks failed${record.measured?.gateFailures.length ? `: ${record.measured.gateFailures.join(", ")}` : ""}. Fix them and run aideos all-check again.`);
    case "judged":
      return result(false, "Reviewed, but the run was not finished: the frame check or another check still has to pass.");
    default:
      return result(false, "Rendered, but the review did not finish for this film. Run aideos all-check to complete it.");
  }
}

/** How film.json stands against the films the tools themselves wrote. */
export type FilmEditState = "clean" | "hand-edited" | "untracked";

/** The most tool-written film hashes remembered; enough to cover a rollback to any recent round. */
export const MAX_TOOL_WRITES = 20;

// Adds the hash of a film a tool just wrote to the ledger of tool-written films, newest last, without duplicates.
export function withToolWrite(ledger: readonly string[], hash: string): string[] {
  return [...ledger.filter((known) => known !== hash), hash].slice(-MAX_TOOL_WRITES);
}

// Tells whether film.json is something a tool wrote (clean), something else wrote (hand-edited) or unknown (no ledger yet).
export function classifyFilmEdit(ledger: readonly string[], currentHash: string | null): FilmEditState {
  if (ledger.length === 0 || currentHash === null) return "untracked";
  return ledger.includes(currentHash) ? "clean" : "hand-edited";
}

// Names what differs between a film on disk and the film a rebuild would write: top-level fields and shots by id.
export function filmDifferences(onDisk: Record<string, unknown>, rebuilt: Record<string, unknown>): string[] {
  const differences: string[] = [];
  const keys = [...new Set([...Object.keys(onDisk), ...Object.keys(rebuilt)])].filter((key) => key !== "shots").sort();
  for (const key of keys) {
    if (JSON.stringify(onDisk[key]) !== JSON.stringify(rebuilt[key])) differences.push(`field "${key}"`);
  }
  const shotsOf = (film: Record<string, unknown>): Array<{ id: string }> => (Array.isArray(film.shots) ? (film.shots as Array<{ id: string }>) : []);
  if (shotsOf(onDisk).map((shot) => shot.id).join("\0") !== shotsOf(rebuilt).map((shot) => shot.id).join("\0")) differences.push("shot order");
  const before = new Map(shotsOf(onDisk).map((shot) => [shot.id, JSON.stringify(shot)]));
  const after = new Map(shotsOf(rebuilt).map((shot) => [shot.id, JSON.stringify(shot)]));
  for (const id of [...new Set([...before.keys(), ...after.keys()])]) {
    if (before.get(id) !== after.get(id)) differences.push(`shot "${id}"`);
  }
  return differences;
}
