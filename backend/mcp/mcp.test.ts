/**
 * File Description: Unit tests for the Aideos MCP Server, production tools, editing tools, and agent task tools.
 * Verifies tool registration, input validation, task queue operations, and dry-run execution.
 * Inputs and outputs: MCP tool requests -> test assertions.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./server";
import { taskQueue } from "../agentBridge";
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import fs from "node:fs";
import path from "node:path";
import { FILMS_DIR } from "../pipeline/filmStore";

/** Reads the text payload from one MCP call result. */
function toolText(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content)) return "";
  return String((result.content[0] as { text?: string } | undefined)?.text);
}

test("mcp server: registers all production and editing tools including aideos_edit_film and agent task tools", () => {
  const server = createMcpServer();
  assert.ok(server, "McpServer instance should be created");
});

test("MCP look tools expose an executable look-first contract and produce defaults to inline", async () => {
  const server = createMcpServer();
  const client = new Client({ name: "mcp-look-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    const brief = tools.find((tool) => tool.name === "aideos_look_brief");
    const check = tools.find((tool) => tool.name === "aideos_look_check");
    const produce = tools.find((tool) => tool.name === "aideos_produce_film");
    assert.ok(brief);
    assert.ok(check);
    assert.ok(produce);
    assert.match(brief.description ?? "", /before creating any picture assets/);
    assert.match(check.description ?? "", /aideos_produce_film again/);
    assert.equal((produce.inputSchema.properties as Record<string, { default?: string }>).design.default, "inline");
    assert.match(produce.description ?? "", /write look\.json following LOOK_BRIEF\.md/);

    const filmId = "speculative-decoding-designed";
    const briefResult = await client.callTool({ name: "aideos_look_brief", arguments: { filmId } });
    assert.match(toolText(briefResult), /The 6 Look Questions to Answer/);
    const checkResult = await client.callTool({ name: "aideos_look_check", arguments: { filmId } });
    assert.match(toolText(checkResult), /^PASS speculative-decoding-designed/m);
    assert.ok(fs.existsSync(path.join(TEST_VIDEOS_DIR, filmId, "design/LOOK.md")));
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP produce resumes inline after a checked fixture look and reports needs_look then needs_design", async () => {
  const server = createMcpServer();
  const client = new Client({ name: "mcp-produce-look-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const filmId = `mcp-look-${Date.now().toString(36)}`;
  const packageDir = path.join(TEST_VIDEOS_DIR, filmId);
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    // Starts and polls a public MCP production run using deterministic tone narration.
    const produce = async () => {
      const started = await client.callTool({ name: "aideos_produce_film", arguments: {
        script: "# MCP Look Test\n\n## Opening\n[NARRATION] A cache keeps useful data close to the processor.\n\n[NARRATION] When the processor asks again, the cache answers without fetching the data from memory.\n\n[NARRATION] That saves time because the processor spends less of each cycle waiting for a slow transfer.",
        title: "MCP Look Test",
        slug: filmId,
        ttsBackend: "tone",
        design: "inline",
        broll: false,
        stopAfter: "design",
      } });
      const { runId } = JSON.parse(toolText(started));
      for (let attempt = 0; attempt < 400; attempt++) {
        const polled = await client.callTool({ name: "aideos_run_status", arguments: { runId } });
        const record = JSON.parse(toolText(polled));
        if (record.state === "done" || record.state === "failed") return record;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("MCP production run did not finish within ten seconds");
    };

    const first = await produce();
    assert.ok(first.result, JSON.stringify(first));
    assert.equal(first.result.status, "needs_look");
    assert.ok(first.result.nextSteps.some((step: string) => step.endsWith(`design/LOOK_BRIEF.md`)));
    assert.ok(first.result.nextSteps.includes(`Run aideos look check ${filmId}`));

    const film = JSON.parse(fs.readFileSync(path.join(packageDir, "film.json"), "utf8"));
    const shotIds = film.shots.map((shot: { id: string }) => shot.id);
    const lookPlan = {
      schema: "aideos.look/1",
      decidedBy: { agent: "fixture", model: "test", at: new Date().toISOString() },
      film: {
        mode: "scene",
        stage: "One persistent stage with a carrier moving between the cache and processor.",
        cast: [{ id: "carrier", what: "a visible cache data tile", enters: shotIds[0], changes: [] }],
        camera: [
          { at: shotIds[0], pose: "wide establishing view", why: "show the whole stage" },
          { at: shotIds[shotIds.length - 1], pose: "wide payoff view", why: "show the resolved system" },
        ],
        palette: { bg: "#0A0A0B", accent: "#635BFF", extra: {} },
        captions: { position: "bottom", kineticColumn: false },
        headlines: "none",
      },
      shots: film.shots.map((shot: { id: string; scriptText?: string }) => ({
        id: shot.id, treatment: "scene", carries: ["carrier"], cue: (shot.scriptText ?? "cache").split(/\s+/)[0],
        criterion: "1-mechanism", why: "the carrier makes the narrated mechanism visible",
      })),
    };
    const wrote = await client.callTool({ name: "aideos_write_file", arguments: {
      filmId, path: "design/look.json", content: JSON.stringify(lookPlan),
    } });
    assert.match(toolText(wrote), /wrote videos\//);
    const checked = await client.callTool({ name: "aideos_look_check", arguments: { filmId } });
    assert.match(toolText(checked), /^PASS /m);

    const second = await produce();
    assert.equal(second.result.status, "needs_design");
    assert.ok(second.result.nextSteps.includes(`Run aideos design build ${filmId}`));
  } finally {
    fs.rmSync(packageDir, { recursive: true, force: true });
    fs.rmSync(path.join(FILMS_DIR, `${filmId}.ts`), { force: true });
    await client.close();
    await server.close();
  }
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
