/**
 * File Description: Classifies changed files in CI to determine test suite requirements and compute a rule-based PR risk rating in shadow mode.
 * Inputs and outputs: git diff or PR file list -> journeys and legacy run decisions, risk rating, reasons, and Markdown summary.
 * Used by: .github/workflows/ci.yml (changes job) and scripts/ciChanges.test.ts.
 */

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Maximum number of changed files before PR risk is classified as High (top quartile of last 37 PRs).
export const MAX_FILES_THRESHOLD = 25;

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

// Checks if a changed file is considered render code.
export function isRenderFile(file) {
  const normalized = file.trim().replace(/^\.\//, "").replace(/^\/+/, "");
  if (normalized.startsWith("backend/pipeline/render")) return true;
  if (normalized.startsWith("backend/scene/renderStill")) return true;
  if (normalized.startsWith("backend/lookPlan/render")) return true;
  if (normalized.startsWith("backend/geminiReview/render")) return true;
  if (normalized === "scripts/render_active.ts") return true;
  if (normalized === "render.yaml") return true;
  if (normalized.startsWith("src/dl/render/")) return true;
  return false;
}

// Checks if a changed file is considered stage or scene code.
export function isStageFile(file) {
  const normalized = file.trim().replace(/^\.\//, "").replace(/^\/+/, "");
  if (normalized === "src/dl/scene" || normalized.startsWith("src/dl/scene/")) return true;
  if (normalized.startsWith("src/dl/Stage")) return true;
  if (normalized.startsWith("src/dl/Scene")) return true;
  if (normalized === "backend/stage" || normalized.startsWith("backend/stage/")) return true;
  if (normalized === "backend/stillTalking" || normalized.startsWith("backend/stillTalking/")) return true;
  return false;
}

// Checks if a changed file is considered golden code or baseline.
export function isGoldenFile(file) {
  const normalized = file.trim().replace(/^\.\//, "").replace(/^\/+/, "");
  if (normalized === "backend/journeys/legacy.golden.ts") return true;
  if (normalized.startsWith("backend/journeys/goldenCompare")) return true;
  if (normalized.startsWith("backend/journeys/goldenResult")) return true;
  if (normalized.startsWith("backend/journeys/goldens/")) return true;
  if (normalized === ".github/workflows/update-goldens.yml") return true;
  return false;
}

// Checks if a changed file is a GitHub Actions workflow or configuration.
export function isWorkflowFile(file) {
  const normalized = file.trim().replace(/^\.\//, "").replace(/^\/+/, "");
  return normalized === ".github" || normalized.startsWith(".github/");
}

// Checks if a changed file is a project dependency or lockfile.
export function isDependencyFile(file) {
  const normalized = file.trim().replace(/^\.\//, "").replace(/^\/+/, "");
  return (
    normalized === "package.json" ||
    normalized === "package-lock.json" ||
    normalized === "editor/package.json" ||
    normalized === "editor/package-lock.json"
  );
}

// Checks if a changed file touches security-sensitive server routes in editor.
export function isSecuritySensitiveFile(file) {
  const normalized = file.trim().replace(/^\.\//, "").replace(/^\/+/, "");
  return normalized === "editor/vite.config.ts";
}

// Checks if a changed file is documentation only.
export function isDocFile(file) {
  const normalized = file.trim().replace(/^\.\//, "").replace(/^\/+/, "");
  if (normalized === "docs" || normalized.startsWith("docs/")) {
    return true;
  }
  if (normalized.endsWith(".md")) {
    return true;
  }
  const basename = normalized.split("/").pop() ?? "";
  if (basename.startsWith("LICENSE")) {
    return true;
  }
  return false;
}

// Computes a rule-based PR risk label (High, Medium, Low) and reasons in shadow mode.
export function computeRisk({ event, files, error, threshold = MAX_FILES_THRESHOLD }) {
  if (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      risk: "High",
      reasons: [`git error: ${errorMsg}`],
    };
  }

  if (event !== "pull_request") {
    return {
      risk: "High",
      reasons: [`non-pull_request event: ${event || "unknown"}`],
    };
  }

  if (!files || !Array.isArray(files) || files.length === 0) {
    return {
      risk: "High",
      reasons: ["empty or missing changed files list"],
    };
  }

  const highReasons = [];

  if (files.length > threshold) {
    highReasons.push(`touches more than ${threshold} files (${files.length} changed)`);
  }

  const renderFiles = files.filter(isRenderFile);
  if (renderFiles.length > 0) {
    highReasons.push(`touches render code (${renderFiles.slice(0, 2).join(", ")}${renderFiles.length > 2 ? `, +${renderFiles.length - 2} more` : ""})`);
  }

  const stageFiles = files.filter(isStageFile);
  if (stageFiles.length > 0) {
    highReasons.push(`touches stage code (${stageFiles.slice(0, 2).join(", ")}${stageFiles.length > 2 ? `, +${stageFiles.length - 2} more` : ""})`);
  }

  const goldenFiles = files.filter(isGoldenFile);
  if (goldenFiles.length > 0) {
    highReasons.push(`touches golden code (${goldenFiles.slice(0, 2).join(", ")}${goldenFiles.length > 2 ? `, +${goldenFiles.length - 2} more` : ""})`);
  }

  const workflowFiles = files.filter(isWorkflowFile);
  if (workflowFiles.length > 0) {
    highReasons.push(`touches workflows (${workflowFiles.slice(0, 2).join(", ")}${workflowFiles.length > 2 ? `, +${workflowFiles.length - 2} more` : ""})`);
  }

  const depFiles = files.filter(isDependencyFile);
  if (depFiles.length > 0) {
    highReasons.push(`touches dependencies or lockfiles (${depFiles.join(", ")})`);
  }

  const securityFiles = files.filter(isSecuritySensitiveFile);
  if (securityFiles.length > 0) {
    highReasons.push("touches security-sensitive server routes in editor/vite.config.ts");
  }

  if (highReasons.length > 0) {
    return {
      risk: "High",
      reasons: highReasons,
    };
  }

  const nonDocFiles = files.filter((f) => !isDocFile(f));
  if (nonDocFiles.length === 0) {
    return {
      risk: "Low",
      reasons: ["all changed files are documentation"],
    };
  }

  return {
    risk: "Medium",
    reasons: [`modifies ${files.length} file(s) outside high-risk boundaries`],
  };
}

// Pure classifier that determines whether journeys and legacy suites would run or skip, and computes risk rating.
export function classify({ event, files, error }) {
  // Fail-safe 1: Git diff error
  if (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      journeys: "true",
      legacy: "true",
      risk: "High",
      riskReasons: [`git error: ${errorMsg}`],
      reasons: [`git error: ${errorMsg}`],
    };
  }

  // Fail-safe 2: Non-pull_request events (push, workflow_dispatch, schedule, etc.)
  if (event !== "pull_request") {
    return {
      journeys: "true",
      legacy: "true",
      risk: "High",
      riskReasons: [`non-pull_request event: ${event || "unknown"}`],
      reasons: [`non-pull_request event: ${event || "unknown"}`],
    };
  }

  // Fail-safe 3: Empty or invalid file list
  if (!files || !Array.isArray(files) || files.length === 0) {
    return {
      journeys: "true",
      legacy: "true",
      risk: "High",
      riskReasons: ["empty or missing changed files list"],
      reasons: ["empty or missing changed files list"],
    };
  }

  // Fail-safe 4: Diff over 300 files
  if (files.length > 300) {
    return {
      journeys: "true",
      legacy: "true",
      risk: "High",
      riskReasons: [`more than 300 files changed (${files.length})`],
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

  const risk = computeRisk({ event, files, error });

  return {
    journeys: journeysRun ? "true" : "false",
    legacy: legacyRun ? "true" : "false",
    risk: risk.risk,
    riskReasons: risk.reasons,
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

  lines.push("### PR Risk Rating (Shadow Mode)");
  lines.push("");
  lines.push(`- **Risk Level**: **${classification.risk || "Medium"}**`);
  for (const reason of classification.riskReasons || []) {
    lines.push(`- **Reason**: ${reason}`);
  }
  lines.push("");
  lines.push("*Note: In shadow mode, this rating is for observation only and does not gate or block PRs.*");
  lines.push("");

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
  const baseSha = process.env.BASE_SHA;
  const headSha = process.env.HEAD_SHA;

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
      `journeys=${classification.journeys}\nlegacy=${classification.legacy}\nrisk=${classification.risk}\n`,
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
        fs.appendFileSync(process.env.GITHUB_OUTPUT, "journeys=true\nlegacy=true\nrisk=High\n");
      } catch {
        // Ignore output write failure on error exit
      }
    }
    process.exit(1);
  });
}
