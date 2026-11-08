/**
 * File Description: Regression tests for the launch order of bin/aideos: the agent menu is answered before the Studio server starts or the browser opens.
 * Inputs and outputs: bin/aideos run in a real pseudo-terminal (or without one) against shimmed server, browser and agent commands -> ordered launch events and terminal output.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(__dirname, "..");
const PTY_DRIVER = path.join(__dirname, "testSupport/ptyLauncher.py");
const MENU_PROMPT = "Select agent [1-5, p]";
const HAVE_PYTHON = spawnSync("python3", ["--version"]).status === 0;

type Channel = "dev" | "stable";

interface Sandbox {
  tmp: string;
  project: string;
  home: string;
  events: string;
  session: string;
  env: NodeJS.ProcessEnv;
}

interface PtyResult {
  status: number;
  timedOut: boolean;
  output: string;
}

// Writes an executable shim script that stands in for a system command.
function writeShim(dir: string, name: string, body: string): void {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

// Builds a disposable checkout plus shims so the launcher's server, browser, agent and tmux steps are observable without side effects.
function makeSandbox(tmp: string, channel: Channel): Sandbox {
  const project = path.join(tmp, "project");
  const home = path.join(tmp, "home");
  const shims = path.join(tmp, "shims");
  const events = path.join(tmp, "events.log");
  const started = path.join(tmp, "server-started");
  const session = path.join(project, ".aideos_session.json");
  for (const dir of [path.join(project, "bin"), path.join(project, "editor"), path.join(project, "scripts"), path.join(project, "node_modules/.bin"), home, shims]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(project, "remotion.config.ts"), "");
  fs.writeFileSync(path.join(project, "scripts/channel.ts"), "");
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "fake-aideos" }));
  fs.copyFileSync(path.join(ROOT, "bin/aideos"), path.join(project, "bin/aideos"));
  fs.chmodSync(path.join(project, "bin/aideos"), 0o755);
  fs.writeFileSync(events, "");

  const port = channel === "stable" ? 3002 : 3001;
  const banner = channel === "stable" ? "AIDEOS STABLE v9.9.9 (commit abc1234)" : "AIDEOS DEV main@abc1234";
  writeShim(path.join(project, "node_modules/.bin"), "tsx", `echo "${banner}" >&2\nprintf ${port}`);
  // The server shim records its start, and whether the agent pairing was already on disk when it started.
  writeShim(shims, "npm", `touch "${started}"\necho "SERVER_START $*" >> "${events}"\nif [ -f "${project}/.aideos_session.json" ]; then echo "SESSION_FILE_AT_SERVER_START present" >> "${events}"; else echo "SESSION_FILE_AT_SERVER_START absent" >> "${events}"; fi`);
  writeShim(shims, "lsof", `if [ -n "\${AIDEOS_TEST_FOREIGN:-}" ]; then echo "node 1 u IPv4 TCP *:${port} (LISTEN)"; exit 0; fi\nexit 1`);
  writeShim(shims, "curl", `if [ -n "\${AIDEOS_TEST_FOREIGN:-}" ]; then echo '{"root":"/somewhere/else"}'; exit 0; fi\nif [ -f "${started}" ]; then echo '{"root":"${project}"}'; exit 0; fi\nexit 22`);
  writeShim(shims, "open", `echo "BROWSER_OPEN $*" >> "${events}"`);
  writeShim(shims, "claude", `echo "AGENT_EXEC claude" >> "${events}"`);
  writeShim(shims, "agy", `echo "AGENT_EXEC agy" >> "${events}"`);
  writeShim(shims, "pi", `echo "AGENT_EXEC pi" >> "${events}"`);
  writeShim(
    shims,
    "tmux",
    `case "$1" in\n  display-message) echo "%7" ;;\n  has-session) exit 1 ;;\n  *) echo "AGENT_TMUX $*" >> "${events}" ;;\nesac`,
  );

  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PATH: `${shims}:${process.env.PATH}`, NO_COLOR: "1" };
  delete env.TMUX;
  return { tmp, project, home, events, session, env };
}

// Runs fn with a fresh sandbox and removes it afterwards.
function withSandbox(channel: Channel, fn: (box: Sandbox) => void): void {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aideos-menu-first-")));
  try {
    fn(makeSandbox(tmp, channel));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// One scripted answer: send these keys once the expected text is on screen (default: the agent menu prompt).
type Answer = string | { expect: string; send: string };

// Runs the launcher under a real pty, answering each prompt in turn and marking PROMPT_SHOWN just before each answer.
function runOnPty(box: Sandbox, answers: Answer[], extraEnv: NodeJS.ProcessEnv = {}): PtyResult {
  const steps = answers.map((answer, index) => ({
    expect: typeof answer === "string" ? MENU_PROMPT : answer.expect,
    send: typeof answer === "string" ? answer : answer.send,
    settle: 0.4,
    mark: `PROMPT_SHOWN ${index + 1}`,
  }));
  const result = spawnSync("python3", [PTY_DRIVER, box.events, JSON.stringify(steps), "--", path.join(box.project, "bin/aideos")], {
    cwd: box.project,
    encoding: "utf8",
    env: { ...box.env, ...extraEnv },
    timeout: 60000,
  });
  assert.equal(result.status, 0, `pty driver failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout) as PtyResult;
  parsed.output = parsed.output.replace(/\r/g, "");
  assert.equal(parsed.timedOut, false, `launcher hung; terminal output:\n${parsed.output}`);
  return parsed;
}

// Returns the ordered event lines the shims and the pty driver recorded.
function eventNames(box: Sandbox): string[] {
  return fs.readFileSync(box.events, "utf8").split("\n").filter(Boolean);
}

// Returns the index of the first event with the given prefix, failing the test when it never happened.
function indexOfEvent(events: string[], prefix: string): number {
  const index = events.findIndex((event) => event.startsWith(prefix));
  assert.notEqual(index, -1, `expected a '${prefix}' event, got: ${events.join(", ")}`);
  return index;
}

// The bug the captain hit: the server and the browser started while the menu was still waiting for input.
for (const channel of ["dev", "stable"] as const) {
  test(`aideos (${channel}) asks for the agent first, then starts Studio, then opens the browser, then launches the agent`, { skip: !HAVE_PYTHON }, () => {
    withSandbox(channel, (box) => {
      const result = runOnPty(box, ["1\n"]);
      const events = eventNames(box);
      const prompt = indexOfEvent(events, "PROMPT_SHOWN");
      const server = indexOfEvent(events, "SERVER_START");
      const browser = indexOfEvent(events, "BROWSER_OPEN");
      const agent = indexOfEvent(events, "AGENT_");
      assert.ok(prompt < server, `Studio started before the menu was answered: ${events.join(", ")}`);
      assert.ok(server < browser, `browser opened before Studio was up: ${events.join(", ")}`);
      assert.ok(browser < agent, `agent launched before the browser opened: ${events.join(", ")}`);
      assert.equal(result.status, 0, result.output);
      // The channel banner stays the first thing printed, and "Starting Aideos Studio" only follows the menu.
      const banner = channel === "stable" ? "AIDEOS STABLE v9.9.9" : "AIDEOS DEV main@abc1234";
      assert.ok(result.output.trimStart().startsWith(banner), result.output);
      assert.ok(result.output.indexOf(MENU_PROMPT) < result.output.indexOf("Starting Aideos Studio"), result.output);
      assert.match(result.output, new RegExp(`http://localhost:${channel === "stable" ? 3002 : 3001}/`));
    });
  });
}

// The pairing the dispatcher reads must exist before the server is reachable, and name the chosen agent and pane.
test("aideos records the chosen agent's tmux pane before Studio starts", { skip: !HAVE_PYTHON }, () => {
  withSandbox("dev", (box) => {
    runOnPty(box, ["2\n"], { TMUX: "/tmp/fake-tmux,1,0", TMUX_PANE: "%7" });
    const log = fs.readFileSync(box.events, "utf8");
    assert.match(log, /SESSION_FILE_AT_SERVER_START present/);
    const session = JSON.parse(fs.readFileSync(box.session, "utf8"));
    assert.equal(session.agent, "agy");
    assert.equal(session.sessionType, "tmux");
    assert.equal(session.tmuxSession, "aideos-3001");
    assert.equal(session.tmuxPane, "%7");
    assert.match(log, /AGENT_EXEC agy/);
  });
});

// Outside tmux the launcher opens a new named tmux session for the agent, after Studio and the browser.
test("aideos outside tmux still launches the agent in its own tmux session after the browser", { skip: !HAVE_PYTHON }, () => {
  withSandbox("dev", (box) => {
    runOnPty(box, ["\n"]);
    const events = eventNames(box);
    assert.ok(indexOfEvent(events, "PROMPT_SHOWN") < indexOfEvent(events, "SERVER_START"));
    assert.ok(indexOfEvent(events, "BROWSER_OPEN") < indexOfEvent(events, "AGENT_TMUX"));
    assert.match(fs.readFileSync(box.events, "utf8"), /AGENT_TMUX new-session -s aideos-3001 -c .* claude/);
    assert.equal(JSON.parse(fs.readFileSync(box.session, "utf8")).agent, "claude");
  });
});

// Web Studio only starts the server and the browser (after the choice) and no agent.
test("aideos Web Studio only starts Studio and the browser after the choice and launches no agent", { skip: !HAVE_PYTHON }, () => {
  withSandbox("dev", (box) => {
    fs.writeFileSync(box.session, JSON.stringify({ agent: "claude", tmuxPane: "%99" }));
    const result = runOnPty(box, ["5\n"]);
    const events = eventNames(box);
    assert.ok(indexOfEvent(events, "PROMPT_SHOWN") < indexOfEvent(events, "SERVER_START"));
    assert.ok(indexOfEvent(events, "SERVER_START") < indexOfEvent(events, "BROWSER_OPEN"));
    assert.equal(events.some((event) => event.startsWith("AGENT_")), false, events.join(", "));
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Studio is active on http:\/\/localhost:3001\//);
    // A pairing left by an earlier launch must not keep receiving this Studio's tasks.
    assert.equal(fs.existsSync(box.session), false);
  });
});

// A hard-locked default is chosen inside the menu and the choice still resolves before Studio starts.
test("aideos [p] hard-lock resolves the choice before Studio starts and saves the default", { skip: !HAVE_PYTHON }, () => {
  withSandbox("dev", (box) => {
    runOnPty(box, ["p\n", { expect: "Hard-lock choice [1-5]:", send: "3\n" }]);
    const events = eventNames(box);
    assert.ok(indexOfEvent(events, "PROMPT_SHOWN 2") < indexOfEvent(events, "SERVER_START"), events.join(", "));
    assert.ok(indexOfEvent(events, "PROMPT_SHOWN 2") < indexOfEvent(events, "BROWSER_OPEN"), events.join(", "));
    assert.equal(fs.readFileSync(path.join(box.home, ".config/aideos/agent"), "utf8").trim(), "pi");
    assert.match(fs.readFileSync(box.events, "utf8"), /AGENT_TMUX new-session .* pi/);
  });
});

// A saved default is only pre-selected: the menu still waits for Enter before anything starts.
test("aideos with a locked default still waits at the menu before starting Studio", { skip: !HAVE_PYTHON }, () => {
  withSandbox("dev", (box) => {
    fs.mkdirSync(path.join(box.home, ".config/aideos"), { recursive: true });
    fs.writeFileSync(path.join(box.home, ".config/aideos/agent"), "agy\n");
    const result = runOnPty(box, ["\n"]);
    const events = eventNames(box);
    assert.match(result.output, /Enter for Antigravity CLI \[2\] \(Locked Default\)/);
    assert.ok(indexOfEvent(events, "PROMPT_SHOWN") < indexOfEvent(events, "SERVER_START"), events.join(", "));
    assert.match(fs.readFileSync(box.events, "utf8"), /AGENT_TMUX new-session .* agy/);
  });
});

// Invalid input re-prompts instead of falling through to a default; nothing starts until a valid answer.
test("aideos re-prompts on invalid input and starts nothing until a valid answer", { skip: !HAVE_PYTHON }, () => {
  withSandbox("dev", (box) => {
    const result = runOnPty(box, ["9\n", "zzz\n", "3\n"]);
    const events = eventNames(box);
    const prompts = events.filter((event) => event.startsWith("PROMPT_SHOWN"));
    assert.equal(prompts.length, 3);
    assert.equal(result.output.split("Invalid choice").length - 1, 2, result.output);
    const lastPrompt = events.lastIndexOf(prompts[2]);
    assert.ok(lastPrompt < indexOfEvent(events, "SERVER_START"), events.join(", "));
    assert.ok(lastPrompt < indexOfEvent(events, "BROWSER_OPEN"), events.join(", "));
    assert.match(fs.readFileSync(box.events, "utf8"), /AGENT_TMUX new-session .* pi/);
  });
});

// Ctrl-C and Ctrl-D at the menu end the launch cleanly: no server, no browser, no agent, no pairing.
for (const [name, key] of [["Ctrl-C", "\x03"], ["Ctrl-D", "\x04"]] as const) {
  test(`aideos ${name} at the menu exits cleanly and starts nothing`, { skip: !HAVE_PYTHON }, () => {
    withSandbox("dev", (box) => {
      const result = runOnPty(box, [key]);
      const events = eventNames(box);
      assert.equal(result.status, 130, result.output);
      assert.deepEqual(events.filter((event) => !event.startsWith("PROMPT_SHOWN")), [], `launcher started something: ${events.join(", ")}`);
      assert.match(result.output, /No agent selected\. Nothing was started\./);
      assert.equal(fs.existsSync(box.session), false);
    });
  });
}

// A port held by another checkout is refused before the user is asked to pick an agent.
test("aideos refuses another checkout's server before showing the menu", { skip: !HAVE_PYTHON }, () => {
  withSandbox("dev", (box) => {
    const result = spawnSync("bash", [path.join(box.project, "bin/aideos")], {
      cwd: box.project,
      encoding: "utf8",
      env: { ...box.env, AIDEOS_TEST_FOREIGN: "1" },
      input: "",
      timeout: 30000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Port 3001 belongs to another checkout/);
    assert.doesNotMatch(result.stdout, /Select agent/);
    assert.equal(fs.readFileSync(box.events, "utf8"), "");
  });
});

// With no terminal (CI, pipes) there is no menu and no hang: the default agent is used exactly as before.
test("aideos without a terminal skips the menu, starts Studio, opens the browser and launches the default agent", () => {
  withSandbox("dev", (box) => {
    const result = spawnSync("bash", [path.join(box.project, "bin/aideos")], {
      cwd: box.project,
      encoding: "utf8",
      env: box.env,
      input: "",
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.doesNotMatch(result.stdout, /Select agent/);
    const events = eventNames(box);
    assert.ok(indexOfEvent(events, "SERVER_START") < indexOfEvent(events, "BROWSER_OPEN"));
    assert.ok(indexOfEvent(events, "BROWSER_OPEN") < indexOfEvent(events, "AGENT_TMUX"));
    assert.match(fs.readFileSync(box.events, "utf8"), /AGENT_TMUX new-session .* claude/);
    assert.match(result.stderr, /AIDEOS DEV main@abc1234/);
  });
});
