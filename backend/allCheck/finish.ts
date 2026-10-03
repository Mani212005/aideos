/**
 * File Description: Closes an all-check run. Reads the measured rounds, decides the verdict
 * (all good only when one round holds a passing long and a passing reel rendered from the same film
 * that is still on disk), copies the final videos, writes report.md and result.json (the file the
 * calling agent waits for), releases the lock, shuts the studio down only if all-check owned it, sends
 * a notification and opens the finished videos on a pass. The side effects are injectable.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { backupPath, rankRecord, rollbackFilm, strayFiles } from "./best";
import { releaseLock } from "./lock";
import { readConfig, readRecords } from "./round";
import {
  allCheckDir,
  type AllCheckConfig,
  type AllCheckResult,
  type CheckFormat,
  type FormatRoundRecord,
} from "./types";

/** The side effects of finishing. */
export interface FinishDeps {
  now: () => Date;
  notify: (title: string, message: string) => void;
  openFiles: (files: string[]) => void;
  studioRunning: () => boolean;
  stopStudio: () => void;
  /** Puts a round's film.json back on disk; defaults to the real rollback. */
  restoreFilm?: (slug: string, round: number) => string;
  /** Files created outside videos/<slug>/ since the run began; defaults to a git comparison with the start of the run. */
  strays?: (slug: string) => string[];
}

const REPO_ROOT = path.resolve(__dirname, "../..");

// Whether something listens on the studio port.
function realStudioRunning(): boolean {
  const r = spawnSync("lsof", ["-tiTCP:3001", "-sTCP:LISTEN"], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}

// Stops the studio the way `aideos exit` does.
function realStopStudio(): void {
  const r = spawnSync("lsof", ["-tiTCP:3001", "-sTCP:LISTEN"], { encoding: "utf8" });
  for (const pid of r.stdout.split(/\s+/).filter(Boolean)) {
    try {
      process.kill(Number(pid));
    } catch {
      // Already gone.
    }
  }
}

export const REAL_FINISH_DEPS: FinishDeps = {
  now: () => new Date(),
  notify: (title, message) => {
    if (process.platform !== "darwin") return;
    try {
      execFileSync("osascript", ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`], { stdio: "ignore" });
    } catch {
      // A notification is a courtesy.
    }
  },
  openFiles: (files) => {
    const opener = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null;
    if (!opener) return;
    try {
      execFileSync(opener, files, { stdio: "ignore" });
    } catch {
      // Opening is a courtesy.
    }
  },
  studioRunning: realStudioRunning,
  stopStudio: realStopStudio,
};

// SHA-256 of a file, or null when it is missing.
function hashOrNull(file: string): string | null {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

// The latest record of a format within one round.
function pick(records: FormatRoundRecord[], round: number, format: CheckFormat): FormatRoundRecord | undefined {
  return records.find((r) => r.round === round && r.format === format);
}


/** The verdict derived from the records, before any file is written. */
export interface Verdict {
  passed: boolean;
  round: number | null;
  long: FormatRoundRecord | null;
  reel: FormatRoundRecord | null;
  stillFailing: string[];
}

// Decides the verdict: a passing round holding both formats from the film still on disk, else the best round.
export function decideVerdict(records: FormatRoundRecord[], currentFilmHash: string | null): Verdict {
  const rounds = [...new Set(records.map((r) => r.round))].sort((a, b) => b - a);
  for (const round of rounds) {
    const long = pick(records, round, "long");
    const reel = pick(records, round, "reel");
    if (long?.passed && reel?.passed && long.filmHash === reel.filmHash && long.filmHash === currentFilmHash) {
      return { passed: true, round, long, reel, stillFailing: [] };
    }
  }

  // Not all good: report the most complete, closest round honestly, with everything that still fails.
  let best: { round: number; rank: number } | null = null;
  for (const round of rounds) {
    const long = pick(records, round, "long");
    const reel = pick(records, round, "reel");
    const rank = Math.min(rankRecord(long), rankRecord(reel)) + (long && reel ? 0 : -50);
    if (!best || rank > best.rank) best = { round, rank };
  }
  if (!best) {
    return { passed: false, round: null, long: null, reel: null, stillFailing: ["no round was measured"] };
  }
  const long = pick(records, best.round, "long") ?? null;
  const reel = pick(records, best.round, "reel") ?? null;
  const stillFailing: string[] = [];
  if (!long) stillFailing.push("the long cut was never measured in this round");
  if (!reel) stillFailing.push("the reel was never measured in this round");
  for (const rec of [long, reel]) if (rec) for (const f of rec.failing) stillFailing.push(`${rec.format}: ${f}`);
  if (long && reel && long.passed && reel.passed) {
    if (long.filmHash !== reel.filmHash) stillFailing.push("the long cut and the reel were rendered from different versions of the film: re-check both in one round");
    else if (long.filmHash !== currentFilmHash) stillFailing.push("film.json changed after the last check: re-check both formats in a final round");
  }
  return { passed: false, round: best.round, long, reel, stillFailing };
}

// Builds the report.md of a run.
export function reportMarkdown(slug: string, config: AllCheckConfig, records: FormatRoundRecord[], verdict: Verdict, result: AllCheckResult): string {
  const lines = [
    `# all-check report: ${slug}`,
    ``,
    `**${verdict.passed ? "ALL GOOD" : "NOT ALL GOOD"}** - target ${config.target.toFixed(1)} on both formats, round budget ${config.rounds}, agent ${config.agent}${config.reference ? `, reference ${path.basename(config.reference)}` : ""}.`,
    ``,
    `| Round | Format | Reviewer | Measured | Cross-review | Frame check | Passed |`,
    `|---|---|---|---|---|---|---|`,
  ];
  for (const r of records) {
    lines.push(
      `| ${r.round} | ${r.format} | ${r.review.error ? "error" : `${r.review.score?.toFixed(1)} ${r.review.verdict}`} | ${r.measured.error ? "error" : r.measured.passed ? "pass" : "FAIL"} | ${r.pairwise ? (r.pairwise.error ? "error" : r.pairwise.winner) : "-"} | ${r.frameCheck.status} | ${r.passed ? "yes" : "no"} |`,
    );
  }
  lines.push(``);
  if (verdict.passed) {
    lines.push(`Verdict taken from round ${verdict.round}, where the long cut and the reel were re-checked together from the same film.`);
  } else {
    lines.push(`Best round: ${verdict.round ?? "none"}. What still fails:`, ...result.stillFailing.map((f) => `- ${f}`));
  }
  lines.push(``, `## Final videos`, `- long: ${result.long?.finalPath ?? "none"}`, `- reel: ${result.reel?.finalPath ?? "none"}`, ``);
  if (result.restoredFilmFromRound !== null) {
    lines.push(`## Film restored`, `The run did not pass, so film.json was put back to the film of round ${result.restoredFilmFromRound} (the best round) and its renders are the final videos. The version it replaced is at all-check/backups/film.before-finish.json.`, ``);
  }
  if (result.strayFiles.length) {
    lines.push(`## Rule violation: files outside videos/${slug}/`, `The agent was told to touch only the video package, but these paths appeared in the repository during the run. Review and delete them:`, ...result.strayFiles.map((f) => `- ${f}`), ``);
  }
  lines.push(`## Per-round detail`, `Each round folder holds <format>.md (feedback and failures), <format>-gemini.json, <format>-measured/review.json, <format>-frames/ and the rendered <format>.mp4.`, ``);
  return lines.join("\n");
}

// Finishes a run: verdict, final videos, report, result.json, lock, studio, notification.
export function finishRun(slug: string, deps: FinishDeps = REAL_FINISH_DEPS): AllCheckResult {
  const config = readConfig(slug);
  const dir = allCheckDir(slug);
  const records = readRecords(slug);
  const filmFile = path.join(resolvePackageDir(slug), "film.json");
  let verdict = decideVerdict(records, hashOrNull(filmFile));

  // Not all good: the package must end on the best round's film, not on the last experiment.
  let restoredFilmFromRound: number | null = null;
  const best = verdict.long ?? verdict.reel;
  if (!verdict.passed && verdict.round !== null && best && best.filmHash !== hashOrNull(filmFile) && fs.existsSync(backupPath(slug, verdict.round))) {
    fs.copyFileSync(filmFile, path.join(dir, "backups", "film.before-finish.json"));
    (deps.restoreFilm ?? rollbackFilm)(slug, verdict.round);
    restoredFilmFromRound = verdict.round;
    // Restoring the checked film can turn "edited after the last check" into a pass.
    verdict = decideVerdict(records, hashOrNull(filmFile));
  }

  const finals: Record<CheckFormat, string | null> = { long: null, reel: null };
  for (const rec of [verdict.long, verdict.reel]) {
    if (!rec || !fs.existsSync(rec.videoPath)) continue;
    const dest = path.join(dir, `final-${rec.format}.mp4`);
    fs.copyFileSync(rec.videoPath, dest);
    finals[rec.format] = dest;
  }
  const summarize = (rec: FormatRoundRecord | null) =>
    rec ? { score: rec.review.score, passed: rec.passed, round: rec.round, finalPath: finals[rec.format] } : null;

  const result: AllCheckResult = {
    schema: "aideos.all-check.result/1",
    slug,
    status: verdict.passed ? "passed" : "failed",
    target: config.target,
    roundBudget: config.rounds,
    roundsUsed: records.length ? Math.max(...records.map((r) => r.round)) : 0,
    reference: config.reference,
    agent: config.agent,
    bestRound: verdict.round,
    long: summarize(verdict.long),
    reel: summarize(verdict.reel),
    stillFailing: verdict.stillFailing,
    restoredFilmFromRound,
    strayFiles: (deps.strays ?? ((s) => strayFiles(s, REPO_ROOT)))(slug),
    reportPath: path.join(dir, "report.md"),
    startedAt: config.startedAt,
    finishedAt: deps.now().toISOString(),
  };
  fs.writeFileSync(result.reportPath, reportMarkdown(slug, config, records, verdict, result));
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(result, null, 2) + "\n");
  releaseLock(slug);

  if (!config.studioWasRunning && deps.studioRunning()) deps.stopStudio();

  const fmt = (s: AllCheckResult["long"]) => (s?.score != null ? s.score.toFixed(1) : "n/a");
  deps.notify(
    verdict.passed ? "all-check: all good" : "all-check: needs a look",
    `${slug}: long ${fmt(result.long)}, reel ${fmt(result.reel)}${verdict.passed ? "" : ` - ${verdict.stillFailing[0] ?? "see report"}`}`,
  );
  if (verdict.passed) deps.openFiles([finals.long, finals.reel].filter((f): f is string => Boolean(f)));
  return result;
}
