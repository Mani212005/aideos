/**
 * File Description: Writes the inspectable all-check launch script and starts it in an unfocused
 * Herdr workspace, leaving the pane's shell available after the agent exits.
 * Inputs and outputs: process arguments -> spawned background allCheck process.
 * Used by: backend/allCheck/cli.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { buildAgentCommand } from "./agent";
import { allCheckDir, type AgentName } from "./types";
import { attachCommand, createWorkspace, herdrSocket, paneInfo, realHerdr, renameAgent, runInPane, shellQuote, type HerdrLocation, type HerdrRun } from "./herdr";

export { shellQuote } from "./herdr";

const REPO_ROOT = path.resolve(__dirname, "../..");

/** Variables the agent must see exactly as the caller does (accounts, videos folder, review model). */
const FORWARDED_ENV = [
  "HOME",
  "PATH",
  "AIDEOS_VIDEOS_DIR",
  "AIDEOS_CONFIG",
  "AIDEOS_GEMINI_REVIEW_MODEL",
  "GEMINI_MODEL",
  "AIDEOS_AGY_TIMEOUT",
  "CLAUDE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
];

// Writes the agent environment and command, followed by the measured-record finish fallback.
export function writeLaunchScript(slug: string, agent: AgentName, briefPath: string, model: string, env: NodeJS.ProcessEnv = process.env): string {
  const cmd = buildAgentCommand(agent, briefPath, slug, model);
  const scriptPath = path.join(allCheckDir(slug), "launch.sh");
  const script = [
    "#!/usr/bin/env bash",
    `# File Description: Starts the all-check ${agent} agent (${model}) for "${slug}" with its brief (written by aideos all-check).`,
    "# Inputs and outputs: saved brief and caller environment -> terminal agent and final result.",
    "# Used by: the all-check Herdr workspace root pane.",
    ...FORWARDED_ENV.map((key) => env[key] === undefined ? `unset ${key}` : `export ${key}=${shellQuote(env[key])}`),
    `cd ${shellQuote(REPO_ROOT)} || exit 1`,
    `${[cmd.command, ...cmd.args].map(shellQuote).join(" ")}`,
    `echo`,
    `# An agent that exits without finishing still gets a verdict: finish only reads the measured records.`,
    `[ -f ${shellQuote(path.join(allCheckDir(slug), "result.json"))} ] || npx tsx backend/cli.ts all-check finish ${shellQuote(slug)}`,
    `printf '%s\\n' ${shellQuote(`all-check agent exited. Result: ${allCheckDir(slug)}/result.json (this workspace stays open).`)}`,
    "",
  ].join("\n");
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

/** The recorded server location plus the launch's attach hint and advisory detection warning. */
export type LaunchedWorkspace = HerdrLocation & { attachCommand: string; warning?: string };

// Opens the agent's workspace and detects its terminal UI without making detection a launch gate.
export function launchAgentWorkspace(
  slug: string,
  scriptPath: string,
  opts: {
    agent: AgentName;
    env?: NodeJS.ProcessEnv;
    herdr?: HerdrRun;
    onCreated?: (location: HerdrLocation) => void;
    now?: () => number;
    pause?: (ms: number) => void;
  },
): LaunchedWorkspace {
  const run = opts.herdr ?? realHerdr;
  const now = opts.now ?? Date.now;
  const pause = opts.pause ?? ((ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); });
  let location = createWorkspace(slug, REPO_ROOT, herdrSocket(opts.env), run);
  opts.onCreated?.(location);
  runInPane(location, scriptPath, run);
  const deadline = now() + 60_000;
  for (;;) {
    const pane = paneInfo(location, run);
    if (pane?.agent === opts.agent) {
      location = renameAgent(location, `ac-${slug}`.slice(0, 32), run);
      return { ...location, attachCommand: attachCommand(location), ...(pane.agent_status === "blocked" ? { warning: `agent is waiting for input in Herdr pane ${location.paneId} (${attachCommand(location)})` } : {}) };
    }
    if (pane?.agent_status === "blocked" || now() >= deadline) {
      return { ...location, attachCommand: attachCommand(location), warning: `agent ${pane?.agent_status === "blocked" ? "is waiting for input" : "was not detected within 60 seconds"} in Herdr pane ${location.paneId} (${attachCommand(location)})` };
    }
    pause(500);
  }
}
