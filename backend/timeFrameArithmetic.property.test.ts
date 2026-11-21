/**
 * File Description: Property tests of the pure time and frame arithmetic, run over seeded random inputs with the runner in testSupport/propertyTest.ts: the shot timeline (shots tile with no gap or overlap, every boundary stays within half a frame of its true time however many shots precede it, no shot is shorter than the minimum, the narration length is honoured), the millisecond grid for shot durations (every duration is whole milliseconds, they tile onto the narrated offsets and re-applying changes nothing), the delivered length with its end card (story plus card, card words inside the card) and caption placement clamping (idempotent, inside the bounds, lock kept).
 * Inputs and outputs: generated films, offsets and placements -> invariants hold for every seed, or a failure that names the seed and input.
 * Used by: npm test (found by glob), the CI unit job.
 */

import "./testSupport/fixtureVideosDir";
import assert from "node:assert/strict";
import test from "node:test";
import { buildTimeline, MIN_SHOT_FRAMES, totalFrames } from "../src/dl/camera";
import { CAPTION_FRAMES, DEFAULT_CAPTION_PLACEMENT_WIDTH_BY_FORMAT, captionBounds, clampCaptionPlacement, type CaptionFormat } from "../src/dl/captionPlacement";
import { deliveryTimeline } from "../src/dl/delivery";
import type { Film, Shot } from "../src/dl/schema";
import { shotDurationsOnMillisecondGrid } from "./pcm";
import { loadFixtureFilm } from "./testSupport/fixtureFilms";
import { forAll, pick, randFloat, randInt, type Rand } from "./testSupport/propertyTest";

const BASE_FILM = loadFixtureFilm("fixture-canvas-a");
/** The frame rates the film schema allows. */
const FPS_CHOICES: readonly Film["fps"][] = [24, 30, 60];
/** One frame of float slack when comparing frame positions to seconds times fps. */
const EPS = 1e-6;

/** A generated film: only the fields the timeline reads (fps, shots and the narration length). */
interface TimelineCase {
  fps: Film["fps"];
  durs: number[];
  narrationSec?: number;
}

// Builds the film a case describes from the fixture film (shots keep their other fields, ids are unique).
function filmOf(c: TimelineCase): Film {
  const template = BASE_FILM.shots[0];
  const shots: Shot[] = c.durs.map((dur, i) => ({ ...template, id: `s${i}`, dur, start: undefined, end: undefined, position: undefined, startSec: undefined }));
  return { ...BASE_FILM, fps: c.fps, shots, voiceover: c.narrationSec === undefined ? undefined : { src: "voiceover.wav", volume: 1, durationSec: c.narrationSec } };
}

// Draws 1 to 40 shots of at least `minDur` seconds, with or without a narration length.
function genTimeline(rand: Rand, minDur: number, narrated: boolean, narrationScale: [number, number] = [0.5, 1.6]): TimelineCase {
  const fps = pick(rand, FPS_CHOICES);
  const durs = Array.from({ length: randInt(rand, 1, 40) }, () => Number(randFloat(rand, minDur, 9).toFixed(randInt(rand, 0, 4))));
  const sum = durs.reduce((a, b) => a + b, 0);
  return { fps, durs, narrationSec: narrated ? Number(randFloat(rand, sum * narrationScale[0], sum * narrationScale[1]).toFixed(3)) : undefined };
}

test("shots tile the timeline from frame 0 with whole frames, none under the minimum", () => {
  forAll("timeline tiles", (rand) => genTimeline(rand, 0.05, rand() < 0.5), (c) => {
    const film = filmOf(c);
    const timeline = buildTimeline(film, film.voiceover?.durationSec);
    assert.equal(timeline.length, c.durs.length);
    assert.equal(timeline[0].from, 0);
    timeline.forEach((t, i) => {
      assert.ok(Number.isInteger(t.from) && Number.isInteger(t.to), `shot ${i} boundaries are whole frames`);
      assert.equal(t.to - t.from, t.durationInFrames, `shot ${i} duration is to - from`);
      assert.ok(t.durationInFrames >= MIN_SHOT_FRAMES, `shot ${i} is at least ${MIN_SHOT_FRAMES} frames`);
      if (i > 0) assert.equal(t.from, timeline[i - 1].to, `shot ${i} starts where shot ${i - 1} ends`);
    });
    assert.equal(totalFrames(timeline), timeline[timeline.length - 1].to);
  });
});

test("every shot boundary stays within half a frame of its true time, however many shots precede it", () => {
  // After scaling to the narration (0.9 to 1.6 times) every shot is at least one second, which never reaches the 15 frame minimum clamp at 24 fps or more, so the rounding bound is the only effect.
  forAll("no cumulative drift", (rand) => genTimeline(rand, 1.2, rand() < 0.5, [0.9, 1.6]), (c) => {
    const film = filmOf(c);
    const timeline = buildTimeline(film, film.voiceover?.durationSec);
    const baseTotal = c.durs.reduce((a, b) => a + b, 0);
    const scale = c.narrationSec === undefined ? 1 : c.narrationSec / baseTotal;
    let trueSec = 0;
    timeline.forEach((t, i) => {
      trueSec += c.durs[i] * scale;
      assert.ok(Math.abs(t.to - trueSec * c.fps) <= 0.5 + EPS, `shot ${i} ends at frame ${t.to}, true time is frame ${(trueSec * c.fps).toFixed(4)}`);
    });
    if (c.narrationSec !== undefined) assert.ok(Math.abs(totalFrames(timeline) - c.narrationSec * c.fps) <= 0.5 + EPS, "the timeline spans the narration");
  });
});

test("the millisecond grid gives whole-millisecond durations that tile onto the narrated offsets", () => {
  forAll(
    "ms grid tiles",
    (rand) => {
      const count = randInt(rand, 1, 40);
      let at = randFloat(rand, 0, 2);
      const starts: number[] = [];
      const durations: number[] = [];
      for (let i = 0; i < count; i++) {
        const length = randFloat(rand, 0.2, 8);
        starts.push(at);
        durations.push(length);
        at += length;
      }
      return { starts, durations };
    },
    ({ starts, durations }) => {
      const out = shotDurationsOnMillisecondGrid(starts, durations);
      assert.equal(out.length, starts.length);
      const ms = out.map((d) => Math.round(d * 1000));
      out.forEach((d, i) => assert.ok(Math.abs(d * 1000 - ms[i]) < 1e-6, `duration ${i} (${d}) is whole milliseconds`));
      // Summed up to any shot, the durations land exactly on that shot's narrated start (on the millisecond grid).
      let sum = 0;
      for (let i = 0; i < out.length; i++) {
        assert.equal(sum, Math.round(starts[i] * 1000) - Math.round(starts[0] * 1000), `shot ${i} starts on its narrated offset`);
        sum += ms[i];
      }
      assert.equal(sum, Math.round((starts[starts.length - 1] + durations[durations.length - 1]) * 1000) - Math.round(starts[0] * 1000), "the last shot ends where the narration does");
      assert.deepEqual(shotDurationsOnMillisecondGrid(starts, out), out, "re-applying to its own output changes nothing");
    },
  );
});

test("the millisecond grid refuses offsets and durations of different lengths and accepts none", () => {
  assert.deepEqual(shotDurationsOnMillisecondGrid([], []), []);
  forAll("ms grid length mismatch", (rand) => ({ a: randInt(rand, 0, 6), b: randInt(rand, 0, 6) }), ({ a, b }) => {
    const call = () => shotDurationsOnMillisecondGrid(Array.from({ length: a }, (_, i) => i), Array.from({ length: b }, () => 1));
    if (a === b) assert.equal(call().length, a);
    else assert.throws(call, /do not match/);
  });
});

test("the delivered length is the story plus the end card, and the card's words sit inside the card", () => {
  forAll(
    "delivery timeline",
    (rand) => {
      const c = genTimeline(rand, 0.3, rand() < 0.7);
      const wordCount = randInt(rand, 0, 12);
      let t = 0;
      const words = Array.from({ length: wordCount }, (_, i) => {
        const start = t + randFloat(rand, 0, 0.4);
        const end = start + randFloat(rand, 0.05, 0.6);
        t = end;
        return { word: `w${i}`, start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) };
      });
      return { c, words, format: pick(rand, ["long", "reel"] as const), voiced: wordCount > 0 && rand() < 0.8 };
    },
    ({ c, words, format, voiced }) => {
      const film: Film = { ...filmOf(c), endCardVoice: voiced ? { src: "voice.wav", text: "line", durationSec: words[words.length - 1].end + 0.1, fingerprint: "f", words } : undefined };
      const timeline = buildTimeline(film, film.voiceover?.durationSec);
      const delivery = deliveryTimeline(film, format, { timeline });
      assert.equal(delivery.storyFrames, totalFrames(timeline));
      assert.ok(Number.isInteger(delivery.totalFrames));
      if (!delivery.card) {
        assert.equal(delivery.totalFrames, delivery.storyFrames);
        return;
      }
      assert.equal(delivery.card.from, delivery.storyFrames, "the card starts after the story");
      assert.equal(delivery.card.to, delivery.totalFrames);
      assert.equal(delivery.card.to - delivery.card.from, delivery.card.durationInFrames);
      assert.ok(delivery.card.durationInFrames > 0);
      let previousStart = delivery.card.from;
      for (const w of delivery.cardWords) {
        assert.ok(w.startFrame >= delivery.card.from && w.startFrame < delivery.card.to, `word ${w.text} starts inside the card`);
        assert.ok(w.endFrame > w.startFrame && w.endFrame <= delivery.card.to, `word ${w.text} ends after it starts and inside the card`);
        assert.ok(w.startFrame >= previousStart, "words stay in spoken order");
        previousStart = w.startFrame;
      }
      assert.equal(delivery.card.lineFrom === null, !voiced, "a spoken line is placed exactly when the film carries one");
    },
  );
});

test("clamping a caption placement is idempotent, lands inside the format's bounds and keeps the lock", () => {
  forAll(
    "caption clamp",
    (rand) => {
      const withWidth = rand() < 0.6;
      return { format: pick(rand, ["long", "reel"] as CaptionFormat[]), x: randFloat(rand, -3, 4), y: randFloat(rand, -3, 4), w: withWidth ? randFloat(rand, -0.5, 1.5) : undefined, locked: rand() < 0.3 };
    },
    ({ format, x, y, w, locked }) => {
      const placement = { x, y, ...(w === undefined ? {} : { w }), locked };
      const once = clampCaptionPlacement(placement, format);
      const { width, height } = CAPTION_FRAMES[format];
      assert.equal(once.locked, locked, "the lock is kept");
      assert.equal(once.w === undefined, w === undefined, "an automatic width stays automatic");
      assert.ok([once.x, once.y].every(Number.isFinite), "the position is finite");
      const bounds = captionBounds(format, width, height, once.w ?? DEFAULT_CAPTION_PLACEMENT_WIDTH_BY_FORMAT[format], once.y, once.w === undefined ? 0 : undefined);
      assert.ok(once.y >= bounds.minY - EPS && once.y <= bounds.maxY + EPS, `y ${once.y} is inside [${bounds.minY}, ${bounds.maxY}]`);
      assert.ok(once.x >= Math.min(bounds.minX, bounds.maxX) - EPS && once.x <= Math.max(bounds.minX, bounds.maxX) + EPS, `x ${once.x} is inside [${bounds.minX}, ${bounds.maxX}]`);
      if (once.w !== undefined) assert.ok(once.w >= bounds.minW - EPS && once.w <= bounds.maxW + EPS, `width ${once.w} is inside [${bounds.minW}, ${bounds.maxW}]`);
      assert.deepEqual(clampCaptionPlacement(once, format), once, "clamping twice equals clamping once");
    },
  );
});
