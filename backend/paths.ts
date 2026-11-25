/**
 * File Description: Shared repository and caller working-directory paths for Node entry points.
 * Inputs and outputs: Module location and process working directory -> absolute paths.
 * Used by: backend, scripts and the Studio server.
 */

import path from "node:path";
export { DEFAULT_FPS, DEFAULT_STUDIO_PORT } from "../src/dl/defaults";

/** The repository containing this module, independent of the launch directory. */
export const REPO_ROOT = path.resolve(__dirname, "..");

// Returns the current caller directory for explicitly caller-relative inputs and output messages.
export function callerWorkingDirectory(): string {
  return process.cwd();
}
