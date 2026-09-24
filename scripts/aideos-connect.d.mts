/**
 * File Description: Types for scripts/aideos-connect.mjs, the dependency-free connector (so its
 * command builder can be tested from TypeScript).
 */

/** Parses connector argv into a pairing code and flags. */
export function parseArgs(argv: string[]): { code?: string; agent?: string; url?: string; model?: string; help?: boolean };

/** Connection entry stored per studio URL. */
export interface SavedConnection {
  token: string;
  agent: string;
  model?: string;
}

/** Updates or validates a saved connection when reconnecting without a pairing code. */
export function updateConnection(
  conn: SavedConnection | undefined | null,
  args: { url: string; agent?: string; model?: string },
): SavedConnection;

/** Builds the command that runs one task through the chosen agent, confined to the aideos tools. */
export function agentCommand(
  agent: string,
  prompt: string,
  opts: { url: string; token: string; scratch: string; model?: string },
): { cmd: string; args: string[]; env: Record<string, string> };

/** Explains a provider/model refusal in actionable terms, or null when the tail shows no known cause. */
export function taskFailureHint(agent: string, tail: string, model?: string): string | null;
