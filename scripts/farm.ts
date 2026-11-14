/**
 * File Description: The farm command line: run a worker, submit a film as render tasks, show the queue metrics and dead letters, sweep leftover temp directories, collect garbage in the content store, and run the load test. One farm lives under one root directory (`--root` or AIDEOS_FARM_DIR).
 * Inputs and outputs: a command and flags -> worker processes, queue rows, store objects, printed metrics and the load-test report (exit code 1 when the load-test pass bar fails).
 * Used by: npm run farm, backend/farm/loadTest.ts (it starts workers through the `worker` command).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createContentStore, createLocalCache } from "../backend/farm/contentStore";
import { collectGarbage } from "../backend/farm/gc";
import { createJanitor } from "../backend/farm/janitor";
import { runLoadTest, formatLoadReport } from "../backend/farm/loadTest";
import { farmMetrics, formatMetrics } from "../backend/farm/metrics";
import { farmPaths, farmRoot } from "../backend/farm/paths";
import { PRIORITY_CLASSES, type PriorityClass } from "../backend/farm/taskSpec";
import { createSqliteQueue } from "../backend/farm/sqliteQueue";
import { createRenderJobExecutor } from "../backend/farm/renderExecutor";
import { submitFilmTask } from "../backend/farm/submit";
import { nativeRendererVersion } from "../backend/farm/rendererVersion";
import { createWorker } from "../backend/farm/worker";
import { assertDeliverable } from "../backend/deliveryGate";
import { ensureRetimedAudio } from "../backend/audio";
import { assertBrollReady, type RenderProfile } from "../backend/renderJob";
import { emitFilmIr, nativeBinaryProblem } from "../backend/nativeRenderer";
import { nativeSupport } from "../backend/renderIr/emit";
import { readFilm } from "../backend/pipeline/filmStore";
import { getVideosDir } from "../src/dl/videoPackageLoader";

const GIB = 1024 ** 3;

/** Parsed flags: `--name value` pairs and bare words. */
function parseArgs(argv: string[]): { flags: Map<string, string>; words: string[] } {
  const flags = new Map<string, string>();
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq > 0) flags.set(arg.slice(2, eq), arg.slice(eq + 1));
      else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags.set(arg.slice(2), next);
          i++;
        } else flags.set(arg.slice(2), "true");
      }
    } else words.push(arg);
  }
  return { flags, words };
}

/** Reads a numeric flag with a default; refuses a value that is not a number. */
function numberFlag(flags: Map<string, string>, name: string, fallback: number): number {
  const raw = flags.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} needs a number, got "${raw}"`);
  return value;
}

/** Runs one worker until it is told to stop. */
async function workerCommand(flags: Map<string, string>): Promise<void> {
  const paths = farmPaths(farmRoot(flags.get("root")));
  const queue = createSqliteQueue(paths.queueFile);
  const store = createContentStore(paths.storeDir);
  const cache = createLocalCache(paths.cacheDir, { maxBytes: numberFlag(flags, "cache-gb", 5) * GIB });
  const kind = flags.get("executor") ?? "native";
  let executor;
  if (kind === "stub") {
    const stub = await import("../backend/testSupport/farmStub");
    executor = createRenderJobExecutor({
      makeRenderer: stub.createStubRendererFactory({ renderMs: numberFlag(flags, "stub-ms", 100), bytes: numberFlag(flags, "stub-bytes", 4096), junkBytes: numberFlag(flags, "stub-junk-bytes", 0), ledgerFile: flags.get("ledger") }),
      services: stub.stubServices,
    });
  } else if (kind === "native") {
    const problem = nativeBinaryProblem();
    if (problem) throw new Error(problem);
    executor = createRenderJobExecutor();
  } else throw new Error(`--executor must be native or stub, got "${kind}"`);
  const worker = createWorker({
    id: flags.get("id") ?? `${os.hostname()}-${process.pid}`,
    queue,
    store,
    cache,
    workRoot: paths.workRoot,
    executor,
    leaseMs: numberFlag(flags, "lease-ms", 60_000),
    pollMs: numberFlag(flags, "poll-ms", 500),
    sweepMs: numberFlag(flags, "sweep-ms", 30_000),
    monitorMs: numberFlag(flags, "monitor-ms", 500),
    pricePerHourUsd: numberFlag(flags, "price-per-hour", 0.714),
    onEvent: (line) => console.log(line),
  });
  let signals = 0;
  const onSignal = (): void => {
    signals++;
    console.log(signals === 1 ? "[farm] stopping after the current task (signal again to give it back now)" : "[farm] giving the running task back");
    worker.stop(signals > 1);
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  await worker.run();
  queue.close();
}

/** Stages a film in each requested format as render tasks. */
async function submitCommand(flags: Map<string, string>, words: string[]): Promise<void> {
  const slug = words[0];
  if (!slug) throw new Error("usage: farm submit <slug> [--format long|reel|both] [--profile draft|review|final] [--class studio_export|draft|review|batch_final] [--owner NAME]");
  const paths = farmPaths(farmRoot(flags.get("root")));
  const queue = createSqliteQueue(paths.queueFile);
  const store = createContentStore(paths.storeDir);
  const film = readFilm(slug);
  if (!film) throw new Error(`No film found for "${slug}"`);
  const formats = (flags.get("format") ?? "both") === "both" ? (["long", "reel"] as const) : ([flags.get("format")] as Array<"long" | "reel">);
  const profile = (flags.get("profile") ?? "final") as RenderProfile;
  const priorityClass = (flags.get("class") ?? "batch_final") as PriorityClass;
  if (!PRIORITY_CLASSES.includes(priorityClass)) throw new Error(`--class must be one of ${PRIORITY_CLASSES.join(", ")}`);
  const problem = nativeBinaryProblem();
  if (problem) throw new Error(problem);
  const rendererVersion = nativeRendererVersion();
  for (const format of formats) {
    if (format !== "long" && format !== "reel") throw new Error(`--format must be long, reel or both, got "${String(format)}"`);
    const reasons = nativeSupport(film, format);
    if (reasons.length) throw new Error(`The farm renders native films only, and the native renderer cannot draw "${slug}" (${format}): ${reasons.join("; ")}`);
    // The checks the RenderJob runs for a live film run here, once, because workers render stored packages.
    assertDeliverable([{ film, format }]);
    assertBrollReady(film);
    ensureRetimedAudio(film);
    const emitted = emitFilmIr(film, format);
    const result = await submitFilmTask({ queue, store }, { film, emitted, format, profile, rendererVersion, owner: flags.get("owner") ?? os.userInfo().username, priorityClass });
    console.log(`${slug} ${format}: ${result.outcome} (task ${result.id.slice(0, 16)}, ${result.state})`);
  }
  queue.close();
}

/** Prints the metrics and the dead letters. */
async function statusCommand(flags: Map<string, string>): Promise<void> {
  const paths = farmPaths(farmRoot(flags.get("root")));
  const queue = createSqliteQueue(paths.queueFile);
  const store = createContentStore(paths.storeDir);
  const metrics = await farmMetrics({ queue, store, cacheDir: paths.cacheDir, workRoot: paths.workRoot });
  console.log(flags.has("json") ? JSON.stringify(metrics, null, 2) : formatMetrics(metrics));
  for (const dead of await queue.deadLetters()) console.log(`dead ${dead.taskId.slice(0, 16)} after ${dead.attempts} attempts: ${dead.reason}`);
  queue.close();
}

/** Sweeps leftover attempt directories and unfinished puts. */
async function sweepCommand(flags: Map<string, string>): Promise<void> {
  const paths = farmPaths(farmRoot(flags.get("root")));
  const queue = createSqliteQueue(paths.queueFile);
  const janitor = createJanitor({ workRoot: paths.workRoot, queue, stores: [createContentStore(paths.storeDir), createContentStore(paths.cacheDir)], workerStaleMs: numberFlag(flags, "stale-ms", 90_000) });
  console.log(JSON.stringify(await janitor.sweep(), null, 2));
  queue.close();
}

/** Collects garbage in the store; the films under the videos directory are live. */
async function gcCommand(flags: Map<string, string>): Promise<void> {
  const paths = farmPaths(farmRoot(flags.get("root")));
  const queue = createSqliteQueue(paths.queueFile);
  const store = createContentStore(paths.storeDir);
  const liveFilms = new Set(fs.existsSync(getVideosDir()) ? fs.readdirSync(getVideosDir()) : []);
  const report = await collectGarbage({ store, queue, liveFilms, resultTtlMs: numberFlag(flags, "ttl-days", 7) * 86_400_000, graceMs: numberFlag(flags, "grace-minutes", 60) * 60_000 });
  console.log(JSON.stringify(report, null, 2));
  queue.close();
}

/** Runs the load test and exits 1 when the pass bar fails. */
async function loadTestCommand(flags: Map<string, string>): Promise<void> {
  const root = flags.get("root") ?? fs.mkdtempSync(path.join(os.tmpdir(), "aideos-farm-load-"));
  const report = await runLoadTest({
    root,
    films: numberFlag(flags, "films", 50),
    workers: numberFlag(flags, "workers", 4),
    renderMs: numberFlag(flags, "render-ms", 200),
    killWaves: numberFlag(flags, "kill-waves", 3),
    killFraction: numberFlag(flags, "kill-fraction", 0.1),
  });
  console.log(formatLoadReport(report));
  if (!flags.has("keep") && !flags.has("root")) fs.rmSync(root, { recursive: true, force: true });
  if (!report.pass) process.exitCode = 1;
}

/** Dispatches the command. */
async function main(): Promise<void> {
  const { flags, words } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = words;
  switch (command) {
    case "worker":
      return workerCommand(flags);
    case "submit":
      return submitCommand(flags, rest);
    case "status":
      return statusCommand(flags);
    case "sweep":
      return sweepCommand(flags);
    case "gc":
      return gcCommand(flags);
    case "load-test":
      return loadTestCommand(flags);
    default:
      throw new Error("usage: farm <worker|submit|status|sweep|gc|load-test> [flags] (see docs/FARM.md)");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
