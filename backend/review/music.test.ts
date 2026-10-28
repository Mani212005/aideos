/**
 * File Description: Checks the captain-approved D6 deterministic music-under-speech review standard.
 * Inputs and outputs: Isolated stem levels and rubric inputs -> pass, masking failure and unavailable verdicts.
 * Used by: npm test (decision D6, report step 9).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { compareStemLevels, type MusicUnderVoice } from "./music";
import { evaluateCriteria } from "./criteria";

// Evaluates the public rubric with a valid delivered mix and isolated bus measurements.
function criterion(musicUnderVoice: MusicUnderVoice) {
  return evaluateCriteria({
    video: { path: "d6.mp4", width: 1920, height: 1080, fps: 30, durationSec: 4, hasAudio: true, audioDurationSec: 4 },
    render: { persistence: null, stageClearTimes: [], hardCutTimes: [], staticRuns: [], meanCoverage: 0,
      samples: [], ocrRan: false },
    film: null, narration: null, loudness: { integratedLufs: -16, truePeakDb: -2 }, silences: [], musicUnderVoice,
  }).find((result) => result.key === "loudness");
}

test("D6 review: music 18 dB under speech passes; pauses do not dilute the measurement", () => {
  const result = compareStemLevels([-16, -Infinity, -16], [-34, -24, -34]);
  assert.equal(result.status, "measured");
  if (result.status !== "measured") return;
  assert.equal(result.minimumGapDb, 18);
  assert.ok(Math.abs(result.gapDb - 18) < 1e-9);
  assert.equal(result.speechWindows, 2);
  assert.equal(criterion(result)?.status, "pass");
  assert.equal(criterion(result)?.threshold.musicUnderVoiceMinDb, 12);
  assert.equal(criterion(result)?.threshold.musicUnderVoiceTargetDb, 18);
});

test("D6 review: a music swell less than 12 dB under voice fails with its measured time", () => {
  const result = compareStemLevels([-16, -16, -16], [-34, -22, -34]);
  const reviewed = criterion(result);
  assert.equal(reviewed?.status, "fail");
  assert.equal(reviewed?.metrics.musicMinimumGapDb, 6);
  assert.deepEqual(reviewed?.evidence, [{ t: 0.4, note: "music masks narration in this speech window" }]);
  assert.equal(criterion(compareStemLevels([-16], [-28]))?.status, "pass", "D6 rubric's exact 12 dB floor passes");
});

test("D6 review: unavailable stems cannot silently pass the mix rule; absent music needs no measurement", () => {
  assert.equal(criterion(compareStemLevels([-16], []))?.status, "fail");
  assert.equal(criterion(compareStemLevels([-Infinity], [-34]))?.status, "fail");
  assert.equal(criterion({ status: "absent" })?.status, "pass");
});
