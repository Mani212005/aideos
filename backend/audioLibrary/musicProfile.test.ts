/**
 * File Description: Tests that the music profile measures what makes a bed compete with narration: the share of its energy in the speech band and the loudness swells, from level contours and from real tones rendered by ffmpeg.
 * Inputs and outputs: synthetic level contours and generated sine files -> midrange share and swell assertions.
 * Used by: npm test (backend/**\/*.test.ts glob).
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findSwells, measureMusicProfile, midrangeShareDb, profileFromLevels } from "./musicProfile";

// Builds a contour of 0.5 s windows: a flat level that steps by stepDb at the given window.
function contour(count: number, levelDb: number, steps: { at: number; db: number }[] = []): number[] {
  return Array.from({ length: count }, (_, i) => levelDb + steps.filter((step) => i >= step.at).reduce((sum, step) => sum + step.db, 0));
}

test("the speech band share is 0 dB when all the energy is in it and falls as the band loses energy", () => {
  const broadband = contour(100, -20);
  assert.equal(midrangeShareDb(broadband, contour(100, -20)), 0);
  assert.equal(midrangeShareDb(broadband, contour(100, -30)), -10);
  assert.throws(() => midrangeShareDb([], []), /at least one/);
});

test("a flat bed has no swell, and a slow drift over 40 s is not a swell", () => {
  assert.deepEqual(findSwells(contour(200, -20)), []);
  assert.deepEqual(findSwells(Array.from({ length: 200 }, (_, i) => -30 + (i / 199) * 12)), []);
});

test("a 12 dB jump is one swell with the right size and place, and ordinary 3 dB movement is not", () => {
  const swells = findSwells(contour(200, -30, [{ at: 80, db: 12 }]));
  assert.equal(swells.length, 1);
  assert.ok(Math.abs(swells[0].riseDb - 12) < 0.6, `rise ${swells[0].riseDb}`);
  assert.ok(swells[0].startSec >= 36 && swells[0].endSec <= 44, `${swells[0].startSec} to ${swells[0].endSec}`);
  assert.deepEqual(findSwells(contour(200, -30, [{ at: 80, db: 3 }])), []);
});

test("two separate jumps are two swells in time order, and a rise inside the first 3 s (the track's own fade in) is ignored", () => {
  const swells = findSwells(contour(300, -40, [{ at: 4, db: 20 }, { at: 100, db: 10 }, { at: 220, db: -10 }, { at: 221, db: 10 }, { at: 222, db: 10 }]));
  assert.equal(swells.length, 2);
  assert.ok(swells[0].startSec < swells[1].startSec);
  assert.ok(swells.every((swell) => swell.startSec >= 3));
});

test("profileFromLevels returns both measurements", () => {
  const profile = profileFromLevels(contour(200, -30, [{ at: 80, db: 12 }]), contour(200, -36, [{ at: 80, db: 12 }]));
  assert.equal(profile.swells.length, 1);
  assert.ok(profile.midrangeDb < -5.5 && profile.midrangeDb > -6.5, `midrange ${profile.midrangeDb}`);
});

test("measured from real tones: a 1 kHz tone sits in the speech band, a 100 Hz tone does not, and a 20 dB step is a swell", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-music-profile-"));
  try {
    const make = (name: string, source: string, filter: string): string => {
      const file = path.join(dir, name);
      execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", source, "-af", filter, file]);
      return file;
    };
    const mid = make("mid.wav", "sine=frequency=1000:duration=30:sample_rate=48000", "volume=0.5");
    const low = make("low.wav", "sine=frequency=100:duration=30:sample_rate=48000", "volume=0.5");
    const step = make("step.wav", "sine=frequency=1000:duration=30:sample_rate=48000", "volume='if(gte(t,15),0.5,0.05)':eval=frame");
    return Promise.all([measureMusicProfile(mid), measureMusicProfile(low), measureMusicProfile(step)]).then(([midProfile, lowProfile, stepProfile]) => {
      assert.ok(midProfile.midrangeDb > -1, `1 kHz tone ${midProfile.midrangeDb}`);
      assert.ok(lowProfile.midrangeDb < -30, `100 Hz tone ${lowProfile.midrangeDb}`);
      assert.deepEqual(midProfile.swells, []);
      assert.equal(stepProfile.swells.length, 1);
      assert.ok(stepProfile.swells[0].riseDb > 15 && stepProfile.swells[0].startSec > 11 && stepProfile.swells[0].endSec < 19, JSON.stringify(stepProfile.swells));
    }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
});
