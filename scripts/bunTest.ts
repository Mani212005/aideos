/**
 * File Description: The test runner of the bun toolchain (AIDEOS_TOOLCHAIN=bun). `bun test` is not a drop-in for
 * `node --test`: it runs every file in one process, has a 5 s default per-test timeout, sets NODE_ENV=test and no
 * NODE_TEST_CONTEXT, and loads .env files. This runner keeps the `node --test --test-concurrency=1` semantics
 * aideos relies on: it expands the same globs, then runs `bun test` once per file, one file at a time, each in its
 * own process with no per-test timeout, the bun test environment preload (backend/testSupport/bunTestEnv.ts) and the
 * fixture videos preload (backend/testSupport/fixtureVideosDir.ts), and .env loading off (bunfig.toml). bun's own
 * console output streams through; a JUnit report per file gives the totals, and the TODO and skipped names CI
 * reports (the same `{ todos, skipped }` JSON as scripts/ciTodoReporter.cjs).
 * Inputs and outputs: `[--report=<json>] [--junit-dir=<dir>] <file or glob>...` -> streamed test output, a summary,
 * the optional report file, the per-file JUnit reports kept in the optional directory, exit 0 when every file passed and 1 otherwise (a file that crashed or wrote no report counts as failed).
 * Used by: scripts/toolchain.ts testCommand (scripts/ci.ts unit, journeys and legacy steps on the bun path).
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { environment } from "../backend/env";

const ROOT = path.resolve(__dirname, "..");

/** The preloads of every file process, in order: the node:test environment first, then the fixture videos directory. */
const PRELOADS = ["backend/testSupport/bunTestEnv.ts", "backend/testSupport/fixtureVideosDir.ts"];

/** What one file's JUnit report says. */
export interface FileReport {
  tests: number;
  failures: number;
  skipped: string[];
  todos: string[];
}

/** The outcome of one test file process. */
interface FileResult extends FileReport {
  file: string;
  exitCode: number | null;
  seconds: number;
  note?: string;
}

/** Splits the arguments into the report path and the file patterns. */
export function parseRunnerArgs(args: string[]): { report?: string; junitDir?: string; patterns: string[] } {
  const usage = "usage: bun scripts/bunTest.ts [--report=<json>] [--junit-dir=<dir>] <file or glob>...";
  let report: string | undefined;
  let junitDir: string | undefined;
  const patterns: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("--report=")) report = arg.slice("--report=".length);
    else if (arg.startsWith("--junit-dir=")) junitDir = arg.slice("--junit-dir=".length);
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}; ${usage}`);
    else patterns.push(arg);
  }
  if (!patterns.length) throw new Error(`no test files given; ${usage}`);
  return { report, junitDir, patterns };
}

/** Expands each pattern relative to the repo root (a plain path must exist), sorted and without duplicates, like `node --test`. */
export function expandPatterns(patterns: string[], cwd: string = ROOT): string[] {
  const files = new Set<string>();
  for (const pattern of patterns) {
    if (/[*?[{]/.test(pattern)) {
      const matches = fs.globSync(pattern, { cwd }).filter((f) => fs.statSync(path.resolve(cwd, f)).isFile());
      if (!matches.length) throw new Error(`no test file matches ${pattern}`);
      for (const match of matches) files.add(path.resolve(cwd, match));
    } else {
      const file = path.resolve(cwd, pattern);
      if (!fs.existsSync(file)) throw new Error(`test file not found: ${pattern}`);
      files.add(file);
    }
  }
  return [...files].sort();
}

/** Decodes the five XML entities bun writes into attribute values. */
function decodeXml(text: string): string {
  return text.replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[name] ?? "");
}

/** Reads one bun JUnit report: test count, failures, and the names of skipped and TODO tests. */
export function parseJunit(xml: string): FileReport {
  const report: FileReport = { tests: 0, failures: 0, skipped: [], todos: [] };
  const testcase = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const match of xml.matchAll(testcase)) {
    const name = decodeXml(/\bname="([^"]*)"/.exec(match[1])?.[1] ?? "");
    const body = match[2] ?? "";
    report.tests += 1;
    if (/<(failure|error)\b/.test(body)) report.failures += 1;
    const skipped = /<skipped\b([^>]*)\/?>/.exec(body);
    if (skipped) (/\bmessage="TODO"/.test(skipped[1]) ? report.todos : report.skipped).push(name);
  }
  return report;
}

/** Runs one test file in its own bun process and reads its JUnit report. */
function runFile(file: string, reportDir: string, index: number): Promise<FileResult> {
  const junit = path.join(reportDir, `${String(index).padStart(3, "0")}-${path.relative(ROOT, file).replace(/[\\/]/g, "__")}.xml`);
  const args = [
    "test",
    "--timeout=0",
    ...PRELOADS.flatMap((preload) => ["--preload", path.join(ROOT, preload)]),
    "--reporter=junit",
    `--reporter-outfile=${junit}`,
    file,
  ];
  const env: NodeJS.ProcessEnv = { ...environment, AIDEOS_BUN_TEST_RUNNER: "1" };
  // Set by the preload after bun's node:test has loaded; inherited here it would switch bun to its child event stream.
  delete env.NODE_TEST_CONTEXT;
  if (environment.NODE_ENV === undefined) delete env.AIDEOS_BUN_TEST_NODE_ENV;
  else env.AIDEOS_BUN_TEST_NODE_ENV = environment.NODE_ENV;
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: "inherit", env });
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    const finish = (exitCode: number | null, note?: string) => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
      const seconds = (Date.now() - started) / 1000;
      const rel = path.relative(ROOT, file);
      if (!fs.existsSync(junit)) {
        resolve({ file: rel, exitCode, seconds, tests: 0, failures: 0, skipped: [], todos: [], note: note ?? "wrote no JUnit report" });
        return;
      }
      resolve({ file: rel, exitCode, seconds, ...parseJunit(fs.readFileSync(junit, "utf8")), note });
    };
    child.on("error", (err) => finish(null, err.message));
    child.on("close", (code, signal) => finish(code, signal ? `killed by ${signal}` : undefined));
  });
}

/** A file passed when its process exited 0, wrote a report, and the report holds no failure. */
function filePassed(result: FileResult): boolean {
  return result.exitCode === 0 && !result.note && result.failures === 0;
}

/** Entry point: run every file serially, print a summary, write the report, set the exit code. */
async function main(): Promise<void> {
  if (!process.versions.bun) throw new Error("run this with bun (bun scripts/bunTest.ts), not Node: every file process is started with the running bun");
  const { report, junitDir, patterns } = parseRunnerArgs(process.argv.slice(2));
  const files = expandPatterns(patterns);
  if (junitDir) fs.mkdirSync(junitDir, { recursive: true });
  const reportDir = junitDir ? path.resolve(junitDir) : fs.mkdtempSync(path.join(os.tmpdir(), "aideos-bun-test-"));
  const results: FileResult[] = [];
  const started = Date.now();
  try {
    for (const [index, file] of files.entries()) results.push(await runFile(file, reportDir, index));
  } finally {
    if (!junitDir) fs.rmSync(reportDir, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !filePassed(r));
  const total = (pick: (r: FileResult) => number) => results.reduce((sum, r) => sum + pick(r), 0);
  const skipped = results.flatMap((r) => r.skipped);
  const todos = results.flatMap((r) => r.todos);
  const failures = total((r) => r.failures);
  const tests = total((r) => r.tests);
  console.log("\n[bun-test] per file (one bun process each, serial):");
  for (const r of results) {
    console.log(`[bun-test] ${filePassed(r) ? "ok  " : "FAIL"} ${r.file}: ${r.tests} test(s) in ${r.seconds.toFixed(1)}s${r.exitCode !== 0 ? ` (exit ${r.exitCode})` : ""}${r.note ? ` (${r.note})` : ""}`);
  }
  for (const r of results) {
    for (const name of r.todos) console.log(`[bun-test] todo: ${name} (${r.file})`);
    for (const name of r.skipped) console.log(`[bun-test] skipped: ${name} (${r.file})`);
  }
  console.log(`# files ${results.length}`);
  console.log(`# tests ${tests}`);
  console.log(`# pass ${tests - failures - skipped.length - todos.length}`);
  console.log(`# fail ${failures}`);
  console.log(`# skipped ${skipped.length}`);
  console.log(`# todo ${todos.length}`);
  console.log(`# failed files ${failed.length}${failed.length ? `: ${failed.map((r) => r.file).join(", ")}` : ""}`);
  console.log(`# duration_s ${((Date.now() - started) / 1000).toFixed(1)}`);
  if (report) fs.writeFileSync(report, `${JSON.stringify({ todos, skipped })}\n`);
  if (failed.length) process.exitCode = 1;
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((err: unknown) => {
    console.error(`[bun-test] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
