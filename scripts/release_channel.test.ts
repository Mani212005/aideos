/**
 * File Description: Integration tests for release channel derivation, stable launcher pinning, release setup, and film copying.
 * Inputs and outputs: isolated git repositories -> channel derivations, CLI outputs, and filesystem states.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { releaseChannel, releaseVersionProblem } from "../backend/releaseChannel";

const ROOT = path.resolve(__dirname, "..");

/** Runs a Git command inside a repository with an isolated environment and explicit test committer identity. */
function runGit(repo: string, args: string[]): string {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  env.GIT_AUTHOR_NAME = "Test User";
  env.GIT_AUTHOR_EMAIL = "test@example.com";
  env.GIT_COMMITTER_NAME = "Test User";
  env.GIT_COMMITTER_EMAIL = "test@example.com";
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Creates a temporary disposable directory and cleans it up after test execution. */
function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aideos-release-test-")));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Initializes a minimal Git repository with an initial commit. */
function initGitRepo(dir: string, branch = "main"): void {
  fs.mkdirSync(dir, { recursive: true });
  runGit(dir, ["init", "--initial-branch", branch]);
  runGit(dir, ["config", "user.name", "Test User"]);
  runGit(dir, ["config", "user.email", "test@example.com"]);
  runGit(dir, ["config", "receive.shallowUpdate", "true"]);
  fs.writeFileSync(path.join(dir, "README.md"), "# Test Repo\n");
  runGit(dir, ["add", "README.md"]);
  runGit(dir, ["commit", "-m", "initial commit"]);
}

/** Sets up a mock Aideos project tree with launcher links and scripts. */
function makeAideosProject(dir: string, branch = "main"): void {
  initGitRepo(dir, branch);
  fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
  fs.mkdirSync(path.join(dir, "editor"), { recursive: true });
  fs.mkdirSync(path.join(dir, "videos"), { recursive: true });
  fs.writeFileSync(path.join(dir, "remotion.config.ts"), "");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "mock-aideos" }));
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"));
  fs.symlinkSync(path.join(ROOT, "scripts"), path.join(dir, "scripts"));
  for (const name of ["aideos", "aideos-dev", "aideos-stable"]) {
    fs.copyFileSync(path.join(ROOT, "bin", name), path.join(dir, "bin", name));
    fs.chmodSync(path.join(dir, "bin", name), 0o755);
  }
}

test("releaseChannel derives dev channel with ahead count and uncommitted changes", () => {
  withTempDir((tmp) => {
    initGitRepo(tmp, "main");
    const initial = releaseChannel(tmp);
    assert.equal(initial.channel, "dev");
    assert.equal(initial.label, "DEV");
    assert.equal(initial.port, 3001);
    assert.equal(initial.dirty, false);
    assert.equal(initial.ahead, null);
    assert.match(initial.description, /^AIDEOS DEV main@[0-9a-f]{7}$/);

    runGit(tmp, ["branch", "stable"]);
    const atStable = releaseChannel(tmp);
    assert.equal(atStable.ahead, 0);
    assert.doesNotMatch(atStable.description, /commits ahead of stable/);

    fs.writeFileSync(path.join(tmp, "commit2.txt"), "c2\n");
    runGit(tmp, ["add", "commit2.txt"]);
    runGit(tmp, ["commit", "-m", "second commit"]);
    const ahead = releaseChannel(tmp);
    assert.equal(ahead.ahead, 1);
    assert.match(ahead.description, /\(1 commits ahead of stable\)$/);

    fs.writeFileSync(path.join(tmp, "dirty.txt"), "dirty\n");
    const dirty = releaseChannel(tmp);
    assert.equal(dirty.dirty, true);
    assert.match(dirty.description, /\+ UNCOMMITTED CHANGES \(1 commits ahead of stable\)$/);
  });
});

test("releaseChannel derives stable channel only for clean tagged stable branch", () => {
  withTempDir((tmp) => {
    initGitRepo(tmp, "stable");
    const untagged = releaseChannel(tmp);
    assert.equal(untagged.channel, "dev");

    runGit(tmp, ["tag", "-a", "v1.0.0", "-m", "release 1.0.0"]);
    const tagged = releaseChannel(tmp);
    assert.equal(tagged.channel, "stable");
    assert.equal(tagged.label, "STABLE v1.0.0");
    assert.equal(tagged.tag, "v1.0.0");
    assert.equal(tagged.port, 3002);
    assert.match(tagged.description, /^AIDEOS STABLE v1\.0\.0 \(commit [0-9a-f]{7}\)$/);

    fs.writeFileSync(path.join(tmp, "dirty.txt"), "dirty\n");
    const dirtyStable = releaseChannel(tmp);
    assert.equal(dirtyStable.channel, "dev");
    assert.equal(dirtyStable.port, 3001);
  });
});

test("releaseChannel shows a v0.5.0 pre-release tag as STABLE through the channel script", () => {
  withTempDir((tmp) => {
    initGitRepo(tmp, "stable");
    runGit(tmp, ["tag", "-a", "v0.5.0", "-m", "release 0.5.0"]);
    const tagged = releaseChannel(tmp);
    assert.equal(tagged.channel, "stable");
    assert.equal(tagged.label, "STABLE v0.5.0");
    assert.equal(tagged.tag, "v0.5.0");
    assert.match(tagged.description, /^AIDEOS STABLE v0\.5\.0 \(commit [0-9a-f]{7}\)$/);

    const version = spawnSync(
      path.join(ROOT, "node_modules/.bin/tsx"),
      [path.join(ROOT, "scripts/channel.ts"), tmp, "version"],
      { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }
    );
    assert.equal(version.status, 0);
    assert.match(version.stdout.trim(), /^AIDEOS STABLE v0\.5\.0 \(commit [0-9a-f]{7}\)$/);
  });
});

test("releaseVersionProblem accepts 0.5.0 or 1.0.0 as first release and next patch, minor or major after", () => {
  assert.equal(releaseVersionProblem("0.5.0", ""), "");
  assert.equal(releaseVersionProblem("1.0.0", ""), "");
  assert.match(releaseVersionProblem("1.2.0", ""), /First release must be any 0\.x\.y pre-release or 1\.0\.0/);
  assert.match(releaseVersionProblem("2.0.0", ""), /First release must be/);

  assert.equal(releaseVersionProblem("0.5.1", "v0.5.0"), "");
  assert.equal(releaseVersionProblem("0.6.0", "v0.5.0"), "");
  assert.equal(releaseVersionProblem("1.0.0", "v0.5.0"), "");
  assert.equal(releaseVersionProblem("1.0.0", "v0.5.3"), "");
  assert.match(releaseVersionProblem("0.7.0", "v0.5.0"), /Next release must be one of 0\.5\.1, 0\.6\.0, 1\.0\.0; latest tag is v0\.5\.0\./);
  assert.match(releaseVersionProblem("0.5.2", "v0.5.0"), /Next release must be one of/);
  assert.match(releaseVersionProblem("1.0.1", "v0.5.0"), /Next release must be one of/);
});

test("scripts/channel.ts outputs stderr banner and stdout port or requested field", () => {
  withTempDir((tmp) => {
    initGitRepo(tmp, "main");
    const channelScript = path.join(ROOT, "scripts/channel.ts");

    const defaultRun = spawnSync(
      path.join(ROOT, "node_modules/.bin/tsx"),
      [channelScript, tmp],
      { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }
    );
    assert.equal(defaultRun.status, 0);
    assert.match(defaultRun.stderr, /^AIDEOS DEV main@[0-9a-f]{7}\n$/);
    assert.equal(defaultRun.stdout, "3001");

    const portRun = spawnSync(
      path.join(ROOT, "node_modules/.bin/tsx"),
      [channelScript, tmp, "port"],
      { encoding: "utf8" }
    );
    assert.equal(portRun.status, 0);
    assert.equal(portRun.stdout, "3001");

    const whichRun = spawnSync(
      path.join(ROOT, "node_modules/.bin/tsx"),
      [channelScript, tmp, "which"],
      { encoding: "utf8" }
    );
    assert.equal(whichRun.status, 0);
    assert.equal(whichRun.stdout.trim(), `DEV: ${tmp}`);
  });
});

test("bin/aideos version and which subcommands print channel and location", () => {
  const versionRun = spawnSync("bash", [path.join(ROOT, "bin/aideos"), "version"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" }
  });
  assert.equal(versionRun.status, 0);
  assert.match(versionRun.stdout, /^AIDEOS DEV/);

  const whichRun = spawnSync("bash", [path.join(ROOT, "bin/aideos"), "which"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" }
  });
  assert.equal(whichRun.status, 0);
  assert.match(whichRun.stdout, /^DEV: \//);
});

test("bin/aideos-dev and bin/aideos-stable enforce checkout pinning and reject crossover", () => {
  withTempDir((tmp) => {
    const devDir = path.join(tmp, "dev");
    const stableDir = path.join(tmp, "stable");
    makeAideosProject(devDir, "main");
    makeAideosProject(stableDir, "stable");
    runGit(devDir, ["config", "--local", "aideos.stablePath", stableDir]);

    const devLauncher = path.join(devDir, "bin/aideos-dev");
    const linkDev = path.join(tmp, "aideos-dev");
    fs.symlinkSync(devLauncher, linkDev);

    const checkDevWhich = spawnSync("bash", [linkDev, "which"], {
      cwd: stableDir,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" }
    });
    assert.equal(checkDevWhich.status, 0, checkDevWhich.stderr);
    assert.ok(checkDevWhich.stdout.includes(devDir));

    const crossover = spawnSync("bash", [linkDev, "which"], {
      cwd: devDir,
      encoding: "utf8",
      env: { ...process.env, AIDEOS_VIDEOS_DIR: path.join(stableDir, "videos") }
    });
    assert.equal(crossover.status, 1);
    assert.match(crossover.stderr, /aideos-dev refuses AIDEOS_VIDEOS_DIR inside the stable checkout/);
  });
});

test("scripts/release.ts copy-film validates paths, slug, and preserves integrity", () => {
  withTempDir((tmp) => {
    const stableClone = path.join(tmp, "stable-clone");
    runGit(tmp, ["clone", "--no-hardlinks", ROOT, stableClone]);
    fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(stableClone, "node_modules"));

    const devVideos = path.join(tmp, "dev-videos");
    const stableVideos = path.join(stableClone, "videos");
    fs.mkdirSync(devVideos, { recursive: true });

    runGit(stableClone, ["config", "--local", "aideos.sourceVideos", devVideos]);
    runGit(stableClone, ["config", "--local", "aideos.updatingPath", ROOT]);

    const filmSlug = "test-explainer";
    const sourceFilmDir = path.join(devVideos, filmSlug);
    fs.mkdirSync(sourceFilmDir, { recursive: true });
    fs.writeFileSync(path.join(sourceFilmDir, "film.json"), JSON.stringify({ id: filmSlug }));
    fs.writeFileSync(path.join(sourceFilmDir, "script.md"), "Spoken script content");

    const stableLauncher = path.join(stableClone, "bin/aideos-stable");

    const badSlug = spawnSync("bash", [stableLauncher, "copy-film", "Bad_Slug"], {
      cwd: stableClone,
      encoding: "utf8"
    });
    assert.equal(badSlug.status, 1);
    assert.match(badSlug.stderr, /Film slug must contain lowercase letters, digits and single hyphens/);

    const dryRun = spawnSync("bash", [stableLauncher, "copy-film", filmSlug, "--dry-run"], {
      cwd: stableClone,
      encoding: "utf8"
    });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /DRY RUN - would copy/);
    assert.equal(fs.existsSync(path.join(stableVideos, filmSlug)), false);

    const copyRun = spawnSync("bash", [stableLauncher, "copy-film", filmSlug], {
      cwd: stableClone,
      encoding: "utf8"
    });
    assert.equal(copyRun.status, 0, copyRun.stderr);
    assert.equal(fs.existsSync(path.join(stableVideos, filmSlug, "film.json")), true);
    assert.equal(
      fs.readFileSync(path.join(stableVideos, filmSlug, "script.md"), "utf8"),
      "Spoken script content"
    );

    const duplicateRun = spawnSync("bash", [stableLauncher, "copy-film", filmSlug], {
      cwd: stableClone,
      encoding: "utf8"
    });
    assert.equal(duplicateRun.status, 1);
    assert.match(duplicateRun.stderr, /already exists; use --overwrite/);

    const overwriteRun = spawnSync("bash", [stableLauncher, "copy-film", filmSlug, "--overwrite"], {
      cwd: stableClone,
      encoding: "utf8"
    });
    assert.equal(overwriteRun.status, 0, overwriteRun.stderr);

    const symlinkFilmSlug = "symlink-film";
    const symlinkFilmDir = path.join(devVideos, symlinkFilmSlug);
    fs.mkdirSync(symlinkFilmDir, { recursive: true });
    fs.writeFileSync(path.join(symlinkFilmDir, "film.json"), JSON.stringify({ id: symlinkFilmSlug }));
    fs.symlinkSync(path.join(sourceFilmDir, "script.md"), path.join(symlinkFilmDir, "script.md"));

    const symlinkRun = spawnSync("bash", [stableLauncher, "copy-film", symlinkFilmSlug], {
      cwd: stableClone,
      encoding: "utf8"
    });
    assert.equal(symlinkRun.status, 1);
    assert.match(symlinkRun.stderr, /Symlinks are not self-contained/);
  });
});

test("scripts/release.ts setup prints plan and checks origin prerequisites", () => {
  withTempDir((tmp) => {
    const originDir = path.join(tmp, "origin");
    initGitRepo(originDir, "main");
    runGit(originDir, ["config", "receive.denyCurrentBranch", "ignore"]);

    const updatingDir = path.join(tmp, "updating");
    runGit(tmp, ["clone", "--no-hardlinks", "--no-tags", ROOT, updatingDir]);
    runGit(updatingDir, ["remote", "set-url", "origin", originDir]);
    fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(updatingDir, "node_modules"));

    const releaseScript = path.join(updatingDir, "scripts/release.ts");
    const targetStable = path.join(tmp, "aideos-stable");
    const targetBin = path.join(tmp, "bin");

    const planRun = spawnSync(
      path.join(ROOT, "node_modules/.bin/tsx"),
      [releaseScript, "setup", "--path", targetStable, "--bin-dir", targetBin, "--dry-run"],
      { cwd: updatingDir, encoding: "utf8" }
    );
    assert.equal(planRun.status, 0, planRun.stderr);
    assert.match(planRun.stdout, /Setup plan:/);
    assert.match(planRun.stdout, /aideos-stable/);
    assert.match(planRun.stdout, /aideos-dev/);

    const applyWithoutRelease = spawnSync(
      path.join(ROOT, "node_modules/.bin/tsx"),
      [releaseScript, "setup", "--path", targetStable, "--bin-dir", targetBin, "--apply"],
      { cwd: updatingDir, encoding: "utf8" }
    );
    assert.equal(applyWithoutRelease.status, 1);
    assert.match(applyWithoutRelease.stderr, /Publish the first annotated release and stable branch before setup/);
  });
});

test("scripts/release.ts setup requires an interactive terminal when origin prerequisites pass", () => {
  withTempDir((tmp) => {
    const originDir = path.join(tmp, "origin");
    initGitRepo(originDir, "main");
    runGit(originDir, ["branch", "stable"]);
    runGit(originDir, ["tag", "-a", "v1.0.0", "-m", "release 1.0.0"]);
    runGit(originDir, ["config", "receive.denyCurrentBranch", "ignore"]);

    const updatingDir = path.join(tmp, "updating");
    runGit(tmp, ["clone", "--no-hardlinks", "--no-tags", ROOT, updatingDir]);
    runGit(updatingDir, ["remote", "set-url", "origin", originDir]);
    fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(updatingDir, "node_modules"));

    const releaseScript = path.join(updatingDir, "scripts/release.ts");
    const targetStable = path.join(tmp, "aideos-stable");
    const targetBin = path.join(tmp, "bin");

    const applyWithRelease = spawnSync(
      path.join(ROOT, "node_modules/.bin/tsx"),
      [releaseScript, "setup", "--path", targetStable, "--bin-dir", targetBin, "--apply"],
      { cwd: updatingDir, encoding: "utf8" }
    );
    assert.equal(applyWithRelease.status, 1);
    assert.match(applyWithRelease.stderr, /Approval requires an interactive terminal; piped approval is refused/);
  });
});

test("scripts/release.ts release enforces ancestry between stable and main", () => {
  withTempDir((tmp) => {
    const candidate = path.join(tmp, "candidate");
    runGit(tmp, ["clone", "--no-hardlinks", ROOT, candidate]);
    runGit(candidate, ["config", "user.name", "Test User"]);
    runGit(candidate, ["config", "user.email", "test@example.com"]);
    fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(candidate, "node_modules"));

    const bareOrigin = path.join(tmp, "origin.git");
    runGit(tmp, ["init", "--bare", bareOrigin]);
    runGit(bareOrigin, ["config", "receive.shallowUpdate", "true"]);
    runGit(candidate, ["remote", "set-url", "origin", bareOrigin]);

    runGit(candidate, ["checkout", "-B", "main"]);
    runGit(candidate, ["push", "origin", "main"]);

    runGit(candidate, ["checkout", "-B", "stable"]);
    fs.writeFileSync(path.join(candidate, "stable_exclusive.txt"), "exclusive\n");
    runGit(candidate, ["add", "stable_exclusive.txt"]);
    runGit(candidate, ["commit", "-m", "commit exclusive to stable"]);

    runGit(candidate, ["checkout", "main"]);

    const releaseRun = spawnSync(
      path.join(candidate, "node_modules/.bin/tsx"),
      [path.join(candidate, "scripts/release.ts"), "release", "1.0.0", "--acceptance", "/dev/null"],
      { cwd: candidate, encoding: "utf8" }
    );
    assert.equal(releaseRun.status, 1);
    assert.match(releaseRun.stderr, /main is missing commits from stable; update main before releasing\./);
  });
});
