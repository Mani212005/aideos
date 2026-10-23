/**
 * File Description: Validated Herdr CLI boundary for all-check workspace ownership and process truth.
 * Inputs and outputs: CLI arguments and a recorded socket -> typed workspace, pane and process state.
 * Used by: all-check launch, preflight, lock liveness and idle watchdog.
 */

import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { AllCheckError } from "./types";

/** Runs Herdr against exactly one server, without opening a window in tests. */
export type HerdrRun = (args: string[], env: { HERDR_SOCKET_PATH: string }) => { status: number | null; stdout: string; stderr: string };

export const herdrLocationSchema = z.object({
  socketPath: z.string().min(1),
  workspaceId: z.string().min(1),
  paneId: z.string().min(1),
  agentName: z.string().nullable(),
});
export type HerdrLocation = z.infer<typeof herdrLocationSchema>;

const paneSchema = z.object({
  pane_id: z.string(),
  workspace_id: z.string(),
  agent: z.string().optional(),
  agent_status: z.enum(["idle", "working", "blocked", "done", "unknown"]),
});
export type AgentStatus = z.infer<typeof paneSchema>["agent_status"];
const processSchema = z.object({
  pane_id: z.string(),
  shell_pid: z.number().int().positive(),
  foreground_process_group_id: z.number().int().positive().nullable(),
});

class HerdrCommandError extends AllCheckError {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

// Extracts a structured Herdr error code without replacing its CLI message.
function herdrErrorCode(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown } };
    return typeof parsed.error?.code === "string" ? parsed.error.code : undefined;
  } catch {
    return undefined;
  }
}

// Identifies Herdr's explicit response for a pane that is no longer available.
function isMissingPane(error: unknown): boolean {
  return error instanceof HerdrCommandError && error.code === "pane_not_found";
}

// Runs a bounded CLI call, removing ambient session selection in favor of the recorded socket.
export const realHerdr: HerdrRun = (args, target) => {
  const env: NodeJS.ProcessEnv = { ...process.env, ...target };
  delete env.HERDR_SESSION;
  const r = spawnSync("herdr", args, { env, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr || r.error?.message || "" };
};

// Uses the caller's server only inside Herdr; a plain terminal addresses the default session.
export function herdrSocket(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HERDR_ENV === "1" && env.HERDR_SOCKET_PATH) return env.HERDR_SOCKET_PATH;
  return path.join(env.HOME || os.homedir(), ".config", "herdr", "herdr.sock");
}

// Quotes an arbitrary value for the launch shell or a paste-ready attach command.
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Includes the server in every attach hint because pane ids and agent names are server-local.
export function attachCommand(location: HerdrLocation): string {
  return `env -u HERDR_SESSION HERDR_SOCKET_PATH=${shellQuote(location.socketPath)} herdr agent attach ${shellQuote(location.agentName ?? location.paneId)}`;
}

// Parses structured responses once at the CLI boundary and retains actionable raw errors.
export function herdrJson<T>(run: HerdrRun, socketPath: string, args: string[], schema: z.ZodType<T>): T {
  const response = run(args, { HERDR_SOCKET_PATH: socketPath });
  if (response.status !== 0) {
    const detail = response.stderr.trim() || response.stdout.trim() || "Herdr did not answer";
    throw new HerdrCommandError(`herdr ${args.slice(0, 2).join(" ")}: ${detail}`, herdrErrorCode(response.stderr.trim() || response.stdout.trim()));
  }
  try {
    return schema.parse(JSON.parse(response.stdout));
  } catch (error) {
    throw new AllCheckError(`herdr ${args.slice(0, 2).join(" ")}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Creates only an unfocused, explicitly labeled all-check workspace.
export function createWorkspace(slug: string, cwd: string, socketPath: string, run: HerdrRun): HerdrLocation {
  const { result } = herdrJson(run, socketPath, ["workspace", "create", "--cwd", cwd, "--label", `all-check: ${slug}`, "--no-focus"], z.object({
    result: z.object({ workspace: z.object({ workspace_id: z.string() }), root_pane: z.object({ pane_id: z.string() }) }),
  }));
  return { socketPath, workspaceId: result.workspace.workspace_id, paneId: result.root_pane.pane_id, agentName: null };
}

// Sends one quoted command atomically to the workspace's fresh shell.
export function runInPane(location: HerdrLocation, scriptPath: string, run: HerdrRun): void {
  const response = run(["pane", "run", location.paneId, `bash ${shellQuote(scriptPath)}`], { HERDR_SOCKET_PATH: location.socketPath });
  if (response.status !== 0) throw new AllCheckError(`herdr pane run: ${response.stderr.trim() || response.stdout.trim() || "Herdr did not answer"}`);
}

// Reads a pane's detected agent and status on its recorded server.
export function paneInfo(location: HerdrLocation, run: HerdrRun = realHerdr): z.infer<typeof paneSchema> | null {
  try {
    const { result } = herdrJson(run, location.socketPath, ["pane", "get", location.paneId], z.object({ result: z.object({ pane: paneSchema }) }));
    if (result.pane.pane_id !== location.paneId || result.pane.workspace_id !== location.workspaceId) {
      throw new AllCheckError(`herdr pane get returned a different pane than ${location.paneId}`);
    }
    return result.pane;
  } catch (error) {
    if (isMissingPane(error)) return null;
    throw error;
  }
}

// Reads process truth rather than trusting a restored pane's saved agent badge.
export function processInfo(location: HerdrLocation, run: HerdrRun = realHerdr): z.infer<typeof processSchema> | null {
  try {
    const info = herdrJson(run, location.socketPath, ["pane", "process-info", "--pane", location.paneId], z.object({ result: z.object({ process_info: processSchema }) })).result.process_info;
    if (info.pane_id !== location.paneId) throw new AllCheckError(`herdr process-info returned a different pane than ${location.paneId}`);
    return info;
  } catch (error) {
    if (isMissingPane(error)) return null;
    throw error;
  }
}

// A live run must have both its pane and a foreground process other than its interactive shell.
export function paneLive(location: HerdrLocation, run: HerdrRun = realHerdr): boolean {
  try {
    if (!paneInfo(location, run)) return false;
    const info = processInfo(location, run);
    return !!info && info.foreground_process_group_id !== null && info.foreground_process_group_id !== info.shell_pid;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AllCheckError(`cannot confirm all-check liveness for Herdr pane ${location.paneId}: ${detail}. The existing lock is preserved; retry when Herdr responds.`);
  }
}

// Reads plain terminal text; pane read deliberately has no JSON envelope.
export function readPane(location: HerdrLocation, run: HerdrRun = realHerdr): string | null {
  const response = run(["pane", "read", location.paneId, "--source", "visible"], { HERDR_SOCKET_PATH: location.socketPath });
  return response.status === 0 ? response.stdout : null;
}

// Names a detected agent, keeping a pane-based attach hint if a live name already exists.
export function renameAgent(location: HerdrLocation, name: string, run: HerdrRun): HerdrLocation {
  try {
    herdrJson(run, location.socketPath, ["agent", "rename", location.paneId, name], z.object({ result: z.unknown() }));
    return { ...location, agentName: name };
  } catch {
    return location;
  }
}

// Closes a previously recorded workspace only when every pane is provably at an idle shell.
export function closeIdleWorkspace(location: HerdrLocation, run: HerdrRun): boolean {
  try {
    const { result } = herdrJson(run, location.socketPath, ["pane", "list", "--workspace", location.workspaceId], z.object({ result: z.object({ panes: z.array(paneSchema) }) }));
    if (!result.panes.some((pane) => pane.pane_id === location.paneId)) return false;
    for (const pane of result.panes) {
      if (pane.workspace_id !== location.workspaceId) return false;
      const info = processInfo({ ...location, paneId: pane.pane_id }, run);
      if (!info || info.foreground_process_group_id !== info.shell_pid) return false;
    }
    herdrJson(run, location.socketPath, ["workspace", "close", location.workspaceId], z.object({ result: z.unknown() }));
    return true;
  } catch {
    return false;
  }
}
