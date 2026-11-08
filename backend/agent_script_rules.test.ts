/**
 * File Description: Guards the captain's rule that an agent never reformats the user's script. Every piece of
 * agent-facing text the studio produces (the Auto-Prompt for each event type, the copy-paste directing prompt,
 * the director task document, the linked-agent preamble, the shared design invariants and the MCP script
 * description) must carry the story-script rule and must not ask for a reformat, restructure, retag or rewrite
 * of the user's narration into the three-tag form.
 * Inputs and outputs: generated agent prompts -> assertions on what they do and do not ask.
 * Used by: npm test.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildDirectingPrompt, DESIGN_INVARIANTS } from "./agentBridge/contextBuilder";
import type { AgentEventType } from "./agentBridge/types";
import { remoteTaskPrompt } from "./agentLink/prompt";
import { AGENT_LINK_PROMPT } from "./agentLink/connectInstructions";
import { createMcpServer } from "./mcp/server";
import { generateAgentPrompt, generateDirectorTaskDocument, STORY_SCRIPT_RULES } from "./scriptIntake";

const EVENTS: AgentEventType[] = [
  "auto_build_scenes",
  "voiceover_ready",
  "script_updated",
  "ai_edit",
  "custom_directive",
  "produce_film",
  "canvas_updated",
  "critique",
  "design_film",
  "reel_cut",
  "frame_review",
];

// Phrasings that would send an agent off to rework what the user wrote.
const ASKS_FOR_REFORMAT = [
  /\b(?:re-?format|re-?structure|re-?tag|re-?write|convert|transform|restyle)\b[^.\n]{0,60}\b(?:the |this |your |user'?s? )?(?:script|narration|screenplay|story|prose)\b/i,
  /\b(?:script|narration|screenplay|story|prose)\b[^.\n]{0,40}\b(?:into|to)\b[^.\n]{0,30}\b(?:\[VISUAL\]|\[NARRATION\]|\[ON SCREEN\]|three-tag|tagged|screenplay format)/i,
  /\bregenerate (?:the )?(?:voice-?over|narration)\b/i,
];

// Removes the one sanctioned sentence group, which names these words only to forbid them.
function withoutRules(text: string): string {
  return text.split(STORY_SCRIPT_RULES).join("");
}

test("every Auto-Prompt event carries no ask to reformat the user's narration, and the main ones carry the rule", () => {
  for (const eventType of EVENTS) {
    const prompt = buildDirectingPrompt({ eventType, filmId: "story-rules-demo", filmTitle: "Story rules demo" });
    for (const pattern of ASKS_FOR_REFORMAT) {
      assert.doesNotMatch(withoutRules(prompt), pattern, `${eventType} prompt must not ask for a reformat`);
    }
  }
  for (const eventType of ["auto_build_scenes", "voiceover_ready", "script_updated", "custom_directive", "produce_film"] as AgentEventType[]) {
    const prompt = buildDirectingPrompt({ eventType, filmId: "story-rules-demo", filmTitle: "Story rules demo" });
    assert.match(prompt, /Fill only the VISUAL and ON SCREEN slots/, `${eventType} prompt instructs agent to fill visual slots`);
    assert.match(prompt, /no reformatting, restructuring or retagging/, `${eventType} prompt forbids reformatting`);
    assert.match(prompt, /only the lines you changed are re-recorded/, `${eventType} prompt explains voiceover cache`);
  }
});

test("the copy-paste prompt, the director task document, the linked-agent preamble and the invariants never ask for a reformat", () => {
  const texts = [
    generateAgentPrompt({ projectId: "demo", filmTitle: "Demo", shotCount: 3, durationSec: 20 }),
    generateDirectorTaskDocument({ projectId: "demo", filmTitle: "Demo", shotCount: 3, durationSec: 20, spokenWordCount: 40 }),
    remoteTaskPrompt("task-1", "design the picture"),
    AGENT_LINK_PROMPT,
    DESIGN_INVARIANTS.join("\n"),
  ];
  for (const text of texts) {
    for (const pattern of ASKS_FOR_REFORMAT) assert.doesNotMatch(withoutRules(text), pattern);
  }
  for (const text of texts.slice(0, 3)) {
    assert.match(text, /Fill only the VISUAL and ON SCREEN slots/);
    assert.match(text, /no reformatting, restructuring or retagging/);
  }
  assert.ok(DESIGN_INVARIANTS.some((line) => /Fill only the VISUAL and ON SCREEN slots/.test(line)));
});

test("the MCP script description tells an agent plain text works as written", async () => {
  const server = createMcpServer();
  const client = new Client({ name: "rules-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    const produce = tools.find((tool) => tool.name === "aideos_produce_film");
    assert.ok(produce, "aideos_produce_film must be registered");
    const scriptDesc = (produce.inputSchema.properties as Record<string, { description?: string }>).script?.description ?? "";
    assert.match(scriptDesc, /Plain text works as written/);
    assert.match(scriptDesc, /narration is never reformatted/);
  } finally {
    await client.close();
    await server.close();
  }
});
