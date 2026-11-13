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
import { parseFilm, type Film } from "../src/dl/schema";
import { compileScene } from "../src/dl/scene/compile";
import type { Scene } from "../src/dl/scene/types";
import type { SvgAnimationClip } from "../src/dl/scene/svgAnimation";
import { elementOpacity, elementVisible } from "../src/dl/scene/visibility";
import { stageHoldFactLine } from "./geminiReview/facts";
import { checkFilmDesign } from "./designCheck/designCheck";
import { readFilmFacts } from "./review/source";
import { stageTimeline, stageSegments, storyRanges, transitionStage } from "./stageTimeline";

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
    assert.match(stageHoldFactLine(facts)!, /3.00s to 8.00s/);
    assert.match(stageHoldFactLine(facts)!, /end card is excluded/);
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
