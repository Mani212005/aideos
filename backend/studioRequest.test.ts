/**
 * File Description: Behavioural tests for Studio request hygiene: which ids may become folder names, and that a JSON body is read only up to its cap, however it arrives.
 * Inputs and outputs: ids, headers and chunked body streams -> assertions on isSafeId, bodyLimitFor, declaredBodyTooLarge and readJsonBody.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  BodyTooLargeError,
  bodyLimitFor,
  declaredBodyTooLarge,
  DEFAULT_BODY_LIMIT_BYTES,
  isSafeId,
  readJsonBody,
  resolveInside,
  safeDecodeURIComponent,
  UPLOAD_BODY_LIMIT_BYTES,
} from "./studioRequest";

test("isSafeId accepts film ids and refuses anything that could leave the videos folder", () => {
  for (const id of ["kv-cache", "beat-01", "a", "2026-recap"]) assert.equal(isSafeId(id), true, id);
  for (const id of ["", "..", "../etc", "a/b", "a\\b", "Upper", "with space", "a.b", "a\0b", "x\n", undefined, null, 7, ["a"], {}]) {
    assert.equal(isSafeId(id), false, JSON.stringify(id));
  }
});

test("resolveInside keeps a served file path inside its folder and refuses every way out", () => {
  const root = path.resolve("/srv/videos");
  assert.equal(resolveInside(root, "kv-cache/voiceover.wav"), path.join(root, "kv-cache", "voiceover.wav"));
  assert.equal(resolveInside(root, "kv-cache/../beat-01/film.json"), path.join(root, "beat-01", "film.json"), "a step back that stays inside is fine");
  for (const escape of ["../secret", "kv-cache/../../secret", "/etc/passwd", "../videos-evil/x", "a\0b"]) {
    assert.equal(resolveInside(root, escape), null, escape);
  }
});

test("safeDecodeURIComponent decodes valid percent-encoding and returns null instead of throwing on a broken one", () => {
  assert.equal(safeDecodeURIComponent("a%20b%2Fc"), "a b/c");
  assert.equal(safeDecodeURIComponent("%E0%A4%A"), null);
});

test("only the media upload route gets the large body cap", () => {
  assert.equal(bodyLimitFor("/api/media/upload"), UPLOAD_BODY_LIMIT_BYTES);
  assert.equal(bodyLimitFor("/api/media/upload?x=1"), UPLOAD_BODY_LIMIT_BYTES);
  assert.equal(bodyLimitFor("/api/films/kv-cache"), DEFAULT_BODY_LIMIT_BYTES);
  assert.equal(bodyLimitFor(undefined), DEFAULT_BODY_LIMIT_BYTES);
});

test("a request that announces a body past its cap is refused up front, one that fits or says nothing is not", () => {
  const over = String(DEFAULT_BODY_LIMIT_BYTES + 1);
  assert.equal(declaredBodyTooLarge({ "content-length": over }, "/api/films/x"), true);
  assert.equal(declaredBodyTooLarge({ "content-length": over }, "/api/media/upload"), false);
  assert.equal(declaredBodyTooLarge({ "content-length": String(UPLOAD_BODY_LIMIT_BYTES + 1) }, "/api/media/upload"), true);
  assert.equal(declaredBodyTooLarge({ "content-length": "120" }, "/api/films/x"), false);
  assert.equal(declaredBodyTooLarge({}, "/api/films/x"), false);
  assert.equal(declaredBodyTooLarge({ "content-length": "abc" }, "/api/films/x"), false);
});

test("readJsonBody joins chunks (even one split inside a multi-byte character) and parses them", async () => {
  const bytes = Buffer.from(JSON.stringify({ title: "café ✓", n: 3 }), "utf8");
  const split = bytes.indexOf(0xc3) + 1;
  const parsed = await readJsonBody(Readable.from([bytes.subarray(0, split), bytes.subarray(split)]), 1024);
  assert.deepEqual(parsed, { title: "café ✓", n: 3 });
});

test("readJsonBody stops at the cap even when the body has no Content-Length, and never reads the rest", async () => {
  let produced = 0;
  async function* endless(): AsyncGenerator<Buffer> {
    while (true) {
      produced += 1;
      yield Buffer.alloc(1024, 0x20);
    }
  }
  await assert.rejects(readJsonBody(endless(), 10 * 1024), (error: unknown) => error instanceof BodyTooLargeError && error.status === 413);
  assert.equal(produced, 11, "reading must stop on the chunk that crosses the cap");
});

test("readJsonBody accepts a body of exactly the cap and rejects one byte more", async () => {
  const body = Buffer.from(JSON.stringify({ pad: "x".repeat(90) }));
  assert.deepEqual(await readJsonBody(Readable.from([body]), body.length), JSON.parse(body.toString()));
  await assert.rejects(readJsonBody(Readable.from([body]), body.length - 1), BodyTooLargeError);
});

test("readJsonBody reports a body that is empty or not JSON", async () => {
  await assert.rejects(readJsonBody(Readable.from([]), 1024), /body is not JSON/);
  await assert.rejects(readJsonBody(Readable.from([Buffer.from("not json")]), 1024), /body is not JSON/);
});
