/**
 * File Description: J4 user journey for all three data-defined characters through the compiled receive action, checking projected silhouette clearance and an out-of-bounds refusal.
 * Inputs and outputs: Iona, Pip and Marlo character fixtures -> real design builds and per-frame safe-square/caption assertions in both crops.
 * Used by: npm run test:journeys (the CI journeys job).
 */
import "../testSupport/fixtureVideosDir";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import { journey } from "./harness";
import { CHARACTER_FILES, type FixtureCharacter } from "../testSupport/characters";
import { buildDesign } from "../designSpec/build";
import { readFilm } from "../pipeline/filmStore";
import { checkFilmDesign } from "../designCheck/designCheck";
import { prepareStageFacts } from "../../src/dl/scene/stageFacts";
import { getStageSafeRegion } from "../../src/dl/fullScreenHeroLayout";
import { rectInside } from "../../src/dl/scene/projection";
import type { Scene } from "../../src/dl/scene/types";

const SOURCE = path.join(TEST_VIDEOS_DIR, "iona-receive");
let serial = 0;
type Json = Record<string, unknown>;
type DesignFixture = Json & { assets: Json[]; performances: Json[] };
type LookFixture = Json & { film: Json & { cast: Json[] } };

// Copies the real package fixture and changes only its selected character and fit policy.
function packageWithCharacter(character: FixtureCharacter): string {
  const slug = `journey-j4-${character}-${++serial}`;
  const directory = path.join(TEST_VIDEOS_DIR, slug);
  fs.cpSync(SOURCE, directory, { recursive: true });
  for (const file of ["film.json", "design/base-film.json"]) {
    const target = path.join(directory, file);
    if (fs.existsSync(target)) fs.writeFileSync(target, JSON.stringify({ ...JSON.parse(fs.readFileSync(target, "utf8")), id: slug }, null, 2));
  }
  if (character !== "iona") {
    fs.mkdirSync(path.join(directory, "characters"), { recursive: true });
    fs.copyFileSync(CHARACTER_FILES[character], path.join(directory, "characters", `${character}.character.json`));
  }
  const designFile = path.join(directory, "design/design.json"), lookFile = path.join(directory, "design/look.json");
  const design = JSON.parse(fs.readFileSync(designFile, "utf8")) as DesignFixture;
  const look = JSON.parse(fs.readFileSync(lookFile, "utf8")) as LookFixture;
  const actor = design.assets.find((asset: Json) => asset.kind === "character");
  const lookActor = look.film.cast.find((cast: Json) => cast.id === "iona");
  if (!actor || !lookActor) throw new Error("iona-receive fixture is missing its character asset or look cast entry");
  actor.character = character;
  lookActor.character = character;
  if (character === "pip") {
    design.performances[0].limits = "clamp";
    design.assets[0].unitsToStage = 110;
  } else if (character === "marlo") {
    design.assets[0].unitsToStage = 70;
    design.assets[0].position = [960, 1220];
  }
  fs.writeFileSync(designFile, JSON.stringify(design, null, 2));
  fs.writeFileSync(lookFile, JSON.stringify(look, null, 2));
  return slug;
}

journey("J4 Iona, Pip and Marlo keep the full moving character and prop inside both caption-safe crops", async () => {
  for (const character of ["iona", "pip", "marlo"] as const) {
    const slug = packageWithCharacter(character);
    const built = buildDesign(slug, "hand-built");
    assert.equal(built.state, "passed", `${character}: ${JSON.stringify({ errors: built.errors, findings: built.findings })}`);
    const film = readFilm(slug)!;
    const scene = film.scene as Scene;
    assert.equal(checkFilmDesign(film).ok, true, `${character}: design check must pass in both output formats`);
    const contact = scene.performances![0].decisive.frame;
    for (const [format, width, height] of [["long", 1920, 1080], ["reel", 1080, 1920]] as const) {
      const facts = prepareStageFacts(scene, width, height);
      try {
        const safe = getStageSafeRegion(format, width, height, film.captions !== "off");
        for (let frame = Math.max(0, contact - 45); frame <= Math.min(scene.durationFrames - 1, contact + 80); frame++) {
          for (const pose of facts.at(frame)) {
            assert.ok(rectInside(pose.actorBounds, safe), `${character} ${format} actor frame ${frame} leaves safe square/caption band: ${JSON.stringify(pose.actorBounds)}`);
            if (pose.ownership === "attached" || pose.propBounds.x1 >= 0) {
              assert.ok(rectInside(pose.propBounds, safe), `${character} ${format} prop frame ${frame} leaves safe square/caption band: ${JSON.stringify(pose.propBounds)}`);
            }
          }
        }
        const atContact = facts.at(contact)[0];
        const beforeContact = facts.at(contact - 1, "prop")[0];
        const afterContact = facts.at(contact, "prop")[0];
        assert.equal(beforeContact.ownership, "airborne", `${character} ${format}: prop must approach as a separate object`);
        assert.equal(atContact.ownership, "attached", `${character} ${format} prop must be attached at the decisive pose`);
        assert.equal(atContact.afterState, "message-received");
        assert.equal(afterContact.propVisibility?.status, "exposed", `${character} ${format}: carried prop needs an exposed mesh sample after contact`);
      } finally {
        facts.dispose();
      }
    }
    const inset = structuredClone(film);
    inset.shots[2].stage = "inset";
    inset.shots[2].blocks = readFilm("inset-stage")!.shots[1].blocks;
    inset.shots[2].scriptText = "Three servers share the work.";
    const insetActor = inset.scene!.cast!.find((cast) => cast.kind === "character");
    assert.ok(insetActor?.kind === "character");
    insetActor.unitsToStage = 40;
    insetActor.position = [840, 900];
    const clearInset = checkFilmDesign(inset);
    assert.equal(clearInset.ok, true, `${character}: a clear inset must pass with the full moving silhouette: ${JSON.stringify(clearInset.findings)}`);
    insetActor.position = [1000, 1240];
    assert.ok(checkFilmDesign(inset).findings.some((finding) => finding.rule === "inset"), `${character}: a moving silhouette entering the inset must fail`);

    const misplaced = structuredClone(film);
    const actor = misplaced.scene!.cast!.find((cast) => cast.kind === "character");
    assert.ok(actor?.kind === "character");
    actor.position = [1490, 1210];
    const rejected = checkFilmDesign(misplaced);
    assert.ok(rejected.findings.some((finding) => finding.rule === "safe-area"), `${character} out-of-bounds silhouette must fail: ${JSON.stringify(rejected.findings)}`);
  }
});
