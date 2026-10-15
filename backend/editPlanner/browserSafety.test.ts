/**
 * File Description: Guards the studio's AI edit Apply gesture against Node-only imports. The page runs applyEditProgram (and so validateLayeredFilm) in the browser, where `fs`/`path` are externalized stubs that throw on first use; Node tests cannot see that, which is how F1 shipped.
 * Test 1 bundles the exact apply path for a browser with esbuild (an unresolvable Node built-in fails the bundle) and runs it in a bare vm context with no `process`, `require` or Node globals. Test 2 builds the real studio bundle with its own Vite config and fails on any "externalized for browser compatibility" warning, so a new Node import anywhere on a browser path is caught too.
 * Inputs and outputs: none -> pass/fail assertions.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { build } from "esbuild";
import { loadFixtureFilm } from "../testSupport/fixtureFilms";

const ROOT = path.resolve(__dirname, "../..");

// What OnCanvasAiEditor.handleApplyPlan runs in the page, exposed on a global so the sandbox can call it.
const APPLY_PATH_ENTRY = `
import { convertFilmToLayeredFilm, convertLayeredFilmToFilm } from "./src/dl/convertFilm";
import { applyEditProgram } from "./backend/editPlanner/interpreter";
import { validateLayeredFilm } from "./src/dl/validateLayeredFilm";
globalThis.applyPath = { convertFilmToLayeredFilm, convertLayeredFilmToFilm, applyEditProgram, validateLayeredFilm };
`;

test("the AI edit apply path bundles for a browser and runs with no Node built-ins", async () => {
  const bundled = await build({
    stdin: { contents: APPLY_PATH_ENTRY, resolveDir: ROOT, sourcefile: "apply-path-entry.ts", loader: "ts" },
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    logLevel: "silent",
  });
  const code = bundled.outputFiles[0].text;

  // Nothing Node-shaped exists in this context: a stray `process.cwd()` or `require("path")` throws.
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  assert.equal(vm.runInContext("typeof process + typeof require + typeof Buffer", sandbox), "undefinedundefinedundefined");
  vm.runInContext(code, sandbox);

  const api = sandbox.applyPath as {
    convertFilmToLayeredFilm: (film: unknown) => unknown;
    convertLayeredFilmToFilm: (layered: unknown, base: unknown) => { accent?: string };
    applyEditProgram: (film: unknown, ops: unknown[], context?: unknown) => { film: unknown; rejected: Array<{ reason: string }> };
  };
  const film = loadFixtureFilm("fixture-canvas-a");
  const layered = api.convertFilmToLayeredFilm(film);
  const result = api.applyEditProgram(layered, [{ op: "set_accent", hex: "#ff5500" }]);
  assert.equal(JSON.stringify(result.rejected.map((r) => r.reason)), "[]", "the edit must apply, not roll back on a missing Node module");
  assert.equal(api.convertLayeredFilmToFilm(result.film, film).accent, "#ff5500");
});

test("the real studio bundle has no Node built-in externalized for the browser", () => {
  const editorDir = path.join(ROOT, "editor");
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-editor-bundle-"));
  try {
    const run = spawnSync("npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "info"], { cwd: editorDir, encoding: "utf8", timeout: 240000 });
    const output = `${run.stdout}\n${run.stderr}`;
    assert.equal(run.status, 0, `the studio bundle did not build:\n${output}`);
    const externalized = output.split("\n").filter((line) => line.includes("externalized for browser compatibility"));
    assert.deepEqual(externalized, [], "a browser-bundled module imports a Node built-in (move the Node-only part behind a backend-only module)");
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
