/**
 * File Description: Model-free, window-free Herdr boundary tests using responses captured in the lab.
 * Inputs and outputs: captured CLI JSON and injected process state -> launch and lifecycle assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { z } from "zod";
import { attachCommand, closeIdleWorkspace, createWorkspace, herdrSocket, paneLive, readPane, runInPane, shellQuote, type HerdrLocation, type HerdrRun } from "./herdr";
import { launchAgentWorkspace } from "./launch";
import { roundProcessPattern } from "./index";

const fixtures = z.record(z.string(), z.unknown()).parse(JSON.parse(fs.readFileSync(path.join(__dirname, "herdr-fixtures.json"), "utf8")));
const location: HerdrLocation = { socketPath: "/recorded/herdr.sock", workspaceId: "w1", paneId: "w1:p1", agentName: null };

// Wraps a captured or constructed response in the injected CLI result.
function ok(value: unknown): ReturnType<HerdrRun> {
  return { status: 0, stdout: JSON.stringify(value), stderr: "" };
}

// Supplies only lab responses and captures all server selections and commands.
function fakeHerdr(over: { status?: string; agent?: string; renameFails?: boolean; process?: "idle" | "active" | "missing" } = {}): { run: HerdrRun; calls: { args: string[]; socket: string }[] } {
  const calls: { args: string[]; socket: string }[] = [];
  const run: HerdrRun = (args, env) => {
    calls.push({ args, socket: env.HERDR_SOCKET_PATH });
    if (args[0] === "workspace" && args[1] === "create") return ok(fixtures.create);
    if (args[0] === "pane" && args[1] === "run") return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "pane" && args[1] === "get") {
      if (over.process === "missing") return { status: 1, stdout: "", stderr: JSON.stringify(fixtures.missing) };
      return ok({ result: { pane: { pane_id: "w1:p1", workspace_id: "w1", agent: over.agent ?? "claude", agent_status: over.status ?? "idle" } } });
    }
    if (args[1] === "process-info") return ok(fixtures[over.process ?? "active"]);
    if (args[1] === "read") return { status: 0, stdout: "plain terminal text", stderr: "" };
    if (args[0] === "agent" && over.renameFails) return { status: 1, stdout: "", stderr: '{"error":{"code":"agent_name_in_use"}}' };
    if (args[1] === "list") return ok({ result: { panes: [{ pane_id: "w1:p1", workspace_id: "w1", agent_status: "unknown" }] } });
    return ok({ result: {} });
  };
  return { run, calls };
}

test("Herdr: inside selects the caller socket, outside selects the default even with ambient session variables", () => {
  assert.equal(herdrSocket({ HOME: "/home/lab", HERDR_ENV: "1", HERDR_SOCKET_PATH: "/named/sock" }), "/named/sock");
  assert.equal(herdrSocket({ HOME: "/home/lab", HERDR_SOCKET_PATH: "/stale/sock", HERDR_SESSION: "other" }), "/home/lab/.config/herdr/herdr.sock");
  assert.match(attachCommand(location), /HERDR_SOCKET_PATH='\/recorded\/herdr.sock'/);
  assert.match(attachCommand(location), /herdr agent attach 'w1:p1'/);
});

test("Herdr: captured workspace JSON yields its own pane; run quotes hostile paths as one command", () => {
  const { run, calls } = fakeHerdr();
  assert.deepEqual(createWorkspace("film", "/repo", location.socketPath, run), location);
  assert.deepEqual(calls[0].args, ["workspace", "create", "--cwd", "/repo", "--label", "all-check: film", "--no-focus"]);
  const hostile = "/tmp/it's $(touch should-not-exist) `echo nope`.sh";
  runInPane(location, hostile, run);
  assert.deepEqual(calls[1].args, ["pane", "run", "w1:p1", `bash ${shellQuote(hostile)}`]);
  const quoted = spawnSync("bash", ["-c", `printf '%s' ${shellQuote(hostile)}`], { encoding: "utf8" });
  assert.equal(quoted.status, 0);
  assert.equal(quoted.stdout, hostile);
  assert.ok(calls.every((call) => call.socket === location.socketPath));
});

test("Herdr: launch records ownership before typing, detects the agent, and truncates its unique name", () => {
  const { run, calls } = fakeHerdr();
  let recorded = false;
  const workspace = launchAgentWorkspace("a".repeat(60), "/lab/launch.sh", {
    agent: "claude", herdr: run, env: { HERDR_ENV: "1", HERDR_SOCKET_PATH: location.socketPath },
    onCreated: (created) => { recorded = true; assert.deepEqual(created, location); assert.equal(calls.length, 1); },
  });
  assert.equal(recorded, true);
  assert.equal(workspace.agentName, `ac-${"a".repeat(29)}`);
  assert.equal(workspace.warning, undefined);
  assert.ok(calls.every((call) => call.socket === location.socketPath));
});

test("Herdr: blocked detection is immediate, timeout is advisory, and a name clash uses the pane", () => {
  for (const mode of ["blocked", "timeout", "clash"]) {
    const { run } = fakeHerdr({ status: mode === "blocked" ? "blocked" : "unknown", agent: mode === "timeout" ? "other" : "agy", renameFails: mode === "clash" });
    let clock = 0;
    const workspace = launchAgentWorkspace("film", "/lab/launch.sh", {
      agent: "agy", herdr: run, now: () => clock, pause: (ms) => { clock += ms; },
      env: { HERDR_ENV: "1", HERDR_SOCKET_PATH: location.socketPath },
    });
    if (mode === "blocked") { assert.match(workspace.warning ?? "", /waiting for input/); assert.equal(clock, 0); }
    if (mode === "timeout") { assert.match(workspace.warning ?? "", /not detected within 60 seconds/); assert.equal(clock, 60_000); }
    if (mode === "clash") { assert.equal(workspace.agentName, null); assert.match(workspace.attachCommand, /'w1:p1'$/); }
  }
});

test("Herdr: malformed create and server errors retain the actual CLI reason", () => {
  assert.throws(() => createWorkspace("film", "/repo", location.socketPath, () => ok({})), /herdr workspace create/);
  assert.throws(() => createWorkspace("film", "/repo", location.socketPath, () => ({ status: 1, stdout: "", stderr: '{"error":{"code":"server_not_running"}}' })), /server_not_running/);
});

test("Herdr: process truth distinguishes the running script from an idle or missing pane on the recorded server", () => {
  for (const process of ["active", "idle", "missing"] as const) {
    const { run, calls } = fakeHerdr({ process });
    assert.equal(paneLive(location, run), process === "active");
    assert.ok(calls.every((call) => call.socket === location.socketPath));
    assert.ok(calls.filter((call) => call.args[1] === "process-info").every((call) => call.args[2] === "--pane"));
  }
  const restoredWithoutTerminal: HerdrRun = (args) => args[1] === "process-info"
    ? { status: 1, stdout: "", stderr: JSON.stringify(fixtures.missing) }
    : ok(fixtures.pane);
  assert.equal(paneLive(location, restoredWithoutTerminal), false, "restored metadata without a materialized terminal is stopped");
  assert.equal(readPane(location, fakeHerdr().run), "plain terminal text");
});

test("Herdr: cleanup closes only a recorded workspace whose every pane is provably idle", () => {
  for (const process of ["active", "idle", "missing"] as const) {
    const { run, calls } = fakeHerdr({ process });
    assert.equal(closeIdleWorkspace(location, run), process === "idle");
    assert.equal(calls.some((call) => call.args[0] === "workspace" && call.args[1] === "close"), process === "idle");
  }
  const { run, calls } = fakeHerdr({ process: "idle" });
  assert.equal(closeIdleWorkspace({ ...location, paneId: "w1:unowned" }, run), false);
  assert.equal(calls.some((call) => call.args[1] === "close"), false);
});

test("Herdr watchdog: pgrep matches only this slug for all CLI spellings", () => {
  const pattern = roundProcessPattern("film");
  const matches = (command: string) => spawnSync("/usr/bin/grep", ["-E", pattern], { input: command, encoding: "utf8" }).status === 0;
  assert.equal(matches("npx tsx backend/cli.ts all-check round film --format long"), true);
  assert.equal(matches("aideos all-check-finish film"), true);
  assert.equal(matches("aideos all-check frames film-extra --round 1"), false);
  assert.equal(matches("aideos all-check round another-film"), false);
});
