/**
 * File Description: Small deterministic fixtures for the farm tests: a controllable clock, task specs and payloads derived from a seed, and throwaway directories.
 * Inputs and outputs: a seed or a prefix -> a TaskSpec, a TaskPayload, a clock or a temporary directory.
 * Used by: backend/farm/*.test.ts.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TaskPayload, TaskSpec } from "../farm/taskSpec";

/** A clock the test moves by hand. */
export function fakeClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    /** The current fake time in epoch milliseconds. */
    now: (): number => t,
    /** Moves the clock forward. */
    advance(ms: number): void {
      t += ms;
    },
  };
}

/** The SHA-256 hex digest of a string, used to make stable fake digests. */
export function digestOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** A valid task spec whose digests all derive from `seed`; `over` replaces fields. */
export function specFor(seed: string | number, over: Partial<TaskSpec> = {}): TaskSpec {
  return {
    irHash: digestOf(`ir-${seed}`),
    assetDigests: { "fonts/Geist-latin.ttf": digestOf("font-geist"), [`visuals/${seed}.svg`]: digestOf(`svg-${seed}`) },
    format: "long",
    profile: "draft",
    frameRange: null,
    rendererVersion: "test-renderer-1",
    ...over,
  };
}

/** A valid payload for a film named by `seed`. */
export function payloadFor(seed: string | number): TaskPayload {
  return { filmId: `film-${seed}`, filmDigest: digestOf(`film-${seed}`) };
}

/** Creates a throwaway directory; call the returned `cleanup` when the test ends. */
export function tempDir(prefix = "aideos-farm-test-"): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
