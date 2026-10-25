<!--
File Description: How aideos is checked - the one command that owns every CI step, what each job and test layer covers, how to add a journey test, how golden frames are made, and which user journeys and risks each test protects.
-->

# CI and tests

One command owns the list: **`npm run ci`**. GitHub Actions and a contributor's laptop use the job
definitions in `scripts/ci.ts`; the local validation tool (`.no-mistakes.yaml`) selects only the
`static` job. Platform-dependent steps can be skipped locally with a reason.
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
| `changes` | `scripts/ciChanges.mjs`: lists changed files grouped by area, computes shadow mode decisions and reasons for journeys and legacy, and reports shadow PR risk rating | every PR and push to main |
| `static` | file headers, every test file is wired, eslint (src, backend, scripts, editor), `tsc` root, oxlint editor, editor build (`tsc -b` plus vite), `ruff check`, `ruff format --check` | every PR and push to main |
| `unit` | `npm test` (every `*.test.ts` under `backend/` and `scripts/`, found by glob), `validate` on the example film, `design:check` on the fixture packages, `eval:look` (every committed look plan parses), `eval:visuals`, `performance:check` | every PR and push to main |
| `journeys` | `npm run test:journeys` (real pipeline and real renders, including browser journeys for AI edit apply and new-project script save; any todo case fails the job) and `npm run smoke:studio` (real studio: scrub, split, autosave, reload) | every PR and push to main |
| `legacy` | `npm run test:legacy`: golden frames of the films that existed before the 3D work; compares committed Linux baselines | every PR and push to main, Linux only |
| `nightly` | `scripts/nightly_budget.ts`: the whole Iona film, wide and reel, with budgets on wall time, peak memory, peak temp disk and bundle size | 03:17 UTC and on demand, never on a PR |
| `all-green` | fails unless all five jobs above succeeded | the one check to require |

Reviewers that need a login (agy, Gemini, the all-check loop) are not part of CI. Their gate is
the measured `aideos review` and the Gemini round described in [REVIEW.md](REVIEW.md), run by the
author before handoff.

Layers, from cheapest to dearest: static, unit and property tests (the maths on generated input),
feature tests with good and bad fixtures, headless journeys (below), regression (golden frames, plus
a journey case for each bug the captain or a user reported), and the captain's eye for art, which no test can replace.

## Setup that every job shares

* Every workflow job uses Node 22 and `npm ci` (npm cache keyed on both lockfiles). Jobs that render
  install `ffmpeg` and the Remotion browser libraries, and cache `node_modules/.remotion`. APT packages
  are cached across runs under `/home/runner/.apt-cache` with retry-hardened installs.
* The `unit` job restores the Remotion browser cache, runs `remotion browser ensure` before tests,
  and installs `tesseract-ocr` so OCR features run without skipping.
* Skipped tests in any test runner are captured and reported honestly as `NOT COVERED (skipped)` in
  the timing summary and job summary, not as passes.
* Renders use **software GL** (`AIDEOS_GL=swangle`, read by `backend/pipeline/render.ts`'s `glFlag`).
  This avoids GPU-dependent rendering on CI. Goldens remain pinned to the CI platform, and the
  update workflow renders them twice on that platform before accepting them. On a Mac the default
  stays `angle`.
* `ruff` is pinned (`RUFF_VERSION` in `scripts/ci.ts` and in `ci.yml`); locally the step uses an
  installed `ruff`, `python3 -m ruff` or `uvx ruff@<pinned>`, and is skipped with a reason (never
  silently passed) when none exists. CI always runs it.
* Failing frames, reports and studio screenshots land under `.ci-artifacts/`. Artifact uploads use
  `include-hidden-files: true` so `.ci-artifacts` directories are uploaded reliably. The journeys artifact
  uploads on failure; legacy evidence and the nightly budget report upload on every run.

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
    * Touches render code: `backend/pipeline/render*`, `src/dl/render*`
    * Touches stage or scene code: `src/dl/scene/**`, `src/dl/Stage*`, `src/dl/Scene*`, `backend/stage/**`, `backend/stillTalking/**`
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

* **APT caching and retry with timeouts**: Every `apt-get` step in `ci.yml` and `nightly.yml` restores
  and saves `/home/runner/.apt-cache` via `actions/cache@v4` with `-o Dir::Cache::Archives=/home/runner/.apt-cache`.
  The install runs in a 3-attempt retry loop with a 300-second per-command timeout, 15-second sleep between retries,
  and `-o Acquire::Retries=3`. Each apt step is bounded by its own `timeout-minutes: 10` to prevent runner hangs
  from exhausting job limits.
* **Red-main alert**: `.github/workflows/main-red-alert.yml` runs on `workflow_run` when the CI workflow
  completes on the main branch with failure, timed_out, or cancelled conclusions. It opens or updates a single
  GitHub issue (`CI: main branch failure`) naming the failing run URL and commit SHA, preventing unnoticed red builds.

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
seconds). There is no override variable: tests inject a fake sampler and `statfs`.

## User journeys and what protects each

| Journey | Protected by | Layer |
| --- | --- | --- |
| J1 make a film with a character end to end | `j1_pipeline.journey.ts`: the PR journey runs the real `runProduction` with the iona-receive fixture, renders wide and reel around the contact frame, and checks output metadata and a drawn frame; nightly renders the full film with budgets | journey, nightly |
| J2 narration changes after design, stale work not reused | `j2_retime.journey.ts`: the real pipeline re-narrates with words inserted before "catches", the compiled contact follows the new word, design and render rerun into a new reel and the measured review finds the contact on the word; `backend/review/stageTruth.test.ts` (a contact off its word fails adherence even if the recorded cue frame is edited); `backend/pipeline/pipeline.test.ts` (retime refreshes base-film, forced upstream reopens downstream) | journey, feature |
| J3 scrub, save, reload, preview equals export | `scripts/smoke_studio.ts` (keyboard scrub forwards and back with exact frame readout, same picture on return, split, autosave, reload keeps the edit); `j3_studio_edit.journey.ts` (real Chrome: the AI edit Apply Edits gesture applies, saves, is logged and survives a reload, with only the model-backed `/api/ai-edit` answered by the test; a new project's script saves and survives a reload); `backend/editPlanner/browserSafety.test.ts` (the apply path bundles for a browser and runs with no Node built-ins, and the real studio bundle has no externalized Node module); export-versus-cold equality (wide and reel); `j3_j5_stage.journey.ts` compares a fresh Remotion Player's first contact-frame draw and later seeks with exported PNGs in both formats | journey |
| J4 reel crop keeps character and prop clear of captions | `j1_pipeline.journey.ts`: projected character and prop bounds, every frame from approach to recovery, inside the frame and above the caption band in wide and reel; glider attached at the decisive frame; `j4_character_crops.journey.ts` covers Iona, Pip and Marlo with inset and out-of-bounds negatives, and committed Pip and Marlo wide/reel stills are checked by `backend/characters/pixels.test.ts` | journey, browser pixels |
| J5 second and third character, same action | `j3_j5_stage.journey.ts` runs Iona, Pip and Marlo together through look check, design build, compilation and 13-frame wide/reel production renders; same-frame Player captures hide each object in turn and require attributable pixel changes inside its projected bounds in both formats. Negative checks reject missing props and actor pixels that overlap a hidden prop crop. Unit/property coverage remains in `backend/characters/` | unit, journey |
| J6 resume reopens exactly the right stages | `j6_resume.journey.ts`: an unchanged rerun reuses every production stage and the reel byte for byte, a package character edit reruns design through verify and the new art is in the pixels; `backend/pipeline/characterResume.test.ts` (look hash and design fingerprint carry the character); `pipeline.test.ts`; `renderFrames` is part of the render fingerprint | journey, feature |
| J7 reviews see the 3D stage truthfully | `j7_review_truth.journey.ts`: film facts and shared stage truth project the whole film timeline into wide and reel crops, with contact on the word, camera in that crop and unmeasured craft; `backend/review/stageTruth.test.ts` (per-format presence and camera, hidden cast, plain-word facts); `stage.test.ts`; `geminiReview.test.ts` | journey, feature |
| J8 failures give a named error | `j8_failures.journey.ts`: a phrase not spoken, an unknown shot and missing artwork are each named and write no film; a failed design stops the run with no mp4; unreachable targets fail the build and leave finite evaluator output; missing character resources and duplicate decisive phrases are refused by name; `j3_j5_stage.journey.ts` disables WebGL in real Chrome and checks export refusal and visible Player status | journey |
| J9 existing SVG and template films render unchanged | `j9_template.journey.ts` (real pipeline, templates), `j9_svg_repeatability.journey.ts` (exact cold-render equality of Still Talking frame 2773), and `legacy.golden.ts` (golden frames of four films; committed Linux baselines) | journey, golden |
| J10 an agent authors from the docs, bad input names the field | `j8_failures.journey.ts` checks bad values in design.json, look.json and character specs through their public validators; `schemaIssues.test.ts` covers nested unions, unknown fields, required values and version tags | unit, journey |
| J11 a contributor opens a PR and the suite reproduces locally | `npm run ci`, `scripts/ci.test.ts` (workflows only call real jobs, every job is run by a workflow, least privilege) | static |
| J12 a long render never fills the disk | `assertRenderDiskBudget` and `checkRenderDiskBudget` (`renderDiskBudget.test.ts`), the estimate against a real render's peak temp (`j12_render_disk.journey.ts`), temp-leak and size assertions in `j1_pipeline.journey.ts`, `stagePublicDir` cleanup never follows a symlink (`harness.test.ts`), nightly peak-temp budget | unit, journey, nightly |
| J13 captions: move, resize, scope, lock, undo, reset, reload, preview equals export | `j13_caption_placement.journey.ts`: exercises Whole film and This shot only scopes, move, resize, lock, reset, undo, and reload in both formats, then checks native Player caption ink bounds against PNG and MP4 export within 2 px | journey |

### Risks and the check that watches them

| Risk | Check |
| --- | --- |
| overfitting to Iona | `backend/characters/retarget.test.ts` checks named characters and randomized proportions through the same action (J5); the J4 crop journey checks full evaluated silhouettes for Iona, Pip and Marlo; see [the character-engine risk plan](CHARACTER_ENGINE.md#risks-this-part-must-hold) |
| pixel tests flaky across machines | software GL everywhere in CI; goldens made only on the CI platform and validated by rendering twice; manifest records the platform and the test refuses a mismatch |
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
* Studio journeys use `scripts/studioDriver.ts` (`startEditor`, `StudioPage`: real key presses,
  clicks, typing, element screenshots, `intercept` to answer a model-backed `/api/*` call from the test,
  error collection) and live next to `scripts/smoke_studio.ts` or in `backend/journeys/` (a studio journey
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

Require the single check **`all-green`** (it fails unless all five jobs above succeeded).
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
  The editor eslint step covers `editor/src`; expanding it to the legacy `editor/vite.config.ts`
  (which also carries existing `any` diagnostics) is outside this journey follow-up.
