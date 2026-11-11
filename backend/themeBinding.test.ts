/**
 * File Description: Tests that the theme and accent chosen in the New project dialog are binding.
 * Captain's decision: the chosen accent is written into the agent task prompt and the project
 * context, enforced by a design check that fails on any other accent, and no stage falls back to
 * purple on its own. Only a project the user chose a theme for (`theme.accentChosen: true`) is bound;
 * a legacy project still carrying the old purple default is not. Also covers the removed narrator archetype: an old film that still carries the
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
import { availableCharacters, renderLookBrief } from "./lookPlan/brief";
import { compileFilmFromScreenplayAsync } from "./pipeline/design";
import { readFilm } from "./pipeline/filmStore";
import { buildDesign } from "./designSpec/build";
import { backgroundPresetSchema, filmSchema, parseFilm, themeSchema, type Film } from "../src/dl/schema";
import { convertFilmToLayeredFilm } from "../src/dl/convertFilm";
import { validateLayeredFilm } from "../src/dl/validateLayeredFilm";
import { boundTheme, DEFAULT_PROJECT_ACCENT, filmAccent, newProjectFilmTheme, PROJECT_THEMES, resolveProjectTheme, savedAccent } from "../src/projectTheme";
import { getVideosDir } from "../src/dl/videoPackageLoader";
import { TEST_VIDEOS_DIR } from "./testSupport/fixtureVideosDir";
import { loadFixtureFilm } from "./testSupport/fixtureFilms";
import type { SegmentAudioInfo } from "./audio";

const ORANGE = "#FF6B00";

// Loads the reference scene film re-themed to a chosen background and accent, as the dialog would create it.
function themedFilm(accent: string, background = "smooth-dark"): any {
  const film = JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "still-talking/film.json"), "utf8"));
  film.accent = accent;
  film.theme = { ...film.theme, background, accent, accentChosen: true };
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
  assert.equal(boundTheme({ theme: { background: "paper-white", accent: ORANGE } }), null, "an accent the user did not choose is not bound");
  assert.equal(filmAccent({ theme: { accent: ORANGE, accentChosen: true }, accent: "#635BFF" }), ORANGE);
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
  assert.equal(chosen.film.theme?.accentChosen, true);
  assert.deepEqual(boundTheme(chosen.film), { background: "blueprint", accent: "#00E5FF" });
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

test("themeBinding: a legacy project carrying the old purple default without the marker is not bound, not flagged, and still opens", () => {
  const legacy = JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "still-talking/film.json"), "utf8"));
  legacy.accent = ORANGE;
  legacy.theme = { ...legacy.theme, accent: "#635BFF" };
  delete legacy.theme.accentChosen;
  assert.equal(boundTheme(legacy), null);
  assert.equal(ruleFindings(legacy, "accent").length, 0, "the purple artwork and the differing manifest accent are not rejected");
  const plan = parseLookPlan(JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "speculative-decoding-designed/design/look.json"), "utf8")));
  const otherPlan = { ...plan, film: { ...plan.film, palette: { ...plan.film.palette, accent: "#12AB34" } } } as typeof plan;
  assert.equal(ruleFindings(legacy, "accent", { lookPlan: otherPlan }).length, 0);
  withPackage("theme-legacy", legacy, () => {
    assert.ok(readFilm("theme-legacy"), "the legacy package still reads");
    const ctx = buildTaskContext({ eventType: "produce_film", filmId: "theme-legacy" });
    assert.equal(ctx.theme, null);
    for (const eventType of ["produce_film", "design_film", "frame_review"] as const) {
      assert.ok(!buildDirectingPrompt({ eventType, filmId: "theme-legacy" }).includes("Theme (binding)"), `${eventType} prompt carries no binding paragraph`);
    }
  });
});

test("themeBinding: a marked project enforces its accent and the design check rejects a foreign one", () => {
  const marked = themedFilm("#12AB34");
  assert.deepEqual(boundTheme(marked), { background: "smooth-dark", accent: "#12AB34" });
  marked.accent = ORANGE;
  const findings = ruleFindings(marked, "accent");
  assert.ok(findings.some((f) => f.where === "film.accent"), "a manifest accent other than the chosen one fails");
  assert.ok(findings.some((f) => f.where !== "film.accent"), "artwork drawn in the default purple fails");
});

test("themeBinding: a look plan accent compiled into a film never becomes the user's choice", async () => {
  const durations = [6, 6];
  const segments: SegmentAudioInfo[] = durations.map((duration, i) => ({ text: `segment ${i}`, duration, startOffset: i * 6.2, words: [], utterances: [] }));
  const script = "## 0:00 - 0:12 - Opening (opening)\n\n[ON SCREEN] One\n[NARRATION] The first thing said.\n\n[ON SCREEN] Two\n[NARRATION] The second thing said.\n";
  const plan = parseLookPlan(JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "speculative-decoding-designed/design/look.json"), "utf8")));
  const teal = { ...plan, film: { ...plan.film, palette: { ...plan.film.palette, accent: "#00E5FF" } } } as typeof plan;
  const compiled = await compileFilmFromScreenplayAsync(script, segments, durations, { title: "Unthemed", textOnly: true, maxFootageShots: 0, lookPlan: teal });
  assert.equal(compiled.film.accent, "#00E5FF");
  assert.equal(compiled.film.theme?.accentChosen, undefined);
  assert.equal(boundTheme(compiled.film), null);
});

test("themeBinding: the character example in the look brief is drawn in the film's accent, not purple", () => {
  const film = parseFilm(themedFilm(ORANGE));
  const characters = availableCharacters(path.join(TEST_VIDEOS_DIR, "iona-receive"));
  assert.ok(characters.length > 0, "a character is available for the example");
  const brief = renderLookBrief(film, characters);
  assert.match(brief, /## Character films/);
  assert.ok(!brief.includes("#635BFF"), "no purple example is left for the agent to copy");
});

test("themeBinding: a new project's film theme marks the accent chosen exactly when the request carried a theme or accent", () => {
  const chosen = newProjectFilmTheme("blueprint", "#12AB34");
  assert.equal(chosen.accentChosen, true);
  assert.equal(chosen.background, "blueprint");
  assert.equal(chosen.accent, "#12AB34");
  assert.deepEqual(boundTheme({ theme: chosen }), { background: "blueprint", accent: "#12AB34" });
  assert.equal(newProjectFilmTheme("paper-white", undefined).accentChosen, true);
  const unchosen = newProjectFilmTheme(undefined, undefined);
  assert.equal(unchosen.accentChosen, undefined);
  assert.equal(boundTheme({ theme: unchosen }), null);
  assert.ok(themeSchema.safeParse(chosen).success, "the theme is a valid film theme");
});

test("themeBinding: a Styleboard or customization save persists a picked purple and leaves an untouched accent as it was", () => {
  const picked = { accent: "#635BFF", theme: { accent: "#635BFF", accentChosen: true } };
  assert.equal(savedAccent(picked, "#635BFF"), "#635BFF", "the user picked purple, so purple is saved");
  const orange = { accent: ORANGE, theme: { accent: ORANGE, accentChosen: true } };
  assert.equal(savedAccent(orange, ORANGE), ORANGE, "an untouched save keeps the film's accent");
  assert.equal(savedAccent({ theme: {} }, "#635BFF"), undefined, "the on-screen default of a film with no accent is not written");
});

test("themeBinding: a design build binds the accent in the current film.json, not the one in the base-film snapshot", () => {
  const slug = "theme-rebuild";
  const dir = path.join(getVideosDir(), slug);
  fs.cpSync(path.join(getVideosDir(), "speculative-decoding-designed"), dir, { recursive: true });
  try {
    fs.rmSync(path.join(dir, "design/look.json"), { force: true });
    const purple = { background: "smooth-dark", fontFamily: "geist", accent: "#635BFF", accentChosen: true };
    const active = { ...JSON.parse(fs.readFileSync(path.join(dir, "film.json"), "utf8")), id: slug, accent: "#635BFF", theme: purple };
    fs.writeFileSync(path.join(dir, "film.json"), JSON.stringify(active));
    const base = { ...active, accent: ORANGE, theme: { ...purple, accent: ORANGE } };
    fs.writeFileSync(path.join(dir, "design/base-film.json"), JSON.stringify(base));
    const built = buildDesign(slug);
    assert.equal(built.state, "passed", JSON.stringify(built.errors));
    const written = readFilm(slug);
    assert.deepEqual(boundTheme(written), { background: "smooth-dark", accent: "#635BFF" }, "the accent the user changed to survives the build");
    assert.equal(written?.accent, "#635BFF");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("themeBinding: a bound film on a background that is not a dialog theme is named by its preset, not as Smooth Dark", () => {
  const film = themedFilm(ORANGE, "parchment");
  const paragraph = themeDirective(boundTheme(film));
  assert.ok(paragraph.includes("parchment"));
  assert.ok(!paragraph.includes("Smooth Dark"));
  assert.ok(paragraph.includes(ORANGE));
  for (const brief of [renderDesignBrief(parseFilm(film)), renderLookBrief(parseFilm(film), [])]) {
    assert.ok(brief.includes(`"parchment"`) && !brief.includes("Smooth Dark") && brief.includes(ORANGE));
  }
});

test("themeBinding: with no chosen theme and no look plan accent, a compile falls back to the default theme's accent, never purple", async () => {
  const durations = [6, 6];
  const segments: SegmentAudioInfo[] = durations.map((duration, i) => ({ text: `segment ${i}`, duration, startOffset: i * 6.2, words: [], utterances: [] }));
  const script = "## 0:00 - 0:12 - Opening (opening)\n\n[ON SCREEN] One\n[NARRATION] The first thing said.\n\n[ON SCREEN] Two\n[NARRATION] The second thing said.\n";
  const plain = await compileFilmFromScreenplayAsync(script, segments, durations, { title: "Plain", textOnly: true, maxFootageShots: 0 });
  assert.equal(plain.film.accent, DEFAULT_PROJECT_ACCENT);
  assert.notEqual(plain.film.accent, "#635BFF");
  assert.equal(boundTheme(plain.film), null);
  const purple = await compileFilmFromScreenplayAsync(script, segments, durations, { title: "Purple", textOnly: true, maxFootageShots: 0, theme: { background: "paper-white", accent: "#635BFF" } });
  assert.equal(purple.film.accent, "#635BFF", "a user-chosen purple is kept");
  assert.deepEqual(boundTheme(purple.film), { background: "paper-white", accent: "#635BFF" });
});

test("themeBinding: a legacy film that stores purple keeps it and stays unbound", () => {
  const legacy = JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "still-talking/film.json"), "utf8"));
  assert.equal(legacy.theme.accent, "#635BFF");
  assert.equal(boundTheme(legacy), null);
  assert.equal(filmAccent(legacy), "#635BFF");
  assert.equal(parseFilm(legacy).accent, "#635BFF");
});

test("themeBinding: only a bound design brief claims the build fails purple", () => {
  const claim = "the build fails any other chromatic colour";
  assert.ok(renderDesignBrief(parseFilm(themedFilm(ORANGE))).includes(claim));
  const legacy = JSON.parse(fs.readFileSync(path.join(TEST_VIDEOS_DIR, "still-talking/film.json"), "utf8"));
  assert.ok(!renderDesignBrief(parseFilm(legacy)).includes(claim));
});
