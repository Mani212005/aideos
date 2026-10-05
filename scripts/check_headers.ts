/**
 * File Description: Enforcement script verifying that every tracked code file begins with the required three-field header.
 * Inputs and outputs: tracked repository code files -> exit code 0 if all pass, exit code 1 with failure details if any fail.
 * Used by: npm run lint, .no-mistakes.yaml lint command, scripts/check_headers.test.ts.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Required header labels that must appear within the first comment of every code file.
export const REQUIRED_LABELS = [
  "File Description:",
  "Inputs and outputs:",
  "Used by:",
] as const;

// Determines whether a git-tracked file is a code file that requires a three-field header.
export function isCodeFile(file: string): boolean {
  if (file.startsWith("test_fixtures/")) return false;
  if (file === "Dockerfile") return true;
  if (file === "bin/aideos" || file.startsWith("bin/")) return true;
  return /\.(ts|tsx|js|mjs|cjs|mts|py|css|yaml|yml|html)$/.test(file);
}

export type FirstCommentResult =
  | { ok: true; comment: string }
  | { ok: false; reason: string };

// Extracts the very first comment from a file, allowing an initial shebang line and whitespace.
export function extractFirstComment(content: string): FirstCommentResult {
  const lines = content.split("\n");
  let idx = 0;
  if (lines.length > 0 && lines[0].startsWith("#!")) {
    idx = 1;
  }
  while (idx < lines.length && lines[idx].trim() === "") {
    idx++;
  }
  if (idx >= lines.length) {
    return { ok: false, reason: "file is empty" };
  }
  const first = lines[idx].trim();
  if (first.startsWith("/**") || first.startsWith("/*")) {
    const commentLines: string[] = [];
    while (idx < lines.length) {
      commentLines.push(lines[idx]);
      if (lines[idx].includes("*/")) break;
      idx++;
    }
    return { ok: true, comment: commentLines.join("\n") };
  }
  if (first.startsWith("<!--")) {
    const commentLines: string[] = [];
    while (idx < lines.length) {
      commentLines.push(lines[idx]);
      if (lines[idx].includes("-->")) break;
      idx++;
    }
    return { ok: true, comment: commentLines.join("\n") };
  }
  if (first.startsWith("//")) {
    const commentLines: string[] = [];
    while (
      idx < lines.length &&
      (lines[idx].trim().startsWith("//") || lines[idx].trim() === "")
    ) {
      if (
        lines[idx].trim() === "" &&
        commentLines.length > 0 &&
        !lines.slice(idx).some((l) => l.trim().startsWith("//"))
      ) {
        break;
      }
      commentLines.push(lines[idx]);
      idx++;
    }
    return { ok: true, comment: commentLines.join("\n") };
  }
  if (first.startsWith("#")) {
    const commentLines: string[] = [];
    while (
      idx < lines.length &&
      (lines[idx].trim().startsWith("#") || lines[idx].trim() === "")
    ) {
      if (
        lines[idx].trim() === "" &&
        commentLines.length > 0 &&
        !lines.slice(idx).some((l) => l.trim().startsWith("#"))
      ) {
        break;
      }
      commentLines.push(lines[idx]);
      idx++;
    }
    return { ok: true, comment: commentLines.join("\n") };
  }
  return {
    ok: false,
    reason: `first non-shebang line is not a comment: "${first.slice(0, 40)}"`,
  };
}

export type HeaderCheckResult =
  | { ok: true }
  | { ok: false; missing: string[]; reason: string };

// Validates that a file's initial comment block contains all three required labels.
export function checkFileHeader(content: string): HeaderCheckResult {
  const extracted = extractFirstComment(content);
  if (!extracted.ok) {
    return {
      ok: false,
      missing: [...REQUIRED_LABELS],
      reason: extracted.reason,
    };
  }
  const comment = extracted.comment;
  const missing = REQUIRED_LABELS.filter((label) => !comment.includes(label));
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      reason: `missing required label(s): ${missing.join(", ")}`,
    };
  }
  return { ok: true };
}

export interface HeaderAuditSummary {
  total: number;
  passed: number;
  failures: { file: string; reason: string }[];
}

// Scans all git-tracked code files in the repository and verifies their headers.
export function checkAllHeaders(rootDir?: string): HeaderAuditSummary {
  const root = rootDir ?? path.resolve(__dirname, "..");
  const rawList = execSync("git ls-files", {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const trackedFiles = rawList ? rawList.split("\n") : [];
  const codeFiles = trackedFiles.filter(isCodeFile);

  const failures: { file: string; reason: string }[] = [];
  let passed = 0;

  for (const file of codeFiles) {
    const fullPath = path.join(root, file);
    try {
      const content = fs.readFileSync(fullPath, "utf8");
      const res = checkFileHeader(content);
      if (res.ok) {
        passed++;
      } else {
        failures.push({ file, reason: res.reason });
      }
    } catch (err) {
      failures.push({
        file,
        reason: `could not read file: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return { total: codeFiles.length, passed, failures };
}

// Runs the header enforcement audit from CLI and exits non-zero on failure.
function main(): void {
  const summary = checkAllHeaders();
  if (summary.failures.length > 0) {
    console.error(
      `Header check failed: ${summary.failures.length} of ${summary.total} code file(s) lack required headers:\n`,
    );
    for (const f of summary.failures) {
      console.error(`  - ${f.file}: ${f.reason}`);
    }
    console.error(
      "\nEvery tracked code file must begin with a comment containing:",
    );
    console.error("  File Description: <description>");
    console.error("  Inputs and outputs: <inputs> -> <outputs>");
    console.error("  Used by: <callers or entry point>");
    process.exit(1);
  }
  console.log(
    `[headers] Checked ${summary.total} code file(s): all three-field headers present and valid.`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename)
) {
  main();
}
