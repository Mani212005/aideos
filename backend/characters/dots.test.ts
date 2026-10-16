/**
 * File Description: Surface attachment, deterministic sampling and authored treatment contracts for optional dots.
 * Inputs and outputs: real character rigs and stage fixtures -> sample/pose equality and path-specific validation assertions.
 * Used by: npm test; raster, crop and export evidence lives in j3_j4_dots.journey.ts.
 */
import "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BoxGeometry, Points, Vector3 } from "three";
import type { Scene } from "../../src/dl/scene/types";
import { validateStageResources } from "../performance/resources";
import { sampleDotSurface } from "../../src/dl/scene/materials/dotSamples";
import { buildDots } from "../../src/dl/scene/materials/dots";
import { stageTreatmentAt } from "../../src/dl/scene/materials/treatment";
import { buildCharacter } from "../../src/dl/scene/characters/build";
import { applyCharacter } from "../../src/dl/scene/characters/apply";
import { createPerformanceEvaluator } from "../../src/dl/performance/evaluate";
import { rigFromCharacter } from "../../src/dl/characters/rig";
import { fitReceiveSpan } from "../performance/bindReceive";
import { loadSpec } from "../testSupport/characters";
import { resolvePackageDir } from "../../src/dl/videoPackageLoader";
import { designSpecSchema } from "../designSpec/spec";
import { compileDesign } from "../designSpec/compile";
import { resolveDesignCharacters } from "../designSpec/build";
import { parseFilm } from "../../src/dl/schema";
import { fieldIssues } from "../../src/dl/schemaIssues";
import { checkFilmDesign } from "../designCheck/designCheck";
import { checkLookPlan } from "../lookPlan/check";
import { validateStage } from "../../src/dl/scene/validateStage";
import { readFilmFacts } from "../review/source";
import { stageTruth, stageTruthText } from "../review/stageTruth";

// Reads one isolated fixture package file.
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(resolvePackageDir("iona-receive"), name), "utf8"));

test("dots samples have fixed rank/seed, Poisson spacing and rest on the actual surface", () => {
  const box = new BoxGeometry(1, 1, 1);
  const a = sampleDotSurface(box, 0.12), b = sampleDotSurface(box, 0.12);
  assert.deepEqual(a.attributes.position.array, b.attributes.position.array);
  assert.deepEqual(a.attributes.rank.array, b.attributes.rank.array);
  assert.ok(a.attributes.position.count > 150);
  const p = a.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new Vector3().fromBufferAttribute(p, i);
    assert.ok(Math.abs(Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) - 0.5) < 1e-6);
    for (let j = 0; j < i; j++) assert.ok(v.distanceTo(new Vector3().fromBufferAttribute(p, j)) >= 0.12 - 1e-6);
  }
  assert.notDeepEqual(a.attributes.rank.array, sampleDotSurface(box, 0.12, 99).attributes.rank.array);
  a.dispose(); b.dispose(); box.dispose();
});

test("dots follow posed geometry for every library character; reverse seeks and switching restore exact state", () => {
  for (const id of ["iona", "pip", "marlo"] as const) {
    const spec = loadSpec(id), art = buildCharacter(spec);
    const originals = Object.values(art.parts.meshes).map((m) => m.material);
    const dots = buildDots(art.rig.root);
    const action = fitReceiveSpan(69, 0, 160, 30, [0, 0, 0], { rig: rigFromCharacter(spec), policy: "clamp" }).action;
    const evaluate = createPerformanceEvaluator(rigFromCharacter(spec), action);
    const mesh = Object.values(art.parts.meshes).find((m) => m.parent?.name.toLowerCase().includes("wrist")) ?? Object.values(art.parts.meshes)[0];
    const points = mesh.children.find((p) => p instanceof Points);
    assert.ok(points instanceof Points);
    const originalSamples = Array.from(points.geometry.attributes.position.array);
    // Reads an attached point in world space after assigning a complete absolute pose.
    const at = (frame: number) => { applyCharacter(art, evaluate(frame)); return points.localToWorld(new Vector3().fromBufferAttribute(points.geometry.attributes.position, 0)).toArray(); };
    const contact = at(69), before = at(0);
    assert.notDeepEqual(before, contact);
    for (const frame of [90, 65, 0, 69, 69]) { at(frame); if (frame === 69) assert.deepEqual(at(frame), contact); }
    assert.deepEqual(Array.from(points.geometry.attributes.position.array), originalSamples);
    dots.setEnabled(true, 1920); assert.equal(points.visible, true);
    dots.setEnabled(false, 1080); assert.equal(points.visible, false);
    assert.deepEqual(Object.values(art.parts.meshes).map((m) => m.material), originals);
    dots.dispose(); art.dispose();
  }
});

test("treatment freeze validates dot resources separately from cel", () => {
  assert.deepEqual(validateStageResources(undefined, true), []);
  assert.ok(validateStageResources((file) => file.endsWith("dots.ts") ? Buffer.from("changed") : fs.readFileSync(file), true).some((e) => e.includes("dots.ts")));
});

test("look and design refuse unknown treatment at its field path", () => {
  const look = read("design/look.json"); look.film.treatment = "sparkles";
  const checked = checkLookPlan(look, "dots-invalid");
  assert.equal(checked.ok, false); assert.ok(checked.findings.some((f) => f.where.includes("film.treatment")));
  const design = read("design/design.json"); design.treatment = "sparkles";
  const parsed = designSpecSchema.safeParse(design);
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.ok(fieldIssues(parsed.error, design).some((issue) => issue.path === "treatment"));
});

test("dots film defaults, shot overrides, review truth and stage checks agree without changing cel defaults", () => {
  const raw = read("design/design.json");
  raw.treatment = "dots-v1";
  raw.shots = { catch: { stageTreatment: "cel-v1" } };
  const spec = designSpecSchema.parse(raw), film = parseFilm(read("film.json"));
  const { characters } = resolveDesignCharacters(spec, resolvePackageDir("iona-receive"));
  const result = compileDesign(film, spec, read("voiceover_words.json").words, "hand-built", { characters });
  assert.deepEqual(result.errors, []); assert.ok(result.film?.scene);
  assert.deepEqual(result.film.shots, film.shots, "a shading-only override preserves shot content");
  const scene = result.film.scene as Scene;
  assert.equal(stageTreatmentAt({}, 0), "cel-v1");
  assert.equal(stageTreatmentAt(scene, 0), "dots-v1");
  const span = scene.treatments![0];
  assert.equal(stageTreatmentAt(scene, span.startFrame), "cel-v1");
  assert.equal(stageTreatmentAt(scene, span.endFrame), "dots-v1");
  const truth = stageTruth(readFilmFacts(result.film, { width: 1080, height: 1920 }), null)!;
  assert.match(stageTruthText(truth), /dots-v1/); assert.match(stageTruthText(truth), /captions excluded/);
  const invalid = { ...scene, treatment: "sparkles" };
  assert.ok(checkFilmDesign({ ...result.film, scene: invalid }).findings.some((f) => f.message.includes("treatment")));
  assert.ok(validateStage(invalid as Scene).some((e) => e.includes("scene.treatment")));
  scene.treatments![0].endFrame = scene.durationFrames + 1;
  assert.ok(validateStage(scene).some((e) => e.includes("scene.treatments.0")));
});
