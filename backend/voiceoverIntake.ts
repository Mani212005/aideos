/**
 * File Description: Pure intake response mapping for Studio voiceover requests.
 * Inputs and outputs: script text -> intake notices or a client error response.
 * Used by: editor/vite.config.ts voiceover route and screenplay intake behavior tests.
 */

import { assertScriptReadyForSynthesis } from "./scriptIntake";

/** Checks a Studio voiceover script and returns the route's user-facing intake result. */
export function checkVoiceoverIntake(script: string):
  | { ok: true; intakeNotices: string[] }
  | { ok: false; status: 400; error: string; intakeNotices: string[] } {
  const intakeNotices: string[] = [];
  try {
    assertScriptReadyForSynthesis(script, (issue) => intakeNotices.push(issue.message));
    return { ok: true, intakeNotices };
  } catch (error) {
    return {
      ok: false,
      status: 400,
      error: error instanceof Error ? error.message : String(error),
      intakeNotices,
    };
  }
}
