/**
 * File Description: Entry point and public exports for the Gemini 3.8 Flash video review subsystem.
 * Inputs and outputs: review modules -> barrel export of geminiReview, rubric, and types.
 * Used by: backend/allCheck/round.ts.
 */

export * from "./types";
export * from "./rubric";
export * from "./geminiReview";
export * from "./render";
export * from "./facts";
