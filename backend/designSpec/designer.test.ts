/**
 * File Description: Tests for generated design briefs, explicit server design and authoring stops without template fallback.
 * A temporary copy of the demo film is designed by a fake server model (first try, and after a
 * repair), and stops for authoring when no model is available. The agent path is
 * skipped: a test must never message a live agent session.
 * Inputs and outputs: design synthesis pipeline fixtures -> test assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import { buildSvgSources } from "../scene/buildSvgSources";
import { readFilm } from "../pipeline/filmStore";
import { writeDesignBrief } from "./brief";
import { designFilm, type DesignLlmCaller } from "./designer";

const ROOT = path.resolve(__dirname, "../..");
const DEMO = path.join(TEST_VIDEOS_DIR, "speculative-decoding-designed");
const STAGE_DEMO = path.join(TEST_VIDEOS_DIR, "iona-receive");
const ID = "tmp-designer-test";
const PKG = path.join(TEST_VIDEOS_DIR, ID);
const STAGE_BRIEF_ID = "tmp-stage-brief-test";
const STAGE_BRIEF_PKG = path.join(TEST_VIDEOS_DIR, STAGE_BRIEF_ID);

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
    const outcome = await designFilm(ID, { mode: "server", skipAgent: true, llmCaller: caller });
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
    const outcome = await designFilm(ID, { mode: "server", skipAgent: true, llmCaller: caller });
    assert.equal(outcome.source, "server-model");
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /"never said" is not spoken in shot "beat-01"/);
  } finally {
    cleanup();
  }
});

test("Designer: inline with no listener stops for design without calling a server model", async () => {
  freshPackage();
  try {
    const outcome = await designFilm(ID, { skipAgent: true, llmCaller: null });
    assert.equal(outcome.source, "needs_design");
    const film = readFilm(ID);
    assert.notEqual(film?.design?.source, "templates");
    assert.equal(film?.scene, undefined);
    assert.ok(fs.existsSync(path.join(PKG, "design/BRIEF.md")), "the brief is still written for a later design");
  } finally {
    cleanup();
  }
});

test("Designer brief: a Three look's performance maps into a worked design/2 example", () => {
  fs.rmSync(STAGE_BRIEF_PKG, { recursive: true, force: true });
  fs.cpSync(STAGE_DEMO, STAGE_BRIEF_PKG, { recursive: true });
  const filmFile = path.join(STAGE_BRIEF_PKG, "film.json");
  fs.writeFileSync(filmFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(filmFile, "utf8")), id: STAGE_BRIEF_ID }, null, 2));
  try {
    const brief = fs.readFileSync(writeDesignBrief(STAGE_BRIEF_ID), "utf8");
    const section = brief.split("## Three-stage performances (")[1];
    assert.ok(section, "Three-stage performance guidance is present");
    const encoded = section.match(/```json\n([\s\S]*?)\n```/)?.[1];
    assert.ok(encoded, "the worked performance example is valid JSON");
    const example = JSON.parse(encoded);
    assert.equal(example.schema, "aideos.design/2");
    assert.deepEqual(example.performances[0], {
      id: "receive-message", action: "receive-v1", actor: "iona", prop: "glider", start: "approach",
      decisive: { shotId: "catch", phrase: "catches", edge: "start", event: "contact" },
      targetOffset: [0, 0, 0], limits: "fail", afterState: "holding the message",
    });
    assert.match(section, /Keep `id`, `action`, `actor`, `prop`, `start`, `decisive` and `afterState` identical/);
  } finally {
    fs.rmSync(STAGE_BRIEF_PKG, { recursive: true, force: true });
  }
});

test("Designer: server failure stops for design and never falls through to templates", async () => {
  freshPackage();
  try {
    let calls = 0;
    const outcome = await designFilm(ID, { mode: "server", skipAgent: true, maxServerAttempts: 2, llmCaller: async () => (calls++, "not json") });
    assert.equal(calls, 2);
    assert.equal(outcome.source, "needs_design");
    assert.notEqual(readFilm(ID)?.design?.source, "templates");
  } finally {
    cleanup();
  }
});

// Manual design builds must record hand-built provenance unless the caller names another source.
test("Designer CLI: design build defaults its source to hand-built", () => {
  freshPackage();
  try {
    fs.copyFileSync(path.join(DEMO, "design/design.json"), path.join(PKG, "design/design.json"));
    fs.cpSync(path.join(DEMO, "visuals"), path.join(PKG, "visuals"), { recursive: true });
    const result = spawnSync(process.execPath, ["--import", "tsx", "backend/cli.ts", "design-build", ID], {
      cwd: ROOT,
      env: { ...process.env, AIDEOS_VIDEOS_DIR: TEST_VIDEOS_DIR },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const status = JSON.parse(fs.readFileSync(path.join(PKG, "design/status.json"), "utf8"));
    assert.equal(status.source, "hand-built");
    assert.match(result.stdout, new RegExp(`PASS design build ${ID} \\(hand-built\\)`));
  } finally {
    cleanup();
  }
});
