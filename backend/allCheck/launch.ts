/**
 * File Description: Starts the all-check background agent in its own tmux window: writes an
 * inspectable launch script next to the brief, opens the window (in the current tmux session, in an
 * existing "aideos" session, or in a new detached one), and leaves the window open after the agent
 * exits so the user can watch or step in. Environment that decides which account and videos folder
 * the agent sees is passed with `tmux -e`, because a window inherits the tmux server's environment,
 * not the caller's. tmux itself is injectable so tests never open a window.
 * Inputs and outputs: process arguments -> spawned background allCheck process.
 * Used by: backend/allCheck/cli.ts.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildAgentCommand } from "./agent";
import { allCheckDir, AllCheckError, type AgentName } from "./types";

const REPO_ROOT = path.resolve(__dirname, "../..");

/** Variables the agent window must see exactly as the caller does (accounts, videos folder, review model). */
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

/** Runs tmux (or a stand-in) and returns what it printed. */
export type TmuxRun = (args: string[]) => { status: number | null; stdout: string; stderr: string };

// The real tmux, never throwing.
export const realTmux: TmuxRun = (args) => {
  const r = spawnSync("tmux", args, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? r.error?.message ?? "" };
};

// Whether a tmux window id still exists on the server.
export function tmuxWindowAlive(windowId: string, tmux: TmuxRun = realTmux): boolean {
  const r = tmux(["display-message", "-p", "-t", windowId, "#{window_id}"]);
  return r.status === 0 && r.stdout.trim() === windowId;
}

// Quotes a value for a bash command line.
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Writes the script the tmux window runs: the agent command, then a shell that keeps the window open.
export function writeLaunchScript(slug: string, agent: AgentName, briefPath: string, model: string): string {
  const cmd = buildAgentCommand(agent, briefPath, slug, model);
  const scriptPath = path.join(allCheckDir(slug), "launch.sh");
  const script = [
    "#!/usr/bin/env bash",
    `# File Description: Starts the all-check ${agent} agent (${model}) for "${slug}" with its brief (written by aideos all-check).`,
    `cd ${shellQuote(REPO_ROOT)}`,
    `${[cmd.command, ...cmd.args].map(shellQuote).join(" ")}`,
    `echo`,
    `# An agent that exits without finishing still gets a verdict: finish only reads the measured records.`,
    `[ -f ${shellQuote(path.join(allCheckDir(slug), "result.json"))} ] || npx tsx backend/cli.ts all-check finish ${shellQuote(slug)}`,
    `echo "all-check agent exited. Result: ${allCheckDir(slug)}/result.json (this window stays open)."`,
    `exec "\${SHELL:-bash}"`,
    "",
  ].join("\n");
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });
  return scriptPath;
}

/** Where the agent window ended up. */
export interface LaunchedWindow {
  windowId: string;
  session: string;
  attachCommand: string;
}

// Opens the agent's tmux window and returns where it is.
export function launchAgentWindow(
  slug: string,
  scriptPath: string,
  opts: { env?: NodeJS.ProcessEnv; tmux?: TmuxRun } = {},
): LaunchedWindow {
  const env = opts.env ?? process.env;
  const tmux = opts.tmux ?? realTmux;
  const name = `all-check-${slug}`.slice(0, 40);
  const envArgs = FORWARDED_ENV.flatMap((key) => (env[key] ? ["-e", `${key}=${env[key]}`] : []));
  const command = `bash ${shellQuote(scriptPath)}`;
  const format = "#{window_id} #{session_name}";

  let result;
  if (env.TMUX) {
    result = tmux(["new-window", "-d", "-P", "-F", format, "-n", name, "-c", REPO_ROOT, ...envArgs, command]);
  } else if (tmux(["has-session", "-t", "aideos"]).status === 0) {
    result = tmux(["new-window", "-d", "-P", "-F", format, "-t", "aideos:", "-n", name, "-c", REPO_ROOT, ...envArgs, command]);
  } else {
    result = tmux(["new-session", "-d", "-P", "-F", format, "-s", "aideos", "-n", name, "-c", REPO_ROOT, ...envArgs, command]);
  }
  const [windowId, session] = result.stdout.trim().split(" ");
  if (result.status !== 0 || !windowId || !session) {
    throw new AllCheckError(`could not open the tmux window for the agent: ${result.stderr.trim() || "tmux returned nothing"}`);
  }
  return { windowId, session, attachCommand: `tmux attach -t ${session}` };
}
