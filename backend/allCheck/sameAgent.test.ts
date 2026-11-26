/**
 * File Description: Tests of the captain's rule that review feedback goes to the agent session that started
 * the film and that fixes run on that session's own harness and model: an in-session all-check starts no
 * agent, a REVISE round is delivered to the originating pane, a replacement (only when that session is gone)
 * inherits its harness and model (checked by running the launch script against fake Codex, Opus and Sonnet-like
 * harnesses that record their argv), and no fix model is hard-coded. No real agent, Herdr or model is touched.
 * Inputs and outputs: fake agent sessions, fake Herdr and fake harness binaries -> test assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { getVideosDir } from "../videoPackageLoader";
import { generationCaller, generationCallerOrNull, loadAideosConfig, NoGenerationModelError, reviewerModel } from "../aideosConfig";
import { designFilm, planFilmLook, serverDesignCaller } from "../designSpec/designer";
import {
  detectOriginSession,
  modelFromArgs,
  readOriginSession,
  recordOriginSession,
  type DetectDeps,
  type OriginSession,
} from "../agentSession/originSession";
import { resolveAgent } from "./agent";
import { deliverFeedbackToOrigin, formatFeedbackMessage } from "./feedback";
import type { HerdrLocation, HerdrRun } from "./herdr";
import { startAllCheck, type StartDeps } from "./index";
import { readLock } from "./lock";
import { parseAllCheckOptions } from "./options";
import { allCheckDir, type FormatRoundRecord } from "./types";

// Makes a throwaway video package in the test videos folder.
function makePackage(slug: string): void {
  const dir = path.join(getVideosDir(), slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "film.json"), JSON.stringify({
    id: slug, title: slug, fps: 30, chapters: ["Chapter"],
    canvas: { nodes: [{ id: "a", label: "A", x: 0, y: 0 }, { id: "b", label: "B", x: 200, y: 0 }], edges: [{ from: "a", to: "b" }] },
    shots: [{ id: "a", dur: 10, stage: "none", look: "a", move: "cut" }],
    voiceover: { src: `videos/${slug}/voiceover.wav` },
  }));
  fs.writeFileSync(path.join(dir, "voiceover.wav"), "RIFF");
}

// Removes a throwaway package.
function dropPackage(slug: string): void {
  fs.rmSync(path.join(getVideosDir(), slug), { recursive: true, force: true });
}

const PANE: HerdrLocation = { socketPath: "/fake/herdr.sock", workspaceId: "w1", paneId: "w1:p1", agentName: null };

// A session as detection would report it.
function session(agent: string, model: string | null, over: Partial<OriginSession> = {}): OriginSession {
  return { schema: "aideos.origin-session/1", agent, model, herdr: PANE, pid: process.pid, source: { agent: "test", model: "test" }, recordedAt: "2026-11-14T00:00:00.000Z", ...over };
}

// Herdr that answers the preflight and records every call.
function fakeHerdr(over: { paneAgent?: string | null; promptFails?: boolean } = {}): HerdrRun & { calls: string[][] } {
  const calls: string[][] = [];
  const run = ((args: string[]) => {
    calls.push(args);
    if (args[0] === "--version") return { status: 0, stdout: "herdr 0.8.0", stderr: "" };
    if (args[0] === "pane" && args[1] === "get") {
      if (over.paneAgent === null) return { status: 1, stdout: "", stderr: JSON.stringify({ error: { code: "pane_not_found" } }) };
      return { status: 0, stdout: JSON.stringify({ result: { pane: { pane_id: PANE.paneId, workspace_id: PANE.workspaceId, agent: over.paneAgent ?? "codex", agent_status: "idle" } } }), stderr: "" };
    }
    if (args[0] === "agent" && args[1] === "prompt") {
      return over.promptFails ? { status: 1, stdout: "", stderr: "boom" } : { status: 0, stdout: JSON.stringify({ result: {} }), stderr: "" };
    }
    return { status: 0, stdout: JSON.stringify({ result: { panes: [] } }), stderr: "" };
  }) as HerdrRun;
  return Object.assign(run, { calls });
}

// Start dependencies with the given caller session and a launch that records what it was asked to start.
function startDeps(live: OriginSession | null, env: NodeJS.ProcessEnv = {}, lock: Partial<StartDeps["lock"]> = {}): StartDeps & { launched: Array<{ script: string; agent: string }> } {
  const launched: Array<{ script: string; agent: string }> = [];
  const herdr = fakeHerdr();
  return {
    env,
    preflight: { herdr, which: (c: string) => `/usr/bin/${c}`, run: () => ({ status: 0, stdout: "gemini-3.8-flash-high\n", stderr: "" }) },
    lock: { paneLive: () => true, pidAlive: () => true, now: () => Date.now(), ...lock },
    herdr,
    studioRunning: () => false,
    now: () => new Date("2026-11-14T10:00:00.000Z"),
    session: () => live,
    launch: (_slug: string, script: string, agent: string) => {
      launched.push({ script, agent });
      return { ...PANE, paneId: "w9:p1", workspaceId: "w9", attachCommand: "herdr agent attach w9:p1" };
    },
    launched,
  } as StartDeps & { launched: Array<{ script: string; agent: string }> };
}

// A failing round record for a format, as the reviewer left it.
function reviseRecord(slug: string, format: "long" | "reel" = "long"): FormatRoundRecord {
  return {
    schema: "aideos.all-check.round/1", round: 1, format, videoPath: `/v/${slug}/renders/${format}.mp4`, filmHash: "h", createdAt: "2026-11-14T10:00:00.000Z",
    review: { score: 7.4, verdict: "REVISE", gatesPassed: false, summary: "caption clipped", failedCriteria: ["bottom captions: clipped"], feedback: [{ priority: "high", timestamp: "0:12", issue: "caption clipped by the edge", recommendation: "move it up" }], reportPath: null },
    measured: { passed: true, gateFailures: [], softFailures: [], recommendations: [], reportPath: null },
    frameCheck: { status: "pending", issues: [], stillsDir: "x", stills: [] },
    passed: false,
    failing: ["reviewer 7.4 is under the 9.0 bar"],
  };
}

// Writes a fake agent harness that records its argv, one argument per line, then exits.
function fakeHarness(binDir: string, name: string, record: string): void {
  fs.mkdirSync(binDir, { recursive: true });
  const file = path.join(binDir, name);
  fs.writeFileSync(file, `#!/usr/bin/env bash\nfor a in "$@"; do printf '%s\\n' "$a"; done > ${JSON.stringify(record)}\n`, { mode: 0o755 });
}

// Runs a written launch script (whose PATH was captured at start) and returns the argv the fake harness received.
function runLaunchScript(script: string, bin: string): string[] {
  // The script's own fallback runs `finish` only without a result: give it one so only the harness runs.
  fs.writeFileSync(path.join(path.dirname(script), "result.json"), "{}");
  const r = spawnSync("bash", [script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return fs.readFileSync(path.join(bin, "argv.txt"), "utf8").split("\n").filter(Boolean);
}

test("in-session: all-check from an agent session starts no agent and the session keeps the work", () => {
  const slug = "same-agent-insession";
  makePackage(slug);
  try {
    const live = session("codex", "gpt-5.5-codex");
    const deps = startDeps(live);
    const started = startAllCheck(parseAllCheckOptions(slug), deps);

    assert.equal(started.mode, "in-session");
    assert.equal(started.workspace, null);
    assert.equal(deps.launched.length, 0, "no new agent is launched");
    assert.ok(!fs.existsSync(path.join(allCheckDir(slug), "launch.sh")), "no launch script is written");
    assert.deepEqual({ agent: started.agent.agent, model: started.agent.model }, { agent: "codex", model: "gpt-5.5-codex" });

    const config = JSON.parse(fs.readFileSync(path.join(allCheckDir(slug), "config.json"), "utf8"));
    assert.equal(config.inSession, true);
    assert.equal(config.agent, "codex");
    assert.equal(config.model, "gpt-5.5-codex");
    assert.match(fs.readFileSync(started.briefPath, "utf8"), /agent session that started this film/);
    const lock = readLock(slug);
    assert.equal(lock?.inSession, true);
    assert.equal(lock?.herdr?.paneId, PANE.paneId);
    // The session is recorded for later fallbacks.
    assert.deepEqual(readOriginSession(slug)?.model, "gpt-5.5-codex");
    assert.equal(readOriginSession(slug)?.agent, "codex");

    // The same session starting again is a restart, not a second run.
    assert.equal(startAllCheck(parseAllCheckOptions(slug), deps).mode, "in-session");
  } finally {
    dropPackage(slug);
  }
});

test("in-session: another session is refused while the first is alive", () => {
  const slug = "same-agent-two-sessions";
  makePackage(slug);
  try {
    startAllCheck(parseAllCheckOptions(slug), startDeps(session("codex", "m1")));
    const other = session("claude", "claude-opus-5-5", { herdr: { ...PANE, paneId: "w2:p1" }, pid: process.pid + 1 });
    assert.throws(() => startAllCheck(parseAllCheckOptions(slug), startDeps(other)), /already running/);
  } finally {
    dropPackage(slug);
  }
});

test("REVISE: the review result is delivered to the originating session's pane and no agent is launched", () => {
  const slug = "same-agent-revise";
  makePackage(slug);
  try {
    const deps = startDeps(session("codex", "gpt-5.5-codex"));
    startAllCheck(parseAllCheckOptions(slug), deps);

    // A round runs in another terminal (not that pane): the REVISE verdict is typed into the originating session.
    const herdr = fakeHerdr({ paneAgent: "codex" });
    const outcome = deliverFeedbackToOrigin(slug, [reviseRecord(slug)], { herdr, env: { HERDR_ENV: "1", HERDR_PANE_ID: "w3:p9" } });
    assert.equal(outcome.delivered, true, outcome.reason);
    const prompt = herdr.calls.find((c) => c[0] === "agent" && c[1] === "prompt");
    assert.ok(prompt, "the feedback is sent with `herdr agent prompt`");
    assert.equal(prompt[2], PANE.paneId, "to the pane of the session that started the film");
    assert.match(prompt[3], /REVISE/);
    assert.match(prompt[3], /caption clipped by the edge/);
    assert.match(prompt[3], /0:12/);
    assert.ok(!herdr.calls.some((c) => ["workspace", "split"].includes(c[0]) || (c[0] === "pane" && c[1] === "run")), "nothing is launched");
    assert.equal(deps.launched.length, 0);

    // Run inside the originating pane itself, the command output is the delivery: nothing is typed twice.
    const same = fakeHerdr();
    const inPane = deliverFeedbackToOrigin(slug, [reviseRecord(slug)], { herdr: same, env: { HERDR_ENV: "1", HERDR_PANE_ID: PANE.paneId, HERDR_SOCKET_PATH: PANE.socketPath } });
    assert.equal(inPane.delivered, false);
    assert.match(inPane.reason, /itself/);
    assert.equal(same.calls.length, 0);

    // A passing round has nothing to revise.
    const passed = { ...reviseRecord(slug), passed: true };
    assert.equal(deliverFeedbackToOrigin(slug, [passed], { herdr: fakeHerdr(), env: {} }).delivered, false);
  } finally {
    dropPackage(slug);
  }
});

test("REVISE: a gone originating session is reported, never replaced by sending to someone else", () => {
  const slug = "same-agent-gone";
  makePackage(slug);
  try {
    recordOriginSession(slug, session("codex", "m"));
    const herdr = fakeHerdr({ paneAgent: null });
    const outcome = deliverFeedbackToOrigin(slug, [reviseRecord(slug)], { herdr, env: {} });
    assert.equal(outcome.delivered, false);
    assert.match(outcome.reason, /gone/);
    assert.ok(!herdr.calls.some((c) => c[0] === "agent" && c[1] === "prompt"));
    assert.equal(deliverFeedbackToOrigin("same-agent-nothing-recorded", [reviseRecord(slug)], { herdr, env: {} }).delivered, false);
    assert.match(formatFeedbackMessage(slug, [reviseRecord(slug)]), /Fix it in this session/);
  } finally {
    dropPackage(slug);
  }
});

// The replacement cases: (original harness, its model, the binary the fake harness stands in for, the flag that must carry the model).
const REPLACEMENTS = [
  { agent: "codex", model: "gpt-5.5-codex", expectArgs: ["--model", "gpt-5.5-codex", "--dangerously-bypass-approvals-and-sandbox"] },
  { agent: "claude", model: "claude-opus-5-5", expectArgs: ["--model", "claude-opus-5-5", "--dangerously-skip-permissions"] },
  { agent: "opencode", model: "anthropic/claude-haiku-5-5", expectArgs: ["--model", "anthropic/claude-haiku-5-5", "--prompt"] },
] as const;

const cleanup: string[] = [];
for (const { agent, model, expectArgs } of REPLACEMENTS) {
  test(`replacement: with the original ${agent} session gone, the new agent runs ${agent} on ${model} (never a fixed model)`, () => {
    const slug = `same-agent-replace-${agent}`;
    makePackage(slug);
    try {
      // The film was started from this session earlier and recorded; now all-check runs from a plain terminal.
      recordOriginSession(slug, session(agent, model));
      const bin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-harness-"));
      cleanup.push(bin);
      fakeHarness(bin, agent, path.join(bin, "argv.txt"));
      const deps = startDeps(null, { PATH: `${bin}:${process.env.PATH}`, HOME: bin }, { paneLive: () => false });
      const started = startAllCheck(parseAllCheckOptions(slug), deps);
      assert.equal(started.mode, "launched");
      assert.deepEqual({ agent: started.agent.agent, model: started.agent.model, source: started.agent.source }, { agent, model, source: "session" });
      assert.equal(deps.launched.length, 1);
      assert.equal(deps.launched[0].agent, agent);

      // Run the written launch script against a fake harness: the argv it records is what the real agent would get.
      const argv = runLaunchScript(deps.launched[0].script, bin);
      for (const arg of expectArgs) assert.ok(argv.includes(arg), `${agent} argv has ${arg}: ${argv.join(" ")}`);
      assert.equal(argv[argv.indexOf("--model") + 1], model);
      assert.ok(!argv.includes("claude-sonnet-5-5"), "the old hard-coded fix model is gone");
    } finally {
      dropPackage(slug);
      for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("plain terminal: a recorded origin session that is still running keeps the work and no second agent starts", () => {
  const slug = "same-agent-origin-alive";
  makePackage(slug);
  try {
    recordOriginSession(slug, session("codex", "gpt-5.5-codex"));
    const deps = startDeps(null, {}, { paneLive: () => true });
    const started = startAllCheck(parseAllCheckOptions(slug), deps);
    assert.equal(started.mode, "origin-session");
    assert.equal(started.originState, "alive");
    assert.equal(started.workspace, null);
    assert.equal(deps.launched.length, 0, "no replacement agent is launched");
    assert.deepEqual({ agent: started.agent.agent, model: started.agent.model }, { agent: "codex", model: "gpt-5.5-codex" });
    const lock = readLock(slug);
    assert.equal(lock?.inSession, true);
    assert.equal(lock?.herdr?.paneId, PANE.paneId, "the lock follows the origin pane, not this short-lived process");
    assert.equal(JSON.parse(fs.readFileSync(path.join(allCheckDir(slug), "config.json"), "utf8")).inSession, true);
    // The round's feedback then reaches that live session through the existing delivery path.
    const herdr = fakeHerdr({ paneAgent: "codex" });
    assert.equal(deliverFeedbackToOrigin(slug, [reviseRecord(slug)], { herdr, env: {} }).delivered, true);
  } finally {
    dropPackage(slug);
  }
});

test("plain terminal: a recorded origin session whose liveness cannot be determined is treated as running", () => {
  const slug = "same-agent-origin-unknown";
  makePackage(slug);
  try {
    recordOriginSession(slug, session("claude", "claude-opus-5-5"));
    const deps = startDeps(null, {}, { paneLive: () => { throw new Error("herdr unreachable"); } });
    const started = startAllCheck(parseAllCheckOptions(slug), deps);
    assert.equal(started.mode, "origin-session");
    assert.equal(started.originState, "unknown");
    assert.equal(deps.launched.length, 0, "never two agents on one film");
    fs.rmSync(allCheckDir(slug), { recursive: true, force: true });
    // Recorded with neither a pane nor a process: nothing to check, so nothing is started either.
    recordOriginSession(slug, session("claude", "claude-opus-5-5", { herdr: undefined, pid: undefined }));
    assert.throws(() => startAllCheck(parseAllCheckOptions(slug), deps), /cannot tell whether it is still running/);
    assert.equal(deps.launched.length, 0);
    assert.equal(readLock(slug), null);
    // An explicit --agent is a deliberate request for a replacement.
    assert.equal(startAllCheck(parseAllCheckOptions(slug, { agent: "claude", model: "claude-opus-5-5" }), deps).mode, "launched");
  } finally {
    dropPackage(slug);
  }
});

test("in-session: a session with no pane and no process to watch is refused instead of locked to a short-lived parent", () => {
  const slug = "same-agent-nowatch";
  makePackage(slug);
  try {
    const deps = startDeps(session("codex", "m", { herdr: undefined, pid: undefined }));
    assert.throws(() => startAllCheck(parseAllCheckOptions(slug), deps), /cannot tell when this codex session ends/);
    assert.equal(readLock(slug), null);
    assert.equal(deps.launched.length, 0);
    // With a pane (no process found) the lock follows the pane from the start.
    const inPane = startDeps(session("codex", "m", { pid: undefined }), {}, { pidAlive: () => false });
    assert.equal(startAllCheck(parseAllCheckOptions(slug), inPane).mode, "in-session");
    assert.equal(readLock(slug)?.herdr?.paneId, PANE.paneId);
  } finally {
    dropPackage(slug);
  }
});

test("replacement: no recorded session and no explicit override fails loudly instead of picking a model", () => {
  const slug = "same-agent-norecord";
  makePackage(slug);
  try {
    const deps = startDeps(null);
    assert.throws(() => startAllCheck(parseAllCheckOptions(slug), deps), /no agent session is recorded/);
    assert.equal(deps.launched.length, 0);
    assert.equal(readLock(slug), null);
  } finally {
    dropPackage(slug);
  }
});

test("replacement: a session whose model is not exposed leaves the choice to its harness; agy always needs one", () => {
  const unknown = resolveAgent({ origin: session("codex", null) });
  assert.deepEqual({ agent: unknown.agent, model: unknown.model }, { agent: "codex", model: null });
  assert.throws(() => resolveAgent({ origin: session("pi", "x") }), /cannot start as a replacement/);
  const cfg = loadAideosConfig();
  assert.throws(() => resolveAgent({ origin: session("agy", null), config: { ...cfg, videoModels: { ...cfg.videoModels, reviewer: { agent: "claude", model: "r" } } } }), /needs a model|no model is known/);
});

test("no hard-coded fix model: the session wins over any configured override, the override wins only with no session", () => {
  const cfg = loadAideosConfig();
  const withOverride = { ...cfg, videoModels: { ...cfg.videoModels, generation: { agent: "claude" as const, model: "claude-sonnet-5-5" } } };
  for (const origin of [session("codex", "gpt-5.5-codex"), session("claude", "claude-opus-5-5")]) {
    const r = resolveAgent({ origin, config: withOverride });
    assert.deepEqual({ agent: r.agent, model: r.model, source: r.source }, { agent: origin.agent, model: origin.model, source: "session" });
  }
  assert.deepEqual(resolveAgent({ config: withOverride }).model, "claude-sonnet-5-5");
  // The committed config forces nothing.
  assert.equal(cfg.videoModels.generation, undefined);
});

test("reviewer: the Gemini reviewer role is untouched and still comes from the config", () => {
  assert.equal(reviewerModel(undefined, {}), "gemini-3.8-flash-low");
  assert.equal(loadAideosConfig().videoModels.reviewer.agent, "agy");
  assert.ok(loadAideosConfig().videoModels.forbiddenGenerationModels.includes("gemini-3.1-pro"));
});

test("server text: follows the film's recorded session, refuses a harness it cannot run headless, and reports no known model", async () => {
  const slug = "same-agent-server";
  makePackage(slug);
  try {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner = async (command: string, args: string[]) => { calls.push({ command, args }); return "reply"; };
    recordOriginSession(slug, session("claude", "claude-opus-5-5"));
    assert.equal(await generationCaller(undefined, runner, slug)("p", "s"), "reply");
    assert.equal(calls[0].args[calls[0].args.indexOf("--model") + 1], "claude-opus-5-5");
    recordOriginSession(slug, session("claude", null));
    await generationCaller(undefined, runner, slug)("p", "s");
    assert.ok(!calls[1].args.includes("--model"), "an unknown session model is left to claude, not guessed");
    recordOriginSession(slug, session("codex", "gpt-5.5-codex"));
    assert.throws(() => generationCaller(undefined, runner, slug), /requires an allowed Claude/);
    assert.throws(() => generationCaller(undefined, runner, slug), NoGenerationModelError);
    assert.throws(() => generationCaller(undefined, runner, "same-agent-none"), NoGenerationModelError);
  } finally {
    dropPackage(slug);
  }
});

test("server generation never hard-fails: a Codex-like origin falls back to the session, an Opus-like origin still runs", async () => {
  const slug = "same-agent-fallback";
  makePackage(slug);
  try {
    const calls: string[][] = [];
    const runner = async (_command: string, args: string[]) => { calls.push(args); return "reply"; };
    const notices: string[] = [];
    recordOriginSession(slug, session("codex", "gpt-5.5-codex"));
    assert.equal(generationCallerOrNull(slug, runner, (line) => notices.push(line)), null);
    assert.equal(notices.length, 1);
    assert.match(notices[0], /not available for it and the work goes to the session instead/);
    assert.equal(await serverDesignCaller(slug), null, "the studio route and design stage get a null caller, not an error");
    recordOriginSession(slug, session("claude", "gemini-3.1-pro"));
    assert.equal(generationCallerOrNull(slug, runner, (line) => notices.push(line)), null, "a forbidden model is unusable too");
    recordOriginSession(slug, session("claude", "claude-opus-5-5"));
    const opus = generationCallerOrNull(slug, runner, (line) => notices.push(line));
    assert.ok(opus);
    assert.equal(await opus("p", "s"), "reply");
    assert.equal(calls[0][calls[0].indexOf("--model") + 1], "claude-opus-5-5");
    assert.equal(notices.length, 2, "an usable origin prints no notice");

    // The design stage in server mode stops for the session (needs_design) instead of reporting a failure.
    recordOriginSession(slug, session("codex", "gpt-5.5-codex"));
    const outcome = await designFilm(slug, { mode: "server", skipAgent: true });
    assert.equal(outcome.source, "needs_design");
    assert.doesNotMatch(outcome.note, /server design failed/);
    const look = await planFilmLook(slug, { mode: "server", skipAgent: true });
    assert.doesNotMatch(JSON.stringify(look), /requires an allowed Claude/);
  } finally {
    dropPackage(slug);
  }
});

// Detection dependencies from a fake environment.
function detectDeps(env: NodeJS.ProcessEnv, ancestors: Array<{ pid: number; args: string }> = [], herdr: HerdrRun = fakeHerdr()): DetectDeps {
  return { env, herdr, ancestors: () => ancestors, now: () => new Date("2026-11-14T00:00:00.000Z") };
}

test("origin session: the harness, model and pane are detected from what the caller can know", () => {
  const herdrEnv = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_WORKSPACE_ID: "w1", HERDR_SOCKET_PATH: "/fake/herdr.sock" };
  // Codex: the model is read from its own command line.
  const codex = detectOriginSession(detectDeps({ ...herdrEnv, CODEX_THREAD_ID: "t" }, [{ pid: 41, args: "node /usr/bin/codex --model gpt-5.5-codex --yolo" }]));
  assert.deepEqual({ agent: codex?.agent, model: codex?.model, pid: codex?.pid, pane: codex?.herdr?.paneId }, { agent: "codex", model: "gpt-5.5-codex", pid: 41, pane: "w1:p1" });
  // Claude: ANTHROPIC_MODEL, else its --model flag.
  assert.equal(detectOriginSession(detectDeps({ AI_AGENT: "claude-code_2-1_agent", ANTHROPIC_MODEL: "claude-opus-5-5" }))?.model, "claude-opus-5-5");
  assert.equal(detectOriginSession(detectDeps({ CLAUDECODE: "1" }, [{ pid: 7, args: "claude --model claude-opus-5-5 --dangerously-skip-permissions" }]))?.model, "claude-opus-5-5");
  // An explicit declaration wins over inference.
  const declared = detectOriginSession(detectDeps({ AIDEOS_AGENT: "opencode", AIDEOS_AGENT_MODEL: "anthropic/x", CLAUDECODE: "1" }));
  assert.deepEqual({ agent: declared?.agent, model: declared?.model }, { agent: "opencode", model: "anthropic/x" });
  // A model the harness does not expose is null, never a guess.
  assert.equal(detectOriginSession(detectDeps({ CODEX_THREAD_ID: "t" }))?.model, null);
  // Herdr's detected pane agent identifies a session with no other marker.
  assert.equal(detectOriginSession(detectDeps(herdrEnv, [], fakeHerdr({ paneAgent: "opencode" })))?.agent, "opencode");
  // A plain terminal is not an agent session.
  assert.equal(detectOriginSession(detectDeps({})), null);
  assert.equal(modelFromArgs("codex -m gpt-5.5 --x"), "gpt-5.5");
  assert.equal(modelFromArgs("claude --model=claude-opus-5-5"), "claude-opus-5-5");
  assert.equal(modelFromArgs("claude --dangerously-skip-permissions"), undefined);
});
