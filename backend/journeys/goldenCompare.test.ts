/**
 * File Description: Tests the golden-frame decision with real PNG files: a missing manifest is NOT COVERED (never a pass), a matching set passes, and once a manifest exists a changed frame, a golden missing on disk, a different frame set or a different platform each fail.
 * Inputs and outputs: PNGs made with ffmpeg in a temp folder -> GoldenOutcome values from compareGoldens, and the result file round trip.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compareGoldens } from "./goldenCompare";
import { clearGoldenOutcome, goldenResultFile, readGoldenOutcome, writeGoldenOutcome } from "./goldenResult";

/** Writes a small solid-colour PNG, optionally with a bright block that makes it a visibly different frame. */
function png(file: string, color: string, block = false): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const filter = block ? `color=c=${color}:s=96x54,drawbox=x=10:y=10:w=40:h=30:color=white:t=fill` : `color=c=${color}:s=96x54`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", filter, "-frames:v", "1", file]);
}

/** A temp folder with goldens a.png and b.png, a manifest listing them, and matching rendered frames. */
function fixture(): { dir: string; goldenDir: string; manifestPath: string; rendered: Map<string, string> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-golden-test-"));
  const goldenDir = path.join(dir, "goldens");
  const renderedDir = path.join(dir, "rendered");
  for (const [name, color] of [["film/a.png", "navy"], ["film/b.png", "olive"]]) {
    png(path.join(goldenDir, name), color);
    png(path.join(renderedDir, name), color);
  }
  const manifestPath = path.join(goldenDir, "MANIFEST.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ platform: "linux-x64", frames: [{ name: "film/a.png" }, { name: "film/b.png" }] }));
  const rendered = new Map(["film/a.png", "film/b.png"].map((n) => [n, path.join(renderedDir, n)]));
  return { dir, goldenDir, manifestPath, rendered };
}

test("with no manifest the outcome is NOT COVERED and says nothing was compared", () => {
  const f = fixture();
  try {
    fs.rmSync(f.manifestPath);
    const outcome = compareGoldens({ ...f, platform: "linux-x64" });
    assert.equal(outcome.status, "not-covered");
    assert.match(outcome.status === "not-covered" ? outcome.reason : "", /no legacy frame was compared/);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("a manifest with identical frames passes and counts them", () => {
  const f = fixture();
  try {
    assert.deepEqual(compareGoldens({ ...f, platform: "linux-x64" }), { status: "passed", frames: 2 });
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("once a manifest exists a changed frame fails, names the frame and hands it to the evidence callback", () => {
  const f = fixture();
  try {
    png(f.rendered.get("film/b.png")!, "olive", true);
    const changed: string[] = [];
    const outcome = compareGoldens({ ...f, platform: "linux-x64", onChanged: (name) => changed.push(name) });
    assert.equal(outcome.status, "failed");
    assert.match(outcome.status === "failed" ? outcome.failures.join("\n") : "", /film\/b\.png: .*% of pixels changed/);
    assert.deepEqual(changed, ["film/b.png"]);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("once a manifest exists a golden missing on disk fails instead of being skipped", () => {
  const f = fixture();
  try {
    fs.rmSync(path.join(f.goldenDir, "film/a.png"));
    const outcome = compareGoldens({ ...f, platform: "linux-x64" });
    assert.equal(outcome.status, "failed");
    assert.match(outcome.status === "failed" ? outcome.failures.join("\n") : "", /film\/a\.png: listed in the manifest but missing on disk/);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("a frame set that differs from the manifest, or goldens from another platform, fail", () => {
  const f = fixture();
  try {
    const fewer = new Map([...f.rendered].slice(0, 1));
    assert.equal(compareGoldens({ ...f, rendered: fewer, platform: "linux-x64" }).status, "failed");
    const wrongPlatform = compareGoldens({ ...f, platform: "darwin-arm64" });
    assert.equal(wrongPlatform.status, "failed");
    assert.match(wrongPlatform.status === "failed" ? wrongPlatform.failures[0] : "", /made on linux-x64 but this is darwin-arm64/);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("the result file round trips and a cleared result reads as absent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-golden-result-"));
  const before = process.env.AIDEOS_CI_ARTIFACTS;
  process.env.AIDEOS_CI_ARTIFACTS = dir;
  try {
    assert.equal(readGoldenOutcome(), null);
    writeGoldenOutcome({ status: "not-covered", reason: "r" });
    assert.ok(goldenResultFile().startsWith(dir));
    assert.deepEqual(readGoldenOutcome(), { status: "not-covered", reason: "r" });
    clearGoldenOutcome();
    assert.equal(readGoldenOutcome(), null);
  } finally {
    if (before === undefined) delete process.env.AIDEOS_CI_ARTIFACTS;
    else process.env.AIDEOS_CI_ARTIFACTS = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
