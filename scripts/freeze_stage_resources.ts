/**
 * File Description: Re-freezes the stage registry after a deliberate edit to an engine, action or reference file.
 * Inputs and outputs: the frozen file lists below -> rewritten src/dl/scene/rigs/registry.ts hashes and identity hash.
 * Used by: contributors after changing character, prop or receive engine code (see src/dl/scene/rigs/NOTICE.md).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CEL_TREATMENT } from "../src/dl/scene/rigs/registry";

const ROOT = path.resolve(__dirname, "..");
const REGISTRY = path.join(ROOT, "src/dl/scene/rigs/registry.ts");
/** Files that decide how any character spec renders and how the receive is fitted to it. */
const ENGINE = [
  "src/dl/characters/expand.ts",
  "src/dl/characters/rig.ts",
  "src/dl/scene/characters/geometry.ts",
  "src/dl/scene/characters/face.ts",
  "src/dl/scene/characters/build.ts",
  "src/dl/scene/characters/apply.ts",
  "src/dl/scene/props/paperGlider.ts",
  "src/dl/performance/iona.ts",
  "src/dl/performance/receive.ts",
  "src/dl/performance/retarget.ts",
];
/** Approved evidence the engine is measured against. */
const REFERENCES = [
  "test_fixtures/characters/iona-legacy/iona-art-v1.js",
  "test_fixtures/performance/iona/character.mjs",
  "test_fixtures/performance/iona/performance.mjs",
  "test_fixtures/performance/iona/filmstrip.mjs",
];

// Hashes one repo file's bytes.
const sha = (file: string): string => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex");
// Renders one frozen map as a TypeScript object literal.
const block = (files: string[]) => `{\n${files.map((f) => `  ${JSON.stringify(f)}: ${JSON.stringify(sha(f))}`).join(",\n")}\n}`;

// Rewrites the registry's hash constants, leaving the treatment untouched.
function main(): void {
  const resources = Object.fromEntries(ENGINE.map((f) => [f, sha(f)]));
  const identity = crypto.createHash("sha256").update(JSON.stringify({ resources, treatment: CEL_TREATMENT })).digest("hex");
  const source = fs.readFileSync(REGISTRY, "utf8")
    .replace(/export const STAGE_RESOURCE_HASH = "[^"]*";/, `export const STAGE_RESOURCE_HASH = "${identity}";`)
    .replace(/export const STAGE_RESOURCES = \{[^}]*\} as const;/, `export const STAGE_RESOURCES = ${block(ENGINE)} as const;`)
    .replace(/export const APPROVED_REFERENCES = \{[^}]*\} as const;/, `export const APPROVED_REFERENCES = ${block(REFERENCES)} as const;`);
  fs.writeFileSync(REGISTRY, source);
  console.log(`stage identity ${identity}`);
}

main();
