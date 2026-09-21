/**
 * File Description: Comprehensive end-to-end integration tests for the Aideos Bi-Directional Canvas & Edit Loop (Phase 4).
 * Verifies dispatch from the three canvas surfaces (Canvas node additions, On-Canvas AI Editor, Review Critique Studio),
 * real-time telemetry on the live TraceBus, instant studio hot-reload on film.json changes, and hybrid fallback execution.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Film, Shot } from "../../src/dl/schema";
import {
  dispatchTask,
  taskQueue,
  traceBus,
  buildTaskContext,
  buildDirectingPrompt,
  clearAllFallbackTimers,
  type FilmUpdateEvent,
  type TraceStep,
} from "./index";
import { executeCritique } from "../critique/engine";
import { applyEditProgram } from "../editPlanner/interpreter";
import { buildEditContext } from "../editContext/buildEditContext";
import { convertFilmToLayeredFilm, convertLayeredFilmToFilm } from "../../src/dl/convertFilm";
import type { EditOp } from "../editPlanner/schema";

/** Helper to construct a minimal valid test Film for canvas loop testing. */
function createTestFilm(id: string = "test-canvas-loop"): Film {
  return {
    id,
    title: "Test Canvas Loop Film",
    fps: 30,
    accent: "#635BFF",
    theme: {
      background: "dot-grid",
      fontFamily: "geist",
      storyStyle: "script-metaphor",
      cameraAngle: "isometric",
      accent: "#635BFF",
    },
    chapters: ["intro", "details"],
    canvas: {
      nodes: [
        { id: "node-1", label: "Root Station", x: 100, y: 100, w: 200, h: 80 },
        { id: "node-2", label: "Target Station", x: 400, y: 100, w: 200, h: 80 },
      ],
      edges: [{ from: "node-1", to: "node-2", dashed: false }],
    },
    shots: [
      {
        id: "shot-1",
        dur: 5,
        look: "node-1",
        move: "cut",
        stage: "anchor",
        zoom: 1,
        drift: false,
        blocks: [{ c: "Body", text: "Introduction to the spatial canvas architecture." }],
      } as Shot,
      {
        id: "shot-2",
        dur: 5,
        look: "node-2",
        move: "pan",
        stage: "anchor",
        zoom: 1,
        drift: false,
        blocks: [{ c: "ScaleBar", label: "Capacity Scale", value: 0.5, ticks: ["0%", "50%", "100%"], unit: "%" } as any],
      } as Shot,
    ],
  };
}

// Test 1: Surface 1 - Canvas Node & Spatial Graph Additions dispatch to Agent Bridge and emit trace
test("Surface 1: Canvas node additions dispatch to Agent Bridge with full context and emit trace steps", async () => {
  const film = createTestFilm("canvas-add-node-film");
  const tempInbox = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-canvas-inbox-"));
  const capturedSteps: TraceStep[] = [];

  const unsubTrace = traceBus.subscribe((step) => {
    capturedSteps.push(step);
  });

  try {
    const actionDesc = 'User added canvas node "node-3" at (700, 100)';
    const updatedFilm: Film = {
      ...film,
      canvas: {
        ...film.canvas,
        nodes: [
          ...film.canvas.nodes,
          { id: "node-3", label: "New Node", x: 700, y: 100, w: 200, h: 80 },
        ],
      },
    };

    const dispatch = await dispatchTask({
      eventType: "canvas_updated",
      filmId: updatedFilm.id,
      filmTitle: updatedFilm.title,
      customInstruction: actionDesc,
      inboxDir: tempInbox,
      metadata: { action: "add_node", nodeId: "node-3", totalNodes: 3 },
    });

    assert.ok(dispatch.ok);
    assert.equal(dispatch.task.eventType, "canvas_updated");
    assert.equal(dispatch.task.filmId, film.id);
    assert.ok(dispatch.prompt.includes("User added canvas node"));

    // Verify task in TaskQueue
    const queuedTask = taskQueue.getTask(dispatch.taskId);
    assert.ok(queuedTask);
    assert.equal(queuedTask.status, "pending");

    // Record trace step as editor endpoint does
    traceBus.recordStep({
      phase: "authoring",
      source: "canvas",
      filmId: film.id,
      title: "Canvas: Add Node",
      description: actionDesc,
      status: "done",
      details: ["Nodes: 3", "Edges: 1", "Shots: 2"],
    });

    const canvasSteps = capturedSteps.filter((s) => s.source === "canvas" && s.filmId === film.id);
    assert.equal(canvasSteps.length, 1);
    assert.equal(canvasSteps[0].title, "Canvas: Add Node");
    assert.equal(canvasSteps[0].status, "done");

    // Verify Firstmate inbox message was written
    const inboxFiles = fs.readdirSync(tempInbox);
    assert.equal(inboxFiles.length, 1);
    const content = fs.readFileSync(path.join(tempInbox, inboxFiles[0]), "utf8");
    assert.ok(content.includes("canvas_updated"));
    assert.ok(content.includes(film.id));
  } finally {
    unsubTrace();
    clearAllFallbackTimers();
    fs.rmSync(tempInbox, { recursive: true, force: true });
  }
});

// Test 2: Surface 2 - On-Canvas AI-Edit Request dispatches to Bridge and executes dry-run plan & apply
test("Surface 2: On-Canvas AI-Edit request dispatches to bridge, records trace steps, and applies operations", async () => {
  const film = createTestFilm("ai-edit-canvas-film");
  const capturedSteps: TraceStep[] = [];

  const unsubTrace = traceBus.subscribe((step) => {
    capturedSteps.push(step);
  });

  try {
    const editRequest = "Add title overlay at start";

    // 1. Dispatch AI edit task to bridge
    const dispatch = await dispatchTask({
      eventType: "ai_edit",
      filmId: film.id,
      filmTitle: film.title,
      customInstruction: editRequest,
      metadata: { editRequest, dryRun: true },
    });

    assert.ok(dispatch.ok);
    assert.equal(dispatch.task.eventType, "ai_edit");

    // 2. Trace step for planning
    traceBus.recordStep({
      phase: "ai_edit",
      source: "pipeline",
      filmId: film.id,
      title: `AI Edit Request: "${editRequest}"`,
      description: `Planning video edit program for ${film.title}`,
      status: "running",
    });

    // 3. Plan deterministic ops (simulating planner output)
    const plannedOps: EditOp[] = [
      {
        op: "add_text_overlay",
        text: "Transformer Attention Key-Value Cache",
        startSec: 0,
        endSec: 4,
        position: "bottom",
        size: "headline",
      },
    ];

    traceBus.recordStep({
      phase: "ai_edit",
      source: "pipeline",
      filmId: film.id,
      title: `AI Edit Planned: ${plannedOps.length} op(s)`,
      description: "Added introductory hero title text overlay",
      status: "done",
      details: ["add_text_overlay: start=0s, end=4s"],
    });

    // 4. Apply planned program via pure interpreter
    const layered = convertFilmToLayeredFilm(film);
    const context = buildEditContext(layered, [], [], [], {
      fps: 30,
      durationSec: 10,
    });

    const applied = applyEditProgram(layered, plannedOps, context);
    assert.equal(applied.rejected.length, 0);

    const updatedFilm = convertLayeredFilmToFilm(applied.film, film);
    assert.ok(updatedFilm.overlayClips && updatedFilm.overlayClips.length > 0);
    assert.equal((updatedFilm.overlayClips[0].payload as any).text, "Transformer Attention Key-Value Cache");

    // 5. Trace step for applied edit
    traceBus.recordStep({
      phase: "ai_edit",
      source: "pipeline",
      filmId: film.id,
      title: `AI Edit Applied: ${plannedOps.length} op(s)`,
      description: `Successfully applied edit program to ${film.id}`,
      status: "done",
    });

    const aiEditSteps = capturedSteps.filter((s) => s.phase === "ai_edit" && s.filmId === film.id);
    assert.equal(aiEditSteps.length, 3);
    assert.equal(aiEditSteps[0].status, "running");
    assert.equal(aiEditSteps[1].status, "done");
    assert.equal(aiEditSteps[2].status, "done");
  } finally {
    unsubTrace();
    clearAllFallbackTimers();
  }
});

// Test 3: Surface 3 - Review Critique Studio dispatches critique prompt and applies PatchOps
test("Surface 3: Review Critique Studio dispatches critique to bridge and applies deep-diff patch", async () => {
  const film = createTestFilm("critique-studio-film");
  const capturedSteps: TraceStep[] = [];

  const unsubTrace = traceBus.subscribe((step) => {
    capturedSteps.push(step);
  });

  try {
    const critiqueText = "Make the scale bar density 0.75";

    // 1. Dispatch critique task to bridge
    const dispatch = await dispatchTask({
      eventType: "critique",
      filmId: film.id,
      filmTitle: film.title,
      customInstruction: critiqueText,
      metadata: { critique: critiqueText },
    });

    assert.ok(dispatch.ok);
    assert.equal(dispatch.task.eventType, "critique");

    // 2. Execute critique engine
    const critiqueResult = executeCritique({
      critique: critiqueText,
      film,
    });

    assert.ok(critiqueResult.ok);
    assert.ok(critiqueResult.updatedFilm);
    assert.ok(critiqueResult.patchOps.length > 0);

    // Verify targeted patch on shot-2 scale bar density/value
    const targetShot = critiqueResult.updatedFilm.shots.find((s) => s.id === "shot-2");
    assert.ok(targetShot);
    const scaleBarBlock = targetShot.blocks.find((b) => b.c === "ScaleBar") as any;
    assert.ok(scaleBarBlock);
    assert.equal(scaleBarBlock.value, 0.75);

    // 3. Record validation trace step
    traceBus.recordStep({
      phase: "validation",
      source: "pipeline",
      filmId: film.id,
      title: `Critique: "${critiqueText}"`,
      description: critiqueResult.explanation,
      status: "done",
      details: [`Target: ${critiqueResult.target}`, `Patch Ops: ${critiqueResult.patchOps.length}`],
    });

    const critiqueSteps = capturedSteps.filter((s) => s.phase === "validation" && s.filmId === film.id);
    assert.equal(critiqueSteps.length, 1);
    assert.equal(critiqueSteps[0].status, "done");
  } finally {
    unsubTrace();
    clearAllFallbackTimers();
  }
});

// Test 4: Live Studio Hot-Reload Fan-Out via TraceBus & SSE
test("Instant studio hot-reload: traceBus.notifyFilmUpdated broadcasts to all subscribers in real time", () => {
  const film = createTestFilm("hot-reload-fanout-film");
  const receivedUpdates: FilmUpdateEvent[] = [];
  const receivedSteps: TraceStep[] = [];

  const unsubFilm = traceBus.onFilmUpdate((event) => {
    receivedUpdates.push(event);
  });

  const unsubSteps = traceBus.subscribe((step) => {
    receivedSteps.push(step);
  });

  try {
    assert.ok(traceBus.filmSubscriberCount() >= 1);

    const updatedFilm: Film = {
      ...film,
      title: "Updated Film Live State",
      shots: [
        ...film.shots,
        {
          id: "shot-3",
          dur: 4,
          look: "node-2",
          move: "zoom-in",
          stage: "anchor",
          zoom: 1.2,
          drift: false,
          blocks: [{ c: "TextReveal", text: "Payoff conclusion beat." }],
        } as Shot,
      ],
    };

    traceBus.notifyFilmUpdated(film.id, updatedFilm);

    assert.equal(receivedUpdates.length, 1);
    assert.equal(receivedUpdates[0].filmId, film.id);
    assert.equal(receivedUpdates[0].film.title, "Updated Film Live State");
    assert.equal(receivedUpdates[0].film.shots.length, 3);

    // Verify automatic authoring trace step
    const updateSteps = receivedSteps.filter((s) => s.title === "Studio Film Updated" && s.filmId === film.id);
    assert.equal(updateSteps.length, 1);
    assert.ok(updateSteps[0].description.includes("3 shots"));
  } finally {
    unsubFilm();
    unsubSteps();
  }
});

// Test 5: External file modification detection simulation
test("External agent film.json modification triggers studio hot-reload notification", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aideos-film-watch-"));
  const filmSlug = "external-agent-film";
  const pkgDir = path.join(tempDir, filmSlug);
  fs.mkdirSync(pkgDir, { recursive: true });

  const initialFilm = createTestFilm(filmSlug);
  const filmJsonPath = path.join(pkgDir, "film.json");
  fs.writeFileSync(filmJsonPath, JSON.stringify(initialFilm, null, 2), "utf8");

  const receivedUpdates: FilmUpdateEvent[] = [];
  const unsubFilm = traceBus.onFilmUpdate((event) => {
    receivedUpdates.push(event);
  });

  try {
    // Simulate external agent editing film.json on disk
    const modifiedFilm: Film = {
      ...initialFilm,
      title: "Agent Modified Title",
      shots: [
        {
          id: "shot-agent-1",
          dur: 8,
          look: "all",
          move: "hold",
          stage: "anchor",
          zoom: 1,
          drift: false,
          blocks: [{ c: "CodeBlock", code: "const cache = new KVCache();", language: "typescript" }],
        } as Shot,
      ],
    };

    fs.writeFileSync(filmJsonPath, JSON.stringify(modifiedFilm, null, 2), "utf8");

    // Read and notify as the watcher does
    const diskContent = fs.readFileSync(filmJsonPath, "utf8");
    const parsed = JSON.parse(diskContent);
    traceBus.notifyFilmUpdated(filmSlug, parsed);

    assert.equal(receivedUpdates.length, 1);
    assert.equal(receivedUpdates[0].filmId, filmSlug);
    assert.equal(receivedUpdates[0].film.title, "Agent Modified Title");
    assert.equal(receivedUpdates[0].film.shots[0].id, "shot-agent-1");
  } finally {
    unsubFilm();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// Test 6: Hybrid fallback execution when no external agent claims task
test("Hybrid Fallback executes in-process fallback handler when timeout expires", async () => {
  const film = createTestFilm("fallback-test-film");
  let fallbackExecuted = false;
  let fallbackTaskId = "";

  const dispatch = await dispatchTask({
    eventType: "ai_edit",
    filmId: film.id,
    filmTitle: film.title,
    customInstruction: "Auto-trim silences",
    timeoutMs: 40,
    enableFallback: true,
    fallbackHandler: async (task) => {
      fallbackExecuted = true;
      fallbackTaskId = task.id;
    },
  });

  assert.ok(dispatch.ok);
  assert.equal(dispatch.fallbackScheduled, true);

  // Wait for fallback timeout to trigger
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(fallbackExecuted, true);
  assert.equal(fallbackTaskId, dispatch.taskId);

  const finalTask = taskQueue.getTask(dispatch.taskId);
  assert.ok(finalTask);
  assert.equal(finalTask.status, "timed_out");
});

// Test 7: Invariant check - Dispatched tasks and prompt templates contain zero long dashes
test("Design Invariant: Generated task prompts and directing context contain zero em dashes or en dashes", () => {
  const film = createTestFilm("no-dash-film");

  const prompt = buildDirectingPrompt({
    eventType: "canvas_updated",
    filmId: film.id,
    filmTitle: film.title,
    customInstruction: "Connected node-1 to node-2 with standard hyphen",
  });

  // Strict assertion: zero em dashes (\u2014) or en dashes (\u2013)
  assert.ok(!prompt.includes("\u2014"), "Prompt must not contain em dash (\\u2014)");
  assert.ok(!prompt.includes("\u2013"), "Prompt must not contain en dash (\\u2013)");

  const context = buildTaskContext({
    eventType: "critique",
    filmId: film.id,
    customInstruction: "Refine shot durations: keep locked to audio",
  });

  for (const inv of context.designInvariants || []) {
    assert.ok(!inv.includes("\u2014"), `Design invariant must not contain em dash: ${inv}`);
    assert.ok(!inv.includes("\u2013"), `Design invariant must not contain en dash: ${inv}`);
  }
});
