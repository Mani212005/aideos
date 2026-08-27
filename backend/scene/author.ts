/**
 * File Description: LLM Scene Authoring and Revision Engine (Phase 5).
 * Implements 3-attempt validation retry loop, JSON extraction, and critique-driven PatchOp revision.
 */

import type { Scene } from "../../src/dl/scene/types";
import { validateScene } from "../../src/dl/scene/validateScene";
import { applyPatch, type PatchOp } from "../../src/dl/scene/patch";
import { buildSceneAuthoringPrompt, buildSceneRevisionPrompt, type ScenePromptContext } from "./prompt";

export const MAX_AUTHOR_ATTEMPTS = 3;

/** Cleans and parses raw JSON string from LLM responses (stripping markdown codeblocks). */
export function extractJsonFromResponse<T>(text: string): T {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  return JSON.parse(cleaned) as T;
}

/**
 * Authors a complete valid Scene graph from natural language description with a 3-attempt validation retry loop.
 * @param userDescription Scene description prompt.
 * @param ctx Audio and canvas specifications.
 * @param llmCaller Async LLM invoker function returning text.
 * @returns Validated Scene object.
 */
export async function authorScene(
  userDescription: string,
  ctx: ScenePromptContext,
  llmCaller: (prompt: string) => Promise<string>,
): Promise<Scene> {
  let currentPrompt = buildSceneAuthoringPrompt(userDescription, ctx);
  const accumulatedErrors: string[] = [];

  for (let attempt = 1; attempt <= MAX_AUTHOR_ATTEMPTS; attempt++) {
    try {
      const responseText = await llmCaller(currentPrompt);
      const scene = extractJsonFromResponse<Scene>(responseText);

      // Validate scene against all 18 rules
      const validation = validateScene(scene);
      if (validation.isValid) {
        return scene;
      }

      // Collect validation errors for retry
      const errDetails = validation.errors.map((e) => `[Rule ${e.rule}] ${e.message}`).join("\n");
      accumulatedErrors.push(`Attempt ${attempt} validation failed:\n${errDetails}`);

      // Augment prompt with specific error feedback for next retry
      currentPrompt = `${buildSceneAuthoringPrompt(userDescription, ctx)}

---
### PREVIOUS ATTEMPT FAILED WITH VALIDATION ERRORS (Attempt ${attempt}/${MAX_AUTHOR_ATTEMPTS}):
${errDetails}

Please fix these exact errors and output the corrected Scene JSON.`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      accumulatedErrors.push(`Attempt ${attempt} parse/execution failed: ${msg}`);
      currentPrompt = `${buildSceneAuthoringPrompt(userDescription, ctx)}

---
### PREVIOUS ATTEMPT JSON PARSE FAILED (Attempt ${attempt}/${MAX_AUTHOR_ATTEMPTS}):
${msg}

Please emit strictly valid, parseable JSON.`;
    }
  }

  throw new Error(
    `SCENE_AUTHORING_FAILED: Failed to produce a valid Scene after ${MAX_AUTHOR_ATTEMPTS} attempts.\nAccumulated Errors:\n${accumulatedErrors.join("\n\n")}`,
  );
}

/**
 * Revises an existing Scene with a user critique by prompting the LLM for PatchOp[] and applying them immutably.
 * @param currentScene Original scene.
 * @param critique Natural language critique.
 * @param llmCaller Async LLM invoker returning PatchOp[] JSON.
 * @returns Resulting scene and applied patch ops.
 */
export async function reviseScene(
  currentScene: Scene,
  critique: string,
  llmCaller: (prompt: string) => Promise<string>,
): Promise<{ scene: Scene; appliedOps: PatchOp[]; warnings: string[] }> {
  const prompt = buildSceneRevisionPrompt(currentScene, critique);
  const responseText = await llmCaller(prompt);
  const patchOps = extractJsonFromResponse<PatchOp[]>(responseText);

  if (!Array.isArray(patchOps)) {
    throw new Error(`REVISION_FAILED: LLM response did not emit a valid PatchOp[] array.`);
  }

  const patchResult = applyPatch(currentScene, patchOps);
  if (patchResult.applied.length === 0 && patchResult.rejected.length > 0) {
    const reasons = patchResult.rejected.map((r) => r.reason).join("; ");
    throw new Error(`REVISION_PATCH_REJECTED: All patch operations failed or were rolled back: ${reasons}`);
  }

  return {
    scene: patchResult.scene,
    appliedOps: patchResult.applied,
    warnings: patchResult.warnings,
  };
}
