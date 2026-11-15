/**
 * File Description: Builds the multi-character Three-stage film packages (journey-three-characters, pixels-stage-pip, pixels-stage-marlo) from the committed iona-receive fixture package (copied untouched), with the same design and look edits the J5 and character_pixels journeys make, so native renderer tests and golden scripts can draw them without a production run.
 * Inputs and outputs: a film slug -> the film built through the real buildDesign in the test videos directory (the package is written there first).
 * Used by: backend/renderIr/stage3d.test.ts, scripts/native_golden_ir.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { buildDesign } from "../designSpec/build";
import { readFilm } from "../pipeline/filmStore";
import { getVideosDir } from "../../src/dl/videoPackageLoader";
import type { Film } from "../../src/dl/schema";
import { CHARACTER_FILES, characterPin, type FixtureCharacter } from "./characters";

/** The character films this module builds. */
export const CHARACTER_FILM_SLUGS = ["pixels-stage-pip", "pixels-stage-marlo", "journey-three-characters"] as const;
export type CharacterFilmSlug = (typeof CHARACTER_FILM_SLUGS)[number];

/** A design or look plan edited as loose JSON. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the plans are edited at any depth, as the journeys do
type Loose = Record<string, any>;

/** The committed package every character film starts from (copied untouched, so no earlier build leaks in). */
const FIXTURE_PACKAGE = path.resolve(__dirname, "../../test_fixtures/packages/iona-receive");
const THREE: readonly FixtureCharacter[] = ["iona", "pip", "marlo"];

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

// The receive on one other character instead of Iona (character_pixels: Pip is clamped, scaled and placed as that journey does).
function writeOneCharacter(slug: string, character: "pip" | "marlo"): void {
  const target = copyFixturePackage(slug);
  fs.copyFileSync(CHARACTER_FILES[character], path.join(target, "characters", `${character}.character.json`));
  editPlans(target, (design, look) => {
    const asset = design.assets.find((item: Loose) => item.kind === "character"), cast = look.film.cast.find((item: Loose) => item.id === "iona");
    if (!asset || !cast) throw new Error("the iona-receive fixture is missing its character asset or look cast entry");
    asset.character = character;
    cast.character = character;
    for (const performance of look.film.performances ?? []) if (performance.actor === "iona") performance.character = characterPin(character);
    if (character === "pip") {
      design.performances[0].limits = "clamp";
      asset.unitsToStage = 110;
    } else {
      asset.unitsToStage = 70;
      asset.position = [960, 1220];
    }
  });
}

// The same receive on Iona, Pip and Marlo at once, each with its own glider, in one persistent stage (J5).
function writeThreeCharacters(slug: string): void {
  const target = copyFixturePackage(slug);
  for (const name of THREE) fs.copyFileSync(CHARACTER_FILES[name], path.join(target, "characters", `${name}.character.json`));
  editPlans(target, (design, look) => {
    const receive = design.performances[0];
    design.assets = THREE.flatMap((character, i) => [
      { id: character, renderer: "three", kind: "character", character, position: [1060, 760 + i * 240], unitsToStage: 30, treatment: "cel-v1" },
      { id: `glider-${character}`, renderer: "three", kind: "prop", asset: "paper-glider-v1", treatment: "cel-v1" },
    ]);
    design.performances = THREE.map((actor) => ({ ...receive, id: `receive-${actor}`, actor, prop: `glider-${actor}`, limits: actor === "pip" ? "clamp" : "fail" }));
    const actor = look.film.cast.find((c: Loose) => c.id === "iona"), prop = look.film.cast.find((c: Loose) => c.id === "glider");
    const lookReceive = look.film.performances[0];
    look.film.cast = THREE.flatMap((character) => [{ ...actor, id: character, character }, { ...prop, id: `glider-${character}` }]);
    look.film.performances = THREE.map((a) => ({ ...lookReceive, id: `receive-${a}`, actor: a, character: characterPin(a), prop: `glider-${a}` }));
    for (const shot of look.shots) {
      shot.carries = look.film.cast.map((c: Loose) => c.id);
      shot.performances = look.film.performances.map((p: Loose) => p.id);
    }
  });
}

/** Writes the package of a character film in the videos directory, builds it through the real buildDesign and returns the built film. */
export function buildCharacterFilm(slug: CharacterFilmSlug): Film {
  if (slug === "journey-three-characters") writeThreeCharacters(slug);
  else if (slug === "pixels-stage-pip") writeOneCharacter(slug, "pip");
  else if (slug === "pixels-stage-marlo") writeOneCharacter(slug, "marlo");
  else throw new Error(`unknown character film ${String(slug)}`);
  const result = buildDesign(slug, "hand-built");
  if (result.state !== "passed") throw new Error(`cannot build ${slug}: ${JSON.stringify(result).slice(0, 800)}`);
  const film = readFilm(slug);
  if (!film) throw new Error(`built ${slug} but it has no film`);
  return film;
}
