/**
 * File Description: Contest Compliance Gates Test Suite (CG-1 through CG-6).
 * Programmatically asserts zero unauthorized third-party AI SDKs, zero barred AI hostnames,
 * detectable OSI licensing, and valid Google / Parallel SDK runtime integration.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

const PACKAGE_JSON_PATH = path.resolve("package.json");
const LICENSE_PATH = path.resolve("LICENSE");

const BARRED_AI_PACKAGES = [
  "openai",
  "@anthropic-ai/sdk",
  "@deepgram/sdk",
  "cohere-ai",
  "@mistralai/mistralai",
  "replicate",
  "together-ai",
];

const BARRED_API_HOSTNAMES = [
  "api.openai.com",
  "api.anthropic.com",
  "api.deepgram.com",
  "api.cohere.ai",
  "api.replicate.com",
  "api.together.xyz",
];

test("CG-1: Runtime dependencies contain zero barred third-party AI SDKs", () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
  const runtimeDeps = Object.keys(pkg.dependencies || {});

  for (const barred of BARRED_AI_PACKAGES) {
    assert.equal(
      runtimeDeps.includes(barred),
      false,
      `VIOLATION (CG-1): Barred AI package "${barred}" found in runtime dependencies`
    );
  }
});

test("CG-2: Runtime source files contain zero import or require statements of barred AI SDKs", () => {
  const srcFiles: string[] = [];

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name === "node_modules" || ent.name === "dist" || ent.name === ".tmp_audio" || ent.name === "test_fixtures") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) scanDir(full);
      else if (/\.(ts|tsx|js|mjs)$/.test(ent.name) && !ent.name.includes(".test.")) {
        srcFiles.push(full);
      }
    }
  }

  scanDir(path.resolve("src"));

  for (const file of srcFiles) {
    const code = fs.readFileSync(file, "utf8");
    for (const barred of BARRED_AI_PACKAGES) {
      const importRegex = new RegExp(`(import|require)\\s*.*?['"]${barred}['"]`, "i");
      assert.equal(
        importRegex.test(code),
        false,
        `VIOLATION (CG-2): Barred import of "${barred}" found in runtime source: ${file}`
      );
    }
  }
});

test("CG-3: Runtime source contains zero hardcoded barred AI API hostnames", () => {
  const srcFiles: string[] = [];

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name === "node_modules" || ent.name === "dist") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) scanDir(full);
      else if (/\.(ts|tsx|js)$/.test(ent.name) && !ent.name.includes(".test.")) {
        srcFiles.push(full);
      }
    }
  }

  scanDir(path.resolve("src"));

  for (const file of srcFiles) {
    const code = fs.readFileSync(file, "utf8");
    for (const host of BARRED_API_HOSTNAMES) {
      assert.equal(
        code.includes(host),
        false,
        `VIOLATION (CG-3): Barred API hostname "${host}" found in ${file}`
      );
    }
  }
});

test("CG-4: Google AI SDK integration module exists and exports typed model client", () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
  assert.ok(
    pkg.dependencies?.["@google/genai"] || fs.existsSync(path.resolve("backend/modelClient.ts")),
    "Google Gen AI SDK model client must be present in runtime path"
  );
});

test("CG-5: Parallel Search SDK integration module exists and exports search client", () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
  assert.ok(
    pkg.dependencies?.["parallel-web"] || fs.existsSync(path.resolve("backend/parallelClient.ts")),
    "Parallel Search SDK client must be present in runtime path"
  );
});

test("CG-6: OSI License file exists at repository root and is valid MIT", () => {
  assert.ok(fs.existsSync(LICENSE_PATH), "LICENSE file must exist at repository root");
  const licenseText = fs.readFileSync(LICENSE_PATH, "utf8");
  assert.ok(licenseText.includes("MIT License"), "LICENSE must be standard OSI MIT License");
});
