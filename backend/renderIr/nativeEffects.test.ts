/**
 * File Description: Version and bounds checks for native transition and particle effects.
 * Inputs and outputs: committed effect documents and invalid variants -> TypeScript loader results.
 * Used by: npm test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RENDER_IR_VERSION_4, RENDER_IR_VERSION_EFFECTS } from "./schema";
import { validateRenderIr } from "./validate";
import { RENDER_IR_SCHEMA_EFFECTS_PATH, renderIrJsonSchemaEffectsText } from "./jsonSchema";

// Reads an actual native effects document shared with the renderer tests.
function fixture(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../native/aideos-render/fixtures/package/native-${name}.json`), "utf8"));
}

test("native effects require their version and match the generated schema", () => {
  assert.equal(fs.readFileSync(RENDER_IR_SCHEMA_EFFECTS_PATH, "utf8"), renderIrJsonSchemaEffectsText());
  for (const name of ["fade", "wipe", "particles"]) {
    const doc = fixture(name);
    assert.equal(doc.schema, RENDER_IR_VERSION_EFFECTS);
    assert.equal(validateRenderIr(doc).ok, true, name);
    assert.equal(validateRenderIr({ ...doc, schema: RENDER_IR_VERSION_4 }).ok, false, name);
  }
});

test("native effects reject unbounded or malformed parameters", () => {
  const transition = fixture("wipe");
  assert.equal(validateRenderIr({ ...transition, transition: { ...(transition.transition as object), durationFrames: 0 } }).ok, false);
  assert.equal(validateRenderIr({ ...transition, transition: { ...(transition.transition as object), kind: "arbitrary-sksl" } }).ok, false);
  const particles = fixture("particles");
  const emitter = (particles.particles as Record<string, unknown>[])[0];
  for (const bad of [{ count: 0 }, { count: 1001 }, { lifetimeFrames: 0 }, { seed: -1 }, { radius: 0 }, { gravity: 10001 }]) {
    assert.equal(validateRenderIr({ ...particles, particles: [{ ...emitter, ...bad }] }).ok, false, JSON.stringify(bad));
  }
});

// Checks one /6 document can use the earlier colour tracks and new particle emitter together.
test("effects compose with /5 colour and dash tracks", () => {
  const file = path.resolve(__dirname, "../../native/aideos-render-ir/fixtures/valid/color-and-dash.json");
  const prior = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = validateRenderIr({ ...prior, schema: RENDER_IR_VERSION_EFFECTS, particles: fixture("particles").particles });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.ir.particles?.length, 1);
    assert.equal(result.ir.stage[0].kind, "svg");
    if (result.ir.stage[0].kind === "svg") assert.equal(result.ir.stage[0].colorTracks?.length, 2);
  }
});
