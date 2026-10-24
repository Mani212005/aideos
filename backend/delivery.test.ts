/**
 * File Description: Covers src/dl/delivery.ts, the single source of each format's delivered length:
 * the committed end card and reel settings, the card span per format, total = story + card, the
 * global switch, and the spoken line's words placed inside the card.
 * Inputs and outputs: fixture films and config objects -> delivery timeline assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTimeline, totalFrames } from "../src/dl/camera";
import { DELIVERY_CONFIG, deliveredSeconds, deliveryTimeline, endCardSeconds, formatForSize, parseDeliveryConfig } from "../src/dl/delivery";
import type { Film } from "../src/dl/schema";
import { loadAideosConfig } from "./aideosConfig";
import { loadFixtureFilm } from "./testSupport/fixtureFilms";

// A fixture film with a voiceover length, so its story is a known number of frames.
function storyFilm(): Film {
  const film = loadFixtureFilm("fixture-canvas-a");
  return { ...film, voiceover: { src: "voiceover.wav", volume: 1, durationSec: 20 } };
}

// The same film carrying a spoken end card line of the given length and words.
function withLine(film: Film, durationSec: number, words: Array<[string, number, number]>): Film {
  return {
    ...film,
    endCardVoice: {
      src: "videos/x/endcard/voiceover.wav",
      text: words.map((w) => w[0]).join(" "),
      durationSec,
      fingerprint: "test",
      words: words.map(([word, start, end]) => ({ word, start, end })),
    },
  };
}

test("delivery: the committed config holds the captain's end card and the reel budget", () => {
  const card = DELIVERY_CONFIG.endCard;
  assert.equal(card.enabled, true);
  assert.deepEqual(card.durationSec, { long: 6, reel: 3 });
  assert.equal(card.label, "THANKS FOR WATCHING");
  assert.equal(card.headline, "Like and subscribe");
  assert.equal(card.like, "LIKE");
  assert.equal(card.subscribe, "SUBSCRIBE");
  assert.equal(card.handle, "@Mani_Jos");
  assert.equal(card.spokenLine, "If this helped, like and subscribe.");
  assert.deepEqual(DELIVERY_CONFIG.reel, { maxSec: 179, targetSec: 170 });
  // The Node loader validates the same sections through the same parser.
  assert.deepEqual(loadAideosConfig().delivery, DELIVERY_CONFIG);
});

test("delivery: absent sections take the defaults, bad values are named errors", () => {
  const defaults = parseDeliveryConfig({});
  assert.deepEqual(defaults.endCard.durationSec, { long: 6, reel: 3 });
  assert.equal(defaults.endCard.handle, "");
  assert.deepEqual(defaults.reel, { maxSec: 179, targetSec: 170 });
  assert.throws(() => parseDeliveryConfig({ reel: { maxSec: 160, targetSec: 170 } }), /targetSec must not exceed reel.maxSec/);
  assert.throws(() => parseDeliveryConfig({ endCard: { durationSec: { long: "six" } } }), /endCard.durationSec.long/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-delivery-"));
  const file = path.join(tmp, "c.json");
  const models = { generation: { agent: "claude", model: "m" }, reviewer: { agent: "agy", model: "r" } };
  fs.writeFileSync(file, JSON.stringify({ videoModels: models, endCard: { enabled: "yes" } }));
  assert.throws(() => loadAideosConfig(file), /endCard.enabled/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("delivery: each format is its story plus its own card", () => {
  const film = storyFilm();
  const story = totalFrames(buildTimeline(film, 20));
  assert.equal(story, 600);
  for (const [format, sec] of [["long", 6], ["reel", 3]] as const) {
    const d = deliveryTimeline(film, format);
    assert.equal(d.storyFrames, story);
    assert.deepEqual(d.card, { from: story, to: story + sec * 30, durationInFrames: sec * 30, lineFrom: null });
    assert.equal(d.totalFrames, story + sec * 30);
    assert.deepEqual(d.cardWords, []);
    assert.equal(deliveredSeconds(film, format), 20 + sec);
    assert.equal(endCardSeconds(film, format), sec);
  }
  // A prebuilt timeline is used as given, so a caller's own timeline and the delivery agree.
  const timeline = buildTimeline(film, 12);
  assert.equal(deliveryTimeline(film, "long", { timeline }).storyFrames, 360);
});

test("delivery: the switch off leaves the story alone, with no card and no words", () => {
  const film = withLine(storyFilm(), 2, [["like", 0, 0.5]]);
  const config = parseDeliveryConfig({ endCard: { enabled: false } });
  for (const format of ["long", "reel"] as const) {
    const d = deliveryTimeline(film, format, { config });
    assert.equal(d.card, null);
    assert.equal(d.totalFrames, d.storyFrames);
    assert.deepEqual(d.cardWords, []);
    assert.equal(endCardSeconds(film, format, config), 0);
  }
});

test("delivery: the spoken line's words are placed into the card at its delay", () => {
  const film = withLine(storyFilm(), 2.2, [["If", 0, 0.2], ["this", 0.25, 0.5], ["helped,", 0.55, 0.9], ["like", 1.0, 1.3], ["and", 1.35, 1.5], ["subscribe.", 1.55, 2.2]]);
  const d = deliveryTimeline(film, "long");
  const lineFrom = 600 + 9; // 0.3 s at 30 fps
  assert.equal(d.card?.lineFrom, lineFrom);
  assert.equal(d.cardWords.length, 6);
  assert.deepEqual(d.cardWords[0], { text: "If", startFrame: lineFrom, endFrame: lineFrom + 6 });
  assert.deepEqual(d.cardWords[5], { text: "subscribe.", startFrame: lineFrom + 47, endFrame: lineFrom + 66 });
  assert.ok(d.cardWords.every((w) => w.startFrame >= d.card!.from && w.endFrame <= d.card!.to));
});

test("delivery: a line too long for its delay starts earlier, and never runs past the card", () => {
  // 2.9 s in the 3 s reel card: the 0.3 s delay would run it past the end, so it starts at 0.
  const film = withLine(storyFilm(), 2.9, [["If", 0, 0.4], ["subscribe.", 2.4, 2.9]]);
  const reel = deliveryTimeline(film, "reel");
  assert.equal(reel.card?.lineFrom, 600);
  assert.ok(reel.cardWords.every((w) => w.endFrame <= reel.card!.to));
  // A line longer than the card keeps only the words that start inside it, clipped to its end.
  const long = withLine(storyFilm(), 4, [["If", 0, 0.4], ["subscribe.", 3.1, 4]]);
  const d = deliveryTimeline(long, "reel");
  assert.deepEqual(d.cardWords.map((w) => w.text), ["If"]);
});

test("delivery: the format follows the frame, like the design system's layout", () => {
  assert.equal(formatForSize(1920, 1080), "long");
  assert.equal(formatForSize(1080, 1920), "reel");
  assert.equal(formatForSize(1080, 1080), "long");
});
