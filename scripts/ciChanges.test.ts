/**
 * File Description: Unit tests for the CI changed-files classifier and summary generator.
 * Inputs and outputs: changed file fixtures -> assertions on journeys and legacy decisions, reasons, and summaries.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classify,
  computeRisk,
  formatJobSummary,
  groupFilesByArea,
  isDocFile,
  isJourneysSkippable,
  isLegacySkippable,
  isStageFile,
  isWorkflowFile,
  run,
} from "./ciChanges.mjs";

test("isJourneysSkippable and isLegacySkippable check specific file types", () => {
  assert.equal(isJourneysSkippable("docs/CI.md"), true);
  assert.equal(isJourneysSkippable("docs/DIRECTOR_GUIDE.md"), false);
  assert.equal(isJourneysSkippable("characters/README.md"), false);
  assert.equal(isJourneysSkippable("src/dl/Film.tsx"), false);

  assert.equal(isLegacySkippable("docs/CI.md"), true);
  assert.equal(isLegacySkippable("editor/src/App.tsx"), true);
  assert.equal(isLegacySkippable("src/dl/Film.tsx"), false);
  assert.equal(isLegacySkippable("backend/journeys/legacy.golden.ts"), false);

  assert.equal(isStageFile("src/dl/scene/compile.ts"), true);
  assert.equal(isStageFile("backend/stillTalking/scene.ts"), true);
  assert.equal(isStageFile("src/dl/Film.tsx"), false);

  assert.equal(isWorkflowFile(".github/dependabot.yml"), true);
  assert.equal(isWorkflowFile("package.json"), false);

  assert.equal(isDocFile("docs/images/diagram.png"), true);
  assert.equal(isDocFile("LICENSE-MIT"), true);
  assert.equal(isDocFile("src/dl/Film.tsx"), false);
});

test("docs-only skips journeys and legacy", () => {
  const result = classify({
    event: "pull_request",
    files: ["docs/CI.md", "README.md", "docs/REVIEW.md"],
  });
  assert.equal(result.journeys, "false");
  assert.equal(result.legacy, "false");
  assert.ok(result.reasons.some((r: string) => r.includes("documentation")));
});

test("one code file runs journeys and legacy", () => {
  const result = classify({
    event: "pull_request",
    files: ["src/dl/Film.tsx"],
  });
  assert.equal(result.journeys, "true");
  assert.equal(result.legacy, "true");
  assert.ok(result.reasons.some((r: string) => r.includes("src/dl/Film.tsx")));
});

test("a runtime doc runs journeys and legacy", () => {
  const directorResult = classify({
    event: "pull_request",
    files: ["docs/DIRECTOR_GUIDE.md"],
  });
  assert.equal(directorResult.journeys, "true");
  assert.equal(directorResult.legacy, "true");

  const characterResult = classify({
    event: "pull_request",
    files: ["characters/README.md"],
  });
  assert.equal(characterResult.journeys, "true");
  assert.equal(characterResult.legacy, "true");

  const fixtureResult = classify({
    event: "pull_request",
    files: ["test_fixtures/packages/still-talking/README.md"],
  });
  assert.equal(fixtureResult.journeys, "true");
  assert.equal(fixtureResult.legacy, "true");
});

test("an unknown path runs journeys and legacy", () => {
  const result = classify({
    event: "pull_request",
    files: ["some/unknown/path/config.xyz"],
  });
  assert.equal(result.journeys, "true");
  assert.equal(result.legacy, "true");
});

test("a git error, push or dispatch runs everything", () => {
  const errorResult = classify({
    event: "pull_request",
    files: [],
    error: new Error("git diff execution failed"),
  });
  assert.equal(errorResult.journeys, "true");
  assert.equal(errorResult.legacy, "true");
  assert.ok(errorResult.reasons.some((r: string) => r.includes("git error")));

  const pushResult = classify({
    event: "push",
    files: ["docs/CI.md"],
  });
  assert.equal(pushResult.journeys, "true");
  assert.equal(pushResult.legacy, "true");
  assert.ok(pushResult.reasons.some((r: string) => r.includes("non-pull_request")));

  const dispatchResult = classify({
    event: "workflow_dispatch",
    files: ["docs/CI.md"],
  });
  assert.equal(dispatchResult.journeys, "true");
  assert.equal(dispatchResult.legacy, "true");
  assert.ok(dispatchResult.reasons.some((r: string) => r.includes("non-pull_request")));
});

test("more than 300 files runs everything", () => {
  const files = Array.from({ length: 301 }, (_, i) => `docs/file_${i}.md`);
  const result = classify({
    event: "pull_request",
    files,
  });
  assert.equal(result.journeys, "true");
  assert.equal(result.legacy, "true");
  assert.ok(result.reasons.some((r: string) => r.includes("more than 300 files")));
});

test("empty or missing file list runs everything", () => {
  const emptyResult = classify({
    event: "pull_request",
    files: [],
  });
  assert.equal(emptyResult.journeys, "true");
  assert.equal(emptyResult.legacy, "true");

  const nullResult = classify({
    event: "pull_request",
    files: null,
  });
  assert.equal(nullResult.journeys, "true");
  assert.equal(nullResult.legacy, "true");
});

test("a rename across the boundary runs journeys and legacy", () => {
  const result = classify({
    event: "pull_request",
    files: ["docs/old_notes.md", "backend/pipeline/new_feature.ts"],
  });
  assert.equal(result.journeys, "true");
  assert.equal(result.legacy, "true");
});

test("editor changes run journeys but skip legacy", () => {
  const result = classify({
    event: "pull_request",
    files: ["editor/src/components/Timeline.tsx", "editor/src/App.tsx"],
  });
  assert.equal(result.journeys, "true");
  assert.equal(result.legacy, "false");
});

test("tier 2 proven decoupled directories skip journeys and legacy", () => {
  const result = classify({
    event: "pull_request",
    files: [
      "backend/geminiReview/eval.ts",
      "backend/geminiReview/reviewCriteria.ts",
      "backend/allCheck/runner.ts",
    ],
  });
  assert.equal(result.journeys, "false");
  assert.equal(result.legacy, "false");
});

test("skills and license skip journeys and legacy", () => {
  const result = classify({
    event: "pull_request",
    files: [".agents/skills/all-check/SKILL.md", "LICENSE"],
  });
  assert.equal(result.journeys, "false");
  assert.equal(result.legacy, "false");
});

test("groupFilesByArea groups files by top level directory", () => {
  const files = [
    "backend/pipeline/run.ts",
    "backend/sceneKit/canvas.ts",
    "editor/src/App.tsx",
    "docs/CI.md",
    "package.json",
  ];
  const groups = groupFilesByArea(files);
  assert.equal(groups.get("backend")?.length, 2);
  assert.equal(groups.get("editor")?.length, 1);
  assert.equal(groups.get("docs")?.length, 1);
  assert.equal(groups.get("(root)")?.length, 1);
});

test("formatJobSummary includes area counts and job decisions", () => {
  const files = ["docs/CI.md", "docs/REVIEW.md"];
  const classification = classify({ event: "pull_request", files });
  const summary = formatJobSummary({ files, classification, event: "pull_request", error: null });

  assert.match(summary, /## Changed Files Analysis \(Shadow Mode\)/);
  assert.match(summary, /- \*\*docs\*\* \(2 files\):/);
  assert.match(summary, /\| journeys \| would skip \|/);
  assert.match(summary, /\| legacy \| would skip \|/);
  assert.match(summary, /No jobs are skipped/);
});

test("run takes fail-safe path when BASE_SHA or HEAD_SHA is missing even if branch refs exist", async () => {
  const origEnv = { ...process.env };
  const origLog = console.log;
  console.log = () => {};
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-changes-run-"));
  const outputFile = path.join(tmpDir, "github_output");
  const summaryFile = path.join(tmpDir, "step_summary");

  try {
    process.env.EVENT_NAME = "pull_request";
    delete process.env.BASE_SHA;
    delete process.env.HEAD_SHA;
    process.env.GITHUB_BASE_REF = "main";
    process.env.GITHUB_HEAD_REF = "feature";
    process.env.GITHUB_OUTPUT = outputFile;
    process.env.GITHUB_STEP_SUMMARY = summaryFile;

    await run();

    const outputContent = fs.readFileSync(outputFile, "utf8");
    assert.match(outputContent, /journeys=true/);
    assert.match(outputContent, /legacy=true/);

    const summaryContent = fs.readFileSync(summaryFile, "utf8");
    assert.match(summaryContent, /Missing BASE_SHA or HEAD_SHA environment variable/);
    assert.match(summaryContent, /All CI jobs will run as a fail-safe default/);
    assert.match(summaryContent, /\| journeys \| would run \|/);
    assert.match(summaryContent, /\| legacy \| would run \|/);
  } finally {
    console.log = origLog;
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(origEnv)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("computeRisk rates High for render, stage, golden, workflows, dependencies, security, and large PRs", () => {
  assert.equal(computeRisk({ event: "pull_request", files: ["backend/pipeline/render.ts"] }).risk, "High");
  assert.equal(computeRisk({ event: "pull_request", files: ["src/dl/scene/ThreeStage.tsx"] }).risk, "High");
  assert.equal(computeRisk({ event: "pull_request", files: ["src/dl/scene/compile.ts"] }).risk, "High");
  assert.equal(computeRisk({ event: "pull_request", files: ["backend/stillTalking/scene.ts"] }).risk, "High");
  assert.equal(computeRisk({ event: "pull_request", files: ["backend/journeys/legacy.golden.ts"] }).risk, "High");
  assert.equal(computeRisk({ event: "pull_request", files: [".github/workflows/ci.yml"] }).risk, "High");
  assert.equal(computeRisk({ event: "pull_request", files: [".github/dependabot.yml"] }).risk, "High");
  assert.equal(computeRisk({ event: "pull_request", files: ["package.json"] }).risk, "High");
  assert.equal(computeRisk({ event: "pull_request", files: ["editor/package-lock.json"] }).risk, "High");
  assert.equal(computeRisk({ event: "pull_request", files: ["editor/vite.config.ts"] }).risk, "High");

  const largeSet = Array.from({ length: 26 }, (_, i) => `src/file_${i}.ts`);
  const largeResult = computeRisk({ event: "pull_request", files: largeSet });
  assert.equal(largeResult.risk, "High");
  assert.ok(largeResult.reasons.some((r: string) => r.includes("more than 25 files")));
});

test("computeRisk rates Low for docs-only PRs and Medium otherwise", () => {
  const docsResult = computeRisk({
    event: "pull_request",
    files: [
      "docs/CI.md",
      "README.md",
      "LICENSE",
      "LICENSE-MIT",
      "docs/images/diagram.png",
      ".agents/skills/all-check/SKILL.md",
    ],
  });
  assert.equal(docsResult.risk, "Low");
  assert.ok(docsResult.reasons.some((r: string) => r.includes("documentation")));

  const mediumResult = computeRisk({
    event: "pull_request",
    files: ["src/dl/Film.tsx", "backend/allCheck/runner.ts"],
  });
  assert.equal(mediumResult.risk, "Medium");
  assert.ok(mediumResult.reasons.some((r: string) => r.includes("outside high-risk boundaries")));
});

test("formatJobSummary includes shadow PR risk rating", () => {
  const files = ["backend/pipeline/render.ts"];
  const classification = classify({ event: "pull_request", files });
  const summary = formatJobSummary({ files, classification, event: "pull_request", error: null });

  assert.match(summary, /### PR Risk Rating \(Shadow Mode\)/);
  assert.match(summary, /- \*\*Risk Level\*\*: \*\*High\*\*/);
  assert.match(summary, /- \*\*Reason\*\*: touches render code/);
  assert.match(summary, /In shadow mode, this rating is for observation only/);
});
