/**
 * File Description: Verifies the D6 two-bed reel fallback and its restricted role boundaries.
 * Inputs and outputs: Parsed chaptered films and role-matched library metadata -> soundtrack findings.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parseFilm, type Film } from "../../src/dl/schema";
import { loadAudioLibrary } from "../audioLibrary/library";
import type { AudioLibrary } from "../audioLibrary/schema";
import { loadFixtureFilm } from "../testSupport/fixtureFilms";
import { checkSoundtrack } from "./soundtrack";

// Builds a three-chapter reel whose 33-second delivery needs two 30-second beds.
function reelPair(): Film {
  const base = loadFixtureFilm("fixture-canvas-a");
  const chapters = ["first", "middle", "last"];
  return parseFilm({ ...base, voiceover: undefined, chapters,
    shots: chapters.map((ch, index) => ({ ...base.shots[index], ch, dur: 10, start: undefined, end: undefined })),
    soundtrack: { sections: [
      { role: "reel", item: "reel-bed", from: 0, to: 10, crossfadeSec: 1.5 },
      { role: "reel", item: "reel-bed", from: 10, to: 33, crossfadeSec: 1.5 },
    ] },
  });
}

// Supplies music metadata with a matching reel role and no full-delivery source.
function reelLibrary(): AudioLibrary {
  const library = loadAudioLibrary();
  return { ...library, items: [{ ...library.items[0], id: "reel-bed", roles: ["reel"], durationSec: 30 }] };
}

// Returns the checker's observable messages for the selected delivery format.
function errors(film: Film, library = reelLibrary(), format: "long" | "reel" = "reel"): string[] {
  const findings: Parameters<typeof checkSoundtrack>[1] = [];
  checkSoundtrack(film, findings, { formats: [format], library });
  return findings.map((finding) => finding.message);
}

test("D6: two reel beds cover multiple chapters when no eligible single bed fits", () => {
  assert.deepEqual(errors(reelPair()), []);
  const ineligible = reelLibrary();
  ineligible.items.push({ ...ineligible.items[0], id: "too-dynamic", durationSec: 60,
    loudness: { ...ineligible.items[0].loudness, lra: 11 } });
  assert.deepEqual(errors(reelPair(), ineligible), []);
});

test("D6: a full-span eligible reel bed precludes the two-bed exception", () => {
  const library = reelLibrary();
  library.items.push({ ...library.items[0], id: "full-reel", durationSec: 33 });
  assert.ok(errors(reelPair(), library).some((message) => message.includes('role "reel"')));
});

test("D6: the two-reel-bed exception requires exact chapter joins and full contiguous reel coverage", () => {
  for (const change of ["off-cut", "gap", "overlap", "opening", "ending", "mixed-role", "third-bed"]) {
    const film = reelPair();
    assert.ok(film.soundtrack);
    const sections = film.soundtrack.sections;
    if (change === "off-cut") sections[0].to = sections[1].from = 10 + 1 / film.fps;
    if (change === "gap") sections[0].to -= 1 / film.fps;
    if (change === "overlap") sections[0].to += 1 / film.fps;
    if (change === "opening") sections[0].from += 1 / film.fps;
    if (change === "ending") sections[1].to -= 1 / film.fps;
    if (change === "mixed-role") sections[0].role = "hook";
    if (change === "third-bed") {
      sections[1].to = 20;
      sections.push({ ...sections[1], from: 20, to: 33 });
    }
    assert.ok(errors(film).some((message) => message.includes('role "reel"')), change);
  }
  assert.ok(errors(reelPair(), reelLibrary(), "long").some((message) => message.includes('role "reel"')));
});
