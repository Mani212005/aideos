/**
 * File Description: Unit tests for good-video rubric schema validation, criteria definitions, and summary formatting.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { loadGoodVideoRubric, parseRubric, RUBRIC_SUMMARY } from "./goodVideoRubric";

const REPO_ROOT = path.resolve(__dirname, "..");

test("loadGoodVideoRubric loads and parses all 12 rubric criteria successfully", () => {
  const jsonPath = path.join(REPO_ROOT, "docs", "good-video.rubric.json");
  const rubric = loadGoodVideoRubric(jsonPath);

  assert.equal(rubric.criteria.length, 12);

  for (const criterion of rubric.criteria) {
    assert.ok(criterion.id, "Criterion has id");
    assert.ok(criterion.name, "Criterion has name");
    assert.equal(typeof criterion.gate, "boolean", "Criterion has boolean gate");
    assert.ok(criterion.target, "Criterion has target");
    assert.ok(criterion.anchors["0"], "Criterion has anchor 0");
    assert.ok(criterion.anchors["2"], "Criterion has anchor 2");
    assert.ok(criterion.anchors["4"], "Criterion has anchor 4");

    // Validate that RUBRIC_SUMMARY includes each criterion id and name
    assert.ok(
      RUBRIC_SUMMARY.includes(`${criterion.id}. ${criterion.name}`),
      `RUBRIC_SUMMARY includes criterion ${criterion.id}. ${criterion.name}`
    );
  }
});

test("parseRubric rejects invalid or malformed rubric input", () => {
  assert.throws(() => parseRubric(null), /Invalid rubric/);
  assert.throws(() => parseRubric({}), /Invalid rubric/);
  assert.throws(() => parseRubric({ criteria: [{ id: "1" }] }), /Invalid rubric criterion/);
});
