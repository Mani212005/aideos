/**
 * File Description: Tests for the agent link: pairing, owner-only task delivery, connector polling,
 * disconnect, the design tools' file rules, and the connector's per-agent commands (each confined
 * to the aideos MCP tools).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentLinkStore, LINK_OFFLINE_AFTER_MS } from "./store";
import { remoteTaskPrompt } from "./prompt";
import { resolveFilmFile } from "../mcp/designTools";

// A store in a fresh temp file with a controllable clock.
function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-link-"));
  let t = 1_800_000_000_000;
  const s = new AgentLinkStore(path.join(dir, "link.json"), () => t);
  return { s, file: path.join(dir, "link.json"), advance: (ms: number) => (t += ms) };
}

const TASK = { id: "task-1", eventType: "design_film", filmId: "demo", prompt: "design it" };

test("AgentLink: a claimed code connects exactly one agent, and only the owner's tasks reach it", async () => {
  const { s } = store();
  const { ownerKey, code } = s.startPairing();
  assert.equal(s.status(ownerKey).connected, false);
  const claim = s.claim(code.toLowerCase(), "claude", "mani-mbp");
  assert.ok(claim);
  assert.equal(s.claim(code, "claude", "again"), null, "a code works once");

  assert.equal(await s.next(claim.token, 0), null, "first poll marks the connector online");
  const st = s.status(ownerKey);
  assert.deepEqual([st.connected, st.online, st.agentLabel, st.machine], [true, true, "Claude Code", "mani-mbp"]);

  assert.equal(s.enqueue(undefined, TASK), false, "a request without the owner key never reaches the agent");
  assert.equal(s.enqueue("x".repeat(43), TASK), false, "nor one with another key");
  assert.equal(s.enqueue(ownerKey, TASK), true);
  assert.equal((await s.next(claim.token, 0) as { id: string }).id, "task-1");
});

test("AgentLink: a held poll receives a task the moment it is queued", async () => {
  const { s } = store();
  const { ownerKey, code } = s.startPairing();
  const { token } = s.claim(code, "agy", "box")!;
  await s.next(token, 0);
  const waiting = s.next(token, 5000);
  assert.equal(s.enqueue(ownerKey, TASK), true);
  assert.equal(((await waiting) as { id: string }).id, "task-1");
});

test("AgentLink: expired codes, offline agents, disconnects and re-pairing", async () => {
  const { s, advance, file } = store();
  const first = s.startPairing();
  advance(11 * 60 * 1000);
  assert.equal(s.claim(first.code, "claude", "m"), null, "codes expire after 10 minutes");

  const { ownerKey, code } = s.startPairing(first.ownerKey);
  assert.equal(ownerKey, first.ownerKey, "a browser keeps its owner key across pairings");
  const { token } = s.claim(code, "claude", "m")!;
  await s.next(token, 0);
  advance(LINK_OFFLINE_AFTER_MS + 1);
  assert.equal(s.status(ownerKey).online, false);
  assert.equal(s.enqueue(ownerKey, TASK), false, "an offline agent is reported, not silently queued");

  const again = s.startPairing(ownerKey);
  const second = s.claim(again.code, "codex", "other")!;
  assert.equal(await s.next(token, 0), "unauthorized", "pairing again replaces the old connector");
  assert.equal(s.status(ownerKey).agentLabel, "Codex");

  assert.equal(s.disconnect(ownerKey), true);
  assert.equal(await s.next(second.token, 0), "unauthorized");
  const saved = fs.readFileSync(file, "utf8");
  assert.ok(!saved.includes(second.token) && !saved.includes(ownerKey), "secrets are stored hashed");
});

test("AgentLink: re-pairing names the replaced agent so both terminals can explain the takeover", async () => {
  const { s } = store();
  const { ownerKey, code } = s.startPairing();
  const first = s.claim(code, "agy", "mani-mbp")!;
  assert.equal(first.replaced, null, "first pairing replaces nothing");
  await s.next(first.token, 0);

  const again = s.startPairing(ownerKey);
  const second = s.claim(again.code, "opencode", "other-box")!;
  assert.deepEqual(second.replaced, { agent: "agy", agentLabel: "Antigravity", machine: "mani-mbp" });
  assert.equal(await s.next(first.token, 0), "unauthorized", "the replaced connector's next poll is rejected");

  const note = s.replacementNote(first.token)!;
  assert.equal(note.agent, "opencode");
  assert.equal(note.agentLabel, "OpenCode");
  assert.equal(note.machine, "other-box");
  assert.ok(note.at, "the takeover carries a timestamp");
  assert.equal(s.replacementNote(first.token), null, "the note is consumed on read");
  assert.equal(s.replacementNote(second.token), null, "the live token has no note");
  assert.equal(s.replacementNote("bogus"), null, "unknown tokens have no note");
});

test("AgentLink: remote prompts map shell steps onto the aideos tools", () => {
  const p = remoteTaskPrompt("t-9", "Run `aideos design build demo` until PASS.");
  assert.match(p, /aideos_design_build/);
  assert.match(p, /aideos_complete_task \(taskId "t-9"\)/);
  assert.match(p, /Run `aideos design build demo` until PASS\.$/);
});

test("AgentLink: design tools only touch a film's design spec and visuals", () => {
  const writable = /^(design\/design\.json|visuals\/[a-z0-9-]+\.svg)$/;
  assert.match(resolveFilmFile("speculative-decoding-designed", "design/design.json", writable), /videos\/speculative-decoding-designed\/design\/design\.json$/);
  assert.match(resolveFilmFile("speculative-decoding-designed", "./visuals/road-2.svg", writable), /visuals\/road-2\.svg$/);
  for (const bad of ["film.json", "../../package.json", "visuals/../film.json", "visuals/Road.svg", "design/base-film.json"]) {
    assert.throws(() => resolveFilmFile("speculative-decoding-designed", bad, writable), /not a file this tool may touch/, bad);
  }
  assert.throws(() => resolveFilmFile("../etc", "design/design.json", writable), /not a film id/);
  assert.throws(() => resolveFilmFile("no-such-film", "design/design.json", writable), /no film/);
});

test("AgentLink: --model overrides the run model for opencode and agy only", async () => {
  const { agentCommand, parseArgs, taskFailureHint } = await import("../../scripts/aideos-connect.mjs");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "connect-model-"));
  const opts = { url: "https://studio.example", token: "tok", scratch };

  assert.deepEqual(parseArgs(["CODE", "--agent", "opencode", "--model", "anthropic/claude-sonnet-4-5", "--url", "https://x"]).model, "anthropic/claude-sonnet-4-5");
  assert.equal(parseArgs(["CODE", "--url", "https://x"]).model, undefined);

  const ocDefault = agentCommand("opencode", "do it", opts);
  assert.ok(!ocDefault.args.includes("--model"), "no --model flag without an override");
  const oc = agentCommand("opencode", "do it", { ...opts, model: "anthropic/claude-sonnet-4-5" });
  assert.deepEqual(oc.args.slice(1, 3), ["--model", "anthropic/claude-sonnet-4-5"]);
  assert.equal(oc.args[oc.args.length - 1], "do it", "the prompt stays the last arg");

  const agyDefault = agentCommand("agy", "do it", opts);
  assert.ok(!agyDefault.args.includes("--model"));
  const agy = agentCommand("agy", "do it", { ...opts, model: "gemini-3-pro" });
  assert.ok(agy.args.includes("--model") && agy.args.includes("gemini-3-pro"));
  assert.ok(agy.args.includes("--sandbox"), "the sandbox confinement is kept with a model override");

  const claude = agentCommand("claude", "do it", { ...opts, model: "whatever" });
  assert.ok(!claude.args.includes("--model"), "agents without a model flag ignore the override");

  const refusal = "Error: Error from provider (Console): OpenCode's free tier can only be used from within OpenCode";
  const hint = taskFailureHint("opencode", refusal, undefined)!;
  assert.match(hint, /free-tier models only work inside/);
  assert.match(hint, /--model provider\/model/);
  assert.match(hint, /opencode models/);
  assert.match(taskFailureHint("agy", "free tier unavailable", "m")!, /--model provider\/model/);
  assert.equal(taskFailureHint("opencode", "some unrelated crash", undefined), null);
  assert.match(taskFailureHint("codex", "unauthorized: invalid api key", undefined)!, /credential problem/);
});

test("AgentLink: reconnecting updates the model but rejects mismatched agents without a code", async () => {
  const { updateConnection } = await import("../../scripts/aideos-connect.mjs");
  const conn = { token: "tok-1", agent: "claude" };
  const url = "https://studio.example";

  assert.throws(() => updateConnection(null, { url }), /no saved connection/);
  assert.throws(() => updateConnection(conn, { url, agent: "opencode" }), /paired as claude; to switch agents, pair again/);
  assert.throws(() => updateConnection(conn, { url, agent: "opencode", model: "anthropic/claude-sonnet-4-5" }), /paired as claude; to switch agents, pair again/);

  assert.deepEqual(updateConnection(conn, { url }), conn);
  assert.deepEqual(updateConnection(conn, { url, agent: "claude" }), conn);
  assert.deepEqual(updateConnection(conn, { url, model: "anthropic/claude-sonnet-4-5" }), { token: "tok-1", agent: "claude", model: "anthropic/claude-sonnet-4-5" });
  assert.deepEqual(updateConnection(conn, { url, agent: "claude", model: "anthropic/claude-sonnet-4-5" }), { token: "tok-1", agent: "claude", model: "anthropic/claude-sonnet-4-5" });
});

test("AgentLink: every agent command is confined to the aideos MCP tools", async () => {
  const { agentCommand } = await import("../../scripts/aideos-connect.mjs");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "connect-"));
  const opts = { url: "https://studio.example", token: "tok", scratch };

  const claude = agentCommand("claude", "do it", opts);
  assert.equal(claude.cmd, "claude");
  assert.deepEqual(claude.args.slice(claude.args.indexOf("--tools"), claude.args.indexOf("--tools") + 2), ["--tools", ""]);
  assert.ok(claude.args.includes("--strict-mcp-config"));
  const mcp = JSON.parse(fs.readFileSync(claude.args[claude.args.indexOf("--mcp-config") + 1], "utf8"));
  assert.equal(mcp.mcpServers.aideos.url, "https://studio.example/api/mcp");
  assert.equal(mcp.mcpServers.aideos.headers.Authorization, "Bearer tok");

  assert.ok(agentCommand("agy", "do it", opts).args.includes("--sandbox"));
  const codex = agentCommand("codex", "do it", opts);
  assert.deepEqual(codex.args.slice(codex.args.indexOf("--sandbox"), codex.args.indexOf("--sandbox") + 2), ["--sandbox", "read-only"]);
  assert.equal(codex.env.AIDEOS_LINK_TOKEN, "tok");
  const oc = agentCommand("opencode", "do it", opts);
  assert.deepEqual(JSON.parse(fs.readFileSync(oc.env.OPENCODE_CONFIG, "utf8")).permission, { edit: "deny", bash: "deny", webfetch: "deny" });
  assert.throws(() => agentCommand("gpt", "x", opts), /unknown agent/);
});
