/**
 * File Description: Tests for the orphan-test check, including the real repository state.
 * Inputs and outputs: glob patterns and file lists -> assertions that unwired tests are caught and wired ones are not.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findOrphans, globToRegExp, patternsFromScripts } from "./check_tests_wired";

const ROOT = path.resolve(__dirname, "..");

test("globToRegExp: ** crosses folders, * stays inside one", () => {
  assert.ok(globToRegExp("backend/**/*.test.ts").test("backend/a/b/c.test.ts"));
  assert.ok(globToRegExp("backend/**/*.test.ts").test("backend/c.test.ts"));
  assert.ok(!globToRegExp("backend/*.test.ts").test("backend/a/c.test.ts"));
  assert.ok(!globToRegExp("scripts/**/*.test.ts").test("backend/c.test.ts"));
});

test("findOrphans reports a test file no script pattern matches, and ignores non-test files", () => {
  const patterns = patternsFromScripts({ test: 'node --test "backend/**/*.test.ts" "scripts/**/*.test.ts"' });
  assert.deepEqual(patterns, ["backend/**/*.test.ts", "scripts/**/*.test.ts"]);
  assert.deepEqual(findOrphans(["src/x.test.ts", "backend/a.test.ts", "src/x.ts"], patterns), ["src/x.test.ts"]);
});

test("every test file in this repository is run by a package.json script", () => {
  const scripts = (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
  const files = execSync("git ls-files --cached --others --exclude-standard", { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  assert.deepEqual(findOrphans(files, patternsFromScripts(scripts)), []);
});
