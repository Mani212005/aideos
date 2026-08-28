/**
 * File Description: The three LLM stages of the ideation pipeline (report
 * section 4): ideate (treatment), shoot (gated shot list) and prompts
 * (self-contained b-roll prompts). Each stage is one small tool call with its
 * own zod schema, validated before anything is returned, reusing the
 * schema-derived-parameters pattern proven in cli.ts generate.
 */
import { z } from "zod";
import {
  parsePrompts,
  parseTreatment,
  promptsSchema,
  shotlistSchema,
  treatmentSchema,
  type Shotlist,
  type Treatment,
  type PromptsFile,
} from "./schemas";
import { gateShotList } from "./gate";
import { assembleFootagePrompt } from "./compile";
import { generateStructuredJson, isGoogleAiConfigured } from "../modelClient";

/**
 * Derive JSON-Schema tool parameters from a zod schema, mirroring cli.ts:
 * `io: "input"` keeps defaulted fields optional for the model.
 */
function toolParameters(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    io: "input",
    target: "draft-7",
    unrepresentable: "any",
    reused: "inline",
  }) as Record<string, unknown>;
}

/**
 * Run one structured LLM call using Google Gen AI SDK (Gemini 2.0).
 * Returns the raw parsed JSON; schema validation stays with the caller so
 * each stage's acceptance rules read plainly in its own function.
 */
async function callLlm(options: {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  parameters: Record<string, unknown>;
  maxTokens: number;
}): Promise<unknown> {
  if (!isGoogleAiConfigured()) {
    throw new Error("GEMINI_API_KEY is not set. Please set it in .env or the environment.");
  }

  const prompt = `${options.user}\n\nPlease emit your output as structured JSON conforming to the '${options.toolName}' schema.`;
  return await generateStructuredJson(prompt, {
    systemInstruction: options.system,
    temperature: 0.2,
  });
}

/**
 * Run one structured LLM call and validate it, retrying with the validation
 * errors fed back so schema or pacing failures self-correct before giving up.
 * Each attempt is a fresh call; nothing partial is ever returned.
 */
async function callLlmValidated<T>(options: {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  parameters: Record<string, unknown>;
  maxTokens: number;
  validate: (raw: unknown) => T;
  attempts?: number;
}): Promise<T> {
  const tries = options.attempts ?? 3;
  let lastError = "";
  for (let attempt = 1; attempt <= tries; attempt++) {
    const feedback = lastError
      ? `\n\nYour previous attempt was rejected:
${lastError}
Return the complete corrected version, fixing every issue.`
      : "";
    try {
      return options.validate(
        await callLlm({
          system: options.system,
          user: options.user + feedback,
          toolName: options.toolName,
          toolDescription: options.toolDescription,
          parameters: options.parameters,
          maxTokens: options.maxTokens,
        }),
      );
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < tries) console.log(`Attempt ${attempt} rejected, retrying: ${lastError.split("\n")[0]}`);
    }
  }
  throw new Error(`Stage failed after ${tries} attempts. Last error:\n${lastError}`);
}

const IDEATE_SYSTEM = `You are an expert explainer-film story editor writing a treatment for a faceless narrated video (YouTube long-form and Shorts).

Rules:
- chapters: 3 to 8. Each chapter has a short lowercase label (1-3 words), one claim (what the viewer believes by the end of it) and the evidence that makes the claim land.
- The arc must build: hook, escalating substance, payoff. No filler chapters.
- styleBlock: ONE paragraph describing the shared visual look of all generated b-roll: palette words, lens, lighting, grade. It will be prepended verbatim to every clip prompt, so make it self-contained and concrete.
- characters: only recurring named entities that benefit from a frozen description (e.g. a recurring mascot or demonstrator). Each description is a concrete paragraph reused word-for-word later; keep them visual (age, build, wardrobe, distinguishing features).
- Write for a curious general audience. Conversational, specific, no hype.`;

/**
 * Stage 1: idea to treatment. Pure story decisions; nothing visual is locked.
 */
export async function runIdeate(idea: string): Promise<Treatment> {
  return callLlmValidated({
    system: IDEATE_SYSTEM,
    user: `Idea for the video:\n\n${idea}`,
    toolName: "write_treatment",
    toolDescription: "Writes a chaptered treatment with claims, evidence, a shared style block and character sheets.",
    parameters: toolParameters(treatmentSchema),
    maxTokens: 4096,
    validate: parseTreatment,
  });
}

const SHOOT_SYSTEM = `You are an expert Aideos film director converting a treatment into a shot list.

Structure:
- nodes: 2 to 10 concept nodes forming the film's canvas graph. id: lowercase letters, digits and dashes. label max 28 chars, optional sub max 34 chars. Order them left-to-right along the argument; coordinates are assigned automatically.
- shots: 6 to 30. Every chapter must own at least one shot. shot.ch names the chapter label exactly.
- The FIRST shot must use move: "cut" (nothing to move from). Every later chapter boundary also starts with move: "cut". Total cuts must equal the number of chapters.
- shot.look must be exactly one node id from the nodes array, or the literal string "all". Never an object, never a list.

Pacing (all enforced; a violation rejects the whole shot list):
- Each shot dur is 2..45 seconds and the film totals at least 10s.
- Device blocks are: MatrixGrid, Distribution, TokenStrip, AttentionArcs, VectorSpace, LayerStack, ScaleBar, AnalogyInset, Plot.
- No shot holding a device may run past 25s, and no device may follow itself.
- A text beat (stage: "frame") at least every 60-90s; a bare canvas (stage: "none") at least every 60-90s.
- stage "anchor"/"frame" carry at least one block; "anchor" looks at one named node, never "all".
- At most 3 accents per shot (each device, StatCounter, active Card, accentWord TextReveal, starred Math spends one).

Blocks come from the Aideos library: Kicker, TextReveal, Body, Math, StatCounter, ProgressBar, Plot, MatrixGrid, Distribution, TokenStrip, AttentionArcs, VectorSpace, LayerStack, ScaleBar, AnalogyInset, Card, Divider, IconLabel.
- Every block must carry ALL required fields of its component. In particular: AttentionArcs needs tokens (3-9), focus (an index), links (1-4 indices); Plot needs points (2-24 [x,y] pairs with x and y each between 0 and 1) and optional labels max 16 chars; MatrixGrid needs values (2-8 rows of 2-10 numbers, each between 0 and 1); Distribution needs items (2-6, each label plus p between 0 and 1); TokenStrip needs tokens (3-16); ScaleBar needs ticks (2-6 short strings) and value between 0 and 1; StatCounter needs to (a number) and label; TextReveal needs text max 180 chars.
- scriptText: conversational narration spoken during the shot. This becomes the voiceover.
- needsFootage: true only where photoreal or metaphorical b-roll genuinely helps the narration (hook moments, strong metaphors). Flagged shots MUST have visualDirection describing the desired clip. Keep flags rare: 1 to 3 per film.
- footageSeconds: desired b-roll length, default 5.`;

/**
 * Stage 2: treatment to shot list, gated by parseFilm pacing rules before it
 * can be returned. Bad pacing dies here at token cost, never render cost.
 */
export async function runShoot(treatment: Treatment): Promise<Shotlist> {
  const shotlist = await callLlmValidated({
    system: SHOOT_SYSTEM,
    user: shootUserMessage(treatment),
    toolName: "write_shotlist",
    toolDescription: "Writes a paced shot list over a concept graph, mapping onto the Aideos film schema.",
    parameters: toolParameters(shotlistSchema),
    // A full film is a large payload; the default ceiling truncates the tool
    // call into unparseable JSON, which reads as a mystery syntax error.
    maxTokens: 16384,
    validate: gateShotListRaw,
  });
  // Chapter labels must line up with the treatment, not just among themselves.
  const labels = new Set(treatment.chapters.map((c) => c.label));
  const unknown = shotlist.shots.filter((s) => s.ch && !labels.has(s.ch)).map((s) => s.id);
  if (unknown.length > 0)
    throw new Error(`shots reference chapters absent from the treatment: ${unknown.join(", ")}`);
  const missing = treatment.chapters.filter((c) => !shotlist.chapters.includes(c.label));
  if (missing.length > 0)
    throw new Error(`treatment chapters missing from the shot list: ${missing.map((c) => c.label).join(", ")}`);
  return shotlist;
}

/** The stage-2 prompt: treatment content plus the id instruction. */
function shootUserMessage(treatment: Treatment): string {
  return `Treatment:\n\nTitle: ${treatment.title}\nLogline: ${treatment.logline}\n\nChapters:\n${treatment.chapters
    .map((c, i) => `${i + 1}. ${c.label} - claim: ${c.claim} - evidence: ${c.evidence}`)
    .join("\n")}\n\nProduce the shot list. Film id: a slug of the title, lowercase letters, digits and dashes only.`;
}

/** Gate a raw shot list, mapping its thrown text into retry feedback. */
function gateShotListRaw(raw: unknown): Shotlist {
  return gateShotList(raw).shotlist;
}

const PROMPTS_SYSTEM = `You write text-to-video prompts for the Wan2.1 diffusion model (5-second clips, no audio, no text rendering).

Each prompt must be fully self-contained: subject, action, camera move, lighting, lens, style tokens. Never refer back to other shots or to "the video". Do not include style palette/lens/grade boilerplate; a shared style block and character sheets are added automatically around your prompt. Describe motion that reads clearly in five seconds. Negative prompts should name artifacts to avoid (text, watermark, distortion).`;

/**
 * Stage 3: shot list to per-shot b-roll prompts for flagged shots. The final
 * prompt (style block + character sheets + core) is assembled deterministically
 * at compile time, so the model cannot drift the shared look.
 */
export async function runPrompts(shotlist: Shotlist, treatment: Treatment): Promise<PromptsFile> {
  const flagged = shotlist.shots.filter((s) => s.needsFootage);
  if (flagged.length === 0) return { prompts: [] };

  const user = flagged
    .map(
      (s) =>
        `Shot ${s.id} (${s.footageSeconds}s):\nNarration: ${s.scriptText ?? "(none)"}\nVisual direction: ${s.visualDirection ?? "(none)"}`,
    )
    .join("\n\n");

  const file = await callLlmValidated({
    system: PROMPTS_SYSTEM,
    user,
    toolName: "write_footage_prompts",
    toolDescription: "One self-contained video-model prompt per requested shot.",
    parameters: toolParameters(promptsSchema),
    maxTokens: 2048,
    validate: (raw) => checkPromptCoverage(parsePrompts(raw), flagged.map((s) => s.id)),
  });

  // Sanity-render each assembled prompt once here so a broken assembly fails
  // at token cost rather than during assemble on the box.
  for (const p of file.prompts) {
    const shot = flagged.find((s) => s.id === p.shotId)!;
    const context = `${shot.scriptText ?? ""} ${shot.visualDirection ?? ""}`;
    assembleFootagePrompt(treatment, p.prompt, context);
  }
  return file;
}

/** Require exactly one prompt per flagged shot and none orphaned. */
function checkPromptCoverage(file: PromptsFile, flaggedIds: string[]): PromptsFile {
  const got = new Set(file.prompts.map((p) => p.shotId));
  const missing = flaggedIds.filter((id) => !got.has(id));
  if (missing.length > 0) throw new Error(`no footage prompt produced for shots: ${missing.join(", ")}`);
  const extra = [...got].filter((id) => !flaggedIds.includes(id));
  if (extra.length > 0) throw new Error(`footage prompts name non-flagged shots: ${extra.join(", ")}`);
  return file;
}
