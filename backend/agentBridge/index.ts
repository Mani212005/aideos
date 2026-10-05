/**
 * File Description: Authoritative entry point and facade for the Aideos Agent Bridge Hub.
 * Inputs and outputs: bridge configuration and task definitions -> initialized agent bridge instance and dispatch queue.
 * Used by: backend/pipeline/run.ts, backend/mcp/server.ts, editor/vite.config.ts.
 */

export * from "./types";
export * from "./taskQueue";
export * from "./contextBuilder";
export * from "./dispatcher";
export * from "./traceBus";
