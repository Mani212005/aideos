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
  risk: "High" | "Medium" | "Low";
  riskReasons: string[];
}

export interface RiskInput {
  event?: string;
  files?: string[] | null;
  error?: Error | string | null;
  threshold?: number;
}

export interface RiskOutput {
  risk: "High" | "Medium" | "Low";
  reasons: string[];
}

export const MAX_FILES_THRESHOLD: number;

/** Checks whether a changed file can safely skip the journeys test suite. */
export function isJourneysSkippable(file: string): boolean;

/** Checks whether a changed file can safely skip the legacy golden test suite. */
export function isLegacySkippable(file: string): boolean;

/** Checks whether a changed file touches render code. */
export function isRenderFile(file: string): boolean;

/** Checks whether a changed file touches stage or scene code. */
export function isStageFile(file: string): boolean;

/** Checks whether a changed file touches golden regression code or reference frames. */
export function isGoldenFile(file: string): boolean;

/** Checks whether a changed file touches GitHub Actions workflow files. */
export function isWorkflowFile(file: string): boolean;

/** Checks whether a changed file touches dependencies or lockfiles. */
export function isDependencyFile(file: string): boolean;

/** Checks whether a changed file touches security-sensitive routes in editor/vite.config.ts. */
export function isSecuritySensitiveFile(file: string): boolean;

/** Checks whether a changed file is documentation-only. */
export function isDocFile(file: string): boolean;

/** Computes a rule-based PR risk rating in shadow mode. */
export function computeRisk(input: RiskInput): RiskOutput;

/** Classifies changed files for journeys and legacy suites and computes risk rating. */
export function classify(input: ClassifyInput): ClassifyOutput;

/** Groups changed files by top-level repository area. */
export function groupFilesByArea(files: string[]): Map<string, string[]>;

/** Formats a Markdown job summary with changes and shadow mode classifications. */
export function formatJobSummary(params: {
  files?: string[] | null;
  classification: ClassifyOutput;
  event?: string;
  error?: Error | string | null;
}): string;

/** Main entry point for the changes CI job. */
export function run(): Promise<void>;
