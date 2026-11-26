/**
 * File Description: The one switch between the two JavaScript toolchains that CI and contributors can run aideos
 * with. `AIDEOS_TOOLCHAIN` unset or "npm" keeps the default path (npm installs, `tsx` on Node, `node --test`);
 * "bun" selects the full Bun path (bun installs from the same package-lock.json, scripts on the Bun runtime,
 * `bun test` one file per process through scripts/bunTest.ts). Any other value is an error, never a silent default.
 * Inputs and outputs: the AIDEOS_TOOLCHAIN environment value -> the active toolchain and the exact test command
 * (plus its TODO and skip report arguments) for that toolchain.
 * Used by: scripts/ci.ts (every CI step command), scripts/ci.test.ts, docs/CI.md.
 */

import { environment } from "../backend/env";

/** The toolchains aideos can run on. npm is the default until the switch is flipped. */
export type Toolchain = "npm" | "bun";

/** The environment variable that flips the switch. */
export const TOOLCHAIN_ENV = "AIDEOS_TOOLCHAIN";

/** The runner that gives `bun test` the per-file process isolation `node --test` has. */
export const BUN_TEST_RUNNER = "scripts/bunTest.ts";

/** The preload every test process gets on the npm path (the bun path loads it too, see scripts/bunTest.ts). */
export const FIXTURE_PRELOAD = "./backend/testSupport/fixtureVideosDir.ts";

/** Reads the active toolchain; unset or empty means npm, an unknown value throws so a typo can never pick a path. */
export function activeToolchain(env: Record<string, string | undefined> = environment): Toolchain {
  const raw = env[TOOLCHAIN_ENV]?.trim() ?? "";
  if (raw === "" || raw === "npm") return "npm";
  if (raw === "bun") return "bun";
  throw new Error(`${TOOLCHAIN_ENV} must be "npm" or "bun", got ${JSON.stringify(raw)}`);
}

/** Picks the command of one CI step for the given toolchain; both forms sit side by side at every call site. */
export function pick(toolchain: Toolchain, forms: Record<Toolchain, string[]>): string[] {
  return forms[toolchain];
}

/** The test command for the given files or globs: serial `node --test` with the fixture preload, or the per-file bun runner. */
export function testCommand(toolchain: Toolchain, files: string[]): string[] {
  if (toolchain === "bun") return ["bun", BUN_TEST_RUNNER, ...files];
  return ["node", "--import", "tsx", "--import", FIXTURE_PRELOAD, "--test", "--test-concurrency=1", ...files];
}

/** True when the command is the bun test runner, whose TODO and skip report is a flag of its own. */
export function isBunTestCommand(cmd: string[]): boolean {
  return cmd[0] === "bun" && cmd[1] === BUN_TEST_RUNNER;
}

/**
 * Adds the arguments that make a test command write its TODO and skipped test names to `reportPath` as
 * `{ todos, skipped }` JSON, while TAP or bun's own output still streams to stdout.
 */
export function withTestReport(cmd: string[], reportPath: string): string[] {
  if (isBunTestCommand(cmd)) return [cmd[0], cmd[1], `--report=${reportPath}`, ...cmd.slice(2)];
  return [
    cmd[0],
    "--test-reporter=tap",
    "--test-reporter=./scripts/ciTodoReporter.cjs",
    "--test-reporter-destination=stdout",
    `--test-reporter-destination=${reportPath}`,
    ...cmd.slice(1),
  ];
}
