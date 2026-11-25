/**
 * File Description: The one shared builder of the character film packages (journey-three-characters, pixels-stage-pip, pixels-stage-marlo, journey-j3-j4-dots, and one-character packages for any committed character) from the committed iona-receive fixture package (copied untouched). The journeys (character_pixels, J4 crops, J5 three characters) and the native renderer tests and golden scripts all take their package and their design and look edits from here, so a fixture is changed in one place and a test can draw it without a production run.
 * Inputs and outputs: a film slug (or a slug and a character) -> a package written in the test videos directory, and for buildCharacterFilm the film built through the real buildDesign; the plan edits are also exported as pure functions over a design and a look plan.
 * Used by: backend/renderIr/stage3d.test.ts, backend/renderIr/dots.test.ts, scripts/native_golden_ir.ts, backend/journeys/character_pixels.journey.ts, backend/journeys/j4_character_crops.journey.ts, backend/journeys/j3_j5_stage.journey.ts, backend/journeys/native_character_goldens.journey.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { buildDesign } from "../designSpec/build";
import { readFilm } from "../pipeline/filmStore";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import type { Film } from "../../src/dl/schema";
import { CHARACTER_FILES, characterPin, type FixtureCharacter } from "./characters";

/** The character films this module builds. `journey-j3-j4-dots` is the J3 and J4 film (P4.4): Iona in the dots-v1 treatment next to a second Iona with her own glider in the cel treatment. */
export const CHARACTER_FILM_SLUGS = ["pixels-stage-pip", "pixels-stage-marlo", "journey-three-characters", "journey-j3-j4-dots"] as const;
export type CharacterFilmSlug = (typeof CHARACTER_FILM_SLUGS)[number];

/** A design or look plan edited as loose JSON. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the plans are edited at any depth, as the journeys do
type Loose = Record<string, any>;

/** The committed package every character film starts from (copied untouched, so no earlier build leaks in). */
const FIXTURE_PACKAGE = path.resolve(__dirname, "../../test_fixtures/packages/iona-receive");
/** The three characters the J5 film puts side by side, in the order their performances are listed. */
export const THREE_CHARACTERS: readonly FixtureCharacter[] = ["iona", "pip", "marlo"];

// Copies the iona-receive package to a new slug (film id rewritten) with an empty characters folder.
function copyFixturePackage(slug: string): string {
  const target = path.join(getVideosDir(), slug);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(FIXTURE_PACKAGE, target, { recursive: true });
  for (const file of ["film.json", "design/base-film.json"]) {
    const f = path.join(target, file);
    if (fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, "utf8")), id: slug }, null, 2));
  }
  fs.mkdirSync(path.join(target, "characters"), { recursive: true });
  return target;
}

// Reads the package's design and look plans, lets `edit` change them and writes them back.
function editPlans(target: string, edit: (design: Loose, look: Loose) => void): void {
  const designFile = path.join(target, "design/design.json"), lookFile = path.join(target, "design/look.json");
  const design = JSON.parse(fs.readFileSync(designFile, "utf8")) as Loose, look = JSON.parse(fs.readFileSync(lookFile, "utf8")) as Loose;
  edit(design, look);
  fs.writeFileSync(designFile, JSON.stringify(design, null, 2));
  fs.writeFileSync(lookFile, JSON.stringify(look, null, 2));
}

/** Copies the committed spec of each named character into the package's characters folder, so the package carries them. */
export function copyCharacterSpecs(packageDir: string, names: readonly FixtureCharacter[]): void {
  const dir = path.join(packageDir, "characters");
  fs.mkdirSync(dir, { recursive: true });
  for (const name of names) fs.copyFileSync(CHARACTER_FILES[name], path.join(dir, `${name}.character.json`));
}

/** Points the fixture's Iona design asset and look cast entry at `character`, pins its look performances, and fits Pip (clamped) and Marlo (placed) on the stage as character_pixels and J4 do; Iona keeps the fixture's fit. */
export function editForOneCharacter(design: Loose, look: Loose, character: FixtureCharacter): void {
  const asset = design.assets.find((item: Loose) => item.kind === "character"), cast = look.film.cast.find((item: Loose) => item.id === "iona");
  if (!asset || !cast) throw new Error("the iona-receive fixture is missing its character asset or look cast entry");
  asset.character = character;
  cast.character = character;
  for (const performance of look.film.performances ?? []) if (performance.actor === "iona") performance.character = characterPin(character);
  if (character === "pip") {
    design.performances[0].limits = "clamp";
    asset.unitsToStage = 110;
  } else if (character === "marlo") {
    asset.unitsToStage = 70;
    asset.position = [960, 1220];
  }
}

/** Writes the receive package for one committed character instead of the fixture's own Iona (the library Iona needs no copy) and returns its slug. */
export function writeCharacterPackage(slug: string, character: FixtureCharacter): string {
  const target = copyFixturePackage(slug);
  if (character !== "iona") copyCharacterSpecs(target, [character]);
  editPlans(target, (design, look) => editForOneCharacter(design, look, character));
  return slug;
}

/** Edits a design so the same receive runs on Iona, Pip and Marlo at once, each with its own glider, in one persistent stage (J5). */
export function editDesignForThreeCharacters(design: Loose): void {
  const receive = design.performances[0];
  design.assets = THREE_CHARACTERS.flatMap((character, i) => [
    { id: character, renderer: "three", kind: "character", character, position: [1060, 760 + i * 240], unitsToStage: 30, treatment: "cel-v1" },
    { id: `glider-${character}`, renderer: "three", kind: "prop", asset: "paper-glider-v1", treatment: "cel-v1" },
  ]);
  design.performances = THREE_CHARACTERS.map((actor) => ({ ...receive, id: `receive-${actor}`, actor, prop: `glider-${actor}`, limits: actor === "pip" ? "clamp" : "fail" }));
}

/** Edits a look plan to match editDesignForThreeCharacters: three cast characters with their gliders, a pinned receive each, and every shot carrying them all. */
export function editLookForThreeCharacters(look: Loose): void {
  const actor = look.film.cast.find((c: Loose) => c.id === "iona"), prop = look.film.cast.find((c: Loose) => c.id === "glider");
  const lookReceive = look.film.performances[0];
  look.film.cast = THREE_CHARACTERS.flatMap((character) => [{ ...actor, id: character, character }, { ...prop, id: `glider-${character}` }]);
  look.film.performances = THREE_CHARACTERS.map((a) => ({ ...lookReceive, id: `receive-${a}`, actor: a, character: characterPin(a), prop: `glider-${a}` }));
  for (const shot of look.shots) {
    shot.carries = look.film.cast.map((c: Loose) => c.id);
    shot.performances = look.film.performances.map((p: Loose) => p.id);
  }
}

// Writes the three-character film package (J5): all three specs, with the design and look edited to match.
function writeThreeCharacters(slug: string): void {
  const target = copyFixturePackage(slug);
  copyCharacterSpecs(target, THREE_CHARACTERS);
  editPlans(target, (design, look) => {
    editDesignForThreeCharacters(design);
    editLookForThreeCharacters(look);
  });
}

// The J3 and J4 film: the fixture's Iona in dots-v1 (design and look edited exactly as j3_j4_dots.journey.ts edits them) beside a second, cel Iona with her own glider.
function writeDotsFilm(slug: string): void {
  const target = copyFixturePackage(slug);
  editPlans(target, (design, look) => {
    const iona = design.assets.find((asset: Loose) => asset.id === "iona");
    if (!iona) throw new Error("the iona-receive fixture is missing its character asset");
    iona.treatment = "dots-v1";
    design.assets.push({ id: "iona-copy", renderer: "three", kind: "character", character: "iona", position: [1200, 1215], unitsToStage: 44, treatment: "cel-v1" });
    design.assets.push({ id: "glider-copy", renderer: "three", kind: "prop", asset: "paper-glider-v1", treatment: "cel-v1" });
    design.performances.push({ ...design.performances[0], id: "receive-copy", actor: "iona-copy", prop: "glider-copy" });
    design.treatment = "cel-v1";
    const cast = look.film.cast.find((actor: Loose) => actor.id === "iona");
    cast.treatment = "dots-v1";
    look.film.cast.push({ id: "iona-copy", renderer: "three", treatment: "cel-v1", what: "A second Iona receives a glider", enters: "approach", changes: [{ at: "catch", how: "The second Iona catches and settles the glider.", state: "message-received", magnitude: "major" }], character: "iona" });
    look.film.cast.push({ id: "glider-copy", renderer: "three", treatment: "cel-v1", asset: "paper-glider-v1", what: "A second paper glider", enters: "approach", changes: [{ at: "catch", how: "The second glider becomes attached to its receiver's grip.", state: "message-received", magnitude: "major" }] });
    look.film.performances.push({ ...look.film.performances[0], id: "receive-copy", actor: "iona-copy", prop: "glider-copy" });
    for (const shot of look.shots) {
      shot.performances.push("receive-copy");
      shot.carries.push("iona-copy", "glider-copy");
    }
    look.film.treatment = "cel-v1";
  });
}

/** Writes the package of a character film in the videos directory, builds it through the real buildDesign and returns the built film. */
export function buildCharacterFilm(slug: CharacterFilmSlug): Film {
  if (slug === "journey-three-characters") writeThreeCharacters(slug);
  else if (slug === "journey-j3-j4-dots") writeDotsFilm(slug);
  else if (slug === "pixels-stage-pip") writeCharacterPackage(slug, "pip");
  else if (slug === "pixels-stage-marlo") writeCharacterPackage(slug, "marlo");
  else throw new Error(`unknown character film ${String(slug)}`);
  const result = buildDesign(slug, "hand-built");
  if (result.state !== "passed") throw new Error(`cannot build ${slug}: ${JSON.stringify(result).slice(0, 800)}`);
  const film = readFilm(slug);
  if (!film) throw new Error(`built ${slug} but it has no film`);
  return film;
}
