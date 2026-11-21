/**
 * File Description: Expect test of the pure timeline and caption results: the shot timeline (buildTimeline), the delivered length with its end card in each format (deliveryTimeline), and the caption placement defaults, bounds and clamping in each format, all compared with the reviewed output captured from the real functions in test_fixtures/expect/timeline/. A changed frame boundary, card length or caption limit shows up as one changed line in the diff.
 * Inputs and outputs: the synthetic scene film, the fixture canvas film with a narration length, and a fixed list of caption placements -> equality with test_fixtures/expect/timeline/*.json.
 * Used by: npm test (found by glob), the CI unit job.
 */

import "./testSupport/fixtureVideosDir";
import test from "node:test";
import { buildTimeline } from "../src/dl/camera";
import { CAPTION_FRAMES, DEFAULT_CAPTION_PLACEMENT_BY_FORMAT, captionBounds, clampCaptionPlacement, type CaptionFormat } from "../src/dl/captionPlacement";
import { deliveryTimeline } from "../src/dl/delivery";
import type { Film } from "../src/dl/schema";
import { expectFile, formatForReview } from "./testSupport/expectFile";
import { loadFixtureFilm } from "./testSupport/fixtureFilms";
import { nativeSceneFilm } from "./testSupport/nativeSceneFilm";

// The shot timeline of a film (its narration length drives the scale, as in a real render) and its delivery in both formats.
function timelineReport(film: Film) {
  const timeline = buildTimeline(film, film.voiceover?.durationSec);
  return {
    film: { id: film.id, fps: film.fps, shots: film.shots.map((s) => ({ id: s.id, dur: s.dur })), narrationSec: film.voiceover?.durationSec ?? null },
    timeline: timeline.map((t) => ({ shot: t.shot.id, from: t.from, to: t.to, durationInFrames: t.durationInFrames, chapter: t.chapter })),
    delivery: { long: deliveryTimeline(film, "long", { timeline }), reel: deliveryTimeline(film, "reel", { timeline }) },
  };
}

test("the shot timeline and delivered length of the synthetic scene film match the reviewed output", () => {
  expectFile(formatForReview(timelineReport(nativeSceneFilm())), "timeline/native-probe.timeline.json");
});

test("the shot timeline and delivered length of a narrated canvas film match the reviewed output", () => {
  const film: Film = { ...loadFixtureFilm("fixture-canvas-a"), voiceover: { src: "voiceover.wav", volume: 1, durationSec: 73.4 } };
  expectFile(formatForReview(timelineReport(film)), "timeline/fixture-canvas-a.timeline.json");
});

test("caption placement defaults, bounds and clamping in both formats match the reviewed output", () => {
  const probes = [
    { x: 0.5, y: 0.5, locked: false },
    { x: -2, y: -2, locked: false },
    { x: 3, y: 3, locked: true },
    { x: 0.5, y: 0.9, w: 0.2, locked: false },
    { x: 0.1, y: 0.7, w: 0.95, locked: false },
  ];
  const report = Object.fromEntries((["long", "reel"] as CaptionFormat[]).map((format) => {
    const { width, height } = CAPTION_FRAMES[format];
    const fallback = DEFAULT_CAPTION_PLACEMENT_BY_FORMAT[format];
    return [format, {
      frame: { width, height },
      default: fallback,
      bounds: captionBounds(format, width, height, fallback.w ?? 0.86, fallback.y),
      clamped: probes.map((p) => ({ in: p, out: clampCaptionPlacement(p, format) })),
    }];
  }));
  expectFile(formatForReview(report), "timeline/caption-placement.json");
});
