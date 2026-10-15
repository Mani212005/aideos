<!--
File Description: How aideos is checked - the one command that owns every CI step, what each job and test layer covers, how to add a journey test, how golden frames are made, and which user journeys and risks each test protects.
-->

# CI and tests

One command owns the list: **`npm run ci`**. GitHub Actions and a contributor's laptop use the job
definitions in `scripts/ci.ts`; the local validation tool (`.no-mistakes.yaml`) selects only the
`unit`, `journeys` and `static` jobs. Platform-dependent steps can be skipped locally with a reason.
Add a check to `scripts/ci.ts` and it becomes part of the matching job everywhere that job runs.

```bash
npm run ci                      # what a pull request runs: static, unit, journeys, legacy
npm run ci -- static unit       # named jobs only
npm run ci -- --list            # every job and the exact command of every step
npm run ci -- journeys --bail   # stop at the first failing step instead of running them all
```

A job runs all of its steps even after one fails, then prints a timing table (and writes it to the
GitHub job summary), so one run reports every problem.

## Jobs

| Job | Steps | Runs |
| --- | --- | --- |
| `static` | file headers, every test file is wired, eslint (src, backend, scripts, editor), `tsc` root, `tsc` editor app, oxlint editor, editor build (`tsc -b` plus vite), `ruff check`, `ruff format --check` | every PR and push to main |
| `unit` | `npm test` (every `*.test.ts` under `backend/` and `scripts/`, found by glob), `validate` on the example film, `design:check` on the fixture packages, `eval:look` (every committed look plan parses), `eval:visuals`, `performance:check` | every PR and push to main |
| `journeys` | `npm run test:journeys` (real pipeline and real renders, below; todo cases are listed as known gaps) and `npm run smoke:studio` (real studio: scrub, split, autosave, reload) | every PR and push to main |
| `legacy` | `npm run test:legacy`: golden frames of the films that existed before the 3D work; reports **NOT COVERED** until baselines are committed | every PR and push to main, Linux only |
| `nightly` | `scripts/nightly_budget.ts`: the whole Iona film, wide and reel, with budgets on wall time, peak memory, peak temp disk and bundle size | 03:17 UTC and on demand, never on a PR |
| `all-green` | fails unless the four jobs above succeeded | the one check to require |

Reviewers that need a login (agy, Gemini, the all-check loop) are not part of CI. Their gate is
the measured `aideos review` and the Gemini round described in [REVIEW.md](REVIEW.md), run by the
author before handoff.

Layers, from cheapest to dearest: static, unit and property tests (the maths on generated input),
feature tests with good and bad fixtures, headless journeys (below), regression (every bug fixed
gets its own test, plus golden frames), and the captain's eye for art, which no test can replace.

## Setup that every job shares

* Every workflow job uses Node 22 and `npm ci` (npm cache keyed on both lockfiles). Jobs that render
  install `ffmpeg` and the Remotion browser libraries, and cache `node_modules/.remotion`.
* Renders use **software GL** (`AIDEOS_GL=swangle`, read by `backend/pipeline/render.ts`'s `glFlag`).
  This avoids GPU-dependent rendering on CI. Goldens remain pinned to the CI platform, and the
  update workflow renders them twice on that platform before accepting them. On a Mac the default
  stays `angle`.
* `ruff` is pinned (`RUFF_VERSION` in `scripts/ci.ts` and in `ci.yml`); locally the step uses an
  installed `ruff`, `python3 -m ruff` or `uvx ruff@<pinned>`, and is skipped with a reason (never
  silently passed) when none exists. CI always runs it.
* Failing frames, reports and studio screenshots land under `.ci-artifacts/`. The journeys artifact
  uploads on failure; legacy evidence and the nightly budget report upload on every run.

Rendering tests rewrite the generated `src/dl/activeFilm.ts`, so they run sequentially
(`--test-concurrency=1`) and every harness restores the file afterwards. Check disk first: the
journey harness refuses to start below 3 GiB free (`AIDEOS_JOURNEY_MIN_FREE_GIB`), and the pipeline
refuses a render whose temp frames could eat that reserve (`RENDER_DISK_LOW`). The guard assumes the
PNG worst case of 3 bytes per pixel, so a three-minute 1080p film needs about 34 GiB free before it
starts; render a shorter range (`renderFrames`) or free space when it refuses.

## User journeys and what protects each

| Journey | Protected by | Layer |
| --- | --- | --- |
| J1 make a film with a character end to end | `j1_pipeline.journey.ts`: the PR journey runs the real `runProduction` with the iona-receive fixture, renders wide and reel around the contact frame, and checks output metadata and a drawn frame; nightly renders the full film with budgets | journey, nightly |
| J2 narration changes after design, stale work not reused | `backend/pipeline/pipeline.test.ts` (existing: retime refreshes base-film, forced upstream reopens downstream) | feature |
| J3 scrub, save, reload, preview equals export | `scripts/smoke_studio.ts` (keyboard scrub forwards and back with exact frame readout, same picture on return, split, autosave, reload keeps the edit); export-versus-cold equality (wide and reel); Player-versus-export pixel comparison is a named `todo` journey | journey, todo |
| J4 reel crop keeps character and prop clear of captions | `j1_pipeline.journey.ts`: projected character and prop bounds, every frame from approach to recovery, inside the frame and above the caption band in wide and reel; glider attached at the decisive frame | journey |
| J5 second and third character, same action | named `todo` journey: part 1 owns the character data format and additional character fixtures | todo |
| J6 resume reopens exactly the right stages | `pipeline.test.ts` (existing); `renderFrames` is part of the render fingerprint | feature |
| J7 reviews see the 3D stage truthfully | `stage.test.ts` and `review.test.ts` (existing) | feature |
| J8 failures give a named error | `j8_failures.journey.ts`: a phrase not spoken, an unknown shot and missing artwork are each named and write no film; a failed design stops the run with no mp4; an unreachable hand target gives finite numbers and a failed grip check; two J8 cases are `todo` (below) | journey |
| J9 existing SVG and template films render unchanged | `j9_template.journey.ts` (real pipeline, templates), `j9_svg_repeatability.journey.ts` (exact cold-render equality of Still Talking frame 2773), and `legacy.golden.ts` (golden frames of four films; **NOT COVERED until the baselines are committed**) | journey, golden |
| J10 an agent authors from the docs, bad input names the field | `j8_failures.journey.ts` todo: an unknown design field is reported as `Invalid input` at root | todo |
| J11 a contributor opens a PR and the suite reproduces locally | `npm run ci`, `scripts/ci.test.ts` (workflows only call real jobs, every job is run by a workflow, least privilege) | static |
| J12 a long render never fills the disk | `assertRenderDiskBudget` (`harness.test.ts`), temp-leak and size assertions in `j1_pipeline.journey.ts`, `stagePublicDir` cleanup never follows a symlink (`harness.test.ts`), nightly peak-temp budget | unit, journey, nightly |

### Risks and the check that watches them

| Risk | Check |
| --- | --- |
| overfitting to Iona | open: part 1's second and third character through the same action (J5) |
| pixel tests flaky across machines | software GL everywhere in CI; goldens made only on the CI platform and validated by rendering twice; manifest records the platform and the test refuses a mismatch |
| out-of-order frame rendering | J3 seek-order test: concurrent export frames equal cold single-frame renders |
| blank first frame / resource races | J1 asserts the contact frame is drawn (luma spread), not flat; unit `J8` cases name the missing resource |
| preview versus export drift | studio picture equality on return (smoke); export-vs-cold equality (J3); a Player-vs-export pixel comparison is open (needs the Player at composition size) |
| checks that pass on SVG-only evidence | J4 reads the projected 3D mesh bounds, not SVG; part 4 owns review truth |
| unreachable targets giving NaN | J8: finite numbers and a failed critique by name |
| cue binding, missing or duplicate phrase | J8: missing phrase and unknown shot are named; duplicate phrase is `todo` (it silently binds the first match) |
| render weight and memory | nightly budget: measured 313 s, 2.2 GB RSS, 0.5 GB temp on a Mac |
| CI slowness, logins | four parallel jobs, caches, no login-only reviewer in CI |

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
* Prefer structural assertions (bounds, ownership, counts, error text naming the field) over image
  comparisons. A pixel assertion needs a deterministic reason to be equal.
* Declare a known gap as `test("...", { todo: "who owns it and why" }, ...)`: it runs in every CI
  pass, shows as todo, and becomes a hard gate when its owner removes the flag.
* Studio journeys use `scripts/studioDriver.ts` (`startEditor`, `StudioPage`: real key presses,
  clicks, element screenshots, error collection) and live next to `scripts/smoke_studio.ts`.
* Never paste a real narration, key or personal video into a fixture; add small fixtures under
  `test_fixtures/`.

## Golden frames (legacy regression)

> **J9 (existing SVG and template films render unchanged) is NOT COVERED at pixel level until the
> baselines are committed.** `backend/journeys/goldens/` is empty on purpose: goldens can only be
> made on the CI platform. The legacy job says **NOT COVERED** (see below), never "passed".
> The real-pipeline template journey (`j9_template.journey.ts`) still runs.

`backend/journeys/legacy.golden.ts` renders quarter-size PNGs of four films that predate the
character work (`hello-scene`, `sample-explainer`, `inset-stage`, `still-talking`) and compares
them with `backend/journeys/goldens/`. A golden made on a Mac would not match Linux, so goldens are
**only** produced by the **Update goldens** workflow on the CI platform, and the comparison is
skipped (with a message saying so, never a pass) on any other platform.

What the legacy job reports:

| Situation | Status in the `npm run ci` output and job summary | Exit code |
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

Require the single check **`all-green`** (it fails unless static, unit, journeys and legacy all
succeeded). The nightly and update-goldens workflows are not checks. Branch protection is a
repository setting and is left to the captain.

## Cost

Standard GitHub-hosted `ubuntu-24.04` runners, free for a public repository. The four PR jobs run in
parallel, so wall time is the slowest job; each job's measured time is in the pull request
description and in the timing table at the end of every run.

## Known gaps (found while building this suite)

CI does not fully cover J3, J5, J8 and J10 until these `todo` cases are fixed. The PR J1 journey is
intentionally a contact-frame excerpt; full-film rendering and budgets run nightly. Measured review
and the captain's watch are handled by the separate real-film task. `npm run ci` includes this named
J1 scope note alongside the todo case count and names in the journey summary table, warning
annotation and job-summary note.

* `J10 an unknown field in design.json is reported by field name` currently receives the generic
  `design.json (root): Invalid input` error.
* `J8 a cue phrase spoken twice in one shot is rejected as ambiguous` currently binds the first
  occurrence.
* `J8 rendering with no WebGL ends in a named error, never a blank frame` needs a stage-level
  readiness error that a test can provoke because Remotion's CLI has no WebGL-disabled flag.
* `J3 the Studio Player preview frame matches the exported frame` needs the Player drawn at
  composition size for a pixel comparison.
* `J5 the same action runs on second and third data-defined characters` needs the character data
  format and additional character fixtures.
* `J1 full-film measured review and captain watch` are not part of the pull-request excerpt or
  nightly budget job; the separate real-film task owns those checks.
* About 70 `any` annotations remain in files listed in the `LEGACY_ANY` ledger in `eslint.config.mjs`
  (shrink-only: fix and delete the entry when you touch one).
