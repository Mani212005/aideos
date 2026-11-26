/**
 * File Description: Expect tests for the bun toolchain's test runner helpers: the JUnit reader against a real bun 1.4.4
 * report of every outcome (pass, fail, skip by option and by context, todo by option and bare, nested describe,
 * entity-encoded names), argument parsing, and glob expansion with node --test's refusal of a pattern or file that matches nothing.
 * Inputs and outputs: test_fixtures/bunJunit/kinds.xml and the repo's own test files -> assertions on parseJunit,
 * parseRunnerArgs and expandPatterns.
 * Used by: npm test (and the bun path's unit job).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { expandPatterns, parseJunit, parseRunnerArgs } from "./bunTest";

const ROOT = path.resolve(__dirname, "..");

test("parseJunit counts every testcase of a real bun report and splits skipped from todo by bun's TODO marker", () => {
  // Written by `bun test --reporter=junit` 1.4.4 for one node:test file with every outcome; only the hostname was replaced.
  const report = parseJunit(fs.readFileSync(path.join(ROOT, "test_fixtures/bunJunit/kinds.xml"), "utf8"));
  assert.deepEqual(report, {
    tests: 8,
    failures: 2,
    skipped: ["skipped by option", "skipped by context"],
    todos: ["todo by option", "bare todo"],
  });
});

test("parseJunit decodes entity-encoded names and reads an empty report as no tests", () => {
  const xml = '<testsuites><testsuite name="a"><testcase name="a &lt;b&gt; &amp; &quot;c&quot; &apos;d&apos;" classname=""><skipped message="TODO" /></testcase></testsuite></testsuites>';
  assert.deepEqual(parseJunit(xml).todos, [`a <b> & "c" 'd'`]);
  assert.deepEqual(parseJunit('<testsuites name="bun test" tests="0"></testsuites>'), { tests: 0, failures: 0, skipped: [], todos: [] });
});

test("parseRunnerArgs takes the report and JUnit options, and refuses unknown options and an empty file list", () => {
  assert.deepEqual(parseRunnerArgs(["--report=/tmp/r.json", "--junit-dir=/tmp/j", "a.test.ts", "b/**/*.test.ts"]), {
    report: "/tmp/r.json",
    junitDir: "/tmp/j",
    patterns: ["a.test.ts", "b/**/*.test.ts"],
  });
  assert.throws(() => parseRunnerArgs(["--timeout=5", "a.test.ts"]), /unknown option --timeout=5/);
  assert.throws(() => parseRunnerArgs(["--report=/tmp/r.json"]), /no test files given/);
});

test("expandPatterns gives every matching file once, sorted, and refuses a glob or a path that matches nothing", () => {
  const files = expandPatterns(["scripts/**/*.test.ts", "scripts/bunTest.test.ts"], ROOT);
  assert.ok(files.includes(path.join(ROOT, "scripts/bunTest.test.ts")));
  assert.equal(new Set(files).size, files.length, "a file matched twice runs once");
  assert.deepEqual(files, [...files].sort());
  assert.ok(files.every((f) => f.endsWith(".test.ts") && f.startsWith(path.join(ROOT, "scripts") + path.sep)));
  assert.throws(() => expandPatterns(["scripts/**/*.nothing.ts"], ROOT), /no test file matches/);
  assert.throws(() => expandPatterns(["scripts/missing.test.ts"], ROOT), /test file not found/);
});
