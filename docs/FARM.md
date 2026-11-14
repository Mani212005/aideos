# Render farm foundations

Phase 2 of the code-driven film stack plan (section 5, SCALE): a persisted queue, stateless workers, a content-addressed
store and a janitor, so 50 to 100 films render concurrently and as a queue on one machine or a few workers. It reuses
`RenderJob` ([RENDER_JOB.md](RENDER_JOB.md)) for every render. All code is in `backend/farm/` (Node only; the editor
bundle never reaches it). The command is `npm run farm -- <command>`.

Not in this phase: an object store, GPU pools, autoscaling, shot-level segments (the unit is one film in one format),
token buckets for model calls, a Postgres adapter (the `TaskQueue` interface is asynchronous so one can follow), and the
studio export. The studio keeps its in-memory registry (`backend/exportJobs.ts`): its progress callbacks, `prepare` and
`cleanup` hooks and cancel semantics are not a straightforward fit for a queue, so that wiring is left for its own change.

## The task and its id

A task is one film in one format. Its spec is `{irHash, assetDigests, format, profile, frameRange, rendererVersion}`
(`taskSpec.ts`) and its id is the SHA-256 of the canonical spec (sorted keys). Same spec, same id, same bytes on the CPU
path, so a repeat submission is a cache hit and a duplicate run is harmless.

- `irHash` is the digest of the canonical Render IR JSON; the IR is stored under that digest.
- `assetDigests` maps each package file (fonts, artwork, audio) to its digest.
- `rendererVersion` for the native renderer is `native:<first 16 hex of the binary's SHA-256>` (`rendererVersion.ts`), so a
  rebuilt renderer never serves an old cache entry.
- The payload (not part of the id) names the film snapshot in the store, which the RenderJob needs for its sidecar.

`submitFilmTask` (`submit.ts`) stores the IR, every package file and the film snapshot, then enqueues. The farm renders
native films only: `farm submit` refuses a film the native renderer cannot draw and runs the delivery checks and audio
retiming once, at submission, because workers render stored packages.

## The queue

`sqliteQueue.ts` is one SQLite file (WAL, `BEGIN IMMEDIATE` for each write); the interface is in `queue.ts`.

| Rule | Behaviour |
| --- | --- |
| Lease | A worker claims one task with a time-limited lease and extends it by heartbeat. A lease that expires returns the task (the next claim reclaims it). |
| Priority | `studio_export`, then `draft`, then `review`, then `batch_final`. |
| Fair share | Within a class the owner with the fewest running tasks goes first, then the oldest task. `setOwnerCap` limits one owner's concurrent tasks. |
| Delivery | At least once. Output is idempotent, so a stale worker that finishes late is accepted once; the second finisher is told `already_done`. |
| Attempts | Counted when leased, so a crash costs one. Three attempts, a retry waits 1 s, 4 s, ... (`backoffBaseMs`, times four each time), then the task is `dead` and a dead-letter row keeps the reason and the whole log. A dead task is not retried by a repeat submission; `requeueDead` is an explicit action. |
| Back-pressure | `batch_final` work submitted while the oldest ready task is older than `maxBacklogAgeMs` is `parked`, not accepted and starved. Parked work is released oldest first when fewer than `resumeBelowDepth` tasks are ready. Urgent classes are never parked. |
| Disk is a signal | `release` returns a task without spending an attempt, so a full disk pauses leasing instead of failing films. |
| Cache | A finished task answers a repeat with `cache_hit` only while its output is still in the store (`isResultValid`); otherwise the task runs again. A repeat while in flight is `coalesced`, and a better priority class raises the class of the task in flight. |

A database written by a newer schema is refused (`PRAGMA user_version`), the same rule as the version gate of the IR.

## The worker

`worker.ts`: one render at a time. Lease, fetch the task's inputs into the bounded local cache and link them into the
attempt directory (`<work root>/<worker id>/attempt-<task>-a<n>/`), run the executor, promote the mp4 and the sidecar
into the store, acknowledge, and always remove the attempt directory. The executor (`renderExecutor.ts`) is the
existing `createRenderJob` with the native renderer fed the stored package (`createNativeRenderer({ emit })`).

- **Gates.** Before leasing: free disk must exceed the existing 3 GiB reserve (`RENDER_RESERVE_BYTES`) plus the task disk
  budget, and free memory must exceed the task memory budget. Below either, the worker stops leasing and says why. A render
  that reports `RENDER_DISK_LOW` gives the task back for free and pauses leasing.
- **Budgets per task.** 2 GiB memory (resident set of the worker and its children) and 1 GiB disk (the attempt directory),
  sampled every 500 ms. Passing one aborts the task (a failed attempt) and records the peak.
- **Cost.** Worker seconds times the machine price (0.714 USD per hour by default, the plan's 16 vCPU on-demand price) goes
  into the task result, and a `farm` block (worker id, attempt, stage seconds, peaks) is added to the stored
  `<output>.render.json` sidecar. The sidecar differs between workers; the mp4 does not.
- **Log.** One structured log per task, kept in the queue with the task: submitted, leased, attempt started, inputs
  fetched, each stage, output promoted, completed or failed, attempt cleaned (with the bytes removed and the peaks).

## Content-addressed store, cache, garbage collection

`contentStore.ts`: read-only objects named by the SHA-256 of their bytes (`objects/ab/<digest>`), written through `tmp/`
and renamed into place (atomic, repeat is a no-op, a mismatching digest is refused). `LocalCache` fetches from any
`BlobSource` (the seam for an object store), verifies the digest, and evicts the least recently used objects above its
bound (5 GiB by default); a task works on hard links in its attempt directory, so an eviction never breaks a render.

`gc.ts` is mark and sweep: it keeps every input of an unfinished task and the newest output of each film, format, profile
and frame range (live films keep it; other films keep it for `resultTtlMs`). A superseded output (a newer finished task
of the same film and format) and the inputs of dead tasks are not kept. Unmarked objects older than a grace period
(1 hour) are removed. The default age limit is `DEFAULT_OBJECT_MAX_AGE_MS` (7 days); `--ttl-days` overrides it for the store
and for the worker cache, which evicts objects unused for longer. It re-checks the object's time right before removing, and
`submitFilmTask` re-stages once if an input vanished after staging, so a submitter and a collection can overlap. `farm gc`
and the worker treat every package under the videos directory as a live film.

## The janitor

`janitor.ts`. After every task, success or failure, the worker removes its attempt directory. A killed worker cannot, so
the janitor and the store sweep run at every worker start, after every task and on an idle timer (`--sweep-ms`); a failed pass or sweep is reported and the worker carries on: an attempt directory stays only while the queue shows a
live lease for that worker, task and attempt; the directory of a worker that stopped answering goes entirely; stray
entries and unfinished store or cache puts older than 10 minutes go. The pass bar is zero bytes left under the work root.
`farm sweep` runs one sweep by hand.

## Commands

```bash
npm run farm -- worker [--root DIR] [--executor native|stub] [--lease-ms N] [--poll-ms N]
npm run farm -- submit <slug> [--format long|reel|both] [--profile final] [--class batch_final] [--owner NAME]
npm run farm -- status [--json]       # queue depth and age, seconds per state, retries, cache hit rate, free disk, dead letters
npm run farm -- sweep                 # the janitor
npm run farm -- gc                    # mark and sweep the store
npm run farm -- load-test --films 100 --workers 4
```

`SIGTERM` finishes the current task and stops; a second signal gives the running task back. The farm root is `--root`,
`AIDEOS_FARM_DIR` or `~/.aideos/farm` (`queue.sqlite`, `store/`, `cache/`, `work/`, `logs/`).

## The load test

`backend/farm/loadTest.ts` (run by `loadTest.test.ts` at 50 and 100 films, and by `farm load-test`): 4 real worker
processes, the stand-in renderer behind the real RenderJob, both formats of every film, every film submitted twice (the second
pass arrives while the first runs), and workers SIGKILLed in the middle of a render in three waves, each replaced. Pass bar:
every task ends done or dead-lettered with a reason; zero bytes left in temp (after the kills left some and the janitor
removed them); no task rendered more than its attempts; every output equals the deterministic expectation; p95 completion
(since the first submission) within 1.5 times the ideal makespan (tasks times mean worker seconds over workers). The
stand-in sleeps 200 ms per task, so the table measures the farm, not the renderer. Real renders are covered by
`farmNative.test.ts` (one second of a fixture film, rendered on two farms, identical bytes), which skips when the native
binary is not built.

Not measured here: scaling efficiency past one machine (needs the multi-host tier), and the voice, model and review stages
(the plan lists them as the first thing to measure at 10,000 films).

## Known limits

- The claim query sorts the ready tasks of one SQLite file; it is far inside its limits at 100 films and is the first thing to replace (per-owner running counters, or Postgres `FOR UPDATE SKIP LOCKED`) for the 10,000 tier.
- One machine: the janitor and the cache assume the workers share a disk. Workers on other hosts need the object store and a per-host work root, which the `BlobSource` seam and the lease-based janitor were shaped for.
- A worker that renders a package that no longer fits the IR version fails the attempt; the IR version gate (`schema`) already refuses an unknown document.
