/**
 * File Description: The small file the golden-frame test leaves behind so scripts/ci.ts can tell "compared and passed" from "nothing to compare against yet" (NOT COVERED), which the test's exit code alone cannot say. Plain fs and path only, so the CI runner can import it without pulling in the render harness.
 * Inputs and outputs: a golden outcome -> .ci-artifacts/legacy/result.json, and back.
 * Used by: backend/journeys/goldenCompare.ts, backend/journeys/legacy.golden.ts, scripts/ci.ts.
 */

import fs from "node:fs";
import path from "node:path";

/** What the legacy golden comparison concluded. */
export type GoldenOutcome =
  | { status: "passed"; frames: number }
  | { status: "not-covered"; reason: string }
  | { status: "failed"; failures: string[] };

/** Where the outcome is written; follows AIDEOS_CI_ARTIFACTS like every other journey artifact. */
export function goldenResultFile(): string {
  const root = process.env.AIDEOS_CI_ARTIFACTS ? path.resolve(process.env.AIDEOS_CI_ARTIFACTS) : path.resolve(__dirname, "../../.ci-artifacts");
  return path.join(root, "legacy", "result.json");
}

/** Records the outcome of this run for the CI runner. */
export function writeGoldenOutcome(outcome: GoldenOutcome): void {
  fs.mkdirSync(path.dirname(goldenResultFile()), { recursive: true });
  fs.writeFileSync(goldenResultFile(), `${JSON.stringify(outcome, null, 2)}\n`);
}

/** Reads the outcome of the run that just finished, or null when the test wrote none. */
export function readGoldenOutcome(): GoldenOutcome | null {
  const file = goldenResultFile();
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as GoldenOutcome;
}

/** Removes a stale outcome so an old result can never be mistaken for the run about to start. */
export function clearGoldenOutcome(): void {
  fs.rmSync(goldenResultFile(), { force: true });
}
