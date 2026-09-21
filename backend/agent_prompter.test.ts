/**
 * File Description: Unit tests for the Auto-Prompter & Agent Dispatcher module in backend/agentPrompter.ts.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getAgentSession,
  setAgentSession,
  buildDirectingPrompt,
  dispatchPromptToAgent,
} from "./agentPrompter";

const ROOT_DIR = path.resolve(__dirname, "..");
const TEST_TASK_FILE = path.join(ROOT_DIR, ".aideos_task.md");

test("agentPrompter reads and updates agent session info", () => {
  const original = getAgentSession();

  const updated = setAgentSession({
    agent: "claude",
    sessionType: "tmux",
    tmuxSession: "aideos-test-sess",
  });

  assert.equal(updated.agent, "claude");
  assert.equal(updated.tmuxSession, "aideos-test-sess");

  const readBack = getAgentSession();
  assert.equal(readBack.tmuxSession, "aideos-test-sess");

  // Restore original
  setAgentSession(original);
});

test("buildDirectingPrompt formats auto_build_scenes event with screenplay and audio references", () => {
  const prompt = buildDirectingPrompt({
    event: "auto_build_scenes",
    filmId: "transformer-kv",
    filmTitle: "KV Cache in Transformers",
    durationSec: 45.0,
    shotCount: 6,
  });

  assert.ok(prompt.includes('🎬 [Aideos Studio Auto-Prompter] The human clicked "Auto-Build Scenes from Script"'));
  assert.ok(prompt.includes('for "KV Cache in Transformers" (transformer-kv)'));
  assert.ok(prompt.includes("videos/transformer-kv/script.md"));
  assert.ok(prompt.includes("videos/transformer-kv/film.json"));
  assert.ok(prompt.includes("videos/transformer-kv/voiceover.wav (45.0s, 6 shots)"));
  assert.ok(prompt.includes("docs/DIRECTOR_GUIDE.md"));
  assert.ok(prompt.includes("npm run validate:film videos/transformer-kv/film.json"));
});

test("buildDirectingPrompt formats voiceover_ready event", () => {
  const prompt = buildDirectingPrompt({
    event: "voiceover_ready",
    filmId: "why-dit",
    filmTitle: "Why DiT Replaced U-Net",
    durationSec: 62.4,
    shotCount: 8,
  });

  assert.ok(prompt.includes("🎬 [Aideos Studio Auto-Prompter] Voiceover audio synthesized (62.4s)"));
  assert.ok(prompt.includes('for "Why DiT Replaced U-Net" (why-dit)'));
  assert.ok(prompt.includes("videos/why-dit/voiceover.wav"));
});

test("dispatchPromptToAgent writes task file and dispatches prompt", () => {
  const testPrompt = "🎬 Test Auto-Prompter Prompt " + Date.now();
  const res = dispatchPromptToAgent(testPrompt, { sessionName: "non-existent-test-tmux-session" });

  assert.equal(res.ok, true);
  assert.equal(res.prompt, testPrompt);

  // File fallback must exist
  assert.ok(fs.existsSync(TEST_TASK_FILE));
  const written = fs.readFileSync(TEST_TASK_FILE, "utf8");
  assert.equal(written, testPrompt);
});
