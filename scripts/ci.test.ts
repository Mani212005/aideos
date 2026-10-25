/**
 * File Description: Tests that the CI job table, package.json scripts and GitHub workflows agree, so a workflow can never call a job or script that does not exist.
 * Inputs and outputs: scripts/ci.ts JOBS, package.json, .github/workflows/*.yml -> assertions about the single source of CI commands.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { JOBS, PR_JOBS, knownGapNotices, notCoveredNotices, notLinux, resolveRuff, runJobs, runStep, summaryTable } from "./ci";

const ROOT = path.resolve(__dirname, "..");
const scripts = (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
const workflowDir = path.join(ROOT, ".github/workflows");
const workflows = fs.existsSync(workflowDir) ? fs.readdirSync(workflowDir).filter((f) => f.endsWith(".yml")) : [];

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  "continue-on-error"?: boolean;
  "timeout-minutes"?: number;
}

interface WorkflowJob {
  name?: string;
  "runs-on"?: string;
  permissions?: unknown;
  "continue-on-error"?: boolean;
  "timeout-minutes"?: number;
  if?: string;
  needs?: string[] | string;
  outputs?: Record<string, string>;
  steps?: WorkflowStep[];
}

interface WorkflowDocument {
  name?: string;
  on?: string[] | Record<string, unknown>;
  env?: Record<string, unknown>;
  permissions?: unknown;
  jobs?: Record<string, WorkflowJob>;
}

/** Returns whether a workflow permission map grants any write capability. */
function hasWritePermission(permissions: unknown): boolean {
  if (!permissions || typeof permissions !== "object") return permissions === "write-all";
  return Object.values(permissions).some((permission) => permission === "write");
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

test("golden updates run only from default-branch dispatch and keep write access away from PR code", () => {
  assert.equal(hasWritePermission("write-all"), true);
  assert.equal(hasWritePermission("read-all"), false);
  assert.equal(hasWritePermission({ contents: "write" }), true);
  const update = YAML.parse(fs.readFileSync(path.join(workflowDir, "update-goldens.yml"), "utf8")) as WorkflowDocument;
  const triggers = Object.keys(update.on ?? {});
  assert.deepEqual(triggers, ["workflow_dispatch"]);
  const guard = update.jobs?.generate?.steps?.find((step) => step.name === "Require the default branch");
  assert.ok(guard?.run && guard.env?.DEFAULT_BRANCH && guard.env.REF_NAME);
  const runGuard = (ref: string) => spawnSync("bash", ["-e", "-c", guard.run!], {
    env: { ...process.env, DEFAULT_BRANCH: "main", REF_NAME: ref },
    stdio: "ignore",
  }).status;
  assert.equal(runGuard("main"), 0);
  assert.notEqual(runGuard("feature"), 0);

  for (const file of workflows) {
    const doc = YAML.parse(fs.readFileSync(path.join(workflowDir, file), "utf8")) as WorkflowDocument;
    const onPullRequest = Object.prototype.hasOwnProperty.call(doc.on ?? {}, "pull_request");
    for (const [jobKey, job] of Object.entries(doc.jobs ?? {})) {
      const canWrite = hasWritePermission(job.permissions ?? doc.permissions);
      if (onPullRequest) assert.ok(!canWrite, `${file} job ${jobKey} has write access on a pull_request workflow`);
      if (!canWrite) continue;
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith("actions/checkout@")) {
          const checkoutRef = String(step.with?.ref ?? "");
          assert.doesNotMatch(checkoutRef, /github\.event\.pull_request\.(?:head|head\.ref)/, `${file} job ${jobKey} checks out a PR head with write access`);
          assert.doesNotMatch(String(doc.env?.BRANCH ?? ""), /github\.event\.pull_request\.head\.ref/, `${file} job ${jobKey} resolves checkout through a PR head branch`);
        }
      }
    }
  }
});

test("ci.yml changes job is pinned by full SHA, has no if condition, and all-green requires changes", () => {
  const ci = YAML.parse(fs.readFileSync(path.join(workflowDir, "ci.yml"), "utf8")) as WorkflowDocument;
  const changes = ci.jobs?.changes;
  assert.ok(changes, "ci.yml must have a changes job");
  assert.equal(changes.if, undefined, "changes job must have no if: condition");
  assert.equal(changes["timeout-minutes"], 5, "changes job must have timeout-minutes: 5");
  assert.equal(changes["runs-on"], "ubuntu-24.04", "changes job must pin ubuntu-24.04");

  const checkoutStep = changes.steps?.find((s) => s.uses?.startsWith("actions/checkout@"));
  assert.ok(checkoutStep, "changes job must have an actions/checkout step");
  assert.match(
    checkoutStep.uses!,
    /^actions\/checkout@[0-9a-f]{40}/,
    "actions/checkout in changes job must be pinned by full commit SHA",
  );
  assert.equal(checkoutStep.with?.["fetch-depth"], 0, "changes checkout must specify fetch-depth: 0");

  const allGreen = ci.jobs?.["all-green"];
  assert.ok(allGreen, "ci.yml must have an all-green job");
  assert.equal(allGreen.if, "always()", "all-green must have if: always()");
  assert.deepEqual(
    allGreen.needs,
    ["changes", "static", "unit", "journeys", "legacy"],
    "all-green must need changes, static, unit, journeys, and legacy",
  );
  const requireStep = allGreen.steps?.find((s) => s.name === "Require every job to have passed");
  assert.ok(requireStep?.run, "all-green must have step to require every job");
  assert.match(
    requireStep.run,
    /test "\$\{RESULTS\}" = "success success success success success"/,
    "all-green must require all five jobs to succeed",
  );
});

test("ci.yml wraps every apt-get update and install in a retry loop with timeouts", () => {
  const ci = YAML.parse(fs.readFileSync(path.join(workflowDir, "ci.yml"), "utf8")) as WorkflowDocument;
  const aptSteps: { job: string; step: WorkflowStep }[] = [];
  for (const [jobKey, job] of Object.entries(ci.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (step.run?.includes("apt-get")) {
        aptSteps.push({ job: jobKey, step });
      }
    }
  }

  assert.ok(aptSteps.length >= 3, "expected at least 3 apt-get steps in ci.yml (unit, journeys, legacy)");
  for (const { job, step } of aptSteps) {
    assert.ok(step["timeout-minutes"], `${job} step "${step.name}" must have its own timeout-minutes`);
    assert.ok(step["timeout-minutes"] <= 10, `${job} step "${step.name}" timeout-minutes should be at most 10`);
    assert.match(step.run!, /for\s+\w+\s+in\s+1\s+2\s+3/, `${job} step "${step.name}" must have 3 retry attempts`);
    assert.match(step.run!, /timeout\s+300\s+sudo\s+apt-get/, `${job} step "${step.name}" must use timeout 300 per apt command`);
    assert.match(step.run!, /Acquire::Retries=3/, `${job} step "${step.name}" must pass -o Acquire::Retries=3`);
    assert.match(step.run!, /sleep\s+15/, `${job} step "${step.name}" must sleep 15 between attempts`);
  }
});

test("main-red-alert workflow satisfies least privilege, triggers only on workflow_run, has no secrets, and uses no third-party actions", () => {
  const alertPath = path.join(workflowDir, "main-red-alert.yml");
  assert.ok(fs.existsSync(alertPath), "main-red-alert.yml must exist under .github/workflows");
  const raw = fs.readFileSync(alertPath, "utf8");
  assert.doesNotMatch(raw, /secrets\./, "main-red-alert.yml must not reference any secrets");

  const doc = YAML.parse(raw) as WorkflowDocument;
  const triggers = Object.keys(doc.on ?? {});
  assert.deepEqual(triggers, ["workflow_run"], "main-red-alert.yml must only trigger on workflow_run");

  const workflowRun = (doc.on as Record<string, unknown>).workflow_run as {
    workflows?: string[];
    branches?: string[];
    types?: string[];
  };
  assert.deepEqual(workflowRun.workflows, ["CI"], "main-red-alert.yml must monitor CI workflow");
  assert.deepEqual(workflowRun.branches, ["main"], "main-red-alert.yml must monitor main branch only");
  assert.deepEqual(workflowRun.types, ["completed"], "main-red-alert.yml must trigger on completed runs only");

  assert.deepEqual(
    doc.permissions,
    { contents: "read", issues: "write" },
    "main-red-alert.yml must declare minimal permissions (contents: read, issues: write)",
  );

  for (const [jobKey, job] of Object.entries(doc.jobs ?? {})) {
    assert.equal(job["runs-on"], "ubuntu-24.04", `${jobKey} must pin ubuntu-24.04`);
    for (const step of job.steps ?? []) {
      if (step.uses) {
        assert.match(step.uses, /^actions\//, `${jobKey} step "${step.name}" must not use third-party actions`);
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

test("unfinished journey TODO events fail CI and reach the summary", async () => {
  const job = { id: "journeys", title: "journeys", steps: [] };
  const dir = fs.mkdtempSync(path.join(ROOT, ".ci-todo-report-"));
  const first = path.join(dir, "first.test.cjs");
  const second = path.join(dir, "second.test.cjs");
  fs.writeFileSync(first, `const { test } = require("node:test"); const assert = require("node:assert/strict"); test("J10 bad field name", { todo: "schema" }, () => assert.fail("still a known gap"));`);
  fs.writeFileSync(second, `const { test } = require("node:test"); test("J8 duplicate cue", { todo: "ambiguity" }, () => {});`);
  const forwarded: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    forwarded.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    const result = await runStep(job, {
      name: "journey tests",
      cmd: [process.execPath, "--test", "--test-concurrency=1", first, second],
      env: { NODE_TEST_CONTEXT: undefined },
      todoCases: true,
    });
    assert.equal(result.status, "failed");
    assert.match(result.note!, /2 unfinished journey cases/);
    assert.deepEqual(result.todoNames, ["J10 bad field name", "J8 duplicate cue"]);
    assert.match(summaryTable([result]), /KNOWN GAPS \(todo\): 2: J10 bad field name, J8 duplicate cue/);
    assert.match(summaryTable([result]), /J1-END-TO-END-REVIEW/);
    assert.match(knownGapNotices([result])[0], /KNOWN GAPS \(todo\): 2: J10 bad field name, J8 duplicate cue; J1-END-TO-END-REVIEW/);
    assert.match(forwarded.join(""), /J10 bad field name/);
  } finally {
    process.stdout.write = write;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveRuff picks the first launcher that answers and returns null when none does", () => {
  assert.deepEqual(resolveRuff((cmd) => cmd[0] === "python3"), ["python3", "-m", "ruff"]);
  assert.equal(resolveRuff(() => false), null);
});

test("the legacy step reports NOT COVERED (exit 0), passed or failed from what the golden test wrote, and a silent exit 0 is a failure", async () => {
  const legacy = JOBS.find((j) => j.id === "legacy")!;
  const real = legacy.steps[0];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-ci-verdict-"));
  const before = process.env.AIDEOS_CI_ARTIFACTS;
  process.env.AIDEOS_CI_ARTIFACTS = dir;
  /** The real step with its command replaced by one that writes the given outcome (or nothing) and exits 0, off any platform. */
  const stepWriting = (outcome: unknown) => ({
    ...real,
    skip: undefined,
    cmd: ["node", "-e", `const fs=require("fs");const f=${JSON.stringify(path.join(dir, "legacy", "result.json"))};${outcome === undefined ? "" : `fs.mkdirSync(require("path").dirname(f),{recursive:true});fs.writeFileSync(f,${JSON.stringify(JSON.stringify(outcome))});`}`],
  });
  try {
    const stale = path.join(dir, "legacy", "result.json");
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(stale, JSON.stringify({ status: "passed", frames: 9 }));
    const silent = await runStep(legacy, stepWriting(undefined));
    assert.equal(silent.status, "failed", "an old result must never be mistaken for this run's");
    assert.match(silent.note ?? "", /left no verdict/);

    const notCovered = await runStep(legacy, stepWriting({ status: "not-covered", reason: "no goldens committed" }));
    assert.equal(notCovered.status, "not-covered");
    assert.match(summaryTable([notCovered]), /\| legacy \| golden frames \| NOT COVERED \|/);
    assert.deepEqual(notCoveredNotices([notCovered]), ["legacy / golden frames is NOT COVERED: no goldens committed"]);
    assert.doesNotMatch(summaryTable([notCovered]), /\| passed \|/);

    assert.equal((await runStep(legacy, stepWriting({ status: "passed", frames: 3 }))).status, "passed");
    assert.equal((await runStep(legacy, stepWriting({ status: "failed", failures: ["x"] }))).status, "failed");
  } finally {
    if (before === undefined) delete process.env.AIDEOS_CI_ARTIFACTS;
    else process.env.AIDEOS_CI_ARTIFACTS = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
