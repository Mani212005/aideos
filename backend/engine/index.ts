/**
 * File Description: Engine registry for Aideos. Maps an engine name to a
 * VideoEngine instance so callers (CLI, future pipeline stages) never import
 * concrete adapters directly.
 */
import { NullEngine } from "./nullEngine";
import { SshWanGPEngine } from "./sshWanGPEngine";
import type { VideoEngine } from "./types";

/** Build an engine by name; unknown names throw with the valid list. */
export function createEngine(name: string): VideoEngine {
  switch (name) {
    case "null":
      return new NullEngine();
    case "ssh-wangp":
      return new SshWanGPEngine();
    default:
      throw new Error(`unknown engine "${name}"; valid engines: null, ssh-wangp`);
  }
}

export type { VideoEngine, VideoJobSpec, VideoJobHandle, VideoJobStatus } from "./types";
