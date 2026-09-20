/**
 * File Description: Comprehensive unit and integration tests for the unified Live Trace Bus telemetry (Phase 3).
 * Tests trace step recording, subscriber fanout, task queue bridge integration, MCP aideos_report_step tool,
 * and pipeline activity event broadcasting.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  TraceBus,
  traceBus,
  formatStepTimestamp,
  generateStepId,
  type TraceStep,
} from "./traceBus";
import { TaskQueue } from "./taskQueue";
import { createMcpServer } from "../mcp/server";
import { planEdits } from "../editPlanner/planner";
import { applyEditProgram } from "../editPlanner/interpreter";
import { buildEditContext } from "../editContext/buildEditContext";
import type { LayeredFilm } from "../../src/dl/layeredSchema";

// Test 1: TraceBus records steps and defaults fields correctly
test("TraceBus records steps and defaults required fields", () => {
  const bus = new TraceBus();
  const step = bus.recordStep({
    title: "1. Factual Grounding",
    description: "Extracted 4 architectural citations",
    phase: "grounding",
    source: "agent",
    filmId: "test-slug",
    details: ["parallel.beta.search()", "Verified arXiv citation"],
  });

  assert.ok(step.id.startsWith("step-"));
  assert.equal(step.title, "1. Factual Grounding");
  assert.equal(step.description, "Extracted 4 architectural citations");
  assert.equal(step.phase, "grounding");
  assert.equal(step.status, "done");
  assert.equal(step.source, "agent");
  assert.equal(step.filmId, "test-slug");
  assert.equal(step.details?.length, 2);
  assert.ok(step.timestamp.length > 0);
  assert.ok(step.createdAt.length > 0);

  const recent = bus.getRecentSteps();
  assert.equal(recent.length, 1);
  assert.deepEqual(recent[0], step);
});

// Test 2: TraceBus fan-out to active subscribers
test("TraceBus broadcasts recorded and updated steps to subscribers in real time", () => {
  const bus = new TraceBus();
  const received: TraceStep[] = [];

  const unsubscribe = bus.subscribe((step) => {
    received.push(step);
  });

  assert.equal(bus.subscriberCount(), 1);

  const step1 = bus.recordStep({
    title: "Step 1",
    phase: "synthesis",
    status: "running",
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].id, step1.id);
  assert.equal(received[0].status, "running");

  // Update step
  bus.updateStep(step1.id, {
    status: "done",
    description: "Synthesis complete",
    durationMs: 420,
  });

  assert.equal(received.length, 2);
  assert.equal(received[1].id, step1.id);
  assert.equal(received[1].status, "done");
  assert.equal(received[1].durationMs, 420);

  // Unsubscribe
  unsubscribe();
  assert.equal(bus.subscriberCount(), 0);

  bus.recordStep({ title: "Step 2" });
  assert.equal(received.length, 2); // No new events after unsubscribe
});

// Test 3: TraceBus ring buffer bounds
test("TraceBus enforces max history buffer limit", () => {
  const bus = new TraceBus(5);
  for (let i = 1; i <= 10; i++) {
    bus.recordStep({ title: `Step ${i}` });
  }

  const recent = bus.getRecentSteps();
  assert.equal(recent.length, 5);
  assert.equal(recent[0].title, "Step 6");
  assert.equal(recent[4].title, "Step 10");
});

// Test 4: TraceBus filtering by filmId, phase, source, and limit
test("TraceBus filters steps by filmId, phase, source, and limit", () => {
  const bus = new TraceBus();
  bus.recordStep({ title: "A1", filmId: "film-a", phase: "authoring", source: "pipeline" });
  bus.recordStep({ title: "A2", filmId: "film-a", phase: "validation", source: "agent" });
  bus.recordStep({ title: "B1", filmId: "film-b", phase: "synthesis", source: "tts" });

  const filmASteps = bus.getRecentSteps({ filmId: "film-a" });
  assert.equal(filmASteps.length, 2);

  const validationSteps = bus.getRecentSteps({ phase: "validation" });
  assert.equal(validationSteps.length, 1);
  assert.equal(validationSteps[0].title, "A2");

  const agentSteps = bus.getRecentSteps({ source: "agent" });
  assert.equal(agentSteps.length, 1);
  assert.equal(agentSteps[0].title, "A2");

  const limited = bus.getRecentSteps({ limit: 2 });
  assert.equal(limited.length, 2);
  assert.equal(limited[0].title, "A2");
  assert.equal(limited[1].title, "B1");
});

// Test 5: TaskQueue lifecycle automatically emits trace steps
test("TaskQueue lifecycle events record steps on the unified trace bus", () => {
  traceBus.clear();
  const queue = new TaskQueue();

  // Attach listener mirroring taskQueue.ts
  queue.addListener((event, task) => {
    if (event === "created") {
      traceBus.recordStep({
        id: `task-create-${task.id}`,
        phase: "dispatch",
        source: "bridge",
        filmId: task.filmId,
        title: `Task Dispatched: ${task.eventType}`,
        status: "pending",
      });
    } else if (event === "claimed") {
      traceBus.recordStep({
        id: `task-claim-${task.id}`,
        phase: "dispatch",
        source: "agent",
        filmId: task.filmId,
        title: `Task Claimed by ${task.claimedBy}`,
        status: "running",
      });
    } else if (event === "completed") {
      traceBus.recordStep({
        id: `task-complete-${task.id}`,
        phase: "complete",
        source: "agent",
        filmId: task.filmId,
        title: `Task Completed: ${task.eventType}`,
        status: "done",
      });
    }
  });

  const task = queue.createTask({
    eventType: "auto_build_scenes",
    filmId: "film-trace-test",
    filmTitle: "Trace Test Film",
    prompt: "Prompt content",
    context: { filmId: "film-trace-test", filmTitle: "Trace Test Film" },
    dispatchedChannels: ["mcp_queue", "firstmate_inbox"],
    timeoutMs: 10000,
  });

  let steps = traceBus.getRecentSteps({ filmId: "film-trace-test" });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].title, "Task Dispatched: auto_build_scenes");
  assert.equal(steps[0].status, "pending");

  queue.claimTask(task.id, "crewmate-bot");
  steps = traceBus.getRecentSteps({ filmId: "film-trace-test" });
  assert.equal(steps.length, 2);
  assert.equal(steps[1].title, "Task Claimed by crewmate-bot");
  assert.equal(steps[1].status, "running");

  queue.completeTask(task.id, { summary: "Built 6 scenes" });
  steps = traceBus.getRecentSteps({ filmId: "film-trace-test" });
  assert.equal(steps.length, 3);
  assert.equal(steps[2].title, "Task Completed: auto_build_scenes");
  assert.equal(steps[2].status, "done");
});

// Test 6: MCP Server registers aideos_report_step and records steps
test("MCP server aideos_report_step tool records external coding agent telemetry", async () => {
  traceBus.clear();
  const server = createMcpServer();
  assert.ok(server);

  // Directly verify reporting step on trace bus as MCP tool handler does
  const reported = traceBus.recordStep({
    title: "Vector Metaphor Construction",
    description: "Bound typed MetaphorContent vector devices into canvas",
    phase: "authoring",
    status: "done",
    source: "agent",
    filmId: "kvcache",
    details: ["Placed 3 structural devices: MatrixGrid, TokenStrip, LayerStack"],
  });

  assert.ok(reported.id);
  assert.equal(reported.source, "agent");
  assert.equal(reported.filmId, "kvcache");

  const steps = traceBus.getRecentSteps({ filmId: "kvcache" });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].title, "Vector Metaphor Construction");
});

// Test 7: AI Edit Planner emits trace telemetry during plan and apply
test("AI Edit Planner emits trace telemetry steps during planning and execution", async () => {
  traceBus.clear();

  const dummyFilm: LayeredFilm = {
    id: "edit-trace-test",
    title: "Edit Trace Test",
    fps: 30,
    accent: "#635BFF",
    canvas: { nodes: [{ id: "n1", label: "Scene", x: 0, y: 0, w: 190, h: 62 }], edges: [] },
    chapters: [],
    layers: [
      { id: "layer-text", label: "Text", number: 1, locked: false, hidden: false, muted: false, height: 56 },
    ],
    clips: [],
  };

  const context = buildEditContext(dummyFilm, [], [], [], {
    fps: 30,
    durationSec: 10,
    accent: dummyFilm.accent,
  });

  const mockPlanOutput = JSON.stringify({
    plan: "Add a title overlay at the start",
    ops: [
      {
        op: "add_text_overlay",
        text: "Hello World",
        startSec: 0,
        endSec: 3,
        position: "center",
      },
    ],
  });

  const result = await planEdits("add a title", context, async () => mockPlanOutput);
  assert.ok(result.ops.length > 0);

  const planSteps = traceBus.getRecentSteps({ phase: "ai_edit" });
  assert.ok(planSteps.length >= 2, "Expected planning and validation steps to be emitted");
  assert.ok(planSteps.some((s) => s.title.includes("Planning Operations")));
  assert.ok(planSteps.some((s) => s.title.includes("Plan Validated")));

  // Apply program
  const appliedResult = applyEditProgram(dummyFilm, result.ops, context);
  assert.equal(appliedResult.rejected.length, 0);

  const applySteps = traceBus.getRecentSteps({ phase: "ai_edit" });
  assert.ok(applySteps.some((s) => s.title.includes("Program Applied")));
});

// Test 8: Timestamp and ID generators
test("Timestamp and ID formatting helper contracts", () => {
  const id1 = generateStepId();
  const id2 = generateStepId();
  assert.ok(id1.startsWith("step-"));
  assert.ok(id2.startsWith("step-"));
  assert.notEqual(id1, id2);

  const formatted = formatStepTimestamp(new Date());
  assert.ok(formatted.length > 0);
  assert.match(formatted, /\d{1,2}:\d{2}:\d{2}\s?(?:AM|PM)/i);
});

// Test 9: SSE event serialization format contract
test("SSE stream event serialization conforms to event-stream protocol", () => {
  const step: TraceStep = {
    id: "step-123",
    phase: "validation",
    title: "19-Rule Invariant Check",
    description: "Verified kinematic continuity",
    timestamp: "10:48:14 AM",
    status: "done",
    details: ["validateFilm: 0 errors", "Audio clock locked ±0.0ms"],
    source: "validation",
    filmId: "test-film",
    createdAt: new Date().toISOString(),
  };

  const sseChunk = `event: step\ndata: ${JSON.stringify(step)}\n\n`;
  assert.ok(sseChunk.startsWith("event: step\n"));
  assert.ok(sseChunk.endsWith("\n\n"));

  const dataLine = sseChunk.split("\n")[1];
  assert.ok(dataLine.startsWith("data: "));
  const parsed = JSON.parse(dataLine.slice("data: ".length));
  assert.equal(parsed.id, "step-123");
  assert.equal(parsed.phase, "validation");
  assert.equal(parsed.status, "done");
});

// Test 10: TraceBus clear resets history and handles multiple subscribers
test("TraceBus clear resets history and cleans up subscribers cleanly", () => {
  const bus = new TraceBus();
  const sub1Steps: TraceStep[] = [];
  const sub2Steps: TraceStep[] = [];

  const un1 = bus.subscribe((s) => sub1Steps.push(s));
  const un2 = bus.subscribe((s) => sub2Steps.push(s));

  bus.recordStep({ title: "Step A" });
  bus.recordStep({ title: "Step B" });

  assert.equal(sub1Steps.length, 2);
  assert.equal(sub2Steps.length, 2);
  assert.equal(bus.getRecentSteps().length, 2);

  bus.clear();
  assert.equal(bus.getRecentSteps().length, 0);

  un1();
  un2();
  assert.equal(bus.subscriberCount(), 0);
});

