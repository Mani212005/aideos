/**
 * File Description: Behavioural tests for the Auto-Prompt button's idempotence: a repeated click, a double-click race or a retry reuses the open task instead of creating another, and the button's own state agrees.
 * Inputs and outputs: dispatchTask calls with a fake agent terminal, and the button's pure state helpers -> assertions on the tasks, inbox files and badge.
 * Used by: npm test.
 */

import test from "node:test";
import "../testSupport/fixtureVideosDir";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "../pipeline/filmStore";
import { FakeAgentTerminal } from "../testSupport/fakeAgentTerminal";
import { agentLink } from "../agentLink/store";
import { autoPromptBadge, createSingleFlight } from "../../editor/src/state/autoPromptState";
import { clearAllFallbackTimers, DEFAULT_AGENT_TIMEOUT_MS, dispatchTask, OPEN_AFTER_TIMEOUT_MS, paneDelivery, setAgentSession, taskQueue, type DispatchOptions } from "./index";

const CLICK: DispatchOptions = { eventType: "auto_build_scenes", filmId: "click-film", filmTitle: "Click Film", enableFallback: false, idempotent: true };

/** Starts each case from an empty queue and puts the shared session file and queues back afterwards. */
function isolate(t: test.TestContext): void {
  const sessionFile = path.join(ROOT, ".aideos_session.json");
  const previous = fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile) : undefined;
  taskQueue.clear();
  paneDelivery.clear();
  t.after(() => {
    clearAllFallbackTimers();
    taskQueue.clear();
    paneDelivery.clear();
    if (previous) fs.writeFileSync(sessionFile, previous);
    else fs.rmSync(sessionFile, { force: true });
  });
}

/** Points the studio's agent session at a fake terminal and returns the dispatch deps that drive it. */
function withTerminal(term: FakeAgentTerminal) {
  setAgentSession({ agent: "claude", tmuxSession: "aideos", tmuxPane: term.pane });
  return { tmux: term.run, sleep: term.sleep, now: term.now };
}

const tasksFor = (filmId: string) => taskQueue.listAllTasks().filter((task) => task.filmId === filmId);

test("a double-click race creates one task: concurrent dispatches resolve to the same task", async (t) => {
  isolate(t);
  const inbox = fs.mkdtempSync(path.join(os.tmpdir(), "autoprompt-inbox-"));
  t.after(() => fs.rmSync(inbox, { recursive: true, force: true }));
  const results = await Promise.all([1, 2, 3, 4].map(() => dispatchTask({ ...CLICK, inboxDir: inbox })));

  assert.equal(tasksFor("click-film").length, 1);
  assert.equal(new Set(results.map((r) => r.taskId)).size, 1);
  assert.equal(results.filter((r) => r.duplicate).length, 3);
  assert.equal(fs.readdirSync(inbox).filter((f) => f.endsWith(".msg")).length, 1, "the repeat clicks wrote no further inbox message");
});

test("a click while the first task is queued behind a busy agent reuses it and sends the prompt once", async (t) => {
  isolate(t);
  const term = new FakeAgentTerminal({ agent: "claude", pane: "%61", busyUntil: 20_000 });
  const deps = withTerminal(term);

  const first = await dispatchTask(CLICK, deps);
  const second = await dispatchTask(CLICK, deps);
  assert.equal(first.pane?.state, "queued");
  assert.equal(second.taskId, first.taskId);
  assert.equal(second.duplicate, true);
  assert.equal(second.pane?.duplicate, true);
  assert.equal(second.pane?.id, first.pane?.id);
  assert.match(second.message, /already queued/);
  assert.equal(tasksFor("click-film").length, 1);

  await paneDelivery.drain();
  assert.deepEqual(term.log.submissions.map((s) => s.text), [first.prompt]);
});

test("a task the agent has claimed counts as running, so a click still reuses it", async (t) => {
  isolate(t);
  const first = await dispatchTask(CLICK);
  taskQueue.claimTask(first.taskId, "agent");
  const second = await dispatchTask(CLICK);
  assert.equal(second.taskId, first.taskId);
  assert.match(second.message, /already running/);
  assert.equal(tasksFor("click-film").length, 1);
});

test("a click after the task completed, failed or timed out with nothing waiting creates a new task", async (t) => {
  isolate(t);
  for (const finish of [
    (id: string) => taskQueue.completeTask(id, { summary: "done" }),
    (id: string) => taskQueue.failTask(id, "cancelled"),
    (id: string) => taskQueue.timeoutTask(id),
  ]) {
    const before = await dispatchTask(CLICK);
    finish(before.taskId);
    const after = await dispatchTask(CLICK);
    assert.notEqual(after.taskId, before.taskId);
    assert.equal(after.duplicate, undefined);
    taskQueue.completeTask(after.taskId);
  }
});

test("a task that timed out but whose prompt still waits in the terminal is reused; one whose prompt failed is not", async (t) => {
  isolate(t);
  const term = new FakeAgentTerminal({ agent: "claude", pane: "%62", busyUntil: 20_000 });
  const deps = withTerminal(term);
  const first = await dispatchTask(CLICK, deps);
  taskQueue.timeoutTask(first.taskId);
  const waiting = await dispatchTask(CLICK, deps);
  assert.equal(waiting.taskId, first.taskId);
  assert.equal(waiting.duplicate, true);
  await paneDelivery.drain();

  paneDelivery.clear();
  const gone = new FakeAgentTerminal({ agent: "claude", pane: "%63" });
  const goneDeps = withTerminal(gone);
  const closedPane = { ...goneDeps, tmux: (args: string[]) => (args[0] === "capture-pane" ? { status: 1 } : goneDeps.tmux(args)) };
  const stuck = await dispatchTask({ ...CLICK, filmId: "failing-film" }, closedPane);
  await paneDelivery.drain();
  assert.equal(paneDelivery.get(stuck.pane!.id)?.state, "failed");
  const retry = await dispatchTask({ ...CLICK, filmId: "failing-film" }, goneDeps);
  assert.notEqual(retry.taskId, stuck.taskId, "a prompt that could not be sent is retried, not swallowed");
});

test("a click 20s after a sent prompt timed out unclaimed reuses the task and types the prompt once", async (t) => {
  isolate(t);
  const term = new FakeAgentTerminal({ agent: "claude", pane: "%64" });
  const deps = withTerminal(term);
  const first = await dispatchTask(CLICK, deps);
  await paneDelivery.drain();
  assert.equal(paneDelivery.get(first.pane!.id)?.state, "sent");

  await term.sleep(DEFAULT_AGENT_TIMEOUT_MS);
  taskQueue.timeoutTask(first.taskId);
  await term.sleep(20_000);
  const second = await dispatchTask(CLICK, deps);
  await paneDelivery.drain();

  assert.equal(second.taskId, first.taskId);
  assert.equal(second.duplicate, true);
  assert.match(second.message, /already sent to your agent/);
  assert.equal(tasksFor("click-film").length, 1);
  assert.deepEqual(term.log.submissions.map((s) => s.text), [first.prompt]);
});

test("with only the file inbox, a timed out task is reused inside the open window and writes one inbox message", async (t) => {
  isolate(t);
  const inbox = fs.mkdtempSync(path.join(os.tmpdir(), "autoprompt-inbox-"));
  t.after(() => fs.rmSync(inbox, { recursive: true, force: true }));
  let clock = 0;
  const deps = { now: () => clock };
  const first = await dispatchTask({ ...CLICK, inboxDir: inbox }, deps);
  assert.equal(first.pane, undefined);

  clock += DEFAULT_AGENT_TIMEOUT_MS;
  taskQueue.timeoutTask(first.taskId);
  clock += 20_000;
  const second = await dispatchTask({ ...CLICK, inboxDir: inbox }, deps);
  assert.equal(second.taskId, first.taskId);
  assert.equal(second.duplicate, true);
  assert.equal(fs.readdirSync(inbox).filter((f) => f.endsWith(".msg")).length, 1);

  clock = OPEN_AFTER_TIMEOUT_MS + 1;
  const later = await dispatchTask({ ...CLICK, inboxDir: inbox }, deps);
  assert.notEqual(later.taskId, first.taskId);
  assert.equal(fs.readdirSync(inbox).filter((f) => f.endsWith(".msg")).length, 2);
});

test("a sent prompt that timed out stays open for exactly the open window; a click after it creates a new task and sends again", async (t) => {
  isolate(t);
  const term = new FakeAgentTerminal({ agent: "claude", pane: "%65" });
  const deps = withTerminal(term);
  const first = await dispatchTask(CLICK, deps);
  await paneDelivery.drain();
  const sentAtMs = paneDelivery.get(first.pane!.id)!.sentAtMs!;
  taskQueue.timeoutTask(first.taskId);

  await term.sleep(sentAtMs + OPEN_AFTER_TIMEOUT_MS - term.now());
  const inside = await dispatchTask(CLICK, deps);
  assert.equal(inside.taskId, first.taskId);
  assert.equal(inside.duplicate, true);

  await term.sleep(1);
  const after = await dispatchTask(CLICK, deps);
  await paneDelivery.drain();
  assert.notEqual(after.taskId, first.taskId);
  assert.equal(after.duplicate, undefined);
  assert.equal(after.pane?.duplicate, false);
  assert.deepEqual(term.log.submissions.map((s) => s.text), [first.prompt, first.prompt]);
});

test("an idempotent prompt sent inside the open window is not typed again, while a non-idempotent dispatch of the same prompt is", async (t) => {
  isolate(t);
  const term = new FakeAgentTerminal({ agent: "claude", pane: "%66" });
  const deps = withTerminal(term);
  const plain = { ...CLICK, idempotent: undefined };

  const first = await dispatchTask(plain, deps);
  await paneDelivery.drain();
  await term.sleep(20_000);
  const idempotentTwin = paneDelivery.enqueue({ pane: term.pane, agent: "claude", prompt: first.prompt, taskId: "other", idempotent: true }, deps);
  assert.equal(idempotentTwin.duplicate, true);
  assert.equal(idempotentTwin.id, first.pane?.id);

  const again = await dispatchTask(plain, deps);
  await paneDelivery.drain();
  assert.notEqual(again.taskId, first.taskId);
  assert.equal(again.duplicate, undefined);
  assert.equal(again.pane?.duplicate, false);
  assert.notEqual(again.pane?.id, first.pane?.id);
  assert.equal(paneDelivery.get(again.pane!.id)?.state, "sent");
  assert.ok(again.channels.includes("tmux"));
  assert.deepEqual(term.log.submissions.map((s) => s.text), [first.prompt, first.prompt]);
});

test("a linked-agent task that never settles is reused inside the window, at the exact edge, and replaced after it", async (t) => {
  isolate(t);
  const link = agentLink();
  const { ownerKey, code } = link.startPairing();
  const claim = link.claim(code.toLowerCase(), "claude", "test-box");
  assert.ok(claim);
  t.after(() => link.disconnect(ownerKey));

  let clock = 1_000_000;
  const deps = { now: () => clock };
  const linkedClick = { ...CLICK, ownerKey };

  const first = await dispatchTask(linkedClick, deps);
  assert.equal(first.task.status, "pending");
  assert.ok(first.channels.includes("agent_link"));

  // Reused inside the window
  clock += 60_000;
  const second = await dispatchTask(linkedClick, deps);
  assert.equal(second.taskId, first.taskId);
  assert.equal(second.duplicate, true);

  // Reused at the exact window edge
  clock = 1_000_000 + OPEN_AFTER_TIMEOUT_MS;
  const edge = await dispatchTask(linkedClick, deps);
  assert.equal(edge.taskId, first.taskId);
  assert.equal(edge.duplicate, true);

  // Replaced after the window
  clock = 1_000_000 + OPEN_AFTER_TIMEOUT_MS + 1;
  const after = await dispatchTask(linkedClick, deps);
  assert.notEqual(after.taskId, first.taskId);
  assert.equal(after.duplicate, undefined);
  assert.ok(after.channels.includes("agent_link"));
});

test("a claimed-then-crashed task is reused inside the window, at the exact edge, and replaced after it", async (t) => {
  isolate(t);
  let clock = 2_000_000;
  const deps = { now: () => clock };
  const first = await dispatchTask(CLICK, deps);
  taskQueue.claimTask(first.taskId, "agent-crash");
  assert.equal(taskQueue.getTask(first.taskId)?.status, "claimed");

  // Reused inside the window
  clock += 60_000;
  const second = await dispatchTask(CLICK, deps);
  assert.equal(second.taskId, first.taskId);
  assert.equal(second.duplicate, true);
  assert.match(second.message, /already running/);

  // Reused at the exact window edge
  clock = 2_000_000 + OPEN_AFTER_TIMEOUT_MS;
  const edge = await dispatchTask(CLICK, deps);
  assert.equal(edge.taskId, first.taskId);
  assert.equal(edge.duplicate, true);

  // Replaced after the window
  clock = 2_000_000 + OPEN_AFTER_TIMEOUT_MS + 1;
  const after = await dispatchTask(CLICK, deps);
  assert.notEqual(after.taskId, first.taskId);
  assert.equal(after.duplicate, undefined);
});

test("only equivalent requests merge: another project, another instruction, or a caller that did not ask for idempotence", async (t) => {
  isolate(t);
  const a = await dispatchTask(CLICK);
  const otherFilm = await dispatchTask({ ...CLICK, filmId: "other-film" });
  const otherAsk = await dispatchTask({ ...CLICK, eventType: "custom_directive", customInstruction: "make the intro faster" });
  const plain = await dispatchTask({ ...CLICK, idempotent: undefined });
  const plainAgain = await dispatchTask({ ...CLICK, idempotent: undefined });
  assert.equal(new Set([a, otherFilm, otherAsk, plain, plainAgain].map((r) => r.taskId)).size, 5);
});

test("the Auto-Prompt button runs one request at a time, even for clicks in the same tick", async () => {
  const flight = createSingleFlight();
  let started = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const request = async () => {
    started += 1;
    await gate;
    return "queued";
  };

  const first = flight.run(request);
  const second = flight.run(request);
  assert.equal(flight.isBusy(), true);
  release();
  assert.deepEqual([await first, await second], ["queued", undefined]);
  assert.equal(started, 1);

  assert.equal(flight.isBusy(), false);
  assert.equal(await flight.run(async () => "again"), "again", "a click after the request finished runs a new one");
  await assert.rejects(flight.run(async () => Promise.reject(new Error("offline"))), /offline/);
  assert.equal(flight.isBusy(), false, "a failed request does not leave the button stuck");
});

test("the Auto-Prompt badge says Already queued for a reused task and follows the terminal queue otherwise", () => {
  const view = (state: "queued" | "sending" | "sent" | "failed", duplicate = false) => ({ id: "p", agent: "claude", state, duplicate, verified: false, error: state === "failed" ? "gone" : undefined });
  assert.deepEqual(autoPromptBadge(true, null), { label: "Already queued", tone: "quiet" });
  assert.equal(autoPromptBadge(true, view("queued", true))?.label, "Already queued");
  assert.equal(autoPromptBadge(true, view("sent", true))?.label, "Already sent");
  assert.equal(autoPromptBadge(false, null), null);
  assert.equal(autoPromptBadge(false, view("queued"))?.label, "Queued");
  assert.equal(autoPromptBadge(false, view("sending"))?.label, "Sending");
  assert.equal(autoPromptBadge(false, view("sent"))?.label, "Sent");
  assert.deepEqual([autoPromptBadge(false, view("failed"))?.label, autoPromptBadge(false, view("failed"))?.title], ["Not sent", "gone"]);
});
