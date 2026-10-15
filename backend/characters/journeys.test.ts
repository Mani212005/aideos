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

test("J8 and J14: a hand-edited or stale embedded spec still opens but is refused before the stage draws it", () => {
  const pkg = packageWith("iona-library");
  const film = build(pkg.slug).film!;
  const edited = structuredClone(film) as Film & { scene: Scene };
  const cast = edited.scene.cast!.find((c) => c.kind === "character")!;
  if ("character" in cast) cast.character.palette.teal = "#ff00ff";
  const reopened = parseFilm(JSON.parse(JSON.stringify(edited)));
  assert.match(validateScene(reopened.scene as unknown as Scene).errors.map((e) => e.message).join("\n"), /cast iona character iona: hash: content hash mismatch/);
  // A film compiled before characters were data parses, then asks for a rebuild instead of drawing a placeholder.
  const legacy = structuredClone(film) as Film & { scene: Scene };
  const old = legacy.scene.cast!.findIndex((c) => c.kind === "character");
  const { character: _character, ...placement } = legacy.scene.cast![old] as Json;
  void _character;
  legacy.scene.cast![old] = { ...placement, asset: "iona-art-v1", rig: "iona-v1" } as never;
  assert.match(validateStage(parseFilm(JSON.parse(JSON.stringify(legacy))).scene as unknown as Scene).join("\n"), /compiled from the P0 Iona fixture .* rebuild the design/);
  const mismatch = structuredClone(film.scene as Scene);
  mismatch.performances![0].data.rigId = "marlo-v1";
  assert.match(validateStage(mismatch).join("\n"), /fitted to rig marlo-v1 but iona is iona-v1; rebuild the design/);
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
  assert.deepEqual(Object.keys(rawSpec("pip")).slice(0, 4), ["schema", "id", "version", "hash"]);
});
