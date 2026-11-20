/**
 * File Description: Tests for W4 (single-source good-video rubric summary): verifies RUBRIC_SUMMARY is generated from docs/good-video.rubric.json and backend/review/thresholds.ts so design briefs always carry the real calibrated threshold (0.65, not 0.75) and current criterion names/targets.
 * Inputs and outputs: docs/good-video.rubric.json, THRESHOLDS, RUBRIC_SUMMARY -> assertions on summary accuracy and drift prevention.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { formatRubricSummary, loadGoodVideoRubric, RUBRIC_SUMMARY } from "./goodVideoRubric";
import { THRESHOLDS } from "./review/thresholds";

test("W4 rubric summary: states the real calibrated layout correlation threshold from THRESHOLDS, never 0.75", () => {
  assert.ok(
    RUBRIC_SUMMARY.includes(`median 2 s layout correlation >= ${THRESHOLDS.persistence.medianMin}`),
    "RUBRIC_SUMMARY must match THRESHOLDS.persistence.medianMin",
  );
  assert.doesNotMatch(RUBRIC_SUMMARY, /layout correlation >= 0\.75/);
});

test("W4 rubric summary: generated from docs/good-video.rubric.json with updated criteria 4 and 5", () => {
  const rubric = loadGoodVideoRubric();
  assert.equal(RUBRIC_SUMMARY, formatRubricSummary(rubric));
  assert.match(RUBRIC_SUMMARY, /4\. Camera that does something \(present, purposeful, settled\)/);
  assert.match(RUBRIC_SUMMARY, /5\. Captions at placed position \(default bottom\) \(pass\)/);

  // Even if a test rubric carries a stale correlation number, formatRubricSummary injects THRESHOLDS.persistence.medianMin.
  const drifted = {
    criteria: [
      {
        id: "1",
        name: "One persistent stage",
        gate: true,
        target: "stage-clear events <= 1 per 30 s; median 2 s layout correlation >= 0.99",
        anchors: {},
      },
    ],
  };
  assert.match(
    formatRubricSummary(drifted),
    new RegExp(`median 2 s layout correlation >= ${THRESHOLDS.persistence.medianMin}`),
  );
});
