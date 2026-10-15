/**
 * File Description: Fails when a tracked test file is not matched by any test script in package.json, so a new test can never silently rot unrun.
 * Inputs and outputs: git-tracked files and the quoted globs in package.json test scripts -> exit code 0 when every test file is run by a script, 1 with the orphans listed.
 * Used by: npm run ci (static job), scripts/check_tests_wired.test.ts.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

/** Scripts whose quoted globs select the test files they run. */
export const TEST_SCRIPTS = ["test", "test:journeys", "test:legacy", "test:visual"];

/** What makes a file a test file: the suffixes the three layers use. */
export const TEST_FILE = /\.(test|journey|golden)\.(ts|tsx|mjs)$/;

/** Turns a shell-style glob (`*` within a folder, `**` across folders) into an anchored regex. */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      // `**/` matches zero or more folders, a bare `**` matches anything.
      if (glob[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (c === "*") out += "[^/]*";
    else out += c.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/** Collects every quoted or bare test-file argument of the given npm scripts. */
export function patternsFromScripts(scripts: Record<string, string>): string[] {
  const patterns: string[] = [];
  for (const name of TEST_SCRIPTS) {
    const line = scripts[name];
    if (!line) continue;
    for (const token of line.match(/"[^"]+"|'[^']+'|\S+/g) ?? []) {
      const bare = token.replace(/^["']|["']$/g, "");
      if (TEST_FILE.test(bare) || /\*.*\.(test|journey|golden)\.(ts|tsx|mjs)$/.test(bare)) patterns.push(bare);
    }
  }
  return patterns;
}

/** Returns the tracked test files that no script pattern matches. */
export function findOrphans(files: string[], patterns: string[]): string[] {
  const matchers = patterns.map(globToRegExp);
  return files.filter((f) => TEST_FILE.test(f) && !matchers.some((m) => m.test(f)));
}

/** Entry point: list tracked files, compare, report. */
function main(): void {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  const files = execSync("git ls-files --cached --others --exclude-standard", { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const orphans = findOrphans(files, patternsFromScripts(pkg.scripts));
  if (orphans.length) {
    console.error(`[tests-wired] ${orphans.length} test file(s) are not run by any package.json test script:\n  ${orphans.join("\n  ")}`);
    console.error("[tests-wired] place unit tests under backend/ or scripts/ as *.test.ts, journeys as backend/journeys/*.journey.ts, goldens as *.golden.ts");
    process.exit(1);
  }
  console.log(`[tests-wired] all tracked test files are run by a package.json script.`);
}

if (typeof require !== "undefined" && require.main === module) main();
