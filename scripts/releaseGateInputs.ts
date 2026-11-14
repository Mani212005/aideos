/**
 * File Description: What each release gate reads, as hashes: the film bytes (a content hash over file contents in stable
 * order) and the gate's own configuration (thresholds, reviewer model, verdict policy, platform). Kept apart from the
 * ledger so a changed threshold or one changed film byte can be shown to change exactly the right gate keys.
 * Inputs and outputs: a package directory, an output file and a gate environment -> { film, config } for the ledger's key.
 * Used by: scripts/release.ts and scripts/release_resume.test.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { canonicalJson, hashFile, hashTree, sha256, type Evidence, type GateEntry } from "./releaseGates";

/** Names left out of the source package: exactly what the acceptance copy skips (renders and earlier review output). */
export const SOURCE_EXCLUDED: readonly string[] = ["renders", "review", "gemini-review"];
/** Names the measured review writes (and its evidence frames); excluded when hashing the package the review reads. */
export const REVIEW_OUTPUTS: readonly string[] = ["review", "review.reel", "review.json", "review.reel.json", "gemini-review"];
/** Names a Gemini review does not read: evidence frames and its own output. The measured review.json files ARE read as context, so they stay in. */
export const GEMINI_UNREAD: readonly string[] = ["review", "review.reel", "gemini-review"];

/** Everything outside the film bytes that decides a gate's result. */
export interface GateEnvironment {
  platform: string;
  arch: string;
  node: string;
  browser: string | null;
  ttsBackend: string;
  renderConcurrency: number;
  /** Hash of the committed video model policy and delivery settings file. */
  aideosConfig: string;
  /** The measured-review thresholds. */
  thresholds: unknown;
  /** The Gemini reviewer agent and model in force, including env overrides. */
  reviewer: { agent: string; model: string };
  /** The verdict policy numbers: the bar, the second-draw band, the draw cap and the failed-gate cap. */
  verdictPolicy: { bar: number; band: number; maxDraws: number; failedGateCap: number };
}

/** Reads the real thresholds, reviewer model, verdict policy and config file the gates run against. */
export async function loadGateEnvironment(env: NodeJS.ProcessEnv = process.env): Promise<GateEnvironment> {
  const { THRESHOLDS } = await import("../backend/review/thresholds");
  const policy = await import("../backend/geminiReview/verdictPolicy");
  const config = await import("../backend/aideosConfig");
  return {
    platform: process.platform, arch: process.arch, node: process.version, browser: env.AIDEOS_BROWSER_EXECUTABLE || null,
    ttsBackend: process.platform === "darwin" ? "say" : "kokoro", renderConcurrency: 2,
    aideosConfig: sha256(fs.readFileSync(config.configPath(env))),
    thresholds: THRESHOLDS,
    reviewer: { agent: config.loadAideosConfig().videoModels.reviewer.agent, model: config.reviewerModel(undefined, env) },
    verdictPolicy: { bar: policy.VERDICT_BAR, band: policy.SECOND_DRAW_BAND, maxDraws: policy.MAX_REVIEW_DRAWS, failedGateCap: policy.FAILED_GATE_SCORE_CAP },
  };
}

/** Full CI reads no film bytes (it runs against an empty private videos directory); it depends on the platform and tool versions. */
export function ciInputs(env: GateEnvironment): { film: string; config: unknown } {
  return { film: "none", config: { gate: "ci", command: "npm run ci", platform: env.platform, arch: env.arch, node: env.node, browser: env.browser } };
}

/** Production reads the whole source package (minus renders and review output) and the production settings. */
export function productionInputs(sourcePackage: string, env: GateEnvironment): { film: string; config: unknown } {
  return {
    film: hashTree(sourcePackage, (name) => SOURCE_EXCLUDED.includes(name)),
    config: {
      gate: "production", formats: ["long", "reel"], resume: true, force: ["render", "verify"], broll: false, skipAgent: true, design: "inline",
      renderConcurrency: env.renderConcurrency, ttsBackend: env.ttsBackend, browser: env.browser, platform: env.platform, aideosConfig: env.aideosConfig,
    },
  };
}

/** The measured review reads the produced package (film data, renders, narration), never its own earlier output. */
export function reviewInputs(producedPackage: string, env: GateEnvironment): { film: string; config: unknown } {
  return {
    film: hashTree(producedPackage, (name) => REVIEW_OUTPUTS.includes(name)),
    config: { gate: "review", thresholds: sha256(canonicalJson(env.thresholds)), aideosConfig: env.aideosConfig },
  };
}

/** A Gemini review reads one rendered output plus the package's film data and measured review context, under the reviewer and verdict policy. */
export function geminiInputs(producedPackage: string, output: { format: string; path: string }, env: GateEnvironment): { film: string; config: unknown } {
  return {
    film: sha256(canonicalJson({ package: hashTree(producedPackage, (name) => GEMINI_UNREAD.includes(name)), output: hashFile(output.path) })),
    config: { gate: "gemini", format: output.format, reviewer: env.reviewer, verdictPolicy: env.verdictPolicy, aideosConfig: env.aideosConfig },
  };
}

/** One rendered output of the production gate, as production.json records it. */
export interface ProducedOutput { format: "long" | "reel"; path: string; durationSec: number }

/** Re-reads an earlier production pass (its evidence files are already verified) and returns the package and outputs it produced; throws when the record is not a clean completed run. */
export function adoptProduction(entry: GateEntry): { pkg: string; outputs: ProducedOutput[] } {
  const byKind = (kind: Evidence["kind"]) => entry.evidence.filter((item) => item.kind === kind);
  const dirs = byKind("dir");
  const record = byKind("file").find((item) => path.basename(item.path) === "production.json");
  if (dirs.length !== 1 || !record) throw new Error("The earlier production record lacks its package or production.json.");
  const result = JSON.parse(fs.readFileSync(record.path, "utf8")) as { status?: string; outputs?: ProducedOutput[]; warnings?: string[] };
  const recorded = new Set(byKind("file").map((item) => item.path));
  const outputs = result.outputs ?? [];
  if (result.status !== "completed" || result.warnings?.length || outputs.length !== 2) throw new Error("The earlier production record is not a clean completed run.");
  for (const output of outputs) if (!recorded.has(path.resolve(output.path))) throw new Error(`Output is not in the recorded evidence: ${output.path}`);
  return { pkg: dirs[0].path, outputs };
}
