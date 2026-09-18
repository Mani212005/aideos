/**
 * File Description: The auto-prompt entry point. Turns a raw user prompt into a finished, produced
 * film with no screenplay in hand to start from. An LLM plays creative director: it drafts a Claude
 * screenplay (docs/DIRECTOR_GUIDE.md is its brief) from the prompt, the draft is validated against
 * the same screenplay grammar backend/scriptIntake.ts already parses, and a rejected draft is retried
 * with the specific reason fed back to the model. Once a screenplay passes, it is handed to
 * runProduction (./run.ts) unchanged, so a prompted film goes through the identical audio-first,
 * design-compiled, invariant-checked pipeline a hand-written screenplay does. The plan is always
 * model-driven: nothing here falls back to a canned or templated screenplay.
 */

import fs from "fs";
import path from "path";
import { generateText } from "../modelClient";
import { parseClaudeScript } from "../scriptIntake";
import { ROOT } from "./filmStore";
import { runProduction, type ProgressHandler } from "./run";
import type { ProductionRequest, ProductionResult } from "./types";

/** Drafts (or redrafts, given the reason the prior attempt was rejected) a screenplay for a prompt. */
export type GenerateScreenplayFn = (prompt: string, rejectionReason?: string) => Promise<string>;

/** Format instructions appended to the director's guide so the model's output parses cleanly. */
const SCREENPLAY_FORMAT_SPEC = `
Write the screenplay as a Claude-style screenplay in markdown:
- Start with a single "# <Film Title>" line naming the film.
- Follow it with several "## <Section Title>" headers, each opening one chapter of the argument.
- Under each section, write one or more beats as bracket tags, each on its own line followed by its
  text: [VISUAL] a one-line direction for what the frame shows or the b-roll to shoot; [ON SCREEN]
  a short on-screen phrase (optional); [NARRATION] the sentence(s) the narrator speaks for the beat.
- Every section must carry at least one [NARRATION] beat: that is the only text a viewer ever hears.
- Do not include timestamps, camera moves, shot durations, or JSON. The production pipeline measures
  the narration audio and derives all of that automatically; the screenplay only supplies the story.
- Output ONLY the screenplay markdown. No preamble, no commentary, no surrounding code fence.
`;

/** Reads docs/DIRECTOR_GUIDE.md so the director's creative brief has exactly one source of truth. */
function readDirectorGuide(): string {
  return fs.readFileSync(path.join(ROOT, "docs", "DIRECTOR_GUIDE.md"), "utf8");
}

/** Assembles the system instruction the screenplay-drafting model is given: the director's guide plus the output grammar it must produce. */
export function buildDirectorSystemInstruction(): string {
  return `${readDirectorGuide()}\n\n${SCREENPLAY_FORMAT_SPEC}`;
}

/** The real screenplay generator: asks the configured LLM to write the film from the prompt. */
async function defaultGenerateScreenplay(prompt: string, rejectionReason?: string): Promise<string> {
  const userPrompt = rejectionReason
    ? `${prompt}\n\nYour previous draft was rejected: ${rejectionReason}\nWrite a corrected screenplay from scratch, not a patch.`
    : prompt;
  return generateText(userPrompt, { systemInstruction: buildDirectorSystemInstruction(), temperature: 0.6 });
}

/** Names why a drafted screenplay is unusable, or null when it is fine to produce. */
function screenplayIssue(text: string): string | null {
  if (!text.trim()) return "the draft was empty";
  const sections = parseClaudeScript(text);
  if (sections.length === 0) return "no screenplay sections (## headers with beats) were found";
  if (!sections.some((s) => s.beats.some((b) => b.type === "narration"))) {
    return "no section carries a [NARRATION] beat, so there is nothing for the narrator to speak";
  }
  return null;
}

/** Pulls the film's title off the screenplay's "# Title" line, falling back to the prompt itself. */
function titleFromScreenplay(screenplay: string, prompt: string): string {
  return screenplay.match(/^#\s+(.+)$/m)?.[1]?.trim() || prompt.slice(0, 60).trim();
}

export interface DraftScreenplayOptions {
  /** Overrides the real LLM call; tests inject a fake here instead of reaching the network. */
  generateScreenplay?: GenerateScreenplayFn;
  /** How many drafts to attempt before giving up. Defaults to 3. */
  maxAttempts?: number;
}

export interface DraftedScreenplay {
  screenplay: string;
  title: string;
  /** How many drafts it took to produce a usable screenplay. */
  attempts: number;
}

/**
 * Drafts a screenplay from a raw prompt, retrying with the specific rejection reason fed back to
 * the model until a usable draft appears or maxAttempts is exhausted.
 */
export async function draftScreenplay(
  prompt: string,
  options?: DraftScreenplayOptions,
): Promise<DraftedScreenplay> {
  if (!prompt.trim()) throw new Error("a director prompt cannot be empty");

  const generate = options?.generateScreenplay ?? defaultGenerateScreenplay;
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);

  let rejectionReason: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const screenplay = (await generate(prompt, rejectionReason)).trim();
    const issue = screenplayIssue(screenplay);
    if (!issue) return { screenplay, title: titleFromScreenplay(screenplay, prompt), attempts: attempt };
    rejectionReason = issue;
  }

  throw new Error(
    `the director could not produce a usable screenplay for "${prompt}" after ${maxAttempts} attempt(s): ${rejectionReason}`,
  );
}

export interface DirectorRequest extends Omit<ProductionRequest, "script" | "title"> {
  /** The user's raw idea; the only input the director strictly needs. */
  prompt: string;
  /** Overrides the title the screenplay drafts for itself. */
  title?: string;
  generateScreenplay?: GenerateScreenplayFn;
  maxAttempts?: number;
}

export interface DirectorResult extends ProductionResult {
  prompt: string;
  screenplay: string;
  draftAttempts: number;
}

/**
 * The auto-prompt path end to end: drafts a screenplay from the prompt, then produces it through
 * the real pipeline. Returns only once runProduction does, so a caller holding a DirectorResult
 * holds the same guarantees a hand-written screenplay's ProductionResult carries.
 */
export async function runDirector(
  request: DirectorRequest,
  onProgress?: ProgressHandler,
): Promise<DirectorResult> {
  const { prompt, generateScreenplay, maxAttempts, title: titleOverride, ...productionOptions } = request;

  const drafted = await draftScreenplay(prompt, { generateScreenplay, maxAttempts });
  const title = titleOverride?.trim() || drafted.title;

  const result = await runProduction({ ...productionOptions, script: drafted.screenplay, title }, onProgress);

  return { ...result, prompt, screenplay: drafted.screenplay, draftAttempts: drafted.attempts };
}
