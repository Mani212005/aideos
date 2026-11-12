/**
 * File Description: Tests that the root type check ignores untracked and gitignored scratch (the captain's rule: lint, CI and a release only check tracked source) while a type error in tracked source still fails it.
 * Inputs and outputs: throwaway git repositories with a strict tsconfig and tracked, untracked and ignored files -> assertions about typecheckTracked and listTrackedFiles.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { listTrackedFiles, onlyTracked, typecheckTracked } from "./typecheck_tracked";

const GOOD = "export const ok: number = 1;\n";
const BAD = 'export const bad: number = "not a number";\n';

/** Makes a git repo with a strict tsconfig (excluding editor/ like the real one), writes `files` and stages those named in `track`. */
function makeRepo(files: Record<string, string>, track: string[], gitignore = ""): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "typecheck-tracked-"));
  execFileSync("git", ["-C", root, "init", "-q"]);
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [], lib: ["es2020"], target: "ES2022", module: "esnext", moduleResolution: "bundler" }, exclude: ["editor"] }));
  fs.writeFileSync(path.join(root, ".gitignore"), gitignore);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  execFileSync("git", ["-C", root, "add", "tsconfig.json", ".gitignore", ...track]);
  return root;
}

test("untracked scratch with a type error does not break the check", () => {
  const root = makeRepo({ "src/good.ts": GOOD, "videos/scratch-film/design/stray.ts": BAD, "examples/wip/stray.ts": BAD }, ["src/good.ts"]);
  const result = typecheckTracked(root);
  assert.equal(result.errors, 0, result.output);
  assert.equal(result.checked, 1);
});

test("gitignored film scratch with a type error does not break the check", () => {
  const root = makeRepo({ "src/good.ts": GOOD, "videos/scratch-film/design/stray.ts": BAD }, ["src/good.ts"], "/videos/*\n");
  const result = typecheckTracked(root);
  assert.equal(result.errors, 0, result.output);
});

test("a type error in tracked source still fails the check", () => {
  const root = makeRepo({ "src/good.ts": GOOD, "src/broken.ts": BAD, "videos/scratch-film/stray.ts": BAD }, ["src/good.ts", "src/broken.ts"]);
  const result = typecheckTracked(root);
  assert.ok(result.errors > 0);
  assert.match(result.output, /src\/broken\.ts/);
  assert.doesNotMatch(result.output, /videos\//);
});

test("an untracked file that tracked source imports is still checked", () => {
  const root = makeRepo({ "src/main.ts": 'import { bad } from "./generated";\nexport const n: number = bad;\n', "src/generated.ts": BAD }, ["src/main.ts"]);
  const result = typecheckTracked(root);
  assert.ok(result.errors > 0);
  assert.match(result.output, /src\/generated\.ts/);
});

test("the tsconfig exclude list still applies to tracked files", () => {
  const root = makeRepo({ "src/good.ts": GOOD, "editor/own-project.ts": BAD }, ["src/good.ts", "editor/own-project.ts"]);
  assert.equal(typecheckTracked(root).errors, 0);
});

test("a directory that is not a git checkout is refused instead of silently checking everything", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "typecheck-tracked-nogit-"));
  fs.writeFileSync(path.join(root, "tsconfig.json"), "{}");
  assert.equal(listTrackedFiles(root), null);
  assert.throws(() => typecheckTracked(root), /not a git checkout/);
});

test("onlyTracked keeps tracked files and drops the rest", () => {
  const tracked = new Set(["/r/a.ts", "/r/b.ts"]);
  assert.deepEqual(onlyTracked(["/r/a.ts", "/r/c.ts", "/r/b.ts"], tracked), ["/r/a.ts", "/r/b.ts"]);
});
