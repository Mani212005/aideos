/**
 * File Description: Root type check that compiles only git-tracked source. It takes the file list the root tsconfig.json would check, keeps the tracked ones, and type-checks that program with the tsconfig's own compiler options, so untracked or gitignored scratch (film packages under videos/, work-in-progress files beside examples) can never fail lint, CI or a release.
 * Inputs and outputs: a repo root (default: this repo) with tsconfig.json and a git index -> diagnostics on stderr and exit code 0 (clean) or 1 (type errors).
 * Used by: npm run lint, npm run typecheck, the "tsc root" step of scripts/ci.ts (so the static CI job and the release), scripts/typecheck_tracked.test.ts.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "..");

/** Normalizes a path to the absolute forward-slash form the TypeScript API reports file names in. */
function normalize(file: string): string {
  return path.resolve(file).split(path.sep).join("/");
}

/** Lists the absolute paths of every file in the git index of `root`, or null when `root` is not a git checkout. */
export function listTrackedFiles(root: string): Set<string> | null {
  try {
    const out = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    return new Set(out.split("\0").filter(Boolean).map((rel) => normalize(path.join(root, rel))));
  } catch {
    return null;
  }
}

/** Keeps the files the tsconfig selected that git tracks; untracked scratch is dropped, a tracked file never is. */
export function onlyTracked(files: readonly string[], tracked: ReadonlySet<string>): string[] {
  return files.filter((file) => tracked.has(normalize(file)));
}

/** Type-checks the tracked part of the project at `root` and returns the formatted diagnostics (empty when clean). */
export function typecheckTracked(root: string = ROOT): { errors: number; output: string; checked: number } {
  const configPath = path.join(root, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) return { errors: 1, output: ts.formatDiagnostic(read.error, host(root)), checked: 0 };
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, configPath);
  const tracked = listTrackedFiles(root);
  if (!tracked) throw new Error(`typecheck_tracked: ${root} is not a git checkout, so there is no tracked source to check.`);
  const rootNames = onlyTracked(parsed.fileNames, tracked);
  const program = ts.createProgram({ rootNames, options: parsed.options, projectReferences: parsed.projectReferences });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  return { errors: diagnostics.length, output: ts.formatDiagnostics(diagnostics, host(root)), checked: rootNames.length };
}

/** The diagnostic formatting host: paths relative to the repo root, exactly as `tsc` prints them. */
function host(root: string): ts.FormatDiagnosticsHost {
  return { getCurrentDirectory: () => root, getCanonicalFileName: (f) => f, getNewLine: () => "\n" };
}

/** Runs the check from the CLI and exits non-zero when any type error is found. */
function main(): void {
  const result = typecheckTracked();
  if (result.errors > 0) {
    process.stderr.write(result.output);
    console.error(`[typecheck] ${result.errors} error(s) in tracked source (${result.checked} root file(s) checked).`);
    process.exit(1);
  }
  console.log(`[typecheck] ${result.checked} tracked root file(s): no type errors.`);
}

if (typeof require !== "undefined" && require.main === module) main();
