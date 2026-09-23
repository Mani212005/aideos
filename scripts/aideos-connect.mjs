#!/usr/bin/env node
/**
 * File Description: `aideos connect` - links an Aideos studio (hosted or local) to the coding agent
 * in this terminal. It dials out to the studio, so no port is opened on this machine, and runs each
 * task the studio sends through the agent's own headless mode, so the owner's own agent
 * subscription does the work.
 *
 *   node aideos-connect.mjs <PAIRING-CODE> --agent claude|agy|codex|opencode --url <studio api url>
 *   node aideos-connect.mjs --url <studio api url>        (reconnect with the saved connection)
 *
 * The agent never gets a shell or this machine's files for a task: it runs in an empty scratch
 * folder and works only through the studio's aideos MCP tools (read the brief, write design.json
 * and SVGs, build, check). Dependency-free on purpose (Node 18+), so the studio can serve this one
 * file at /api/agent-link/connect.mjs.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AGENTS = ["claude", "agy", "codex", "opencode"];
const CONFIG_FILE = path.join(os.homedir(), ".config", "aideos", "connections.json");
const TASK_TIMEOUT_MS = 30 * 60 * 1000;

// Parses argv into a pairing code and flags.
function parseArgs(argv) {
  const out = { code: undefined, agent: undefined, url: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--agent") out.agent = argv[++i];
    else if (a === "--url") out.url = argv[++i];
    else if (a === "-h" || a === "--help") out.help = true;
    else if (!a.startsWith("-")) out.code = a;
  }
  return out;
}

// Reads saved connections (url -> { token, agent }).
function readConnections() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

// Saves a connection, readable only by this user.
function saveConnection(url, entry) {
  const all = readConnections();
  if (entry) all[url] = entry;
  else delete all[url];
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
}

// Prints a timestamped line.
function log(message) {
  console.log(`[aideos ${new Date().toLocaleTimeString()}] ${message}`);
}

// Waits.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Builds the command that runs one task through the chosen agent, confined to the aideos tools.
export function agentCommand(agent, prompt, { url, token, scratch }) {
  const mcpUrl = `${url}/api/mcp`;
  if (agent === "claude") {
    const config = path.join(scratch, "aideos-mcp.json");
    fs.writeFileSync(config, JSON.stringify({ mcpServers: { aideos: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } }), { mode: 0o600 });
    // No built-in tools at all; every aideos tool pre-approved; anything else is refused.
    return { cmd: "claude", args: ["-p", prompt, "--mcp-config", config, "--strict-mcp-config", "--tools", "", "--allowedTools", "mcp__aideos", "--permission-mode", "dontAsk"], env: {} };
  }
  if (agent === "agy") {
    // Antigravity keeps MCP servers in its own config; the connector registered "aideos" at startup.
    return { cmd: "agy", args: ["-p", prompt, "--sandbox", "--dangerously-skip-permissions"], env: {} };
  }
  if (agent === "codex") {
    return {
      cmd: "codex",
      args: ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "-c", `mcp_servers.aideos.url="${mcpUrl}"`, "-c", 'mcp_servers.aideos.bearer_token_env_var="AIDEOS_LINK_TOKEN"', prompt],
      env: { AIDEOS_LINK_TOKEN: token },
    };
  }
  if (agent === "opencode") {
    const config = path.join(scratch, "opencode.json");
    fs.writeFileSync(
      config,
      JSON.stringify({
        mcp: { aideos: { type: "remote", url: mcpUrl, headers: { Authorization: `Bearer ${token}` }, enabled: true } },
        permission: { edit: "deny", bash: "deny", webfetch: "deny" },
      }),
      { mode: 0o600 },
    );
    return { cmd: "opencode", args: ["run", "--dir", scratch, prompt], env: { OPENCODE_CONFIG: config } };
  }
  throw new Error(`unknown agent "${agent}"`);
}

// Registers the studio's MCP server with Antigravity (its MCP config is global, not per run).
async function registerAgyServer(url, token) {
  await run("agy", ["mcp", "add", "--header", `Authorization: Bearer ${token}`, "aideos", `${url}/api/mcp`], os.tmpdir(), {}, 60_000);
}

// Runs a command, streaming its output, and resolves with its exit code and output tail.
function run(cmd, args, cwd, env, timeoutMs) {
  return new Promise((resolve) => {
    let tail = "";
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    const keep = (chunk) => {
      const s = chunk.toString();
      process.stdout.write(s);
      tail = (tail + s).slice(-1500);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, tail: `${cmd} could not start: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, tail });
    });
  });
}

// Calls the studio API.
async function api(url, route, { method = "GET", token, body, timeoutMs = 40_000 } = {}) {
  const res = await fetch(`${url}${route}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, json };
}

// Runs one task and reports its outcome to the studio.
async function handleTask(task, conn, url) {
  log(`task ${task.id}: ${task.eventType} for ${task.filmId}`);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-task-"));
  try {
    const { cmd, args, env } = agentCommand(conn.agent, task.prompt, { url, token: conn.token, scratch });
    const { code, tail } = await run(cmd, args, scratch, env, TASK_TIMEOUT_MS);
    const ok = code === 0;
    log(`task ${task.id} ${ok ? "finished" : `failed (exit ${code})`}`);
    await api(url, "/api/agent-link/result", { method: "POST", token: conn.token, body: { taskId: task.id, ok, summary: tail.trim().split("\n").slice(-8).join("\n") } }).catch(() => {});
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// Pairs (when given a code) and then serves tasks until stopped.
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    console.log("usage: node aideos-connect.mjs <PAIRING-CODE> --agent claude|agy|codex|opencode --url <studio api url>");
    process.exit(args.help ? 0 : 1);
  }
  const url = args.url.replace(/\/$/, "");
  let conn = readConnections()[url];

  if (args.code) {
    const agent = args.agent ?? "claude";
    if (!AGENTS.includes(agent)) throw new Error(`--agent must be one of ${AGENTS.join(", ")}`);
    const claim = await api(url, "/api/agent-link/claim", { method: "POST", body: { code: args.code, agent, machine: os.hostname() } });
    if (claim.status !== 200) throw new Error(claim.json?.error ?? `pairing failed (HTTP ${claim.status})`);
    conn = { token: claim.json.token, agent };
    saveConnection(url, conn);
    log(`paired with ${url} as ${agent}`);
  }
  if (!conn) throw new Error(`no saved connection for ${url}; run with the pairing code shown by Connect agent in the studio`);
  if (conn.agent === "agy") await registerAgyServer(url, conn.token);

  log(`waiting for tasks from ${url} (Ctrl-C to stop)`);
  let backoff = 1000;
  for (;;) {
    let res;
    try {
      res = await api(url, "/api/agent-link/next", { token: conn.token });
      backoff = 1000;
    } catch (err) {
      log(`studio unreachable (${err.name === "TimeoutError" ? "timed out" : err.message}); retrying in ${Math.round(backoff / 1000)}s`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 30_000);
      continue;
    }
    if (res.status === 401) {
      saveConnection(url, null);
      throw new Error("the studio no longer knows this connection (disconnected, or the server was reset); pair again from Connect agent");
    }
    if (res.status === 200 && res.json?.id) await handleTask(res.json, conn, url);
    else if (res.status !== 204) {
      log(`unexpected reply (HTTP ${res.status}); retrying`);
      await sleep(5000);
    }
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  main().catch((err) => {
    console.error(`aideos connect: ${err.message}`);
    process.exit(1);
  });
}
