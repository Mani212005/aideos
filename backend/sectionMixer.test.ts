/**
 * File Description: Checks the final music bed keeps tail headroom on lossy sources (the reel music-stem coverage bug).
 * Inputs and outputs: a fixture film with a library MP3 outro section -> the mixed span's distance from the source ending.
 * Used by: npm test (backend/**\/*.test.ts glob).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { deliveryTimeline } from "../src/dl/delivery";
import { LAST_SECTION_TAIL_HEADROOM_SEC, lastSectionTrimFrames, mixSections, soundtrackItem } from "../src/dl/audio/sectionMixer";
import { normalizeFilmSoundtrack, parseFilm } from "../src/dl/schema";
import { loadFixtureFilm } from "./testSupport/fixtureFilms";

test("the final MP3 bed stops 0.5 to 1.0 s before its source ends, so a short decode still covers the delivery", () => {
  const base = loadFixtureFilm("fixture-canvas-a");
  const item = soundtrackItem("mk-1023");
  const film = parseFilm({
    ...base,
    soundtrack: { sections: [{ item: item.id, from: 0, to: 20, role: "outro" }], sfx: [] },
  });
  const delivery = deliveryTimeline(film, "long");
  const [section] = mixSections(normalizeFilmSoundtrack(film), delivery);
  const trackFrames = Math.floor(item.durationSec * delivery.fps);
  const headroomSec = (trackFrames - (section.trimBefore + section.durationInFrames)) / delivery.fps;

  assert.ok(headroomSec >= 0.5 && headroomSec <= 1.0, `tail headroom ${headroomSec.toFixed(2)} s is outside 0.5 to 1.0 s`);
});

test("an exact PCM source is still back-timed to end exactly at the delivery end", () => {
  assert.equal(lastSectionTrimFrames(3000, 1000, 30, "videos/x/bed.wav"), 2000);
  assert.equal(lastSectionTrimFrames(3000, 1000, 30, "videos/.audio-library/mk-1.mp3"), 2000 - Math.round(LAST_SECTION_TAIL_HEADROOM_SEC * 30));
  assert.equal(lastSectionTrimFrames(900, 1000, 30, "videos/.audio-library/mk-1.mp3"), 0);
});
