/**
 * File Description: Small helpers to tell an expected missing file apart from a real failure, and to name an error in a message.
 * Inputs and outputs: a caught value -> a boolean or a message string.
 * Used by: backend/agentBridge/contextBuilder.ts, backend/agentBridge/dispatcher.ts, backend/editPlanner/interpreter.ts, backend/editPlanner/provenanceLog.ts, backend/geminiReview/facts.ts, backend/geminiReview/geminiReview.ts.
 */

/** True when the caught value is a Node error for a path that does not exist (a missing file or a missing parent folder). */
export function isFileNotFound(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** The message of a caught value, whether it is an Error or anything else that was thrown. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
