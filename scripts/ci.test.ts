/**
 * File Description: Tests that the CI job table, package.json scripts and GitHub workflows agree, so a workflow can never call a job or script that does not exist.
 * Inputs and outputs: scripts/ci.ts JOBS, package.json, .github/workflows/*.yml -> assertions about the single source of CI commands.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { JOBS, PR_JOBS, resolveRuff, runJobs, runStep, summaryTable } from "./ci";

const ROOT = path.resolve(__dirname, "..");
const scripts = (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
const workflowDir = path.join(ROOT, ".github/workflows");
const workflows = fs.existsSync(workflowDir) ? fs.readdirSync(workflowDir).filter((f) => f.endsWith(".yml")) : [];

test("every npm script a job runs exists in package.json", () => {
  for (const job of JOBS) {
    for (const step of job.steps) {
      if (step.cmd[0] !== "npm") continue;
      const prefixed = step.cmd[1] === "--prefix";
      if (prefixed) continue;
      const name = step.cmd[1] === "run" ? step.cmd[2] : step.cmd[1];
      assert.ok(scripts[name], `${job.id} / ${step.name} runs "npm ${name}", which package.json does not define`);
    }
  }
});

test("the pull request set only names real jobs and nightly stays out of it", () => {
  for (const id of PR_JOBS) assert.ok(JOBS.some((j) => j.id === id), `PR_JOBS names unknown job ${id}`);
  assert.ok(!PR_JOBS.includes("nightly"));
});

test("every workflow runs CI through `npm run ci -- <job>` with known jobs only", () => {
  assert.ok(workflows.length > 0, "expected at least one workflow under .github/workflows");
  const known = new Set(JOBS.map((j) => j.id));
  for (const file of workflows) {
    // Comments describe the command; only the steps that run it count.
    const text = fs.readFileSync(path.join(workflowDir, file), "utf8").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    for (const m of text.matchAll(/npm run ci(?: -- ([^\n|&]+))?/g)) {
      for (const id of (m[1] ?? "").trim().split(/\s+/).filter((a) => a && !a.startsWith("--"))) {
        assert.ok(known.has(id), `${file} runs unknown ci job "${id}"`);
      }
    }
  }
});

test("each job is run by at least one workflow, so nothing in the table is dead", () => {
  const all = workflows.map((f) => fs.readFileSync(path.join(workflowDir, f), "utf8").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n")).join("\n");
  for (const job of JOBS) assert.match(all, new RegExp(`npm run ci -- ${job.id}\\b`), `no workflow runs job ${job.id}`);
});

test("workflows are least-privilege and pin a runner image", () => {
  for (const file of workflows) {
    const text = fs.readFileSync(path.join(workflowDir, file), "utf8");
    assert.match(text, /^permissions:/m, `${file} must declare permissions`);
    assert.match(text, /runs-on: ubuntu-24\.04/, `${file} must pin ubuntu-24.04`);
    assert.doesNotMatch(text, /--yes|continue-on-error: true/, `${file} must not hide failures`);
  }
});

test("runStep reports failed, passed and skipped honestly, and runJobs rejects an unknown job", async () => {
  await assert.rejects(runJobs(["no-such-job"]), /unknown job "no-such-job"/);
  const job = { id: "t", title: "t", steps: [] };
  assert.equal((await runStep(job, { name: "ok", cmd: ["node", "-e", "process.exit(0)"] })).status, "passed");
  const failed = await runStep(job, { name: "bad", cmd: ["node", "-e", "process.exit(3)"] });
  assert.equal(failed.status, "failed");
  assert.equal(failed.note, "exit 3");
  const skipped = await runStep(job, { name: "skip", cmd: ["node", "-e", "process.exit(1)"], skip: () => "not here" });
  assert.deepEqual([skipped.status, skipped.note], ["skipped", "not here"]);
  assert.match(summaryTable([{ job: "a", step: "b", status: "passed", seconds: 1.25 }]), /\| a \| b \| passed \| 1\.3s \|/);
});

test("resolveRuff picks the first launcher that answers and returns null when none does", () => {
  assert.deepEqual(resolveRuff((cmd) => cmd[0] === "python3"), ["python3", "-m", "ruff"]);
  assert.equal(resolveRuff(() => false), null);
});
