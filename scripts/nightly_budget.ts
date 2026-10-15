/**
 * File Description: Nightly heavier render of the Iona fixture film (the whole narrated film, wide and reel, two render workers, software GL) with a budget on render wall time, peak memory of the render process tree, peak temp disk and the Remotion bundle size. A regression in any of them (a leak, a texture that doubles memory, a dependency that bloats the bundle) fails the run with the number that broke.
 * Inputs and outputs: none -> a JSON report in .ci-artifacts/nightly/budget.json, a markdown table in the GitHub step summary, exit code 1 when any budget is exceeded.
 * Used by: npm run ci -- nightly, .github/workflows/nightly.yml.
 */

import "../backend/testSupport/fixtureVideosDir";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { produceIona } from "../backend/journeys/ionaFilm";
import { ARTIFACT_DIR, assertDiskHeadroom, holdActiveFilm, sizeOf, tempEntries } from "../backend/journeys/harness";

const ROOT = path.resolve(__dirname, "..");
const MB = 1024 * 1024;

/**
 * Budgets. Measured on an Apple Silicon Mac with software GL (the whole 20 s film, both formats):
 * 313 s, 2.2 GB peak RSS, 0.5 GB peak temp frames, 27 MB bundle, 1.8 MB per mp4. A 4-core CI runner
 * is slower, so time has the most headroom; each other limit is about 2.5x the Mac figure. Tighten
 * them to about 1.5x the typical nightly value once a few runs on the runner are recorded.
 */
export const BUDGETS = {
  /** Wall seconds for the whole production: narration, design, both renders, verification. */
  totalSeconds: 1500,
  /** Peak resident memory summed over the render process tree (Node, Remotion, every Chrome). */
  peakRssMB: 6000,
  /** Peak size of Remotion's temp frame folders while rendering. */
  peakTempMB: 1500,
  /** Size of the Remotion bundle (JS, assets, fonts) for the default film. */
  bundleMB: 70,
  /** Size of each rendered mp4. */
  outputMB: 20,
};

/** Resident memory in MB of this process and every descendant, from one `ps` listing. */
function treeRssMB(): number {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss="]).toString().trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
  const children = new Map<number, number[]>();
  for (const [pid, ppid] of rows) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  const rss = new Map(rows.map(([pid, , kb]) => [pid, kb]));
  let total = 0;
  const walk = (pid: number) => {
    total += rss.get(pid) ?? 0;
    for (const child of children.get(pid) ?? []) walk(child);
  };
  walk(process.pid);
  return total / 1024;
}

/** Bytes currently held by Remotion's temp render folders. */
function tempBytes(): number {
  return tempEntries(["remotion-", "react-motion-render"]).reduce((sum, name) => sum + sizeOf(path.join(os.tmpdir(), name)), 0);
}

/** Entry point: produce, sample, compare to the budgets, report. */
async function main(): Promise<void> {
  assertDiskHeadroom();
  const restore = holdActiveFilm();
  let peakRss = 0;
  let peakTemp = 0;
  const sampler = setInterval(() => {
    try {
      peakRss = Math.max(peakRss, treeRssMB());
      peakTemp = Math.max(peakTemp, tempBytes());
    } catch {}
  }, 500);
  const started = Date.now();
  try {
    const run = await produceIona("nightly-iona", { request: { formats: ["long", "reel"], renderConcurrency: 2 } });
    const totalSeconds = (Date.now() - started) / 1000;
    const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-journey-bundle-"));
    await bundle({ entryPoint: path.join(ROOT, "src/index.ts"), outDir: bundleDir });
    const bundleMB = sizeOf(bundleDir) / MB;
    fs.rmSync(bundleDir, { recursive: true, force: true });
    const outputs = run.result.outputs.map((o) => ({ format: o.format, mb: o.sizeBytes / MB, seconds: o.durationSec }));
    const measured = { totalSeconds, peakRssMB: peakRss, peakTempMB: peakTemp / MB, bundleMB, outputMB: Math.max(...outputs.map((o) => o.mb)) };
    const rows = (Object.keys(BUDGETS) as Array<keyof typeof BUDGETS>).map((k) => ({ metric: k, measured: Number(measured[k].toFixed(1)), budget: BUDGETS[k], ok: measured[k] <= BUDGETS[k] }));
    const table = ["| metric | measured | budget | |", "| --- | --- | --- | --- |", ...rows.map((r) => `| ${r.metric} | ${r.measured} | ${r.budget} | ${r.ok ? "ok" : "OVER"} |`)].join("\n");
    console.log(`\n${table}\n`);
    fs.mkdirSync(path.join(ARTIFACT_DIR, "nightly"), { recursive: true });
    fs.writeFileSync(path.join(ARTIFACT_DIR, "nightly/budget.json"), JSON.stringify({ measured, budgets: BUDGETS, outputs, platform: `${process.platform}-${process.arch}`, node: process.version, gl: process.env.AIDEOS_GL ?? "angle" }, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Nightly render budget\n\n${table}\n`);
    const over = rows.filter((r) => !r.ok);
    if (over.length) throw new Error(`over budget: ${over.map((r) => `${r.metric} ${r.measured} > ${r.budget}`).join(", ")}`);
    if (tempEntries(["aideos-public-", "aideos-journey-bundle-"]).length) throw new Error("staged public dir or bundle left behind in the temp dir");
  } finally {
    clearInterval(sampler);
    restore();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
