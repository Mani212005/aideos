/**
 * File Description: End-to-end test of the farm with the real native renderer and the real RenderJob services: a fixture film is emitted to a Render IR, staged into the store, leased by a worker, rendered (one second, so it stays fast), mastered, probed and promoted; a second farm renders the same task and must produce the same bytes. The test skips with its reason when the native binary is not built.
 * Inputs and outputs: the hello-scene fixture film and the release `aideos-render` binary -> asserted task result, output file facts and identical digests across two farms.
 * Used by: npm test (Node test runner).
 */

import "../testSupport/fixtureVideosDir";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createContentStore, createLocalCache, directoryBytes } from "./contentStore";
import { createRenderJobExecutor } from "./renderExecutor";
import { nativeRendererVersion } from "./rendererVersion";
import { createSqliteQueue } from "./sqliteQueue";
import { submitFilmTask } from "./submit";
import { createWorker } from "./worker";
import { emitFilmIr, nativeBinaryProblem } from "../nativeRenderer";
import { readFilm } from "../pipeline/filmStore";
import { tempDir } from "../testSupport/farmFixtures";

const problem = nativeBinaryProblem();
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** Runs the whole path on one farm and returns what the task produced. */
async function renderOnAFarm(): Promise<{ outputDigest: string; bytes: number; tempBytes: number; sidecar: Record<string, unknown>; renderer: string }> {
  const tmp = tempDir();
  const film = readFilm("hello-scene");
  assert.ok(film, "the hello-scene fixture exists");
  const queue = createSqliteQueue(path.join(tmp.dir, "queue.sqlite"));
  cleanups.push(() => {
    queue.close();
    tmp.cleanup();
  });
  const store = createContentStore(path.join(tmp.dir, "store"));
  const cache = createLocalCache(path.join(tmp.dir, "cache"), { maxBytes: 1024 ** 3 });
  const workRoot = path.join(tmp.dir, "work");
  const submitted = await submitFilmTask({ queue, store }, { film, emitted: emitFilmIr(film, "reel"), format: "reel", profile: "final", frameRange: [0, 29], rendererVersion: nativeRendererVersion(), owner: "test", priorityClass: "review" });
  assert.equal(submitted.outcome, "enqueued");
  const worker = createWorker({ id: "native-1", queue, store, cache, workRoot, executor: createRenderJobExecutor(), diskReserveBytes: 0, budget: { diskBytes: 1024 ** 3, memoryBytes: 2 * 1024 ** 3 }, freeMemory: () => Number.MAX_SAFE_INTEGER, pollMs: 10 });
  await worker.start();
  const step = await worker.runOnce();
  assert.equal(step.kind, "done", JSON.stringify(step));
  const task = await queue.get(submitted.id);
  assert.ok(task?.result);
  const sidecar = JSON.parse(store.readBytes(task.result.sidecarDigest as string).toString("utf8")) as Record<string, unknown>;
  await worker.shutdown();
  return { outputDigest: task.result.outputDigest, bytes: store.sizeOf(task.result.outputDigest) ?? 0, tempBytes: directoryBytes(workRoot), sidecar, renderer: String(sidecar.renderer) };
}

test("the native renderer renders a stored package on a worker, and a second farm produces the same bytes", { skip: problem ?? false, timeout: 180_000 }, async () => {
  const first = await renderOnAFarm();
  assert.equal(first.renderer, "native");
  assert.ok(first.bytes > 1000, "a real mp4 was stored");
  assert.equal(first.tempBytes, 0, "zero temp bytes after the native render");
  assert.equal((first.sidecar.output as { sizeBytes: number }).sizeBytes, first.bytes);
  const second = await renderOnAFarm();
  assert.equal(second.outputDigest, first.outputDigest, "the same task gives the same bytes on another farm");
});
