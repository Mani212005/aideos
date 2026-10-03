/**
 * File Description: Keeps an all-check run honest about its best film. Ranks measured records by what
 * the tools reported, restores film.json from a round's backup (rollback), rolls back automatically
 * when a round scores lower than the best so far, and spots files the background agent created
 * outside videos/<slug>/ (its one hard rule). Pure ranking plus small injectable file and git steps.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { ensureGenerated } from "../pipeline/generatedFiles";
import { allCheckDir, AllCheckError, type CheckFormat, type FormatRoundRecord } from "./types";

/** A round has to be this much worse than the best one before a rollback is forced (score points). */
const ROLLBACK_MARGIN = 0.05;

// Ranks one record by what the tools measured: reviewer score, minus a penalty per failing measured gate or reviewer gate, minus a recorded frame issue.
export function rankRecord(rec: FormatRoundRecord | undefined): number {
  if (!rec) return -100;
  if (rec.review.error) return -100;
  let rank = rec.review.score ?? 0;
  rank -= rec.measured.error ? 1 : rec.measured.gateFailures.length * 0.5;
  if (rec.review.gatesPassed === false) rank -= 0.5;
  if (rec.pairwise && rec.pairwise.passed !== true) rank -= 0.5;
  if (rec.frameCheck.status === "issues") rank -= rec.frameCheck.issues.length * 0.1;
  return rank;
}

// The mean rank of one round over the given formats, or null when the round did not measure all of them.
function roundRank(records: FormatRoundRecord[], round: number, formats: CheckFormat[]): number | null {
  const ranks: number[] = [];
  for (const format of formats) {
    const rec = records.find((r) => r.round === round && r.format === format);
    if (!rec) return null;
    ranks.push(rankRecord(rec));
  }
  return ranks.reduce((a, b) => a + b, 0) / ranks.length;
}

// The formats a round measured.
function formatsOf(records: FormatRoundRecord[], round: number): CheckFormat[] {
  return (["long", "reel"] as const).filter((f) => records.some((r) => r.round === round && r.format === f));
}

/** The earlier round whose film scored best on the formats this round measured, and by how much it beats this round. */
export interface BetterRound {
  round: number;
  rank: number;
  thisRank: number;
}

// Finds an earlier round that beats `round` on the formats `round` measured, or null.
export function betterEarlierRound(records: FormatRoundRecord[], round: number): BetterRound | null {
  const formats = formatsOf(records, round);
  if (formats.length === 0) return null;
  const thisRank = roundRank(records, round, formats);
  if (thisRank === null) return null;
  let best: BetterRound | null = null;
  for (const earlier of new Set(records.map((r) => r.round))) {
    if (earlier >= round) continue;
    const rank = roundRank(records, earlier, formats);
    if (rank === null) continue;
    if (rank > thisRank + ROLLBACK_MARGIN && (!best || rank > best.rank)) best = { round: earlier, rank, thisRank };
  }
  return best;
}

// Path of the film backup taken at the start of a round.
export function backupPath(slug: string, round: number): string {
  return path.join(allCheckDir(slug), "backups", `film.round-${round}.json`);
}

// Restores film.json from the backup taken at the start of a round and regenerates the render shadows.
export function rollbackFilm(slug: string, round: number): string {
  const backup = backupPath(slug, round);
  if (!fs.existsSync(backup)) throw new AllCheckError(`no backup for round ${round} (${backup})`);
  fs.copyFileSync(backup, path.join(resolvePackageDir(slug), "film.json"));
  ensureGenerated();
  return backup;
}

/** What an automatic rollback did, for the line the agent reads. */
export interface RollbackNote {
  restoredRound: number;
  fromRound: number;
  message: string;
}

// After a round is measured: when it scored lower than an earlier round, put that round's film back and say so.
export function settleRound(slug: string, round: number, records: FormatRoundRecord[], restore: (slug: string, round: number) => string = rollbackFilm): RollbackNote | null {
  const better = betterEarlierRound(records, round);
  if (!better) return null;
  const failedCopy = backupPath(slug, round);
  restore(slug, better.round);
  return {
    restoredRound: better.round,
    fromRound: round,
    message:
      `ROLLED BACK: round ${round} scored lower (${better.thisRank.toFixed(1)}) than round ${better.round} (${better.rank.toFixed(1)}), ` +
      `so film.json is now round ${better.round}'s film again (round ${round}'s version is kept at ${failedCopy}). ` +
      `Build your next fix on top of round ${better.round}'s film and try something different from what you did in round ${round}.`,
  };
}

/** The repo paths that were already dirty or untracked when the run began. */
export interface RepoBaseline {
  paths: string[];
}

// The paths git reports as modified or untracked in the repo, relative to the repo root.
export function dirtyRepoPaths(repoRoot: string): string[] {
  const r = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) return [];
  return r.stdout
    .split("\n")
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

// Saves the dirty paths at the start of a run so later stray files can be told apart.
export function writeRepoBaseline(slug: string, repoRoot: string, list: (root: string) => string[] = dirtyRepoPaths): void {
  const baseline: RepoBaseline = { paths: list(repoRoot) };
  fs.writeFileSync(path.join(allCheckDir(slug), "repo-baseline.json"), JSON.stringify(baseline, null, 2) + "\n");
}

// The paths that appeared in the repo since the run began (outside the video package, which is gitignored anyway).
export function strayFiles(slug: string, repoRoot: string, list: (root: string) => string[] = dirtyRepoPaths): string[] {
  let baseline: RepoBaseline;
  try {
    baseline = JSON.parse(fs.readFileSync(path.join(allCheckDir(slug), "repo-baseline.json"), "utf8")) as RepoBaseline;
  } catch {
    return [];
  }
  const known = new Set(baseline.paths);
  return list(repoRoot).filter((p) => !known.has(p));
}
