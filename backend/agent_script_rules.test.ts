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
import fs from "node:fs";
import path from "node:path";

import { buildDirectingPrompt, DESIGN_INVARIANTS } from "./agentBridge/contextBuilder";
import type { AgentEventType } from "./agentBridge/types";
import { remoteTaskPrompt } from "./agentLink/prompt";
import { AGENT_LINK_PROMPT } from "./agentLink/connectInstructions";
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

test("the story-script rule says: fill the slots, keep the narration, record every narration change, re-record only changed lines", () => {
  assert.match(STORY_SCRIPT_RULES, /Fill only the VISUAL and ON SCREEN slots/);
  assert.match(STORY_SCRIPT_RULES, /no reformatting, restructuring or retagging/);
  assert.match(STORY_SCRIPT_RULES, /whole script from a topic or an empty project/);
  assert.match(STORY_SCRIPT_RULES, /change list/);
  assert.match(STORY_SCRIPT_RULES, /only the lines you changed are re-recorded/);
});

test("every Auto-Prompt event carries no ask to reformat the user's narration, and the main ones carry the rule", () => {
  for (const eventType of EVENTS) {
    const prompt = buildDirectingPrompt({ eventType, filmId: "story-rules-demo", filmTitle: "Story rules demo" });
    for (const pattern of ASKS_FOR_REFORMAT) {
      assert.doesNotMatch(withoutRules(prompt), pattern, `${eventType} prompt must not ask for a reformat`);
    }
  }
  for (const eventType of ["auto_build_scenes", "voiceover_ready", "script_updated", "custom_directive", "produce_film"] as AgentEventType[]) {
    const prompt = buildDirectingPrompt({ eventType, filmId: "story-rules-demo", filmTitle: "Story rules demo" });
    assert.ok(prompt.includes(STORY_SCRIPT_RULES), `${eventType} prompt carries the story-script rule`);
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
  assert.ok(texts[0].includes(STORY_SCRIPT_RULES));
  assert.ok(texts[1].includes(STORY_SCRIPT_RULES));
  assert.ok(texts[2].includes(STORY_SCRIPT_RULES));
  assert.ok(DESIGN_INVARIANTS.some((line) => line.includes(STORY_SCRIPT_RULES)));
});

test("the MCP script description tells an agent plain text works as written", () => {
  const source = fs.readFileSync(path.join(__dirname, "mcp", "server.ts"), "utf8");
  assert.match(source, /Plain text works as written/);
  assert.match(source, /narration is never reformatted/);
});
