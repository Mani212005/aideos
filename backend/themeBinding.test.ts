/**
 * File Description: Tests that the theme and accent chosen in the New project dialog are binding.
 * Captain's decision: the chosen accent is written into the agent task prompt and the project
 * context, enforced by a design check that fails on any other accent, and no stage falls back to
 * purple on its own. Also covers the removed narrator archetype: an old film that still carries the
 * field opens without error.
 * Inputs and outputs: films with a chosen theme -> prompt, context, brief, compile and design check assertions.
 * Used by: npm test.
 */

import "./testSupport/fixtureVideosDir";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildDirectingPrompt, buildTaskContext, themeDirective } from "./agentBridge/contextBuilder";
import { checkFilmDesign, foreignAccentColours } from "./designCheck/designCheck";
import { renderDesignBrief } from "./designSpec/brief";
import { parseLookPlan } from "./lookPlan/schema";
import { renderLookBrief } from "./lookPlan/brief";
import { compileFilmFromScreenplayAsync } from "./pipeline/design";
import { readFilm } from "./pipeline/filmStore";
import { backgroundPresetSchema, filmSchema, parseFilm, type Film } from "../src/dl/schema";
import { convertFilmToLayeredFilm } from "../src/dl/convertFilm";
import { validateLayeredFilm } from "../src/dl/validateLayeredFilm";
import { boundTheme, filmAccent, PROJECT_THEMES, resolveProjectTheme } from "../src/projectTheme";
import { getVideosDir } from "../src/dl/videoPackageLoader";
import { TEST_VIDEOS_DIR } from "./testSupport/fixtureVideosDir";
import { loadFixtureFilm } from "./testSupport/fixtureFilms";
import type { SegmentAudioInfo } from "./audio";

const ORANGE = "#FF6B00";

// Loads the reference scene film re-themed to a chosen background and accent, as the dialog would create it.
function themedFilm(accent: string, background = "smooth-dark"): any {
  const film = JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "still-talking/film.json"), "utf8"));
  film.accent = accent;
  film.theme = { ...film.theme, background, accent };
  return film;
}

// Returns the error findings a film trips under one rule.
function ruleFindings(film: unknown, rule: string, context = {}) {
  return checkFilmDesign(film, context).findings.filter((f) => f.severity === "error" && f.rule === rule);
}

// Writes a package holding one film for the duration of a callback.
function withPackage<T>(slug: string, film: unknown, body: () => T): T {
  const dir = path.join(getVideosDir(), slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "film.json"), JSON.stringify({ ...(film as object), id: slug }));
  try {
    return body();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("themeBinding: the dialog's choice resolves to a binding theme, and a bad accent falls back to the theme's own", () => {
  assert.deepEqual(resolveProjectTheme("blueprint", "#12AB34"), { background: "blueprint", accent: "#12AB34" });
  assert.deepEqual(resolveProjectTheme("blueprint", "purple"), { background: "blueprint", accent: "#00E5FF" });
  assert.deepEqual(resolveProjectTheme(undefined, undefined), { background: "smooth-dark", accent: ORANGE });
  for (const theme of PROJECT_THEMES) {
    assert.deepEqual(resolveProjectTheme(theme.id, undefined), { background: theme.id, accent: theme.accent });
    assert.ok(backgroundPresetSchema.safeParse(theme.id).success, `${theme.id} must be a film background preset`);
  }
  assert.equal(boundTheme({ theme: { background: "paper-white" } }), null, "no chosen accent means nothing is bound");
  assert.equal(filmAccent({ theme: { accent: ORANGE }, accent: "#635BFF" }), ORANGE);
});

test("themeBinding: an old film that still carries the narrator archetype opens without error", () => {
  const old = { ...loadFixtureFilm("fixture-canvas-a"), characterId: "astronaut", narratorArchetype: "scientist" } as unknown as Film;
  assert.doesNotThrow(() => parseFilm(old));
  const parsed = filmSchema.safeParse(old);
  assert.ok(parsed.success, parsed.success ? "" : parsed.error.issues.map((i) => i.message).join("; "));
  assert.doesNotThrow(() => validateLayeredFilm(convertFilmToLayeredFilm(old)));
  withPackage("archetype-legacy", old, () => {
    const read = readFilm("archetype-legacy");
    assert.ok(read, "the package must read");
    assert.equal(read.shots.length, old.shots.length);
  });
});

test("themeBinding: the chosen accent is in the project context and every agent task prompt", () => {
  const film = themedFilm(ORANGE, "smooth-dark");
  withPackage("theme-bound", film, () => {
    const ctx = buildTaskContext({ eventType: "produce_film", filmId: "theme-bound" });
    assert.deepEqual(ctx.theme, { background: "smooth-dark", accent: ORANGE });
    for (const eventType of ["produce_film", "design_film", "frame_review", "script_updated"] as const) {
      const prompt = buildDirectingPrompt({ eventType, filmId: "theme-bound" });
      assert.ok(prompt.includes(ORANGE), `${eventType} prompt must name the chosen accent`);
      assert.ok(prompt.includes("Smooth Dark"), `${eventType} prompt must name the chosen theme`);
    }
    const shot = buildDirectingPrompt({ eventType: "design_film", filmId: "theme-bound", metadata: { shotId: "any" } });
    assert.ok(shot.includes(ORANGE), "a single-shot redesign carries the accent too");
  });
});

test("themeBinding: a project with no chosen accent gets no theme paragraph rather than a made-up one", () => {
  const film = themedFilm(ORANGE);
  delete film.theme.accent;
  withPackage("theme-unbound", film, () => {
    const ctx = buildTaskContext({ eventType: "produce_film", filmId: "theme-unbound" });
    assert.equal(ctx.theme, null);
    assert.ok(!buildDirectingPrompt({ eventType: "produce_film", filmId: "theme-unbound" }).includes("Theme (binding)"));
  });
  assert.equal(themeDirective(null), "");
});

test("themeBinding: the agent briefs hand over the chosen accent and never present purple as the default", () => {
  const film = parseFilm(themedFilm(ORANGE));
  const design = renderDesignBrief(film);
  const look = renderLookBrief(film, []);
  for (const brief of [design, look]) {
    assert.ok(brief.includes(ORANGE), "the brief names the chosen accent");
    assert.ok(!brief.includes("#635BFF"), "no purple example is left for the agent to copy");
  }
  assert.match(design, /"accent": "#FF6B00"/);
  assert.match(look, /"accent": "#FF6B00"/);
});

test("themeBinding: a recompile keeps the chosen theme instead of replacing it with the defaults", async () => {
  const durations = [6, 6];
  const segments: SegmentAudioInfo[] = durations.map((duration, i) => ({ text: `segment ${i}`, duration, startOffset: i * 6.2, words: [], utterances: [] }));
  const script = "## 0:00 - 0:12 - Opening (opening)\n\n[ON SCREEN] One\n[NARRATION] The first thing said.\n\n[ON SCREEN] Two\n[NARRATION] The second thing said.\n";
  const chosen = await compileFilmFromScreenplayAsync(script, segments, durations, { title: "Themed", textOnly: true, maxFootageShots: 0, theme: { background: "blueprint", accent: "#00E5FF" } });
  assert.equal(chosen.film.accent, "#00E5FF");
  assert.equal(chosen.film.theme?.background, "blueprint");
  assert.equal(chosen.film.theme?.accent, "#00E5FF");
});

test("themeBinding: the design check fails artwork drawn in the default purple when the film's accent is another", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#635bff"/><circle fill="rgb(99, 91, 255)"/><path fill="#FF6B00"/></svg>`;
  assert.deepEqual(foreignAccentColours(svg, ORANGE), ["#635bff", "rgb(99, 91, 255)"]);
  assert.deepEqual(foreignAccentColours(svg, "#635BFF"), [], "purple is fine when it is the film's accent");

  const onTheme = checkFilmDesign(themedFilm(ORANGE));
  const wherePurple = onTheme.findings.filter((f) => f.rule === "accent");
  assert.ok(wherePurple.length > 0, "the reference film's purple artwork is rejected under an orange theme");
  for (const f of wherePurple) assert.match(f.message, /#FF6B00/);
  assert.equal(ruleFindings(themedFilm("#635BFF"), "accent").length, 0, "the same film under its own purple accent passes");
});

test("themeBinding: the design check fails a design.json accent or look plan accent that replaces the chosen one", () => {
  const film = themedFilm(ORANGE);
  film.accent = "#635BFF";
  const swapped = ruleFindings(film, "accent").filter((f) => f.where === "film.accent");
  assert.equal(swapped.length, 1);
  assert.match(swapped[0].message, /#635BFF.*#FF6B00/);

  const plan = parseLookPlan(JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "speculative-decoding-designed/design/look.json"), "utf8")));
  const wrongPlan = { ...plan, film: { ...plan.film, palette: { ...plan.film.palette, accent: "#635BFF" } } } as typeof plan;
  const planned = ruleFindings(themedFilm(ORANGE), "accent", { lookPlan: wrongPlan }).filter((f) => f.where.startsWith("look.json"));
  assert.equal(planned.length, 1);
  const rightPlan = { ...plan, film: { ...plan.film, palette: { ...plan.film.palette, accent: ORANGE } } } as typeof plan;
  assert.equal(ruleFindings(themedFilm(ORANGE), "accent", { lookPlan: rightPlan }).filter((f) => f.where.startsWith("look.json")).length, 0);
});
