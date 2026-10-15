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
// Its `lint` script prints the checkout directory it ran in, which is how tests tell checkouts apart.
function makeProject(root: string): void {
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  fs.mkdirSync(path.join(root, "editor"), { recursive: true });
  fs.writeFileSync(path.join(root, "remotion.config.ts"), "");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fake-aideos", scripts: { lint: "echo CHECKOUT_DIR=$(pwd -P)" } }),
  );
  fs.copyFileSync(path.join(ROOT, "bin/aideos"), path.join(root, "bin/aideos"));
  fs.chmodSync(path.join(root, "bin/aideos"), 0o755);
}

// Runs a dispatcher with a given cwd and returns its result (HOME is isolated so no saved agent leaks in).
function runLauncher(launcher: string, args: string[], cwd: string, home: string) {
  return spawnSync("bash", [launcher, ...args], { cwd, encoding: "utf8", env: { ...process.env, HOME: home } });
}

// Reports which checkout directory a launcher ran its project command in.
function ranIn(result: { stdout: string }): string | undefined {
  return result.stdout.match(/^CHECKOUT_DIR=(.*)$/m)?.[1];
}

// Runs fn with a fresh temp dir and removes it afterwards.
function withTmp(fn: (tmp: string) => void): void {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aideos-launcher-test-")));
  try {
    fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// A symlinked dispatcher run from outside any checkout must resolve its own checkout, including a chain of links.
test("aideos launcher run through symlinks from outside any checkout uses its own checkout", () => {
  withTmp((tmp) => {
    const project = path.join(tmp, "install");
    const outside = path.join(tmp, "elsewhere");
    makeProject(project);
    fs.mkdirSync(path.join(tmp, "links/a"), { recursive: true });
    fs.mkdirSync(outside);
    const inner = path.join(tmp, "links/a/inner");
    const outer = path.join(tmp, "links/aideos");
    fs.symlinkSync(path.join(project, "bin/aideos"), inner);
    fs.symlinkSync("a/inner", outer);
    const result = runLauncher(outer, ["lint"], outside, tmp);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(ranIn(result), project);
  });
});

// Inside another checkout or worktree (even a subdirectory of it) that checkout wins over the installation root.
test("aideos launcher run inside a second checkout uses that checkout", () => {
  withTmp((tmp) => {
    const install = path.join(tmp, "install");
    const other = path.join(tmp, "other");
    makeProject(install);
    makeProject(other);
    fs.mkdirSync(path.join(other, "videos/x/renders"), { recursive: true });
    const link = path.join(tmp, "aideos");
    fs.symlinkSync(path.join(install, "bin/aideos"), link);
    for (const cwd of [other, path.join(other, "videos/x/renders")]) {
      const result = runLauncher(link, ["lint"], cwd, tmp);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(ranIn(result), other);
    }
  });
});

// The launcher never falls back to any path outside its own checkout.
test("aideos launcher fails clearly when neither the cwd nor its own location is a checkout", () => {
  withTmp((tmp) => {
    const lone = path.join(tmp, "lone/bin");
    fs.mkdirSync(lone, { recursive: true });
    fs.copyFileSync(path.join(ROOT, "bin/aideos"), path.join(lone, "aideos"));
    const result = runLauncher(path.join(lone, "aideos"), ["lint"], tmp, tmp);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not locate the Aideos checkout/);
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "bin/aideos"), "utf8"), /\/Users\//);
  });
});

// Help output: look and design usage exit 0, and top-level help lists every real command.
test("aideos launcher help exits 0 and the top-level help lists look and design", () => {
  withTmp((tmp) => {
    const project = path.join(tmp, "project");
    makeProject(project);
    const launcher = path.join(project, "bin/aideos");
    for (const [args, usage] of [
      [["look", "--help"], /aideos look brief[\s\S]*aideos look check/],
      [["look", "-h"], /aideos look brief[\s\S]*aideos look check/],
      [["design", "--help"], /aideos design check[\s\S]*aideos design brief[\s\S]*aideos design build/],
    ] as const) {
      const result = runLauncher(launcher, [...args], tmp, tmp);
      assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
      assert.match(result.stdout, usage);
    }
    const bare = runLauncher(launcher, ["look"], tmp, tmp);
    assert.equal(bare.status, 1);
    assert.match(bare.stderr, /Usage: aideos look brief/);

    const top = runLauncher(launcher, ["--help"], tmp, tmp);
    assert.equal(top.status, 0, top.stderr);
    const commands = fs
      .readFileSync(launcher, "utf8")
      .match(/^ {4}(exit\|[^)]*)\)/m)![1]
      .split("|")
      .filter((c) => !["help", "--help", "-h", "stop", "down", "kill", "render:reel"].includes(c));
    for (const command of commands) {
      assert.match(top.stdout, new RegExp(`aideos ${command}\\b`), `top-level help omits '${command}'`);
    }
  });
});

// Unknown commands must fail before the Studio or session launcher can run.
test("aideos launcher rejects unknown commands and lists its dispatch table", () => {
  withTmp((tmp) => {
    const project = path.join(tmp, "project");
    const outside = path.join(tmp, "elsewhere");
    makeProject(project);
    fs.mkdirSync(outside);
    const link = path.join(tmp, "aideos");
    fs.symlinkSync(path.join(project, "bin/aideos"), link);
    for (const cwd of [project, outside]) {
      const result = runLauncher(link, ["not-a-command"], cwd, tmp);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /unknown aideos command 'not-a-command'/);
      assert.match(result.stderr, /Commands:.*review.*design.*look.*film/);
      assert.equal(fs.existsSync(path.join(project, ".aideos_session.json")), false);
      assert.equal(fs.existsSync(path.join(cwd, ".aideos_session.json")), false);
      assert.doesNotMatch(result.stdout + result.stderr, /Starting Aideos Studio|Launching .*tmux/);
    }
  });
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
