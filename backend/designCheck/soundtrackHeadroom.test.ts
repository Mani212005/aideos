/**
 * File Description: Verifies the design check holds a lossy final music bed to the same tail headroom the mixer applies.
 * Inputs and outputs: A one-bed reel film and library tracks of varying length -> soundtrack findings.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseFilm, type Film } from "../../src/dl/schema";
import { LAST_SECTION_TAIL_HEADROOM_SEC } from "../../src/dl/audio/sectionMixer";
import { loadAudioLibrary } from "../audioLibrary/library";
import type { AudioLibrary } from "../audioLibrary/schema";
import { loadFixtureFilm } from "../testSupport/fixtureFilms";
import { checkSoundtrack } from "./soundtrack";

// Builds a one-chapter reel with a single bed over its whole 33-second delivery.
function singleBedReel(): Film {
  const base = loadFixtureFilm("fixture-canvas-a");
  return parseFilm({ ...base, voiceover: undefined, chapters: ["only"],
    shots: [{ ...base.shots[0], ch: "only", dur: 30, start: undefined, end: undefined }],
    soundtrack: { sections: [{ role: "reel", item: "bed", from: 0, to: 33, crossfadeSec: 1.5 }] },
  });
}

// Supplies one reel bed whose source container and length the test chooses.
function libraryWith(durationSec: number, url: string): AudioLibrary {
  const library = loadAudioLibrary();
  return { ...library, items: [{ ...library.items[0], id: "bed", roles: ["reel"], durationSec, url }] };
}

// Returns the checker's source-length messages for the one-bed reel.
function lengthErrors(durationSec: number, url: string): string[] {
  const findings: Parameters<typeof checkSoundtrack>[1] = [];
  checkSoundtrack(singleBedReel(), findings, { formats: ["reel"], library: libraryWith(durationSec, url) });
  return findings.map((finding) => finding.message).filter((message) => message.includes("exceeding track length"));
}

test("a final lossy bed longer than the delivery by less than the tail headroom is flagged", () => {
  const short = 33 + LAST_SECTION_TAIL_HEADROOM_SEC / 2;
  assert.equal(lengthErrors(short, "https://example.test/bed.mp3").length, 1);
  assert.deepEqual(lengthErrors(33 + LAST_SECTION_TAIL_HEADROOM_SEC + 0.1, "https://example.test/bed.mp3"), []);
});

test("an exact PCM final bed needs no tail headroom", () => {
  assert.deepEqual(lengthErrors(33.1, "https://example.test/bed.wav"), []);
});
