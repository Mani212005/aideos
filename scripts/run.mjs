/**
 * File Description: The package.json script launcher, dependency-free so plain Node can start it under npm or Bun. It runs a
 * TypeScript file on the runtime of the package manager that started the script: Bun under `bun run`, tsx on Node under
 * `npm run`, so `npm run <script>` never needs bun on PATH and `bun run <script>` never needs tsx.
 * Inputs and outputs: `<file.ts> [args...]` plus npm_config_user_agent and npm_execpath -> the file's output on inherited stdio
 * and its exit code (1 with a one-line error on a spawn failure or a signal).
 * Used by: the toolchain scripts and their pre/post hooks in package.json (ci, lint, test, ensure:generated, eval:*, and the rest).
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** True when bun is the package manager running this script (its user agent starts with "bun/"). */
function startedByBun(userAgent = process.env.npm_config_user_agent ?? "") {
  return userAgent.startsWith("bun/");
}

/** The program that runs the TypeScript file: bun (named in npm_execpath, as it need not be on PATH) or the repo's tsx. */
function runtimeProgram(bun) {
  if (bun) return process.env.npm_execpath || "bun";
  return path.join(ROOT, "node_modules", ".bin", "tsx");
}

/** Runs the file with its arguments on inherited stdio and returns the exit code the launcher should use. */
function main(argv) {
  if (argv.length === 0) {
    console.error("[run] usage: node scripts/run.mjs <file.ts> [args...]");
    return 1;
  }
  const result = spawnSync(runtimeProgram(startedByBun()), argv, { stdio: "inherit", cwd: process.cwd() });
  if (result.error) {
    console.error(`[run] could not start ${argv[0]}: ${result.error.message}`);
    return 1;
  }
  if (result.signal) {
    console.error(`[run] ${argv[0]} was stopped by ${result.signal}`);
    return 1;
  }
  return result.status ?? 1;
}

process.exit(main(process.argv.slice(2)));
