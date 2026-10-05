/**
 * File Description: Unit tests for scripts/check_headers.ts verifying header detection, label validation, and code file filtering.
 * Inputs and outputs: sample header strings and file paths -> test assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  checkFileHeader,
  extractFirstComment,
  isCodeFile,
  REQUIRED_LABELS,
} from "./check_headers";

test("isCodeFile recognizes code file extensions and special files", () => {
  assert.equal(isCodeFile("backend/audio.ts"), true);
  assert.equal(isCodeFile("src/dl/Film.tsx"), true);
  assert.equal(isCodeFile("scripts/frames.mjs"), true);
  assert.equal(isCodeFile("editor/postcss.config.js"), true);
  assert.equal(isCodeFile("scripts/aideos-connect.d.mts"), true);
  assert.equal(isCodeFile("backend/sceneKit/whisperWords.py"), true);
  assert.equal(isCodeFile("editor/src/styles/tokens.css"), true);
  assert.equal(isCodeFile("render.yaml"), true);
  assert.equal(isCodeFile(".no-mistakes.yaml"), true);
  assert.equal(isCodeFile("editor/index.html"), true);
  assert.equal(isCodeFile("Dockerfile"), true);
  assert.equal(isCodeFile("bin/aideos"), true);
});

test("isCodeFile excludes non-code, fixture, and documentation files", () => {
  assert.equal(isCodeFile("package.json"), false);
  assert.equal(isCodeFile("README.md"), false);
  assert.equal(isCodeFile("public/favicon.svg"), false);
  assert.equal(isCodeFile("public/favicon.ico"), false);
  assert.equal(isCodeFile(".gitignore"), false);
  assert.equal(isCodeFile("editor/.gitignore"), false);
  assert.equal(isCodeFile(".prettierrc"), false);
  assert.equal(isCodeFile("LICENSE"), false);
  assert.equal(isCodeFile("test_fixtures/films/fixture-canvas-a.json"), false);
  assert.equal(isCodeFile("test_fixtures/packages/still-talking/visuals/sun.svg"), false);
  assert.equal(isCodeFile("test_fixtures/code.ts"), false);
});

test("extractFirstComment extracts JSDoc and block comments", () => {
  const content = `/**
 * File Description: Example file.
 * Inputs and outputs: none -> none.
 * Used by: entry point.
 */
export const x = 1;`;
  const res = extractFirstComment(content);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.ok(res.comment.includes("File Description: Example file."));
  }
});

test("extractFirstComment supports shebang preceding comments", () => {
  const content = `#!/usr/bin/env bash
# File Description: Shell launcher script.
# Inputs and outputs: args -> exit code.
# Used by: bin/aideos.
echo "launching"`;
  const res = extractFirstComment(content);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.ok(res.comment.includes("File Description: Shell launcher script."));
  }
});

test("extractFirstComment extracts HTML comments", () => {
  const content = `<!--
  File Description: HTML shell.
  Inputs and outputs: none -> DOM.
  Used by: Vite.
-->
<!doctype html>`;
  const res = extractFirstComment(content);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.ok(res.comment.includes("File Description: HTML shell."));
  }
});

test("extractFirstComment extracts slash and hash line comments", () => {
  const slashContent = `// File Description: Component.
// Inputs and outputs: props -> JSX.
// Used by: App.tsx.
export function Comp() {}`;
  const slashRes = extractFirstComment(slashContent);
  assert.equal(slashRes.ok, true);

  const hashContent = `# File Description: Config.
# Inputs and outputs: options -> service.
# Used by: Render.
services: []`;
  const hashRes = extractFirstComment(hashContent);
  assert.equal(hashRes.ok, true);
});

test("extractFirstComment fails when code precedes any comment", () => {
  const content = `import React from "react";
/**
 * File Description: Late comment.
 */`;
  const res = extractFirstComment(content);
  assert.equal(res.ok, false);
});

test("checkFileHeader passes when all three labels are present", () => {
  const content = `/**
 * File Description: Audio engine.
 * Inputs and outputs: script text -> voiceover.wav.
 * Used by: backend/pipeline/run.ts.
 */
export function synthesize() {}`;
  const res = checkFileHeader(content);
  assert.equal(res.ok, true);
});

test("checkFileHeader fails and reports specific missing labels", () => {
  const content = `/**
 * File Description: Incomplete header.
 */
export const y = 2;`;
  const res = checkFileHeader(content);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.deepEqual(res.missing, ["Inputs and outputs:", "Used by:"]);
  }
});

test("checkFileHeader fails on files without comments", () => {
  const content = `const z = 3;`;
  const res = checkFileHeader(content);
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.deepEqual(res.missing, [...REQUIRED_LABELS]);
  }
});
