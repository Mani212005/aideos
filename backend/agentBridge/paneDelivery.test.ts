/**
 * File Description: Behavioural tests for the Auto-Prompt pane queue: a fake claude or codex terminal that swallows an
 * Enter sent right after a large paste proves the prompt is sent only when the agent is idle at an empty prompt, as
 * paste, a pause, Enter, an accept check and one retry, with duplicates dropped and a queued state while the agent is busy.
 * Inputs and outputs: fake agent terminals on a virtual clock and captured screens -> test assertions.
 * Used by: npm test.
 */

import test from "node:test";
import "../testSupport/fixtureVideosDir";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../pipeline/filmStore";
import { FakeAgentTerminal, type FakeAgentKind } from "../testSupport/fakeAgentTerminal";
import { dispatchTask, setAgentSession } from "./dispatcher";
import { PaneDeliveryQueue } from "./paneDelivery";
import { readPaneScreen } from "./paneScreen";

const PROMPT = `Auto-Prompter directing mission\n${"- read the screenplay and design the film\n".repeat(30)}`;
const OTHER_PROMPT = `Second request\n${"- tighten the captions\n".repeat(30)}`;

/** A queue wired to one fake terminal's virtual clock. */
function rig(term: FakeAgentTerminal, timing = {}) {
  const queue = new PaneDeliveryQueue();
  const deps = { tmux: term.run, sleep: term.sleep, now: term.now, timing };
  return { queue, send: (prompt: string) => queue.enqueue({ pane: term.pane, agent: "claude", prompt }, deps) };
}

// Bug reproduction: the old dispatch (paste, then Enter at once) leaves the prompt unsent in the composer.
for (const agent of ["claude", "codex"] as FakeAgentKind[]) {
  test(`${agent}: a large paste followed immediately by Enter is not submitted`, () => {
    const term = new FakeAgentTerminal({ agent });
    term.run(["set-buffer", "-b", "b1", PROMPT]);
    term.run(["paste-buffer", "-b", "b1", "-t", term.pane, "-d"]);
    term.run(["send-keys", "-t", term.pane, "Enter"]);
    assert.equal(term.log.submissions.length, 0);
    assert.deepEqual(term.log.enters.map((e) => e.swallowed), [true]);
    assert.equal(term.composerText(), PROMPT);
  });
}

for (const agent of ["claude", "codex"] as FakeAgentKind[]) {
  test(`${agent}: an idle agent gets paste, a pause, Enter and the prompt is submitted once`, async () => {
    const term = new FakeAgentTerminal({ agent });
    const { queue, send } = rig(term);
    send(PROMPT);
    await queue.drain();
    assert.equal(term.log.submissions.length, 1);
    assert.equal(term.log.submissions[0].text, PROMPT);
    assert.equal(term.log.pastes.length, 1);
    assert.ok(term.log.enters[0].at - term.log.pastes[0].at >= 400, "Enter waits for the paste to settle");
    const [entry] = queue.list();
    assert.deepEqual([entry.state, entry.attempts, entry.verified], ["sent", 1, true]);
  });
}

test("a busy agent leaves the prompt queued, pastes nothing, and sends it when the agent turns idle", async () => {
  const term = new FakeAgentTerminal({ agent: "claude", busyUntil: 12_000 });
  const { queue, send } = rig(term);
  const first = send(PROMPT);
  assert.equal(first.state, "queued");
  assert.equal(first.waitingFor, "busy");
  assert.equal(term.log.pastes.length, 0);
  await queue.drain();
  assert.equal(term.log.pastes.length, 1);
  assert.ok(term.log.pastes[0].at >= 12_000 && !term.log.pastes[0].whileBusy, "pasted only after the agent went idle");
  assert.equal(term.log.submissions.length, 1);
  assert.equal(queue.get(first.id)?.state, "sent");
});

test("a person's half-typed message is never pasted over: the prompt waits, then gives up", async () => {
  const term = new FakeAgentTerminal({ agent: "codex", initialInput: "explain this fu" });
  const { queue, send } = rig(term, { expireMs: 10_000 });
  const entry = send(PROMPT);
  assert.equal(entry.state, "queued");
  assert.equal(entry.waitingFor, "typing");
  await queue.drain();
  assert.equal(term.log.pastes.length, 0);
  assert.equal(term.composerText(), "explain this fu");
  assert.equal(queue.get(entry.id)?.state, "failed");
});

test("an Enter swallowed after the pause is retried once, without pasting again", async () => {
  const term = new FakeAgentTerminal({ agent: "claude", swallowEnterWithinMs: 1_000 });
  const { queue, send } = rig(term);
  const entry = send(PROMPT);
  await queue.drain();
  assert.deepEqual(term.log.enters.map((e) => e.swallowed), [true, false]);
  assert.equal(term.log.pastes.length, 1);
  assert.equal(term.log.submissions.length, 1);
  const done = queue.get(entry.id)!;
  assert.deepEqual([done.state, done.attempts, done.verified], ["sent", 2, true]);
});

test("a prompt that is still not accepted after the one retry is reported as failed, not as sent", async () => {
  const term = new FakeAgentTerminal({ agent: "codex", swallowEnterWithinMs: 600_000 });
  const { queue, send } = rig(term);
  const entry = send(PROMPT);
  await queue.drain();
  assert.equal(term.log.enters.length, 2);
  assert.equal(term.log.pastes.length, 1);
  assert.equal(term.log.submissions.length, 0);
  const done = queue.get(entry.id)!;
  assert.equal(done.state, "failed");
  assert.match(done.error ?? "", /Press Enter/);
});

test("an identical prompt still pending is dropped; a different one queues behind it", async () => {
  const term = new FakeAgentTerminal({ agent: "claude", busyUntil: 8_000, busyMs: 4_000 });
  const { queue, send } = rig(term);
  const first = send(PROMPT);
  const again = send(PROMPT);
  const other = send(OTHER_PROMPT);
  assert.equal(again.duplicate, true);
  assert.equal(again.id, first.id);
  assert.notEqual(other.id, first.id);
  await queue.drain();
  assert.deepEqual(term.log.submissions.map((s) => s.text), [PROMPT, OTHER_PROMPT]);
  assert.ok(term.log.submissions[1].at >= term.log.submissions[0].at + 4_000, "the second waits for the agent to finish the first");
});

test("a prompt is sendable again once the earlier identical one has been sent", async () => {
  const term = new FakeAgentTerminal({ agent: "claude", busyMs: 1_000 });
  const { queue, send } = rig(term);
  send(PROMPT);
  await queue.drain();
  const again = send(PROMPT);
  assert.equal(again.duplicate, false);
  await queue.drain();
  assert.equal(term.log.submissions.length, 2);
});

test("a pane that no longer exists fails the queued prompt instead of waiting forever", async () => {
  const term = new FakeAgentTerminal({ agent: "claude", pane: "%7" });
  const queue = new PaneDeliveryQueue();
  const entry = queue.enqueue({ pane: "%9", agent: "claude", prompt: PROMPT }, { tmux: term.run, sleep: term.sleep, now: term.now });
  await queue.drain();
  assert.equal(queue.get(entry.id)?.state, "failed");
  assert.match(queue.get(entry.id)?.error ?? "", /pane is gone/);
});

test("an agent UI with no recognizable prompt gets the prompt anyway after a few polls, marked unverified", async () => {
  const calls: string[][] = [];
  let time = 0;
  const queue = new PaneDeliveryQueue();
  const entry = queue.enqueue({ pane: "%3", agent: "other", prompt: PROMPT }, {
    tmux: (args) => (calls.push(args), { status: 0, stdout: "user@host:~/film$ " }),
    sleep: async (ms) => { time += ms; },
    now: () => time,
  });
  await queue.drain();
  const done = queue.get(entry.id)!;
  assert.deepEqual([done.state, done.verified], ["sent", false]);
  assert.equal(calls.filter((a) => a[0] === "capture-pane").length, 3);
  assert.deepEqual(calls[calls.length - 1], ["send-keys", "-t", "%3", "Enter"]);
});

// End to end through dispatchTask: the studio's Auto-Prompt Agent request.
test("dispatchTask queues behind a busy agent, says so, and the queue sends it when the agent is idle", async (t) => {
  const sessionFile = path.join(ROOT, ".aideos_session.json");
  const previous = fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile) : undefined;
  t.after(() => {
    if (previous) fs.writeFileSync(sessionFile, previous);
    else fs.rmSync(sessionFile, { force: true });
  });
  const term = new FakeAgentTerminal({ agent: "claude", pane: "%51", busyUntil: 20_000 });
  setAgentSession({ agent: "claude", tmuxSession: "aideos", tmuxPane: term.pane });
  const deps = { tmux: term.run, sleep: term.sleep, now: term.now };
  const opts = { eventType: "auto_build_scenes" as const, filmId: "queue-e2e", filmTitle: "Queue E2E", enableFallback: false };

  const first = await dispatchTask(opts, deps);
  assert.equal(first.pane?.state, "queued");
  assert.ok(first.channels.includes("tmux"));
  assert.match(first.message, /queued/);
  const second = await dispatchTask(opts, deps);
  assert.equal(second.pane?.duplicate, true);
  assert.match(second.message, /already waiting/);

  const { paneDelivery } = await import("./paneDelivery");
  await paneDelivery.drain();
  assert.equal(paneDelivery.get(first.pane!.id)?.state, "sent");
  assert.deepEqual(term.log.submissions.map((s) => s.text), [first.prompt]);
});

// The screen reader on captured screens: the real Claude Code layout (idle and working) and the codex layout.
test("readPaneScreen: real Claude Code screens", () => {
  const working = [
    "✻ Reticulating… (2m 6s · ↓ 14.7k tokens)",
    "  ⎿  Tip: Use /btw to ask a quick side question without interrupting Claude's current work",
    "",
    "─".repeat(60),
    "❯ ",
    "─".repeat(60),
    "  Sonnet 5.5 | ctx: 11% used",
  ].join("\n");
  assert.equal(readPaneScreen(working).state, "busy");
  assert.equal(readPaneScreen(working.split("\n").slice(2).join("\n")).state, "idle");
  assert.equal(readPaneScreen(working.replace("❯ ", "❯ [Pasted text #1 +32 lines]").split("\n").slice(2).join("\n")).state, "typing");
  assert.equal(readPaneScreen("❯ \x1b[7m \x1b[0m\x1b[2mTry \"how does this work\"\x1b[0m").state, "idle");
  assert.equal(readPaneScreen("│ > Try \"fix lint\"      │").state, "idle");
  assert.equal(readPaneScreen("\x1b[2mold: esc to interrupt\x1b[0m\n".repeat(1) + "\n".repeat(9) + "❯ ").state, "idle");
});

test("readPaneScreen: codex screens and unrecognized screens", () => {
  assert.equal(readPaneScreen("• Working (12s • esc to interrupt)\n\n› \x1b[2mAsk Codex to do something\x1b[0m").state, "busy");
  assert.equal(readPaneScreen("› \x1b[2mAsk Codex to do something\x1b[0m\n\n  gpt-5-codex · 83% context left").state, "idle");
  assert.equal(readPaneScreen("› [Pasted Content 1702 chars]\n\n  gpt-5-codex").state, "typing");
  assert.equal(readPaneScreen("user@host:~$ ls").state, "unknown");
  assert.equal(readPaneScreen("").state, "unknown");
});
