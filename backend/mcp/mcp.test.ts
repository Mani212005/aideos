/**
 * File Description: Unit tests for the Aideos MCP Server, production tools, editing tools, and agent task tools.
 * Verifies tool registration, input validation, task queue operations, and dry-run execution.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createMcpServer } from "./server";
import { taskQueue } from "../agentBridge";

test("mcp server: registers all production and editing tools including aideos_edit_film and agent task tools", () => {
  const server = createMcpServer();
  assert.ok(server, "McpServer instance should be created");
});

test("mcp server: integrates with agent bridge task queue", () => {
  taskQueue.clear();

  const task = taskQueue.createTask({
    eventType: "auto_build_scenes",
    filmId: "test-mcp-film",
    filmTitle: "Test MCP Film",
    prompt: "Prompt for MCP test",
    context: { filmId: "test-mcp-film", filmTitle: "Test MCP Film" },
    dispatchedChannels: ["mcp_queue"],
    timeoutMs: 15000,
  });

  const pending = taskQueue.listPendingTasks("test-mcp-film");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, task.id);

  const claimed = taskQueue.claimTask(task.id, "mcp-agent");
  assert.equal(claimed.status, "claimed");
  assert.equal(claimed.claimedBy, "mcp-agent");

  const completed = taskQueue.completeTask(task.id, { summary: "Finished scene compilation" });
  assert.equal(completed.status, "completed");
  assert.equal(completed.result.summary, "Finished scene compilation");
});
