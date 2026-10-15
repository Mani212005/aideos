/**
 * File Description: Regression tests for field-named schema diagnostics at authored union boundaries.
 * Inputs and outputs: malformed design, look and character data -> exact paths and short expected-value messages.
 * Used by: npm test and the CI unit job.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { fieldIssues } from "../src/dl/schemaIssues";
import { designSpecSchema } from "./designSpec/spec";
import { lookPlanSchema } from "./lookPlan/schema";
import { parseCharacter } from "../src/dl/characters/validate";
import { rawSpec } from "./testSupport/characters";

// Reads a small committed authoring fixture; no personal package or generated file is used.
function fixture(file: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, "../test_fixtures/packages/iona-receive/design", file), "utf8"));
}

// Formats the actual schema failure without allowing a successful parse to masquerade as a diagnostic test.
function errors(schema: z.ZodType, raw: unknown) {
  const parsed = schema.safeParse(raw);
  assert.equal(parsed.success, false);
  if (parsed.success) throw new Error("expected invalid fixture");
  return fieldIssues(parsed.error, raw);
}

test("design union errors keep the three branch and name nested unknown fields and expected values", () => {
  const raw = fixture("design.json");
  raw.performances[0].bogusField = 1;
  raw.performances[0].limits = "stretch";
  raw.assets[0].unitsToStage = "huge";
  const issues = errors(designSpecSchema, raw);
  assert.ok(issues.some((i) => i.path === "performances[0].bogusField" && /not a known field/.test(i.message)), JSON.stringify(issues));
  assert.ok(issues.some((i) => i.path === "performances[0].limits" && /"fail", "clamp"/.test(i.message)), JSON.stringify(issues));
  assert.ok(issues.some((i) => i.path === "assets[0].unitsToStage" && /expected number/.test(i.message)), JSON.stringify(issues));
  assert.ok(issues.every((i) => i.path !== "(root)" && !/Invalid input/.test(i.message)));
});

test("look union errors keep the author's branch even when several nested values are wrong", () => {
  const raw = fixture("look.json");
  raw.film.performances[0].actor = 12;
  raw.film.performances[0].decisive.edge = "middle";
  const issues = errors(lookPlanSchema, raw);
  assert.ok(issues.some((i) => i.path === "film.performances[0].actor" && /expected string/.test(i.message)), JSON.stringify(issues));
  assert.ok(issues.some((i) => i.path === "film.performances[0].decisive.edge" && /"start", "end"/.test(i.message)), JSON.stringify(issues));
});

test("character errors name missing required and unknown fields without losing array indices", () => {
  const raw = rawSpec("iona") as Record<string, any>;
  delete raw.skeleton.proportions.elbow;
  raw.parts[0].bogus = true;
  const issues = parseCharacter(raw).errors;
  assert.ok(issues.some((i) => i.path === "skeleton.proportions.elbow" && /required.*array/.test(i.message)), JSON.stringify(issues));
  assert.ok(issues.some((i) => i.path === "parts[0].bogus" && /not a known field/.test(i.message)), JSON.stringify(issues));
});

test("an unsupported file schema lists accepted versions once at the schema field", () => {
  const raw = fixture("design.json");
  raw.schema = "aideos.design/99";
  const issues = errors(designSpecSchema, raw);
  assert.ok(issues.some((i) => i.path === "schema" && /aideos.design\/2/.test(i.message) && /aideos.design\/1/.test(i.message)), JSON.stringify(issues));
});

test("an unknown character part type names the tag and allowed shapes", () => {
  const raw = rawSpec("iona") as Record<string, any>;
  raw.parts[0].type = "spaceship";
  const issues = parseCharacter(raw).errors;
  assert.ok(issues.some((i) => i.path === "parts[0].type" && /tube.*head.*panel/.test(i.message)), JSON.stringify(issues));
});

test("many invalid values cannot make diagnostics choose a different file version", () => {
  const schema = z.union([
    z.object({ schema: z.literal("b"), values: z.array(z.number()) }),
    z.object({ schema: z.literal("a"), values: z.array(z.string()) }),
  ]);
  const issues = errors(schema, { schema: "a", values: Array(1100).fill(1) });
  assert.equal(issues.length, 1100);
  assert.equal(issues[0].path, "values[0]");
  assert.ok(issues.every((i) => /expected string/.test(i.message)));
});
