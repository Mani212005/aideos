/**
 * File Description: Regression tests for the global Aideos command dispatcher and installer.
 * Inputs and outputs: isolated launcher invocations -> command errors and symlink assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(__dirname, "..");

// Creates a disposable project marker so the launcher runs only against this test's temporary tree.
function makeProject(root: string): void {
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  fs.mkdirSync(path.join(root, "editor"), { recursive: true });
  fs.writeFileSync(path.join(root, "remotion.config.ts"), "");
  fs.copyFileSync(path.join(ROOT, "bin/aideos"), path.join(root, "bin/aideos"));
}

// Unknown commands must fail before the Studio or session launcher can run.
test("aideos launcher rejects unknown commands and lists its dispatch table", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-launcher-test-"));
  const project = path.join(tmp, "project");
  try {
    makeProject(project);
    const result = spawnSync("bash", [path.join(project, "bin/aideos"), "not-a-command"], { cwd: project, encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unknown aideos command 'not-a-command'/);
    assert.match(result.stderr, /Commands:.*review.*design.*look.*film/);
    assert.equal(fs.existsSync(path.join(project, ".aideos_session.json")), false);
    assert.doesNotMatch(result.stdout + result.stderr, /Starting Aideos Studio|Launching .*tmux/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// The repository install path must point PATH users at the source-controlled dispatcher.
test("aideos installer creates a symlink to this checkout's bin/aideos", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-installer-test-"));
  try {
    const result = spawnSync("bash", [path.join(ROOT, "scripts/install_aideos.sh")], {
      cwd: ROOT,
      env: { ...process.env, HOME: tmp },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const link = path.join(tmp, ".local/bin/aideos");
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(fs.realpathSync(link), path.join(ROOT, "bin/aideos"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
