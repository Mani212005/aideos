/**
 * File Description: Types for scripts/aideos-connect.mjs, the dependency-free connector (so its
 * command builder can be tested from TypeScript).
 */

/** Builds the command that runs one task through the chosen agent, confined to the aideos tools. */
export function agentCommand(
  agent: string,
  prompt: string,
  opts: { url: string; token: string; scratch: string },
): { cmd: string; args: string[]; env: Record<string, string> };
