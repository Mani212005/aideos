/**
 * File Description: A small zero-dependency property-test runner: a seeded random source (mulberry32), a few generators, and forAll, which runs a check over many generated inputs and, on a failure, reports the property name, the seed and the input so the exact case replays. AIDEOS_PROPERTY_SEED=<n> replays one seed and AIDEOS_PROPERTY_CASES=<n> changes the case count.
 * Inputs and outputs: a generator and a check function -> returns on success, throws an Error naming the failing seed and input on failure.
 * Used by: backend/testSupport/characters.ts (seeded), backend/timeFrameArithmetic.property.test.ts, backend/timeline/layerIds.property.test.ts.
 */

/** A uniform random source in [0, 1). */
export type Rand = () => number;

// Returns a deterministic uniform random source (mulberry32) so a failing property case is reproducible by seed.
export function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Draws an integer in [lo, hi] inclusive.
export function randInt(rand: Rand, lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

// Draws a float in [lo, hi).
export function randFloat(rand: Rand, lo: number, hi: number): number {
  return lo + rand() * (hi - lo);
}

// Picks one element of a non-empty list.
export function pick<T>(rand: Rand, list: readonly T[]): T {
  if (list.length === 0) throw new Error("pick needs a non-empty list");
  return list[Math.floor(rand() * list.length)];
}

/** Options of forAll. */
export interface ForAllOptions {
  /** Number of generated cases (default 200, or AIDEOS_PROPERTY_CASES). */
  cases?: number;
  /** First seed (default 1); case i uses seed + i. AIDEOS_PROPERTY_SEED replays exactly one seed. */
  seed?: number;
}

// Reads a positive integer from an environment variable, or undefined when it is unset or invalid.
function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

// Runs `check` on `cases` inputs drawn by `generate`; the first failure is rethrown with the property name, seed and input.
export function forAll<T>(name: string, generate: (rand: Rand) => T, check: (input: T) => void, options: ForAllOptions = {}): void {
  const replay = envInt("AIDEOS_PROPERTY_SEED");
  const cases = replay !== undefined ? 1 : (envInt("AIDEOS_PROPERTY_CASES") ?? options.cases ?? 200);
  const first = replay ?? options.seed ?? 1;
  for (let i = 0; i < cases; i++) {
    const seed = first + i;
    const input = generate(seeded(seed));
    try {
      check(input);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      let shown: string;
      try {
        shown = JSON.stringify(input);
      } catch {
        shown = String(input);
      }
      throw new Error(`property "${name}" failed at seed ${seed} (replay with AIDEOS_PROPERTY_SEED=${seed}): ${cause}\ninput: ${shown.slice(0, 2000)}`);
    }
  }
}
