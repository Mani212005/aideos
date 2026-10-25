/**
 * File Description: Type declarations for the CI changed-files classifier module.
 * Inputs and outputs: Type declarations for classifier functions and data structures.
 * Used by: scripts/ciChanges.test.ts.
 */

export interface ClassifyInput {
  event: string;
  files?: string[] | null;
  error?: Error | string | null;
}

export interface ClassifyOutput {
  journeys: "true" | "false";
  legacy: "true" | "false";
  reasons: string[];
}

export function isJourneysSkippable(file: string): boolean;
export function isLegacySkippable(file: string): boolean;
export function classify(input: ClassifyInput): ClassifyOutput;
export function groupFilesByArea(files: string[]): Map<string, string[]>;
export function formatJobSummary(params: {
  files?: string[] | null;
  classification: ClassifyOutput;
  event?: string;
  error?: Error | string | null;
}): string;
export function run(): Promise<void>;
