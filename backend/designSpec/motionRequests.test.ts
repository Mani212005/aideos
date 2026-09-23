/**
 * File Description: Tests for Motion you describe: a request goes to the connected agent (or the
 * server model, or is reported as not sent), is settled from the next design build, and can be
 * reverted to the design it replaced. Dispatch is always faked: a real one would reach a live
 * agent session.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseFilm } from "../../src/dl/schema";
import { listMotionRequests, requestMotion, revertMotion } from "./motionRequests";
import { buildSvgSources } from "../scene/buildSvgSources";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "videos/speculative-decoding-designed");
const ID = "zz-motion-requests-test";
const PKG = path.join(ROOT, "videos", ID);
const SHADOW = path.join(ROOT, "src/dl/films", `${ID}.ts`);

// Copies the designed demo film into a throwaway package.
function setup() {
  fs.rmSync(PKG, { recursive: true, force: true });
  fs.cpSync(SRC, PKG, { recursive: true, filter: (f) => !f.endsWith(".wav") && !f.includes(`${path.sep}history`) && !f.endsWith("motion-requests.json") && !f.endsWith("status.json") });
  const film = JSON.parse(fs.readFileSync(path.join(PKG, "film.json"), "utf8"));
  film.id = ID;
  const base = JSON.parse(fs.readFileSync(path.join(PKG, "design/base-film.json"), "utf8"));
  base.id = ID;
  // The copied scene points at the demo's artwork; point it at the copy.
  const text = JSON.stringify(film).split("videos/speculative-decoding-designed/").join(`videos/${ID}/`);
  fs.writeFileSync(path.join(PKG, "film.json"), text);
  fs.writeFileSync(path.join(PKG, "design/base-film.json"), JSON.stringify(base).split("videos/speculative-decoding-designed/").join(`videos/${ID}/`));
  return parseFilm(JSON.parse(text));
}

// Removes the throwaway package and its generated shadow module.
function teardown() {
  fs.rmSync(PKG, { recursive: true, force: true });
  fs.rmSync(SHADOW, { force: true });
  // A build regenerates the committed artwork index; regenerate it without the throwaway film.
  buildSvgSources();
}

const agentDispatch = async () => ({ taskId: "task-1", channels: ["mcp_queue", "agent_link"] });
const nobody = async () => ({ taskId: "task-2", channels: ["mcp_queue", "file_inbox"] });

test("MotionRequests: an agent request is settled by the next design build", async () => {
  const film = setup();
  try {
    const r = await requestMotion(film, "beat-02", "drop a tile per word", { dispatch: agentDispatch });
    assert.deepEqual([r.by, r.state, r.hadDesign], ["agent", "sent", true]);
    assert.ok(fs.existsSync(path.join(PKG, "design/history", `${r.id}.json`)), "the replaced design is kept");
    assert.equal(listMotionRequests(ID)[0].state, "sent", "no build yet");

    // The agent's first build fails; it is still working, so that is not the answer yet.
    const status = (state: string, errors: string[], offset: number) =>
      fs.writeFileSync(path.join(PKG, "design/status.json"), JSON.stringify({ state, source: "agent", at: new Date(Date.now() + offset).toISOString(), errors, findings: [] }));
    status("failed", ["clips.9.easing: invalid"], 1000);
    const [working] = listMotionRequests(ID);
    assert.equal(working.state, "sent");
    assert.match(working.message ?? "", /still working; its last build failed: clips\.9\.easing/);

    status("passed", [], 2000);
    const [settled] = listMotionRequests(ID);
    assert.equal(settled.state, "passed");

    // An agent that never gets it right is given up on after 30 minutes.
    const second = await requestMotion(film, "beat-03", "another", { dispatch: agentDispatch });
    status("failed", ["still wrong"], 3000);
    assert.equal(listMotionRequests(ID)[0].state, "sent");
    const late = listMotionRequests(ID, () => Date.parse(second.at) + 31 * 60 * 1000)[0];
    assert.deepEqual([late.state, late.message], ["failed", "still wrong"]);
  } finally {
    teardown();
  }
});

test("MotionRequests: with no agent it uses the server model, or says it was not sent", async () => {
  const film = setup();
  try {
    const none = await requestMotion(film, "beat-02", "pulse it", { dispatch: nobody, llmCaller: null });
    assert.equal(none.state, "undelivered");
    assert.match(none.message ?? "", /Connect agent/);

    let told = "";
    const r = await requestMotion(film, "beat-02", "pulse it", {
      dispatch: nobody,
      llmCaller: async () => "{}",
      runServerModel: async (_id, instruction) => {
        told = instruction;
        return { state: "passed", errors: [] };
      },
    });
    assert.equal(r.by, "server-model");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(told, /shot beat-02/);
    assert.equal(listMotionRequests(ID).find((x) => x.id === r.id)?.state, "passed");
    await assert.rejects(requestMotion(film, "beat-99", "x", { dispatch: nobody }), /no shot/);
    await assert.rejects(requestMotion(film, "beat-02", "  ", { dispatch: nobody }), /describe what should move/);
  } finally {
    teardown();
  }
});

test("MotionRequests: revert puts the replaced design back and rebuilds the film", async () => {
  const film = setup();
  try {
    const spec = path.join(PKG, "design/design.json");
    const before = fs.readFileSync(spec, "utf8");
    const r = await requestMotion(film, "beat-02", "change it", { dispatch: agentDispatch });
    // The agent's change: drop the last clip.
    const changed = JSON.parse(before);
    changed.clips = changed.clips.slice(0, -1);
    fs.writeFileSync(spec, JSON.stringify(changed));
    const reverted = revertMotion(ID, r.id);
    assert.equal(reverted.state, "reverted");
    assert.deepEqual(JSON.parse(fs.readFileSync(spec, "utf8")), JSON.parse(before));
    assert.equal(JSON.parse(fs.readFileSync(path.join(PKG, "design/status.json"), "utf8")).state, "passed");
    assert.equal(JSON.parse(fs.readFileSync(path.join(PKG, "film.json"), "utf8")).design.source, "hand-built", "a revert keeps who made the design");
    assert.throws(() => revertMotion(ID, "m-missing"), /no motion request/);
  } finally {
    teardown();
  }
});
