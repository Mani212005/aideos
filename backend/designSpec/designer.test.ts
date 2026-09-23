/**
 * File Description: Tests for the designer's fallback chain.
 * A temporary copy of the demo film is designed by a fake server model (first try, and after a
 * repair), and falls back to flagged templates when no model is available. The agent path is
 * skipped: a test must never message a live agent session.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildSvgSources } from "../scene/buildSvgSources";
import { readFilm } from "../pipeline/filmStore";
import { designFilm, type DesignLlmCaller } from "./designer";

const ROOT = path.resolve(__dirname, "../..");
const DEMO = path.join(ROOT, "videos/speculative-decoding-designed");
const ID = "tmp-designer-test";
const PKG = path.join(ROOT, "videos", ID);

// Creates a fresh undesigned copy of the demo film under a temporary id.
function freshPackage(): void {
  cleanup();
  fs.mkdirSync(path.join(PKG, "design"), { recursive: true });
  const film = JSON.parse(fs.readFileSync(path.join(DEMO, "design/base-film.json"), "utf8"));
  fs.writeFileSync(path.join(PKG, "film.json"), JSON.stringify({ ...film, id: ID }, null, 2));
  fs.copyFileSync(path.join(DEMO, "voiceover_words.json"), path.join(PKG, "voiceover_words.json"));
}

// Removes the temporary package and everything the build generated for it.
function cleanup(): void {
  fs.rmSync(PKG, { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, "src/dl/films", `${ID}.ts`), { force: true });
  buildSvgSources();
}

// The demo's design and artwork as a server-model reply.
function demoReply(): { design: unknown; svgs: Record<string, string> } {
  const svgs: Record<string, string> = {};
  for (const f of fs.readdirSync(path.join(DEMO, "visuals"))) svgs[`visuals/${f}`] = fs.readFileSync(path.join(DEMO, "visuals", f), "utf8");
  return { design: JSON.parse(fs.readFileSync(path.join(DEMO, "design/design.json"), "utf8")), svgs };
}

test("Designer: the server model's design is built, checked and written", async () => {
  freshPackage();
  try {
    const prompts: string[] = [];
    const caller: DesignLlmCaller = async (prompt, system) => {
      prompts.push(prompt);
      assert.match(system, /## What the film says/);
      return "```json\n" + JSON.stringify(demoReply()) + "\n```";
    };
    const outcome = await designFilm(ID, { skipAgent: true, llmCaller: caller });
    assert.equal(outcome.source, "server-model");
    assert.equal(prompts.length, 1);
    const film = readFilm(ID);
    assert.equal(film?.design?.source, "server-model");
    assert.equal(film?.scene?.props.length, 5);
  } finally {
    cleanup();
  }
});

test("Designer: build errors are fed back and the repaired design passes", async () => {
  freshPackage();
  try {
    const prompts: string[] = [];
    const caller: DesignLlmCaller = async (prompt) => {
      prompts.push(prompt);
      const reply = demoReply();
      if (prompts.length === 1) (reply.design as { clips: Array<{ start: unknown }> }).clips[0].start = 'beat-01:"never said"';
      return JSON.stringify(reply);
    };
    const outcome = await designFilm(ID, { skipAgent: true, llmCaller: caller });
    assert.equal(outcome.source, "server-model");
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /"never said" is not spoken in shot "beat-01"/);
  } finally {
    cleanup();
  }
});

test("Designer: with no model the film keeps its template design and is flagged", async () => {
  freshPackage();
  try {
    const outcome = await designFilm(ID, { skipAgent: true, llmCaller: null });
    assert.equal(outcome.source, "templates");
    const film = readFilm(ID);
    assert.equal(film?.design?.source, "templates");
    assert.equal(film?.scene, undefined);
    assert.ok(fs.existsSync(path.join(PKG, "design/BRIEF.md")), "the brief is still written for a later design");
  } finally {
    cleanup();
  }
});

test("Designer: a model that never returns a passing design ends in flagged templates", async () => {
  freshPackage();
  try {
    let calls = 0;
    const outcome = await designFilm(ID, { skipAgent: true, maxServerAttempts: 2, llmCaller: async () => (calls++, "not json") });
    assert.equal(calls, 2);
    assert.equal(outcome.source, "templates");
    assert.match(outcome.note, /failed the design check/);
  } finally {
    cleanup();
  }
});
