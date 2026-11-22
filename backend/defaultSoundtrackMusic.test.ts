/**
 * File Description: Covers the default scorer's music choice end to end on a fixture film: the bed that leaves the voice room is chosen for every act, no bed plays twice in one film, and the same film and library always give the same score.
 * Inputs and outputs: a fixture film and the cached synthetic library with measured profiles -> the scored film's music sections.
 * Used by: npm test (backend/**\/*.test.ts glob).
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Film } from "../src/dl/schema";
import { loadAudioLibrary } from "./audioLibrary/library";
import type { AudioLibrary } from "./audioLibrary/schema";
import { scoreDefaultSoundtrack } from "./defaultSoundtrack";
import { loadFixtureFilm } from "./testSupport/fixtureFilms";

// A fixture film with a 20 s story, a voiceover and no audio of its own.
function silentFilm(): Film {
  return { ...loadFixtureFilm("fixture-canvas-a"), voiceover: { src: "voiceover.wav", volume: 1, durationSec: 20 } };
}

// The cached synthetic beds with measurements: a roomy one, a middling one and a crowded one with a swell (the seeded hash alone would pick b for the long hook and the reel).
function measuredLibrary(): AudioLibrary {
  const library = loadAudioLibrary();
  const profiles: Record<string, NonNullable<AudioLibrary["items"][number]["profile"]>> = {
    "test-music-a": { midrangeDb: -13, swells: [] },
    "test-music-b": { midrangeDb: -2, swells: [{ startSec: 5, endSec: 10, riseDb: 16 }] },
    "test-music-c": { midrangeDb: -5, swells: [] },
  };
  return { ...library, items: library.items.map((item) => (profiles[item.id] ? { ...item, profile: profiles[item.id] } : item)) };
}

test("the default score leaves the voice room: the roomy bed opens the film, the next best follows, the crowded swelling bed is never used", () => {
  const library = measuredLibrary();
  const long = scoreDefaultSoundtrack(silentFilm(), "long", library).soundtrack!.sections;
  assert.deepEqual(long.map((section) => section.item), ["test-music-a", "test-music-c"], "no bed plays twice, so the second act takes the next best");
  const reel = scoreDefaultSoundtrack(silentFilm(), "reel", library).soundtrack!.sections;
  assert.deepEqual(reel.map((section) => section.item), ["test-music-a"]);
});

test("the same film and library always give the same score", () => {
  const library = measuredLibrary();
  const first = scoreDefaultSoundtrack(silentFilm(), "long", library).soundtrack!.sections;
  assert.deepEqual(scoreDefaultSoundtrack(silentFilm(), "long", library).soundtrack!.sections, first);
});
