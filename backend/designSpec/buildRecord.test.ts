/**
 * File Description: Behavioural tests for how the pipeline waits for an agent's design: the wait ends
 * on a build that carries the open request's id, and a build from any other cause, however new its
 * file, does not end it. Dispatch is faked, so no live agent session is reached; the agent's work is
 * a build run from inside the fake dispatch.
 * Inputs and outputs: a throwaway copy of the designed demo package -> test assertions.
 * Used by: npm test.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { TEST_VIDEOS_DIR } from "../testSupport/fixtureVideosDir";
import { buildSvgSources } from "../scene/buildSvgSources";
import { buildDesign, readDesignStatus } from "./build";
import { designInputHash, fileDigest, openBuildRequest, readOpenBuildRequest, closeBuildRequest } from "./buildRecord";
import { designFilm } from "./designer";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(TEST_VIDEOS_DIR, "speculative-decoding-designed");
const ID = "zz-build-record-test";
const PKG = path.join(TEST_VIDEOS_DIR, ID);
const SHADOW = path.join(ROOT, "src/dl/films", `${ID}.ts`);

// Copies the designed demo as a film that has a film.json but no design of its own yet.
function setup(): string {
  fs.rmSync(PKG, { recursive: true, force: true });
  fs.cpSync(SRC, PKG, { recursive: true, filter: (f) => !f.endsWith(".wav") && !f.endsWith("status.json") && !f.endsWith("look.json") });
  const rewrite = (file: string) => {
    const text = fs.readFileSync(file, "utf8").split("videos/speculative-decoding-designed/").join(`videos/${ID}/`);
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(text), id: ID }));
  };
  rewrite(path.join(PKG, "film.json"));
  rewrite(path.join(PKG, "design/base-film.json"));
  const spec = fs.readFileSync(path.join(PKG, "design/design.json"), "utf8");
  fs.rmSync(path.join(PKG, "design/design.json"));
  return spec;
}

// Removes the throwaway package and its generated shadow module.
function teardown(): void {
  fs.rmSync(PKG, { recursive: true, force: true });
  fs.rmSync(SHADOW, { force: true });
  buildSvgSources();
}

// Runs designFilm as if an agent were connected: the fake dispatch is the agent's work.
async function designWithFakeAgent(agentWork: (spec: string) => void, spec: string, timeoutMs: number) {
  const before = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    return await designFilm(ID, {
      mode: "inline", judge: false, pollMs: 15, agentTimeoutMs: timeoutMs,
      dispatch: async () => {
        // The agent answers a moment after the task is delivered.
        setTimeout(() => { fs.writeFileSync(path.join(PKG, "design/design.json"), spec); agentWork(spec); }, 40);
        return { taskId: "t-1", channels: ["agent_link"] };
      },
    });
  } finally {
    if (before !== undefined) process.env.NODE_TEST_CONTEXT = before;
  }
}

test("BuildRecord: the wait ends on a build for its own request", async () => {
  const spec = setup();
  try {
    const outcome = await designWithFakeAgent(() => { buildDesign(ID, "agent", { attribute: "open-request" }); }, spec, 4000);
    assert.equal(outcome.source, "agent");
    assert.equal(outcome.status?.state, "passed");
    assert.ok(outcome.status?.requestId, "the build is attributed to the request");
    assert.equal(readOpenBuildRequest(ID), null, "the request is closed once answered");
  } finally {
    teardown();
  }
});

test("BuildRecord: a passing build from another cause, newer than the request, does not end the wait", async () => {
  const spec = setup();
  try {
    const outcome = await designWithFakeAgent(() => { buildDesign(ID, "hand-built"); }, spec, 500);
    assert.equal(outcome.source, "needs_design", "no build carried the request id, so the agent never answered");
    assert.equal(readDesignStatus(ID)?.state, "passed", "the other build did pass");
    assert.equal(readDesignStatus(ID)?.requestId, null);
    assert.equal(readOpenBuildRequest(ID), null, "a request that timed out is closed");
  } finally {
    teardown();
  }
});

test("BuildRecord: the input hash follows what a build is made from, and requests open, supersede and close", () => {
  const spec = setup();
  try {
    fs.writeFileSync(path.join(PKG, "design/design.json"), spec);
    const before = designInputHash(ID);
    assert.equal(designInputHash(ID), before, "the same inputs hash the same");
    fs.writeFileSync(path.join(PKG, "design/design.json"), spec + " ");
    assert.notEqual(designInputHash(ID), before);

    const a = openBuildRequest(ID, "design");
    const b = openBuildRequest(ID, "motion", "m-b");
    assert.equal(readOpenBuildRequest(ID)?.requestId, "m-b", "a newer request supersedes the open one");
    closeBuildRequest(ID, a.requestId);
    assert.equal(readOpenBuildRequest(ID)?.requestId, b.requestId, "closing a superseded request leaves the open one alone");
    closeBuildRequest(ID, b.requestId);
    assert.equal(readOpenBuildRequest(ID), null);
    assert.equal(fileDigest(path.join(PKG, "design/nope.json")), null);
  } finally {
    teardown();
  }
});
