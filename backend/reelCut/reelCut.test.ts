/**
 * File Description: Exercises reel cut validity, phrase extraction, motion floors and the real brief/check CLI.
 * Inputs and outputs: isolated films and authored cuts -> reports, generated briefs and command exit codes.
 * Used by: npm test; no personal videos, TTS, model calls or render jobs are used.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import { loadFixtureFilm } from "../testSupport/fixtureFilms";
import { parseFilm, type Film } from "../../src/dl/schema";
import { createCues } from "../sceneKit/timing";
import {
  compileCameraTrack,
  measureCameraMotion,
} from "../../src/dl/scene/cameraTrack";
import { designSpecSchema } from "../designSpec/spec";
import { lookPlanSchema } from "../lookPlan/schema";
import { checkReelCut, formatReelReport } from "./check";
import {
  createReelContext,
  narrationHash,
  type ReelContext,
} from "./constraints";
import { loadReelContext, reelBrief, writeReelBrief } from "./brief";
import { minimumShotSeconds } from "./motion";
import { visibleReelText } from "./visibleText";
import {
  DEFAULT_REEL_BUDGET,
  parseReelBudget,
  REEL_MAX_SEC,
  reelCutSchema,
  reelBudgetSchema,
  type ReelBudget,
  type ReelCut,
} from "./schema";

const ROOT = path.resolve(__dirname, "../..");
const BUDGET: ReelBudget = { maxSec: 179, targetSec: 170, endCardSec: 3 };

// Creates a tiny narrated film with known ids, duration and no hidden owner data.
function film(): Film {
  const base = parseFilm(loadFixtureFilm("fixture-canvas-a"));
  return {
    ...base,
    id: "reel-test",
    scene: undefined,
    voiceover: { src: "voiceover.wav", volume: 1, durationSec: 30 },
    shots: [
      {
        ...base.shots[0],
        id: "intro",
        stage: "none",
        dur: 10,
        scriptText: "See how the paper moves.",
        blocks: [],
      },
      {
        ...base.shots[0],
        id: "middle",
        stage: "none",
        dur: 10,
        scriptText: "Fold the paper and catch it with two hands.",
        blocks: [],
      },
      {
        ...base.shots[0],
        id: "outro",
        stage: "none",
        dur: 10,
        scriptText: "The paper stays in your hands.",
        blocks: [],
      },
    ],
  };
}

// Creates the identity narration cut used as a starting point for individual authoring failures.
function cut(
  context: ReelContext = createReelContext({ film: film() }),
): ReelCut {
  return {
    schema: "aideos.reelcut/1",
    source: "owner",
    long: {
      shots: Object.fromEntries(context.shots.map((s) => [s.id, s.hash])),
    },
    shots: context.shots.map((s) => ({ id: s.id, narration: s.narration })),
  };
}

// Checks an authored mutation against the same measured long take.
function check(
  value: unknown,
  context = createReelContext({ film: film() }),
  budget = BUDGET,
) {
  return checkReelCut(value, context, budget);
}

// Supplies a shared design with phrase cues at both clip edges and a camera pose.
function design() {
  return designSpecSchema.parse({
    brief: { concept: "Paper stays on stage" },
    assets: [],
    clips: [
      {
        id: "fold",
        asset: "paper",
        targets: ["paper"],
        property: "rotate",
        from: 0,
        to: 30,
        start: 'middle:"Fold the paper"',
        end: 'middle:"catch it"@end+2',
      },
    ],
    camera: [
      { at: 'intro:"See how"', center: [960, 960], zoom: 1 },
      { at: 'outro:"your hands"', center: [960, 960], zoom: 1 },
    ],
  });
}

// Supplies a look plan whose shot cues and camera/cast phrase cues must survive condensation.
function look() {
  return lookPlanSchema.parse({
    schema: "aideos.look/1",
    decidedBy: { agent: "test", model: "test", at: "now" },
    film: {
      mode: "scene",
      stage: "Paper table",
      cast: [
        {
          id: "paper",
          what: "paper",
          enters: "intro",
          changes: [{ at: 'middle:"two hands"', how: "folds" }],
        },
      ],
      camera: [{ at: 'intro:"paper moves"', pose: "wide", why: "show paper" }],
      palette: { bg: "#0A0A0B", accent: "#635BFF" },
      captions: { position: "bottom" },
    },
    shots: film().shots.map((s) => ({
      id: s.id,
      treatment: "scene",
      cue:
        s.id === "middle" ? "catch it" : s.id === "intro" ? "See how" : "stays",
      criterion: "continuity",
      why: "carry paper",
    })),
  });
}

// Adds one decisive performance to an otherwise static shared design.
function performanceDesign() {
  return designSpecSchema.parse({
    schema: "aideos.design/2",
    renderer: "three",
    brief: { concept: "Catch the paper" },
    assets: [],
    clips: [],
    performances: [
      {
        id: "catch",
        action: "receive-v1",
        actor: "hands",
        prop: "paper",
        start: 'middle:"Fold the paper"',
        decisive: { shotId: "middle", phrase: "catch it", event: "contact" },
        afterState: "held",
      },
    ],
  });
}

// Adds a camera-only scene with the same measured timing as the test narration.
function sceneFilm(): Film {
  return parseFilm({
    ...film(),
    scene: {
      schemaVersion: "1.0.0",
      sceneId: "reel-test",
      fps: 30,
      durationFrames: 900,
      audioSource: "voiceover.wav",
      audioDurationMs: 30000,
      sceneSize: { w: 1920, h: 1920 },
      actors: [],
      props: [],
      background: {
        assetId: "background",
        svgSource: "background.svg",
        position: { x: 960, y: 960 },
        scale: 1,
        rotation: 0,
        opacity: 1,
        layer: 0,
      },
      camera: {
        keyframes: [
          { frame: 0, center: { x: 960, y: 960 }, zoom: 1 },
          { frame: 299, center: { x: 1360, y: 960 }, zoom: 1 },
          { frame: 300, center: { x: 1360, y: 960 }, zoom: 1 },
          { frame: 899, center: { x: 1360, y: 960 }, zoom: 1 },
        ],
      },
    },
  });
}

test("cut schema refuses contradictory entries, textless narration, unreasoned drops and invalid approval", () => {
  for (const shots of [
    [{ id: "intro", narration: "See how", drop: true, reason: "duplicate" }],
    [{ id: "intro", narration: "   " }],
    [{ id: "intro", narration: "..." }],
    [{ id: "middle", drop: true, reason: " " }],
  ])
    assert.equal(reelCutSchema.safeParse({ ...cut(), shots }).success, false);
  assert.equal(
    reelCutSchema.safeParse({
      ...cut(),
      approved: { by: "captain", at: "yesterday" },
    }).success,
    false,
  );
  assert.equal(
    reelCutSchema.safeParse({
      ...cut(),
      approved: { by: "captain", at: "2026-10-24T12:00:00Z" },
    }).success,
    true,
  );
  assert.throws(() => reelBudgetSchema.parse({ ...BUDGET, targetSec: 180 }));
  assert.throws(() => reelBudgetSchema.parse({ ...BUDGET, endCardSec: 170 }));
  assert.equal(parseReelBudget({ ...BUDGET, maxSec: 100, targetSec: 90 }).maxSec, 100);
  assert.equal(DEFAULT_REEL_BUDGET.maxSec, REEL_MAX_SEC);
  assert.throws(() => parseReelBudget({ ...BUDGET, maxSec: REEL_MAX_SEC + 1 }));
  // Approved plan sections 4.2 and 4.8 reserve the canonical card span, including zero when disabled.
  assert.doesNotThrow(() => parseReelBudget({ ...BUDGET, endCardSec: 0 }));
  assert.throws(() =>
    check(cut(), createReelContext({ film: film() }), {
      ...BUDGET,
      maxSec: REEL_MAX_SEC + 1,
    }),
  );
  assert.throws(() =>
    reelBrief(createReelContext({ film: film() }), {
      ...BUDGET,
      maxSec: REEL_MAX_SEC + 1,
    }),
  );
});

test("all shots must appear once in order, including drops", () => {
  const original = cut();
  assert.equal(check(original).ok, true);
  for (const shots of [
    original.shots.slice(1),
    [...original.shots, original.shots[1]],
    [...original.shots, { id: "unknown", narration: "See paper" }],
  ]) {
    assert.ok(
      check({ ...original, shots }).findings.some((f) => f.rule === "coverage"),
    );
  }
  assert.ok(
    check({ ...original, shots: [...original.shots].reverse() }).findings.some(
      (f) => f.rule === "order",
    ),
  );
  const dropped = {
    ...original,
    shots: [
      original.shots[0],
      { id: "middle", drop: true, reason: "restates the hook" },
      original.shots[2],
    ],
  };
  const snapshot = JSON.stringify(dropped);
  assert.equal(check(dropped).ok, true);
  assert.equal(
    JSON.stringify(dropped),
    snapshot,
    "checking must not trim or edit the cut",
  );
});

test("hook, payoff and decisive performances cannot be dropped", () => {
  for (const id of ["intro", "outro"]) {
    const value = cut();
    value.shots = value.shots.map((s) =>
      s.id === id ? { id, drop: true, reason: "shorter" } : s,
    );
    assert.ok(
      check(value).findings.some((f) => f.rule === "drop" && f.shotId === id),
    );
  }
  const context = createReelContext({
    film: film(),
    design: performanceDesign(),
  });
  const value = cut(context);
  value.shots[1] = { id: "middle", drop: true, reason: "shorter" };
  assert.match(
    formatReelReport(check(value, context)),
    /decisive performance cannot be dropped/,
  );
});

test("lock extraction covers design clips, camera, look shots, cast changes and performance starts", () => {
  const context = createReelContext({
    film: film(),
    design: design(),
    look: look(),
  });
  const middle = context.shots[1];
  assert.deepEqual(
    new Set(middle.locks.map((l) => l.phrase)),
    new Set(["Fold the paper", "catch it", "two hands"]),
  );
  assert.ok(context.shots[0].locks.some((l) => l.phrase === "paper moves"));
  assert.ok(context.shots[2].locks.some((l) => l.phrase === "your hands"));
  const performance = createReelContext({
    film: film(),
    design: performanceDesign(),
  });
  assert.equal(performance.shots[1].decisive, true);
  assert.ok(
    performance.shots[1].locks.some((l) => l.phrase === "Fold the paper"),
  );
  assert.equal(
    performance.shots[1].locks.find((l) => l.phrase === "catch it")?.unique,
    true,
  );
});

test("locked phrases use the real cue normalization and never accept a paraphrase", () => {
  const context = createReelContext({ film: film(), design: design() });
  const value = cut(context);
  value.shots[1] = {
    id: "middle",
    narration: "FOLD, the paper; catch it with two hands.",
  };
  assert.equal(check(value, context).ok, true);
  const cues = createCues({
    totalDurationSec: 10,
    segments: [
      {
        shotId: "middle",
        text: "",
        startSec: 0,
        durationSec: 10,
        words: "FOLD, the paper; catch it with two hands."
          .split(" ")
          .map((word, i) => ({ word, startSec: i, endSec: i + 0.5 })),
      },
    ],
  });
  assert.doesNotThrow(() => cues.word("middle", "Fold the paper"));
  value.shots[1] = {
    id: "middle",
    narration: "Fold this paper and catch it with two hands.",
  };
  assert.ok(
    check(value, context).findings.some(
      (f) => f.rule === "phrase" && /Fold the paper/.test(f.message),
    ),
  );
});

test("decisive phrases must be spoken exactly once", () => {
  const context = createReelContext({
    film: film(),
    design: performanceDesign(),
  });
  const value = cut(context);
  value.shots[1] = {
    id: "middle",
    narration: "Fold the paper and catch it, catch it with two hands.",
  };
  assert.ok(
    check(value, context).findings.some(
      (f) => f.rule === "phrase" && /spoken 2 times/.test(f.message),
    ),
  );
  value.shots[1] = {
    id: "middle",
    narration: "Fold the paper with two hands.",
  };
  assert.ok(
    check(value, context).findings.some(
      (f) => f.rule === "phrase" && /not spoken/.test(f.message),
    ),
  );
});

test("changed long hashes, missing hashes and removed shot hashes fail stale detection", () => {
  const value = cut();
  const changed = film();
  changed.shots[1].scriptText += " Carefully.";
  assert.ok(
    check(value, createReelContext({ film: changed })).findings.some(
      (f) => f.rule === "stale" && f.shotId === "middle",
    ),
  );
  delete value.long.shots.middle;
  value.long.shots.removed = narrationHash("Removed line");
  assert.deepEqual(
    check(value)
      .findings.filter((f) => f.rule === "stale")
      .map((f) => f.shotId),
    ["middle", "removed"],
  );
});

test("new numbers fail per shot and displayed quantities must still be spoken", () => {
  const f = film();
  f.shots[1].scriptText =
    "Count zero, then one, then two while catching with two hands.";
  f.shots[1].blocks = [
    { c: "StatCounter", to: 2, label: "Hands", format: "plain" },
  ];
  const context = createReelContext({ film: f });
  const value = cut(context);
  value.shots[1] = {
    id: "middle",
    narration:
      "Count zero, then one, then two while catching with two hands.",
  };
  assert.equal(check(value, context).ok, true);
  value.shots[1] = {
    id: "middle",
    narration: "Fold the paper and catch it with three hands.",
  };
  const findings = check(value, context).findings.filter(
    (f) => f.rule === "numbers",
  );
  assert.ok(findings.some((f) => /new number 3/.test(f.message)));
  assert.ok(findings.some((f) => /on-screen number 2/.test(f.message)));
  value.shots[0] = { id: "intro", narration: "See two hands." };
  assert.ok(
    check(value, context).findings.some(
      (f) => f.shotId === "intro" && /new number 2/.test(f.message),
    ),
  );
});

test("displayed LayerStack counts and compact magnitudes use full numeric grounding", () => {
  const f = film();
  f.shots[1].blocks = [
    { c: "LayerStack", count: 32 },
    { c: "ScaleBar", ticks: ["1M", "1B"], value: 0.5 },
  ];
  const context = createReelContext({ film: f });
  assert.ok(
    [...Array(32)].every((_, i) =>
      context.shots[1].onScreenNumbers.includes(i + 1),
    ),
  );
  assert.ok(
    [1e6, 1e9].every((n) => context.shots[1].onScreenNumbers.includes(n)),
  );
  const value = cut(context);
  value.shots[1] = {
    id: "middle",
    narration: "Fold 32 layers and move from one million to one billion.",
  };
  const numberFindings = check(value, context).findings.filter(
    (finding) => finding.rule === "numbers" && finding.shotId === "middle",
  );
  assert.ok(
    numberFindings.some((finding) => /on-screen number 1 must/.test(finding.message)),
  );
  assert.ok(
    numberFindings.some((finding) => /on-screen number 31 must/.test(finding.message)),
  );
  assert.equal(
    numberFindings.some((finding) => /on-screen number 1000000/.test(finding.message)),
    false,
  );
  assert.equal(
    numberFindings.some((finding) => /on-screen number 1000000000/.test(finding.message)),
    false,
  );
});

test("LayerStack ignores metadata that Block does not render", () => {
  const f = film();
  f.shots[1].scriptText =
    "The visible stack counts one, then two, then three, and finally four.";
  f.shots[1].blocks = [
    {
      c: "LayerStack",
      count: 4,
      prompt: "101 hidden layers",
      layers: [{ label: "layer 98", dim: "99" }],
    },
  ];
  const context = createReelContext({ film: f });
  assert.equal(context.shots[1].onScreenNumbers.includes(98), false);
  assert.equal(context.shots[1].onScreenNumbers.includes(99), false);
  assert.equal(context.shots[1].onScreenNumbers.includes(101), false);

  const value = cut(context);
  value.shots[1] = { id: "middle", narration: f.shots[1].scriptText! };
  assert.equal(
    check(value, context).findings.some(
      (finding) => finding.rule === "numbers",
    ),
    false,
  );
});

test("animated counters, labelled progress and layer indexes ground every displayed tick", () => {
  const f = film();
  f.shots[1].scriptText =
    "The counter reaches three. The bar reaches fifty percent. There are four layers.";
  f.shots[1].blocks = [
    { c: "StatCounter", to: 3, label: "Count", format: "plain", suffix: "x10" },
    { c: "ProgressBar", value: 0.5, label: "Complete" },
    { c: "LayerStack", count: 4 },
  ];
  const context = createReelContext({ film: f });
  const visibleNumbers = context.shots[1].onScreenNumbers;
  assert.ok([0, 1, 2, 3].every((n) => visibleNumbers.includes(n)));
  assert.ok(visibleNumbers.includes(10));
  assert.ok(visibleNumbers.some((n) => n > 0 && n < 50));
  assert.ok([1, 2, 3, 4].every((n) => visibleNumbers.includes(n)));

  const value = cut(context);
  value.shots[1] = {
    id: "middle",
    narration: "Three, fifty percent, and four layers.",
  };
  const numberFindings = check(value, context).findings.filter(
    (finding) => finding.rule === "numbers" && finding.shotId === "middle",
  );
  assert.ok(numberFindings.some((finding) => /on-screen number 0/.test(finding.message)));
  assert.ok(numberFindings.some((finding) => /on-screen number 1/.test(finding.message)));
  assert.ok(numberFindings.some((finding) => /on-screen number 2/.test(finding.message)));
  assert.ok(
    numberFindings.some((finding) => /on-screen number 10/.test(finding.message)),
  );
  assert.ok(
    numberFindings.some((finding) => {
      const value = Number(finding.message.match(/on-screen number ([\d.]+)/)?.[1]);
      return value > 0 && value < 50 && value !== 3 && value !== 4;
    }),
  );
});

test("matrix cells and counter suffix numbers are grounded from rendered text", () => {
  const f = film();
  f.shots[1].blocks = [
    {
      c: "MatrixGrid",
      values: [[0.12, 0.75], [0.4, 1]],
      sweep: "cell",
    },
    { c: "StatCounter", to: 2, label: "Scale", suffix: "x10", format: "plain" },
    { c: "StatCounter", to: 2_000, label: "Total", format: "compact" },
  ];
  const context = createReelContext({ film: f });
  assert.ok(
    [0.12, 0.75, 0.4, 1, 10, 2_000].every((n) =>
      context.shots[1].onScreenNumbers.includes(n),
    ),
  );

  const value = cut(context);
  value.shots[1] = { id: "middle", narration: "Zero point twelve." };
  const numberFindings = check(value, context).findings.filter(
    (finding) => finding.rule === "numbers" && finding.shotId === "middle",
  );
  assert.ok(
    numberFindings.some((finding) => /on-screen number 0\.75/.test(finding.message)),
  );
  assert.ok(
    numberFindings.some((finding) => /on-screen number 10/.test(finding.message)),
  );
});

test("spoken decimal phrases ground rendered decimals and keep negative signs", () => {
  const f = film();
  f.shots[1].scriptText =
    "Read zero point twelve, followed by zero point seven five, then zero point four, and finally one point zero zero.";
  f.shots[1].blocks = [
    {
      c: "MatrixGrid",
      values: [[0.12, 0.75], [0.4, 1]],
      sweep: "cell",
    },
  ];
  const context = createReelContext({ film: f });
  const value = cut(context);
  value.shots[1] = { id: "middle", narration: f.shots[1].scriptText };
  assert.equal(
    check(value, context).findings.some(
      (finding) => finding.rule === "numbers",
    ),
    false,
  );

  const negativeFilm = film();
  negativeFilm.shots[1].scriptText = "Read negative zero point twelve.";
  negativeFilm.overlayClips = [
    {
      id: "negative-decimal",
      kind: "text",
      position: 11,
      start: 0,
      end: 1,
      opacity: 1,
      payload: { text: "Reading -0.12" },
    },
  ];
  const negativeContext = createReelContext({ film: negativeFilm });
  assert.ok(negativeContext.shots[1].onScreenNumbers.includes(-0.12));
  const negativeCut = cut(negativeContext);
  negativeCut.shots[1] = {
    id: "middle",
    narration: "Read negative zero point twelve.",
  };
  assert.equal(
    check(negativeCut, negativeContext).findings.some(
      (finding) => finding.rule === "numbers",
    ),
    false,
  );
  negativeCut.shots[1] = {
    id: "middle",
    narration: "Read zero point twelve.",
  };
  assert.ok(
    check(negativeCut, negativeContext).findings.some(
      (finding) =>
        finding.rule === "numbers" &&
        /on-screen number -0.12/.test(finding.message),
    ),
  );
});

test("imported media yields a non-blocking per-shot review advisory", () => {
  const f = film();
  f.videoClips = [
    {
      id: "video-middle",
      src: "media/clip.mp4",
      position: 10.5,
      start: 0,
      end: 2,
      opacity: 1,
      volume: 1,
    },
  ];
  f.overlayClips = [
    {
      id: "image-outro",
      kind: "image",
      position: 20,
      start: 0,
      end: 1,
      opacity: 1,
      payload: { src: "media/card.png", scale: 1 },
    },
    {
      id: "hidden-image",
      kind: "image",
      position: 0,
      start: 0,
      end: 1,
      opacity: 0,
      payload: { src: "media/hidden.png", scale: 1 },
    },
  ];
  const context = createReelContext({ film: f });
  const report = check(cut(context), context);
  const advisories = report.findings.filter(
    (finding) => finding.rule === "media",
  );
  assert.equal(report.ok, true);
  assert.deepEqual(
    advisories.map((finding) => finding.shotId),
    ["middle", "outro"],
  );
  assert.ok(
    advisories.every(
      (finding) =>
        finding.severity === "warning" &&
        finding.message.includes(
          `shot ${finding.shotId} shows imported media; numbers inside it are not checked, review them at approval`,
        ),
    ),
  );
  assert.match(
    formatReelReport(report),
    /warning: media \/ middle: shot middle shows imported media/,
  );
  assert.match(
    reelBrief(context, BUDGET),
    /Imported media caveat: shot middle shows imported media; numbers inside it are not checked, review them at approval\./,
  );
});

test("overlay text is grounded only in shots where its timeline interval is visible", () => {
  const f = film();
  f.shots[1].scriptText = "The value is negative seven.";
  f.overlayClips = [
    {
      id: "value-overlay",
      kind: "text",
      position: 11,
      start: 0,
      end: 1,
      opacity: 1,
      payload: { text: "Value -7" },
    },
    {
      id: "marker-overlay",
      kind: "subtitle",
      position: 12,
      start: 0,
      end: 1,
      opacity: 1,
      payload: { text: "Marker 8" },
    },
  ];
  const context = createReelContext({ film: f });
  assert.ok(context.shots[0].onScreenNumbers.includes(-7) === false);
  assert.ok(context.shots[1].onScreenNumbers.includes(-7));
  assert.ok(context.shots[1].onScreenNumbers.includes(8));

  const value = cut(context);
  value.shots[1] = { id: "middle", narration: "The value is seven." };
  const numberFindings = check(value, context).findings.filter(
    (finding) => finding.rule === "numbers" && finding.shotId === "middle",
  );
  assert.ok(numberFindings.some((finding) => /on-screen number -7/.test(finding.message)));
  assert.ok(numberFindings.some((finding) => /new number 7/.test(finding.message)));
  assert.ok(numberFindings.some((finding) => /on-screen number 8/.test(finding.message)));
});

test("spoken positive numbers cannot satisfy signed displayed numbers", () => {
  const f = film();
  f.shots[1].scriptText = "The reading is negative two.";
  f.shots[1].blocks = [
    { c: "StatCounter", to: -2, label: "Reading", format: "plain" },
  ];
  const context = createReelContext({ film: f });
  assert.ok(context.shots[1].onScreenNumbers.includes(-2));

  const value = cut(context);
  value.shots[1] = { id: "middle", narration: "The reading is two." };
  assert.ok(
    check(value, context).findings.some(
      (finding) =>
        finding.rule === "numbers" &&
        finding.shotId === "middle" &&
        /on-screen number -2/.test(finding.message),
    ),
  );
  value.shots[1] = {
    id: "middle",
    narration: "The reading is zero, negative one, and negative two.",
  };
  assert.equal(
    check(value, context).findings.some(
      (finding) => finding.rule === "numbers",
    ),
    false,
  );
});

test("spoken year phrases ground rendered year labels", () => {
  const f = film();
  f.shots[1].scriptText = "This method was introduced in nineteen eighty four.";
  f.overlayClips = [
    {
      id: "year-label",
      kind: "text",
      position: 11,
      start: 0,
      end: 1,
      opacity: 1,
      payload: { text: "1984" },
    },
  ];
  const context = createReelContext({ film: f });
  assert.ok(context.shots[1].onScreenNumbers.includes(1984));
  const value = cut(context);
  value.shots[1] = {
    id: "middle",
    narration: "This method was introduced in nineteen eighty four.",
  };
  assert.equal(
    check(value, context).findings.some(
      (finding) => finding.rule === "numbers" && finding.shotId === "middle",
    ),
    false,
  );
});

test("spoken cardinal numbers from twenty one to twenty nine ground rendered numbers", () => {
  const f = film();
  f.shots[1].scriptText = "There are twenty five candidates in total.";
  f.shots[1].blocks = [
    { c: "IconLabel", text: "25 candidates" },
  ];
  const context = createReelContext({ film: f });
  assert.ok(context.shots[1].onScreenNumbers.includes(25));
  const value = cut(context);
  value.shots[1] = {
    id: "middle",
    narration: "There are twenty five candidates in total.",
  };
  assert.equal(
    check(value, context).findings.some(
      (finding) => finding.rule === "numbers",
    ),
    false,
  );
});

test("grounding reads rendered chart decimals and ignores an unlabelled progress bar", () => {
  const f = film();
  f.shots[1].scriptText = "Probabilities are 0.60 and 0.40.";
  f.shots[1].blocks = [
    {
      c: "Distribution",
      items: [
        { label: "yes", p: 0.6 },
        { label: "no", p: 0.4 },
      ],
    },
    { c: "ProgressBar", value: 0.5 },
  ];
  const context = createReelContext({ film: f });
  assert.deepEqual(context.shots[1].onScreenNumbers, [0.6, 0.4]);
  assert.equal(check(cut(context), context).ok, true);
});

test("the full designed fixture supplies valid locks and permits re-speaking its persistent picture labels", () => {
  const context = loadReelContext("speculative-decoding-designed");
  assert.equal(context.shots.length, 21);
  const value = cut(context);
  const original = check(value, context);
  assert.ok(original.findings.some((finding) => finding.rule === "length"));
  assert.equal(
    original.findings.some((finding) => finding.rule === "phrase"),
    false,
  );
  assert.ok(
    original.findings.some(
      (finding) =>
        finding.rule === "numbers" &&
        /on-screen number 1/.test(finding.message),
    ),
  );
  value.shots = value.shots.map((entry) => {
    const source = context.shots.find((s) => s.id === entry.id);
    assert.ok(source);
    assert.ok("narration" in entry);
    return {
      id: entry.id,
      narration: `${entry.narration} ${source.onScreenNumbers.join("; ")}`,
    };
  });
  assert.equal(
    check(value, context).findings.some(
      (finding) => finding.rule === "numbers",
    ),
    false,
  );
});

test("cap includes the card, reports exact overage and longest shots; target only warns", () => {
  const context = createReelContext({ film: film() });
  const value = cut(context);
  const atCap = check(value, context, {
    maxSec: 33,
    targetSec: 32,
    endCardSec: 3,
  });
  assert.equal(atCap.ok, true);
  assert.equal(atCap.estimate?.totalSec, 33);
  assert.equal(
    atCap.findings.filter((f) => f.rule === "length")[0]?.severity,
    "warning",
  );
  const over = check(value, context, {
    maxSec: 32,
    targetSec: 31,
    endCardSec: 3,
  });
  assert.equal(over.ok, false);
  assert.match(
    formatReelReport(over),
    /1.0 s over the 32.0 s cap; shorten middle/,
  );
  assert.equal(
    check(
      { ...value, approved: { by: "captain", at: "2026-10-24T12:00:00Z" } },
      context,
    ).ok,
    true,
  );
});

test("motion minima use compiled curve speed, acceleration and zoom, plus the timeline frame floor", () => {
  const f = sceneFilm();
  const mins = minimumShotSeconds(f);
  assert.ok(mins.get("intro")! > 1);
  assert.equal(mins.get("outro"), 0.5);
  const scene = f.scene!;
  const curve = compileCameraTrack(
    scene.camera,
    scene.durationFrames,
    scene.sceneSize,
  );
  const peak = measureCameraMotion(curve.slice(0, 300), 30);
  assert.ok(mins.get("intro")! >= (10 * peak.peakPanSpeed) / (1920 * 0.2));
  scene.camera = {
    keyframes: [
      { frame: 0, center: { x: 960, y: 960 }, zoom: 1, easing: "linear" },
      { frame: 299, center: { x: 960, y: 960 }, zoom: 4 },
      { frame: 899, center: { x: 960, y: 960 }, zoom: 4 },
    ],
  };
  assert.ok(
    minimumShotSeconds(f).get("intro")! > 10,
    "fast zoom needs more time than the long shot supplies",
  );
  const context = createReelContext({ film: f });
  assert.ok(
    check(cut(context), context).findings.some(
      (finding) => finding.rule === "motion" && finding.shotId === "intro",
    ),
  );
});

test("brief contains the delivered word budget, per-shot locks, motion floors, source hashes and valid scaffold", () => {
  const context = createReelContext({
    film: film(),
    design: performanceDesign(),
  });
  const brief = reelBrief(context, BUDGET);
  assert.match(brief, /179.0 s, including 3.0 s of end card/);
  assert.match(brief, /Story target: 167.0 s/);
  assert.match(brief, /Minimum motion time:/);
  const scaffold = reelCutSchema.parse(
    JSON.parse(brief.split("```json\n")[1].split("\n```")[0]),
  );
  assert.equal(
    scaffold.long.shots.middle,
    narrationHash(film().shots[1].scriptText ?? ""),
  );
  assert.equal(check(scaffold, context).ok, true);
});

test("brief writing rejects read-only examples before creating a personal shadow", () => {
  assert.throws(
    () => writeReelBrief("hello-scene", BUDGET),
    /read-only example/,
  );
  assert.equal(fs.existsSync(path.join(TEST_VIDEOS_DIR, "hello-scene")), false);
});

test("new content words are a non-blocking per-shot review advisory", () => {
  const context = createReelContext({ film: film() });
  const invented = cut(context);
  invented.shots[0] = { id: "intro", narration: "See how the glass moves." };
  const warning = check(invented, context).findings.find(
    (finding) => finding.rule === "new-words" && finding.shotId === "intro",
  );
  assert.equal(warning?.severity, "warning");
  assert.match(warning?.message ?? "", /glass/);
  assert.equal(check(invented, context).ok, true);

  const reworded = cut(context);
  reworded.shots[0] = { id: "intro", narration: "The paper moves." };
  assert.equal(
    check(reworded, context).findings.some(
      (finding) => finding.rule === "new-words" && finding.shotId === "intro",
    ),
    false,
  );
});

test("SVG text grounding follows visibility and reel crop, including a one-frame reveal", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-reel-text-"));
  try {
    const svg = path.join(tmp, "labels.svg");
    const backgroundSvg = path.join(tmp, "background.svg");
    fs.writeFileSync(
      svg,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-960 -960 1920 1920"><text id="inside" x="-60" y="-60" font-size="40" opacity="0">42</text><text id="outside" x="-920" y="-60" font-size="40">999</text></svg>',
    );
    fs.writeFileSync(
      backgroundSvg,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-960 -960 1920 1920"><text id="bg-number" x="-60" y="-120" font-size="40">88</text></svg>',
    );
    const f = sceneFilm();
    f.scene!.camera = undefined;
    f.scene!.background.svgSource = backgroundSvg;
    f.scene!.props = [
      {
        ...f.scene!.background,
        assetId: "labels",
        svgSource: svg,
        animation: {
          timelineId: "labels",
          clips: [
            {
              clipId: "blink",
              targets: ["inside"],
              property: "opacity",
              from: 0,
              to: 1,
              startFrame: 307,
              durationFrames: 1,
            },
            {
              clipId: "hide",
              targets: ["inside"],
              property: "opacity",
              from: 1,
              to: 0,
              startFrame: 308,
              durationFrames: 1,
            },
          ],
        },
      },
    ];
    const texts = visibleReelText(f);
    assert.deepEqual(texts.intro, ["88"]);
    assert.deepEqual(texts.middle.sort(), ["42", "88"]);
    assert.deepEqual(texts.outro, ["88"]);
    const context = createReelContext({ film: f, visibleText: texts });
    assert.ok(
      check(cut(context), context).findings.some(
        (finding) =>
          finding.rule === "numbers" &&
          /on-screen number 42/.test(finding.message),
      ),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("real aideos reel brief/check commands produce a brief, enforce failures and leave source data untouched", () => {
  const pkg = path.join(TEST_VIDEOS_DIR, "reel-test");
  fs.mkdirSync(path.join(pkg, "reel"), { recursive: true });
  const background = path.join(pkg, "background.svg");
  fs.writeFileSync(
    background,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
  );
  const f = sceneFilm();
  f.scene!.background.svgSource = background;
  const value = cut();
  fs.writeFileSync(path.join(pkg, "film.json"), JSON.stringify(f));
  fs.writeFileSync(path.join(pkg, "reel/cut.json"), JSON.stringify(value));
  const before = fs.readFileSync(path.join(pkg, "film.json"), "utf8");
  const beforeCut = fs.readFileSync(path.join(pkg, "reel/cut.json"), "utf8");
  // Drives the same executable a person invokes, with no fixture preload in the child to replace this package.
  const run = (args: string[]) =>
    spawnSync("bash", [path.join(ROOT, "bin/aideos"), "reel", ...args], {
      cwd: ROOT,
      env: { ...process.env, AIDEOS_VIDEOS_DIR: TEST_VIDEOS_DIR },
      encoding: "utf8",
      timeout: 30000,
    });
  const brief = run(["brief", "reel-test"]);
  assert.equal(brief.status, 0, brief.stderr);
  assert.equal(brief.stdout.trim(), path.join(pkg, "reel/REEL_BRIEF.md"));
  assert.equal(
    fs.readFileSync(brief.stdout.trim(), "utf8"),
    reelBrief(loadReelContext("reel-test"), BUDGET),
  );
  const valid = run(["check", "reel-test", "--json"]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).ok, true);
  assert.equal(JSON.parse(valid.stdout).estimate.endCardSec, 3);
  const help = run(["check", "reel-test", "--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--max-sec/);
  assert.equal(help.stdout.includes("--end-card-sec"), false);
  const cardOverride = run([
    "check",
    "reel-test",
    "--end-card-sec",
    "0",
  ]);
  assert.notEqual(cardOverride.status, 0);
  const tooHigh = run([
    "check",
    "reel-test",
    "--max-sec",
    String(REEL_MAX_SEC + 1),
    "--target-sec",
    "170",
  ]);
  assert.notEqual(tooHigh.status, 0);
  const over = run([
    "check",
    "reel-test",
    "--json",
    "--max-sec",
    "32",
    "--target-sec",
    "31",
  ]);
  assert.equal(over.status, 1, over.stderr);
  assert.equal(JSON.parse(over.stdout).ok, false);
  assert.equal(fs.readFileSync(path.join(pkg, "film.json"), "utf8"), before);
  assert.equal(
    fs.readFileSync(path.join(pkg, "reel/cut.json"), "utf8"),
    beforeCut,
  );
  fs.writeFileSync(path.join(pkg, "reel/cut.json"), "{bad json");
  assert.equal(run(["check", "reel-test"]).status, 2);
  fs.writeFileSync(
    path.join(pkg, "reel/cut.json"),
    JSON.stringify({ ...value, shots: [{ id: "intro", narration: "" }] }),
  );
  assert.equal(run(["check", "reel-test"]).status, 1);
  fs.writeFileSync(path.join(pkg, "film.json"), JSON.stringify(film()));
  const legacyBrief = run(["brief", "reel-test"]);
  // Approved plan step 7 supports checked node-graph cuts as well as scene films.
  assert.equal(legacyBrief.status, 0);
  assert.match(
    legacyBrief.stdout,
    /reel\/REEL_BRIEF\.md/,
  );
  fs.rmSync(path.join(pkg, "reel/cut.json"));
  const legacyCheck = run(["check", "reel-test"]);
  assert.equal(legacyCheck.status, 2);
  assert.match(
    legacyCheck.stderr,
    /ENOENT.*reel\/cut\.json/,
  );
  assert.throws(() => loadReelContext("../outside"), /invalid film id/);
  assert.throws(() => writeReelBrief("../outside", BUDGET), /invalid film id/);
});
