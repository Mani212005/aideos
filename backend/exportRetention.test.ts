/**
 * File Description: Tests for W8 bounded Studio export retention: keeps the newest two Studio exports per format, removes older exports with their sidecars, and never deletes CLI renders, hand-named exports, other formats, or files listed in publish/record.json.
 * Inputs and outputs: temporary renders directories and mock publish records -> assertions on retained and pruned files.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseStudioExportFilename,
  pruneStudioExports,
  STUDIO_EXPORT_SIDECAR_SUFFIXES,
} from "./exportRetention";

// Writes an export mp4 plus its sidecar files inside a directory.
function writeExportWithSidecars(dir: string, filename: string): void {
  const file = path.join(dir, filename);
  fs.writeFileSync(file, "mp4");
  for (const suffix of STUDIO_EXPORT_SIDECAR_SUFFIXES) {
    fs.writeFileSync(`${file}${suffix}`, "sidecar");
  }
}

test("W8 export retention: keeps newest 2 Studio exports per format and prunes older ones with sidecars, leaving manual/CLI/other-format files untouched", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-retention-"));
  const rendersDir = path.join(root, "renders");
  fs.mkdirSync(rendersDir, { recursive: true });
  try {
    writeExportWithSidecars(rendersDir, "aideos_demo_long_1000.mp4");
    writeExportWithSidecars(rendersDir, "aideos_demo_long_2000.mp4");
    writeExportWithSidecars(rendersDir, "aideos_demo_long_3000.mp4");
    writeExportWithSidecars(rendersDir, "aideos_demo_long_4000.mp4");
    // Unrelated formats, films, CLI outputs, and owner-named exports must never be removed.
    fs.writeFileSync(path.join(rendersDir, "aideos_demo_reel_500.mp4"), "reel");
    fs.writeFileSync(path.join(rendersDir, "aideos_other_long_500.mp4"), "other");
    fs.writeFileSync(path.join(rendersDir, "long.mp4"), "cli-long");
    fs.writeFileSync(path.join(rendersDir, "my-hand-export.mp4"), "hand");
    fs.writeFileSync(path.join(rendersDir, "description_credits.txt"), "credits");

    assert.equal(parseStudioExportFilename("aideos_demo_long_4000.mp4", "demo", "long"), 4000);
    assert.equal(parseStudioExportFilename("long.mp4", "demo", "long"), null);

    const res = pruneStudioExports({
      rendersDir,
      filmId: "demo",
      format: "long",
      keepFilenames: ["aideos_demo_long_4000.mp4"],
    });

    assert.deepEqual(res.kept, ["aideos_demo_long_4000.mp4", "aideos_demo_long_3000.mp4"]);
    assert.deepEqual(res.removed, ["aideos_demo_long_2000.mp4", "aideos_demo_long_1000.mp4"]);

    for (const removed of res.removed) {
      assert.equal(fs.existsSync(path.join(rendersDir, removed)), false);
      for (const suffix of STUDIO_EXPORT_SIDECAR_SUFFIXES) {
        assert.equal(fs.existsSync(path.join(rendersDir, `${removed}${suffix}`)), false);
      }
    }
    for (const kept of [
      "aideos_demo_long_4000.mp4",
      "aideos_demo_long_3000.mp4",
      "aideos_demo_reel_500.mp4",
      "aideos_other_long_500.mp4",
      "long.mp4",
      "my-hand-export.mp4",
      "description_credits.txt",
    ]) {
      assert.equal(fs.existsSync(path.join(rendersDir, kept)), true, `${kept} must be preserved`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("W8 export retention: never deletes a file named in publish/record.json and fails closed on corrupt publish records", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-retention-pub-"));
  const rendersDir = path.join(root, "renders");
  const publishDir = path.join(root, "publish");
  fs.mkdirSync(rendersDir, { recursive: true });
  fs.mkdirSync(publishDir, { recursive: true });
  try {
    writeExportWithSidecars(rendersDir, "aideos_demo_long_1000.mp4");
    writeExportWithSidecars(rendersDir, "aideos_demo_long_2000.mp4");
    writeExportWithSidecars(rendersDir, "aideos_demo_long_3000.mp4");
    writeExportWithSidecars(rendersDir, "aideos_demo_long_4000.mp4");

    const recordPath = path.join(publishDir, "record.json");
    fs.writeFileSync(
      recordPath,
      JSON.stringify({
        schema: "aideos.publish/1",
        uploads: [{ format: "long", sourceFile: "videos/demo/renders/aideos_demo_long_1000.mp4" }],
      }),
      "utf8",
    );

    const res = pruneStudioExports({
      rendersDir,
      filmId: "demo",
      format: "long",
      publishRecordPath: recordPath,
    });
    assert.deepEqual(res.kept, [
      "aideos_demo_long_4000.mp4",
      "aideos_demo_long_3000.mp4",
      "aideos_demo_long_1000.mp4",
    ]);
    assert.deepEqual(res.removed, ["aideos_demo_long_2000.mp4"]);
    assert.equal(fs.existsSync(path.join(rendersDir, "aideos_demo_long_1000.mp4")), true);

    // A corrupt publish record stops pruning rather than risking deleting a published file.
    fs.writeFileSync(recordPath, "{not valid json", "utf8");
    const blocked = pruneStudioExports({
      rendersDir,
      filmId: "demo",
      format: "long",
      keep: 1,
      publishRecordPath: recordPath,
    });
    assert.deepEqual(blocked.removed, []);
    assert.match(blocked.skippedReason ?? "", /unreadable publish record/);
    assert.equal(fs.existsSync(path.join(rendersDir, "aideos_demo_long_3000.mp4")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
