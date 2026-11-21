/**
 * File Description: Behavioural tests for accent colours in the rendered-video design language: an accent that is not a #rrggbb colour (a CSS variable name from the Studio shell) must never be turned silently into black, and every film resolves to a real colour through filmAccent.
 * Inputs and outputs: accents, films and theme palettes -> accentAt, tokensFor and filmAccent assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { accentAt, BACKGROUND_THEMES, tokensFor } from "../src/dl/tokens";
import { filmAccent, previewAccent, PROJECT_THEMES } from "../src/projectTheme";

test("accentAt turns #rrggbb and #rgb colours into rgba at the given alpha", () => {
  assert.equal(accentAt("#FF6B00", 0.5), "rgba(255, 107, 0, 0.5)");
  assert.equal(accentAt("#f60", 0.1), "rgba(255, 102, 0, 0.1)");
});

test("accentAt refuses a CSS variable instead of painting black (the Studio reel preview passed var(--nb-primary))", () => {
  assert.throws(() => accentAt("var(--nb-primary)", 0.5), /#rrggbb/);
  assert.throws(() => accentAt("", 0.5), /#rrggbb/);
});

test("a film with no accent still resolves to a colour that accentAt accepts", () => {
  for (const film of [{}, null, undefined, { accent: "var(--nb-primary)" }, { theme: { accent: "not-a-colour" } }]) {
    const accent = filmAccent(film);
    assert.match(accent, /^#[0-9a-fA-F]{6}$/);
    assert.doesNotThrow(() => accentAt(accent, 0.5));
  }
});

test("every background theme and project theme in the palette is readable by the colour helpers", () => {
  for (const theme of Object.values(BACKGROUND_THEMES)) assert.doesNotThrow(() => tokensFor(theme), theme.id);
  for (const theme of PROJECT_THEMES) assert.doesNotThrow(() => accentAt(theme.accent, 0.5), theme.id);
});

test("the Studio preview keeps an unchosen theme accent, as the render conversion does, while a chosen theme still wins and a non-hex value never paints black", () => {
  assert.equal(previewAccent({ theme: { accent: "#E11D48" } }), "#E11D48");
  assert.equal(previewAccent({ accent: "#635BFF", theme: { accent: "#E11D48" } }), "#635BFF");
  assert.equal(previewAccent({ accent: "#635BFF", theme: { accent: "#E11D48", accentChosen: true } }), "#E11D48");
  assert.equal(previewAccent({ accent: "var(--nb-primary)", theme: { accent: "#E11D48" } }), "#E11D48");
  for (const film of [{}, null, undefined, { accent: "var(--nb-primary)" }, { theme: { accent: "not-a-colour" } }]) {
    const accent = previewAccent(film);
    assert.match(accent, /^#[0-9a-fA-F]{6}$/);
    assert.doesNotThrow(() => accentAt(accent, 0.5));
  }
});
