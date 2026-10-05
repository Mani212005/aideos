/**
 * File Description: Phase 3+4 Invariants and Defect-Class Regression Test Suite.
 * Extends the Phase 2 invariants with coverage for:
 * - Phase 3: add_lower_third op (broadcast-style callout card).
 * - Phase 3: set_clip_speed A/V sync - speed factor correctly shrinks clip duration and
 *   the linked audio clip tracks the same factor (A/V sync invariant at non-1x playback).
 * - Phase 4: Provenance log append-then-read round-trip, newest-first ordering, and
 *   best-effort resilience to corrupt lines.
 * - Phase 4: All Phase 3 ops produce a schema-valid LayeredFilm (Rules 1-7).
 * Inputs and outputs: Phase 3 edit operations and film fixtures -> regression test assertions.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Film } from "../../src/dl/schema";
import { convertFilmToLayeredFilm, convertLayeredFilmToFilm } from "../../src/dl/convertFilm";
import { validateLayeredFilm } from "../../src/dl/validateLayeredFilm";
import { parseFilm } from "../../src/dl/schema";
import { applyEditProgram } from "./interpreter";
import { buildEditContext } from "../editContext/buildEditContext";
import { appendEditProvenanceRecord, readEditProvenanceLog } from "./provenanceLog";
import type { EditOp } from "./schema";

/** Creates a minimal Film fixture with imported footage and audio clips for speed tests. */
function createFootageFilmFixture(): Film {
  return {
    id: "phase3-fixture",
    title: "Phase 3 Test Film",
    fps: 30,
    accent: "#635BFF",
    canvas: {
      nodes: [
        { id: "n1", label: "Intro", x: 0, y: 0, w: 200, h: 80 },
        { id: "n2", label: "Details", x: 300, y: 0, w: 200, h: 80 },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
    chapters: ["Chapter 1"],
    shots: [
      {
        id: "shot-1",
        stage: "none",
        ch: "Chapter 1",
        dur: 10,
        look: "n1",
        move: "cut",
        cameraAngle: "flat",
        drift: false,
        zoom: 1,
        scriptText: "Test narration.",
        blocks: [],
      },
    ],
    layers: [
      { id: "layer-video", number: 15, label: "Video", locked: false, hidden: false, muted: false, height: 72 },
      { id: "layer-audio-footage", number: 5, label: "Footage Audio", locked: false, hidden: false, muted: false, height: 48 },
    ],
    videoClips: [
      {
        id: "clip-video-base",
        src: "videos/phase3-fixture/footage/import-1.mp4",
        position: 0,
        start: 0,
        end: 10,
        width: 1920,
        height: 1080,
        opacity: 1,
        volume: 1,
        linkedClipId: "clip-audio-base",
      },
    ],
    audioClips: [
      {
        id: "clip-audio-base",
        src: "videos/phase3-fixture/footage/import-1.mp4",
        position: 0,
        start: 0,
        end: 10,
        volume: 1,
        channel: "external",
        linkedClipId: "clip-video-base",
      },
    ],
    overlayClips: [],
  };
}

test("Phase 3 - add_lower_third: creates a text clip in lower-thirds lane with correct payload", () => {
  const film = convertFilmToLayeredFilm(createFootageFilmFixture());
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 10 });

  const ops: EditOp[] = [
    {
      op: "add_lower_third",
      title: "John Doe",
      subtitle: "Senior Engineer",
      startSec: 1,
      endSec: 4,
      label: "Lower Third - John Doe",
    },
  ];

  const result = applyEditProgram(film, ops, context);
  assert.equal(result.rejected.length, 0, "add_lower_third should execute cleanly");

  // Should have created a layer-lower-thirds lane
  const ltLane = result.film.layers.find((l) => l.id === "layer-lower-thirds");
  assert.ok(ltLane, "layer-lower-thirds lane must be created");

  // Should have added a text clip in that lane
  const ltClip = result.film.clips.find((c) => c.layerId === "layer-lower-thirds");
  assert.ok(ltClip, "A lower-third clip must exist in layer-lower-thirds");
  assert.equal(ltClip?.kind, "text", "Lower-third clip must be kind=text");
  assert.equal(ltClip?.position, 1, "Clip position must match startSec");
  assert.equal(ltClip?.end - (ltClip?.start ?? 0), 3, "Duration must be endSec - startSec = 3s");

  const payload = ltClip?.payload as any;
  assert.equal(payload?.text, "John Doe", "Payload text must be the title");
  assert.equal(payload?.subtitle, "Senior Engineer", "Payload subtitle must be the subtitle");
  assert.equal(payload?.lowerThird, true, "Payload must mark this as a lower-third");

  // Must produce a valid LayeredFilm
  assert.doesNotThrow(() => validateLayeredFilm(result.film), "Film must remain valid after add_lower_third");
});

test("Phase 3 - add_lower_third: works without optional subtitle", () => {
  const film = convertFilmToLayeredFilm(createFootageFilmFixture());
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 10 });

  const ops: EditOp[] = [
    { op: "add_lower_third", title: "Topic: Architecture", startSec: 0, endSec: 5 },
  ];

  const result = applyEditProgram(film, ops, context);
  assert.equal(result.rejected.length, 0);
  const ltClip = result.film.clips.find((c) => c.layerId === "layer-lower-thirds");
  assert.ok(ltClip, "Lower-third clip must be created without subtitle");
  assert.doesNotThrow(() => validateLayeredFilm(result.film));
});

test("Phase 3 - add_lower_third: rejects zero-duration span", () => {
  const film = convertFilmToLayeredFilm(createFootageFilmFixture());
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 10 });

  // startSec == endSec => invalid duration
  const ops: EditOp[] = [
    { op: "add_lower_third", title: "Zero Duration", startSec: 3, endSec: 3 },
  ];

  const result = applyEditProgram(film, ops, context);
  assert.ok(result.rejected.length > 0, "Zero-duration lower-third must be rejected");
  // Rollback: no new lower-thirds lane
  assert.ok(!result.film.layers.find((l) => l.id === "layer-lower-thirds"), "No lane must be created on rollback");
});

test("Phase 3 - set_clip_speed: shrinks video+audio clip duration by the speed factor and preserves A/V sync", () => {
  const film = convertFilmToLayeredFilm(createFootageFilmFixture());
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 10 });

  // Speed up base footage by 2x: 10s clip becomes 5s
  const ops: EditOp[] = [
    { op: "set_clip_speed", clipId: "clip-video-base", factor: 2.0, label: "Speed up 2x" },
  ];

  const result = applyEditProgram(film, ops, context);
  assert.equal(result.rejected.length, 0, "set_clip_speed 2x should execute cleanly");

  // Video clip duration halved
  const videoClip = result.film.clips.find((c) => c.id === "clip-video-base");
  assert.ok(videoClip, "Video clip must still exist");
  const videoDur = videoClip!.end - videoClip!.start;
  assert.ok(
    Math.abs(videoDur - 5.0) < 0.01,
    `Video clip duration must be ~5s after 2x speed (got ${videoDur})`,
  );

  // Linked audio clip must also be halved (A/V sync)
  const audioClip = result.film.clips.find((c) => c.id === "clip-audio-base");
  assert.ok(audioClip, "Linked audio clip must still exist");
  const audioDur = audioClip!.end - audioClip!.start;
  assert.ok(
    Math.abs(audioDur - 5.0) < 0.01,
    `Audio clip duration must also be ~5s after 2x speed (got ${audioDur}) - A/V sync preserved`,
  );

  // Both clips must remain at the same position (no shift)
  assert.equal(videoClip!.position, audioClip!.position, "Video and audio must remain co-located after speed change");

  // Film must remain valid
  assert.doesNotThrow(() => validateLayeredFilm(result.film), "Film must remain valid after set_clip_speed");
});

test("Phase 3 - set_clip_speed with 'base' target: retime all base footage clips together", () => {
  const film = convertFilmToLayeredFilm(createFootageFilmFixture());
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 10 });

  const ops: EditOp[] = [
    { op: "set_clip_speed", clipId: "base", factor: 1.5, label: "Speed up base 1.5x" },
  ];

  const result = applyEditProgram(film, ops, context);
  assert.equal(result.rejected.length, 0, "set_clip_speed on 'base' should execute cleanly");
  assert.doesNotThrow(() => validateLayeredFilm(result.film));
});

test("Phase 3 - All Phase 3 EditOps produce strictly valid LayeredFilms", () => {
  const phase3Ops: EditOp[] = [
    { op: "add_lower_third", title: "Speaker Name", subtitle: "Job Title", startSec: 0, endSec: 4 },
    { op: "add_slide", visualDirection: "Technology overview diagram", startSec: 5, endSec: 9 },
    { op: "set_clip_speed", clipId: "clip-video-base", factor: 1.25 },
    { op: "set_accent", hex: "#FF6B6B" },
    { op: "set_theme", partialTheme: { fontScale: 1.1 } },
  ];

  for (const op of phase3Ops) {
    const singleFilm = convertFilmToLayeredFilm(createFootageFilmFixture());
    const singleContext = buildEditContext(singleFilm, [], [], [], { fps: 30, durationSec: 10 });
    const result = applyEditProgram(singleFilm, [op], singleContext);
    assert.equal(result.rejected.length, 0, `Op ${op.op} should execute cleanly`);
    assert.doesNotThrow(
      () => validateLayeredFilm(result.film),
      `Op ${op.op} must leave a valid LayeredFilm (Rules 1-7)`,
    );
  }
});

test("Phase 4 - Provenance log: append-then-read round-trip preserves all record fields", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-prov-"));
  const filmId = "test-film-prov";
  fs.mkdirSync(path.join(tmpDir, filmId), { recursive: true });

  const ops: EditOp[] = [
    { op: "add_lower_third", title: "Alice", startSec: 0, endSec: 3 },
    { op: "remove_fillers", scope: "all" },
  ];

  appendEditProvenanceRecord(tmpDir, filmId, {
    request: "Add speaker callout and remove filler words",
    plan: "Add a lower-third for Alice at 0-3s and remove all filler words from the base footage.",
    ops,
    attempts: 1,
    dryRun: false,
    source: "test",
    warnings: [],
  });

  const records = readEditProvenanceLog(tmpDir, filmId);
  assert.equal(records.length, 1, "Exactly one record should be stored");

  const rec = records[0];
  assert.equal(rec.filmId, filmId);
  assert.equal(rec.request, "Add speaker callout and remove filler words");
  assert.equal(rec.ops.length, 2);
  assert.equal(rec.dryRun, false);
  assert.equal(rec.source, "test");
  assert.equal(rec.attempts, 1);
  assert.ok(rec.timestamp, "Timestamp must be present");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Phase 4 - Provenance log: multiple records are returned newest-first", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-prov-order-"));
  const filmId = "order-film";
  fs.mkdirSync(path.join(tmpDir, filmId), { recursive: true });

  const base = {
    ops: [] as EditOp[],
    attempts: 1,
    dryRun: false,
    source: "test",
    warnings: [] as string[],
  };

  appendEditProvenanceRecord(tmpDir, filmId, { ...base, request: "First edit", plan: "First" });
  appendEditProvenanceRecord(tmpDir, filmId, { ...base, request: "Second edit", plan: "Second" });
  appendEditProvenanceRecord(tmpDir, filmId, { ...base, request: "Third edit", plan: "Third" });

  const records = readEditProvenanceLog(tmpDir, filmId);
  assert.equal(records.length, 3, "All 3 records should be stored");
  assert.equal(records[0].request, "Third edit", "Newest record must come first");
  assert.equal(records[1].request, "Second edit");
  assert.equal(records[2].request, "First edit", "Oldest record must come last");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Phase 4 - Provenance log: dry-run records are distinguishable from applied records", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-prov-dryrun-"));
  const filmId = "dryrun-film";
  fs.mkdirSync(path.join(tmpDir, filmId), { recursive: true });

  const base = { ops: [] as EditOp[], attempts: 1, source: "test", warnings: [] as string[] };

  appendEditProvenanceRecord(tmpDir, filmId, { ...base, request: "Preview", plan: "P", dryRun: true });
  appendEditProvenanceRecord(tmpDir, filmId, { ...base, request: "Apply", plan: "A", dryRun: false });

  const records = readEditProvenanceLog(tmpDir, filmId);
  const dryRunRecs = records.filter((r) => r.dryRun);
  const appliedRecs = records.filter((r) => !r.dryRun);
  assert.equal(dryRunRecs.length, 1, "One dry-run record");
  assert.equal(appliedRecs.length, 1, "One applied record");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Phase 4 - Provenance log: handles missing log file gracefully (no-file = empty list)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-prov-missing-"));
  const records = readEditProvenanceLog(tmpDir, "nonexistent-film");
  assert.equal(records.length, 0, "Missing log file must return an empty array");
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Phase 4 - Provenance log: ignores corrupt lines and returns valid records", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-prov-corrupt-"));
  const filmId = "corrupt-film";
  fs.mkdirSync(path.join(tmpDir, filmId), { recursive: true });
  const logPath = path.join(tmpDir, filmId, "edit_log.jsonl");

  // Write one valid record, one corrupt line, one more valid record
  const validRecord = JSON.stringify({
    timestamp: "2025-01-01T00:00:00.000Z",
    filmId,
    request: "Good edit",
    plan: "Plan",
    ops: [],
    attempts: 1,
    dryRun: false,
  });
  fs.writeFileSync(logPath, [validRecord, "{not valid json{{{{", validRecord].join("\n") + "\n");

  const records = readEditProvenanceLog(tmpDir, filmId);
  assert.equal(records.length, 2, "Two valid records must survive despite one corrupt line");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Phase 4 - Lower-third schema round-trip preserves subtitle and lowerThird flags", () => {
  const film = convertFilmToLayeredFilm(createFootageFilmFixture());
  const context = buildEditContext(film, [], [], [], { fps: 30, durationSec: 10 });

  const ops: EditOp[] = [
    {
      op: "add_lower_third",
      title: "Alex Smith",
      subtitle: "Principal Designer",
      startSec: 2,
      endSec: 6,
    },
  ];

  const result = applyEditProgram(film, ops, context);
  assert.equal(result.rejected.length, 0);

  // Convert LayeredFilm to Film manifest
  const updatedFilm = convertLayeredFilmToFilm(result.film);
  assert.ok(updatedFilm.overlayClips, "overlayClips should exist");
  const ltOverlay = updatedFilm.overlayClips?.find((oc) => (oc.payload as any)?.lowerThird);
  assert.ok(ltOverlay, "Lower-third overlay clip must be preserved in overlayClips");

  // Parse through canonical Film schema
  const parsed = parseFilm(updatedFilm);
  const parsedOverlay = parsed.overlayClips?.find((oc) => (oc.payload as any)?.lowerThird);
  assert.ok(parsedOverlay, "parseFilm must preserve lowerThird overlay clip");
  const payload = parsedOverlay?.payload as any;
  assert.equal(payload.text, "Alex Smith");
  assert.equal(payload.subtitle, "Principal Designer");
  assert.equal(payload.lowerThird, true);
});
