/**
 * File Description: Covers the captain's rule that every delivered video has music, sound effects and the call to action end card: the delivery gate refuses a film without them, the end card cannot be switched off per film, and the default effects land on real visual events within the design check limits.
 * Inputs and outputs: fixture films, an audio library and the end-card CLI command -> gate, delivery and default-effects assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { deliveryTimeline, endCardSeconds, parseDeliveryConfig } from "../src/dl/delivery";
import type { Film } from "../src/dl/schema";
import { loadAudioLibrary } from "./audioLibrary/library";
import { defaultEffects, hasExplicitEffects, hasExplicitMusic } from "./defaultSoundtrack";
import { assertDeliverable, deliveryGaps, DeliveryRefusedError } from "./deliveryGate";
import { checkSoundtrack } from "./designCheck/soundtrack";
import { soundtrackMixDefault } from "../src/dl/schema";
import { loadFixtureFilm } from "./testSupport/fixtureFilms";

const ROOT = path.resolve(__dirname, "..");

// A fixture film with a 20 s story and no audio of any kind.
function silentFilm(): Film {
  return { ...loadFixtureFilm("fixture-canvas-a"), voiceover: { src: "voiceover.wav", volume: 1, durationSec: 20 } };
}

// The same film carrying owner music and owner effects through the legacy fields.
function scoredFilm(): Film {
  return {
    ...silentFilm(),
    music: { src: "videos/x/audio/music.wav", volume: 1, duckUnderVoiceover: true },
    sfx: [{ src: "videos/x/audio/pop.wav", timeSec: 2, volume: 1 }],
  };
}

test("captain's rule: a film without music and sound effects is refused with a plain message", () => {
  const film = silentFilm();
  assert.deepEqual(deliveryGaps(film, "long").map((gap) => gap.requirement), ["music", "sound-effects"]);
  assert.throws(
    () => assertDeliverable([{ film, format: "long" }, { film, format: "reel" }]),
    (error: unknown) => {
      assert.ok(error instanceof DeliveryRefusedError);
      assert.match(error.message, /Delivery refused for "fixture-canvas-a"/);
      assert.match(error.message, /has no music/);
      assert.match(error.message, /has no sound effects/);
      assert.match(error.message, /aideos design build fixture-canvas-a/);
      assert.match(error.message, /aideos audio fetch/);
      assert.equal(error.gaps.length, 4, "each of the two formats names both gaps");
      return true;
    },
  );
});

test("captain's rule: owner music and owner effects satisfy the gate in both formats", () => {
  const film = scoredFilm();
  for (const format of ["long", "reel"] as const) assert.deepEqual(deliveryGaps(film, format), []);
  assertDeliverable([{ film, format: "long" }, { film, format: "reel" }]);
  assert.ok(hasExplicitMusic(film) && hasExplicitEffects(film));
});

test("captain's rule: the end card is compulsory, so a per-film off switch no longer removes it", () => {
  const film: Film = { ...scoredFilm(), endCard: { enabled: false } };
  for (const [format, sec] of [["long", 6], ["reel", 3]] as const) {
    assert.equal(endCardSeconds(film, format), sec);
    assert.ok(deliveryTimeline(film, format).card, `${format} keeps its card`);
    assert.deepEqual(deliveryGaps(film, format), []);
  }
});

test("captain's rule: a template with the end card turned off cannot deliver", () => {
  const config = parseDeliveryConfig({ endCard: { enabled: false } });
  const gaps = deliveryGaps(scoredFilm(), "long", config);
  assert.deepEqual(gaps.map((gap) => gap.requirement), ["end-card"]);
  assert.match(gaps[0].message, /compulsory and cannot be switched off per film/);
});

test("captain's rule: default effects sit on real visual events, end with the end card cue and pass the design check", () => {
  const film = silentFilm();
  const library = loadAudioLibrary();
  for (const format of ["long", "reel"] as const) {
    const sfx = defaultEffects(film, format, library);
    assert.ok(sfx.length >= 1, `${format} gets at least one effect`);
    assert.ok(sfx.every((effect) => effect.generated === true));
    assert.equal(sfx[sfx.length - 1].event, "end-card");
    assert.equal(sfx[sfx.length - 1].item, "card-arrive");
    const findings: Parameters<typeof checkSoundtrack>[1] = [];
    checkSoundtrack({ ...film, soundtrack: { sections: [], speech: [], mix: soundtrackMixDefault, sfx, credits: [] } }, findings, { formats: [format], library });
    assert.deepEqual(findings, [], findings.map((finding) => finding.message).join("\n"));
    assert.deepEqual(defaultEffects(film, format, library), sfx, "the choice is deterministic");
  }
});

test("captain's rule: aideos end-card <film> off is retired with a message saying the end card is compulsory", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "backend/cli.ts", "end-card", "fixture-canvas-a", "off"], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /The end card is compulsory/);
});
