/**
 * File Description: Unit and feature tests for aideos.character/1: schema, hash, rig derivation, part expansion, validation errors and Iona's exact promotion.
 * Inputs and outputs: committed and mutated character specs -> asserted parse results, field-named issues, rigs and CPU geometry.
 * Used by: npm test.
 */
import "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Box3, Mesh, Vector3, type ShaderMaterial } from "three";
import { sha256Hex } from "../../src/dl/characters/sha256";
import { canonicalJson, characterHash, characterRigId } from "../../src/dl/characters/hash";
import { parseCharacter, validateCharacterSemantics, TRIANGLE_BUDGET } from "../../src/dl/characters/validate";
import { expandParts } from "../../src/dl/characters/expand";
import { restPositions, rigFromCharacter } from "../../src/dl/characters/rig";
import { characterSpecSchema } from "../../src/dl/characters/schema";
import { IONA_RIG } from "../../src/dl/performance/iona";
import { buildCharacter } from "../../src/dl/scene/characters/build";
import { applyCharacter } from "../../src/dl/scene/characters/apply";
import { createPerformanceEvaluator } from "../../src/dl/performance/evaluate";
import { createIonaArt } from "../../test_fixtures/characters/iona-legacy/iona-art-v1.js";
import { CHARACTER_FILES, loadSpec, rawSpec, type FixtureCharacter } from "../testSupport/characters";
import { characterCandidates, loadCharacter, requireCharacter } from "./library";
import { checkCharacterFile, formatCharacterReport } from "./cli";
import { declaredMaterialPalette } from "../../src/dl/scene/stageMaterials";
import { undeclaredMaterialColours } from "../../src/dl/scene/stageGeometry";
import { buildProp } from "../../src/dl/scene/props/paperGlider";
import { validateStage } from "../../src/dl/scene/validateStage";
import { readFilm } from "../pipeline/filmStore";
import type { Scene } from "../../src/dl/scene/types";
import { buildDesign } from "../designSpec/build";
import { fitReceiveSpan } from "../performance/bindReceive";
import { IONA_CHARACTER_SPEC, isLegacyIonaReference, resolveCharacterSpec } from "../../src/dl/characters/resolve";
import { reportThreeStageInitializationFailure } from "../../src/dl/scene/threeStageError";

const NAMES = Object.keys(CHARACTER_FILES) as FixtureCharacter[];
// Parses a mutated copy of a committed spec and returns its issue lines.
function issuesFor(name: FixtureCharacter, mutate: (raw: Record<string, any>) => void, requireHash = false): string[] {
  const raw = rawSpec(name) as Record<string, any>;
  mutate(raw);
  return parseCharacter(raw, { requireHash }).errors.map((e) => `${e.path}: ${e.message}`);
}

test("every committed character parses, verifies its stamped hash and passes semantic validation", () => {
  for (const name of NAMES) {
    const parsed = parseCharacter(rawSpec(name), { requireHash: true });
    assert.deepEqual(parsed.errors, [], name);
    assert.equal(parsed.spec!.hash, characterHash(parsed.spec!), name);
    assert.equal(parsed.rig!.id, `${name}-v1`);
  }
});

test("the browser-safe legacy Iona alias resolves to the committed stamped character spec", () => {
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, "../../characters/iona.character.json"), "utf8"));
  assert.deepEqual(IONA_CHARACTER_SPEC, characterSpecSchema.parse(source));
  const legacy = { id: "iona", kind: "character" as const, asset: "iona-art-v1", rig: "iona-v1" };
  assert.equal(isLegacyIonaReference(legacy), true);
  assert.equal(resolveCharacterSpec(legacy), IONA_CHARACTER_SPEC);
  assert.equal(resolveCharacterSpec({ ...legacy, id: "marlo" }), undefined);
});

test("the pure SHA-256 matches node:crypto, and canonical JSON ignores key order", () => {
  for (const text of ["", "abc", "ünïcødé ✓", "x".repeat(1000), JSON.stringify(rawSpec("iona"))]) {
    assert.equal(sha256Hex(text), crypto.createHash("sha256").update(text, "utf8").digest("hex"));
  }
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
  assert.throws(() => canonicalJson({ a: Number.NaN }), /non-finite/);
});

test("the hash changes with any content change and survives reformatting", () => {
  const spec = loadSpec("iona");
  const recoloured = structuredClone(spec); recoloured.palette.teal = "#1f8a8d";
  assert.notEqual(characterHash(recoloured), characterHash(spec));
  const reparsed = characterSpecSchema.parse(JSON.parse(JSON.stringify(spec, null, 7)));
  assert.equal(characterHash(reparsed), characterHash(spec));
  assert.match(issuesFor("iona", (raw) => { raw.palette.teal = "#1f8a8d"; }).join("\n"), /^hash: content hash mismatch/m);
  assert.match(issuesFor("iona", (raw) => { delete raw.hash; }, true).join("\n"), /^hash: missing; stamp the spec/m);
});

// Rejects raw face texture colors that are absent from the character's finite palette.
test("face texture colors must be declared palette values", () => {
  const raw = rawSpec("iona") as Record<string, any>;
  raw.face.eyes.iris[0] = "#ff00ff";
  raw.hash = characterHash(characterSpecSchema.parse(raw));
  assert.match(parseCharacter(raw).errors.map((issue) => `${issue.path}: ${issue.message}`).join("\n"), /^face\.eyes\.iris\[0\]: #ff00ff is not in palette; add it as a palette token$/m);

  const caseVariant = rawSpec("iona") as Record<string, any>;
  caseVariant.face.eyes.iris[0] = "#1F8A8C";
  caseVariant.hash = characterHash(characterSpecSchema.parse(caseVariant));
  assert.deepEqual(parseCharacter(caseVariant).errors, []);
});

// Routes WebGL initialization failures to the correct user-facing channel and releases readiness.
test("Three stage initialization failures report Player status and cancel exports", () => {
  const error = new Error("context creation failed");
  const playerReady: string[] = [];
  const playerCanceled: Error[] = [];
  reportThreeStageInitializationFailure(error, "courier-scene", true, (message) => playerReady.push(message), (failure) => playerCanceled.push(failure));
  assert.deepEqual(playerReady, ["Scene graphics unavailable: WebGL could not start (context creation failed)"]);
  assert.deepEqual(playerCanceled, []);

  const exportReady: string[] = [];
  const exportCanceled: Error[] = [];
  reportThreeStageInitializationFailure(error, "courier-scene", false, (message) => exportReady.push(message), (failure) => exportCanceled.push(failure));
  assert.deepEqual(exportReady, ["Three stage courier-scene: WebGL could not start: context creation failed"]);
  assert.equal(exportCanceled.length, 1);
  assert.equal(exportCanceled[0].message, "Three stage courier-scene: WebGL could not start: context creation failed");
});

test("Iona's spec derives the frozen P0 rig exactly: joints, order, parents and offsets", () => {
  const rig = rigFromCharacter(loadSpec("iona"));
  assert.equal(rig.id, IONA_RIG.id);
  assert.equal(JSON.stringify(rig.joints), JSON.stringify(IONA_RIG.joints));
  assert.deepEqual(rig.limbs, IONA_RIG.limbs);
  assert.deepEqual(rig.sockets.gripR, { joint: "wristR", offset: [0, -0.4, 0.09] });
});

test("Iona's spec builds geometry, materials, outlines and hierarchy bit-identical to the frozen legacy module", () => {
  const legacy = createIonaArt(), art = buildCharacter(loadSpec("iona"));
  try {
    const names = Object.keys(art.parts.meshes);
    assert.deepEqual(names, Object.keys(legacy.parts.meshes).filter((n) => !n.startsWith("glider")));
    for (const name of names) {
      const a = legacy.parts.meshes[name] as Mesh, b = art.parts.meshes[name] as Mesh;
      for (const attr of ["position", "normal", "uv"]) {
        const x = a.geometry.attributes[attr]?.array, y = b.geometry.attributes[attr]?.array;
        assert.equal(Boolean(x), Boolean(y), `${name}.${attr}`);
        if (x && y) assert.ok(x.length === y.length && x.every((v, i) => v === y[i]), `${name}.${attr} differs`);
      }
      assert.deepEqual(Array.from(b.geometry.index?.array ?? []), Array.from(a.geometry.index?.array ?? []), `${name} index`);
      const ma = a.material as unknown as Record<string, any>, mb = b.material as unknown as Record<string, any>;
      assert.deepEqual([mb.type, mb.color?.getHex(), mb.side, Boolean(mb.map)], [ma.type, ma.color?.getHex(), ma.side, Boolean(ma.map)], `${name} material`);
      assert.equal(b.parent?.name, a.parent?.name, `${name} parent`);
      const inkA = a.children[0] as Mesh | undefined, inkB = b.children[0] as Mesh | undefined;
      assert.equal((inkB?.material as ShaderMaterial | undefined)?.uniforms.w.value, (inkA?.material as ShaderMaterial | undefined)?.uniforms.w.value, `${name} outline`);
    }
    for (const joint of IONA_RIG.joints) assert.ok(art.rig[joint.id].position.equals(legacy.rig[joint.id].position), joint.id);
  } finally { art.dispose(); legacy.dispose(); }
});

test("schema errors name the exact field to fix", () => {
  const cases: Array<[(raw: Record<string, any>) => void, RegExp]> = [
    [(raw) => { raw.skeleton.proportions.knee = [0, -1.45]; }, /^skeleton\.proportions\.knee/m],
    [(raw) => { raw.palette.teal = "teal"; }, /^palette\.teal: a colour is #rrggbb/m],
    [(raw) => { raw.limbs = {}; }, /^\(root\): Unrecognized key/m],
    [(raw) => { raw.expressions.neutral.eyeOpen = 9; }, /^expressions\.neutral\.eyeOpen/m],
    [(raw) => { raw.schema = "aideos.character/2"; }, /^schema/m],
    [(raw) => { raw.parts[0].points = [[0, 1, 0]]; }, /^parts\[0\]\.points/m],
  ];
  for (const [mutate, expected] of cases) assert.match(issuesFor("iona", mutate).join("\n"), expected);
});

test("semantic errors name the field: joints, materials, sockets, ground contact, head, swings and limits", () => {
  const cases: Array<[FixtureCharacter, (raw: Record<string, any>) => void, RegExp]> = [
    ["iona", (raw) => { raw.parts[0].joint = "pelvis"; }, /^parts\[0\]\.joint: unknown joint "pelvis"/m],
    ["iona", (raw) => { raw.parts[0].material = "gold"; }, /^parts\[0\]\.material: unknown palette token "gold"/m],
    ["iona", (raw) => { raw.sockets.gripR.joint = "elbowR"; }, /^sockets\.gripR\.joint: gripR rides on wristR/m],
    ["iona", (raw) => { raw.skeleton.proportions.hips = [0, 3.5, 0]; }, /^skeleton\.proportions\.hips: the rest pose leaves soleL above the ground by 0\.3000; set hips y to 3\.2/m],
    ["iona", (raw) => { raw.parts = raw.parts.filter((p: { type?: string }) => p.type !== "head"); }, /^parts: needs exactly one head part/m],
    ["iona", (raw) => { raw.secondary[0].parts[0].part = "cape"; }, /^secondary\[0\]\.parts\[0\]\.part: unknown part "cape"/m],
    ["iona", (raw) => { raw.limits.bend.arm = [2, 1]; }, /^limits\.bend\.arm: needs 0 <= min < max/m],
    ["iona", (raw) => { raw.limits.rotation.tail = { min: [0, 0, 0], max: [1, 1, 1] }; }, /^limits\.rotation\.tail: unknown joint "tail"/m],
    ["iona", (raw) => { raw.face.eyes.line = "gold"; }, /^face\.eyes\.line: unknown palette token/m],
    ["iona", (raw) => { delete raw.expressions.neutral; }, /^expressions\.neutral: every character needs a neutral expression/m],
    ["pip", (raw) => { raw.parts.find((p: { type?: string }) => p.type === "torso").surface = "cape"; }, /^parts\[0\]\.surface: unknown surface "cape"/m],
    ["marlo", (raw) => { raw.parts.at(-1).parts[0].to = "wrist{side}"; }, /^parts\[\d+\]\.parts\[0\]\.to: "wristL" must be a child joint of "shoulderL"/m],
    ["iona", (raw) => { raw.parts[2].parts[0].id = "coatTail"; }, /part id "coatTail" is also used/m],
    ["iona", (raw) => { raw.parts[5].overrides.R["lapel{side}"].b = [[1, 2]]; }, /^parts\[5\]\.overrides\.R\.lapel\{side\}\.b/m],
  ];
  for (const [name, mutate, expected] of cases) assert.match(issuesFor(name, mutate).join("\n"), expected);
});

// Reports an ignored mirror override typo with its field path and nearest declared key.
test("mirror override typos are rejected with the closest declared part key", () => {
  const errors = issuesFor("iona", (raw) => { raw.parts[5].overrides = { R: { "lapell{side}": { b: [[0, 0], [1, 1]] } } }; });
  assert.match(errors.join("\n"), /^parts\[5\]\.overrides\.R\.lapell\{side\}: unknown mirror override key "lapell\{side\}"; did you mean "lapel\{side\}"\?/m);
});

// Rejects secondary transform ownership duplicates within one entry and across entries.
test("a secondary part has only one transform owner", () => {
  const acrossEntries = issuesFor("iona", (raw) => { raw.secondary[1].parts[1].part = "coatTailL"; });
  assert.match(acrossEntries.join("\n"), /^secondary\[1\]\.parts\[1\]\.part: "coatTailL" is already driven by secondary\[0\]\.parts\[0\]\.part/m);
  const withinEntry = issuesFor("iona", (raw) => { raw.secondary[0].parts[1].part = "coatTailL"; });
  assert.match(withinEntry.join("\n"), /^secondary\[0\]\.parts\[1\]\.part: "coatTailL" is already driven by secondary\[0\]\.parts\[0\]\.part/m);
});

test("a missing extra-joint parent is reported through parsing and embedded-stage validation", () => {
  const raw = rawSpec("iona") as Record<string, any>;
  raw.skeleton.extraJoints = [{ id: "tail", parent: "missing", offset: [0, 0, 0] }];
  const parsed = parseCharacter(raw);
  assert.ok(parsed.spec);
  assert.ok(parsed.errors.some((issue) => issue.path === "skeleton.extraJoints[0].parent"));
  parsed.spec.hash = characterHash(parsed.spec);

  assert.equal(buildDesign("iona-receive", "hand-built").state, "passed");
  const film = structuredClone(readFilm("iona-receive")!);
  const scene = film.scene as Scene;
  const cast = scene.cast!.find((item) => item.id === "iona")!;
  assert.equal(cast.kind, "character");
  if (cast.kind === "character" && "character" in cast) cast.character = parsed.spec;
  assert.ok(validateStage(scene).some((message) => message.includes("skeleton.extraJoints[0].parent")));
});

test("budgets stop a character that would be too heavy for the render worker", () => {
  const issues = issuesFor("iona", (raw) => { raw.parts[0].segments = 128; raw.parts[0].radial = 128; for (const p of raw.parts) if (p.type === "tube") { p.segments = 128; p.radial = 96; } });
  assert.match(issues.join("\n"), new RegExp(`^parts: draws \\d+ triangles, over the ${TRIANGLE_BUDGET} budget`, "m"));
});

test("mirror groups substitute sides, mirror authored x without -0, honour overrides and keep the authored order", () => {
  const { parts, issues } = expandParts(loadSpec("iona"));
  assert.deepEqual(issues, []);
  const ids = parts.map((p) => p.id);
  assert.deepEqual(ids.slice(0, 10), ["torso", "hem", "coatTailR", "coatTailL", "jacketOpening", "waistSeam", "jacketLiningL", "lapelL", "jacketLiningR", "lapelR"]);
  const tail = (id: string) => parts.find((p) => p.id === id)!.geometry as unknown as { points: number[][] };
  assert.deepEqual(tail("coatTailR").points.map((p) => p[0]), tail("coatTailL").points.map((p) => -p[0]));
  const foot = parts.find((p) => p.id === "footR")!.geometry as unknown as { points: number[][] };
  assert.ok(foot.points.every((p) => !Object.is(p[0], -0)), "mirroring must not create -0");
  const lapelR = parts.find((p) => p.id === "lapelR")!.geometry as unknown as { b: number[][] };
  assert.equal(lapelR.b[0][0], -(0.27 + 0.13 * 0.78));
});

test("tube normals face outward on both mirrored sides, so no part renders inside out", () => {
  for (const name of NAMES) {
    const art = buildCharacter(loadSpec(name));
    try {
      for (const id of ["upperArmL", "upperArmR", "footL", "footR"]) {
        const mesh = art.parts.meshes[id] ?? art.parts.meshes[id.replace("upperArm", "upperArm")];
        if (!mesh) continue;
        const pos = mesh.geometry.attributes.position, nrm = mesh.geometry.attributes.normal, center = new Box3().setFromBufferAttribute(pos as never).getCenter(new Vector3());
        let outward = 0;
        for (let i = 0; i < pos.count; i++) outward += new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(center).dot(new Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i))) > 0 ? 1 : 0;
        assert.ok(outward / pos.count > 0.8, `${name} ${id} normals point inward`);
      }
    } finally { art.dispose(); }
  }
});

test("the three characters are clearly different: height, heads tall, palette and silhouette", () => {
  const measure = (name: FixtureCharacter) => {
    const art = buildCharacter(loadSpec(name));
    try {
      const size = new Box3().setFromObject(art.rig.root).getSize(new Vector3());
      return { height: size.y, width: size.x, palette: new Set(Object.values(loadSpec(name).palette)) };
    } finally { art.dispose(); }
  };
  const [iona, pip, marlo] = NAMES.map(measure);
  assert.ok(pip.height < iona.height * 0.65 && marlo.height > iona.height * 1.05, JSON.stringify([iona.height, pip.height, marlo.height]));
  assert.ok(pip.width / pip.height > iona.width / iona.height, "the mascot is stockier");
  for (const [a, b] of [[iona, pip], [iona, marlo], [pip, marlo]]) assert.ok([...a.palette].filter((c) => b.palette.has(c)).length <= 2, "palettes are distinct");
});

test("apply assigns every channel absolutely: permuted frame order gives identical world matrices (no state between frames)", () => {
  for (const name of NAMES) {
    const spec = loadSpec(name), rig = rigFromCharacter(spec);
    const action = fitReceiveSpan(69, 0, 160, 30, [0, 0, 0], { rig, policy: "clamp" }).action;
    const evaluate = createPerformanceEvaluator(rig, action);
    const art = buildCharacter(spec);
    // Captures every mesh's world matrix after applying one frame.
    const snapshot = (frame: number) => { applyCharacter(art, evaluate(frame)); return Object.values(art.parts.meshes).map((m) => m.matrixWorld.toArray().map((v) => v.toFixed(10)).join(",")).join("|"); };
    try {
      const reference = new Map([0, 45, 69, 80, 111].map((f) => [f, snapshot(f)]));
      for (const f of [111, 0, 69, 45, 80, 69, 0, 111]) assert.equal(snapshot(f), reference.get(f), `${name} frame ${f}`);
    } finally { art.dispose(); }
  }
});

test("rest poses stand on the ground for every character", () => {
  for (const name of NAMES) {
    const spec = loadSpec(name), rest = restPositions(rigFromCharacter(spec));
    for (const side of ["L", "R"] as const) assert.ok(Math.abs(rest[`ankle${side}`][1] + spec.sockets[`sole${side}`].offset[1]) < 1e-9, `${name} sole${side}`);
    assert.deepEqual(validateCharacterSemantics(spec).errors, []);
  }
});

test("library resolution prefers the film package, verifies hashes and names the files it searched", () => {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-character-pkg-"));
  try {
    assert.equal(loadCharacter("iona").spec?.id, "iona");
    assert.equal(characterRigId(requireCharacter("iona").spec), "iona-v1");
    const missing = loadCharacter("nobody", pkg);
    assert.match(missing.errors[0].message, /no character "nobody"; looked for .*nobody\.character\.json and .*characters\/nobody\.character\.json/);
    fs.mkdirSync(path.join(pkg, "characters"));
    fs.copyFileSync(CHARACTER_FILES.pip, path.join(pkg, "characters", "pip.character.json"));
    assert.equal(characterCandidates("pip", pkg)[0], path.join(pkg, "characters", "pip.character.json"));
    assert.equal(loadCharacter("pip", pkg).spec?.id, "pip");
    const tampered = JSON.parse(fs.readFileSync(CHARACTER_FILES.pip, "utf8")); tampered.palette.sun = "#000000";
    fs.writeFileSync(path.join(pkg, "characters", "pip.character.json"), JSON.stringify(tampered));
    assert.match(loadCharacter("pip", pkg).errors.map((e) => `${e.path}: ${e.message}`).join("\n"), /^hash: content hash mismatch/m);
    assert.throws(() => requireCharacter("pip", pkg), /character pip \(.*pip\.character\.json\) hash: content hash mismatch/);
  } finally { fs.rmSync(pkg, { recursive: true, force: true }); }
});

test("character check stamps only an otherwise valid spec and reports the rig, budget and receive fit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-character-check-"));
  try {
    const file = path.join(dir, "draft.character.json");
    const draft = rawSpec("marlo"); delete draft.hash; draft.id = "draft";
    fs.writeFileSync(file, JSON.stringify(draft));
    const before = checkCharacterFile(file);
    assert.equal(before.ok, false);
    assert.match(before.errors.join("\n"), /^hash: missing/m);
    const stamped = checkCharacterFile(file, { stamp: true });
    assert.equal(stamped.ok, true, stamped.errors.join("\n"));
    assert.equal(stamped.stamped, true);
    assert.equal(stamped.summary?.rig, "draft-v1");
    assert.ok(stamped.summary!.headsTall > 7 && stamped.receive?.ok);
    const broken = { ...draft, palette: { ...(draft.palette as object), pine: "green" } };
    fs.writeFileSync(file, JSON.stringify(broken));
    const refused = checkCharacterFile(file, { stamp: true });
    assert.equal(refused.stamped, false);
    assert.match(refused.errors.join("\n"), /^palette\.pine: a colour is #rrggbb/m);
    assert.match(checkCharacterFile(path.join(dir, "missing.json")).errors[0], /missing or unreadable/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Reports unbound receive channels as resting while preserving a passing check.
test("character check reports unbound receive channels as resting", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-character-resting-"));
  try {
    const file = path.join(dir, "resting.character.json");
    const spec = characterSpecSchema.parse(rawSpec("marlo"));
    spec.id = "resting";
    spec.secondary = [];
    spec.hash = characterHash(spec);
    fs.writeFileSync(file, JSON.stringify(spec));
    const report = checkCharacterFile(file);
    const expected = ["receive-v1: channel coat rests (no swinging piece bound)", "receive-v1: channel tuft rests (no swinging piece bound)", "receive-v1: channel side rests (no swinging piece bound)"];
    assert.equal(report.ok, true, report.errors.join("\n"));
    assert.equal(report.receive?.ok, true);
    assert.deepEqual(report.notes, expected);
    assert.ok(expected.every((line) => formatCharacterReport(report).includes(`note  ${line}`)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("character check returns the extra-joint parent error before building geometry", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-character-parent-"));
  try {
    const file = path.join(dir, "broken.character.json");
    const raw = rawSpec("iona") as Record<string, any>;
    raw.skeleton.extraJoints = [{ id: "tail", parent: "missing", offset: [0, 0, 0] }];
    fs.writeFileSync(file, JSON.stringify(raw));
    let report!: ReturnType<typeof checkCharacterFile>;
    assert.doesNotThrow(() => { report = checkCharacterFile(file); });
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /^skeleton\.extraJoints\[0\]\.parent:/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("character id lookup refuses a valid spec stored under another character id", () => {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-character-id-"));
  try {
    fs.mkdirSync(path.join(pkg, "characters"));
    fs.writeFileSync(path.join(pkg, "characters", "iona.character.json"), JSON.stringify(rawSpec("marlo")));
    const loaded = loadCharacter("iona", pkg);
    assert.match(loaded.errors.map((issue) => `${issue.path}: ${issue.message}`).join("\n"), /^id: the spec in .* is "marlo" but the design asks for character "iona"/m);
  } finally { fs.rmSync(pkg, { recursive: true, force: true }); }
});

test("material declarations are character-owned: every mesh colour is in the spec palette, the face base or the prop's colours", () => {
  for (const name of NAMES) {
    const spec = loadSpec(name), art = buildCharacter(spec), prop = buildProp("paper-glider-v1");
    try {
      const palette = declaredMaterialPalette(spec, "paper-glider-v1");
      assert.ok(palette.includes("#f2e8d0") && palette.includes("#b5532f") && palette.includes("#ffffff"));
      const meshes: Mesh[] = [];
      for (const root of [art.rig.root, prop.root]) root.traverse((node) => { if ((node as Mesh).isMesh) meshes.push(node as Mesh); });
      assert.deepEqual(undeclaredMaterialColours(meshes, palette), [], name);
      assert.notDeepEqual(undeclaredMaterialColours(meshes, palette.filter((c) => c !== spec.palette[spec.outline.color])), [], `${name}: removing the ink colour must be caught`);
    } finally { art.dispose(); prop.dispose(); }
  }
});
