/**
 * File Description: The root postinstall, dependency-free so Node or Bun can run it. It installs editor/ with the package
 * manager that is installing the root (bun by default, npm on the npm path of scripts/toolchain.ts), then writes the
 * generated film shadows on that same runtime, so `bun install` never calls npm and `npm ci` never calls bun.
 * Inputs and outputs: npm_config_user_agent (set by bun install and npm ci) -> editor/node_modules installed and the
 * generated files written; exit code 1 when either command fails.
 * Used by: the postinstall script of package.json (bun install, npm ci, the Dockerfile, Vercel, scripts/release.ts).
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** True when bun is the package manager running this install (its user agent starts with "bun/"). */
function installedByBun(userAgent = process.env.npm_config_user_agent ?? "") {
  return userAgent.startsWith("bun/");
}

/** The two commands of the postinstall for the package manager running it, each as program and arguments. */
function postinstallCommands(bun) {
  if (bun) {
    // bun names itself in npm_execpath; it need not be on PATH (an install started as /path/to/bun install).
    const bunBin = process.env.npm_execpath || "bun";
    return [
      // --no-save: editor/package-lock.json stays the editor's only lockfile (the root bunfig.toml does not reach editor/).
      [bunBin, ["install", "--cwd", "editor", "--no-save"]],
      [bunBin, ["scripts/ensure_generated.ts"]],
    ];
  }
  return [
    ["npm", ["--prefix", "editor", "ci"]],
    [path.join(ROOT, "node_modules", ".bin", "tsx"), ["scripts/ensure_generated.ts"]],
  ];
}

/** Runs the commands in order from the repo root and stops at the first failure. */
function main() {
  for (const [program, args] of postinstallCommands(installedByBun())) {
    const result = spawnSync(program, args, { cwd: ROOT, stdio: "inherit" });
    if (result.error) {
      console.error(`[postinstall] could not start ${program}: ${result.error.message}`);
      process.exit(1);
    }
    if (result.status !== 0) {
      console.error(`[postinstall] ${program} ${args.join(" ")} exited ${result.status ?? result.signal}`);
      process.exit(1);
    }
  }
}

main();
