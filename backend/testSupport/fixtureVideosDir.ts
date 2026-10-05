/**
 * File Description: Test preload that gives every test process its own throwaway videos directory,
 * seeded from test_fixtures/packages. Personal videos are gitignored and absent on a fresh clone, so
 * tests must never read them, and a test that writes a package must never touch the owner's real
 * videos/ folder. Loaded with `node --import` by `npm test` and, idempotently, by any test file that
 * needs a fixture package when run on its own: it sets AIDEOS_VIDEOS_DIR before anything resolves it.
 * Inputs and outputs: test_fixtures/packages/ -> isolated temporary video packages directory for test process.
 * Used by: npm test (Node test preload module).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FIXTURES = path.resolve(__dirname, "../../test_fixtures/packages");

/** Creates the per-process videos directory, seeds it with the fixture packages and points the loader at it. */
function installFixtureVideosDir(): string {
  // A child test process inherits the parent's env, so ownership is keyed on the pid: each process
  // seeds its own directory, and a second load inside the same process reuses the first.
  const existing = process.env.AIDEOS_TEST_VIDEOS_DIR;
  if (existing && process.env.AIDEOS_TEST_VIDEOS_PID === String(process.pid) && fs.existsSync(existing)) return existing;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-test-videos-"));
  if (fs.existsSync(FIXTURES)) fs.cpSync(FIXTURES, dir, { recursive: true });
  process.env.AIDEOS_VIDEOS_DIR = dir;
  process.env.AIDEOS_TEST_VIDEOS_DIR = dir;
  process.env.AIDEOS_TEST_VIDEOS_PID = String(process.pid);
  process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export const TEST_VIDEOS_DIR = installFixtureVideosDir();
