/**
 * File Description: Model-Driven Video Edit Planner (Phase 2).
 * Composes the EditContext into an AI prompt, queries the injected LLM (or Google Gen AI client),
 * and validates the resulting EditOp program in a 3-attempt validate-then-repair loop
 * mirroring backend/scene/generateSvg.ts's generateWithRepair contract.
 */

import type { EditContext } from "../editContext/buildEditContext";
import { plannerOutputSchema, type EditOp } from "./schema";
import { validateEditProgram } from "./validator";
import { generateText } from "../modelClient";

export interface PlanEditsOptions {
  maxAttempts?: number;
  agentHints?: string;
  temperature?: number;
}

export interface PlanEditsResult {
  plan: string;
  ops: EditOp[];
  attempts: number;
  warnings: string[];
}

/**
 * Strips markdown code fences from model response string.
 */
export function cleanCodeFence(raw: string): string {
  let cleaned = raw.trim();
  const fenced = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenced) return fenced[1].trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "");
  }
  return cleaned.trim();
}

/**
 * Builds the repair prompt feeding rejected attempt errors back to the model.
 */
export function buildRepairPrompt(basePrompt: string, rejected: string, errors: string[]): string {
  return `${basePrompt}

---
### PREVIOUS ATTEMPT REJECTED
Your previous output failed the edit program validation gate with these errors:
${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}

The rejected output was:
\`\`\`json
${rejected.slice(0, 2000)}
\`\`\`

Fix every error listed above and return ONLY a corrected JSON object matching:
{ "plan": "...", "ops": [ ... ] }`;
}

/**
 * Constructs the rich system/user prompt for the AI video editing planner.
 */
export function buildPlannerPrompt(
  request: string,
  context: EditContext,
  agentHints?: string,
): string {
  const transcriptSummary =
    context.transcript && context.transcript.length > 0
      ? context.transcript
          .map((w) => `[${w.start.toFixed(2)}s - ${w.end.toFixed(2)}s] ${w.punctuated_word || w.word}${w.confidence ? ` (conf: ${w.confidence.toFixed(2)})` : ""}`)
          .slice(0, 200)
          .join(" ")
      : "(No transcript available for this video)";

  const fillersSummary =
    context.fillers && context.fillers.length > 0
      ? context.fillers
          .map((f) => `"${f.text}" at ${f.start.toFixed(2)}s-${f.end.toFixed(2)}s`)
          .join(", ")
      : "None detected";

  const silencesSummary =
    context.silences && context.silences.length > 0
      ? context.silences
          .map((s) => `${s.start.toFixed(2)}s-${s.end.toFixed(2)}s (${(s.end - s.start).toFixed(2)}s)`)
          .join(", ")
      : "None detected";

  const lanesSummary = context.lanes
    .map((l) => `- Lane "${l.label}" (id: "${l.id}", z-index: ${l.number}, muted: ${l.muted}, hidden: ${l.hidden})`)
    .join("\n");

  const clipsSummary = context.clips
    .map((c) => `- Clip "${c.id}" (${c.kind}) on lane "${c.layerId}": [${(c.position ?? 0).toFixed(2)}s - ${((c.position ?? 0) + ((c.end ?? 0) - (c.start ?? 0))).toFixed(2)}s]`)
    .slice(0, 40)
    .join("\n");

  return `You are an expert AI Video Editor.
A user has provided a video timeline and requested edits in natural language.
Your job is to analyze the request against the timeline state, transcript, fillers, and silences,
and compose a sequence of discrete editing operations (EditOp[]) that fulfills their intent precisely.

---
### USER EDIT REQUEST
"${request}"

${agentHints ? `### CONNECTED AGENT GUIDANCE & HINTS\n${agentHints}\n` : ""}

---
### CURRENT TIMELINE CONTEXT
- Duration: ${context.meta.durationSec ? `${context.meta.durationSec.toFixed(2)}s` : "Unknown"}
- FPS: ${context.meta.fps}
- Format: ${context.meta.format || "long"}
- Accent Color: ${context.meta.accent || "#635BFF"}

#### Spoken Transcript with Timings:
${transcriptSummary}

#### Detected Filler Words:
${fillersSummary}

#### Detected Dead Air / Silences:
${silencesSummary}

#### Timeline Layers (Z-order):
${lanesSummary}

#### Active Clips:
${clipsSummary}

---
### DESIGN SYSTEM & QUALITY RULES
1. Color Palette: Use 6-value palette (#0A0A0B canvas, #F5F5F5 text, #8A8A8E muted, #635BFF accent).
2. Typography: Geist for narrative, JetBrains Mono for system/numbers.
3. No Long Dashes: Never use em dashes or en dashes anywhere; use hyphens (-) or colons (:).
4. Audio-Visual Sync: When removing fillers or dead air, use 'remove_fillers' or 'remove_dead_air' so video, audio, and overlay clips ripple together without desync.
5. All timestamps must be in seconds and fall within valid timeline bounds [0, ${context.meta.durationSec || 60}].

---
### ALLOWED EDIT OPERATIONS (EditOp VOCABULARY)
- add_text_overlay: { "op": "add_text_overlay", "text": string, "startSec": number, "endSec": number, "size"?: "headline"|"body"|"kicker", "position"?: "top"|"center"|"bottom", "accentWord"?: string, "laneHint"?: string, "label"?: string }
- add_slide: { "op": "add_slide", "visualDirection"?: string, "sceneSpec"?: object, "startSec": number, "endSec": number, "style"?: string, "label"?: string }
- add_caption_track: { "op": "add_caption_track", "style"?: "kinetic"|"standard", "fromSec"?: number, "toSec"?: number, "label"?: string }
- remove_fillers: { "op": "remove_fillers", "scope"?: "all" | string[] | { "fromSec": number, "toSec": number }, "confidenceMin"?: number, "label"?: string }
- remove_dead_air: { "op": "remove_dead_air", "minSilenceSec"?: number, "targetGapSec"?: number, "range"?: { "fromSec": number, "toSec": number }, "label"?: string }
- trim_range: { "op": "trim_range", "fromSec": number, "toSec": number, "label"?: string }
- split_at: { "op": "split_at", "atSec": number, "clipId"?: string, "label"?: string }
- move_clip: { "op": "move_clip", "clipId": string, "toSec": number, "laneHint"?: string, "label"?: string }
- set_clip_speed: { "op": "set_clip_speed", "clipId": string | "base", "factor": number, "label"?: string }
- set_volume: { "op": "set_volume", "clipId"?: string, "laneId"?: string, "volume": number, "label"?: string }
- mute_lane: { "op": "mute_lane", "laneId": string, "muted"?: boolean, "label"?: string }
- hide_lane: { "op": "hide_lane", "laneId": string, "hidden"?: boolean, "label"?: string }
- set_accent: { "op": "set_accent", "hex": "#RRGGBB", "label"?: string }
- set_theme: { "op": "set_theme", "partialTheme": object, "label"?: string }
- reorder_segments: { "op": "reorder_segments", "order": string[], "label"?: string }

---
### OUTPUT CONTRACT
Respond ONLY with a valid JSON object with the following structure:
{
  "plan": "Clear, natural-language explanation describing what will be changed and why.",
  "ops": [
    { "op": "...", ... }
  ]
}`;
}

/**
 * Plans video edits from a user request against an EditContext using an LLM in a validate-repair loop.
 */
export async function planEdits(
  request: string,
  context: EditContext,
  llmCaller?: (prompt: string) => Promise<string>,
  options?: PlanEditsOptions,
): Promise<PlanEditsResult> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const caller = llmCaller ?? ((p: string) => generateText(p, { temperature: options?.temperature ?? 0.2 }));

  const basePrompt = buildPlannerPrompt(request, context, options?.agentHints);
  let prompt = basePrompt;
  const allWarnings: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let rawOutput: string;
    try {
      rawOutput = await caller(prompt);
    } catch (err: unknown) {
      if (attempt === maxAttempts) {
        throw new Error(`Model call failed after ${maxAttempts} attempts: ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }

    const cleaned = cleanCodeFence(rawOutput);

    // 1. JSON Parse
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      if (attempt === maxAttempts) {
        throw new Error(`Failed to parse model response as JSON: ${cleaned.slice(0, 200)}`);
      }
      prompt = buildRepairPrompt(basePrompt, cleaned, [`JSON syntax error: ${String(parseErr)}`]);
      continue;
    }

    // 2. Output Schema Validation
    const outputParse = plannerOutputSchema.safeParse(parsed);
    if (!outputParse.success) {
      const errors = outputParse.error.issues.map((i) => `Schema violation at ${i.path.join(".")}: ${i.message}`);
      if (attempt === maxAttempts) {
        throw new Error(`planEdits failed after ${maxAttempts} attempts: Model output does not match PlannerOutput schema: ${errors.join("; ")}`);
      }
      prompt = buildRepairPrompt(basePrompt, cleaned, errors);
      continue;
    }

    const { plan, ops } = outputParse.data;

    // 3. Semantic and Simulation Validation Gate
    const validation = validateEditProgram(ops, context);
    allWarnings.push(...validation.warnings);

    if (validation.valid && validation.program) {
      return {
        plan,
        ops: validation.program,
        attempts: attempt,
        warnings: Array.from(new Set(allWarnings)),
      };
    }

    if (attempt === maxAttempts) {
      throw new Error(`Edit program validation failed after ${maxAttempts} attempts:\n${validation.errors.join("\n")}`);
    }

    prompt = buildRepairPrompt(basePrompt, cleaned, validation.errors);
  }

  throw new Error(`planEdits failed after ${maxAttempts} attempts`);
}
