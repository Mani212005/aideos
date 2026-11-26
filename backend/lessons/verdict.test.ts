/**
 * File Description: Tests for owner watch verdict persistence (growth plan W3): records publish, publish-after-fixes, and reject verdicts with notes next to film.json, appends history, detects stale film edits, and verifies automated acceptance never creates owner approval.
 * Inputs and outputs: synthetic video packages and CLI arguments -> assertions on owner-verdict.json, hash matching, and isolation from acceptance.json.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getVideosDir } from "../videoPackageLoader";
import { applyEvents, hashFileOrNull, readRecord } from "../filmAcceptance/store";
import {
  formatOwnerVerdict,
  isOwnerApprovedForFilm,
  ownerVerdictPath,
  parseOwnerVerdictDecision,
  readOwnerVerdict,
  recordOwnerVerdict,
} from "./verdict";

// Creates a temporary video package under the isolated test videos directory.
function makeTestPackage(slug: string, filmBody = JSON.stringify({ id: slug, title: slug })): string {
  const dir = path.join(getVideosDir(), slug);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "film.json"), filmBody, "utf8");
  return dir;
}

test("W3 owner verdict: parses publish, fix/publish-after-fixes, and reject decisions strictly", () => {
  assert.equal(parseOwnerVerdictDecision("publish"), "publish");
  assert.equal(parseOwnerVerdictDecision("fix"), "publish-after-fixes");
  assert.equal(parseOwnerVerdictDecision("publish-after-fixes"), "publish-after-fixes");
  assert.equal(parseOwnerVerdictDecision("reject"), "reject");
  assert.throws(() => parseOwnerVerdictDecision("auto-approve"), /Invalid owner verdict/);
});

test("W3 owner verdict: writes owner-verdict.json next to film.json, appends history, and invalidates approval when film.json changes", () => {
  const slug = "verdict-w3-happy";
  const dir = makeTestPackage(slug, JSON.stringify({ id: slug, title: "Draft 1" }));
  try {
    assert.equal(readOwnerVerdict(dir), null);

    const first = recordOwnerVerdict({
      slug,
      verdict: "fix",
      notes: ["Tighten opening line", "  ", "Caption a bit low"],
      pkgDir: dir,
      now: () => new Date("2026-11-21T01:00:00.000Z"),
    });
    assert.equal(first.schema, "aideos.owner-verdict/1");
    assert.equal(first.verdict, "publish-after-fixes");
    assert.equal(first.recordedBy, "owner");
    assert.deepEqual(first.notes, ["Tighten opening line", "Caption a bit low"]);
    assert.equal(first.history.length, 1);
    assert.equal(isOwnerApprovedForFilm(first, hashFileOrNull(path.join(dir, "film.json"))), false);

    // After fixes, the owner watches again and records publish.
    fs.writeFileSync(path.join(dir, "film.json"), JSON.stringify({ id: slug, title: "Draft 2" }), "utf8");
    const revisedHash = hashFileOrNull(path.join(dir, "film.json"));
    const second = recordOwnerVerdict({
      slug,
      verdict: "publish",
      notes: ["Looks great"],
      pkgDir: dir,
      now: () => new Date("2026-11-21T02:00:00.000Z"),
    });
    assert.equal(second.verdict, "publish");
    assert.equal(second.filmHash, revisedHash);
    assert.equal(second.history.length, 2);
    assert.equal(second.history[0].verdict, "publish-after-fixes");
    assert.equal(second.history[1].verdict, "publish");
    assert.equal(isOwnerApprovedForFilm(readOwnerVerdict(dir), revisedHash), true);

    // Editing film.json afterwards makes the owner's publish verdict stale.
    fs.writeFileSync(path.join(dir, "film.json"), JSON.stringify({ id: slug, title: "Draft 3" }), "utf8");
    const afterEditHash = hashFileOrNull(path.join(dir, "film.json"));
    assert.equal(isOwnerApprovedForFilm(readOwnerVerdict(dir), afterEditHash), false);
    assert.match(formatOwnerVerdict(second, afterEditHash), /stale: film\.json changed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("W3 owner verdict: automated acceptance.json approval never creates owner-verdict.json or owner approval", () => {
  const slug = "verdict-w3-no-auto";
  const dir = makeTestPackage(slug);
  try {
    const filmHash = hashFileOrNull(path.join(dir, "film.json"))!;
    applyEvents(dir, "long", [
      { type: "rendered", filmHash, mp4Hash: "mp4-1", at: "2026-11-21T00:00:00.000Z" },
      { type: "measured", mp4Hash: "mp4-1", passed: true, gateFailures: [], at: "2026-11-21T00:00:01.000Z" },
      {
        type: "judged",
        draw: {
          key: "round-1",
          mp4Hash: "mp4-1",
          score: 9.4,
          verdict: "ACCEPT",
          gatesPassed: true,
          passed: true,
          at: "2026-11-21T00:00:02.000Z",
        },
      },
      { type: "approved", mp4Hash: "mp4-1", at: "2026-11-21T00:00:03.000Z" },
    ]);
    assert.equal(readRecord(dir, "long").state, "accepted");
    assert.equal(fs.existsSync(ownerVerdictPath(dir)), false);
    assert.equal(readOwnerVerdict(dir), null);
    assert.equal(isOwnerApprovedForFilm(readOwnerVerdict(dir), filmHash), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("W3 owner verdict: rejects invalid slugs, missing packages, and non-owner recordedBy tampering", () => {
  assert.throws(() => recordOwnerVerdict({ slug: "../escape", verdict: "publish" }), /Invalid film slug/);
  assert.throws(() => recordOwnerVerdict({ slug: "no-such-film-xyz", verdict: "publish" }), /No video package found/);

  const slug = "verdict-w3-tamper";
  const dir = makeTestPackage(slug);
  try {
    fs.writeFileSync(
      ownerVerdictPath(dir),
      JSON.stringify({
        schema: "aideos.owner-verdict/1",
        slug,
        verdict: "publish",
        notes: [],
        filmHash: hashFileOrNull(path.join(dir, "film.json")),
        recordedBy: "all-check",
        recordedAt: "2026-11-21T00:00:00.000Z",
        history: [],
      }),
      "utf8",
    );
    assert.equal(readOwnerVerdict(dir), null, "a non-owner recordedBy value is never accepted as an owner verdict");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
