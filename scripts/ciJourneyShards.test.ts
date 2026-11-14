/**
 * File Description: Tests that the journeys CI shards cover every journey file exactly once, stay balanced within 10 percent, are deterministic, still assign a journey that has no weight, and that the workflow matrix, the evidence names and the single all-green check agree with the shard plan.
 * Inputs and outputs: the real backend/journeys/*.journey.ts files, scripts/ci.ts JOBS and .github/workflows/ci.yml -> assertions about the shard partition.
 * Used by: npm test (captain decision: journeys CI is sharded, every journey runs in exactly one shard).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  DEFAULT_WEIGHT_SECONDS,
  JOURNEY_WEIGHTS_SECONDS,
  SMOKE_ITEM,
  listJourneyFiles,
  parseShardSpec,
  partitionItems,
  planJourneyShard,
  planShard,
} from "./ciJourneyShards";
import { JOBS, parseArgs } from "./ci";

const ROOT = path.resolve(__dirname, "..");
const SHARDS = 3;

/** Plans every shard of `total` over the journey files on disk (or the given list). */
function planAll(total: number, files = listJourneyFiles(ROOT), weights = JOURNEY_WEIGHTS_SECONDS) {
  return Array.from({ length: total }, (_, i) => planShard({ index: i + 1, total }, files, weights));
}

test("every real journey file runs in exactly one shard, for 1 to 6 shards", () => {
  const files = listJourneyFiles(ROOT);
  assert.ok(files.length >= 20, `expected the real journey list, found ${files.length}`);
  for (let total = 1; total <= 6; total++) {
    const plans = planAll(total, files);
    const placed = plans.flatMap((p) => p.journeyFiles);
    assert.deepEqual([...placed].sort(), files, `${total} shards must run every journey file once and only once`);
    assert.equal(new Set(placed).size, placed.length, `${total} shards must be disjoint`);
    assert.equal(plans.filter((p) => p.runsSmoke).length, 1, `${total} shards must run the studio smoke step exactly once`);
  }
});

test("the journey file list is the same set the journey glob selects", () => {
  const onDisk = fs
    .readdirSync(path.join(ROOT, "backend/journeys"), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".journey.ts"))
    .map((e) => path.relative(ROOT, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .sort();
  assert.deepEqual(listJourneyFiles(ROOT), onDisk);
});

test("a journey added without a weight is still assigned to one shard and costed at the default", () => {
  const files = [...listJourneyFiles(ROOT), "backend/journeys/j99_brand_new.journey.ts"];
  const plans = planAll(SHARDS, files);
  const owners = plans.filter((p) => p.journeyFiles.includes("backend/journeys/j99_brand_new.journey.ts"));
  assert.equal(owners.length, 1);
  assert.deepEqual(plans.flatMap((p) => p.journeyFiles).sort(), [...files].sort());
  const total = plans.reduce((sum, p) => sum + p.plannedSeconds, 0);
  const known = Object.values(JOURNEY_WEIGHTS_SECONDS).reduce((a, b) => a + b, 0);
  assert.equal(total, known + DEFAULT_WEIGHT_SECONDS);
});

test("every committed weight names a journey file or the smoke step, and every journey file has a weight", () => {
  const files = listJourneyFiles(ROOT).map((f) => f.replace("backend/journeys/", ""));
  for (const key of Object.keys(JOURNEY_WEIGHTS_SECONDS)) {
    assert.ok(key === SMOKE_ITEM || files.includes(key), `weight for a journey that does not exist: ${key}`);
  }
  for (const file of files) assert.ok(file in JOURNEY_WEIGHTS_SECONDS, `journey without a measured weight: ${file}`);
});

test("the planned shards finish within 10 percent of each other", () => {
  const seconds = planAll(SHARDS).map((p) => p.plannedSeconds);
  const spread = (Math.max(...seconds) - Math.min(...seconds)) / Math.max(...seconds);
  assert.ok(spread <= 0.1, `shards planned ${seconds.join(", ")} s: spread ${(spread * 100).toFixed(1)}%`);
});

test("the plan is deterministic: the same input always gives the same shards, whatever the order of the input", () => {
  const files = listJourneyFiles(ROOT);
  const forward = planAll(SHARDS, files).map((p) => p.journeyFiles);
  const again = planAll(SHARDS, files).map((p) => p.journeyFiles);
  const reversed = planAll(SHARDS, [...files].reverse()).map((p) => p.journeyFiles);
  assert.deepEqual(again, forward);
  assert.deepEqual(reversed, forward);
});

test("partitionItems places longest first, ties to the lowest shard, and refuses more shards than items", () => {
  const groups = partitionItems(
    [
      { id: "a", weight: 5 },
      { id: "b", weight: 4 },
      { id: "c", weight: 3 },
      { id: "d", weight: 3 },
    ],
    2,
  );
  assert.deepEqual(groups.map((g) => g.map((i) => i.id)), [["a", "d"], ["b", "c"]]);
  assert.throws(() => partitionItems([{ id: "a", weight: 1 }], 2), /would run nothing/);
  assert.throws(() => partitionItems([{ id: "a", weight: 1 }], 0), /positive integer/);
  assert.throws(
    () => partitionItems([{ id: "a", weight: 1 }, { id: "a", weight: 2 }], 1),
    /unique/,
  );
});

test("--shard accepts only index/total with 1 <= index <= total, and only on a named job", () => {
  assert.deepEqual(parseShardSpec("2/3"), { index: 2, total: 3 });
  for (const bad of ["", "2", "0/3", "4/3", "1/0", "a/b", "1/3/5", "-1/3", "1.5/3"]) {
    assert.throws(() => parseShardSpec(bad), /invalid --shard/, bad);
  }
  assert.deepEqual(parseArgs(["journeys", "--shard", "2/3"]).shard, { index: 2, total: 3 });
  assert.deepEqual(parseArgs(["journeys", "--shard=3/3"]).named, ["journeys"]);
  assert.throws(() => parseArgs(["--shard", "1/3"]), /needs a job name/);
  assert.throws(() => parseArgs(["journeys", "--shard"]), /needs a value/);
  assert.equal(parseArgs(["journeys"]).shard, undefined);
});

test("a sharded journeys job runs only its files and its smoke share; an empty shard is skipped, never widened to every test", () => {
  const job = JOBS.find((j) => j.id === "journeys")!;
  const tests = job.steps.find((s) => s.name === "journey tests")!;
  const smoke = job.steps.find((s) => s.name === "studio smoke and scrub")!;
  const plans = Array.from({ length: SHARDS }, (_, i) => planJourneyShard({ index: i + 1, total: SHARDS }, ROOT));
  for (const plan of plans) {
    const sharded = tests.forShard!(plan);
    assert.deepEqual(sharded.cmd.slice(sharded.cmd.indexOf("--test-concurrency=1") + 1), plan.journeyFiles);
    assert.equal(sharded.todoCases, true, "unfinished journey cases must still fail a shard");
    assert.equal(sharded.skip?.() ?? null, null);
    assert.equal(smoke.forShard!(plan).skip?.() == null, plan.runsSmoke);
  }
  assert.equal(plans.filter((p) => smoke.forShard!(p).skip?.() == null).length, 1, "the smoke step runs in exactly one shard");
  const empty = tests.forShard!({ ...plans[0], journeyFiles: [] });
  assert.match(empty.skip!() ?? "", /no journey files are planned/);
  assert.ok(tests.cmd.includes("backend/journeys/**/*.journey.ts"), "an unsharded run still selects every journey by glob");
});

interface WorkflowJob {
  name?: string;
  strategy?: { "fail-fast"?: boolean; matrix?: { shard?: number[] } };
  "timeout-minutes"?: number;
  needs?: string[];
  steps?: { name?: string; run?: string; with?: { name?: string } }[];
}

test("ci.yml runs the journeys as matrix shards 1..N derived from the matrix, with per-shard evidence, no retries and the unchanged timeout", () => {
  const ci = YAML.parse(fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, WorkflowJob> };
  const journeys = ci.jobs.journeys;
  const shards = journeys.strategy?.matrix?.shard ?? [];
  assert.ok(shards.length >= 2, "the journeys job must be a matrix of at least 2 shards");
  assert.deepEqual(shards, shards.map((_, i) => i + 1), "the matrix must be exactly 1..N so no shard index is missing or repeated");
  assert.equal(journeys.strategy?.["fail-fast"], false, "a failing shard must not cancel the others");
  assert.equal(journeys["timeout-minutes"], 30, "the journeys timeout is unchanged");
  const run = journeys.steps?.find((s) => s.name === "Journeys")?.run;
  assert.equal(run, "npm run ci -- journeys --shard ${{ matrix.shard }}/${{ strategy.job-total }}", "the shard total must come from the matrix itself");
  const upload = journeys.steps?.find((s) => s.name === "Keep failing frames and reports");
  assert.equal(upload?.with?.name, "journeys-evidence-${{ matrix.shard }}", "each shard uploads under its own artifact name");
  assert.match(journeys.name ?? "", /\$\{\{ matrix\.shard \}\}/, "each leg shows its shard in the job name");
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8"), /nick-fields\/retry|attempt_limit/, "no retry action");
});

test("all-green is still the one required check and fails unless the aggregate journeys result is success", () => {
  const ci = YAML.parse(fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, WorkflowJob & { if?: string }> };
  const allGreen = ci.jobs["all-green"];
  assert.deepEqual(allGreen.needs, ["changes", "static", "unit", "journeys", "legacy"]);
  assert.equal(allGreen.if, "always()");
  const text = JSON.stringify(allGreen);
  assert.match(text, /needs\.journeys\.result/);
  assert.match(text, /test \\"\$\{RESULTS\}\\" = \\"success success success success success\\"/);
  assert.ok(!Object.keys(ci.jobs).some((k) => /^journeys-/.test(k)), "no second journeys job name that branch protection would have to learn");
});
