/**
 * File Description: Leaf types for how a design or reel cut is delivered: the model caller and the reel mode.
 * Inputs and outputs: None -> typed delivery contracts.
 * Used by: backend/pipeline/types.ts, backend/designSpec/designer.ts, backend/designSpec/motionRequests.ts, backend/reelCut/writer.ts.
 */

/** Asks a text model for a completion; injectable so tests never reach a real model. */
export type DesignLlmCaller = (prompt: string, systemInstruction: string) => Promise<string>;

/** How a reel cut is delivered: inline, to a connected agent, or through the generation model. */
export type ReelDeliveryMode = "inline" | "agent" | "server";
