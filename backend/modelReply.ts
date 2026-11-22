/**
 * File Description: The one parser for model replies: strips Markdown code fences (any language tag, prose around
 * them, unterminated fences) and returns the JSON text or the parsed and schema-checked value. Pure: no Node imports.
 * Inputs and outputs: raw model reply text (and an optional zod-style schema) -> clean JSON text, a parsed value, or fence-free prose.
 * Used by: backend/geminiReview/geminiReview.ts, backend/modelClient.ts, backend/designSpec/designer.ts, backend/editPlanner/planner.ts, backend/reelCut/writer.ts, backend/pipeline/director.ts.
 */

/** The opening marker line of a fence: three backticks, an optional language tag, then the end of that line. */
const FENCE_OPEN = /^```[A-Za-z0-9_+.-]*[ \t]*\r?\n?/;

/** Anything that validates an unknown value into a typed one, such as a zod schema. */
export interface ReplySchema<T> {
  parse(value: unknown): T;
}

// Reports whether a string parses as JSON.
function isJsonText(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// Strips markdown code fences (with or without a language tag such as json or python) and surrounding prose, returning the JSON text.
export function cleanModelJsonResponse(rawText: string): string {
  const text = rawText.trim();
  if (isJsonText(text)) return text;

  let firstBody: string | undefined;
  for (const match of text.matchAll(/```[A-Za-z0-9_+.-]*[ \t]*\r?\n?([\s\S]*?)```/g)) {
    const body = match[1].trim();
    firstBody ??= body;
    if (isJsonText(body)) return body;
  }

  // An unterminated fence (a cut-off reply) still opens with the marker line; drop it.
  const candidate = firstBody ?? text.replace(FENCE_OPEN, "").trim();
  if (isJsonText(candidate)) return candidate;

  // Prose around a bare JSON object: take the outermost braces.
  const open = candidate.indexOf("{");
  const close = candidate.lastIndexOf("}");
  if (open >= 0 && close > open) {
    const slice = candidate.slice(open, close + 1);
    if (isJsonText(slice)) return slice;
  }
  return candidate;
}

// Parses a model's JSON reply (fenced or wrapped in prose) and, when a schema is given, validates it; throws on bad JSON or a schema miss.
export function parseModelJson<T = unknown>(rawText: string, schema?: ReplySchema<T>): T {
  const value: unknown = JSON.parse(cleanModelJsonResponse(rawText));
  return schema ? schema.parse(value) : (value as T);
}

// Removes one code fence wrapped around a prose reply (a screenplay, say), keeping the text inside it.
export function stripCodeFence(rawText: string): string {
  const text = rawText.trim();
  if (!text.startsWith("```")) return text;
  return text.replace(FENCE_OPEN, "").replace(/\s*```$/, "").trim();
}
