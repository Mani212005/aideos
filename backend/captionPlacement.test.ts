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
import type { Scene } from "../src/dl/scene/types";
import { captionWordsForFilm } from "../src/dl/captionsParser";
import { checkCaptionPlacements } from "./designCheck/captionPlacement";
import { SUBTITLE_BAND_TOP_RATIO, subtitleCardBottom } from "../src/dl/fullScreenHeroLayout";
import {
  resolveCaptionPlacement,
  dragCaption,
  resizeCaption,
  carryCaptionPlacement,
  setCaptionPlacement,
  captionCardRect,
  captionCardHeight,
  resolveCaptionCardWidth,
  MIN_CAPTION_WIDTH,
} from "../src/dl/captionPlacement";
import { applyCaptionPlacementDraft } from "./designCheck/captionPlacement";
import { buildCaptionPhrases, fitCaptionWordToRow, captionWordRows } from "../src/dl/captionPhrases";
import {
  convertFilmToLayeredFilm,
  convertLayeredFilmToFilm,
} from "../src/dl/convertFilm";
const base = parseFilm(
  JSON.parse(fs.readFileSync("examples/hello-scene/film.json", "utf8")),
);
const top = { x: 0.5, y: 0.2, w: 0.7, locked: false };
// Keeps auto-width cards shrink-to-content and reserves the default envelope for geometry.
test("auto width keeps legacy sizing while explicit w 0.86 uses the fixed card", () => {
  const implicit = resolveCaptionPlacement(base, "long");
  assert.equal(implicit.w, undefined);
  const implicitSizing = resolveCaptionCardWidth(implicit, 1920);
  assert.equal(implicitSizing.fixed, false);
  assert.equal(implicitSizing.width, 1920 * 0.86);
  assert.equal(captionCardRect("long", 1920, 1080, implicit).w, implicitSizing.width);
  const explicit = resolveCaptionPlacement({ ...base, captionPlacement: { long: { ...top, w: 0.86 } } }, "long");
  const sizing = resolveCaptionCardWidth(explicit, 1920);
  assert.equal(sizing.fixed, true);
  assert.equal(sizing.width, 1920 * 0.86);
  assert.equal(captionCardRect("long", 1920, 1080, explicit).w, sizing.width);
  assert.equal(sizing.innerWidth, sizing.width - 58);
});
// Keeps first saves auto-sized for locking, moving and selecting shot scope.
test("first saves retain absent auto width while explicit resize enforces format minimums", () => {
  const implicit = resolveCaptionPlacement(base, "long");
  const shot = setCaptionPlacement(base, {
    format: "long",
    scope: { kind: "shot", shotId: base.shots[0].id },
    placement: { ...implicit, locked: true },
    owner: true,
  });
  assert.equal(shot.shots[0].captionPlacement?.long?.w, undefined);
  for (const format of ["long", "reel"] as const) {
    const frameWidth = format === "long" ? 1920 : 1080;
    const implicit = resolveCaptionPlacement(base, format);
    const locked = setCaptionPlacement(base, {
      format,
      scope: { kind: "film" },
      placement: { ...implicit, locked: true },
      owner: true,
    });
    assert.equal(resolveCaptionPlacement(locked, format).w, undefined);
    assert.equal(parseFilm(locked).captionPlacement?.[format]?.w, undefined);
    assert.equal(
      checkCaptionPlacements(locked).some((finding) => finding.rule === "caption-placement" && finding.severity === "error"),
      false,
    );

    const moved = setCaptionPlacement(base, {
      format,
      scope: { kind: "film" },
      placement: dragCaption({
        placement: implicit,
        format,
        dx: frameWidth * 0.01,
        dy: 0,
        scale: 1,
        snap: false,
      }),
      owner: true,
    });
    assert.equal(resolveCaptionPlacement(moved, format).w, undefined);

    const shot = setCaptionPlacement(base, {
      format,
      scope: { kind: "shot", shotId: base.shots[0].id },
      placement: implicit,
      owner: true,
    });
    assert.equal(resolveCaptionPlacement(shot, format, base.shots[0].id).w, undefined);

    const resized = resizeCaption({
      placement: implicit,
      format,
      edge: "right",
      dx: -frameWidth,
      scale: 1,
      snap: false,
    });
    assert.equal(resized.w, MIN_CAPTION_WIDTH[format]);
    const invalid = { ...base, captionPlacement: { [format]: { x: 0.5, y: 0.2, w: 0, locked: false } } };
    assert.throws(() => parseFilm(invalid));
    const negative = { ...base, captionPlacement: { [format]: { x: 0.5, y: 0.2, w: -0.1, locked: false } } };
    assert.throws(() => parseFilm(negative));
  }
});
// Restricts caption checks to server-loaded scene assets for the active package.
test("caption check applies draft placements to active disk film without body scene data", () => {
  const active = {
    ...base,
    id: "active-film",
    scene: { renderer: "svg", props: [{ assetId: "trusted" }] },
    captionPlacement: { long: top },
  } as typeof base;
  const request = {
    ...base,
    id: "active-film",
    scene: { renderer: "svg", props: [{ assetId: "body-injected" }] },
    captionPlacement: { long: { ...top, x: 0.4 } },
    shots: base.shots.map((shot, index) => ({
      ...shot,
      captionPlacement: index === 0 ? { long: { ...top, y: 0.3 } } : undefined,
    })),
  } as typeof base;
  const draft = applyCaptionPlacementDraft(request, active);
  assert.equal(draft.scene, active.scene);
  assert.equal(draft.title, active.title);
  assert.deepEqual(draft.captionPlacement, request.captionPlacement);
  assert.deepEqual(draft.shots[0].captionPlacement, request.shots[0].captionPlacement);
  assert.deepEqual(draft.shots[1].captionPlacement, active.shots[1].captionPlacement);
  assert.throws(() => applyCaptionPlacementDraft({ ...request, id: "other-film" }, active), /active film/);
});
// Keeps the legacy default and each format independent while resolving shot exceptions first.
test("caption resolver: defaults, format independence, shot precedence and lock", () => {
  assert.deepEqual(resolveCaptionPlacement(base, "long"), {
    x: 0.5,
    y: 0.78,
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
  assert.equal(snapped.x, 0.49);
  const vertical = dragCaption({
    placement: { ...top, x: 0.51, y: 0.44 },
    format: "long",
    dx: 0,
    dy: 8,
    scale: 1,
    snap: true,
  });
  assert.equal(vertical.x, 0.51);
  const unchangedResize = resizeCaption({
    placement: { ...top, w: 0.85 },
    format: "long",
    edge: "right",
    dx: 0,
    scale: 1,
    snap: true,
  });
  assert.equal(unchangedResize.w, 0.85);
});

// An explicit default-valued width is fixed while absent width stays auto.
test("explicit default values obey format bounds while absent width stays auto", () => {
  const implicit = resolveCaptionPlacement(base, "reel");
  const explicit = resolveCaptionPlacement({
    ...base,
    captionPlacement: { reel: { x: 0.5, y: 0.78, w: 0.86, locked: false } },
  }, "reel");
  assert.equal(implicit.x, 0.5);
  assert.equal(implicit.w, undefined);
  assert.notEqual(explicit.w, 0.86);
  assert.equal(setCaptionPlacement(base, { format: "reel", scope: { kind: "film" }, placement: { x: 0.5, y: 0.78, w: 0.86, locked: false }, owner: true }).captionPlacement?.reel?.w, explicit.w);
});

// Keeps an untouched gesture axis fixed when safe-area clamping would otherwise shift it.
test("horizontal drag and width resize preserve the original vertical position", () => {
  const implicit = resolveCaptionPlacement(base, "long");
  assert.equal(dragCaption({ placement: implicit, format: "long", dx: 12, dy: 0, scale: 1, snap: false }).y, implicit.y);
  assert.equal(dragCaption({ placement: implicit, format: "long", dx: 0, dy: 12, scale: 1, snap: false }).x, implicit.x);
  assert.equal(resizeCaption({ placement: implicit, format: "long", edge: "right", dx: -12, scale: 1, snap: false }).y, implicit.y);
});
// Verifies rebuild carry-forward, owner reset and agent protection for locked placements.
test("rebuild and agent writes preserve locks while owners can reset them", () => {
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
  const unlocked = { ...base, captionPlacement: { long: top } };
  const movedFilm = { ...base, captionPlacement: { long: { ...top, y: 0.4 } } };
  assert.equal(
    carryCaptionPlacement(unlocked, movedFilm, { owner: false, agentEdit: true }).captionPlacement?.long?.y,
    0.4,
  );
  const unlockedShot = {
    ...base,
    shots: base.shots.map((shot, index) => index === 0 ? { ...shot, captionPlacement: { reel: top } } : shot),
  };
  const movedShot = {
    ...unlockedShot,
    shots: unlockedShot.shots.map((shot, index) => index === 0 ? { ...shot, captionPlacement: { reel: { ...top, y: 0.4 } } } : shot),
  };
  assert.equal(
    carryCaptionPlacement(unlockedShot, movedShot, { owner: false, agentEdit: true }).shots[0].captionPlacement?.reel?.y,
    0.4,
  );
  const lockedFilm = { ...unlocked, captionPlacement: { long: { ...top, locked: true } } };
  assert.equal(
    carryCaptionPlacement(lockedFilm, movedFilm, { owner: false, agentEdit: true }).captionPlacement?.long?.y,
    top.y,
  );
  const lockedShot = {
    ...base,
    shots: base.shots.map((shot, index) => index === 0
      ? { ...shot, captionPlacement: { reel: { ...top, locked: true } } }
      : shot),
  };
  const movedLockedShot = {
    ...lockedShot,
    shots: lockedShot.shots.map((shot, index) => index === 0
      ? { ...shot, captionPlacement: { reel: { ...top, y: 0.4 } } }
      : shot),
  };
  assert.equal(
    carryCaptionPlacement(lockedShot, movedLockedShot, { owner: false }).shots[0].captionPlacement?.reel?.y,
    top.y,
  );
  assert.equal(
    carryCaptionPlacement(lockedShot, movedLockedShot, { owner: false, agentEdit: true }).shots[0].captionPlacement?.reel?.y,
    top.y,
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
  for (const [width, height] of [[1920, 1080], [1080, 1920]] as const)
    assert.equal(
      subtitleCardBottom(width, height),
      height * SUBTITLE_BAND_TOP_RATIO + captionCardHeight(width, height),
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
  assert.ok(result.slice(0, -1).every((phrase, i) => phrase.endFrame < result[i + 1].startFrame));
  assert.equal(captionPhraseAtFrame(result, result[1].startFrame)?.startFrame, result[1].startFrame);
});

// Checks current shot art against the card anchored by the phrase's first word.
test("full design check uses the phrase start placement against art in the next shot", () => {
  const film = {
    ...base,
    captions: "WEBVTT\n\n00:00:00.800 --> 00:00:01.300\nA phrase\n",
    shots: [
      { ...base.shots[0], id: "caption-origin", dur: 1, scriptText: "A phrase", captionPlacement: { long: top } },
      { ...base.shots[0], id: "art-shot", dur: 1, scriptText: "Next shot", captionPlacement: { long: { ...top, y: 0.6 } } },
    ],
  } as typeof base;
  const scene: Scene = {
    ...(base.scene as Scene),
    durationFrames: 60,
    audioDurationMs: 2000,
    props: [{
      ...base.scene!.props[0],
      position: { x: 960, y: 640 },
      scale: 1,
      animation: {
        timelineId: "enter-in-shot-b",
        clips: [{ clipId: "enter", targets: ["nodes"], property: "opacity", from: 0, to: 1, startFrame: 30, durationFrames: 1, easing: "linear" }],
      },
    }],
  };
  const findings = checkCaptionPlacements(film, scene);
  assert.ok(findings.some((finding) => finding.where === "shot caption-origin / long / nodes" && /frame 3[0-9]/.test(finding.message)), JSON.stringify(findings));
});

test("CanvasGraph placement reports that graph art needs manual review", () => {
  const graphFilm = { ...base, scene: undefined, captionPlacement: { long: top } };
  const findings = checkCaptionPlacements(graphFilm);
  assert.ok(findings.some((finding) =>
    finding.rule === "caption-placement" &&
    finding.severity === "warning" &&
    finding.where === "CanvasGraph / long" &&
    /not checked against CanvasGraph art/.test(finding.message),
  ), JSON.stringify(findings));
});

test("long unbreakable caption tokens stay within the planned card width", () => {
  const longToken = "vectorquantizationcachemissrecovery";
  for (const format of ["long", "reel"] as const) {
    const width = format === "long" ? 1920 : 1080;
    const placement = { ...top, w: MIN_CAPTION_WIDTH[format], source: "film" as const };
    const innerWidth = resolveCaptionCardWidth(placement, width).innerWidth;
    const measure = (text: string) => text === longToken ? innerWidth + 80 : 60;
    assert.deepEqual(fitCaptionWordToRow(longToken, innerWidth, measure), {
      kind: "fits",
      rowWidth: innerWidth,
      maxWidth: innerWidth - 12,
    });
    assert.deepEqual(captionWordRows([
      { text: longToken, startFrame: 0, endFrame: 10 },
      { text: "next", startFrame: 11, endFrame: 20 },
    ], innerWidth, measure), [1]);
    const phrases = buildCaptionPhrases({
      words: [
        { text: longToken, startFrame: 0, endFrame: 10 },
        { text: "next", startFrame: 11, endFrame: 20 },
      ],
      fps: 30,
      fontSize: 45,
      width,
      placementAt: () => placement,
      measure,
    });
    assert.deepEqual(phrases[0].words.map((word) => word.text), [longToken, "next"]);
    assert.deepEqual(phrases[0].lineBreaks, [1]);
    assert.deepEqual(phrases[0].unfittableWords, []);
    assert.ok((phrases[0].wordMaxWidths[0] ?? 0) <= innerWidth - 12);
  }
});

test("unfittable caption words produce a named design warning", () => {
  const longToken = "x".repeat(200);
  const film = {
    ...base,
    scene: undefined,
    captions: `WEBVTT\n\n00:00:00.000 --> 00:00:00.700\n${longToken}`,
    captionPlacement: {
      long: { ...top, w: MIN_CAPTION_WIDTH.long },
    },
  };
  const finding = checkCaptionPlacements(film).find((entry) =>
    entry.rule === "caption-placement" &&
    entry.severity === "warning" &&
    entry.where === `shot ${base.shots[0].id} / long` &&
    entry.message.includes(longToken),
  );
  assert.ok(finding, "expected the design check to name the shot and impossible word");
});

// Rejects arbitrary filesystem paths at the geometry reader boundary.
test("caption geometry rejects absolute and traversing SVG sources", async () => {
  const path = await import("node:path");
  const { resolveCaptionSvgSource } = await import("./designCheck/insetRegion");
  assert.throws(() => resolveCaptionSvgSource("/etc/passwd.svg", "demo"), /only accepts package visuals SVG paths/);
  assert.throws(() => resolveCaptionSvgSource("examples/demo/visuals/../../../../etc/passwd.svg", "demo"), /only accepts package visuals SVG paths/);
  assert.throws(() => resolveCaptionSvgSource("examples/hello-scene/visuals/nodes.svg", "inset-stage"), /must belong to package/);
  const videosDir = fs.mkdtempSync(path.join(process.cwd(), ".caption-svg-scope-test-"));
  const packageDir = path.join(videosDir, "caption-scope-test");
  const otherPackageDir = path.join(videosDir, "other-package");
  const visualsDir = path.join(packageDir, "visuals");
  const priorVideosDir = process.env.AIDEOS_VIDEOS_DIR;
  fs.mkdirSync(visualsDir, { recursive: true });
  fs.mkdirSync(path.join(otherPackageDir, "visuals"), { recursive: true });
  fs.writeFileSync(path.join(packageDir, "film.json"), "{}");
  fs.writeFileSync(path.join(otherPackageDir, "film.json"), "{}");
  fs.writeFileSync(path.join(otherPackageDir, "visuals", "private.svg"), '<svg><text id="other-film-secret">private label</text></svg>');
  fs.rmSync(visualsDir, { recursive: true });
  fs.symlinkSync(path.join(otherPackageDir, "visuals"), visualsDir);
  process.env.AIDEOS_VIDEOS_DIR = videosDir;
  try {
    assert.throws(
      () => resolveCaptionSvgSource("videos/caption-scope-test/visuals/private.svg", "caption-scope-test"),
      (error: Error) => {
        assert.match(error.message, /authorized package/);
        assert.doesNotMatch(error.message, /other-film-secret|private label/);
        return true;
      },
    );
  } finally {
    if (priorVideosDir === undefined) delete process.env.AIDEOS_VIDEOS_DIR;
    else process.env.AIDEOS_VIDEOS_DIR = priorVideosDir;
    fs.rmSync(videosDir, { recursive: true, force: true });
  }
});

// Disabled caption sources do not create a review region that unrelated text could satisfy.
test("caption review omits placement geometry when rendering is disabled", async () => {
  const { prepareCaptionReview } = await import("./review/captionRegion");
  const { analyzeSample } = await import("./review/ocr");
  const { measureBottomCaptions } = await import("./geminiReview/facts");
  const placed = { ...base, captionPlacement: { long: top } };
  const captionsOff = prepareCaptionReview({ ...placed, captions: "off" }, 1920, 1080);
  const subtitlesOff = prepareCaptionReview({ ...placed, subtitles: false }, 1920, 1080);
  assert.equal(captionsOff, null);
  assert.equal(subtitlesOff, null);
  const words = ["one", "two", "three"].map((text, index) => ({ text, left: 100 + index * 100, top: 900, width: 70, height: 45, conf: 95 }));
  assert.equal(analyzeSample(words, null, 1920, 1080, 1, captionsOff).hasCaption, false);
  const measured = await measureBottomCaptions("unused.mp4", 4, 12, captionsOff);
  assert.equal(measured.hasCaptions, false);
  assert.match(measured.summary, /disabled/);
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
  const autoProgram = editProgramSchema.parse([{ ...op, placement: { x: 0.5, y: 0.2 } }]);
  const autoApplied = applyEditProgram(convertFilmToLayeredFilm(base), autoProgram);
  assert.equal(autoApplied.film.captionPlacement?.long?.w, undefined);
  assert.throws(() => editProgramSchema.parse([{ ...op, placement: { x: 0.5, y: 0.2, w: 0 } }]));
  const narrowProgram = editProgramSchema.parse([{
    ...op,
    placement: { x: 0.5, y: 0.2, w: 0.2 },
  }]);
  const narrowApplied = applyEditProgram(convertFilmToLayeredFilm(base), narrowProgram);
  assert.equal(narrowApplied.film.captionPlacement?.long?.w, MIN_CAPTION_WIDTH.long);
  const stored = { ...base, captionPlacement: { long: { ...top, y: 0.4 } } };
  const layered = convertFilmToLayeredFilm(stored);
  const applied = applyEditProgram(layered, program);
  assert.deepEqual(applied.film.captionPlacement?.long, top);
  const updatedFilm = convertLayeredFilmToFilm(applied.film, stored);
  assert.equal(carryCaptionPlacement(stored, updatedFilm, { owner: false }).captionPlacement?.long?.y, 0.4);
  assert.equal(carryCaptionPlacement(stored, updatedFilm, { owner: false, agentEdit: true }).captionPlacement?.long?.y, top.y);
  const shotStored = {
    ...base,
    shots: base.shots.map((shot, index) => index === 0 ? { ...shot, captionPlacement: { reel: { ...top, y: 0.4 } } } : shot),
  };
  const shotProgram = editProgramSchema.parse([{
    ...op,
    format: "reel",
    scope: { kind: "shot", shotId: shotStored.shots[0].id },
    placement: { x: top.x, y: top.y, w: top.w },
  }]);
  const shotApplied = applyEditProgram(convertFilmToLayeredFilm(shotStored), shotProgram);
  const updatedShotFilm = convertLayeredFilmToFilm(shotApplied.film, shotStored);
  assert.equal(updatedShotFilm.shots[0].captionPlacement?.reel?.y, top.y);
  assert.equal(carryCaptionPlacement(shotStored, updatedShotFilm, { owner: false, agentEdit: true }).shots[0].captionPlacement?.reel?.y, top.y);
  const locked = convertFilmToLayeredFilm({
    ...base,
    captionPlacement: { long: { ...top, locked: true } },
  });
  const refused = applyEditProgram(locked, program);
  assert.equal(refused.applied.length, 0);
  assert.match(refused.rejected[0].reason, /locked/i);
  assert.deepEqual(refused.film, locked);
  const lockedShot = convertFilmToLayeredFilm({
    ...base,
    shots: base.shots.map((shot, index) => index === 0
      ? { ...shot, captionPlacement: { reel: { ...top, y: 0.4, locked: true } } }
      : shot),
  });
  const refusedShot = applyEditProgram(lockedShot, shotProgram);
  assert.equal(refusedShot.applied.length, 0);
  assert.match(refusedShot.rejected[0].reason, /locked/i);
  assert.deepEqual(refusedShot.film, lockedShot);
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

// The scene-art cutoff y > 1260 is the intentional legacy default for every format whenever
// no placement is saved; per-format projection applies only where a placement is saved.
test("scene SVG preserves the intentional legacy y > 1260 default cutoff in Wide and Reel", async () => {
  const { checkFilmDesign } = await import("./designCheck/designCheck");
  for (const placed of ["long", "reel"] as const) {
    const defaultFormat = placed === "long" ? "reel" : "long";
    const film = structuredClone(base);
    film.captions = "bottom";
    film.subtitles = true;
    film.captionPlacement = { [placed]: top };
    const asset = film.scene!.props[0];
    asset.position.y = 1300;
    const findings = checkFilmDesign(film).findings;
    assert.ok(findings.some((f) => f.rule === "safe-area" && f.where === asset.assetId && f.message.includes(defaultFormat)), JSON.stringify(findings));
    film.captionPlacement = { long: top, reel: top };
    assert.equal(checkFilmDesign(film).findings.some((f) => f.rule === "safe-area" && f.where === asset.assetId), false);
  }
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

// Persists an AI split through the normal interpreter and non-owner writer path.
test("AI split descendants retain shot placement through film persistence", async () => {
  const { applyEditProgram } = await import("./editPlanner/interpreter");
  const { readFilm, writeFilm } = await import("./pipeline/filmStore");
  const id = "caption-ai-split-placement";
  const original = {
    ...base,
    id,
    shots: base.shots.map((shot, index) => index === 0
      ? { ...shot, captionPlacement: { long: top } }
      : shot),
  };
  writeFilm(id, original, { owner: true });
  const layered = convertFilmToLayeredFilm(readFilm(id)!);
  const source = layered.clips.find((clip) =>
    clip.kind === "animation" &&
    (clip.payload as { shotId?: string }).shotId === original.shots[0].id,
  )!;
  const split = applyEditProgram(layered, [{
    op: "split_at",
    clipId: source.id,
    atSec: source.position + (source.end - source.start) / 2,
  }]);
  assert.equal(split.rejected.length, 0);
  const updated = convertLayeredFilmToFilm(split.film, original);
  writeFilm(id, updated);
  const persisted = readFilm(id)!;
  const descendants = persisted.shots.filter((shot) => shot.id.startsWith(`${original.shots[0].id}-`));
  assert.equal(descendants.length, 2);
  assert.ok(descendants.every((shot) => shot.captionPlacement?.long?.y === top.y));
});

// Rebuilds from the saved base design and keeps owner placements before the design gate runs.
test("design rebuild keeps locked and unlocked owner placements", async () => {
  const { writeFilm, readFilm } = await import("./pipeline/filmStore");
  const { buildDesign } = await import("./designSpec/build");
  const { applyEditProgram } = await import("./editPlanner/interpreter");
  const { editProgramSchema } = await import("./editPlanner/schema");
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
    writeFilm(
      id,
      { ...readFilm(id)!, captionPlacement: { long: { ...top, locked: true }, reel: { ...top, y: 0.4 } } },
      { owner: true },
    );
    const rebuilt = buildDesign(id);
    assert.equal(rebuilt.state, "passed", JSON.stringify(rebuilt.errors));
    assert.deepEqual(readFilm(id)?.captionPlacement, {
      long: { ...top, locked: true },
      reel: { ...top, y: 0.4 },
    });

    const active = readFilm(id)!;
    const splitParentId = active.shots[0].id;
    const ownerPlaced = {
      ...active,
      captionPlacement: { long: { ...top, locked: true }, reel: top },
      shots: active.shots.map((shot, index) => index === 0
        ? { ...shot, captionPlacement: { long: { ...top, y: 0.3 }, reel: { ...top, y: 0.6 } } }
        : shot),
    };
    writeFilm(id, ownerPlaced, { owner: true });
    const layered = convertFilmToLayeredFilm(readFilm(id)!);
    const source = layered.clips.find((clip) =>
      clip.kind === "animation" &&
      (clip.payload as { shotId?: string }).shotId === splitParentId,
    )!;
    const split = applyEditProgram(layered, editProgramSchema.parse([{
      op: "split_at",
      clipId: source.id,
      atSec: source.position + (source.end - source.start) / 2,
    }]));
    assert.equal(split.rejected.length, 0);
    writeFilm(id, convertLayeredFilmToFilm(split.film, ownerPlaced), { owner: true });
    const splitChildren = readFilm(id)!.shots.filter((shot) => shot.id.startsWith(`${splitParentId}-`));
    assert.equal(splitChildren.length, 2);
    const splitBuild = buildDesign(id);
    assert.equal(splitBuild.state, "passed", JSON.stringify(splitBuild.errors));
    const rebuiltChildren = readFilm(id)!.shots.filter((shot) => shot.id.startsWith(`${splitParentId}-`));
    assert.equal(rebuiltChildren.length, 2);
    assert.ok(rebuiltChildren.every((shot) =>
      shot.captionPlacement?.long?.y === 0.3 && shot.captionPlacement?.reel?.y === 0.6,
    ));
    assert.deepEqual(readFilm(id)?.captionPlacement, { long: { ...top, locked: true }, reel: top });
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
