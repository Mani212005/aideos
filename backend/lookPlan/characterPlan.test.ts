/**
 * File Description: Look plan v2 for character films (J8, J10): each performance names its character by spec id, version and hash; the look check resolves it, refuses a different version, warns on changed art, ties the decisive shot and the design performance to it, and the look brief and LOOK.md explain performances and characters in plain words.
 * Inputs and outputs: throwaway copies of the iona-receive fixture package, edited per case -> look check findings, build-time look errors, brief and LOOK.md text.
 * Used by: npm test.
 */
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { checkLookPlan, checkLookPlanById, packageCharacterResolver, type LookCheckReport } from "./check";
import { availableCharacters, exampleStageLookPlan, renderLookBrief } from "./brief";
import { renderLookMd, writeLookMd } from "./render";
import { parseLookPlan, safeParseLookPlan } from "./schema";
import { readCheckedLookPlan } from "../designSpec/build";
import { parseFilm } from "../../src/dl/schema";
import { characterHash } from "../../src/dl/characters/hash";
import { characterSpecSchema } from "../../src/dl/characters/schema";
import { rawSpec } from "../testSupport/characters";

const SOURCE = path.join(TEST_VIDEOS_DIR, "iona-receive");
type Json = Record<string, any>;
let counter = 0;

// Copies the fixture package and applies edits to its look plan and design.
function pkgWith(editLook: (look: Json) => void = () => undefined, editDesign: (design: Json) => void = () => undefined): { slug: string; dir: string } {
  const slug = `look-character-${++counter}`, dir = path.join(TEST_VIDEOS_DIR, slug);
  fs.cpSync(SOURCE, dir, { recursive: true });
  const filmFile = path.join(dir, "film.json");
  fs.writeFileSync(filmFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(filmFile, "utf8")), id: slug }, null, 2));
  for (const [file, edit] of [["design/look.json", editLook], ["design/design.json", editDesign]] as const) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    edit(json);
    fs.writeFileSync(path.join(dir, file), JSON.stringify(json, null, 2));
  }
  return { slug, dir };
}
// Lists findings of one rule and severity as "where: message" lines.
const findings = (report: LookCheckReport, severity: "error" | "warning") => report.findings.filter((f) => f.severity === severity).map((f) => `${f.where}: ${f.message}`).join("\n");
// The library Iona as the look brief lists her.
const iona = () => availableCharacters().find((c) => c.id === "iona")!;

test("the committed fixture plans Iona by id, version and hash and passes with no character finding", () => {
  const { slug } = pkgWith();
  const report = checkLookPlanById(slug);
  assert.equal(report.ok, true, findings(report, "error"));
  assert.ok(!report.findings.some((f) => f.rule === "character"), findings(report, "warning"));
  const look = parseLookPlan(JSON.parse(fs.readFileSync(path.join(SOURCE, "design/look.json"), "utf8")));
  assert.ok(look.schema === "aideos.look/2");
  assert.deepEqual(look.film.performances[0].character, { id: "iona", version: iona().version, hash: iona().hash });
});

test("J8: a performance without its character, or with an unknown field, is named by field, not 'Invalid input'", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(SOURCE, "design/look.json"), "utf8"));
  delete raw.film.performances[0].character;
  raw.film.performances[0].pose = "crouch";
  const result = safeParseLookPlan(raw);
  assert.equal(result.success, false);
  const issues = result.error!.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
  assert.match(issues, /film\.performances\.0\.character: /);
  assert.match(issues, /film\.performances\.0: Unrecognized key: "pose"/);
});

test("J8: an unresolvable character, a different version and a character the actor is not are errors naming the performance", () => {
  const unknown = checkLookPlanById(pkgWith((look) => { look.film.cast[0].character = "nobody"; look.film.performances[0].character.id = "nobody"; }).slug);
  assert.equal(unknown.ok, false);
  assert.match(findings(unknown, "error"), /film\.performances\.receive-message\.character: character "nobody" does not resolve to a checked spec: .*no character "nobody".*aideos character check --stamp/);

  const version = checkLookPlanById(pkgWith((look) => { look.film.performances[0].character.version = 2; }).slug);
  assert.equal(version.ok, false);
  assert.match(findings(version, "error"), /plans iona version 2 but the spec is version 1; a new version is a different character/);

  const mismatch = checkLookPlanById(pkgWith((look) => { look.film.performances[0].character = { id: "marlo", version: iona().version, hash: iona().hash }; }).slug);
  assert.equal(mismatch.ok, false);
  assert.match(findings(mismatch, "error"), /names character "marlo" but its actor cast "iona" is character "iona"/);
});

test("J8: every nested object in look/2 rejects unknown fields while look/1 keeps legacy stripping", () => {
  const source = JSON.parse(fs.readFileSync(path.join(SOURCE, "design/look.json"), "utf8"));
  const cases: Array<{ where: string; edit: (look: Json) => void }> = [
    { where: "decidedBy", edit: (look) => { look.decidedBy.extra = true; } },
    { where: "film.cast.0.changes.0", edit: (look) => { look.film.cast[0].changes = [{ at: "approach", how: "moves", extra: true }]; } },
    { where: "film.camera.0", edit: (look) => { look.film.camera[0].extra = true; } },
    { where: "film.palette", edit: (look) => { look.film.palette.extra = true; } },
    { where: "film.captions", edit: (look) => { look.film.captions.extra = true; } },
    { where: "approval", edit: (look) => { look.approval = { captain: null, extra: true }; } },
  ];
  for (const { where, edit } of cases) {
    const candidate = structuredClone(source);
    edit(candidate);
    const parsed = safeParseLookPlan(candidate);
    if (parsed.success) assert.fail(`${where} unexpectedly accepted an unknown field`);
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
    assert.match(issues, new RegExp(`${where.replaceAll(".", "\\.")}: Unrecognized key: "extra"`));
  }

  const legacy: Json = structuredClone(VALID_LOOK_PLAN);
  legacy.decidedBy.extra = true;
  legacy.film.cast[0].changes[0].extra = true;
  legacy.film.camera[0].extra = true;
  legacy.film.palette.extra = true;
  legacy.film.captions.extra = true;
  legacy.approval!.extra = true;
  const parsedLegacy = parseLookPlan(legacy);
  assert.equal(parsedLegacy.schema, "aideos.look/1");
  assert.deepEqual(parsedLegacy.film.palette, { bg: "#0A0A0B", accent: "#635BFF" });
  assert.deepEqual(parsedLegacy.film.cast[0].changes[0], {
    at: "beat-02", how: "spins down and dims as the cache takes over", state: "disk dimmed while the cache serves requests", magnitude: "moderate",
  });
});

test("J6 and J8: changed art within the same version is a warning naming both hashes, so the look still passes and design rebuilds", () => {
  const { slug, dir } = pkgWith();
  const spec = characterSpecSchema.parse(rawSpec("iona"));
  spec.palette.teal = "#197f80";
  spec.hash = characterHash(spec);
  fs.mkdirSync(path.join(dir, "characters"), { recursive: true });
  fs.writeFileSync(path.join(dir, "characters", "iona.character.json"), JSON.stringify(spec, null, 2));
  const report = checkLookPlanById(slug);
  assert.equal(report.ok, true, findings(report, "error"));
  assert.match(findings(report, "warning"), new RegExp(`planned against iona hash ${iona().hash.slice(0, 12)} but the spec now hashes to ${spec.hash.slice(0, 12)}; design and render rebuild`));
  const film = parseFilm(JSON.parse(fs.readFileSync(path.join(dir, "film.json"), "utf8")));
  const checked = readCheckedLookPlan(film);
  assert.ok(checked.plan, checked.errors.join("\n"));
  assert.match((checked.warnings ?? []).join("\n"), /spec now hashes to/);
});

test("J8: the decisive shot must list its performance, and the design performance must be played by the same character", () => {
  const unlisted = checkLookPlanById(pkgWith((look) => { look.shots.find((s: Json) => s.id === "catch").performances = []; look.film.performances[0].carries = ["approach", "receipt"]; }).slug);
  assert.equal(unlisted.ok, false);
  assert.match(findings(unlisted, "error"), /shots\.catch\.performances: must list performance "receive-message", whose decisive contact lands in this shot/);

  const designed = pkgWith(undefined, (design) => {
    design.assets.push({ id: "marlo", renderer: "three", kind: "character", character: "marlo", position: [1200, 1210], unitsToStage: 60, treatment: "cel-v1" });
    design.performances[0].actor = "marlo";
  });
  const report = checkLookPlanById(designed.slug);
  assert.equal(report.ok, false);
  assert.match(findings(report, "error"), /design\.performances\.receive-message: the design performance's actor is character "marlo" but the look plans "iona"/);
});

test("J8: a decisive phrase spoken twice in its shot is refused by the look check, before design", () => {
  const { slug, dir } = pkgWith();
  const filmFile = path.join(dir, "film.json"), film = JSON.parse(fs.readFileSync(filmFile, "utf8"));
  film.shots.find((s: Json) => s.id === "catch").scriptText = "She catches the message, then catches her breath.";
  fs.writeFileSync(filmFile, JSON.stringify(film, null, 2));
  const report = checkLookPlanById(slug);
  assert.equal(report.ok, false);
  assert.match(findings(report, "error"), /receive-message: decisive phrase "catches" is spoken 2 times in shot "catch" \(ambiguous\)/);
});

test("J8: anticipation must start before the decisive word, checked against the measured narration", () => {
  const { dir } = pkgWith((look) => { look.film.performances[0].start = "receipt"; });
  const film = parseFilm(JSON.parse(fs.readFileSync(path.join(dir, "film.json"), "utf8")));
  const checked = readCheckedLookPlan(film);
  assert.equal(checked.plan, undefined);
  assert.match(checked.errors.join("\n"), /film\.performances\.receive-message\.start: starts at frame 180, not before its decisive contact on "catches" at frame 111/);
});

test("J10: the look brief explains performances, lists every character with id, version and hash, and names the character commands", () => {
  const film = parseFilm(JSON.parse(fs.readFileSync(path.join(SOURCE, "film.json"), "utf8")));
  const brief = renderLookBrief(film, availableCharacters(SOURCE));
  assert.match(brief, /## Character films/);
  assert.ok(brief.includes(`| \`iona\` | ${iona().version} | \`${iona().hash}\` | library |`));
  assert.match(brief, /aideos character check <file> --stamp/);
  assert.match(brief, /aideos character sheet <file>/);
  assert.match(brief, /the hand meets the glider exactly on the decisive word/i);
  assert.match(brief, /Face appeal, finger contact and final on-screen occlusion are not measured/);
  // The worked example in the brief is itself a valid plan that pins a real character.
  const example = exampleStageLookPlan(iona());
  const report = checkLookPlan(example, "example", { resolveCharacter: packageCharacterResolver(SOURCE) });
  assert.equal(report.ok, true, findings(report, "error"));
  assert.ok(!report.findings.some((f) => f.rule === "character"));
});

test("an invalid package character hides the library character with the same id", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), ".look-character-shadow-"));
  try {
    const charactersDir = path.join(dir, "characters");
    fs.mkdirSync(charactersDir);
    fs.writeFileSync(path.join(charactersDir, "iona.character.json"), "not json");
    assert.equal(availableCharacters(dir).some((character) => character.id === "iona"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("J10: LOOK.md says each performance in plain words and marks the decisive shot", () => {
  const { slug, dir } = pkgWith();
  const md = fs.readFileSync(writeLookMd(slug), "utf8");
  assert.match(md, /\*\*receive-message\*\* \(receive-v1\): Iona \(character `iona` v1, hash `[0-9a-f]{12}`\) plays cast `iona` and catches `glider`/);
  assert.match(md, /the hand meets the glider on "catches" \(start of the word\) in shot `catch`/);
  assert.match(md, /`catch` \*\*scene\*\* \[carries: iona, glider\] \[performs: receive-message, contact on "catches"\]/);
  assert.match(md, /Not measured by any tool: face appeal, finger contact and final on-screen occlusion/);
  const plan = parseLookPlan(JSON.parse(fs.readFileSync(path.join(dir, "design/look.json"), "utf8")));
  assert.match(renderLookMd(plan), /character `iona` v1 \(hash `[0-9a-f]{12}`\)/, "without names it still says the id, version and hash");
});
