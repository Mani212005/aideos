/**
 * File Description: Deterministic reel narration validity and estimated length gate, with no edits or trimming.
 * Inputs and outputs: unknown cut, extracted long-film constraints and explicit delivery budget -> check report.
 * Used by: aideos reel check, reel brief and the production reel stage.
 */
import { createCues, type NarrationTiming } from "../sceneKit/timing";
import { countWords, groundedNumbers, type ReelContext } from "./constraints";
import { parseReelBudget, reelCutSchema, type ReelBudget } from "./schema";

export interface ReelFinding {
  rule:
    | "schema"
    | "coverage"
    | "order"
    | "stale"
    | "phrase"
    | "numbers"
    | "drop"
    | "motion"
    | "new-words"
    | "media"
    | "length";
  severity: "error" | "warning";
  shotId?: string;
  message: string;
}
export interface ReelEstimate {
  storySec: number;
  endCardSec: number;
  totalSec: number;
  shots: Array<{ id: string; sec: number }>;
}
export interface ReelCheckReport {
  filmId: string;
  ok: boolean;
  findings: ReelFinding[];
  estimate: ReelEstimate | null;
}

const NON_CONTENT_WORDS = new Set(
  "a an and are as at be been but by can could did do does for from had has have he her hers him his how i if in into is it its me my nor of on or our ours she so than that the their theirs them then there these they this those to too us was we were what when where which who will with would you your yours".split(
    " ",
  ),
);

// Returns distinct narration words that do not occur in the long line or locked phrases.
function newContentWords(narration: string, source: string): string[] {
  const sourceWords = new Set(
    source.toLocaleLowerCase().match(/[a-z0-9]+(?:['’][a-z0-9]+)*/g) ?? [],
  );
  const seen = new Set<string>();
  return (narration.toLocaleLowerCase().match(/[a-z0-9]+(?:['’][a-z0-9]+)*/g) ?? [])
    .filter((word) => {
      if (NON_CONTENT_WORDS.has(word) || sourceWords.has(word) || seen.has(word))
        return false;
      seen.add(word);
      return true;
    });
}

// Checks every narration constraint and the estimate without changing the cut or requiring approval.
export function checkReelCut(
  raw: unknown,
  context: ReelContext,
  budgetInput: ReelBudget,
): ReelCheckReport {
  const budget = parseReelBudget(budgetInput);
  const findings: ReelFinding[] = [];
  const parsed = reelCutSchema.safeParse(raw);
  // Creates a report whose verdict can only pass when no blocking findings remain.
  const report = (estimate: ReelEstimate | null): ReelCheckReport => ({
    filmId: context.filmId,
    ok: !findings.some((f) => f.severity === "error"),
    findings,
    estimate,
  });
  if (!parsed.success) {
    for (const i of parsed.error.issues)
      findings.push({
        rule: "schema",
        severity: "error",
        message: `${i.path.join(".") || "cut"}: ${i.message}`,
      });
    return report(null);
  }
  const cut = parsed.data;
  const byId = new Map(context.shots.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const order: string[] = [];
  const estimates: ReelEstimate["shots"] = [];
  for (const entry of cut.shots) {
    const shot = byId.get(entry.id);
    if (!shot || seen.has(entry.id)) {
      findings.push({
        rule: "coverage",
        severity: "error",
        shotId: entry.id,
        message: !shot ? "unknown shot" : "shot appears more than once",
      });
      continue;
    }
    seen.add(entry.id);
    order.push(entry.id);
    if (cut.long.shots[entry.id] !== shot.hash)
      findings.push({
        rule: "stale",
        severity: "error",
        shotId: entry.id,
        message:
          "long narration changed or its hash is missing; rewrite this reel shot and update its long hash",
      });
    if ("drop" in entry) {
      if (
        shot === context.shots[0] ||
        shot === context.shots[context.shots.length - 1] ||
        shot.decisive
      ) {
        findings.push({
          rule: "drop",
          severity: "error",
          shotId: entry.id,
          message: shot.decisive
            ? "a decisive performance cannot be dropped; keep this shot condensed"
            : "keep the first-shot hook and last-shot payoff",
        });
      }
      continue;
    }
    if (shot.hasUninspectedMedia)
      findings.push({
        rule: "media",
        severity: "warning",
        shotId: entry.id,
        message: `shot ${entry.id} shows imported media; numbers inside it are not checked, review them at approval`,
      });
    const novelWords = newContentWords(
      entry.narration,
      [shot.narration, ...shot.locks.map((lock) => lock.phrase)].join(" "),
    );
    if (novelWords.length)
      findings.push({
        rule: "new-words",
        severity: "warning",
        shotId: entry.id,
        message: `review new content words against the long narration and locked phrases: ${novelWords.join(", ")}`,
      });
    const sec = countWords(entry.narration) / context.wordsPerSec;
    estimates.push({ id: entry.id, sec });
    if (sec + 1e-6 < shot.minSec)
      findings.push({
        rule: "motion",
        severity: "error",
        shotId: entry.id,
        message: `estimated ${sec.toFixed(2)} s is below the camera's ${shot.minSec.toFixed(2)} s motion floor; keep more narration`,
      });
    const tokens = entry.narration.split(/\s+/);
    const timing: NarrationTiming = {
      totalDurationSec: sec,
      segments: [
        {
          shotId: entry.id,
          text: entry.narration,
          startSec: 0,
          durationSec: sec,
          words: tokens.map((word, i) => ({
            word,
            startSec: (i * sec) / tokens.length,
            endSec: ((i + 1) * sec) / tokens.length,
          })),
        },
      ],
    };
    const cues = createCues(timing, context.fps);
    for (const lock of shot.locks) {
      try {
        if (lock.unique) cues.wordOnce(entry.id, lock.phrase);
        else cues.word(entry.id, lock.phrase);
      } catch (err) {
        findings.push({
          rule: "phrase",
          severity: "error",
          shotId: entry.id,
          message: `${lock.source}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    // The shared picture is also source material: carried labels may need to be re-spoken in a shorter cut.
    const originalNumbers = new Set([
      ...groundedNumbers(shot.narration),
      ...shot.onScreenNumbers,
    ]);
    const said = new Set(groundedNumbers(entry.narration));
    for (const n of said)
      if (!originalNumbers.has(n))
        findings.push({
          rule: "numbers",
          severity: "error",
          shotId: entry.id,
          message: `new number ${n} is absent from this shot's long narration and shared picture`,
        });
    for (const n of shot.onScreenNumbers)
      if (!said.has(n))
        findings.push({
          rule: "numbers",
          severity: "error",
          shotId: entry.id,
          message: `on-screen number ${n} must still be spoken in this shot`,
        });
  }
  for (const shot of context.shots)
    if (!seen.has(shot.id))
      findings.push({
        rule: "coverage",
        severity: "error",
        shotId: shot.id,
        message:
          "missing shot; include narration or an explicit drop with a reason",
      });
  for (const id of Object.keys(cut.long.shots))
    if (!byId.has(id))
      findings.push({
        rule: "stale",
        severity: "error",
        shotId: id,
        message: "long hash names a removed or unknown shot",
      });
  if (order.some((id, i) => context.shots[i]?.id !== id))
    findings.push({
      rule: "order",
      severity: "error",
      message:
        "keep every long shot in its original order, including explicit drops",
    });
  const storySec = estimates.reduce((sum, s) => sum + s.sec, 0);
  const estimate = {
    storySec,
    endCardSec: budget.endCardSec,
    totalSec: storySec + budget.endCardSec,
    shots: estimates,
  };
  if (estimate.totalSec > budget.maxSec + 1e-6) {
    const longest = [...estimates]
      .sort((a, b) => b.sec - a.sec)
      .slice(0, 3)
      .map((s) => `${s.id} (${s.sec.toFixed(1)} s)`)
      .join(", ");
    findings.push({
      rule: "length",
      severity: "error",
      message: `reel estimate ${estimate.totalSec.toFixed(1)} s (story ${storySec.toFixed(1)} s + end card ${budget.endCardSec.toFixed(1)} s), ${(estimate.totalSec - budget.maxSec).toFixed(1)} s over the ${budget.maxSec.toFixed(1)} s cap; shorten ${longest}`,
    });
  } else if (estimate.totalSec > budget.targetSec + 1e-6)
    findings.push({
      rule: "length",
      severity: "warning",
      message: `reel estimate ${estimate.totalSec.toFixed(1)} s exceeds the ${budget.targetSec.toFixed(1)} s target; leave headroom for synthesis variance`,
    });
  return report(estimate);
}

// Formats failures and actionable shot names for an author at the terminal.
export function formatReelReport(report: ReelCheckReport): string {
  const length = report.estimate
    ? ` - estimated ${report.estimate.totalSec.toFixed(1)} s including end card`
    : "";
  return [
    `${report.ok ? "PASS" : "FAIL"} reel ${report.filmId}${length}`,
    ...report.findings.map(
      (f) =>
        `${f.severity}: ${f.rule}${f.shotId ? ` / ${f.shotId}` : ""}: ${f.message}`,
    ),
  ].join("\n");
}
