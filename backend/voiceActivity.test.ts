/**
 * File Description: Behavioural tests for the shared voice activity state machine and its two consumers, the music ducker and the music-under-voice checker.
 * Inputs and outputs: Short synthetic speech runs, frame levels and stem levels -> asserted states, transitions, ducking volumes and checker verdicts.
 * Used by: npm test (audit machine M5, one definition of speech for the ducker and the checker).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { calculateDuckingVolume } from "../src/dl/audio/ducking";
import { speechGain } from "../src/dl/audio/sectionMixer";
import { soundtrackMixDefault } from "../src/dl/schema";
import {
  HOLD_SEC, VoiceActivityError, activeRunsFromLevels, buildVoiceTimeline, rollupLevels, speechWindowFlags,
  transitionVoiceState, voiceStateAt, type VoiceEvent, type VoiceState,
} from "../src/dl/audio/voiceActivity";
import { compareStemFrames } from "./review/music";

// Builds 10 ms frame levels from [count, dB] blocks.
function frames(...blocks: Array<[number, number]>): number[] {
  return blocks.flatMap(([count, db]) => Array<number>(count).fill(db));
}

test("voice activity transitions: every row of the table, and impossible events throw", () => {
  const table: Array<[VoiceState, VoiceEvent, VoiceState]> = [
    ["gap", "active", "speech"], ["gap", "quiet", "gap"],
    ["speech", "active", "speech"], ["speech", "quiet", "pause"],
    ["pause", "active", "speech"], ["pause", "quiet", "pause"], ["pause", "hold-expired", "gap"],
  ];
  for (const [from, event, to] of table) assert.equal(transitionVoiceState(from, event), to, `${from} + ${event}`);
  assert.throws(() => transitionVoiceState("gap", "hold-expired"), VoiceActivityError);
  assert.throws(() => transitionVoiceState("speech", "hold-expired"), /Impossible voice activity transition: "hold-expired" while in "speech"/);
});

test("voice timeline: a short silence is a pause inside one phrase, a long one is a gap between phrases", () => {
  const timeline = buildVoiceTimeline([
    { startSec: 1, endSec: 2 }, { startSec: 2.3, endSec: 3 }, { startSec: 4, endSec: 5 },
  ]);
  assert.deepEqual(timeline.phrases, [{ startSec: 1, endSec: 3 }, { startSec: 4, endSec: 5 }]);
  assert.deepEqual(timeline.segments.map((s) => s.state), ["speech", "pause", "speech", "speech"]);
  assert.equal(voiceStateAt(timeline, 0.5), "gap", "lead-in");
  assert.equal(voiceStateAt(timeline, 1.5), "speech");
  assert.equal(voiceStateAt(timeline, 2), "speech", "a word edge is still speech");
  assert.equal(voiceStateAt(timeline, 2.15), "pause");
  assert.equal(voiceStateAt(timeline, 3.5), "gap", "a 1 s silence is a gap");
  assert.equal(voiceStateAt(timeline, 4.5), "speech");
  assert.equal(voiceStateAt(timeline, 9), "gap", "tail");
  assert.deepEqual(buildVoiceTimeline([]).phrases, []);
  const exact = buildVoiceTimeline([{ startSec: 0, endSec: 1 }, { startSec: 1 + HOLD_SEC, endSec: 3 }]);
  assert.equal(exact.phrases.length, 2, "a silence of exactly the hold time is a gap");
});

test("ducker: music stays down through a sub-second pause and rises only in a real gap", () => {
  const speechIntervals = [{ startSec: 1, endSec: 2 }, { startSec: 2.4, endSec: 3 }, { startSec: 6, endSec: 7 }];
  const at = (sec: number) => calculateDuckingVolume({
    frame: Math.round(sec * 30), fps: 30, totalFrames: 600, musicVolume: 1, speechIntervals,
  });
  assert.ok(Math.abs(at(2.2) - at(1.5)) < 1e-9, "0.4 s pause is ducked exactly like speech");
  assert.ok(Math.abs(at(1.5) - 0.25) < 1e-9);
  assert.ok(Math.abs(at(4.5) - 1) < 1e-9, "a long gap lets the music rise to full level");
  assert.ok(at(3.1) < 1 && at(3.1) > 0.25, "the release ramp starts after the phrase");
});

test("mixer gain: a pause inside a phrase keeps the music at its ducked level", () => {
  const timeline = buildVoiceTimeline([{ startSec: 1, endSec: 2 }, { startSec: 2.4, endSec: 3 }, { startSec: 8, endSec: 9 }]);
  const mix = soundtrackMixDefault;
  const ducked = speechGain(1.5, timeline, mix, 20);
  assert.equal(speechGain(2.2, timeline, mix, 20), ducked);
  assert.ok(speechGain(5.5, timeline, mix, 20) > ducked, "a gap lets the music up");
});

test("checker: 0.19 s of speech includes the window and its music gap is measured", () => {
  const narration = frames([40, -20], [19, -20], [21, -90], [40, -20]);
  const music = [-40, -35, -40];
  const result = compareStemFrames(narration, music);
  assert.equal(result.status, "measured");
  if (result.status !== "measured") return;
  assert.equal(result.speechWindows, 3, "any positive speech overlap includes the window");
  const windowDb = rollupLevels(narration, 40);
  assert.ok(Math.abs(result.minimumGapDb - (windowDb[1] - music[1])) < 1e-9);
  assert.equal(result.worstTimeSec, 0.4);
});

test("checker: music genuinely masking real speech still fails with its time", () => {
  const narration = frames([40, -20], [40, -20], [40, -20]);
  const result = compareStemFrames(narration, [-40, -24, -40]);
  assert.equal(result.status, "measured");
  if (result.status !== "measured") return;
  assert.ok(Math.abs(result.minimumGapDb - 4) < 1e-9);
  assert.equal(result.worstTimeSec, 0.4);
});

test("checker flags every speech-overlapping window and the ducker follows the shared timeline", () => {
  const narration = frames([60, -20], [20, -90], [50, -20], [100, -90], [60, -20]);
  const runs = activeRunsFromLevels(narration);
  const timeline = buildVoiceTimeline(runs);
  const windows = Math.ceil(narration.length / 40);
  const flags = speechWindowFlags(timeline, 0.4, windows);
  assert.ok(flags.some(Boolean));
  flags.forEach((isSpeech, i) => {
    if (!isSpeech) return;
    for (const t of [i * 0.4 + 0.05, i * 0.4 + 0.2, i * 0.4 + 0.35]) {
      const state = voiceStateAt(timeline, t);
      const volume = calculateDuckingVolume({
        frame: Math.round(t * 100), fps: 100, totalFrames: 100000, musicVolume: 1, speechIntervals: runs,
      });
      if (state !== "gap") assert.ok(volume <= 0.25 + 1e-9, `shared ${state} state at ${t}s stays ducked`);
    }
  });
});
