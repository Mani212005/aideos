/**
 * File Description: Defines the structured good-video rubric summary, schema, and validation utilities for video quality scoring. Generates RUBRIC_SUMMARY from docs/good-video.rubric.json and backend/review/thresholds.ts so designing agents always receive the real calibrated threshold from one source.
 * Inputs and outputs: docs/good-video.rubric.json and THRESHOLDS -> parsed good video quality rubric schema and generated RUBRIC_SUMMARY.
 * Used by: backend/designSpec/brief.ts, backend/agentBridge/contextBuilder.ts, backend/agentLink/prompt.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { THRESHOLDS } from "./review/thresholds";

export interface RubricCriterion {
  id: string;
  name: string;
  gate: boolean;
  target: string;
  anchors: Record<string, string>;
}

export interface RubricFile {
  criteria: RubricCriterion[];
}

const CORRELATION_PATTERN = /(median 2 s layout correlation >= )([0-9.]+)/;

// Synchronizes criterion targets with calibrated thresholds in backend/review/thresholds.ts so prompts never drift.
function applyCalibratedTarget(criterion: RubricCriterion): string {
  if (criterion.id === "1" && CORRELATION_PATTERN.test(criterion.target)) {
    return criterion.target.replace(
      CORRELATION_PATTERN,
      `$1${THRESHOLDS.persistence.medianMin}`,
    );
  }
  return criterion.target;
}

// Parses and validates a rubric schema object from parsed JSON data.
export function parseRubric(data: unknown): RubricFile {
  if (!data || typeof data !== "object" || !("criteria" in data)) {
    throw new Error("Invalid rubric: missing criteria array");
  }
  const rawCriteria = (data as { criteria?: unknown }).criteria;
  if (!Array.isArray(rawCriteria)) {
    throw new Error("Invalid rubric: missing criteria array");
  }
  const criteria: RubricCriterion[] = rawCriteria.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Invalid rubric criterion: ${JSON.stringify(entry)}`);
    }
    const c = entry as Record<string, unknown>;
    if (
      typeof c.id !== "string" ||
      typeof c.name !== "string" ||
      typeof c.gate !== "boolean" ||
      typeof c.target !== "string"
    ) {
      throw new Error(`Invalid rubric criterion: ${JSON.stringify(entry)}`);
    }
    const anchors: Record<string, string> = {};
    if (c.anchors && typeof c.anchors === "object" && !Array.isArray(c.anchors)) {
      for (const [k, v] of Object.entries(c.anchors as Record<string, unknown>)) {
        if (typeof v === "string") anchors[k] = v;
      }
    }
    return {
      id: c.id,
      name: c.name,
      gate: c.gate,
      target: c.target,
      anchors,
    };
  });
  return { criteria };
}

// Loads and parses the standard good-video rubric from disk.
export function loadGoodVideoRubric(rubricPath?: string): RubricFile {
  const target = rubricPath || path.resolve(__dirname, "../docs/good-video.rubric.json");
  const raw: unknown = JSON.parse(fs.readFileSync(target, "utf-8"));
  return parseRubric(raw);
}

// Formats a parsed rubric into the concise summary block embedded in design briefs and agent prompts.
export function formatRubricSummary(rubric: RubricFile): string {
  const lines = rubric.criteria.map(
    (c) => `${c.id}. ${c.name} (${applyCalibratedTarget(c)})`,
  );
  return `\nGOOD VIDEO RUBRIC:\n${lines.join("\n")}\n\nFinal acceptance is a Gemini review score of 9+ on the rendered video.\n`;
}

export const RUBRIC_SUMMARY = formatRubricSummary(loadGoodVideoRubric());
