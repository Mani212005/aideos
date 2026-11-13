/**
 * File Description: Behavioral coverage of stage motion, visibility, delivery segments and preflight failures.
 * Inputs and outputs: short synthetic scene films and illegal transitions -> timeline spans and caller findings.
 * Used by: npm test.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial } from "three";
import { parseFilm, type Film } from "../src/dl/schema";
import { compileScene } from "../src/dl/scene/compile";
import type { Scene } from "../src/dl/scene/types";
import type { SvgAnimationClip } from "../src/dl/scene/svgAnimation";
import { elementOpacity, elementVisible } from "../src/dl/scene/visibility";
import { checkFilmDesign } from "./designCheck/designCheck";
import { readFilmFacts } from "./review/source";
import { stageTimeline, stageSegments, storyRanges, transitionStage } from "./stageTimeline";
import { meshIsDrawn, partsInViewport, projectMeshParts } from "../src/dl/scene/stageGeometry";

// Runs one synthetic scene with private static artwork and cleans up its public asset input.
function withFilm(svg: string, clips: SvgAnimationClip[], run: (film: Film) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-stage-timeline-"));
  try {
    const source = path.join(dir, "stage.svg");
    fs.writeFileSync(source, svg);
    run(parseFilm({
      id: "timeline-test", title: "Timeline", fps: 30, chapters: ["Story"], captions: "off", subtitles: false,
      canvas: { nodes: [{ id: "a", label: "A", x: 0, y: 0 }, { id: "b", label: "B", x: 500, y: 0 }], edges: [{ from: "a", to: "b" }] },
      shots: [{ id: "story-one", dur: 6, look: "a", stage: "none", move: "cut", scriptText: "One moves.", blocks: [] }, { id: "story-two", dur: 6, look: "a", stage: "none", scriptText: "Then two moves.", blocks: [] }],
      scene: { schemaVersion: "1.0.0", sceneId: "timeline", fps: 30, durationFrames: 360, audioSource: "test.wav", audioDurationMs: 12000,
        sceneSize: { w: 1920, h: 1920 }, actors: [], props: [],
        background: { assetId: "stage", svgSource: source, position: { x: 960, y: 960 }, scale: 1, rotation: 0, opacity: 1,
          animation: { timelineId: "motion", clips } } },
    }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Creates a linear target motion with precise frame bounds.
function move(from: number, to: number, startFrame: number, durationFrames: number): SvgAnimationClip {
  return { clipId: `move-${startFrame}`, targets: ["part"], property: "translateX", from, to, startFrame, durationFrames, easing: "linear" };
}

const ART = '<svg xmlns="http://www.w3.org/2000/svg"><rect id="part" width="20" height="20" fill="#F5F5F5"/></svg>';

test("stage timeline: motion settles, resumes and enters the format's end card", () => {
  withFilm(ART, [move(0, 90, 0, 90), move(90, 180, 240, 90)], (film) => {
    const long = stageTimeline(film, "long"), reel = stageTimeline(film, "reel");
    assert.deepEqual(long.spans, [
      { segment: "story", motion: "moving", from: 0, to: 90 },
      { segment: "story", motion: "holding", from: 90, to: 240 },
      { segment: "story", motion: "moving", from: 240, to: 330 },
      { segment: "story", motion: "holding", from: 330, to: 360 },
      { segment: "end-card", motion: "holding", from: 360, to: 540 },
    ]);
    assert.deepEqual(long.holds, [{ start: 3, end: 8, shots: ["story-one", "story-two"] }]);
    assert.equal(reel.spans[reel.spans.length - 1]?.to, 450);
    const report = checkFilmDesign(film);
    const failures = report.findings.filter((f) => f.rule === "stage-hold");
    assert.equal(failures.length, 2);
    assert.equal(failures[0].severity, "error");
    assert.match(failures[0].where, /story-one, story-two/);
    assert.match(failures[0].message, /3.00s to 8.00s \(5.00s; max 3s\)/);
    const facts = readFilmFacts(film);
    assert.deepEqual(facts.stageSpans, long.spans);
  });
});

test("stage timeline: invisible motion does not hide a frozen stage, including authored ancestors", () => {
  withFilm(ART.replace('<rect', '<g opacity="0"><rect').replace('/></svg>', '/></g></svg>'), [move(0, 100, 0, 359)], (film) => {
    const timeline = stageTimeline(film, "long");
    assert.equal(timeline.spans[0].motion, "holding");
    assert.deepEqual(timeline.visibleAt(100), []);
    assert.equal(timeline.holds[0].end, 12);
  });
});

test("stage timeline: the camera moves a static stage and opacity-driven entries replace authored opacity", () => {
  withFilm(ART.replace('id="part"', 'id="part" opacity="0"'), [{ ...move(0, 1, 0, 90), property: "opacity" }], (film) => {
    const timeline = stageTimeline(film, "long");
    assert.equal(timeline.visibleAt(0).includes("stage::part"), false);
    assert.equal(timeline.visibleAt(90).includes("stage::part"), true);
    const scene = film.scene as Scene;
    scene.camera = { keyframes: [{ frame: 0, center: { x: 960, y: 960 }, zoom: 1 }, { frame: 359, center: { x: 1000, y: 960 }, zoom: 1 }] };
    assert.equal(stageTimeline(film, "long").holds.length, 0);
    const compiled = compileScene(scene, { clockMs: 0 });
    assert.equal(elementOpacity(compiled.frames[90].entities[0].elementStates?.part, 0), 1);
  });
});

test("stage timeline: off-frame animation only counts in the format that sees it", () => {
  withFilm(ART, [move(0, 50, 0, 359)], (film) => {
    (film.scene as Scene).background.position.x = 100;
    assert.equal(stageTimeline(film, "long").holds.length, 0);
    assert.equal(stageTimeline(film, "reel").holds.length, 1);
  });
});

// Projects full drawable mesh extent to prove crop visibility does not depend on endpoint anchors.
test("stage geometry: rendered extent crossing the crop counts when endpoints are off-screen", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([-1100, 0, 0, 1100, 0, 0, 0, 20, 0], 3));
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  const pose = { center: { x: 960, y: 960 }, zoom: 1, rotation: 0 };
  const projected = projectMeshParts([mesh], pose, 1920, 1080, { w: 1920, h: 1920 }, 0);
  assert.equal(projected[0].bounds.x0 < 0 && projected[0].bounds.x1 > 1920, true);
  assert.equal(partsInViewport(projected, 1920, 1080).length, 1);
  geometry.dispose();
  mesh.material.dispose();
});

// Distinguishes a visible rotation even when a symmetric mesh keeps the same projected bounds.
test("stage geometry: projected vertex changes detect rotation with unchanged bounds", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([-10, -10, 0, 10, -10, 0, 10, 10, 0, -10, -10, 0, 10, 10, 0, -10, 10, 0], 3));
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  const pose = { center: { x: 960, y: 960 }, zoom: 1, rotation: 0 };
  const before = projectMeshParts([mesh], pose, 1920, 1080, { w: 1920, h: 1920 }, 0, true)[0];
  mesh.rotation.z = Math.PI / 2;
  mesh.updateMatrixWorld(true);
  const after = projectMeshParts([mesh], pose, 1920, 1080, { w: 1920, h: 1920 }, 0, true)[0];
  for (const axis of ["x0", "y0", "x1", "y1"] as const) assert.ok(Math.abs(before.bounds[axis] - after.bounds[axis]) < 1e-8);
  assert.notEqual(before.signature, after.signature);
  geometry.dispose();
  mesh.material.dispose();
});

// Applies the shared opacity cutoff to transparent Three materials used by stage geometry checks.
test("stage geometry: transparent meshes follow the shared visibility cutoff", () => {
  const material = new MeshBasicMaterial({ transparent: true, opacity: 0.1 });
  const mesh = new Mesh(new BufferGeometry(), material);
  assert.equal(meshIsDrawn(mesh), true);
  material.opacity = 0.04;
  assert.equal(meshIsDrawn(mesh), false);
  material.dispose();
  mesh.geometry.dispose();
});

// Exercises the real character and prop performance path with the actor outside the output crop.
test("stage timeline: wholly off-frame Three performance remains a hold", () => {
  const file = path.join(process.cwd(), "test_fixtures/packages/legacy-iona-p0/film.json");
  const film = parseFilm(JSON.parse(fs.readFileSync(file, "utf8")));
  const scene = film.scene as Scene;
  const actor = scene.cast!.find((member) => member.id === "iona");
  assert.equal(actor?.kind, "character");
  if (actor?.kind === "character") actor.position = [-10000, -10000];
  // The performance must be the only motion, so the fixture's settled-tail camera push is removed.
  delete scene.camera;
  const timeline = stageTimeline(film, "long");
  assert.equal(timeline.spans.some((span) => span.motion === "moving"), false);
  assert.ok(timeline.holds.length > 0);
});

// Holds the stage for four seconds inside one shot, with and without an inset counter drawn over it.
test("stage policy: an inset counter over a held stage is motion, the bare hold still blocks", () => {
  withFilm(ART, [move(0, 30, 0, 30), move(30, 60, 150, 30)], (film) => {
    const holds = () => checkFilmDesign(film).findings.filter((f) => f.rule === "stage-hold");
    assert.ok(holds().some((f) => /1.00s to 5.00s/.test(f.message)));
    film.shots[0] = { ...film.shots[0], stage: "inset", blocks: [{ c: "StatCounter", to: 40, label: "tokens", format: "plain" }] };
    assert.deepEqual(stageTimeline(film, "long").spans.slice(0, 2), [
      { segment: "story", motion: "moving", from: 0, to: 180 },
      { segment: "story", motion: "holding", from: 180, to: 360 },
    ]);
    assert.equal(holds().some((f) => /1.00s to 5.00s/.test(f.message)), false);
  });
});

test("stage policy: exactly three seconds is allowed, a longer story hold blocks", () => {
  withFilm(ART, [move(0, 100, 90, 269)], (film) => {
    assert.equal(stageTimeline(film, "long").holds.length, 0);
    const scene = film.scene as Scene;
    scene.background.animation!.clips[0] = move(0, 100, 91, 268);
    assert.equal(stageTimeline(film, "long").holds[0].end, 91 / 30);
  });
});

test("stage policy: a card cannot transition back to story and measured runs are clipped at story end", () => {
  assert.throws(() => transitionStage({ motion: "holding", segment: "end-card" }, { motion: "moving", segment: "story" }), /Invalid stage transition/);
  assert.deepEqual(transitionStage({ motion: "holding", segment: "story" }, { motion: "moving", segment: "story" }), { motion: "moving", segment: "story" });
  assert.deepEqual(storyRanges([{ start: 8, end: 15 }, { start: 12, end: 18 }], 12), [{ start: 8, end: 12 }]);
  assert.equal(elementVisible(0.05), false);
  assert.equal(elementVisible(0.051), true);
  assert.equal(elementOpacity({ opacity: 1, opacityDriven: false }, 0), 0);
  assert.equal(elementOpacity({ opacity: 1, opacityDriven: true }, 0), 1);
  withFilm(ART, [], (film) => {
    assert.equal(stageSegments(film, "long").segments[1].from, 360);
    assert.equal(stageSegments(film, "reel").segments[1].to, 450);
  });
});

// Executes continuity through the design gate with visible and authored-hidden versions of the same snap.
test("stage visibility: continuity and motion agree on an authored-hidden target", () => {
  const clips = [move(0, 30, 0, 60), move(80, 90, 180, 60)];
  withFilm(ART, clips, (film) => {
    assert.ok(checkFilmDesign(film).findings.some((f) => f.rule === "continuity"));
  });
  withFilm(ART.replace('id="part"', 'id="part" opacity="0"'), clips, (film) => {
    assert.equal(checkFilmDesign(film).findings.some((f) => f.rule === "continuity"), false);
    assert.equal(stageTimeline(film, "long").holds[0].end, 12);
  });
});
