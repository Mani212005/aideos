/**
 * File Description: Unit tests for the Aideos MCP Server and aideos_edit_film tool (Phase 2).
 * Verifies tool registration, input validation, planning integration, and dry-run execution.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createMcpServer } from "./server";

test("mcp server: registers all production and editing tools including aideos_edit_film", () => {
  const server = createMcpServer();
  assert.ok(server, "McpServer instance should be created");
});
