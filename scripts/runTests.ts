/**
 * File Description: The test entry of the package.json test scripts. It runs the test files or globs it is given with the
 * test command of the active toolchain (scripts/toolchain.ts): the per-file bun runner on the bun path, serial `node --test`
 * on the npm path, so `npm test` needs no bun and `bun run test` needs no extra setup.
 * Inputs and outputs: test files or globs as arguments plus AIDEOS_TOOLCHAIN and npm_config_user_agent -> the test output on
 * inherited stdio and the test command's exit code (1 when it cannot start).
 * Used by: the test, test:journeys, test:live, test:legacy, test:visual and goldens:update scripts of package.json.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { environment } from "../backend/env";
import { activeToolchain, testCommand } from "./toolchain";

const ROOT = path.resolve(__dirname, "..");

/** Replaces the bare `bun` program with the bun that started this script, since bun need not be on PATH inside a script. */
function resolveProgram(cmd: string[]): string[] {
  const execPath = environment.npm_execpath ?? "";
  if (cmd[0] === "bun" && /bun/i.test(path.basename(execPath))) return [execPath, ...cmd.slice(1)];
  return cmd;
}

/** Runs the toolchain's test command for the given files from the repo root and returns its exit code. */
function main(files: string[]): number {
  if (files.length === 0) {
    console.error("[runTests] usage: scripts/runTests.ts <test file or glob>...");
    return 1;
  }
  const [program, ...args] = resolveProgram(testCommand(activeToolchain(environment), files));
  const result = spawnSync(program, args, { stdio: "inherit", cwd: ROOT });
  if (result.error) {
    console.error(`[runTests] could not start ${program}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

process.exit(main(process.argv.slice(2)));
