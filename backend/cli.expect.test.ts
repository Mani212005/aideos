/**
 * File Description: Captures the stable help output shown by the Aideos CLI entry point and its review command.
 * Inputs and outputs: real backend/cli.ts help invocations -> reviewed text under test_fixtures/expect/cli/.
 * Used by: npm test (found by glob), the CI unit job.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { expectFile } from "./testSupport/expectFile";

const ROOT = path.resolve(__dirname, "..");

// Runs the real CLI help command and returns the user-visible output.
function captureHelp(args: string[]): string {
  const result = spawnSync(process.execPath, ["--import", "tsx", "backend/cli.ts", ...args], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout;
}

test("the top-level CLI help matches its reviewed output", () => {
  expectFile(captureHelp(["--help"]), "cli/aideos-backend.help.txt");
});

test("the review command help matches its reviewed output", () => {
  expectFile(captureHelp(["review", "--help"]), "cli/review.help.txt");
});
