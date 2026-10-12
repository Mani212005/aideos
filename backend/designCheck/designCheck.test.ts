/**
 * File Description: Tests for the design check.
 * Still Talking, the reference scene film, must pass cleanly; a copy of it broken one way per rule
 * must fail with that rule named, so every standard-layer rule is proven to fire.
 * Inputs and outputs: reference scene films and perturbed variants -> design check rule assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import { checkFilmDesign, checkFilmDesignById, offPaletteColours, type DesignRule } from "./designCheck";

const ROOT = path.resolve(__dirname, "../..");
const TMP = path.join(ROOT, ".tmp_design_check");

// Loads a fresh deep copy of the reference film.
function stillTalking(): any {
  return JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "still-talking/film.json"), "utf8"));
}

// Returns the distinct error rules a film trips.
function errorRules(film: unknown): DesignRule[] {
  return [...new Set(checkFilmDesign(film).findings.filter((f) => f.severity === "error").map((f) => f.rule))];
}

test("DesignCheck: the reference scene film passes with no findings", () => {
  const report = checkFilmDesignById("still-talking");
  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
  assert.ok(report.stats.clips > 200);
});

test("DesignCheck: a visible snap and a second transform origin are both caught", () => {
  const film = stillTalking();
  const probe = film.scene.props.find((p: any) => p.assetId === "probe");
  const moving = probe.animation.clips.find((c: any) => c.property === "translateX" || c.property === "rotate");
  const second = { ...moving, clipId: "snap-test", startFrame: moving.startFrame + moving.durationFrames + 5, durationFrames: 10, from: moving.to + 40, to: moving.to + 40 };
  probe.animation.clips.push(second);
  const scaled = probe.animation.clips.find((c: any) => c.origin);
  probe.animation.clips.push({ ...scaled, clipId: "origin-test", origin: { x: scaled.origin.x + 7, y: scaled.origin.y } });
  const rules = errorRules(film);
  assert.ok(rules.includes("continuity"), rules.join(","));
  assert.ok(rules.includes("origin"), rules.join(","));
});

test("DesignCheck: a counter must show a number that is actually spoken", () => {
  const film = stillTalking();
  const shot = film.shots.find((s: any) => s.blocks.some((b: any) => b.c === "StatCounter"));
  shot.blocks.find((b: any) => b.c === "StatCounter").to = 23;
  assert.deepEqual(errorRules(film), ["honest-data"]);
});

test("DesignCheck: the scene must run exactly as long as the narrated shots", () => {
  const film = stillTalking();
  film.scene.durationFrames += 100;
  assert.ok(errorRules(film).includes("audio-lock"));
});

test("DesignCheck: closing footage after the voice is a warning, a voiceover that disagrees is an error", () => {
  const film = JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "speculative-decoding-designed/design/base-film.json"), "utf8"));
  const last = film.shots[film.shots.length - 1];
  film.shots.push({ ...last, id: "closing-footage", dur: 5, scriptText: undefined });
  const report = checkFilmDesign(film);
  assert.ok(!report.findings.some((f) => f.severity === "error" && f.rule === "audio-lock"), JSON.stringify(report.findings));
  assert.ok(report.findings.some((f) => f.severity === "warning" && /closing-footage/.test(f.message)));
  film.voiceover.durationSec -= 10;
  assert.ok(errorRules(film).includes("audio-lock"));
});

test("DesignCheck: artwork must be static, self-contained, on palette and in the house typefaces", () => {
  fs.mkdirSync(TMP, { recursive: true });
  const file = path.join(TMP, "bad.svg");
  fs.writeFileSync(
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><g id="a"><rect id="r" fill="#FF3B30" width="10" height="10"/>` +
      `<text id="t" font-family="Arial">hi</text><image id="i" href="https://example.com/x.png"/><animate id="m" attributeName="x"/></g></svg>`,
  );
  try {
    const film = stillTalking();
    const prop = film.scene.props.find((p: any) => p.assetId === "sun");
    prop.svgSource = path.relative(ROOT, file);
    prop.animation = undefined;
    const rules = errorRules(film);
    for (const rule of ["palette", "typography", "static-art"] as DesignRule[]) assert.ok(rules.includes(rule), `${rule} missing from ${rules.join(",")}`);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test("DesignCheck: an invalid manifest reports the schema error instead of throwing", () => {
  const film = stillTalking();
  film.theme = { ...film.theme, background: "neon" };
  const report = checkFilmDesign(film);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0].rule, "schema");
});

test("DesignCheck: palette allows neutrals and the film accent, and flags other colours", () => {
  assert.deepEqual(offPaletteColours(`<rect fill="#141416"/><rect fill="#635BFF"/><rect fill="rgba(245,245,245,0.2)"/>`), []);
  assert.deepEqual(offPaletteColours(`<rect fill="#00C2A8"/>`), ["#00C2A8"]);
  assert.deepEqual(offPaletteColours(`<rect fill="#00C2A8"/>`, "#00C2A8"), []);
});

test("DesignCheck: camera moves must be present and speed-capped", () => {
  const film = { ...JSON.parse(JSON.stringify(stillTalking())), id: "camera-test" };
  
  // Valid camera
  film.scene.camera = {
    keyframes: [
      { frame: 0, center: { x: 500, y: 500 }, zoom: 1 },
      { frame: 100, center: { x: 550, y: 500 }, zoom: 1.2 }
    ]
  };
  const valid = checkFilmDesign(film);
  assert.equal(valid.findings.find(f => f.rule === "camera"), undefined);

  // No moves
  film.scene.camera = {
    keyframes: [
      { frame: 0, center: { x: 500, y: 500 }, zoom: 1 },
      { frame: 100, center: { x: 500, y: 500 }, zoom: 1 }
    ]
  };
  const nomove = checkFilmDesign(film);
  assert.ok(nomove.findings.some(f => f.rule === "camera" && f.message.includes("no moves")));

  // Too fast
  film.scene.camera = {
    keyframes: [
      { frame: 0, center: { x: 0, y: 0 }, zoom: 1 },
      { frame: 30, center: { x: 1000, y: 0 }, zoom: 1 }
    ]
  };
  // 1000 pixels in 30 frames = 1000 pixels in 1 second.
  // 20% of 1920 = 384 pixels/second. So it should fail.
  const fast = checkFilmDesign(film);
  assert.ok(fast.findings.some(f => f.rule === "camera" && f.message.includes("speed limit")));

  // Unsorted keyframes that exceed speed limit when ordered chronologically
  film.scene.camera = {
    keyframes: [
      { frame: 30, center: { x: 1000, y: 0 }, zoom: 1 },
      { frame: 0, center: { x: 0, y: 0 }, zoom: 1 }
    ]
  };
  const unsortedFast = checkFilmDesign(film);
  assert.ok(unsortedFast.findings.some(f => f.rule === "camera" && f.message.includes("speed limit")));
});

test("DesignCheck: an always-moving camera warns, while short moves separated by holds pass the motion-shape check", () => {
  const film = { ...JSON.parse(JSON.stringify(stillTalking())), id: "camera-hold-test" };
  const end = film.scene.durationFrames - 1;
  film.scene.camera = {
    keyframes: [
      { frame: 0, center: { x: 500, y: 500 }, zoom: 1 },
      { frame: Math.floor(end / 2), center: { x: 900, y: 500 }, zoom: 1.1 },
      { frame: end, center: { x: 1300, y: 500 }, zoom: 1.2 },
    ],
  };
  const alwaysMoving = checkFilmDesign(film).findings.filter((f) => f.rule === "camera");
  assert.ok(alwaysMoving.some((f) => /holds for/.test(f.message)), JSON.stringify(alwaysMoving));
  assert.ok(alwaysMoving.some((f) => /moves continuously/.test(f.message)), JSON.stringify(alwaysMoving));

  film.scene.camera = {
    keyframes: [
      { frame: 0, center: { x: 500, y: 500 }, zoom: 1 },
      { frame: 45, center: { x: 540, y: 500 }, zoom: 1.02 },
      { frame: 300, center: { x: 540, y: 500 }, zoom: 1.02 },
      { frame: 345, center: { x: 580, y: 500 }, zoom: 1.04 },
      { frame: end, center: { x: 580, y: 500 }, zoom: 1.04 },
    ],
  };
  const moveThenHold = checkFilmDesign(film).findings.filter((f) => f.rule === "camera" && /holds for|moves continuously/.test(f.message));
  assert.deepEqual(moveThenHold, []);
});

test("DesignCheck: camera arrivals warn when they miss the planned cue or framed object", () => {
  const film = stillTalking();
  film.scene.camera = { keyframes: [
    { frame: 0, center: { x: 500, y: 500 }, zoom: 1 },
    { frame: 100, center: { x: 510, y: 500 }, zoom: 1 },
  ] };
  const report = checkFilmDesign(film, { cameraTargets: [
    { frame: 0 },
    { frame: 300, focus: "probe", authoredFocus: "probe" },
  ] });
  assert.ok(report.findings.some((f) => f.rule === "camera" && /planned cue/.test(f.message)));
  assert.ok(report.findings.some((f) => f.rule === "camera" && /does not land near focused object/.test(f.message)));
});

test("DesignCheck: a planned carry-over change warns when it is brief or outside the held frame", () => {
  const film = stillTalking();
  const prop = film.scene.props.find((item: any) => item.assetId === "probe");
  const original = prop.animation.clips[0];
  const plan: any = {
    film: { cast: [{ id: "probe", what: "probe", enters: film.shots[0].id, changes: [{ at: film.shots[0].id, how: "moves clearly to the right", state: "probe settled on the right", magnitude: "major" }] }] },
    shots: film.shots.map((shot: any) => ({ id: shot.id })),
  };
  const end = film.scene.durationFrames - 1;
  // Makes a fixed camera track centered on the selected test subject.
  const camera = (center: { x: number; y: number }) => ({ keyframes: [
    { frame: 0, center, zoom: 1 },
    { frame: end, center, zoom: 1 },
  ] });
  prop.animation.clips = [{ ...original, clipId: "test-change", targets: [original.targets[0]], property: "translateX", from: 0, to: 140, startFrame: 10, durationFrames: 1 }];
  film.scene.camera = camera(prop.position);
  const passes = checkFilmDesign(film, { lookPlan: plan });
  assert.equal(passes.findings.some((f) => f.rule === "carry-over"), false, JSON.stringify(passes.findings));

  plan.film.cast[0].changes[0].at = film.shots[film.shots.length - 1].id;
  prop.animation.clips[0].startFrame = end - 40;
  const brief = checkFilmDesign(film, { lookPlan: plan });
  assert.ok(brief.findings.some((f) => f.rule === "carry-over" && /at least 2 seconds/.test(f.message)), JSON.stringify(brief.findings));

  prop.animation.clips[0].startFrame = end - 40;
  film.scene.camera = camera({ x: 0, y: 0 });
  const offCamera = checkFilmDesign(film, { lookPlan: plan });
  assert.ok(offCamera.findings.some((f) => f.rule === "carry-over" && /at least 2 seconds/.test(f.message)), JSON.stringify(offCamera.findings));
});

test("DesignCheck: a camera eased at every keyframe is caught as a jerk, the same poses un-eased pass", () => {
  const film = { ...JSON.parse(JSON.stringify(stillTalking())), id: "camera-jerk-test" };
  // The look-first proof film's poses: peak speed stays under the 384 px/s cap but each move bursts then stops.
  const poses: Array<[number, number, number, number]> = [
    [0, 960, 960, 1.0], [120, 840, 980, 1.22], [286, 845, 985, 1.25], [382, 960, 960, 1.0],
    [481, 960, 900, 1.15], [616, 960, 960, 1.0], [777, 975, 965, 1.02], [1017, 1000, 990, 1.05],
    [1095, 1070, 1020, 1.35], [1166, 1075, 1025, 1.37], [1226, 1030, 1010, 1.22], [1328, 960, 960, 1.02],
  ];
  const withEasing = (easing?: string) => ({
    keyframes: poses.map(([frame, x, y, zoom]) => ({ frame, center: { x, y }, zoom, ...(easing ? { easing } : {}) })),
  });

  film.scene.camera = withEasing("expoInOut");
  const jerky = checkFilmDesign(film).findings.filter((f) => f.rule === "camera");
  assert.ok(jerky.some((f) => f.message.includes("single frame")), "zoom burst not caught");
  assert.ok(jerky.some((f) => f.message.includes("accelerates")), "pan acceleration not caught");

  film.scene.camera = withEasing();
  assert.deepEqual(checkFilmDesign(film).findings.filter((f) => f.rule === "camera" && f.severity === "error"), []);
});

test("DesignCheck: scene camera survives parseFilm in schema", () => {
  const film = { ...JSON.parse(JSON.stringify(stillTalking())), id: "camera-schema-test" };
  film.scene.camera = {
    keyframes: [
      { frame: 0, center: { x: 500, y: 500 }, zoom: 1 },
      { frame: 100, center: { x: 550, y: 500 }, zoom: 1.2 }
    ]
  };
  const report = checkFilmDesign(film);
  assert.equal(report.findings.find(f => f.rule === "schema"), undefined);
  assert.equal(report.findings.find(f => f.rule === "camera"), undefined);
});

test("DesignCheck: placing an asset in the caption band of a captioned film is an error", () => {
  const film = stillTalking();
  // still-talking is a scene film. We place an asset low in the frame (e.g. y = 1300)
  const prop = film.scene.props[0];
  prop.position.y = 1300;
  
  // With captions disabled, it passes
  film.captions = "off";
  assert.ok(!errorRules(film).includes("safe-area"));
  
  // With captions enabled (or default), it fails
  film.captions = "bottom";
  assert.ok(errorRules(film).includes("safe-area"));
});

// Loads a fresh deep copy of the inset fixture: a scene film whose middle shot is a counter inset.
function insetStage(): any {
  return JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "inset-stage/film.json"), "utf8"));
}

// Returns the inset-rule error messages a film trips.
function insetErrors(film: unknown): string[] {
  return checkFilmDesign(film).findings.filter((f) => f.rule === "inset" && f.severity === "error").map((f) => f.message);
}

test("DesignCheck: an inset shot over a stage that keeps clear of the region passes", () => {
  const report = checkFilmDesignById("inset-stage");
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.deepEqual(report.findings.filter((f) => f.severity === "error"), []);
});

test("DesignCheck: art in the inset region during an inset shot fails, naming the format", () => {
  // Scene (1500, 700) is the wide cut's right third, and outside the reel's window.
  const wide = insetStage();
  wide.scene.props[0].position = { x: 1500, y: 700 };
  const wideErrors = insetErrors(wide);
  assert.ok(wideErrors.length > 0 && wideErrors.every((m) => /wide cut/.test(m) && /inset region/.test(m)), wideErrors.join("\n"));
  assert.equal(checkFilmDesign(wide).findings.find((f) => f.rule === "inset")!.where, "shot counter");

  // Scene (700, 1250) puts the rack in the reel's lower-middle band as well as the wide cut's right third.
  const reel = insetStage();
  reel.scene.props[0].position = { x: 960, y: 1250 };
  assert.ok(insetErrors(reel).some((m) => /reel cut/.test(m)), insetErrors(reel).join("\n"));
});

test("DesignCheck: the inset rule counts only art that is visible while the inset shot plays", () => {
  // Same offending placement, but the shot is a plain spine shot, so nothing is shared with a device.
  const spine = insetStage();
  spine.scene.props[0].position = { x: 1500, y: 700 };
  spine.shots[1].stage = "none";
  spine.shots[1].blocks = [];
  assert.deepEqual(insetErrors(spine), []);

  // Art that is faded out before the inset shot starts (frame 90) no longer occupies the region.
  const hidden = insetStage();
  hidden.scene.props[0].position = { x: 1500, y: 700 };
  hidden.scene.props[0].animation.clips.push({ clipId: "rack-out", targets: ["rack"], property: "opacity", from: 1, to: 0, startFrame: 80, durationFrames: 8, easing: "expoOut" });
  hidden.scene.props[0].animation.clips.push({ clipId: "rack-back", targets: ["rack"], property: "opacity", from: 0, to: 1, startFrame: 215, durationFrames: 8, easing: "expoOut" });
  assert.deepEqual(insetErrors(hidden), []);
});

test("DesignCheck: a camera that pushes art into the inset region is caught", () => {
  const film = insetStage();
  // The rack sits clear at the identity camera; a held zoom centred left of it slides it into the wide cut's right third.
  film.scene.camera = {
    keyframes: [
      { frame: 0, center: { x: 960, y: 960 }, zoom: 1 },
      { frame: 90, center: { x: 960, y: 960 }, zoom: 1 },
      { frame: 150, center: { x: 600, y: 960 }, zoom: 1.5 },
      { frame: 300, center: { x: 600, y: 960 }, zoom: 1.5 },
    ],
  };
  assert.ok(insetErrors(film).some((m) => /wide cut/.test(m)), "the zoomed rack should reach the region");
});

test("DesignCheck: stage inset is a scene-film device stage, not a card stage", () => {
  const cardInset = insetStage();
  cardInset.shots[1].blocks = [{ c: "TextReveal", text: "Three servers", size: "headline" }];
  assert.ok(errorRules(cardInset).includes("schema"));

  const twoDevices = insetStage();
  twoDevices.shots[1].blocks = [...twoDevices.shots[1].blocks, { c: "StatCounter", to: 3, label: "again" }];
  assert.ok(errorRules(twoDevices).includes("schema"));

  const nodeGraph = JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "sample-explainer/film.json"), "utf8"));
  nodeGraph.shots[0].stage = "inset";
  nodeGraph.shots[0].blocks = [{ c: "StatCounter", to: 3, label: "x" }];
  const report = checkFilmDesign(nodeGraph);
  assert.ok(report.findings.some((f) => f.rule === "schema" && /only a scene film/.test(f.message)), JSON.stringify(report.findings).slice(0, 400));
});
