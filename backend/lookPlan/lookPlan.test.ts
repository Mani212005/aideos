/**
 * File Description: Unit and integration tests for look plan schema validation, checker rules, brief generation, and LOOK.md rendering.
 * Inputs and outputs: Test fixtures and raw look plan objects -> assertion results.
 * Used by: npm test.
 */

import "../testSupport/fixtureVideosDir";
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLookPlan,
  safeParseLookPlan,
  type LookPlan,
} from "./schema";
import {
  checkLookPlan,
  checkLookPlanById,
  formatLookReport,
} from "./check";
import {
  renderLookMd,
} from "./render";
import {
  renderLookBrief,
  EXAMPLE_LOOK_PLAN,
} from "./brief";

const VALID_LOOK_PLAN: LookPlan = {
  schema: "aideos.look/1",
  decidedBy: {
    agent: "claude",
    model: "claude-sonnet-5-5",
    at: "2026-10-11T12:00:00Z",
    how: "hand-written test plan",
  },
  film: {
    mode: "scene",
    stage: "One server rack seen from the front with memory shelves and an accelerator chip.",
    cast: [
      {
        id: "disk",
        what: "slow spinning disk on the bottom shelf",
        enters: "beat-01",
        changes: [
          {
            at: "beat-02",
            how: "spins down and dims as the cache takes over",
            magnitude: "moderate",
          },
        ],
      },
      {
        id: "cache",
        what: "fast solid state cache card",
        enters: "beat-02",
        changes: [
          {
            at: "beat-04",
            how: "lights up and routes requests directly to the chip",
            magnitude: "major",
          },
        ],
      },
    ],
    camera: [
      {
        at: "beat-01",
        pose: "wide establishing view of the whole server rack",
        why: "establish the scene",
      },
      {
        at: "beat-02",
        pose: "push in to the slow disk",
        why: "highlight the bottleneck",
      },
      {
        at: "beat-04",
        pose: "wide payoff showing the full cache-accelerated path",
        why: "payoff view",
      },
    ],
    palette: {
      bg: "#0A0A0B",
      accent: "#635BFF",
      extra: {
        "#3DDC97": "cached hits",
      },
    },
    captions: {
      position: "bottom",
      kineticColumn: false,
    },
    headlines: "none",
  },
  shots: [
    {
      id: "beat-01",
      treatment: "scene",
      carries: ["disk"],
      cue: "spinning",
      criterion: "1-mechanism",
      why: "disk spinning mechanism is shown",
    },
    {
      id: "beat-02",
      treatment: "scene+card",
      carries: ["disk", "cache"],
      cue: "bottleneck",
      criterion: "1-mechanism",
      why: "cache enters alongside disk",
    },
    {
      id: "beat-03",
      treatment: "scene",
      carries: ["cache"],
      cue: "accelerated",
      criterion: "1-mechanism",
      why: "fast hits bypass the slow disk",
    },
    {
      id: "beat-04",
      treatment: "device",
      device: "StatCounter",
      carries: ["cache"],
      cue: "hundred times",
      criterion: "3-precise-number",
      why: "stat counter highlights throughput number",
    },
  ],
  approval: {
    captain: null,
  },
};

test("schema accept: accepts a valid look.json plan", () => {
  const parsed = parseLookPlan(VALID_LOOK_PLAN);
  assert.equal(parsed.schema, "aideos.look/1");
  assert.equal(parsed.film.cast.length, 2);
  assert.equal(parsed.shots.length, 4);

  const report = checkLookPlan(VALID_LOOK_PLAN, "test-film");
  assert.equal(report.ok, true);
  assert.equal(report.findings.length, 0);
  assert.equal(report.stats.shots, 4);
});

test("schema accept: accepts EXAMPLE_LOOK_PLAN from brief", () => {
  const parsed = safeParseLookPlan(EXAMPLE_LOOK_PLAN);
  assert.equal(parsed.success, true);
});

test("schema reject: rejects invalid schema version or missing fields", () => {
  const invalidVersion = { ...VALID_LOOK_PLAN, schema: "aideos.look/2" };
  const res1 = safeParseLookPlan(invalidVersion);
  assert.equal(res1.success, false);

  const missingStage = {
    ...VALID_LOOK_PLAN,
    film: { ...VALID_LOOK_PLAN.film, stage: "" },
  };
  const res2 = safeParseLookPlan(missingStage);
  assert.equal(res2.success, false);

  const report = checkLookPlan(invalidVersion, "bad-version");
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.rule === "schema"));
});

test("checker rule: treatment footage is reserved and refused", () => {
  const plan = JSON.parse(JSON.stringify(VALID_LOOK_PLAN));
  plan.shots[0].treatment = "footage";

  const report = checkLookPlan(plan, "footage-film");
  assert.equal(report.ok, false);
  const f = report.findings.find((x) => x.rule === "treatment");
  assert.ok(f, "should flag treatment rule violation");
  assert.ok(f?.message.includes("footage"));
  assert.ok(f?.message.includes("reserved"));
});

test("checker rule: duplicate cast ids are rejected", () => {
  const plan = JSON.parse(JSON.stringify(VALID_LOOK_PLAN));
  plan.film.cast.push({
    id: "disk",
    what: "another disk object",
    enters: "beat-02",
    changes: [],
  });

  const report = checkLookPlan(plan, "dup-cast-film");
  assert.equal(report.ok, false);
  const f = report.findings.find((x) => x.rule === "cast");
  assert.ok(f, "should flag duplicate cast id");
  assert.ok(f?.message.includes("duplicate cast id"));
});

test("checker rule: duplicate shot ids are rejected", () => {
  const plan = JSON.parse(JSON.stringify(VALID_LOOK_PLAN));
  plan.shots.push({
    id: "beat-01",
    treatment: "scene",
    carries: ["disk"],
    cue: "duplicate",
    criterion: "1-mechanism",
    why: "duplicate beat id",
  });

  const report = checkLookPlan(plan, "dup-shot-film");
  assert.equal(report.ok, false);
  const f = report.findings.find((x) => x.rule === "shot");
  assert.ok(f, "should flag duplicate shot id");
  assert.ok(f?.message.includes("duplicate shot id"));
});

test("checker rule: carried object must exist in declared cast", () => {
  const plan = JSON.parse(JSON.stringify(VALID_LOOK_PLAN));
  plan.shots[0].carries = ["disk", "ghost-object"];

  const report = checkLookPlan(plan, "ghost-carries-film");
  assert.equal(report.ok, false);
  const f = report.findings.find((x) => x.rule === "carries");
  assert.ok(f, "should flag unknown carried cast id");
  assert.ok(f?.message.includes("ghost-object"));
});

test("checker rule: carry-over change must not be minor or too brief", () => {
  // Test minor magnitude flag
  const planMinor = JSON.parse(JSON.stringify(VALID_LOOK_PLAN));
  planMinor.film.cast[0].changes = [
    {
      at: "beat-02",
      how: "a faint pixel shift",
      magnitude: "minor",
    },
  ];
  const report1 = checkLookPlan(planMinor, "minor-change-film");
  assert.equal(report1.ok, false);
  const f1 = report1.findings.find((x) => x.rule === "carry-over");
  assert.ok(f1, "should flag minor carry-over change");
  assert.ok(f1?.message.includes("minor"));

  // Test overly brief description without magnitude
  const planBrief = JSON.parse(JSON.stringify(VALID_LOOK_PLAN));
  planBrief.film.cast[0].changes = [
    {
      at: "beat-02",
      how: "tiny shift",
    },
  ];
  const report2 = checkLookPlan(planBrief, "brief-change-film");
  assert.equal(report2.ok, false);
  const f2 = report2.findings.find((x) => x.rule === "carry-over");
  assert.ok(f2, "should flag overly brief carry-over description");
  assert.ok(f2?.message.includes("too brief"));
});

test("checker rule: device shot must name a template device", () => {
  const plan = JSON.parse(JSON.stringify(VALID_LOOK_PLAN));
  plan.shots[3].treatment = "device";
  delete plan.shots[3].device;

  const report = checkLookPlan(plan, "no-device-named");
  assert.equal(report.ok, false);
  const f = report.findings.find((x) => x.rule === "device");
  assert.ok(f, "should flag unnamed device");
  assert.ok(f?.message.includes("must name a template device"));
});

test("checker rule: no two device shots in a row", () => {
  const plan = JSON.parse(JSON.stringify(VALID_LOOK_PLAN));
  plan.shots = [
    {
      id: "beat-01",
      treatment: "scene",
      carries: ["disk"],
      cue: "spinning",
      criterion: "1-mechanism",
      why: "scene",
    },
    {
      id: "beat-02",
      treatment: "device",
      device: "StatCounter",
      carries: ["disk"],
      cue: "numbers",
      criterion: "3-precise-number",
      why: "count",
    },
    {
      id: "beat-03",
      treatment: "device",
      device: "Plot",
      carries: ["disk"],
      cue: "curve",
      criterion: "3-precise-number",
      why: "curve",
    },
    {
      id: "beat-04",
      treatment: "scene",
      carries: ["disk"],
      cue: "scene",
      criterion: "1-mechanism",
      why: "scene",
    },
    {
      id: "beat-05",
      treatment: "scene",
      carries: ["disk"],
      cue: "scene",
      criterion: "1-mechanism",
      why: "scene",
    },
    {
      id: "beat-06",
      treatment: "scene",
      carries: ["disk"],
      cue: "scene",
      criterion: "1-mechanism",
      why: "scene",
    },
    {
      id: "beat-07",
      treatment: "scene",
      carries: ["disk"],
      cue: "scene",
      criterion: "1-mechanism",
      why: "scene",
    },
    {
      id: "beat-08",
      treatment: "scene",
      carries: ["disk"],
      cue: "scene",
      criterion: "1-mechanism",
      why: "scene",
    },
  ];

  const report = checkLookPlan(plan, "consecutive-devices");
  assert.equal(report.ok, false);
  const f = report.findings.find((x) => x.rule === "device" && x.message.includes("no two device shots in a row"));
  assert.ok(f, "should flag consecutive device shots");
});

test("checker rule: device shot frequency limit (at most 1 in 4)", () => {
  const plan = JSON.parse(JSON.stringify(VALID_LOOK_PLAN));
  // 4 shots, 2 devices separated by scene -> 2/4 > 1 allowed
  plan.shots = [
    {
      id: "beat-01",
      treatment: "device",
      device: "StatCounter",
      carries: ["disk"],
      cue: "numbers",
      criterion: "3-precise-number",
      why: "count",
    },
    {
      id: "beat-02",
      treatment: "scene",
      carries: ["disk"],
      cue: "scene",
      criterion: "1-mechanism",
      why: "scene",
    },
    {
      id: "beat-03",
      treatment: "device",
      device: "Plot",
      carries: ["disk"],
      cue: "curve",
      criterion: "3-precise-number",
      why: "curve",
    },
    {
      id: "beat-04",
      treatment: "scene",
      carries: ["disk"],
      cue: "scene",
      criterion: "1-mechanism",
      why: "scene",
    },
  ];

  const report = checkLookPlan(plan, "too-many-devices");
  assert.equal(report.ok, false);
  const f = report.findings.find((x) => x.rule === "device" && x.message.includes("too many device shots"));
  assert.ok(f, "should flag device frequency violation");
});

test("checker rule: camera poses must start wide and end wide", () => {
  // Initial camera not wide
  const planNoStartWide = JSON.parse(JSON.stringify(VALID_LOOK_PLAN));
  planNoStartWide.film.camera[0].pose = "tight closeup on disk";
  const report1 = checkLookPlan(planNoStartWide, "no-start-wide");
  assert.equal(report1.ok, false);
  const f1 = report1.findings.find((x) => x.rule === "camera" && x.message.includes("initial camera pose"));
  assert.ok(f1, "should require initial wide pose");

  // Final camera not wide
  const planNoEndWide = JSON.parse(JSON.stringify(VALID_LOOK_PLAN));
  planNoEndWide.film.camera[planNoEndWide.film.camera.length - 1].pose = "close push to chip";
  const report2 = checkLookPlan(planNoEndWide, "no-end-wide");
  assert.equal(report2.ok, false);
  const f2 = report2.findings.find((x) => x.rule === "camera" && x.message.includes("final camera pose"));
  assert.ok(f2, "should require final wide payoff pose");
});

test("schema reject: captions position must be bottom", () => {
  const badPos = {
    ...VALID_LOOK_PLAN,
    film: {
      ...VALID_LOOK_PLAN.film,
      captions: { position: "top" as any, kineticColumn: false },
    },
  };
  const res = safeParseLookPlan(badPos);
  assert.equal(res.success, false);
});

test("checker rule: captions kineticColumn must be false", () => {
  const planBadCaps = JSON.parse(JSON.stringify(VALID_LOOK_PLAN));
  planBadCaps.film.captions.kineticColumn = true;
  const report = checkLookPlan(planBadCaps, "bad-captions");
  assert.equal(report.ok, false);
  const f = report.findings.find((x) => x.rule === "captions");
  assert.ok(f, "should reject kineticColumn captions");
});

test("render: renderLookMd produces markdown with stage, cast, camera and shots", () => {
  const md = renderLookMd(VALID_LOOK_PLAN, "Test Film Title");
  assert.ok(md.includes("# Look Plan: Test Film Title"));
  assert.ok(md.includes("## Stage"));
  assert.ok(md.includes("## Cast (Persistent Elements)"));
  assert.ok(md.includes("`disk`"));
  assert.ok(md.includes("`cache`"));
  assert.ok(md.includes("## Camera"));
  assert.ok(md.includes("wide establishing view"));
  assert.ok(md.includes("## Shots & Beat Treatments"));
  assert.ok(md.includes("`beat-01` **scene**"));
  assert.ok(md.includes("`beat-04` **device** (StatCounter)"));
});

import type { Film } from "../../src/dl/schema";

test("brief: renderLookBrief produces complete briefing markdown", () => {
  const fakeFilm: Film = {
    schemaVersion: "1.0.0",
    id: "fake-film",
    title: "Fake Film",
    fps: 30,
    accent: "#635BFF",
    theme: { background: "smooth-dark", fontFamily: "geist", accent: "#635BFF" },
    chapters: ["Intro"],
    canvas: { nodes: [{ id: "n1", label: "node 1", sub: "", x: 0, y: 0, w: 100, h: 50 }, { id: "n2", label: "node 2", sub: "", x: 100, y: 0, w: 100, h: 50 }], edges: [] },
    shots: [
      {
        id: "beat-01",
        ch: "Intro",
        dur: 6.5,
        stage: "frame",
        look: "intro",
        move: "cut",
        drift: false,
        zoom: 1,
        scriptText: "This is the first narrated sentence.",
        visualDirection: "Show the opening diagram.",
        blocks: [],
      },
    ],
  };

  const briefMd = renderLookBrief(fakeFilm);
  assert.ok(briefMd.includes("# Look Brief: Fake Film (`fake-film`)"));
  assert.ok(briefMd.includes("The 6 Look Questions to Answer"));
  assert.ok(briefMd.includes("Shot Treatment Decision Rules"));
  assert.ok(briefMd.includes("beat-01"));
  assert.ok(briefMd.includes("This is the first narrated sentence."));
});

test("integration: fixture package speculative-decoding-designed passes look check", () => {
  const report = checkLookPlanById("speculative-decoding-designed");
  assert.equal(report.ok, true);
  assert.equal(report.findings.length, 0);
  assert.equal(report.stats.shots, 21);
  assert.equal(report.stats.castCount, 4);
  assert.equal(report.stats.cameraPoses, 5);

  const formatted = formatLookReport(report);
  assert.ok(formatted.startsWith("PASS speculative-decoding-designed"));
});
