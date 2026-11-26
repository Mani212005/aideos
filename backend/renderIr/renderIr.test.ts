/**
 * File Description: Behavioural tests of the Render IR validator: it holds the TypeScript side to the shared fixture verdicts that the Rust loader is also tested against (native/aideos-render-ir/tests/fixtures.rs), checks the version rejection path, round-trips every valid example unchanged, and fails when any committed JSON Schema drifts from the zod source.
 * Inputs and outputs: native/aideos-render-ir/fixtures/** and the committed JSON Schema -> pass or fail.
 * Used by: npm test (found by glob), the CI unit job.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { RENDER_IR_SCHEMA_PATH, RENDER_IR_SCHEMA_V2_PATH, RENDER_IR_SCHEMA_V3_PATH, RENDER_IR_SCHEMA_V4_PATH, RENDER_IR_SCHEMA_V5_PATH, renderIrJsonSchemaText, renderIrJsonSchemaV2Text, renderIrJsonSchemaV3Text, renderIrJsonSchemaV4Text, renderIrJsonSchemaV5Text } from "./jsonSchema";
import { parseRenderIr, validateRenderIr } from "./validate";

const FIXTURES = path.resolve(__dirname, "../../native/aideos-render-ir/fixtures");

type Expected =
  | { kind: "not_json" }
  | { kind: "unsupported_version"; found: string }
  | { kind: "invalid_document"; issues: Array<{ code: string; path?: string }> };
const expectations = JSON.parse(fs.readFileSync(path.join(FIXTURES, "expectations.json"), "utf8")) as { valid: string[]; invalid: Record<string, Expected> };

// Reads one fixture file as text.
const read = (rel: string) => fs.readFileSync(path.join(FIXTURES, rel), "utf8");
// Lists a fixture folder as folder/name.json, sorted.
const listing = (folder: string) => fs.readdirSync(path.join(FIXTURES, folder)).map((f) => `${folder}/${f}`).sort();

test("every fixture file is listed in the shared expectations", () => {
  assert.deepEqual([...expectations.valid].sort(), listing("valid"));
  assert.deepEqual(Object.keys(expectations.invalid).sort(), listing("invalid"));
});

test("valid fixtures load", () => {
  for (const rel of expectations.valid) {
    const result = parseRenderIr(read(rel));
    assert.ok(result.ok, `${rel} should load: ${JSON.stringify(result.ok ? "" : result.error)}`);
  }
});

test("invalid fixtures are refused with the verdict the Rust loader also gives", () => {
  for (const [rel, want] of Object.entries(expectations.invalid)) {
    const result = parseRenderIr(read(rel));
    assert.ok(!result.ok, `${rel} should be refused`);
    if (result.ok) continue;
    assert.equal(result.error.kind, want.kind, rel);
    if (want.kind === "unsupported_version" && result.error.kind === "unsupported_version") {
      assert.equal(result.error.found, want.found, rel);
      assert.equal(result.error.supported, "aideos.render/1, aideos.render/2, aideos.render/3, aideos.render/4, aideos.render/5, aideos.render/6");
    }
    if (want.kind === "invalid_document" && result.error.kind === "invalid_document") {
      const structural = want.issues.every((i) => i.path === undefined);
      if (structural) {
        assert.ok(result.error.issues.every((i) => i.code === "schema"), rel);
      } else {
        const key = (i: { code: string; path?: string }) => `${i.code} ${i.path}`;
        assert.deepEqual(result.error.issues.map(key).sort(), want.issues.map(key).sort(), rel);
      }
    }
  }
});

test("only the exact supported version string is read, and the rest of the document is not consulted for another", () => {
  for (const found of ["aideos.render/0", "aideos.render/1.1", "aideos.render/10", "AIDEOS.RENDER/1", ""]) {
    const result = validateRenderIr({ schema: found });
    assert.ok(!result.ok && result.error.kind === "unsupported_version" && result.error.found === found, found);
  }
});

test("a missing or non-string schema field is an invalid document, not an unsupported version", () => {
  for (const doc of [{}, { schema: 1 }, [1], "aideos.render/1", null]) {
    const result = validateRenderIr(doc);
    assert.ok(!result.ok && result.error.kind === "invalid_document", JSON.stringify(doc));
  }
});

test("the golden example declares both formats and the scene pieces", () => {
  const result = parseRenderIr(read("valid/tiny-scene.json"));
  assert.ok(result.ok);
  if (!result.ok) return;
  const { ir } = result;
  assert.deepEqual(ir.formats, { long: { width: 1920, height: 1080 }, reel: { width: 1080, height: 1920 } });
  assert.equal(ir.film.durationFrames, 90);
  assert.ok(ir.camera);
  assert.deepEqual(ir.overlay.map((n) => n.kind), ["group", "rail", "captions", "endCard"]);
});

test("the committed JSON Schema is the one the zod source produces", () => {
  assert.equal(fs.readFileSync(RENDER_IR_SCHEMA_PATH, "utf8"), renderIrJsonSchemaText(), "run `npm run render-ir:schema`");
});

test("the committed /2 JSON Schema is the one the zod source produces", () => {
  assert.equal(fs.readFileSync(RENDER_IR_SCHEMA_V2_PATH, "utf8"), renderIrJsonSchemaV2Text(), "run `npm run render-ir:schema`");
});

test("the committed /3 JSON Schema is the one the zod source produces", () => {
  assert.equal(fs.readFileSync(RENDER_IR_SCHEMA_V3_PATH, "utf8"), renderIrJsonSchemaV3Text(), "run `npm run render-ir:schema`");
});

test("the committed /5 JSON Schema is the one the zod source produces", () => {
  assert.equal(fs.readFileSync(RENDER_IR_SCHEMA_V5_PATH, "utf8"), renderIrJsonSchemaV5Text(), "run `npm run render-ir:schema`");
});

test("the /2 example and every /1 example survive a JSON round trip unchanged, keeping their version", () => {
  for (const rel of expectations.valid) {
    const original = JSON.parse(read(rel)) as { schema: string };
    const first = validateRenderIr(original);
    assert.ok(first.ok, rel);
    if (!first.ok) continue;
    assert.equal(first.ir.schema, original.schema, rel);
    const again = parseRenderIr(JSON.stringify(first.ir));
    assert.ok(again.ok, rel);
    if (again.ok) assert.deepEqual(again.ir, first.ir, rel);
  }
  const stage = (JSON.parse(read("valid/stage3d-minimal.json")) as { schema: string }).schema;
  assert.equal(stage, "aideos.render/2");
});

test("the committed /4 JSON Schema is the one the zod source produces", () => {
  assert.equal(fs.readFileSync(RENDER_IR_SCHEMA_V4_PATH, "utf8"), renderIrJsonSchemaV4Text(), "run `npm run render-ir:schema`");
});
