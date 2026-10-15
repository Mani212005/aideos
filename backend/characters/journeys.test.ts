/**
 * File Description: Journey tests for characters as data through the real design build: new characters (J5), resume (J6), facts (J7), failures (J8), authoring (J10) and stale embedded specs (J14).
 * Inputs and outputs: throwaway copies of the iona-receive fixture package with swapped characters -> build status, compiled films, validation and fingerprints.
 * Used by: npm test.
 */
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDesign } from "../designSpec/build";
import { designFilesFingerprint } from "../pipeline/run";
import { readFilm, writeFilm } from "../pipeline/filmStore";
import { checkFilmDesign } from "../designCheck/designCheck";
import { parseFilm, type Film } from "../../src/dl/schema";
import { validateScene } from "../../src/dl/scene/validateScene";
import { validateStage } from "../../src/dl/scene/validateStage";
import { stageEvidence } from "../../src/dl/scene/stageFacts";
import { convertFilmToLayeredFilm, convertLayeredFilmToFilm } from "../../src/dl/convertFilm";
import type { Scene } from "../../src/dl/scene/types";
import { CHARACTER_FILES, rawSpec, type FixtureCharacter } from "../testSupport/characters";
import { checkCharacterFile } from "./cli";
import { checkLookPlanById } from "../lookPlan/check";
import { characterHash } from "../../src/dl/characters/hash";
import { characterSpecSchema, type CharacterSpec } from "../../src/dl/characters/schema";

const SOURCE = path.join(TEST_VIDEOS_DIR, "iona-receive");
let counter = 0;
type Json = Record<string, any>;

// Copies the iona-receive fixture into a new package whose design and look name another character.
function packageWith(character: FixtureCharacter | "iona-library", edit: (design: Json, look: Json) => void = () => undefined): { slug: string; dir: string } {
  const slug = `journey-${character}-${++counter}`, dir = path.join(TEST_VIDEOS_DIR, slug);
  fs.cpSync(SOURCE, dir, { recursive: true });
  for (const file of ["film.json", "design/base-film.json"]) {
    const target = path.join(dir, file);
    if (fs.existsSync(target)) fs.writeFileSync(target, JSON.stringify({ ...JSON.parse(fs.readFileSync(target, "utf8")), id: slug }, null, 2));
  }
  const id = character === "iona-library" ? "iona" : character;
  if (character !== "iona-library" && character !== "iona") {
    fs.mkdirSync(path.join(dir, "characters"), { recursive: true });
    fs.copyFileSync(CHARACTER_FILES[character], path.join(dir, "characters", `${id}.character.json`));
  }
  const designFile = path.join(dir, "design", "design.json"), lookFile = path.join(dir, "design", "look.json");
  const design = JSON.parse(fs.readFileSync(designFile, "utf8")), look = JSON.parse(fs.readFileSync(lookFile, "utf8"));
  design.assets.find((a: Json) => a.kind === "character").character = id;
  look.film.cast.find((c: Json) => c.id === "iona").character = id;
  edit(design, look);
  fs.writeFileSync(designFile, JSON.stringify(design, null, 2));
  fs.writeFileSync(lookFile, JSON.stringify(look, null, 2));
  return { slug, dir };
}
// Builds a package and returns its status and written film.
function build(slug: string) {
  const status = buildDesign(slug, "hand-built");
  return { status, film: status.state === "passed" ? readFilm(slug)! : undefined };
}
// Names every build error and failed finding, for assertion messages.
const why = (status: ReturnType<typeof buildDesign>) => JSON.stringify({ errors: status.errors, findings: status.findings.filter((f) => f.severity === "error") });

test("J5: Pip and Marlo, defined only as data, run the same receive through the real design build in both crops", () => {
  const marlo = packageWith("marlo", (design) => { design.assets[0].unitsToStage = 70; design.assets[0].position = [960, 1220]; });
  const pip = packageWith("pip", (design) => { design.performances[0].limits = "clamp"; design.assets[0].unitsToStage = 110; });
  for (const [name, pkg] of [["marlo", marlo], ["pip", pip]] as const) {
    const { status, film } = build(pkg.slug);
    assert.equal(status.state, "passed", `${name}: ${why(status)}`);
    const scene = film!.scene as Scene;
    const cast = scene.cast!.find((c) => c.kind === "character")!;
    assert.ok("character" in cast && cast.character.id === name && cast.character.hash, `${name} embeds its verified spec`);
    assert.equal(scene.performances![0].data.rigId, `${name}-v1`);
    assert.deepEqual(validateStage(scene), []);
    assert.equal(checkFilmDesign(film).ok, true);
  }
  const pipFilm = readFilm(pip.slug)!;
  assert.match(pipFilm.scene!.performances![0].retarget!.warnings.join("\n"), /limits\.rotation\.spine/);
  assert.ok(buildDesign(pip.slug, "hand-built").findings.some((f) => f.severity === "warning" && /retargeted onto pip-v1 with clamp policy/.test(f.message)), "a clamp is reported, never silent");
});

test("J5: a stiff character under the default fail policy is refused with the limit named, not silently changed", () => {
  const pkg = packageWith("pip");
  const { status } = build(pkg.slug);
  assert.equal(status.state, "failed");
  assert.match(status.errors.join("\n"), /performance receive-message .*limits\.rotation\.spine: the receive turns spine to -0\.420 rad/);
});

test("J5: look plan and design build carry two characters through the same receive", () => {
  const pkg = packageWith("marlo", (design, look) => {
    look.film.cast.find((item: Json) => item.id === "iona").character = "iona";
    design.assets = [
      { id: "iona", renderer: "three", kind: "character", character: "iona", position: [800, 1215], unitsToStage: 44, treatment: "cel-v1" },
      { id: "marlo", renderer: "three", kind: "character", character: "marlo", position: [1200, 1215], unitsToStage: 44, treatment: "cel-v1" },
      { id: "glider", renderer: "three", kind: "prop", asset: "paper-glider-v1", treatment: "cel-v1" },
      { id: "glider-two", renderer: "three", kind: "prop", asset: "paper-glider-v1", treatment: "cel-v1" },
    ];
    design.performances.push({ ...design.performances[0], id: "receive-two", actor: "marlo", prop: "glider-two" });
    look.film.cast.push({ id: "marlo", renderer: "three", treatment: "cel-v1", what: "Marlo receives a second glider", enters: "approach", changes: [{ at: "catch", how: "Marlo catches and settles the second glider.", state: "message-received", magnitude: "major" }], character: "marlo" });
    look.film.cast.push({ id: "glider-two", renderer: "three", treatment: "cel-v1", asset: "paper-glider-v1", what: "A second paper glider", enters: "approach", changes: [{ at: "catch", how: "The second glider becomes attached to Marlo's grip.", state: "message-received", magnitude: "major" }] });
    look.film.performances.push({ ...look.film.performances[0], id: "receive-two", actor: "marlo", prop: "glider-two" });
    for (const shot of look.shots) {
      shot.performances.push("receive-two");
      shot.carries.push("marlo", "glider-two");
    }
  });
  const lookReport = checkLookPlanById(pkg.slug);
  assert.equal(lookReport.ok, true, JSON.stringify(lookReport.findings));
  const { status, film } = build(pkg.slug);
  assert.equal(status.state, "passed", why(status));
  const scene = film!.scene as Scene;
  assert.deepEqual(scene.performances!.map((p) => p.data.rigId), ["iona-v1", "marlo-v1"]);
  const facts = stageEvidence(scene, [90]);
  assert.deepEqual(facts.long.performances.map((p: { character: { id: string } }) => p.character.id), ["iona", "marlo"]);
  const doubled = structuredClone(scene); doubled.performances![1].prop = "glider";
  assert.match(validateStage(doubled).join("\n"), /prop glider is already owned by another performance/);
});

// Runs nine independent cast identities through look validation and the production design compiler.
test("J5: nine performances across two character specs pass look check, design build and compile", () => {
  const pkg = packageWith("marlo", (design, look) => {
    const positions = [[650, 650], [960, 650], [1270, 650], [650, 930], [960, 930], [1270, 930], [650, 1210], [960, 1210], [1270, 1210]];
    const assets: Json[] = [], performances: Json[] = [], cast: Json[] = [];
    for (let i = 0; i < 9; i++) {
      const actor = `actor-${i + 1}`, prop = `glider-${i + 1}`, character = i % 2 ? "iona" : "marlo";
      assets.push({ id: actor, renderer: "three", kind: "character", character, position: positions[i], unitsToStage: 15, treatment: "cel-v1" });
      assets.push({ id: prop, renderer: "three", kind: "prop", asset: "paper-glider-v1", treatment: "cel-v1" });
      performances.push({ ...design.performances[0], id: `receive-${i + 1}`, actor, prop });
      cast.push({ id: actor, renderer: "three", treatment: "cel-v1", what: `${character} performs receive ${i + 1}`, enters: "approach", changes: [{ at: "catch", how: `${character} catches and holds a glider in receive ${i + 1}.`, state: "message-received", magnitude: "major" }], character });
      cast.push({ id: prop, renderer: "three", treatment: "cel-v1", asset: "paper-glider-v1", what: `Glider ${i + 1}`, enters: "approach", changes: [{ at: "catch", how: `Glider ${i + 1} becomes attached to its receiver.`, state: "message-received", magnitude: "major" }] });
    }
    design.assets = assets;
    design.performances = performances;
    look.film.stage = "Nine receives share an orthographic stage across two character specs.";
    look.film.cast = cast;
    look.film.performances = performances.map((performance) => ({ ...performance, carries: ["approach", "catch", "receipt"] }));
    for (const shot of look.shots) {
      shot.performances = performances.map((performance) => performance.id);
      shot.carries = cast.map((item) => item.id);
    }
  });
  const lookReport = checkLookPlanById(pkg.slug);
  assert.equal(lookReport.ok, true, JSON.stringify(lookReport.findings));
  const { status, film } = build(pkg.slug);
  assert.equal(status.state, "passed", why(status));
  const scene = film!.scene as Scene;
  assert.equal(scene.performances!.length, 9);
  assert.equal(new Set(scene.performances!.map((performance) => performance.actor)).size, 9);
  assert.equal(new Set(scene.performances!.map((performance) => performance.prop)).size, 9);
  assert.deepEqual(new Set(scene.cast!.filter((item) => item.kind === "character").map((item) => "character" in item ? item.character.id : "")), new Set(["iona", "marlo"]));
  assert.equal(checkFilmDesign(film).ok, true);
});

// Exercises numeric frame cues through look validation and the production design compiler.
test("numeric frame starts match between the look plan and design build", () => {
  const pkg = packageWith("iona-library", (design, look) => {
    design.performances[0].start = 60;
    look.film.performances[0].start = 60;
  });
  const lookReport = checkLookPlanById(pkg.slug);
  assert.equal(lookReport.ok, true, JSON.stringify(lookReport.findings));
  const { status } = build(pkg.slug);
  assert.equal(status.state, "passed", why(status));
});

test("J7: stage facts name each character by id, version, rig and hash, never by pasting the whole spec into a prompt", () => {
  const pkg = packageWith("marlo", (design) => { design.assets[0].unitsToStage = 70; design.assets[0].position = [960, 1220]; });
  const film = build(pkg.slug).film!;
  const facts = stageEvidence(film.scene as Scene, [90]);
  const cast = facts.reel.cast.find((c: { kind: string }) => c.kind === "character") as { character: Json };
  assert.deepEqual(Object.keys(cast.character).sort(), ["hash", "id", "name", "rig", "version"]);
  assert.equal(cast.character.rig, "marlo-v1");
  assert.ok(JSON.stringify(facts).length < 40000, "facts stay prompt-sized");
  assert.equal(facts.long.performances[0].visualQuality, "unmeasured");
});

test("J8: a missing character, a tampered spec and an unknown field each fail the build with the file and field named", () => {
  const missing = packageWith("iona-library", (design) => { design.assets[0].character = "nobody"; });
  assert.match(build(missing.slug).status.errors.join("\n"), /asset "iona" character nobody .* \(file\): no character "nobody"; looked for .*characters\/nobody\.character\.json/);
  const tampered = packageWith("marlo");
  const specFile = path.join(tampered.dir, "characters", "marlo.character.json");
  fs.writeFileSync(specFile, fs.readFileSync(specFile, "utf8").replace('"pine": "#2e5e4e"', '"pine": "#ff0000"'));
  assert.match(build(tampered.slug).status.errors.join("\n"), /asset "iona" character marlo \(characters\/marlo\.character\.json\) hash: content hash mismatch/);
  const misspelt = packageWith("marlo");
  const raw = JSON.parse(fs.readFileSync(path.join(misspelt.dir, "characters", "marlo.character.json"), "utf8")); raw.skeleton.proportions.elbo = [0, 0, 0];
  fs.writeFileSync(path.join(misspelt.dir, "characters", "marlo.character.json"), JSON.stringify(raw));
  assert.match(build(misspelt.slug).status.errors.join("\n"), /skeleton\.proportions: Unrecognized key/);
});

test("J8: design build refuses a character spec whose embedded id differs from the requested id", () => {
  const pkg = packageWith("iona-library");
  fs.mkdirSync(path.join(pkg.dir, "characters"), { recursive: true });
  fs.writeFileSync(path.join(pkg.dir, "characters", "iona.character.json"), JSON.stringify(rawSpec("marlo")));
  const status = build(pkg.slug).status;
  assert.equal(status.state, "failed");
  assert.match(status.errors.join("\n"), /asset "iona" character iona .* id: the spec in .* is "marlo" but the design asks for character "iona"/);
});

// Builds a package-local character whose legal id collides with Object.prototype.
test("J5: constructor is resolved as a package character id through design build", () => {
  const pkg = packageWith("marlo", (design) => { design.assets[0].unitsToStage = 70; design.assets[0].position = [960, 1220]; });
  const spec = characterSpecSchema.parse(rawSpec("marlo"));
  spec.id = "constructor";
  spec.hash = characterHash(spec);
  fs.writeFileSync(path.join(pkg.dir, "characters", "constructor.character.json"), JSON.stringify(spec, null, 2));
  const designFile = path.join(pkg.dir, "design", "design.json"), design = JSON.parse(fs.readFileSync(designFile, "utf8"));
  design.assets.find((asset: Json) => asset.kind === "character").character = "constructor";
  fs.writeFileSync(designFile, JSON.stringify(design, null, 2));
  const lookFile = path.join(pkg.dir, "design", "look.json"), look = JSON.parse(fs.readFileSync(lookFile, "utf8"));
  look.film.cast.find((item: Json) => item.id === "iona").character = "constructor";
  fs.writeFileSync(lookFile, JSON.stringify(look, null, 2));
  const { status, film } = build(pkg.slug);
  assert.equal(status.state, "passed", why(status));
  const cast = (film!.scene as Scene).cast!.find((item) => item.id === "iona")!;
  assert.ok("character" in cast && cast.character.id === "constructor");
});

test("J8 and J14: a hand-edited or stale embedded spec still opens but is refused before the stage draws it", () => {
  const pkg = packageWith("iona-library");
  const film = build(pkg.slug).film!;
  const edited = structuredClone(film) as Film & { scene: Scene };
  const cast = edited.scene.cast!.find((c) => c.kind === "character")!;
  if ("character" in cast) cast.character.palette.teal = "#ff00ff";
  const reopened = parseFilm(JSON.parse(JSON.stringify(edited)));
  assert.match(validateScene(reopened.scene as unknown as Scene).errors.map((e) => e.message).join("\n"), /cast iona character iona: hash: content hash mismatch/);
  const mismatch = structuredClone(film.scene as Scene);
  mismatch.performances![0].data.rigId = "marlo-v1";
  assert.match(validateStage(mismatch).join("\n"), /fitted to rig marlo-v1 but iona is iona-v1; rebuild the design/);
});

// Refuses a self-consistent edited character when its receive was fitted to the prior content.
test("J14: a restamped embedded proportion change invalidates the fitted receive", () => {
  const pkg = packageWith("iona-library");
  const film = build(pkg.slug).film!;
  const edited = structuredClone(film) as Film & { scene: Scene };
  const cast = edited.scene.cast!.find((item) => item.kind === "character")!;
  assert.ok("character" in cast);
  cast.character.skeleton.proportions.head[1] += 0.01;
  cast.character.hash = characterHash(cast.character);
  const reopened = parseFilm(JSON.parse(JSON.stringify(edited)));
  const errors = validateScene(reopened.scene as unknown as Scene).errors.map((error) => error.message).join("\n");
  assert.match(errors, /performance receive-message: fitted to character iona hash [0-9a-f]{64} but the embedded spec hashes to [0-9a-f]{64}; rebuild the design/);
  const missingHash = structuredClone(film.scene as Scene);
  delete missingHash.performances![0].retarget!.characterHash;
  assert.match(validateStage(missingHash).join("\n"), /performance receive-message: missing fitted character hash; rebuild the design/);
});

test("J8: a P0 design that still names the Iona fixture asset builds unchanged through the character library", () => {
  const pkg = packageWith("iona-library", (design, look) => {
    const asset = design.assets[0]; delete asset.character; asset.asset = "iona-art-v1"; asset.rig = "iona-v1";
    const cast = look.film.cast[0]; delete cast.character; cast.asset = "iona-art-v1"; cast.rig = "iona-v1";
  });
  const { status, film } = build(pkg.slug);
  assert.equal(status.state, "passed", why(status));
  const cast = (film!.scene as Scene).cast!.find((c) => c.kind === "character")!;
  assert.ok("character" in cast && cast.character.id === "iona");
});

test("J6: editing a film's character spec reopens design on resume; an unchanged package keeps its fingerprint", () => {
  const pkg = packageWith("marlo");
  const before = designFilesFingerprint(pkg.slug);
  assert.equal(designFilesFingerprint(pkg.slug), before);
  const specFile = path.join(pkg.dir, "characters", "marlo.character.json");
  fs.writeFileSync(specFile, fs.readFileSync(specFile, "utf8").replace('"mustard": "#e2ae47"', '"mustard": "#e2ae48"'));
  assert.notEqual(designFilesFingerprint(pkg.slug), before);
});

test("J6: editing Iona's receive source rig reopens a Marlo-only design", () => {
  const pkg = packageWith("marlo");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-receive-source-"));
  try {
    const sourceFile = path.join(dir, "iona.character.json");
    const source = rawSpec("iona") as CharacterSpec;
    fs.writeFileSync(sourceFile, JSON.stringify(source));
    const before = designFilesFingerprint(pkg.slug, { receiveSourceFile: sourceFile });
    source.palette.teal = "#197f80";
    source.hash = characterHash(source);
    fs.writeFileSync(sourceFile, JSON.stringify(source));
    assert.notEqual(designFilesFingerprint(pkg.slug, { receiveSourceFile: sourceFile }), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("J9: a compiled P0 Three film parses and validates through the legacy Iona alias", () => {
  const file = path.join(__dirname, "../../test_fixtures/packages/legacy-iona-p0/film.json");
  const film = parseFilm(JSON.parse(fs.readFileSync(file, "utf8")));
  const scene = film.scene as Scene;
  const validation = validateScene(scene);
  assert.equal(validation.isValid, true, JSON.stringify(validation.errors));
  assert.deepEqual(validateStage(scene), []);
  const facts = stageEvidence(scene, [scene.performances![0].data.contact.frame]);
  const ionaCast = facts.long.cast.find((item) => item.id === "iona" && "character" in item);
  assert.ok(ionaCast && "character" in ionaCast);
  assert.equal(ionaCast.character.id, "iona");
});

test("J3: the editor's layer conversion and save/reload keep a non-Iona character's embedded spec intact", () => {
  const pkg = packageWith("marlo", (design) => { design.assets[0].unitsToStage = 70; design.assets[0].position = [960, 1220]; });
  const film = build(pkg.slug).film!;
  writeFilm(film.id, convertLayeredFilmToFilm(convertFilmToLayeredFilm(film), film));
  assert.deepEqual(readFilm(film.id)!.scene, film.scene);
});

test("J10: the authoring guide's starter spec checks, stamps and performs exactly as documented", () => {
  const guide = fs.readFileSync(path.join(__dirname, "../../characters/README.md"), "utf8");
  const block = /```json starter\n([\s\S]*?)```/.exec(guide);
  assert.ok(block, "characters/README.md carries a ```json starter block");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-starter-"));
  try {
    const file = path.join(dir, "starter.character.json");
    fs.writeFileSync(file, block![1]);
    const unstamped = checkCharacterFile(file);
    assert.deepEqual(unstamped.errors.map((e) => e.split(":")[0]), ["hash"], unstamped.errors.join("\n"));
    const stamped = checkCharacterFile(file, { stamp: true });
    assert.equal(stamped.ok, true, stamped.errors.join("\n"));
    assert.equal(stamped.receive?.ok, true, stamped.receive?.error ?? "receive did not fit");
    // Bad input names the field an agent must fix.
    const bad = JSON.parse(fs.readFileSync(file, "utf8")); bad.sockets.gripR.joint = "handR";
    fs.writeFileSync(file, JSON.stringify(bad));
    assert.match(checkCharacterFile(file).errors.join("\n"), /^sockets\.gripR\.joint: gripR rides on wristR, not "handR"/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
