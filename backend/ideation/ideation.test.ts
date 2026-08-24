/**
 * File Description: Unit tests for the staged ideation layer. Covers each
 * stage's schema validation, the parseFilm pacing gate rejection paths, and
 * the deterministic compile/prompt-assembly handoff (report section 4).
 * Run with: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseTreatment, parseShotlist, parsePrompts } from "./schemas";
import { gateShotList } from "./gate";
import { compileFilm, extractJobSpecs, assembleFootagePrompt } from "./compile";

/** A minimal valid treatment used as the base for tests. */
const goodTreatment = {
  title: "Why Compilers Wait",
  logline: "How a compiler turns waiting into fast code.",
  styleBlock: "Soft daylight, 35mm lens, muted blue-and-paper palette, shallow depth of field.",
  characters: [{ name: "Ada", description: "A patient engineer in a grey cardigan, round glasses." }],
  chapters: [
    { label: "the wait", claim: "Compilers spend most time waiting.", evidence: "Profile traces show idle loops." },
    { label: "the fix", claim: "Scheduling fixes the wait.", evidence: "Reordered builds finish in half the time." },
  ],
};

/** A minimal valid shot list that passes every pacing rule. */
function goodShotlist() {
  return {
    id: "why-compilers-wait",
    title: "Why Compilers Wait",
    fps: 30,
    chapters: ["the wait", "the fix"],
    nodes: [
      { id: "wait", label: "the wait" },
      { id: "fix", label: "the fix" },
    ],
    extraEdges: [],
    shots: [
      {
        id: "open",
        ch: "the wait",
        dur: 8,
        move: "cut",
        stage: "frame",
        look: "wait",
        scriptText: "Compilers wait more than they work.",
        blocks: [{ c: "TextReveal", text: "The waiting problem", accentWord: "waiting" }],
      },
      {
        id: "spine",
        ch: "the wait",
        dur: 6,
        move: "pan",
        stage: "none",
        look: "all",
        blocks: [],
      },
      {
        id: "fix-open",
        ch: "the fix",
        dur: 10,
        move: "cut",
        stage: "anchor",
        look: "fix",
        scriptText: "Scheduling removes the idle loops.",
        needsFootage: true,
        footageSeconds: 5,
        visualDirection: "Ada reordering glowing build steps on a glass wall.",
        blocks: [{ c: "Kicker", text: "section 02 - the fix" }],
      },
    ],
  };
}

test("treatment schema accepts a valid treatment", () => {
  const t = parseTreatment(goodTreatment);
  assert.equal(t.chapters.length, 2);
  assert.equal(t.characters[0].name, "Ada");
});

test("treatment schema rejects a chapter with an empty claim and a bad accent-free title", () => {
  const bad = { ...goodTreatment, chapters: [{ label: "", claim: "", evidence: "" }] };
  assert.throws(() => parseTreatment(bad), /chapters\.0/);
});

test("stage parsing normalizes long dashes and curly quotes to plain characters", () => {
  const t = parseTreatment({
    ...goodTreatment,
    logline: "Apps that win \u2014 quietly \u2013 and offline\u2026 maybe",
    characters: [{ name: 'Ada "the patient"', description: "Wears Ada\u2019s grey cardigan." }],
  });
  assert.equal(t.logline, "Apps that win - quietly - and offline... maybe");
  assert.equal(t.characters[0].name, 'Ada "the patient"');
  assert.ok(!t.characters[0].description.includes("\u2019"));
});

test("shotlist schema rejects a shot looking at an unknown node", () => {
  const sl = goodShotlist();
  // Point one look at a node that does not exist.
  (sl.shots as Record<string, unknown>[])[1].look = "ghost";
  assert.throws(() => parseShotlist(sl), /unknown node "ghost"/);
});

test("shotlist schema rejects a chapter with no shots", () => {
  const sl = goodShotlist();
  sl.chapters = ["the wait", "the fix", "orphan"];
  assert.throws(() => parseShotlist(sl), /chapter "orphan" has no shots/);
});

test("shotlist schema rejects needsFootage without visual direction", () => {
  const sl = goodShotlist();
  const flagged = (sl.shots as Record<string, unknown>[])[2];
  delete flagged.visualDirection;
  assert.throws(() => parseShotlist(sl), /no visualDirection/);
});

test("pacing gate rejects a device held past 25 seconds", () => {
  const deviceShot = {
    id: "long-device",
    ch: "the wait",
    dur: 40,
    move: "pan",
    stage: "anchor",
    look: "wait",
    blocks: [{ c: "MatrixGrid", values: [[0.1, 0.2], [0.3, 0.4]] }],
  };
  const gated = goodShotlist();
  (gated.shots as unknown[]).splice(1, 0, deviceShot);
  assert.throws(() => gateShotList(gated), /holds for 40s/);
});

test("pacing gate rejects a first shot that does not cut", () => {
  const sl = goodShotlist();
  (sl.shots as Record<string, unknown>[])[0].move = "pan";
  assert.throws(() => gateShotList(sl), /move: "cut"/);
});

test("pacing gate rejects the same device following itself", () => {
  const raw = goodShotlist();
  const grid = { c: "MatrixGrid", values: [[0.1, 0.2], [0.3, 0.4]] };
  (raw.shots as Record<string, unknown>[])[1] = {
    id: "grid-one",
    ch: "the wait",
    dur: 5,
    move: "pan",
    stage: "anchor",
    look: "wait",
    blocks: [grid],
  };
  (raw.shots as Record<string, unknown>[]).push({
    id: "grid-two",
    ch: "the fix",
    dur: 5,
    move: "cut",
    stage: "anchor",
    look: "fix",
    blocks: [grid],
  });
  // fix-open still cuts to chapter two; grid-two follows grid-one's device.
  assert.throws(() => gateShotList(raw), /MatrixGrid follows itself/);
});

test("pacing gate rejects a film under 10 seconds total", () => {
  const sl = goodShotlist();
  const shots = sl.shots as Record<string, unknown>[];
  shots.forEach((s) => (s.dur = 2));
  assert.throws(() => gateShotList(sl), /under 10s/);
});

test("pacing gate passes a valid shot list and returns a parsed film", () => {
  const { film } = gateShotList(goodShotlist());
  assert.equal(film.title, "Why Compilers Wait");
  assert.equal(film.canvas.nodes.length, 2);
  // Layout is left-to-right by node order.
  assert.ok(film.canvas.nodes[0].x < film.canvas.nodes[1].x);
});

test("compileFilm produces a film equal in structure to the gated provisional one", () => {
  const treatment = parseTreatment(goodTreatment);
  const { shotlist, film } = gateShotList(goodShotlist());
  const compiled = compileFilm(treatment, shotlist);
  assert.deepEqual(compiled.canvas, film.canvas);
  assert.deepEqual(compiled.shots.map((s) => s.id), film.shots.map((s) => s.id));
});

test("prompts schema rejects duplicate entries for the same shot", () => {
  const dup = { prompts: [{ shotId: "a", prompt: "x" }, { shotId: "a", prompt: "y" }] };
  assert.throws(() => parsePrompts(dup), /duplicate prompt/);
});

test("extractJobSpecs throws when a flagged shot has no prompt entry", () => {
  const treatment = parseTreatment(goodTreatment);
  const { shotlist } = gateShotList(goodShotlist());
  assert.throws(() => extractJobSpecs(treatment, shotlist, { prompts: [] }), /no entry for it/);
});

test("extractJobSpecs throws when a prompt names a non-flagged shot", () => {
  const treatment = parseTreatment(goodTreatment);
  const { shotlist } = gateShotList(goodShotlist());
  assert.throws(
    () => extractJobSpecs(treatment, shotlist, { prompts: [{ shotId: "open", prompt: "x" }] }),
    /does not need footage/,
  );
});

test("assembled b-roll prompts carry the style block and matching character sheets verbatim", () => {
  const treatment = parseTreatment(goodTreatment);
  const core = "Ada drags build stages across a glass wall.";
  const context = "Narration about Ada fixing the schedule.";
  const final = assembleFootagePrompt(treatment, core, context);
  assert.ok(final.startsWith(treatment.styleBlock));
  assert.ok(final.includes("A patient engineer in a grey cardigan"));
  assert.ok(final.endsWith(core));
  // A context without any named character pulls in no sheets.
  const bare = assembleFootagePrompt(treatment, core, "an empty server room hums.");
  assert.ok(!bare.includes("grey cardigan"));
});

test("extractJobSpecs builds small-profile specs at native clip settings", () => {
  const treatment = parseTreatment(goodTreatment);
  const { shotlist } = gateShotList(goodShotlist());
  const jobs = extractJobSpecs(treatment, shotlist, {
    prompts: [{ shotId: "fix-open", prompt: "Ada reorders glowing build steps.", negativePrompt: "text, watermark" }],
  });
  assert.equal(jobs.length, 1);
  const { spec } = jobs[0];
  assert.equal(spec.modelProfile, "small");
  assert.equal(spec.seconds, 5);
  assert.equal(spec.width, 832);
  assert.equal(spec.height, 480);
  assert.ok(spec.prompt.startsWith(treatment.styleBlock));
  assert.equal(spec.negativePrompt, "text, watermark");
});
