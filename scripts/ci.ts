/**
 * File Description: The one list of CI commands. A job is a named, ordered list of steps; GitHub
 * Actions, the local validation tool (.no-mistakes.yaml) and contributors all run `npm run ci`, so
 * a green run in one place means the same commands were green everywhere. Runs every step of a job
 * even after a failure (so one run reports every problem), prints a timing table and writes it to
 * the GitHub step summary when there is one.
 * Inputs and outputs: job names (static, unit, journeys, legacy, nightly; none means the PR set) and flags -> exit code 0 when every step passed or was skipped, 1 otherwise.
 * Used by: npm run ci, .github/workflows/*.yml, .no-mistakes.yaml, scripts/ci.test.ts.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { clearGoldenOutcome, readGoldenOutcome } from "../backend/journeys/goldenResult";

const ROOT = path.resolve(__dirname, "..");

/** One command of a job. `skip` returns a reason to leave the step out on this machine. */
export interface CiStep {
  name: string;
  /** Program and arguments, run from the repo root without a shell. */
  cmd: string[];
  /** Rewrites the command just before it runs (used to find the right ruff launcher). */
  resolve?: (cmd: string[]) => string[];
  /** Extra environment for this step only. */
  env?: Record<string, string>;
  /**
   * For steps whose exit code cannot say whether anything was actually checked (the golden frames):
   * cleared before the step runs, read after it exits 0. A "not-covered" verdict is reported as
   * NOT COVERED (exit code still 0), and a step that exits 0 without leaving a verdict is a failure.
   */
  verdict?: { clear: () => void; read: () => StepVerdict | null };
  /** A reason this step does not apply here (reported as skipped, never as a pass). */
  skip?: () => string | null;
}

/** A named group of steps that runs as one GitHub job. */
export interface CiJob {
  id: string;
  title: string;
  steps: CiStep[];
}

/** What a step that checks something conditionally reports beyond its exit code. */
export type StepVerdict = { status: "passed" | "failed" } | { status: "not-covered"; reason: string };

/** The outcome of one step. */
export interface StepResult {
  job: string;
  step: string;
  status: "passed" | "failed" | "skipped" | "not-covered";
  seconds: number;
  note?: string;
}

/** The ruff release CI installs; the uvx fallback pins the same one so laptop and CI agree on formatting. */
export const RUFF_VERSION = "0.17.0";

/** True when running under GitHub Actions (or any CI that sets CI=true). */
const inCi = (): boolean => process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

/**
 * Finds a way to run ruff: an installed binary, `python3 -m ruff`, or `uvx ruff`. Returns the
 * command prefix, or null when none works.
 */
export function resolveRuff(probe: (cmd: string[]) => boolean = defaultProbe): string[] | null {
  const candidates = [["ruff"], ["python3", "-m", "ruff"], ["uvx", `ruff@${RUFF_VERSION}`]];
  return candidates.find((c) => probe([...c, "--version"])) ?? null;
}

/** Runs a command quietly and reports whether it exited 0. */
function defaultProbe(cmd: string[]): boolean {
  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: "ignore", cwd: ROOT });
  return r.status === 0;
}

/** A ruff step; without ruff it is skipped on a laptop and a failure under CI, where it must exist. */
function ruffStep(name: string, args: string[]): CiStep {
  return {
    name,
    cmd: ["ruff", ...args],
    resolve: (cmd) => {
      const prefix = resolveRuff();
      return prefix ? [...prefix, ...cmd.slice(1)] : cmd;
    },
    skip: () => (resolveRuff() || inCi() ? null : "ruff is not installed (brew install ruff, or uv tool install ruff); CI always runs it"),
  };
}

/** Rendering steps use software GL unless the caller chose one, so pixels do not depend on a GPU. */
const softwareGl = (): Record<string, string> => ({ AIDEOS_GL: process.env.AIDEOS_GL ?? "swangle" });

/** Goldens are generated on the CI platform; a laptop render is not comparable, so legacy runs on Linux only. */
export const notLinux = (): string | null =>
  process.platform === "linux"
    ? null
    : "golden frames are verified on the Linux CI platform only";

/** Lets the runner read what the golden test concluded; see backend/journeys/goldenResult.ts. */
const goldenVerdict: CiStep["verdict"] = {
  clear: clearGoldenOutcome,
  read: () => {
    const outcome = readGoldenOutcome();
    if (!outcome) return null;
    return outcome.status === "not-covered" ? { status: "not-covered", reason: outcome.reason } : { status: outcome.status };
  },
};

/** Every job. Add a step here and it runs in CI, in the local validation tool and for contributors. */
export const JOBS: CiJob[] = [
  {
    id: "static",
    title: "Static checks: headers, wiring, eslint, type-checks, editor build, ruff",
    steps: [
      { name: "ensure generated files", cmd: ["npm", "run", "ensure:generated", "--silent"] },
      { name: "file headers", cmd: ["npx", "tsx", "scripts/check_headers.ts"] },
      { name: "every test file is wired", cmd: ["npx", "tsx", "scripts/check_tests_wired.ts"] },
      { name: "eslint (src, backend, scripts, editor)", cmd: ["npx", "eslint", "src", "backend", "scripts", "editor/src"] },
      { name: "tsc root", cmd: ["npx", "tsc", "--noEmit"] },
      { name: "tsc editor app", cmd: ["npx", "tsc", "--noEmit", "-p", "editor/tsconfig.app.json"] },
      { name: "oxlint editor", cmd: ["npm", "--prefix", "editor", "run", "lint"] },
      { name: "editor build (tsc -b plus vite)", cmd: ["npm", "--prefix", "editor", "run", "build"] },
      ruffStep("ruff check", ["check", "."]),
      ruffStep("ruff format --check", ["format", "--check", "."]),
    ],
  },
  {
    id: "unit",
    title: "Unit and feature tests, fixture design checks, evals",
    steps: [
      { name: "npm test", cmd: ["npm", "test"] },
      { name: "validate hello-scene", cmd: ["npm", "run", "validate", "--silent", "--", "examples/hello-scene/film.json"] },
      {
        name: "design:check fixtures",
        cmd: ["npm", "run", "design:check", "--silent", "--", "--all"],
        env: { AIDEOS_VIDEOS_DIR: "test_fixtures/packages" },
      },
      { name: "eval:look (every committed look plan parses)", cmd: ["npm", "run", "eval:look", "--silent", "--", "--plans", "test_fixtures/packages", "--min", "0"] },
      { name: "eval:visuals", cmd: ["npm", "run", "eval:visuals", "--silent"] },
      { name: "performance:check", cmd: ["npm", "run", "performance:check", "--silent"] },
    ],
  },
  {
    id: "journeys",
    title: "Headless user journeys: real pipeline, real render, real studio",
    steps: [
      { name: "journey tests", cmd: ["npm", "run", "test:journeys"], env: softwareGl() },
      { name: "studio smoke and scrub", cmd: ["npm", "run", "smoke:studio"], env: inCi() ? { AIDEOS_SMOKE_REQUIRED: "1" } : {} },
    ],
  },
  {
    id: "legacy",
    title: "Legacy regression: golden frames of existing SVG and template films",
    steps: [{ name: "golden frames", cmd: ["npm", "run", "test:legacy"], env: softwareGl(), skip: notLinux, verdict: goldenVerdict }],
  },
  {
    id: "nightly",
    title: "Nightly: longer render with time, memory and bundle-size budgets",
    steps: [{ name: "render budget", cmd: ["npx", "tsx", "scripts/nightly_budget.ts"], env: softwareGl() }],
  },
];

/** The jobs `npm run ci` runs when none is named: everything a pull request runs. */
export const PR_JOBS = ["static", "unit", "journeys", "legacy"];

/** Runs one step to completion, streaming its output, and returns its result. */
export function runStep(job: CiJob, step: CiStep): Promise<StepResult> {
  const reason = step.skip?.() ?? null;
  if (reason) return Promise.resolve({ job: job.id, step: step.name, status: "skipped", seconds: 0, note: reason });
  step.verdict?.clear();
  const started = Date.now();
  return new Promise((resolve) => {
    const cmd = step.resolve ? step.resolve(step.cmd) : step.cmd;
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, ...step.env },
    });
    const done = (status: StepResult["status"], note?: string) =>
      resolve({ job: job.id, step: step.name, status, seconds: (Date.now() - started) / 1000, note });
    child.on("error", (err) => done("failed", err.message));
    child.on("close", (code) => {
      if (code !== 0) return done("failed", `exit ${code}`);
      if (!step.verdict) return done("passed");
      const verdict = step.verdict.read();
      if (!verdict) return done("failed", "exited 0 but left no verdict, so nothing is known to have been checked");
      if (verdict.status === "not-covered") return done("not-covered", verdict.reason);
      return done(verdict.status);
    });
  });
}

/** Formats results as a markdown table (the GitHub step summary and the terminal summary). */
export function summaryTable(results: StepResult[]): string {
  const rows = results.map((r) => `| ${r.job} | ${r.step} | ${r.status === "not-covered" ? "NOT COVERED" : r.status} | ${r.seconds.toFixed(1)}s | ${r.note ?? ""} |`);
  return ["| job | step | status | time | note |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
}

/** One sentence per step that compared nothing, for the warning annotation and the job summary. */
export function notCoveredNotices(results: StepResult[]): string[] {
  return results.filter((r) => r.status === "not-covered").map((r) => `${r.job} / ${r.step} is NOT COVERED: ${r.note}`);
}

/** Prints a group header that GitHub Actions folds, and a plain banner elsewhere. */
function banner(text: string, open: boolean): void {
  if (process.env.GITHUB_ACTIONS === "true") console.log(open ? `::group::${text}` : "::endgroup::");
  else if (open) console.log(`\n=== ${text}`);
}

/** Runs the named jobs in order and returns every step result. `bail` stops at the first failure. */
export async function runJobs(ids: string[], options: { bail?: boolean } = {}): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const id of ids) {
    const job = JOBS.find((j) => j.id === id);
    if (!job) throw new Error(`unknown job "${id}"; valid jobs: ${JOBS.map((j) => j.id).join(", ")}`);
    for (const step of job.steps) {
      banner(`${job.id}: ${step.name}`, true);
      const result = await runStep(job, step);
      banner("", false);
      results.push(result);
      console.log(`[ci] ${job.id} / ${step.name}: ${result.status === "not-covered" ? "NOT COVERED" : result.status}${result.note ? ` (${result.note})` : ""} in ${result.seconds.toFixed(1)}s`);
      if (result.status === "failed" && options.bail) return results;
    }
  }
  return results;
}

/** Entry point: parse arguments, run, print the table, set the exit code. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    for (const job of JOBS) {
      console.log(`${job.id}: ${job.title}`);
      for (const step of job.steps) console.log(`  - ${step.name}: ${step.cmd.join(" ")}`);
    }
    return;
  }
  const bail = args.includes("--bail");
  const named = args.filter((a) => !a.startsWith("--"));
  const results = await runJobs(named.length ? named : PR_JOBS, { bail });
  const table = summaryTable(results);
  console.log(`\n${table}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
  // A check that compared nothing is never a pass line: a warning annotation, a note in the job summary, exit code still 0.
  for (const text of notCoveredNotices(results)) {
    if (process.env.GITHUB_ACTIONS === "true") console.log(`::warning title=NOT COVERED::${text}`);
    else console.warn(`[ci] WARNING ${text}`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `> **NOT COVERED** - ${text}\n`);
  }
  const failed = results.filter((r) => r.status === "failed");
  if (failed.length) {
    console.error(`[ci] ${failed.length} step(s) failed: ${failed.map((r) => `${r.job}/${r.step}`).join(", ")}`);
    process.exitCode = 1;
  }
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
