/**
 * File Description: Behavior tests for the shared m:ss formatter (rounding mode, padding, minutes, clamping).
 * Inputs and outputs: sample seconds -> expected m:ss strings.
 * Used by: npm test (globbed backend/**\/*.test.ts).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { formatDurationSec } from "./formatDurationSec";

test("rounds to the nearest second by default (the screenplay and brief clocks)", () => {
  assert.equal(formatDurationSec(0), "0:00");
  assert.equal(formatDurationSec(5.4), "0:05");
  assert.equal(formatDurationSec(5.5), "0:06");
  assert.equal(formatDurationSec(59.6), "1:00");
  assert.equal(formatDurationSec(125), "2:05");
});

test("floors to the second that has begun in floor mode (the review evidence timestamps)", () => {
  assert.equal(formatDurationSec(5.9, "floor"), "0:05");
  assert.equal(formatDurationSec(59.9, "floor"), "0:59");
  assert.equal(formatDurationSec(60, "floor"), "1:00");
  assert.equal(formatDurationSec(3725.5, "floor"), "62:05");
});

test("negative and non-finite input reads as 0:00", () => {
  for (const bad of [-3, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(formatDurationSec(bad), "0:00");
    assert.equal(formatDurationSec(bad, "floor"), "0:00");
  }
});
