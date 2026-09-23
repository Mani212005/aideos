/**
 * File Description: Walks the rendered-video component layer (src/dl/**) and fails on colour
 * literals outside the locked palette or on typefaces outside the mandated two, so the class of
 * defect that put an orange "TOPIC SHIFT" card into every film cannot be reintroduced silently.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve("src/dl");

/** The six locked values from src/dl/README.md. */
const PALETTE = ["#0A0A0B", "#F5F5F5", "#8A8A8E", "#635BFF", "#101013"];

/**
 * Subtrees governed by their own rules rather than by this one:
 * - `films/` and the schema/converter defaults are film DATA. A film carries its own
 *   `theme.accent`; that value is authored per film, not a component styling choice.
 * - `scene/` is the generative SVG surface. Its rules are enforced by the validators in
 *   `backend/scene/generateSvg.ts` against generated assets, which is where they belong.
 * - `tokens.ts` is where the palettes and background themes are DEFINED, so every literal
 *   in it is by definition the source rather than a violation.
 */
const NOT_GOVERNED_HERE = [
  "src/dl/films",
  "src/dl/scene",
  "src/dl/tokens.ts",
  "src/dl/convertFilm.ts",
  "src/dl/layeredSchema.ts",
];

/**
 * Pre-existing drift, recorded rather than hidden. These files carried off-palette colour
 * before the guard existed and restyling them would change every rendered frame, which is out
 * of scope for a framing fix. The ledger only ever shrinks: a file not listed here must be
 * clean, so no NEW component can reintroduce the defect.
 */
const KNOWN_DRIFT = [
  "src/dl/CanvasGraph.tsx",
  "src/dl/KineticSubtitles.tsx",
  "src/dl/metaphors/GlowingClusterMetaphor.tsx",
  "src/dl/metaphors/MetaphorViewer.tsx",
];

/**
 * Typefaces the design language allows as literal strings; anything else must come from a token.
 * Only the primary family is checked, so a generic fallback after it ("JetBrains Mono, monospace")
 * is fine while a bare generic ("monospace", "sans-serif", "Inter") is not.
 */
const ALLOWED_FONT_LITERALS = /^(geist|jetbrains mono)$/i;

// Collects every .ts/.tsx file under a directory, depth first.
const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
};

// Expands #abc to #aabbcc so short and long hex are compared the same way.
const expandHex = (hex: string): string =>
  hex.length === 4
    ? `#${hex
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")}`
    : hex;

// True when a colour is a neutral grey, black or white: shadows, scrims and hairlines.
const isNeutral = (r: number, g: number, b: number): boolean => r === g && g === b;

// True when a triple matches one of the locked palette values, at any alpha.
const isPaletteTriple = (r: number, g: number, b: number): boolean =>
  PALETTE.some((hex) => {
    const n = parseInt(hex.slice(1), 16);
    return ((n >> 16) & 255) === r && ((n >> 8) & 255) === g && (n & 255) === b;
  });

// Returns every chromatic colour literal in a source file that is outside the locked palette.
const offPaletteLiterals = (source: string): string[] => {
  const found: string[] = [];

  for (const match of source.matchAll(/#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})\b/g)) {
    const hex = expandHex(match[0]);
    if (PALETTE.includes(hex.toUpperCase())) continue;
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    if (isNeutral(r, g, b)) continue;
    found.push(match[0]);
  }

  for (const match of source.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
    const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (isNeutral(r, g, b) || isPaletteTriple(r, g, b)) continue;
    found.push(`${match[0]})`);
  }

  return [...new Set(found)];
};

const governedFiles = walk(ROOT)
  .map((file) => path.relative(process.cwd(), file))
  .filter((file) => !NOT_GOVERNED_HERE.some((skip) => file === skip || file.startsWith(`${skip}/`)))
  .sort();

// Verifies that no governed component introduces a colour outside the six locked palette values.
test("rendered-video components use only palette colours", () => {
  assert.ok(governedFiles.length > 5, "expected the walk to find the component layer");

  const violations: string[] = [];
  for (const file of governedFiles) {
    if (KNOWN_DRIFT.includes(file)) continue;
    const literals = offPaletteLiterals(fs.readFileSync(file, "utf8"));
    if (literals.length) violations.push(`${file}: ${literals.join(" ")}`);
  }

  assert.deepEqual(violations, [], `off-palette colour in the rendered-video design language:\n${violations.join("\n")}`);
});

// Verifies that the ledger of pre-existing drift only ever shrinks.
test("the known-drift ledger stays accurate and only shrinks", () => {
  for (const file of KNOWN_DRIFT) {
    assert.ok(governedFiles.includes(file), `${file} is on the drift ledger but is no longer a governed file`);
    const literals = offPaletteLiterals(fs.readFileSync(file, "utf8"));
    assert.ok(
      literals.length > 0,
      `${file} is now clean - remove it from KNOWN_DRIFT so the guard starts enforcing it`,
    );
  }
});

// Verifies that no governed component hard-codes a typeface outside Geist and JetBrains Mono.
test("rendered-video components use only the mandated typefaces", () => {
  const violations: string[] = [];
  for (const file of governedFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/fontFamily:\s*["']([^"']+)["']/g)) {
      const primary = match[1].split(",")[0].replace(/["']/g, "").trim();
      if (!ALLOWED_FONT_LITERALS.test(primary)) violations.push(`${file}: ${match[1]}`);
    }
  }

  assert.deepEqual(violations, [], `non-design-language typeface:\n${violations.join("\n")}`);
});

// Verifies that the retired paper-rip transition stays retired rather than being restored.
test("the retired paper-rip transition draws nothing", () => {
  const source = fs.readFileSync(path.resolve("src/dl/PaperRip.tsx"), "utf8");
  assert.doesNotMatch(source, /TOPIC SHIFT/, "the placeholder transition card must not come back");
  assert.match(source, /return null;/, "PaperRip must remain a no-op");
});
