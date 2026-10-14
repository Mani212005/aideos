/**
 * File Description: Tests that the CI job table, package.json scripts and GitHub workflows agree, so a workflow can never call a job or script that does not exist.
 * Inputs and outputs: scripts/ci.ts JOBS, package.json, .github/workflows/*.yml -> assertions about the single source of CI commands.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { JOBS, PR_JOBS, notLinux, resolveRuff, runJobs, runStep, summaryTable } from "./ci";

const ROOT = path.resolve(__dirname, "..");
const scripts = (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
const workflowDir = path.join(ROOT, ".github/workflows");
const workflows = fs.existsSync(workflowDir) ? fs.readdirSync(workflowDir).filter((f) => f.endsWith(".yml")) : [];

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
  "continue-on-error"?: boolean;
}

interface WorkflowJob {
  name?: string;
  "runs-on"?: string;
  permissions?: unknown;
  "continue-on-error"?: boolean;
  steps?: WorkflowStep[];
}

interface WorkflowDocument {
  name?: string;
  permissions?: unknown;
  jobs?: Record<string, WorkflowJob>;
}

/** Extracts job IDs from a step's run command string when it invokes npm run ci. */
function extractCiJobIds(cmd: string): string[] {
  const ids: string[] = [];
  for (const line of cmd.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^npm run ci\b(?:\s+--\s+([^\n|&]+))?/);
    if (match) {
      const args = (match[1] ?? "").trim().split(/\s+/).filter((a) => a && !a.startsWith("-"));
      ids.push(...args);
    }
  }
  return ids;
}

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
    const doc = YAML.parse(fs.readFileSync(path.join(workflowDir, file), "utf8")) as WorkflowDocument;
    for (const [jobKey, job] of Object.entries(doc.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if (!step.run) continue;
        for (const id of extractCiJobIds(step.run)) {
          assert.ok(known.has(id), `${file} job ${jobKey} runs unknown ci job "${id}"`);
        }
      }
    }
  }
});

test("each job is run by at least one workflow, so nothing in the table is dead", () => {
  const invoked = new Set<string>();
  for (const file of workflows) {
    const doc = YAML.parse(fs.readFileSync(path.join(workflowDir, file), "utf8")) as WorkflowDocument;
    for (const job of Object.values(doc.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if (!step.run) continue;
        for (const id of extractCiJobIds(step.run)) invoked.add(id);
      }
    }
  }
  for (const job of JOBS) assert.ok(invoked.has(job.id), `no workflow runs job ${job.id}`);
});

test("workflows are least-privilege and pin a runner image", () => {
  for (const file of workflows) {
    const doc = YAML.parse(fs.readFileSync(path.join(workflowDir, file), "utf8")) as WorkflowDocument;
    assert.ok(doc.permissions, `${file} must declare top-level permissions`);
    for (const [jobKey, job] of Object.entries(doc.jobs ?? {})) {
      assert.equal(job["runs-on"], "ubuntu-24.04", `${file} job ${jobKey} must pin ubuntu-24.04`);
      assert.ok(!job["continue-on-error"], `${file} job ${jobKey} must not set continue-on-error`);
      for (const step of job.steps ?? []) {
        assert.ok(!step["continue-on-error"], `${file} job ${jobKey} step "${step.name ?? "unnamed"}" must not set continue-on-error`);
      }
    }
  }
});

test("golden comparison skips on non-Linux platforms with a clear message and has no force flag", () => {
  if (process.platform !== "linux") {
    assert.equal(notLinux(), "golden frames are verified on the Linux CI platform only");
  } else {
    assert.equal(notLinux(), null);
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
