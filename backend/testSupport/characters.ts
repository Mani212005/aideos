/**
 * File Description: Shared fixtures for character tests: the committed specs, a seeded random source and random humanoid proportions.
 * Inputs and outputs: library and fixture spec files, a seed -> parsed specs and deterministic proportion variants that stand on the ground.
 * Used by: backend/characters/*.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { characterSpecSchema, type CharacterSpec } from "../../src/dl/characters/schema";

const ROOT = path.resolve(__dirname, "../..");
/** Every committed character: the approved library Iona and the two fixtures. */
export const CHARACTER_FILES = {
  iona: path.join(ROOT, "characters/iona.character.json"),
  pip: path.join(ROOT, "test_fixtures/characters/pip.character.json"),
  marlo: path.join(ROOT, "test_fixtures/characters/marlo.character.json"),
} as const;
export type FixtureCharacter = keyof typeof CHARACTER_FILES;

// Reads a committed spec as raw JSON (for mutation tests).
export const rawSpec = (name: FixtureCharacter): Record<string, unknown> => JSON.parse(fs.readFileSync(CHARACTER_FILES[name], "utf8"));
// Reads and parses a committed spec (defaults applied, hash kept).
export const loadSpec = (name: FixtureCharacter): CharacterSpec => characterSpecSchema.parse(rawSpec(name));

// Returns a deterministic uniform random source (mulberry32) so a failing property case is reproducible by seed.
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The proportion knobs a random variant draws, kept for failure messages. */
export interface ProportionDraw { seed: number; leg: number; thigh: number; arm: number; upper: number; torso: number; shoulders: number; hips: number }

// Builds a randomly proportioned humanoid from a base spec, keeping it standing on the ground and its grip in the palm.
export function randomProportions(base: CharacterSpec, seed: number): { spec: CharacterSpec; draw: ProportionDraw } {
  const rand = seeded(seed), between = (lo: number, hi: number) => lo + (hi - lo) * rand();
  const draw: ProportionDraw = { seed, leg: between(0.45, 1.6), thigh: between(0.8, 1.25), arm: between(0.45, 1.6), upper: between(0.8, 1.25), torso: between(0.6, 1.5), shoulders: between(0.6, 1.5), hips: between(0.6, 1.4) };
  const spec = structuredClone(base);
  const p = spec.skeleton.proportions;
  const mul = (v: readonly number[], k: number): [number, number, number] => [v[0] * k, v[1] * k, v[2] * k];
  p.knee = mul(p.knee, draw.leg * draw.thigh);
  p.ankle = mul(p.ankle, draw.leg / draw.thigh);
  p.elbow = mul(p.elbow, draw.arm * draw.upper);
  p.wrist = mul(p.wrist, draw.arm / draw.upper);
  p.fingers = mul(p.fingers, draw.arm);
  p.thumb = mul(p.thumb, draw.arm);
  for (const id of ["spine", "chest", "neck"] as const) p[id] = mul(p[id], draw.torso);
  p.shoulder = [p.shoulder[0] * draw.shoulders, p.shoulder[1] * draw.torso, p.shoulder[2]];
  p.hip = [p.hip[0] * draw.hips, p.hip[1], p.hip[2]];
  for (const side of ["gripL", "gripR"] as const) spec.sockets[side].offset = mul(spec.sockets[side].offset, draw.arm);
  // Stand on the ground: the rest ankle sits exactly one sole above y = 0.
  p.hips = [p.hips[0], -(p.hip[1] + p.knee[1] + p.ankle[1]) - spec.sockets.soleL.offset[1], p.hips[2]];
  spec.id = `random-${seed}`;
  delete spec.hash;
  return { spec, draw };
}
