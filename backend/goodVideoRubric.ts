/**
 * File Description: Defines the structured good-video rubric summary, schema, and validation utilities for video quality scoring.
 * Inputs and outputs: none -> parsed good video quality rubric schema and summary.
 * Used by: backend/review/criteria.ts, backend/geminiReview/rubric.ts.
 */

import fs from "node:fs";
import path from "node:path";

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

export const RUBRIC_SUMMARY = `
GOOD VIDEO RUBRIC:
1. One persistent stage (stage-clear events <= 1 per 30 s; median 2 s layout correlation >= 0.75)
2. Carry-over with transformation (>= 1 per 20 s)
3. Visible cause and effect (every beat with a verb of action)
4. Camera that does something (present, purposeful)
5. Bottom captions (pass)
6. Readability (zero violations among essential text)
7. No overlap or clipping (zero)
8. Audio sync (pass)
9. Pacing (pass)
10. Storyline (>= 3 of 4)
11. Accuracy and honesty (zero ungrounded)
12. Loudness and mix (pass)

Final acceptance is a Gemini review score of 9+ on the rendered video.
`;

// Parses and validates a rubric schema object from parsed JSON data.
export function parseRubric(data: unknown): RubricFile {
  if (!data || typeof data !== "object" || !("criteria" in data) || !Array.isArray((data as any).criteria)) {
    throw new Error("Invalid rubric: missing criteria array");
  }
  const criteria = (data as any).criteria.map((c: any) => {
    if (
      !c ||
      typeof c.id !== "string" ||
      typeof c.name !== "string" ||
      typeof c.gate !== "boolean" ||
      typeof c.target !== "string"
    ) {
      throw new Error(`Invalid rubric criterion: ${JSON.stringify(c)}`);
    }
    return {
      id: c.id,
      name: c.name,
      gate: c.gate,
      target: c.target,
      anchors: c.anchors || {},
    };
  });
  return { criteria };
}

// Loads and parses the standard good-video rubric from disk.
export function loadGoodVideoRubric(rubricPath?: string): RubricFile {
  const target = rubricPath || path.resolve(__dirname, "../docs/good-video.rubric.json");
  const raw = JSON.parse(fs.readFileSync(target, "utf-8"));
  return parseRubric(raw);
}
