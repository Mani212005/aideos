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
import { AgentLinkStore, LINK_OFFLINE_AFTER_MS, LINK_PRESENCE_GRACE_MS } from "./store";
import { buildAgentInstructions } from "./connectInstructions";
import { linkPhase } from "../../editor/src/state/agentLink";
import { remoteTaskPrompt } from "./prompt";
import { resolveFilmFile } from "../mcp/designTools";

// A store in a fresh temp file with a controllable clock.
function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-link-"));
  let t = 1_800_000_000_000;
  const s = new AgentLinkStore(path.join(dir, "link.json"), () => t, { secret: SECRET });
  // A restarted server: same signing secret, but an empty filesystem (a free-plan container wipe).
  const restart = () => new AgentLinkStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agent-link-")), "link.json"), () => t, { secret: SECRET });
  return { s, restart, file: path.join(dir, "link.json"), advance: (ms: number) => (t += ms) };
}

const SECRET = "test-signing-secret-0123456789";
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
  assert.equal(s.replacementNote(first.token)!.machine, "other-box", "the note stays available to every poll of the old token");
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

test("AgentLink: a pairing survives a server restart that wipes the filesystem, and tasks flow again", async () => {
  const { s, restart } = store();
  const { ownerKey, code } = s.startPairing();
  const { token } = s.claim(code, "opencode", "mbp")!;
  await s.next(token, 0);

  const after = restart();
  assert.equal(after.status(ownerKey).connected, false, "the new process knows nothing yet");
  assert.notEqual(await after.next(token, 0), "unauthorized", "but the connector's token is still recognised");
  const st = after.status(ownerKey);
  assert.deepEqual([st.connected, st.online, st.agentLabel, st.machine], [true, true, "OpenCode", "mbp"]);
  assert.equal(after.enqueue(ownerKey, TASK), true);
  assert.equal(((await after.next(token, 0)) as { id: string }).id, "task-1");
});

test("AgentLink: a token signed with another secret is refused", async () => {
  const { s } = store();
  const { code } = s.startPairing();
  const { token } = s.claim(code, "claude", "m")!;
  const other = new AgentLinkStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agent-link-")), "l.json"), Date.now, { secret: "a-different-secret-0123456789" });
  assert.equal(await other.next(token, 0), "unauthorized");
  assert.equal(other.endReason(token), "unknown");
  assert.equal(await s.next(`${token}x`, 0), "unauthorized", "a tampered signature is refused");
});

test("AgentLink: the signed pairing code in the command claims once and outlives a restart", () => {
  const { s, restart } = store();
  const { pairingToken } = s.startPairing();
  const after = restart();
  const claim = after.claim(pairingToken, "codex", "box");
  assert.ok(claim, "the restarted server still honours the pairing code");
  assert.equal(after.claim(pairingToken, "codex", "box"), null, "and only once");
});

test("AgentLink: closing the studio tab ends the link after the grace period; a reload does not", async () => {
  const { s, advance } = store();
  const { ownerKey, code } = s.startPairing();
  const { token } = s.claim(code, "claude", "m")!;
  await s.next(token, 0);

  // A tab that keeps polling status stays linked for as long as it likes.
  for (let i = 0; i < 40; i++) {
    advance(30_000);
    s.status(ownerKey);
    assert.notEqual(await s.next(token, 0), "unauthorized");
  }
  // A reload or short network loss (well inside the grace) is nothing.
  advance(LINK_PRESENCE_GRACE_MS - 60_000);
  assert.notEqual(await s.next(token, 0), "unauthorized");
  s.status(ownerKey);

  // The tab is closed: no status polls for longer than the grace.
  advance(LINK_PRESENCE_GRACE_MS + 1000);
  assert.equal(await s.next(token, 0), "unauthorized");
  assert.equal(s.endReason(token), "tab-closed");
  assert.equal(s.status(ownerKey).connected, false);
});

test("AgentLink: a restarted server still ends the link when the tab is gone", async () => {
  const { s, restart, advance } = store();
  const { code } = s.startPairing();
  const { token } = s.claim(code, "claude", "m")!;
  const after = restart();
  assert.notEqual(await after.next(token, 0), "unauthorized");
  advance(LINK_PRESENCE_GRACE_MS + 1000);
  assert.equal(await after.next(token, 0), "unauthorized", "nobody heartbeats for this owner, so it ends");
  assert.equal(after.endReason(token), "tab-closed");
});

test("AgentLink: disconnect ends the link now, and the rotated owner key keeps it ended across a restart", async () => {
  const { s, restart, advance } = store();
  const { ownerKey, code } = s.startPairing();
  const { token } = s.claim(code, "claude", "m")!;
  await s.next(token, 0);
  assert.equal(s.disconnect(ownerKey), true);
  assert.equal(await s.next(token, 0), "unauthorized");
  assert.equal(s.endReason(token), "disconnected");

  // The browser rotates its key; the server then restarts and forgets the revocation.
  const rotatedKey = "r".repeat(43);
  const after = restart();
  after.status(rotatedKey);
  assert.equal(after.status(rotatedKey).connected, false, "the new key has no agent");
  assert.equal(after.enqueue(rotatedKey, TASK), false, "no task can reach the old agent through the new key");
  advance(LINK_PRESENCE_GRACE_MS + 1000);
  assert.equal(await after.next(token, 0), "unauthorized", "and the stale token dies once nobody speaks for its owner");
});

test("AgentLink: an agent linked from its own session works like a connector and is replaced by a newer link", async () => {
  const { s, restart } = store();
  const first = s.startAgentPairing(undefined, "claude");
  const { ownerKey } = first;
  assert.equal(s.status(ownerKey).connected, false, "a minted link is not a connection until the agent uses it");
  const waiting = s.next(first.token, 5000);
  assert.equal(s.status(ownerKey).mode, "agent");
  assert.equal(s.enqueue(ownerKey, TASK), true);
  assert.equal(((await waiting) as { id: string }).id, "task-1");
  assert.equal(s.status(ownerKey).busy, true, "an agent working on a task stays shown as online");

  assert.equal(s.report(first.token, { taskId: "task-1", ok: true, summary: "done" }), true);
  assert.equal(s.status(ownerKey).busy, false);
  assert.equal(s.status(ownerKey).lastResult?.summary, "done");

  const second = s.startAgentPairing(ownerKey, "codex");
  assert.equal(s.status(ownerKey).agentLabel, "Claude Code", "opening the dialog does not drop the working agent");
  assert.notEqual(await s.next(second.token, 0), "unauthorized");
  assert.equal(await s.next(first.token, 0), "unauthorized", "the newer link replaced the older");
  assert.equal(s.endReason(first.token), "replaced");
  assert.equal(s.replacementNote(first.token)?.agentLabel, "Codex");

  const after = restart();
  after.startAgentPairing(ownerKey, "claude");
  assert.notEqual(await after.next(second.token, 0), "unauthorized", "an agent link survives a restart too");
});

test("AgentLink: tool calls become activity lines the connector and studio show", async () => {
  const { s } = store();
  const { ownerKey, code } = s.startPairing();
  const { token } = s.claim(code, "claude", "m")!;
  s.recordActivity(token, "write_file design/design.json");
  s.recordActivity(token, "design_build demo");
  assert.deepEqual(s.activity(token, 0)!.map((a) => a.text), ["write_file design/design.json", "design_build demo"]);
  const seq = s.activity(token, 0)![0].seq;
  assert.equal(s.activity(token, seq)!.length, 1, "only lines after the cursor");
  assert.equal(s.status(ownerKey).activity?.length, 2);
  assert.equal(s.activity("bogus", 0), null);
});

test("AgentLink: the connector turns retries into calm single lines", async () => {
  const { createReconnectNotes, indentAgentOutput, formatElapsed } = await import("../../scripts/aideos-connect.mjs");
  let t = 0;
  const lines: string[] = [];
  const notes = createReconnectNotes((m: string) => lines.push(m), () => t);
  for (let i = 0; i < 30; i++) {
    t += 3000;
    notes.failed();
  }
  assert.equal(lines.length, 1, "a minute and a half of failures is one line, not thirty");
  assert.match(lines[0], /reconnecting quietly/);
  t += 6 * 60_000;
  notes.failed();
  assert.equal(lines.length, 2);
  assert.match(lines[1], /still reconnecting/);
  notes.ok();
  assert.equal(lines.length, 3);
  assert.match(lines[2], /reconnected after/);
  notes.ok();
  assert.equal(lines.length, 3, "a healthy poll says nothing");
  assert.equal(indentAgentOutput("a\nb\n"), "    | a\n    | b\n");
  assert.equal(formatElapsed(65_000), "1m 05s");
});

test("AgentLink: the studio shows the agent-native commands for every agent", () => {
  for (const agent of ["claude", "agy", "codex", "opencode"] as const) {
    const i = buildAgentInstructions(agent, "https://studio.example", "TOK");
    assert.match(i.addCommand, /https:\/\/studio\.example\/api\/mcp/);
    assert.match(i.addCommand, /TOK/);
    assert.match(i.prompt, /aideos_wait_for_task/);
  }
  assert.match(buildAgentInstructions("claude", "https://s", "T").addCommand, /^claude mcp add --transport http aideos /);
});

test("AgentLink: the badge says reconnecting after a server restart, and none once the studio no longer knows the link", () => {
  const expected = { agentLabel: "OpenCode", machine: "mbp", lastOnline: 100_000 };
  const up = (startedAt: number, extra = {}) => ({ connected: false, online: false, startedAt: new Date(startedAt).toISOString(), ...extra });
  assert.equal(linkPhase(up(200_000), expected), "reconnecting", "server started after the agent was last seen: it lost the table");
  assert.equal(linkPhase(up(50_000), expected), "none", "server was up the whole time and does not know it: ended");
  assert.equal(linkPhase(null, expected), "reconnecting", "studio unreachable: keep the link shown");
  assert.equal(linkPhase(up(200_000, { connected: true, online: true }), expected), "online");
  assert.equal(linkPhase(up(200_000, { connected: true }), expected), "offline");
  assert.equal(linkPhase(up(200_000), null), "none");
});
