/**
 * File Description: Comprehensive unit and integration tests for the Aideos Agent Bridge Hub.
 * Tests task queue lifecycle, multi-channel dispatch, Firstmate inbox formatting, MCP tools, and hybrid timeout fallback.
 * Inputs and outputs: agent bridge task dispatch and queue fixtures -> test assertions.
 * Used by: npm test.
 */

import test from "node:test";
import "../testSupport/fixtureVideosDir";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import { ROOT } from "../pipeline/filmStore";
import { dispatchLocalAndTmux, setAgentSession } from "./dispatcher";
import {
  TaskQueue,
  taskQueue,
  buildTaskContext,
  buildDirectingPrompt,
  writeFirstmateInboxMessage,
  dispatchTask,
  clearAllFallbackTimers,
  type AgentTask,
} from "./index";
import { createMcpServer } from "../mcp/server";

// Test 1: TaskQueue creation and retrieval
test("TaskQueue creates, stores, and retrieves tasks with rich context", () => {
  const queue = new TaskQueue();
  const context = {
    filmId: "test-slug",
    filmTitle: "Test Film",
    scriptText: "# Test Script",
    durationSec: 42,
    shotCount: 5,
  };

  const task = queue.createTask({
    eventType: "auto_build_scenes",
    filmId: "test-slug",
    filmTitle: "Test Film",
    prompt: "Directing prompt for test",
    context,
    dispatchedChannels: ["mcp_queue", "firstmate_inbox"],
    timeoutMs: 10000,
  });

  assert.ok(task.id.startsWith("task-"));
  assert.equal(task.status, "pending");
  assert.equal(task.filmId, "test-slug");
  assert.equal(task.filmTitle, "Test Film");
  assert.deepEqual(task.dispatchedChannels, ["mcp_queue", "firstmate_inbox"]);

  const retrieved = queue.getTask(task.id);
  assert.deepEqual(retrieved, task);
});

// Test 2: TaskQueue pending list filtering
test("TaskQueue lists pending tasks with optional slug filtering", () => {
  const queue = new TaskQueue();
  const t1 = queue.createTask({
    eventType: "auto_build_scenes",
    filmId: "film-a",
    filmTitle: "Film A",
    prompt: "Prompt A",
    context: { filmId: "film-a", filmTitle: "Film A" },
    dispatchedChannels: ["mcp_queue"],
    timeoutMs: 10000,
  });
  queue.createTask({
    eventType: "voiceover_ready",
    filmId: "film-b",
    filmTitle: "Film B",
    prompt: "Prompt B",
    context: { filmId: "film-b", filmTitle: "Film B" },
    dispatchedChannels: ["mcp_queue"],
    timeoutMs: 10000,
  });

  const allPending = queue.listPendingTasks();
  assert.equal(allPending.length, 2);

  const filmAPending = queue.listPendingTasks("film-a");
  assert.equal(filmAPending.length, 1);
  assert.equal(filmAPending[0].id, t1.id);
});

// Test 3: TaskQueue claim, complete, fail, and timeout transitions
test("TaskQueue transitions status cleanly across the full lifecycle", () => {
  const queue = new TaskQueue();
  const task = queue.createTask({
    eventType: "custom_directive",
    filmId: "film-lifecycle",
    filmTitle: "Lifecycle Test",
    prompt: "Test lifecycle",
    context: { filmId: "film-lifecycle", filmTitle: "Lifecycle Test" },
    dispatchedChannels: ["mcp_queue"],
    timeoutMs: 5000,
  });

  assert.equal(task.status, "pending");

  // Claim
  const claimed = queue.claimTask(task.id, "crewmate-1");
  assert.equal(claimed.status, "claimed");
  assert.equal(claimed.claimedBy, "crewmate-1");
  assert.ok(claimed.claimedAt);

  // Claiming again should throw
  assert.throws(() => queue.claimTask(task.id, "crewmate-2"), /cannot be claimed/);

  // Complete
  const completed = queue.completeTask(task.id, { shotsAdded: 3 });
  assert.equal(completed.status, "completed");
  assert.ok(completed.completedAt);
  assert.deepEqual(completed.result, { shotsAdded: 3 });
});

// Test 4: TaskQueue lifecycle listeners
test("TaskQueue emits lifecycle events to registered listeners", () => {
  const queue = new TaskQueue();
  const events: string[] = [];

  const unsubscribe = queue.addListener((event, t) => {
    events.push(`${event}:${t.id}`);
  });

  const task = queue.createTask({
    eventType: "auto_build_scenes",
    filmId: "film-listener",
    filmTitle: "Listener Test",
    prompt: "Listener prompt",
    context: { filmId: "film-listener", filmTitle: "Listener Test" },
    dispatchedChannels: ["mcp_queue"],
    timeoutMs: 5000,
  });

  queue.claimTask(task.id, "agent-listener");
  queue.completeTask(task.id, { ok: true });

  assert.equal(events.length, 3);
  assert.equal(events[0], `created:${task.id}`);
  assert.equal(events[1], `claimed:${task.id}`);
  assert.equal(events[2], `completed:${task.id}`);

  unsubscribe();
});

// Test 5: Context builder resolves film package artifacts and invariants
test("buildTaskContext resolves existing video package files and design invariants", () => {
  const context = buildTaskContext({
    eventType: "auto_build_scenes",
    filmId: "sample-explainer",
    filmTitle: "Sample Explainer",
  });

  assert.equal(context.filmId, "sample-explainer");
  assert.equal(context.filmTitle, "Sample Explainer");
  assert.ok(context.film);
  assert.ok(context.durationSec && context.durationSec > 0);
  assert.ok(context.shotCount && context.shotCount > 0);
  assert.equal(context.directorGuideRef, "docs/DIRECTOR_GUIDE.md");
  assert.ok(Array.isArray(context.designInvariants));
  assert.ok(context.designInvariants.length >= 7);
});

// Test 6: Prompt synthesizer generates actionable instructions
test("buildDirectingPrompt formats structured markdown with package refs and rules", () => {
  const prompt = buildDirectingPrompt({
    eventType: "auto_build_scenes",
    filmId: "why-dit-replaced-unet",
    filmTitle: "Why DiT Replaced U-Net",
    durationSec: 64.5,
    shotCount: 8,
  });

  assert.ok(prompt.includes("🎬 [Aideos Studio Auto-Prompter]"));
  assert.ok(prompt.includes('for "Why DiT Replaced U-Net" (why-dit-replaced-unet)'));
  assert.ok(prompt.includes("videos/why-dit-replaced-unet/script.md"));
  assert.ok(prompt.includes("videos/why-dit-replaced-unet/film.json"));
  assert.ok(prompt.includes("videos/why-dit-replaced-unet/voiceover.wav"));
  assert.ok(prompt.includes("docs/DIRECTOR_GUIDE.md"));
  assert.ok(prompt.includes("npm run validate:film videos/why-dit-replaced-unet/film.json"));
  assert.ok(prompt.indexOf("Look task first") < prompt.indexOf("Design task second"));
  assert.ok(prompt.includes("aideos look check why-dit-replaced-unet"));
  assert.doesNotMatch(prompt, /canvas stations/);
  assert.doesNotMatch(prompt, /rotate visual devices/);
});

// Test 7: Firstmate steering inbox sequential message writer
test("writeFirstmateInboxMessage writes sequential message files to configured target directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-inbox-test-"));

  try {
    const fakeTask = {
      id: "task-test-1",
      eventType: "auto_build_scenes" as const,
      filmId: "test-slug",
      filmTitle: "Test Film",
      prompt: "Test Directing Prompt Content",
      context: {
        filmId: "test-slug",
        filmTitle: "Test Film",
        scriptPath: "videos/test-slug/script.md",
        filmPath: "videos/test-slug/film.json",
        durationSec: 30,
        shotCount: 4,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "pending" as const,
      dispatchedChannels: ["firstmate_inbox" as const],
      timeoutMs: 15000,
    };

    // First write should produce 001.msg
    const res1 = writeFirstmateInboxMessage(fakeTask, tempDir);
    assert.equal(res1.written, true);
    assert.ok(res1.filePath);
    assert.equal(path.basename(res1.filePath), "001.msg");

    const content1 = fs.readFileSync(res1.filePath, "utf8");
    assert.ok(content1.includes("# Aideos Studio Task Directive: auto_build_scenes"));
    assert.ok(content1.includes("**Task ID:** task-test-1"));
    assert.ok(content1.includes("Test Directing Prompt Content"));
    assert.ok(content1.includes("videos/test-slug/film.json"));

    // Second write should produce 002.msg
    const fakeTask2 = { ...fakeTask, id: "task-test-2" };
    const res2 = writeFirstmateInboxMessage(fakeTask2, tempDir);
    assert.equal(res2.written, true);
    assert.ok(res2.filePath);
    assert.equal(path.basename(res2.filePath), "002.msg");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// Test 8: Unconfigured inbox degrades cleanly
test("writeFirstmateInboxMessage degrades cleanly when no inbox directory is configured", () => {
  const oldEnv = process.env.FIRSTMATE_STEERING_INBOX;
  const oldAideosEnv = process.env.AIDEOS_AGENT_INBOX;
  delete process.env.FIRSTMATE_STEERING_INBOX;
  delete process.env.AIDEOS_AGENT_INBOX;

  try {
    const fakeTask: AgentTask = {
      id: "task-test-degrade",
      eventType: "voiceover_ready",
      filmId: "test-slug",
      filmTitle: "Test Film",
      prompt: "Prompt",
      context: { filmId: "test-slug", filmTitle: "Test Film" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "pending",
      dispatchedChannels: [],
      timeoutMs: 15000,
    };

    const res = writeFirstmateInboxMessage(fakeTask);
    assert.equal(res.written, false);
  } finally {
    if (oldEnv) process.env.FIRSTMATE_STEERING_INBOX = oldEnv;
    if (oldAideosEnv) process.env.AIDEOS_AGENT_INBOX = oldAideosEnv;
  }
});

// Test 9: Hybrid Fallback executes when no agent claims before timeout
test("dispatchTask triggers hybrid fallback handler when task is unclaimed at timeout", async () => {
  clearAllFallbackTimers();
  taskQueue.clear();

  let fallbackCalled = false;
  let fallbackTaskId = "";

  const res = await dispatchTask({
    eventType: "auto_build_scenes",
    filmId: "fallback-test",
    filmTitle: "Fallback Test",
    timeoutMs: 50, // Fast timeout for unit test
    enableFallback: true,
    fallbackHandler: async (task) => {
      fallbackCalled = true;
      fallbackTaskId = task.id;
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.fallbackScheduled, true);
  assert.equal(res.fallbackTimeoutMs, 50);

  // Wait for timeout to trigger
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(fallbackCalled, true);
  assert.equal(fallbackTaskId, res.taskId);

  const finalTask = taskQueue.getTask(res.taskId);
  assert.equal(finalTask?.status, "timed_out");
});

// Test 10: Hybrid Fallback is defused when agent claims task in time
test("dispatchTask cancels hybrid fallback when agent claims the task before timeout", async () => {
  clearAllFallbackTimers();
  taskQueue.clear();

  let fallbackCalled = false;

  const res = await dispatchTask({
    eventType: "auto_build_scenes",
    filmId: "defuse-test",
    filmTitle: "Defuse Test",
    timeoutMs: 60,
    enableFallback: true,
    fallbackHandler: async () => {
      fallbackCalled = true;
    },
  });

  // Agent claims task immediately
  taskQueue.claimTask(res.taskId, "autonomous-crewmate");

  // Wait past the timeout duration
  await new Promise((resolve) => setTimeout(resolve, 90));

  assert.equal(fallbackCalled, false);
  const task = taskQueue.getTask(res.taskId);
  assert.equal(task?.status, "claimed");
  assert.equal(task?.claimedBy, "autonomous-crewmate");
});

// Test 11: MCP Tools integration
test("MCP server exposes aideos_get_pending_tasks, aideos_claim_task, and aideos_complete_task", async () => {
  taskQueue.clear();

  const task = taskQueue.createTask({
    eventType: "auto_build_scenes",
    filmId: "mcp-test-slug",
    filmTitle: "MCP Film",
    prompt: "MCP prompt",
    context: { filmId: "mcp-test-slug", filmTitle: "MCP Film" },
    dispatchedChannels: ["mcp_queue"],
    timeoutMs: 15000,
  });

  const server = createMcpServer();
  assert.ok(server, "MCP server initialized");

  // Verify pending list
  const pending = taskQueue.listPendingTasks("mcp-test-slug");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, task.id);

  // Verify claim
  const claimed = taskQueue.claimTask(task.id, "mcp-worker");
  assert.equal(claimed.status, "claimed");

  // Verify complete
  const completed = taskQueue.completeTask(task.id, { scenesCompiled: 4 });
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.result, { scenesCompiled: 4 });
});

// Test 12: dispatchTask writes authentic generated task ID to Firstmate inbox message
test("dispatchTask writes authentic generated task ID to Firstmate inbox message and enables claiming", async () => {
  clearAllFallbackTimers();
  taskQueue.clear();

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-dispatch-inbox-"));
  try {
    const res = await dispatchTask({
      eventType: "auto_build_scenes",
      filmId: "inbox-task-test",
      filmTitle: "Inbox Task Test",
      inboxDir: tempDir,
      enableFallback: false,
    });

    assert.equal(res.ok, true);
    assert.ok(res.taskId.startsWith("task-"));
    assert.ok(res.inboxMessagePath);
    assert.ok(fs.existsSync(res.inboxMessagePath));

    const content = fs.readFileSync(res.inboxMessagePath, "utf8");
    assert.ok(content.includes(`**Task ID:** ${res.taskId}`));
    assert.ok(!content.includes("**Task ID:** temp"));
    assert.ok(content.includes(`aideos_claim_task({ taskId: "${res.taskId}" })`));
    assert.ok(!content.includes('aideos_claim_task({ taskId: "temp" })'));

    const claimed = taskQueue.claimTask(res.taskId, "inbox-reader-agent");
    assert.equal(claimed.status, "claimed");
    assert.equal(claimed.claimedBy, "inbox-reader-agent");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// Test 13: buildTaskContext gracefully handles invalid or non-conforming film identifiers
test("buildTaskContext handles non-conforming film identifiers without throwing exceptions", () => {
  assert.doesNotThrow(() => {
    const context = buildTaskContext({
      eventType: "auto_build_scenes",
      filmId: "Invalid Slug With Spaces & UPPERCASE!",
      filmTitle: "Non Conforming Film",
    });

    assert.equal(context.filmId, "Invalid Slug With Spaces & UPPERCASE!");
    assert.equal(context.filmTitle, "Non Conforming Film");
    assert.equal(context.film, null);
  });
});

// Verify unpaired dispatch preserves durable delivery without invoking the injected tmux effect.
test("dispatchTask without a recorded pane never calls tmux", async (t) => {
  const sessionFile = path.join(ROOT, ".aideos_session.json");
  const previous = fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile) : undefined;
  t.after(() => {
    if (previous) fs.writeFileSync(sessionFile, previous);
    else fs.rmSync(sessionFile, { force: true });
  });
  setAgentSession({ tmuxSession: "aideos", tmuxPane: undefined });
  const calls: string[][] = [];
  const result = await dispatchTask({
    eventType: "custom_directive",
    filmId: "unpaired-test",
    enableFallback: false,
  }, { tmux: (args) => { calls.push(args); return { status: 0 }; } });
  assert.deepEqual(calls, []);
  assert.ok(!result.channels.includes("tmux"));
  assert.ok(result.channels.includes("mcp_queue"));
  assert.ok(result.channels.includes("file_inbox"));
  assert.equal(taskQueue.getTask(result.taskId)?.prompt, result.prompt);
  assert.equal(fs.readFileSync(path.join(ROOT, ".aideos_task.md"), "utf8"), result.prompt);
  const entries = fs.readFileSync(path.join(ROOT, "state", "agent_events.jsonl"), "utf8").trim().split("\n");
  const entry = JSON.parse(entries[entries.length - 1]);
  assert.equal(entry.promptSnippet, result.prompt.slice(0, 100));
});

// Verify persisted pane addressing still delivers through the injected command runner.
test("dispatchTask targets only the recorded pane", async (t) => {
  const sessionFile = path.join(ROOT, ".aideos_session.json");
  const previous = fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile) : undefined;
  t.after(() => {
    if (previous) fs.writeFileSync(sessionFile, previous);
    else fs.rmSync(sessionFile, { force: true });
  });
  setAgentSession({ tmuxSession: "aideos", tmuxPane: "%42" });
  const calls: string[][] = [];
  const result = await dispatchTask({
    eventType: "custom_directive", filmId: "paired-test", enableFallback: false,
  }, { tmux: (args) => { calls.push(args); return { status: 0 }; } });
  assert.ok(result.channels.includes("tmux"));
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0], ["has-session", "-t", "aideos"]);
  assert.deepEqual(calls[2], ["paste-buffer", "-b", calls[1][2], "-t", "%42", "-d"]);
  assert.deepEqual(calls[3], ["send-keys", "-t", "%42", "Enter"]);
});

// Verify existing dispatchTask callers cannot execute real tmux even with a pane configured.
test("dispatchTask disables the default tmux effect under tests", async (t) => {
  const spawn = t.mock.method(childProcess, "spawnSync", () => { throw new Error("Unexpected real process"); });
  const result = await dispatchTask({
    eventType: "custom_directive", filmId: "test-default", pane: "%42", enableFallback: false,
  });
  assert.equal(spawn.mock.callCount(), 0);
  assert.ok(!result.channels.includes("tmux"));
});

// Verify a session name cannot masquerade as a pane, even through an explicit override.
test("dispatchLocalAndTmux rejects session targets and failed pastes", () => {
  const calls: string[][] = [];
  const tmux = (args: string[]) => {
    calls.push(args);
    return { status: args[0] === "paste-buffer" ? 1 : 0 };
  };
  assert.equal(dispatchLocalAndTmux("test", { pane: "aideos" }, { tmux }).tmuxSent, false);
  assert.deepEqual(calls, []);
  assert.equal(dispatchLocalAndTmux("test", { pane: "%42" }, { tmux }).tmuxSent, false);
  assert.equal(calls.some((args) => args[0] === "send-keys"), false);
});
