/**
 * File Description: Tests for the design check.
 * Still Talking, the reference scene film, must pass cleanly; a copy of it broken one way per rule
 * must fail with that rule named, so every standard-layer rule is proven to fire.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { checkFilmDesign, checkFilmDesignById, offPaletteColours, type DesignRule } from "./designCheck";

const ROOT = path.resolve(__dirname, "../..");
const TMP = path.join(ROOT, ".tmp_design_check");

// Loads a fresh deep copy of the reference film.
function stillTalking(): any {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "videos/still-talking/film.json"), "utf8"));
}

// Returns the distinct error rules a film trips.
function errorRules(film: unknown): DesignRule[] {
  return [...new Set(checkFilmDesign(film).findings.filter((f) => f.severity === "error").map((f) => f.rule))];
}

test("DesignCheck: the reference scene film passes with no findings", () => {
  const report = checkFilmDesignById("still-talking");
  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
  assert.ok(report.stats.clips > 200);
});

test("DesignCheck: a visible snap and a second transform origin are both caught", () => {
  const film = stillTalking();
  const probe = film.scene.props.find((p: any) => p.assetId === "probe");
  const moving = probe.animation.clips.find((c: any) => c.property === "translateX" || c.property === "rotate");
  const second = { ...moving, clipId: "snap-test", startFrame: moving.startFrame + moving.durationFrames + 5, durationFrames: 10, from: moving.to + 40, to: moving.to + 40 };
  probe.animation.clips.push(second);
  const scaled = probe.animation.clips.find((c: any) => c.origin);
  probe.animation.clips.push({ ...scaled, clipId: "origin-test", origin: { x: scaled.origin.x + 7, y: scaled.origin.y } });
  const rules = errorRules(film);
  assert.ok(rules.includes("continuity"), rules.join(","));
  assert.ok(rules.includes("origin"), rules.join(","));
});

test("DesignCheck: a counter must show a number that is actually spoken", () => {
  const film = stillTalking();
  const shot = film.shots.find((s: any) => s.blocks.some((b: any) => b.c === "StatCounter"));
  shot.blocks.find((b: any) => b.c === "StatCounter").to = 23;
  assert.deepEqual(errorRules(film), ["honest-data"]);
});

test("DesignCheck: the scene must run exactly as long as the narrated shots", () => {
  const film = stillTalking();
  film.scene.durationFrames += 100;
  assert.ok(errorRules(film).includes("audio-lock"));
});

test("DesignCheck: closing footage after the voice is a warning, a voiceover that disagrees is an error", () => {
  const film = JSON.parse(fs.readFileSync(path.join(ROOT, "videos/speculative-decoding/film.json"), "utf8"));
  const last = film.shots[film.shots.length - 1];
  film.shots.push({ ...last, id: "closing-footage", dur: 5, scriptText: undefined });
  const report = checkFilmDesign(film);
  assert.ok(!report.findings.some((f) => f.severity === "error" && f.rule === "audio-lock"), JSON.stringify(report.findings));
  assert.ok(report.findings.some((f) => f.severity === "warning" && /closing-footage/.test(f.message)));
  film.voiceover.durationSec -= 10;
  assert.ok(errorRules(film).includes("audio-lock"));
});

test("DesignCheck: artwork must be static, self-contained, on palette and in the house typefaces", () => {
  fs.mkdirSync(TMP, { recursive: true });
  const file = path.join(TMP, "bad.svg");
  fs.writeFileSync(
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><g id="a"><rect id="r" fill="#FF3B30" width="10" height="10"/>` +
      `<text id="t" font-family="Arial">hi</text><image id="i" href="https://example.com/x.png"/><animate id="m" attributeName="x"/></g></svg>`,
  );
  try {
    const film = stillTalking();
    const prop = film.scene.props.find((p: any) => p.assetId === "sun");
    prop.svgSource = path.relative(ROOT, file);
    prop.animation = undefined;
    const rules = errorRules(film);
    for (const rule of ["palette", "typography", "static-art"] as DesignRule[]) assert.ok(rules.includes(rule), `${rule} missing from ${rules.join(",")}`);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});

test("DesignCheck: an invalid manifest reports the schema error instead of throwing", () => {
  const film = stillTalking();
  film.theme = { ...film.theme, background: "neon" };
  const report = checkFilmDesign(film);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0].rule, "schema");
});

test("DesignCheck: palette allows neutrals and the film accent, and flags other colours", () => {
  assert.deepEqual(offPaletteColours(`<rect fill="#141416"/><rect fill="#635BFF"/><rect fill="rgba(245,245,245,0.2)"/>`), []);
  assert.deepEqual(offPaletteColours(`<rect fill="#00C2A8"/>`), ["#00C2A8"]);
  assert.deepEqual(offPaletteColours(`<rect fill="#00C2A8"/>`, "#00C2A8"), []);
});
