/**
 * File Description: Classifies changed files in CI to determine which test suites need to run, and produces a job summary.
 * Inputs and outputs: git diff or PR file list -> journeys and legacy run decisions, reasons, and Markdown summary.
 * Used by: .github/workflows/ci.yml (changes job) and scripts/ciChanges.test.ts.
 */

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Determines whether a changed file can safely skip the journeys test suite.
export function isJourneysSkippable(file) {
  const normalized = file.trim().replace(/^\.\//, "").replace(/^\/+/, "");

  // Runtime-read docs and test assets that must never be skipped
  if (normalized === "docs/DIRECTOR_GUIDE.md") return false;
  if (normalized === "characters/README.md") return false;
  if (normalized.startsWith("test_fixtures/")) return false;
  if (normalized.startsWith("examples/")) return false;
  if (normalized.startsWith("backend/journeys/")) return false;

  // Safe documentation and skills allowlist
  if (normalized.endsWith(".md")) return true;
  if (normalized === "LICENSE") return true;
  if (normalized.startsWith(".agents/skills/")) return true;

  // Tier 2 directories proven outside the journeys closure
  if (normalized.startsWith("backend/allCheck/")) return true;
  if (normalized.startsWith("backend/geminiReview/")) return true;

  return false;
}

// Determines whether a changed file can safely skip the legacy golden test suite.
export function isLegacySkippable(file) {
  const normalized = file.trim().replace(/^\.\//, "").replace(/^\/+/, "");

  // Files that directly affect legacy golden regression
  if (normalized === "backend/journeys/legacy.golden.ts") return false;
  if (normalized.startsWith("backend/journeys/goldens/")) return false;
  if (normalized.startsWith("test_fixtures/")) return false;
  if (normalized.startsWith("examples/")) return false;

  // If skippable for journeys, also skippable for legacy
  if (isJourneysSkippable(normalized)) return true;

  // Editor changes do not affect legacy golden renders
  if (normalized.startsWith("editor/")) return true;

  return false;
}

// Pure classifier that determines whether journeys and legacy suites would run or skip.
export function classify({ event, files, error }) {
  // Fail-safe 1: Git diff error
  if (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      journeys: "true",
      legacy: "true",
      reasons: [`git error: ${errorMsg}`],
    };
  }

  // Fail-safe 2: Non-pull_request events (push, workflow_dispatch, schedule, etc.)
  if (event !== "pull_request") {
    return {
      journeys: "true",
      legacy: "true",
      reasons: [`non-pull_request event: ${event || "unknown"}`],
    };
  }

  // Fail-safe 3: Empty or invalid file list
  if (!files || !Array.isArray(files) || files.length === 0) {
    return {
      journeys: "true",
      legacy: "true",
      reasons: ["empty or missing changed files list"],
    };
  }

  // Fail-safe 4: Diff over 300 files
  if (files.length > 300) {
    return {
      journeys: "true",
      legacy: "true",
      reasons: [`more than 300 files changed (${files.length})`],
    };
  }

  const journeysTriggers = files.filter((f) => !isJourneysSkippable(f));
  const legacyTriggers = files.filter((f) => !isLegacySkippable(f));

  const journeysRun = journeysTriggers.length > 0;
  const legacyRun = legacyTriggers.length > 0;

  const reasons = [];
  if (journeysRun) {
    const sample = journeysTriggers.slice(0, 3).join(", ");
    reasons.push(`journeys: triggered by ${journeysTriggers.length} file(s) (${sample}${journeysTriggers.length > 3 ? ", ..." : ""})`);
  } else {
    reasons.push("journeys: all changed files are documentation or outside journeys closure");
  }

  if (legacyRun) {
    const sample = legacyTriggers.slice(0, 3).join(", ");
    reasons.push(`legacy: triggered by ${legacyTriggers.length} file(s) (${sample}${legacyTriggers.length > 3 ? ", ..." : ""})`);
  } else {
    reasons.push("legacy: all changed files are documentation or outside legacy closure");
  }

  return {
    journeys: journeysRun ? "true" : "false",
    legacy: legacyRun ? "true" : "false",
    reasons,
  };
}

// Groups a list of file paths by top-level area and returns counts and sorted file lists.
export function groupFilesByArea(files) {
  const groups = new Map();
  for (const raw of files) {
    const file = raw.trim().replace(/^\.\//, "").replace(/^\/+/, "");
    if (!file) continue;
    const parts = file.split("/");
    const area = parts.length > 1 ? parts[0] : "(root)";
    if (!groups.has(area)) {
      groups.set(area, []);
    }
    groups.get(area).push(file);
  }
  return groups;
}

// Formats a Markdown job summary with changed files by area and shadow mode decisions.
export function formatJobSummary({ files, classification, event, error }) {
  const lines = [];
  lines.push("## Changed Files Analysis (Shadow Mode)");
  lines.push("");

  if (error) {
    lines.push("> [!WARNING]");
    lines.push(`> Git diff encountered an error: ${error instanceof Error ? error.message : String(error)}`);
    lines.push("> All CI jobs will run as a fail-safe default.");
    lines.push("");
  } else if (event && event !== "pull_request") {
    lines.push(`**Event**: \`${event}\` (all CI jobs run on non-pull_request events)`);
    lines.push("");
  }

  if (files && files.length > 0) {
    lines.push(`### Changed files by area (${files.length} total)`);
    lines.push("");
    const groups = groupFilesByArea(files);
    const sortedAreas = [...groups.keys()].sort();
    for (const area of sortedAreas) {
      const areaFiles = groups.get(area);
      lines.push(`- **${area}** (${areaFiles.length} ${areaFiles.length === 1 ? "file" : "files"}):`);
      for (const f of areaFiles) {
        lines.push(`  - \`${f}\``);
      }
    }
    lines.push("");
  } else if (!error && event === "pull_request") {
    lines.push("No changed files detected.");
    lines.push("");
  }

  lines.push("### Job decisions (shadow mode)");
  lines.push("");
  lines.push("| Job | Decision | Reason |");
  lines.push("| --- | --- | --- |");

  const journeysDecision = classification.journeys === "false" ? "would skip" : "would run";
  const legacyDecision = classification.legacy === "false" ? "would skip" : "would run";

  const journeysReason = classification.reasons.find((r) => r.startsWith("journeys:")) ||
    classification.reasons[0] || "shadow mode evaluation";
  const legacyReason = classification.reasons.find((r) => r.startsWith("legacy:")) ||
    classification.reasons[0] || "shadow mode evaluation";

  lines.push(`| journeys | ${journeysDecision} | ${journeysReason.replace(/^journeys:\s*/, "")} |`);
  lines.push(`| legacy | ${legacyDecision} | ${legacyReason.replace(/^legacy:\s*/, "")} |`);
  lines.push("");
  lines.push("*Note: In shadow mode, all CI jobs run regardless of these decisions. No jobs are skipped.*");

  return lines.join("\n");
}

// Main entry point that reads git changes, executes classification, and writes CI outputs.
export async function run() {
  const event = process.env.EVENT_NAME || process.env.GITHUB_EVENT_NAME || "pull_request";
  const baseSha = process.env.BASE_SHA || process.env.GITHUB_BASE_REF;
  const headSha = process.env.HEAD_SHA || process.env.GITHUB_HEAD_REF;

  let files = [];
  let error = null;

  if (event === "pull_request") {
    if (!baseSha || !headSha) {
      error = "Missing BASE_SHA or HEAD_SHA environment variable for pull_request diff";
    } else {
      try {
        const stdout = execFileSync("git", ["diff", "--name-only", "--no-renames", `${baseSha}...${headSha}`], {
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        });
        files = stdout.split("\n").map((s) => s.trim()).filter(Boolean);
      } catch (err) {
        error = err;
      }
    }
  }

  const classification = classify({ event, files, error });
  const summaryMarkdown = formatJobSummary({ files, classification, event, error });

  console.log(summaryMarkdown);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `journeys=${classification.journeys}\nlegacy=${classification.legacy}\n`,
    );
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summaryMarkdown}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  run().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    if (process.env.GITHUB_OUTPUT) {
      try {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, "journeys=true\nlegacy=true\n");
      } catch {
        // Ignore output write failure on error exit
      }
    }
    process.exit(1);
  });
}
