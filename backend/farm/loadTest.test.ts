/**
 * File Description: The load test of the plan (section 5.6) at 50 and at 100 films, with 4 real worker processes on this machine: every film in both formats and every film submitted twice, workers killed mid-render in waves and replaced. The pass bar is asserted check by check: every task done or dead-lettered with a reason, zero temp bytes after the sweep, no task rendered more than its attempts, identical bytes for repeated tasks, p95 within 1.5 times the ideal.
 * Inputs and outputs: a throwaway farm root and the stand-in renderer -> a LoadTestReport whose checks must all pass.
 * Used by: npm test (Node test runner); the same harness backs `npm run farm -- load-test`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLoadReport, runLoadTest } from "./loadTest";
import { tempDir } from "../testSupport/farmFixtures";

for (const films of [50, 100]) {
  test(`load test at ${films} films: 4 workers, 10 percent killed mid-render in waves, every film submitted twice`, { timeout: 300_000 }, async () => {
    const tmp = tempDir("aideos-farm-load-");
    try {
      const report = await runLoadTest({ root: tmp.dir, films, workers: 4, renderMs: 200, killWaves: 3, killFraction: 0.1, submitTwice: true });
      console.log(`\n# load test, ${films} films\n${formatLoadReport(report)}\n`);
      for (const check of report.checks) assert.ok(check.ok, `${check.name}: ${check.detail}`);
      assert.equal(report.tasks, films * 2);
      assert.equal(report.pass, true);
    } finally {
      tmp.cleanup();
    }
  });
}
