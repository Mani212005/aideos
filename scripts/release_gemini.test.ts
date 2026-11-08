/**
 * File Description: Tests that Gemini review of the long film and the reel is mandatory in npm run release, with no waiver flag.
 * Inputs and outputs: fake review runners and release CLI invocations -> assertions on what stops the release.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { reviewOutputsWithGemini } from "./releaseReview";

const ROOT = path.resolve(__dirname, "..");
const OUTPUTS = [{ path: "long.mp4" }, { path: "reel.mp4" }];

/** Builds a review runner that throws, as `gemini-review` exiting 1 does, for each video whose verdict is REVISE. */
function runner(revise: string[], calls: string[]): (videoPath: string) => void {
  return (video) => {
    calls.push(video);
    if (revise.includes(video)) throw new Error(`Command failed: gemini-review ${video}`);
  };
}

test("a REVISE verdict on the long film stops the release before the reel is reviewed", () => {
  const calls: string[] = [];
  assert.throws(() => reviewOutputsWithGemini(OUTPUTS, runner(["long.mp4"], calls)), /gemini-review long\.mp4/);
  assert.deepEqual(calls, ["long.mp4"]);
});

test("a REVISE verdict on the reel stops the release", () => {
  const calls: string[] = [];
  assert.throws(() => reviewOutputsWithGemini(OUTPUTS, runner(["reel.mp4"], calls)), /gemini-review reel\.mp4/);
  assert.deepEqual(calls, ["long.mp4", "reel.mp4"]);
});

test("both films must be ACCEPT for the release to continue", () => {
  const calls: string[] = [];
  reviewOutputsWithGemini(OUTPUTS, runner([], calls));
  assert.deepEqual(calls, ["long.mp4", "reel.mp4"]);
});

test("a review command that exits 1 for a non-ACCEPT verdict stops the release", () => {
  const exitsOne = (video: string) => execFileSync(process.execPath, ["-e", "process.exitCode = 1", video], { stdio: "ignore" });
  assert.throws(() => reviewOutputsWithGemini(OUTPUTS, exitsOne));
});

test("npm run release rejects the removed waiver flags as unknown options before doing any work", () => {
  const script = path.join(ROOT, "scripts/release.ts");
  for (const flag of ["--waive-reel-gemini", "--waive-long-gemini"]) {
    const result = spawnSync(path.join(ROOT, "node_modules/.bin/tsx"), [script, "release", "0.5.1", "--acceptance", "/dev/null", flag, "reason"], { cwd: ROOT, encoding: "utf8", input: "" });
    assert.equal(result.status, 1, flag);
    assert.match(result.stderr, new RegExp(`unknown option '${flag}'`), flag);
    assert.doesNotMatch(result.stdout, /Acceptance evidence/, flag);
  }
});
