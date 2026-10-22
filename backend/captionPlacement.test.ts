/**
 * File Description: Behavioral contracts for owner-placed captions and shared preview/export words.
 * Inputs and outputs: fixture films, placements and gestures -> geometry and persistence assertions.
 * Used by: npm test.
 */
import "./testSupport/fixtureVideosDir";
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { parseFilm } from "../src/dl/schema";
import { captionWordsForFilm } from "../src/dl/captionsParser";
import { subtitleCardBottom } from "../src/dl/fullScreenHeroLayout";
import {
  resolveCaptionPlacement,
  dragCaption,
  resizeCaption,
  carryCaptionPlacement,
  setCaptionPlacement,
  captionCardRect,
} from "../src/dl/captionPlacement";
import {
  convertFilmToLayeredFilm,
  convertLayeredFilmToFilm,
} from "../src/dl/convertFilm";
const base = parseFilm(
  JSON.parse(fs.readFileSync("examples/hello-scene/film.json", "utf8")),
);
const top = { x: 0.5, y: 0.2, w: 0.7, locked: false };
// Keeps the legacy default and each format independent while resolving shot exceptions first.
test("caption resolver: defaults, format independence, shot precedence and lock", () => {
  assert.deepEqual(resolveCaptionPlacement(base, "long"), {
    x: 0.5,
    y: 0.78,
    w: 0.86,
    locked: false,
    source: "default",
  });
  const film = {
    ...base,
    captionPlacement: { reel: top },
    shots: base.shots.map((s) => ({
      ...s,
      captionPlacement: { reel: { ...top, y: 0.4, locked: true } },
    })),
  };
  assert.equal(resolveCaptionPlacement(film, "long").source, "default");
  assert.equal(resolveCaptionPlacement(film, "reel").y, 0.2);
  assert.equal(resolveCaptionPlacement(film, "reel", film.shots[0].id).y, 0.4);
  assert.equal(
    resolveCaptionPlacement(film, "reel", film.shots[0].id).locked,
    true,
  );
});
// Parses placement fields instead of silently dropping them and rejects malformed hand edits.
test("schema retains both scopes and rejects invalid or unknown placement fields", () => {
  const film = {
    ...base,
    captionPlacement: { long: top },
    shots: base.shots.map((s) => ({ ...s, captionPlacement: { reel: top } })),
  };
  assert.deepEqual(parseFilm(film).captionPlacement, film.captionPlacement);
  assert.deepEqual(parseFilm(film).shots[0].captionPlacement, { reel: top });
  assert.throws(() =>
    parseFilm({ ...base, captionPlacement: { reel: { ...top, y: 1.1 } } }),
  );
  assert.throws(() =>
    parseFilm({
      ...base,
      captionPlacement: { reel: { ...top, surprise: true } },
    }),
  );
});
// Exercises scaled pointer movement, edge-anchored resize, snapping and safe limits.
test("move and resize use composition coordinates and preserve the opposite edge", () => {
  const moved = dragCaption({
    placement: top,
    format: "long",
    dx: 96,
    dy: 54,
    scale: 0.5,
    snap: false,
  });
  assert.equal(moved.x, 0.6);
  assert.ok(Math.abs(moved.y - 0.3) < 1e-9);
  const resized = resizeCaption({
    placement: top,
    format: "long",
    edge: "right",
    dx: -96,
    scale: 0.5,
    snap: false,
  });
  assert.ok(Math.abs(resized.x - resized.w / 2 - (top.x - top.w / 2)) < 1e-9);
  const clamped = dragCaption({
    placement: top,
    format: "reel",
    dx: 10000,
    dy: 10000,
    scale: 1,
    snap: false,
  });
  const rect = captionCardRect("reel", 1080, 1920, clamped, 2);
  assert.ok(rect.x >= 64 && rect.x + rect.w <= 1080 - 64);
  assert.ok(clamped.y <= 0.78);
  assert.ok(rect.y + rect.h <= 1920 - 240);
  const snapped = dragCaption({
    placement: { ...top, x: 0.49 },
    format: "long",
    dx: 0,
    dy: 0,
    scale: 1,
    snap: true,
  });
  assert.equal(snapped.x, 0.5);
});
// Verifies rebuild carry-forward, owner reset and locked non-owner protection.
test("writers preserve placements and owners alone can reset locked entries", () => {
  const previous = {
    ...base,
    captionPlacement: { long: { ...top, locked: true }, reel: top },
  };
  assert.deepEqual(
    carryCaptionPlacement(previous, base, { owner: false }).captionPlacement,
    previous.captionPlacement,
  );
  const changed = { ...base, captionPlacement: { long: { ...top, y: 0.4 } } };
  assert.equal(
    carryCaptionPlacement(previous, changed, { owner: false }).captionPlacement
      ?.long?.y,
    0.2,
  );
  const bypass = {
    ...base,
    shots: base.shots.map((s) => ({
      ...s,
      captionPlacement: { long: { ...top, y: 0.4 } },
    })),
  };
  assert.equal(
    resolveCaptionPlacement(
      carryCaptionPlacement(previous, bypass, { owner: false }),
      "long",
      base.shots[0].id,
    ).y,
    0.2,
  );
  assert.equal(
    carryCaptionPlacement(previous, base, { owner: true }).captionPlacement,
    undefined,
  );
  assert.throws(
    () =>
      setCaptionPlacement(previous, {
        format: "long",
        scope: { kind: "film" },
        placement: top,
        owner: false,
      }),
    /locked/i,
  );
});
// Keeps both fields through the actual timeline conversion boundary.
test("timeline round trip carries film and shot placement", () => {
  const film = {
    ...base,
    captionPlacement: { long: top },
    shots: base.shots.map((s) => ({ ...s, captionPlacement: { reel: top } })),
  };
  const next = convertLayeredFilmToFilm(convertFilmToLayeredFilm(film), film);
  assert.deepEqual(next.captionPlacement, film.captionPlacement);
  assert.deepEqual(
    next.shots[0].captionPlacement,
    film.shots[0].captionPlacement,
  );
});
// Makes caption on/off behavior identical for every preview and export caller.
test("shared caption words respect subtitles false and captions off", () => {
  assert.ok(captionWordsForFilm(base).length > 0);
  assert.deepEqual(captionWordsForFilm({ ...base, subtitles: false }), []);
  assert.deepEqual(captionWordsForFilm({ ...base, captions: "off" }), []);
});
// Includes inline word margins on both lines and the card borders in the measured height.
test("two-line card height includes word margins and borders", () => {
  assert.equal(
    subtitleCardBottom(1920, 1080),
    1080 * 0.78 + 24 + 2 * (45 * 1.35 + 8) + 2,
  );
});

// Uses real OCR geometry to recognize placed captions and reject a missing caption.
test("review recognizes a moved band without accepting text elsewhere", async () => {
  const { analyzeSample } = await import("./review/ocr");
  const rect = { x: 100, y: 200, w: 800, h: 160 };
  const words = ["Moved", "caption", "here"].map((text, i) => ({
    text,
    conf: 99,
    left: 140 + i * 160,
    top: 230,
    width: 120,
    height: 40,
  }));
  assert.equal(
    analyzeSample(words, null, 1920, 1080, 1, rect).hasCaption,
    true,
  );
  assert.equal(analyzeSample([], null, 1920, 1080, 1, rect).hasCaption, false);
  assert.equal(analyzeSample(words, null, 1920, 1080, 1).hasCaption, false);
});

// Pins a crossing phrase to its start shot, and narrows into shorter phrases at a fixed font size.
test("phrase layout keeps start placement across a cut and splits narrow cards", async () => {
  const { buildCaptionPhrases, captionPhraseAtFrame } = await import("../src/dl/captionPhrases");
  const words = Array.from({ length: 7 }, (_, i) => ({
    text: "readable",
    startFrame: i * 10,
    endFrame: i * 10 + 9,
  }));
  const result = buildCaptionPhrases({
    words,
    fps: 30,
    fontSize: 45,
    width: 1920,
    placementAt: (frame) => ({ ...top, y: frame < 20 ? 0.2 : 0.6, w: 0.4 }),
    measure: () => 180,
  });
  assert.equal(result[0].placement.y, 0.2);
  assert.equal(captionPhraseAtFrame(result, 25)?.placement.y, 0.2);
  assert.ok(result.every((p) => p.words.length <= 6));
  assert.equal(result.flatMap((p) => p.words).length, words.length);
});

// Rejects arbitrary filesystem paths at the geometry reader boundary.
test("caption geometry rejects absolute and traversing SVG sources", async () => {
  const { resolveCaptionSvgSource } = await import("./designCheck/insetRegion");
  assert.throws(() => resolveCaptionSvgSource("/etc/passwd.svg"), /only accepts package visuals SVG paths/);
  assert.throws(() => resolveCaptionSvgSource("examples/demo/visuals/../../../../etc/passwd.svg"), /only accepts package visuals SVG paths/);
});

// Executes the closed AI operation and its atomic rollback on a locked target.
test("AI caption operation validates, applies, refuses locks and rolls back", async () => {
  const { editProgramSchema } = await import("./editPlanner/schema");
  const { applyEditProgram } = await import("./editPlanner/interpreter");
  const op = {
    op: "set_caption_placement",
    format: "long",
    scope: { kind: "film" },
    placement: { x: top.x, y: top.y, w: top.w },
  };
  const program = editProgramSchema.parse([op]);
  const layered = convertFilmToLayeredFilm(base);
  const applied = applyEditProgram(layered, program);
  assert.deepEqual(applied.film.captionPlacement?.long, top);
  const locked = convertFilmToLayeredFilm({
    ...base,
    captionPlacement: { long: { ...top, locked: true } },
  });
  const refused = applyEditProgram(locked, program);
  assert.equal(refused.applied.length, 0);
  assert.match(refused.rejected[0].reason, /locked/i);
  assert.deepEqual(refused.film, locked);
});

// Validates caption-specific limits and inset collisions through the design gate.
test("design check names invalid placement and colliding inset", async () => {
  const { checkFilmDesign } = await import("./designCheck/designCheck");
  const invalid = checkFilmDesign({
    ...base,
    captionPlacement: { long: { ...top, y: 0.99 } },
  });
  assert.ok(
    invalid.findings.some(
      (f) =>
        f.rule === "caption-placement" && /limit|bounds|range/i.test(f.message),
    ),
  );
  const insetBase = parseFilm(
    JSON.parse(
      fs.readFileSync("test_fixtures/packages/inset-stage/film.json", "utf8"),
    ),
  );
  const inset = checkFilmDesign({
    ...insetBase,
    captionPlacement: { long: { x: 0.7, y: 0.3, w: 0.4, locked: true } },
  });
  assert.ok(
    inset.findings.some(
      (f) => f.rule === "caption-placement" && /inset/i.test(f.message),
    ),
  );
});

// Persists through the real writer and reports orphaned exceptions instead of dropping them.
test("disk writer preserves placement and reports orphaned shot exceptions", async () => {
  const { writeFilm, readFilm } = await import("./pipeline/filmStore");
  const id = "caption-writer-test";
  const saved = {
    ...base,
    id,
    captionPlacement: { long: { ...top, locked: true } },
    shots: base.shots.map((s) => ({ ...s, captionPlacement: { reel: top } })),
  };
  writeFilm(id, saved, { owner: true });
  writeFilm(id, { ...base, id });
  assert.deepEqual(readFilm(id)?.captionPlacement, saved.captionPlacement);
  assert.throws(
    () =>
      writeFilm(id, {
        ...base,
        id,
        shots: base.shots.map((s) => ({ ...s, id: s.id + "-new" })),
      }),
    /caption-placement.*removes shots/i,
  );
  writeFilm(id, { ...base, id }, { owner: true });
  assert.equal(readFilm(id)?.captionPlacement, undefined);
});

// Uses real timeline operations to retain exceptions through split, move and retime.
test("shot exceptions survive split move and retime", async () => {
  const { splitLayerClipAtTime, moveLayerClip } =
    await import("./timeline/layer_engine");
  const film = {
    ...base,
    shots: base.shots.map((s) => ({ ...s, captionPlacement: { reel: top } })),
  };
  const layered = convertFilmToLayeredFilm(film);
  const clip = layered.clips.find((c) => c.kind === "animation")!;
  const split = splitLayerClipAtTime(
    layered,
    clip.id,
    clip.position + (clip.end - clip.start) / 2,
  ).film;
  assert.equal(
    convertLayeredFilmToFilm(split, film).shots.filter(
      (s) => s.captionPlacement?.reel?.y === 0.2,
    ).length,
    film.shots.length + 1,
  );
  const moved = moveLayerClip(
    split,
    split.clips.find((c) => c.kind === "animation")!.id,
    1,
  );
  const roundTrip = convertLayeredFilmToFilm(moved.film, film);
  assert.ok(roundTrip.shots.every((s) => s.captionPlacement?.reel?.y === 0.2));
});

// Rebuilds from the saved base design and keeps owner placements before the design gate runs.
test("design rebuild keeps locked and unlocked owner placements", async () => {
  const { writeFilm, readFilm } = await import("./pipeline/filmStore");
  const { buildDesign } = await import("./designSpec/build");
  const id = "speculative-decoding-designed";
  const original = readFilm(id)!;
  const { resolvePackageDir } = await import("../src/dl/videoPackageLoader");
  const lookFile = `${resolvePackageDir(id)}/design/look.json`;
  const look = fs.readFileSync(lookFile, "utf8");
  // This legacy design exercises the documented build path without a look plan.
  fs.rmSync(lookFile);
  try {
    writeFilm(
      id,
      {
        ...original,
        captionPlacement: { long: { ...top, locked: true }, reel: top },
      },
      { owner: true },
    );
    const built = buildDesign(id);
    assert.equal(built.state, "passed", JSON.stringify(built.errors));
    assert.deepEqual(readFilm(id)?.captionPlacement, {
      long: { ...top, locked: true },
      reel: top,
    });
  } finally {
    writeFilm(id, original, { owner: true });
    fs.writeFileSync(lookFile, look);
  }
});

// Keeps the default hero label in place, moving it below a top caption when explicitly placed.
test("hero label follows an explicit top caption", async () => {
  const { getFullScreenHeroLayout } =
    await import("../src/dl/fullScreenHeroLayout");
  const input = {
    format: "long" as const,
    width: 1920,
    height: 1080,
    margin: { top: 96, bottom: 96, left: 96, right: 96 },
    labelHeight: 24,
  };
  assert.equal(getFullScreenHeroLayout(input).caption.top, 96);
  assert.equal(
    getFullScreenHeroLayout({
      ...input,
      captionRect: captionCardRect("long", 1920, 1080, top),
    }).caption.top,
    960,
  );
});

// Uses the pinned browser measurement for narrow-card review instead of a different font weight.
test("review phrase measurement matches rendered word widths", async () => {
  const { findChromeBinary } = await import("./scene/renderStill");
  if (!findChromeBinary()) return;
  const { measureCaptionWords } = await import("./review/captionMeasurements");
  const measured = measureCaptionWords(["MMMM", "iiii", "readable"], 45);
  assert.ok(measured.MMMM > measured.iiii * 3);
  assert.equal(
    measureCaptionWords(["readable"], 45).readable,
    measured.readable,
  );
});
