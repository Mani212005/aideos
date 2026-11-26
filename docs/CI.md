<!--
File Description: How aideos is checked - the one command that owns every CI step, what each job and test layer covers, how to add a journey test, how golden frames are made, and which user journeys and risks each test protects.
-->

# CI and tests

One command owns the list: **`bun run ci`** (`bun scripts/ci.ts`). GitHub Actions and a contributor's laptop use the job
definitions in `scripts/ci.ts`; the local validation tool (`.no-mistakes.yaml`) selects only the
`static` job. Platform-dependent steps can be skipped locally with a reason.
Add a check to `scripts/ci.ts` and it becomes part of the matching job everywhere that job runs.

```bash
bun run ci                      # what a pull request runs: static, unit, journeys, legacy
bun run ci static unit          # named jobs only
bun run ci --list               # every job and the exact command of every step
bun run ci journeys --bail      # stop at the first failing step instead of running them all
bun run ci journeys --shard 2/3 # one third of the journeys, exactly what CI shard 2 runs
```

A job runs all of its steps even after one fails, then prints a timing table (and writes it to the
GitHub job summary), so one run reports every problem.

Every step has a bun form (the default) and an npm form; `AIDEOS_TOOLCHAIN=npm npx tsx scripts/ci.ts <job>`
runs the npm form. See [Toolchain switch (bun or npm)](#toolchain-switch-bun-or-npm).

## Jobs

| Job | Steps | Runs |
| --- | --- | --- |
| `changes` | `scripts/ciChanges.mjs`: lists changed files grouped by area, computes shadow mode decisions and reasons for journeys and legacy, and reports shadow PR risk rating | every PR and push to main |
| `static` | file headers, every test file is wired, eslint (src, backend, scripts, `editor/src`, `editor/vite.config.ts`, `test_fixtures/stillTalking`), `tsc` root (`scripts/typecheck_tracked.ts`: the root tsconfig's own files and options, narrowed to git-tracked files, so untracked or gitignored scratch such as film packages under `videos/` never fails lint, CI or a release), oxlint editor, editor build (`tsc -b` plus vite), `ruff check`, `ruff format --check` | every PR and push to main |
| `unit` | warm the system Chrome (`scripts/warmChrome.ts`), `bun run test` (every `*.test.ts` under `backend/` and `scripts/`, found by glob), native Render IR and renderer tests (`cargo test --locked --manifest-path native/Cargo.toml`), `validate` on the example film, `design:check` on the fixture packages, `eval:look` (every committed look plan parses), `eval:visuals`, `performance:check` | every PR and push to main |
| `journeys` (3 shards) | each shard: install ffmpeg, tesseract and the browser libraries (the pictures journey needs tesseract for the OCR design rule), restore the Rust cache and build the release `aideos-render` (the render jobs of the Three-stage journeys, cel or dots-v1, one performer or several, draw natively), warm the system Chrome (`scripts/warmChrome.ts`), `bun run test:journeys` (real pipeline, character and Three-stage checks, and real renders, including browser journeys for AI edit apply, new-project script save, and screenplay input gating; any todo case fails the job) and `bun run smoke:studio` (real studio: scrub, split, undo and redo, autosave, reload); the three shards split these between them (see [Journeys shards](#journeys-shards)) | every PR and push to main |
| `legacy` | `bun run test:legacy`: golden frames of the films that existed before the 3D work; compares committed Linux baselines | every PR and push to main, Linux only |
| `nightly` | `scripts/nightly_budget.ts`: the whole Iona film, wide and reel, with budgets on wall time, peak memory, peak temp disk and bundle size | 03:17 UTC and on demand, never on a PR |
| `all-green` | fails unless all five jobs above succeeded (for `journeys`, every shard: the job result is the aggregate of its legs) | the one check to require |

Reviewers that need a login (agy, Gemini, the all-check loop) are not part of CI. Their gate is
the measured `aideos review` and the Gemini round described in [REVIEW.md](REVIEW.md), run by the
author before handoff.

Layers, from cheapest to dearest: static, unit and property tests (the maths on generated input),
feature tests with good and bad fixtures, headless journeys (below), regression (golden frames, plus
a journey case for each bug the captain or a user reported), and the captain's eye for art, which no test can replace.

`bun run test:live` opts into the Deepgram audio, live TTS narration and SVG frame-strip checks (provider credentials required for Deepgram); these are excluded from CI. `test:visual` still runs the SVG strip alone.

The seven character and Three-stage suites run unchanged under `backend/journeys/`:

| Previous unit file | Journey file |
| --- | --- |
| `backend/characters/journeys.test.ts` | `backend/journeys/characters.journey.ts` |
| `backend/characters/pixels.test.ts` | `backend/journeys/character_pixels.journey.ts` |
| `backend/characters/retarget.test.ts` | `backend/journeys/character_retarget.journey.ts` |
| `backend/characters/dotsPixels.test.ts` | `backend/journeys/character_dots_pixels.journey.ts` |
| `backend/performance/stage.test.ts` | `backend/journeys/stage_contracts.journey.ts` |
| `backend/review/stageTruth.test.ts` | `backend/journeys/stage_review_truth.journey.ts` |
| `backend/pipeline/characterResume.test.ts` | `backend/journeys/character_resume.journey.ts` |

Both `test:journeys` and `scripts/ci.ts` select every `backend/journeys/**/*.journey.ts` serially, and the workflow journeys job invokes that same CI job on every PR and main push, now as three parallel shards that together select the same files. Their assertions, thresholds and timeouts are preserved.

### Journeys shards

The journeys job is a matrix of three legs, `journeys (shard 1/3)` to `journeys (shard 3/3)`. Each leg runs
`bun run ci journeys --shard <i>/<n>`; `<n>` is `strategy.job-total`, so the shard count is the matrix
and nowhere else. `scripts/ciJourneyShards.ts` plans the split and is the single place to read it:

* **What is split**: every `backend/journeys/**/*.journey.ts` file found on disk, plus the studio smoke step
  (`bun run smoke:studio`) as one more item. Each item runs in exactly one shard. A file is never split.
* **How**: longest first, greedy. Items are sorted by weight (then name), and each goes to the shard with
  the least planned time so far (ties to the lowest shard). There is no clock, random or network input, so
  every leg computes the same plan.
* **Weights**: `JOURNEY_WEIGHTS_SECONDS` is the median seconds of each file over 8 CI journeys jobs. A
  journey that has no entry still runs (it is costed at `DEFAULT_WEIGHT_SECONDS`), so a new journey is never
  skipped; the table only improves balance. When a journey's cost changes a lot, update its entry from a CI log.
  The planned split is 538, 537 and 541 s (spread under 1%).
* **Guarantees** (`scripts/ciJourneyShards.test.ts`): over the real journey list every file runs in one
  shard and no other, for 1 to 6 shards; the smoke step runs once; the shards plan within 10% of each other;
  a bad `--shard` value fails loudly; an empty shard is skipped and never falls back to a bare `node --test`
  that would run everything; the matrix is exactly `1..N`.
* **Failures**: `fail-fast` is off, so a failing shard does not cancel the others and every shard keeps its
  evidence. A failed or cancelled leg makes `needs.journeys.result` non-success and so fails `all-green`.
  Evidence uploads on failure as `journeys-evidence-<shard>` (one artifact per shard). The per-job
  `timeout-minutes` stays 30 and nothing is retried.
* **Branch protection** requires only `all-green`, so the leg names (`journeys (shard 1/3)`) are not
  required checks and can change without touching protection.
* **Why three**: each shard pays a fixed setup of about 76 s (median of 8 runs before the `node_modules` cache: 63 s checkout, apt, `npm ci`
  and caches, plus 13 s Chrome warm-up) on top of its share of about 26 minutes of serial work. Predicted
  wall time: 1 shard about 28 min, 2 shards about 15 min, 3 shards about 10 min, 4 shards about 8 min. Going
  from 2 to 3 shards saves about 4.5 min of wall time for about 1.3 extra runner minutes; a fourth would save
  about 2 min more, but the unit job then sets the wall time. Runner minutes per run rise from
  about 28 to about 31. Measured values for the real run are in the pull request that added the shards.
* **Measured on main** (8 green runs of 21 November 2026, 44872244516 to 44902106289): each shard
  takes 6.3 to 11.1 min (median 8.2 min), well under its 30 min timeout. About 2.9 min of that is setup,
  now including the release `aideos-render` build (63 to 86 s), and the Journeys step is 3.8 to 7.9 min.
  The unit job (10.4 to 13.5 min, median 10.7 min) sets the CI wall time, not the journeys.

## Setup that every job shares

* Every workflow job uses Node 22 and installs through the `.github/actions/install-dependencies` composite
  action (on the default bun path it also installs the Bun of `.bun-version` and runs `bun install`, see
  [Toolchain switch (bun or npm)](#toolchain-switch-bun-or-npm)). On the npm path it restores `node_modules` and `editor/node_modules` from one cache keyed on the OS, the CPU, the
  exact Node version, both `package.json` files, both lockfiles and `.npmrc`, then runs only
  `npx tsx scripts/ensure_generated.ts`. On a miss it runs `npm ci` (npm cache keyed on both lockfiles) and saves the
  cache right after the install, before any step writes into `node_modules`. The bun path does the same under its own key. Why: the `npm ci` step took 39 to
  63 s per job (median 41 s) in GitHub job step timings of real runs on `main` (run ids 44886280947,
  44893547868, 44897331283, 44899769863, 44902106289); the bun evaluation report
  (`data/aideos-bun-evaluation/report.md`, section 1b) recorded 11 to 24 s on 15 Nov and 41 to 64 s on 17 to
  19 Nov with unchanged lockfiles. The effect of the cache is expected, not yet measured: confirm it with this
  pull request's own CI runs by comparing the `Install dependencies` step time per job (the `npm ci` step
  before; the cache restore plus `ensure:generated` after) over at least 3 runs. A pull request branch cannot
  read a cache that another pull request created, so its first run is a miss; caches made by `main` are
  readable everywhere. Jobs that render
  install `ffmpeg` and the Remotion browser libraries, and cache `node_modules/.remotion`. APT packages
  are cached across runs under `/home/runner/.apt-cache` with retry-hardened installs through one composite action, `.github/actions/setup-apt` (detailed under
  [Runner hardening and red-main alert](#runner-hardening-and-red-main-alert)).
* The `unit` job restores the Remotion browser cache, runs `remotion browser ensure` before tests,
  restores the Cargo registry and `native/target` cache keyed by `native/Cargo.lock`, runs the Rust
  Render IR and renderer tests, and installs `tesseract-ocr` so OCR features run without skipping.
* The `unit` job and every `journeys` shard start by warming the system Chrome (`scripts/warmChrome.ts`): it reads
  Chrome's install folder once and makes one headless launch, and prints both timings. On a fresh
  GitHub runner the first launch of `/usr/bin/google-chrome` took a median 8 s and up to 34 s, while
  every later launch took under a second (85 unit jobs, November 2026), so the test that happened to
  launch Chrome first failed its own startup deadline (caption measurement's 25 s `ETIMEDOUT`, the
  character browser's 30 s DevTools port wait). No test deadline was changed; the one-time cost now
  happens before any test runs.
* The J13 caption journey (CI runs 43421951050, 43421991249, 43427291149) and the J3 Apply Edits
  journey (run 43421951050) failed for a different cause: since #207 the studio header said Saved
  while a save was still in flight, so a journey that waited for Saved then read the previous
  `film.json` (or, in J3, a missing `edit_log.jsonl`). In CI J13 failed 0 of 59 runs before #207 and
  3 of 22 after. Locally, holding each film save 600 ms server-side at probability 0.35, J13 failed
  6 of 6 runs before the fix and passed 6 of 6 after; an unconditional 600 ms hold failed 1 of 1
  before and passed 4 of 4 after. The header now says Saving until the save lands, and Apply Edits
  confirms only after its save and edit-log record land. No journey assertion, timeout or wait changed.
* Skipped tests in any test runner are captured and reported honestly as `NOT COVERED (skipped)` in
  the timing summary and job summary, not as passes.
* Renders use **software GL** (`AIDEOS_GL=swangle`, read by `backend/pipeline/render.ts`'s `glFlag`).
  This avoids GPU-dependent rendering on CI. Goldens remain pinned to the CI platform, and the
  update workflow renders them twice on that platform before accepting them. On a Mac the default
  stays `angle`. The legacy golden job also pins Fontconfig to RGB subpixel text antialiasing
  (`FONTCONFIG_FILE=scripts/golden-fonts.conf`) so Linux machines with differing default font setups
  rasterize text identically.
* The journey frame harness uses Remotion's view capture (`DISABLE_FROM_SURFACE=1`). Chromium's
  fractional-device-pixel-ratio surface capture produced two raster variants of Still Talking
  frame 2773, including in a frozen SVG with no fonts, external assets, scripts or animation. More paint
  delays and software rasterization did not remove the variation. View capture keeps device pixel
  ratio at 1 and scales through viewport emulation instead. J9 still requires four independent cold
  renders at 480x270 to have exactly zero changed pixels; no retry or tolerance is involved.
* `ruff` is pinned (`RUFF_VERSION` in `scripts/ci.ts` and in `ci.yml`); locally the step uses an
  installed `ruff`, `python3 -m ruff` or `uvx ruff@<pinned>`, and is skipped with a reason (never
  silently passed) when none exists. CI always runs it.
* Failing frames, reports and studio screenshots land under `.ci-artifacts/`. Artifact uploads use
  `include-hidden-files: true` so `.ci-artifacts` directories are uploaded reliably. The journeys artifact
  uploads on failure, one artifact per shard (`journeys-evidence-1` to `journeys-evidence-3`); legacy evidence and the nightly budget report upload on every run.

## Toolchain switch (bun or npm)

`AIDEOS_TOOLCHAIN` (read only by `scripts/toolchain.ts`) picks the JavaScript toolchain of every CI step.
Unset, the runner picks the default: `bun run <script>` takes the full Bun path, `npm run <script>` takes the npm path,
and a plain shell or CI step takes Bun. `bun` and `npm` force one path. The npm path is the one that ran before the flip
(npm installs, `tsx` on Node, `node --test`), kept so the flip is reversible. Any other value fails the run.

| Where | Back to npm | Return to bun |
| --- | --- | --- |
| GitHub CI, every run | repository variable `AIDEOS_TOOLCHAIN=npm` (Settings, Secrets and variables, Actions, Variables) | delete the variable or set it to `bun` |
| GitHub CI, one run | Actions, CI (or Nightly render budget, or Update goldens), Run workflow, `toolchain: npm` | the input defaults to `bun` |
| A laptop | `npm ci`, then `npm run ci -- <job>` (or `AIDEOS_TOOLCHAIN=npm npx tsx scripts/ci.ts <job>`) | `bun install`, then `bun run ci <job>` |
| The local validation tool | `.no-mistakes.yaml` runs the bun form, and the npm form (with a message) on a machine without bun | |

The package.json toolchain scripts (`ci`, `lint`, `test*`, `goldens:*`, `eval:*`, `performance:*`, `typecheck`,
`smoke:studio`, `ensure:generated` and their pre-hooks) start `node scripts/run.mjs <file.ts>`, which runs the file on
Bun under `bun run` and on `tsx` under `npm run`, so neither runner needs the other installed. The test scripts go
through `scripts/runTests.ts`, which runs the test command of the active toolchain (`bun run test` runs
`scripts/bunTest.ts`, never plain `bun test`, which is Bun's own runner without the aideos test setup; `npm test` runs
`node --test`). The npm forms in `scripts/ci.ts` and the workflows spell the program out (`npx tsx <file>`, the
`node --test` command of `scripts/toolchain.ts`) and keep working as before. The scripts
of the product runtime (`backend`, `validate`, `review`, `design:check`, `render`, `render:reel`, `studio`,
`bundle`, `farm`, `release`) run on Node through `tsx` or the Remotion CLI under either runner, and so do the
editor's `dev` and `build` pre-hooks.

What the bun path changes, step by step:

* **Install.** `oven-sh/setup-bun` installs the Bun of `.bun-version`, then `bun install --frozen-lockfile
  --ignore-scripts` (root, then `--cwd editor`) and `bun scripts/ensure_generated.ts`. Bun reads the same
  `package-lock.json` files; `bunfig.toml` stops it from writing a `bun.lock`, so there is one lockfile and
  nothing can drift. `--ignore-scripts` skips the root `postinstall` (its two commands run as above, the editor
  one frozen) and dependency install scripts, which bun does not trust anyway (`onnxruntime-node`, `protobufjs`,
  `@google/genai`; none is needed, and `.npmrc` is not read by bun). The installed tree has the same package
  versions as npm's except npm's nested `typescript@5.7.3` under `@remotion/eslint-config-flat` and the
  optional `@emnapi/runtime`, which bun leaves out. node_modules is cached under its own key (`bun-node-modules-...`).
  A fresh `bun install --frozen-lockfile` gives the same tree every time (three fresh installs on the Linux
  fleet machine listed the same 696 package directories and versions).
* **The root postinstall** (`scripts/postinstall.mjs`, plain JavaScript) installs editor/ with the package
  manager that is installing the root: `bun install --cwd editor --no-save` and `bun scripts/ensure_generated.ts`
  under `bun install`, `npm --prefix editor ci` and `tsx scripts/ensure_generated.ts` under `npm ci` (the
  Dockerfile, Vercel and `scripts/release.ts` install with npm). `--no-save` because the root `bunfig.toml` does
  not reach `editor/`, and a plain `bun install --cwd editor` would write `editor/bun.lock`.
* **Scripts.** Every `npx tsx <file>` step runs `bun <file>` on the Bun runtime; eslint, `tsc -b` and
  `vite build` run through `bun x --bun --no-install`. The editor build is two steps on this path (`tsc -b`,
  then `vite build`). The `ensure generated files` steps (before the studio smoke, in the shard that runs it,
  and first in the legacy job) run on both paths, where the npm path used to run the `presmoke:studio` and
  `test:legacy` pre-hooks. `bunfig.toml` turns off bun's automatic `.env` loading (Node never loads it; the CLI
  loads its own) and its auto-install of missing packages.
* **Tests.** `bun test` is not a drop-in for `node --test`, so the bun path runs every test command through
  `scripts/bunTest.ts`. It expands the same globs (`backend/**/*.test.ts` and `scripts/**/*.test.ts`, the
  journey and golden globs), sorted, and runs **`bun test --timeout=0 --preload
  backend/testSupport/bunTestEnv.ts --preload backend/testSupport/fixtureVideosDir.ts --reporter=junit
  <file>` once per file, one file at a time**, each in its own process, as `node --test
  --test-concurrency=1` does. It prints bun's own output, a per-file line and a summary (`# tests`, `# pass`,
  `# fail`, `# skipped`, `# todo`, failed files), and writes the TODO and skipped names CI reports (the
  `ciTodoReporter.cjs` JSON). A file fails when its process exits non-zero, writes no JUnit report or
  reports a failure.

Where `bun test` differs from `node --test`, and what the bun path does about it:

| `bun test` by default | `node --test` | bun path |
| --- | --- | --- |
| every file in one process | one process per file | one `bun test` process per file |
| 5 s per-test timeout | no timeout | `--timeout=0` (no timeout) |
| no `NODE_TEST_CONTEXT` | `NODE_TEST_CONTEXT=child-v8` in each file process; production code reads it to keep agents, the vision judge, tmux and the Jev device caller off | `bunTestEnv.ts` sets it (after loading `node:test`, which would otherwise switch bun to its child event stream). Without it `pipeline.test.ts` took 395 s instead of 34 s |
| `NODE_ENV=test`, inherited by children | `NODE_ENV` untouched | `bunTestEnv.ts` puts back the runner's own value |
| loads `.env`, `.env.test` | loads nothing | `env = false` in `bunfig.toml` |
| ignores `NODE_OPTIONS` | children get the fake voice service through `NODE_OPTIONS` | `voiceOfChoiceChildEnv` also sets `BUN_OPTIONS=--preload <fakeVcdPreload.ts>` |
| a `todo` test's body never runs | it runs and its result is ignored | the same outcome: any todo fails CI |

`process.execPath` is `bun` inside a bun test, so a test that spawns `process.execPath --import tsx
backend/cli.ts` runs the CLI on Bun too.

Measured on the Linux fleet machine (12 cores, shared; load 3.5 to 11), same commit, one run each: the unit
suite took 594 s on `node --test` (1792 tests reported: 1791 pass, 1 skipped, 0 fail) and 492 s on the bun
path (1793 tests: 1792 pass, 1 skipped, 0 fail). The per-test name sets are identical apart from
`runStep reports failed, passed and skipped honestly...` in `scripts/ci.test.ts`: Node ran it but never
received its result, because the next test replaced `process.stdout.write`, the channel a `node --test` file
process reports through. That test now passes its writes through, and Node counts all 18 tests of the file.
The CI before and after numbers are in the pull request that added the switch.

Where Node or npm stays, and why:

| Where | What runs | Why |
| --- | --- | --- |
| `package-lock.json`, `editor/package-lock.json`, `.npmrc` | the one lockfile per package; `.npmrc` for npm only | bun reads `package-lock.json` but cannot write it, and the npm path needs it for a reproducible `npm ci`. A `bun.lock` would be a second lockfile that can drift. Change a dependency with `npm install <pkg>` (it updates the lockfile), then `bun install` |
| `scripts/postinstall.mjs` npm branch | `npm --prefix editor ci` | `npm ci` runs the root postinstall on the npm path, the Dockerfile, Vercel and the release install |
| `Dockerfile`, `render.yaml`, `vercel.json` | `npm ci`, the editor build and the vite server on Node | the hosted studio and its deploys; the `node:22` image has no bun, and a deploy cannot be verified from a pull request |
| `scripts/release.ts`, `scripts/releaseGateInputs.ts` | `npm ci` in the stable clone, `npm run ci` as the release gate (which starts `bun scripts/ci.ts`) | the publish step; the gate command is part of the recorded gate configuration (`ciInputs`), so changing it stops `--resume-gates` from reusing a CI gate an earlier attempt passed |
| `bin/aideos` (product launcher), `editor/package.json` `dev` and `build` pre-hooks | the CLI with `tsx` on Node, `npm run validate`, `render`, `studio`, `backend` and the studio server through `npm run dev` | the product runtime, not the toolchain: the shipped CLI, the studio server and Remotion run on Node; `aideos test` and `aideos lint` run `npm test` and `npm run lint` (the scripts pick the toolchain from the runner) because the stable-channel and Docker installs use `npm ci` and may have no bun on PATH |
| `backend/remotionRenderer.ts`, `backend/pipeline/render.ts`, `backend/review/music.ts`, the j14 journey | `npx remotion render` | the Remotion CLI renders on Node |
| `scripts/studioDriver.ts` | `npx vite` (and `npm --prefix editor ci` when editor/ has no node_modules) | the studio smoke and journeys start the studio the way a user does, on Node |
| the `changes` job | `node scripts/ciChanges.mjs` | dependency free and needs no install; Node is on every runner |

## Changed files (shadow mode)

The first job in `.github/workflows/ci.yml` is `changes`. It runs `scripts/ciChanges.mjs` (a dependency-free
script) to inspect pull request changes using `git diff --name-only --no-renames "$BASE_SHA...$HEAD_SHA"`.

* **Area-grouped summary**: Changed files are grouped by area (backend, editor, src, docs, scripts,
  .github, root) with file counts and path lists published to the GitHub Actions job summary.
* **Shadow mode decisions**: Classifies which test suites (`journeys`, `legacy`) would be required based
  on dependency closures. In shadow mode, these decisions are logged in the summary as "would run" or
  "would skip", but all jobs run regardless. No job is skipped in shadow mode.
* **PR risk rating (D5 shadow mode)**: Classifies the risk level of the pull request into `High`,
  `Medium`, or `Low` and reports the rating along with specific triggered reasons in the job summary.
  The rating is computed from rules and operates in shadow mode alongside no-mistakes: it does not
  gate, skip, or fail any jobs.
  * **High risk triggers**:
    * Touches render code: `backend/pipeline/render*`, `src/dl/render*`, `native/**`
    * Touches stage or scene code: `src/dl/scene/**`, `src/dl/Stage*`, `src/dl/Scene*`, `backend/stage/**`, `test_fixtures/stillTalking/**`
    * Touches golden regression code or baselines: `backend/journeys/goldens/**`, `backend/journeys/legacy.golden.ts`, `backend/journeys/goldenResult.ts`
    * Touches CI workflows: `.github/**`
    * Touches dependencies or lockfiles: `package.json`, `package-lock.json`, `editor/package.json`, `editor/package-lock.json`
    * Touches security-sensitive server routes in `editor/vite.config.ts`
    * Touches more than N files (threshold N = 25, calibrated to the 75th percentile of the last 37 PR file counts)
    * Non-PR events (pushes to main, manual workflow dispatches), empty diffs, or git diff errors default to High
  * **Low risk triggers**:
    * Documentation-only changes (`docs/**`, `*.md`, `LICENSE*`)
  * **Medium risk**:
    * All other standard pull requests that do not match High or Low risk rules
* **Fail-safe defaults**: Any condition other than a clean pull request (pushes to main, manual dispatch,
  git diff errors, empty diffs, or diffs over 300 files) defaults to running all jobs.

## Runner hardening and red-main alert

* **APT caching and retry with timeouts**: Every apt install in `ci.yml`, `nightly.yml` and `update-goldens.yml` goes through the one `.github/actions/setup-apt` composite action (input: `packages`). The workflow restores
  and saves `/home/runner/.apt-cache` via `actions/cache@v4`; the action installs with `-o Dir::Cache::Archives=/home/runner/.apt-cache`.
  The action uses three attempts, 80-second per-command timeouts, 20-second HTTP and HTTPS request
  timeouts, increasing 20/40-second backoff, and `-o Acquire::Retries=3`. When the runner's mirror list
  uses Azure's Ubuntu archive, the step adds `archive.ubuntu.com` as a lower-priority fallback. Each
  apt step has its own `timeout-minutes: 10`, which fits the 540-second worst-case retry budget.
* **Red-main alert**: `.github/workflows/main-red-alert.yml` runs on `workflow_run` when the CI workflow
  completes on the main branch. On failure, timed_out, or cancelled conclusions it opens or updates a single
  GitHub issue (`CI: main branch failure`) naming the failing run URL and commit SHA, preventing unnoticed red builds.
  When CI completes with `success` on the current `main` HEAD commit, the `resolve` job automatically closes any open
  `CI: main branch failure` issue with the green run URL and commit SHA.

Rendering tests rewrite the generated `src/dl/activeFilm.ts`, so they run sequentially
(`--test-concurrency=1`) and every harness restores the file afterwards. Check disk first: the
journey harness refuses to start below 3 GiB free (`AIDEOS_JOURNEY_MIN_FREE_GIB`), and the pipeline
refuses a render that would eat into that reserve (`RENDER_DISK_LOW`). Remotion writes every frame of a
format to the temp dir as a PNG and deletes them only after stitching the mp4, so the guard
(`backend/pipeline/renderDiskBudget.ts`) measures real frames in a child process. Scene films sample an
even spread plus the densest shot and tightest camera zoom. Films with full-bleed footage sample about
every two seconds, capped at 40 frames. The estimate uses `frames x the largest sampled frame x 2`, an
encoded output estimate of 25% of that frame estimate capped at 8 GiB, and 128 MiB of fixed bundle and
browser temp. The render starts only if that plus the 3 GiB reserve fits in the free space of the temp
and output folders. During rendering, a watchdog stops the process and removes its owned temp directory
if either disk falls below the reserve. The guard keeps typical scene films within the measured range:
a 54 second 1080p film with 0.1 to 0.3 MB sampled frames is estimated below 1.5 GiB. The error names
the heaviest sampled frame, estimate, free space and reserve; render a shorter range (`renderFrames`)
or free space when it refuses. Sampling costs one extra bundle and browser start per format (about 15
seconds), so a render job (`checkRenderJobDiskBudget`) first runs the same estimate with the largest
PNG a frame of that format can be (`maxFramePngBytes`: 8 bytes per pixel plus 1%) in place of a
sample. When that bound already fits with the reserve in every folder, the render is admitted without
sampling, because no sample can exceed the bound. When it does not fit, real frames are measured and
the refusal rests on the measurement. `checkRenderDiskBudget` always samples (J12 uses it). There is
no override variable: tests inject a fake sampler and `statfs`.

## User journeys and what protects each

| Journey | Protected by | Layer |
| --- | --- | --- |
| J1 make a film with a character end to end | `j1_pipeline.journey.ts`: the PR journey runs the real `runProduction` with the iona-receive fixture, renders wide and reel around the contact frame, and checks output metadata and a drawn frame; a frame is a pure function of its frame number for the Remotion render and for the native export (one and three raster threads give the same frames, each within 38 dB of the frame drawn cold); `native_character_goldens.journey.ts` draws every character film of the native golden set from its package through the emitter and compares it with the committed native frames at the strict tolerance; nightly renders the full film with budgets | journey, nightly |
| J2 narration changes after design, stale work not reused | `j2_retime.journey.ts`: the real pipeline re-narrates with words inserted before "catches", the compiled contact follows the new word, design and render rerun into a new reel and the measured review finds the contact on the word; `backend/journeys/stage_review_truth.journey.ts` (a contact off its word fails adherence even if the recorded cue frame is edited); `backend/pipeline/pipeline.test.ts` (retime refreshes base-film, forced upstream reopens downstream) | journey, feature |
| J3 scrub, save, reload, preview equals export | `scripts/smoke_studio.ts` (keyboard scrub forwards and back with exact frame readout, same picture on return, split, one undo or redo per Cmd/Ctrl+Z, autosave, reload keeps the edit); `j3_studio_edit.journey.ts` (real Chrome: the AI edit Apply Edits gesture applies, saves, is logged and survives a reload, with only the model-backed `/api/ai-edit` answered by the test; a new project's script saves and survives a reload; story inputs remain unavailable until the stored script has loaded); `backend/editPlanner/browserSafety.test.ts` (the apply path bundles for a browser and runs with no Node built-ins, and the real studio bundle has no externalized Node module); export-versus-cold equality (wide and reel); `j3_j5_stage.journey.ts` compares a fresh Remotion Player's first contact-frame draw and later seeks with exported PNGs in both formats (the export side is a Remotion export: the Player stays on three.js, and the Remotion export is the oracle until a WASM preview exists, see [NATIVE_RENDERER.md](NATIVE_RENDERER.md#p45-journeys-and-goldens)) | journey |
| J4 reel crop keeps character and prop clear of captions | `j1_pipeline.journey.ts`: projected character and prop bounds, every frame from approach to recovery, inside the frame and above the caption band in wide and reel; glider attached at the decisive frame; `j4_character_crops.journey.ts` covers Iona, Pip and Marlo with inset and out-of-bounds negatives, and committed Pip and Marlo wide/reel stills are checked by `backend/journeys/character_pixels.journey.ts` | journey, browser pixels |
| J5 second and third character, same action | `j3_j5_stage.journey.ts` runs Iona, Pip and Marlo together through look check, design build, compilation and 13-frame wide/reel production renders; same-frame Player captures hide each object in turn and require attributable pixel changes inside its projected bounds in both formats. Negative checks reject missing props and actor pixels that overlap a hidden prop crop. Unit/property coverage remains in `backend/characters/` | unit, journey |
| J6 resume reopens exactly the right stages | `j6_resume.journey.ts`: an unchanged rerun reuses every production stage and the reel byte for byte, a package character edit reruns design through verify and the new art is in the pixels; `backend/journeys/character_resume.journey.ts` (look hash and design fingerprint carry the character); `pipeline.test.ts`; `renderFrames` is part of the render fingerprint | journey, feature |
| J7 reviews see the 3D stage truthfully | `j7_review_truth.journey.ts`: film facts and shared stage truth project the whole film timeline into wide and reel crops, with contact on the word, camera in that crop and unmeasured craft; `backend/journeys/stage_review_truth.journey.ts` (per-format presence and camera, hidden cast, plain-word facts); `stage_contracts.journey.ts`; `geminiReview.test.ts` | journey, feature |
| J8 failures give a named error | `j8_failures.journey.ts`: a phrase not spoken, an unknown shot and missing artwork are each named and write no film; a failed design stops the run with no mp4; unreachable targets fail the build and leave finite evaluator output; missing character resources and duplicate decisive phrases are refused by name; `j3_j5_stage.journey.ts` disables WebGL in real Chrome and checks export refusal and visible Player status | journey |
| J9 existing SVG and template films render unchanged | `j9_template.journey.ts` (real pipeline, templates), `j9_svg_repeatability.journey.ts` (exact cold-render equality of Still Talking frame 2773), and `legacy.golden.ts` (golden frames of four films; committed Linux baselines) | journey, golden |
| J10 an agent authors from the docs, bad input names the field | `j8_failures.journey.ts` checks bad values in design.json, look.json and character specs through their public validators; `schemaIssues.test.ts` covers nested unions, unknown fields, required values and version tags | unit, journey |
| J11 a contributor opens a PR and the suite reproduces locally | `bun run ci`, `scripts/ci.test.ts` (workflows only call real jobs, every job is run by a workflow, least privilege) | static |
| J12 a long render never fills the disk | `assertRenderDiskBudget` and `checkRenderDiskBudget` (`renderDiskBudget.test.ts`), the estimate against a real render's peak temp (`j12_render_disk.journey.ts`), temp-leak and size assertions in `j1_pipeline.journey.ts`, `stagePublicDir` cleanup never follows a symlink (`harness.test.ts`), nightly peak-temp budget | unit, journey, nightly |
| J13 captions: click-select, move, resize, lock, undo, default position, reload, preview equals export | `j13_caption_placement.journey.ts`: clicks the captions (selects, does not play), checks the ring hugs the rendered card, drags for the whole video, resizes, locks (owner can still drag), undoes, restores the default position and reloads in both formats, then checks native Player caption ink bounds against PNG and MP4 export within 2 px | journey |

### Risks and the check that watches them

| Risk | Check |
| --- | --- |
| overfitting to Iona | `backend/journeys/character_retarget.journey.ts` checks named characters and randomized proportions through the same action (J5); the J4 crop journey checks full evaluated silhouettes for Iona, Pip and Marlo; see [the character-engine risk plan](CHARACTER_ENGINE.md#risks-this-part-must-hold) |
| pixel tests flaky across machines | software GL everywhere in CI; Fontconfig pinned to RGB subpixel rendering for legacy goldens (`scripts/golden-fonts.conf`); goldens made only on the CI platform and validated by rendering twice; manifest records the platform and the test refuses a mismatch |
| out-of-order frame rendering | J3 seek-order test: concurrent export frames equal cold single-frame renders |
| blank first frame / resource races | J1 asserts the contact frame is drawn (luma spread), not flat; unit `J8` cases name the missing resource |
| preview versus export drift | studio picture equality on return (smoke); export-vs-cold equality, including scrambled repeated frame requests (J3); composition-sized Player-vs-export comparison in both formats, including a cold first contact frame and forward, reverse and repeated seeks (J3) |
| checks that pass on SVG-only evidence | J4 reads the projected 3D mesh bounds, not SVG; J7 review presence, contact and camera come from the stage measured per output, never from SVG clips or the recorded cue |
| unreachable targets giving NaN | J8: finite numbers and a failed critique by name |
| cue binding, missing or duplicate phrase | J8: missing phrase, unknown shot and duplicate decisive phrase name the cue and shot; a unique longer phrase resolves successfully |
| render weight and memory | nightly budget: measured 313 s, 2.2 GB RSS, 0.5 GB temp on a Mac |
| CI slowness, logins | parallel jobs, caches, no login-only reviewer in CI |

## How to add a journey test

A journey drives a real entry point the way a user or an agent does and asserts what they would
see. Put it in `backend/journeys/<name>.journey.ts` (the `test:journeys` script finds it by glob;
`scripts/check_tests_wired.ts` fails CI for a test file nothing would run).

```ts
import { journey, probeVideo, decodeFrame, frameStats } from "./harness";
import { produceIona } from "./ionaFilm";

journey("J99 what the user does, in words", async (ctx) => {
  const { result, contactFrame } = await produceIona("journey-example", { windowFrames: 15 });
  const out = result.outputs.find((o) => o.format === "reel")!;
  ctx.keep(out.path); // copied to .ci-artifacts/ if this journey fails
  assert.equal(probeVideo(out.path).height, 1920);
  assert.ok(frameStats(decodeFrame(out.path, { frame: 15, scaleWidth: 480 })).stddev > 8);
});
```

* `journey()` checks disk headroom, gives you a private `ctx.workDir`, restores
  `src/dl/activeFilm.ts`, and saves everything you `ctx.keep()` when the body throws.
* Packages are made in a throwaway videos folder (`backend/testSupport/fixtureVideosDir.ts`);
  never touch `videos/`. Slugs must be unique per journey.
* `produceIona(slug, { windowFrames })` runs the real author-then-resume flow and renders only the
  contact frame plus and minus N, so a journey costs seconds. `ionaFilm.ts` also exports
  `journeyRequest` (the request every journey shares), `writeIonaDesign` (write the fixture look
  and design, with an edit hook for breaking them) and `retargetShotIds`.
* For exact pixels use `openFilm(slug)` from `remotionFrames.ts`: cold `still()` per frame and a
  concurrent `sequence()`, both lossless PNG.
* Renders use Remotion's downloaded headless shell; on a host without it, set
  `AIDEOS_BROWSER_EXECUTABLE` to a local Chrome and `journeyRequest` passes it to the render.
* Prefer structural assertions (bounds, ownership, counts, error text naming the field) over image
  comparisons. A pixel assertion needs a deterministic reason to be equal.
* Journey todos are forbidden: the structured reporter lists them by name and fails the job.
  Record intentionally excluded scope in this document instead of adding a passing placeholder.
* Studio journeys use `backend/testSupport/studioDriver.ts` (`startEditor`, `StudioPage`: real key presses,
  clicks, typing, element screenshots, `intercept` to answer a model-backed `/api/*` call from the test,
  `hold` to pause an `/api/*` request in flight, error collection, and timeout diagnostics reporting the
  last probe failure and page state) and live next to `scripts/smoke_studio.ts` or in `backend/journeys/` (a studio journey
  fails instead of skipping when `AIDEOS_SMOKE_REQUIRED=1`, which CI sets).
* Never paste a real narration, key or personal video into a fixture; add small fixtures under
  `test_fixtures/`.

## Golden frames (legacy regression)

The committed `backend/journeys/goldens/MANIFEST.json` and PNGs protect J9 on Linux. Baselines
are generated only on the CI platform. If the manifest is ever absent, the legacy job says
**NOT COVERED**, never "passed". The real-pipeline template journey also runs.

`backend/journeys/legacy.golden.ts` renders quarter-size PNGs of four films that predate the
character work (`hello-scene`, `sample-explainer`, `inset-stage`, `still-talking`) and compares
them with `backend/journeys/goldens/`. A golden made on a Mac would not match Linux, so goldens are
**only** produced by the **Update goldens** workflow on the CI platform, and the comparison is
skipped (with a message saying so, never a pass) on any other platform. The legacy CI job
(`bun run ci legacy`) pins `FONTCONFIG_FILE` to `scripts/golden-fonts.conf` (`rgba` set to `rgb`),
ensuring Linux hosts lacking an explicit Fontconfig `rgba` setting reproduce the RGB subpixel text
antialiasing used in the committed baselines.

The native renderer has its own, separate golden set that `cargo test` checks (`native/aideos-render/tests/golden.rs`,
described in [NATIVE_RENDERER.md](NATIVE_RENDERER.md#native-golden-frames)); it does not use the **Update goldens** workflow.

What the legacy job reports:

| Situation | Status in the `bun run ci` output and job summary | Exit code |
| --- | --- | --- |
| no `MANIFEST.json` committed | **NOT COVERED**: a `NOT COVERED` line in the table, a GitHub warning annotation and a note in the job summary; the frames it rendered are uploaded as `candidate-goldens` | 0, so the first PR can merge |
| manifest present, every frame matches | `passed` | 0 |
| manifest present and a frame changed, a listed golden is missing, the frame set differs or the platform differs | `failed`, with `golden.png`, `actual.png` and `diff.png` for each changed frame | 1 |
| the golden test exits 0 but leaves no verdict | `failed` (nothing is known to have been checked) | 1 |

The golden test leaves its verdict in `.ci-artifacts/legacy/result.json` (`backend/journeys/goldenResult.ts`),
which `scripts/ci.ts` reads; a result from an earlier run is cleared first.

### Bootstrap (do this once, after this suite is merged)

1. Dispatch **Update goldens** on the default branch: `gh workflow run update-goldens.yml --ref main`.
   The workflow rejects any other ref, renders every frame twice on Linux with software GL, refuses
   any frame the platform does not reproduce exactly, then opens a pull request containing the PNGs
   and `MANIFEST.json`.
2. Review the generated PNGs (look at each one: layout, type, colour) and merge that pull request.
3. Once the manifest is committed, a missing or changed golden is a **hard failure** on CI, and
   the legacy job no longer reports NOT COVERED.

After bootstrap, when a legitimate rendering change moves pixels, dispatch the workflow on the
default branch again. Review and merge its pull request like any other change.

## Branch protection (proposal, not applied)

Require the single check **`all-green`** (it fails unless all five jobs above succeeded, every journeys shard included).
The nightly and update-goldens workflows are not checks. Branch protection is a
repository setting and is left to the captain.

## Cost

Standard GitHub-hosted `ubuntu-24.04` runners, free for a public repository. The PR jobs run in
parallel, so wall time is the slowest job; each job's measured time is in the pull request
description and in the timing table at the end of every run.

## Known gaps (found while building this suite)

The journey suite has **zero todo cases**. CI enforces that count and includes it in the timing
summary. J3, J5, J8 and J10 are enforced by the journeys above.

The Player comparison uses `editor/journeys/player.html`, a real Remotion Player rendering the
editor's `FilmView` at composition size. The test seeks via an ordinary button, waits for the
exact absolute stage frame and fonts, and captures at DPR 1 with the export browser and GL backend.
It compares full-frame lossless PNGs with at most 0.01% of pixels differing by more than one channel
level. This route avoids responsive studio scaling and controls contaminating the picture; the
separate studio smoke journey covers ordinary editing and persistence. It does not claim parity
for audio mixing or every optional overlay/media combination.

Unavailable WebGL is covered by the real Chrome `--disable-webgl` journey in
`j3_j5_stage.journey.ts`; it checks the visible Player error and export refusal. The stage's
readiness and failure contract is documented in [THREE_STAGE_P0.md](THREE_STAGE_P0.md).

Remaining scope:

* Review does not support windowed excerpts; with film data, its stage facts describe the whole film timeline.
* `J1 full-film measured review and captain watch` are not part of the pull-request excerpt or
  nightly budget job; the separate real-film task owns those checks.
* Legacy `any` annotations remain in the shrink-only `LEGACY_ANY` ledger in `eslint.config.mjs`.
  The eslint step covers `editor/src` and `editor/vite.config.ts`; `editor/vite.config.ts` is itself
  a ledger entry (26 `any`), to be typed as its routes move out of it.

## Studio browser smoke check (moved from AGENTS.md)

### Smoke check

- `bun run smoke:studio` (`scripts/smoke_studio.ts`) starts the editor dev server, loads the studio in headless Chrome over the DevTools protocol and fails on a blank page, an uncaught exception, a `console.error`, or a Vite client error. It is part of CI's journeys job. Unit tests run in Node and cannot see browser-only crashes such as a Node built-in leaking into the client bundle (the blank studio after #43). It skips with a warning when no Chrome is installed; set `AIDEOS_SMOKE_REQUIRED=1` to make that a failure.
