/**
 * File Description: Journey J8: every way a character film can be broken at authoring time ends in a clear, named error and never in a half-written film or a blank frame. Covers a cue phrase that is not spoken, a cue naming a shot that does not exist, named artwork that is missing, a hand target that cannot be reached, and a look or design that is stale after the narration changes. Every failure is an enforced assertion through the author-facing entry point.
 * Inputs and outputs: deliberately broken design variants of the iona-receive fixture -> build status errors, unchanged film.json, and finite numbers from the evaluator.
 * Used by: npm run test:journeys (the CI journeys job).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { journey } from "./harness";
import { journeyRequest, writeIonaDesign, type Loose } from "./ionaFilm";
import { runProduction } from "../pipeline/run";
import { buildDesign } from "../designSpec/build";
import { checkLookPlanById } from "../lookPlan/check";
import { checkCharacterFile } from "../characters/cli";
import { CHARACTER_FILES } from "../testSupport/characters";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import { createReceiveAction } from "../../src/dl/performance/receive";
import { createPerformanceEvaluator } from "../../src/dl/performance/evaluate";
import { critiquePerformance } from "../../src/dl/performance/critique";
import { IONA_RIG } from "../../src/dl/performance/iona";
import type { ReceiveAction } from "../../src/dl/performance/types";

type Design = Loose;

/** Narrates the fixture beats and stops at the look, leaving a package ready for a design to be written. */
async function preparedPackage(slug: string): Promise<string> {
  await runProduction({ ...journeyRequest(slug), stopAfter: "look" });
  return path.join(getVideosDir(), slug);
}

/** Writes a design edited by `edit`, builds it and returns the status plus proof film.json did not change. */
function buildBroken(slug: string, pkg: string, edit: (d: Design) => void, editLook?: (l: Design) => void) {
  writeIonaDesign(slug, edit, editLook);
  const before = fs.readFileSync(path.join(pkg, "film.json"), "utf8");
  const status = buildDesign(slug, "hand-built");
  return { status, filmUnchanged: fs.readFileSync(path.join(pkg, "film.json"), "utf8") === before };
}

journey("J8 a cue phrase that is not spoken names the phrase and the shot, and writes no film", async () => {
  const pkg = await preparedPackage("j8-bad-phrase");
  const { status, filmUnchanged } = buildBroken("j8-bad-phrase", pkg, (d) => {
    d.performances[0].decisive.phrase = "never spoken here";
  });
  assert.equal(status.state, "failed");
  assert.match(status.errors.join("\n"), /"never spoken here" is not spoken in shot "beat-02"/);
  assert.ok(filmUnchanged, "a failed build must leave film.json exactly as it was");
});

journey("J8 a cue naming a shot that does not exist says which shot", async () => {
  const pkg = await preparedPackage("j8-bad-shot");
  const { status, filmUnchanged } = buildBroken("j8-bad-shot", pkg, (d) => {
    d.performances[0].decisive.shotId = "no-such-shot";
  });
  assert.equal(status.state, "failed");
  assert.match(status.errors.join("\n"), /No shot "no-such-shot"/);
  assert.ok(filmUnchanged);
});

journey("J8 artwork named in the design but missing on disk is reported by file name", async () => {
  const pkg = await preparedPackage("j8-missing-art");
  const { status, filmUnchanged } = buildBroken("j8-missing-art", pkg, (d) => {
    d.background = { file: "visuals/not-there.svg" };
  });
  assert.equal(status.state, "failed");
  assert.match(status.errors.join("\n"), /visuals\/not-there\.svg is named in design\.json but does not exist/);
  assert.ok(filmUnchanged);
});

journey("J8 a failed design stops the run at needs_design and renders nothing", async () => {
  const slug = "j8-stop";
  const pkg = await preparedPackage(slug);
  buildBroken(slug, pkg, (d) => {
    d.performances[0].decisive.phrase = "never spoken here";
  });
  const result = await runProduction({ ...journeyRequest(slug), formats: ["long"], renderFrames: [0, 2] });
  assert.notEqual(result.status, "completed");
  assert.deepEqual(result.outputs, []);
  assert.ok(!fs.existsSync(path.join(pkg, "renders", "long.mp4")), "no mp4 may exist for a film whose design failed");
  assert.ok((result.nextSteps ?? []).length > 0, "the stop must say what to do next");
});

journey("J8 a hand target that cannot be reached clamps without NaN and fails the grip critique by name", () => {
  const reachable = createReceiveAction(69);
  const farAway: ReceiveAction = {
    ...reachable,
    constraints: reachable.constraints.map((c) => (c.planted ? c : { ...c, target: c.target.map((k) => ({ ...k, value: [k.value[0] * 8, k.value[1] * 8, k.value[2] * 8] as const })) })),
  };
  const evaluate = createPerformanceEvaluator(IONA_RIG, farAway);
  for (let frame = farAway.fromFrame; frame <= farAway.toFrame; frame += 3) {
    const s = evaluate(frame);
    const numbers = [...s.root.position, ...Object.values(s.joints).flatMap((j) => [...j.position, ...j.rotation]), ...s.prop.position];
    assert.ok(numbers.every(Number.isFinite), `frame ${frame} produced NaN or Infinity for an unreachable target`);
  }
  const report = critiquePerformance(IONA_RIG, farAway, evaluate, 69);
  assert.equal(report.passed, false);
  assert.ok(report.checks.some((c) => !c.passed && /grip|reach|path/i.test(c.id)), `a failed check must name the grip path, got ${report.checks.filter((c) => !c.passed).map((c) => c.id)}`);
  assert.equal(critiquePerformance(IONA_RIG, reachable, createPerformanceEvaluator(IONA_RIG, reachable), 69).passed, true, "the unmodified action must still pass");
}, { disk: false });

journey("J10 an unknown field in design.json is reported by field name", async () => {
  const pkg = await preparedPackage("j8-unknown-field");
  const { status, filmUnchanged } = buildBroken("j8-unknown-field", pkg, (d) => {
    d.performances[0].bogusField = 1;
  });
  assert.equal(status.state, "failed");
  assert.match(status.errors.join("\n"), /design.json performances\[0\].bogusField: is not a known field/);
  assert.ok(filmUnchanged);
});

journey("J8 a cue phrase spoken twice in one shot is rejected as ambiguous", async () => {
  const pkg = await preparedPackage("j8-dup-phrase");
  // "toward" occurs twice in the narration of beat-01; look and design name the same phrase so only the ambiguity can fail the build.
  const { status, filmUnchanged } = buildBroken(
    "j8-dup-phrase",
    pkg,
    (d) => {
      d.performances[0].decisive = { ...d.performances[0].decisive, shotId: "beat-01", phrase: "toward" };
    },
    (l) => {
      l.film.performances[0].decisive = { ...l.film.performances[0].decisive, shotId: "beat-01", phrase: "toward" };
    },
  );
  assert.equal(status.state, "failed", "a phrase heard twice must not silently bind to the first occurrence");
  assert.match(status.errors.join("\n"), /"toward".*2 times.*beat-01.*ambiguous/);
  assert.ok(filmUnchanged);
});

journey("J10 a bad design value names its field and expected value", async () => {
  const pkg = await preparedPackage("j10-design-type");
  const { status, filmUnchanged } = buildBroken("j10-design-type", pkg, (d) => { d.performances[0].limits = "stretch"; });
  assert.equal(status.state, "failed");
  assert.match(status.errors.join("\n"), /design.json performances\[0\].limits: must be one of "fail", "clamp"/);
  assert.ok(filmUnchanged);
});

journey("J10 a bad look value names its field and expected value", async () => {
  const slug = "j10-look-type";
  await preparedPackage(slug);
  writeIonaDesign(slug, undefined, (l) => { l.film.performances[0].decisive.edge = "middle"; });
  const report = checkLookPlanById(slug);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.rule === "schema" && f.where === "film.performances[0].decisive.edge" && /must be one of "start", "end"/.test(f.message)), JSON.stringify(report.findings));
});

journey("J10 a bad character spec names its field and expected value", (ctx) => {
  const raw = JSON.parse(fs.readFileSync(CHARACTER_FILES.iona, "utf8"));
  raw.skeleton.proportions.elbow[0] = "long";
  const file = path.join(ctx.workDir, "bad.character.json");
  fs.writeFileSync(file, JSON.stringify(raw));
  const report = checkCharacterFile(file);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => /skeleton\.proportions\.elbow\[0\]: expected number/.test(e)), JSON.stringify(report.errors));
}, { disk: false });

journey("J8 an unreachable hand target is refused before the film is written", async () => {
  const slug = "j8-unreachable";
  const pkg = await preparedPackage(slug);
  const { status, filmUnchanged } = buildBroken(slug, pkg, (d) => { d.performances[0].targetOffset = [100, 100, 100]; });
  assert.equal(status.state, "failed");
  assert.match(status.errors.join("\n"), /receive-message.*(reach|target)/);
  assert.ok(filmUnchanged);
});

journey("J8 a missing character resource is named before the film is written", async () => {
  const slug = "j8-missing-character";
  const pkg = await preparedPackage(slug);
  const { status, filmUnchanged } = buildBroken(slug, pkg, (d) => { d.assets[0].character = "absent-courier"; }, (l) => { l.film.cast[0].character = "absent-courier"; });
  assert.equal(status.state, "failed");
  assert.match(status.errors.join("\n"), /absent-courier.*characters\/absent-courier.character.json/);
  assert.ok(filmUnchanged);
});
