<!-- File Description: Verification evidence log for the first test-kinds PR: expect tests for Render IR, film JSON and timeline results, property tests for time and frame arithmetic and timeline ids, and the two timeline bugs the property test found. -->

# Verification Evidence: Test kinds PR 1 (expect and property tests)

- **Date**: 2026-11-21
- **Branch / PR**: `fm/aideos-test-kinds-pr1` (PR URL assigned when pushed by `no-mistakes`)
- **Scope**: Feature Map rows `Studio Cut / Edit`, `Studio Captions`, `Export & Rendering`, `Production Pipeline & Director` (film store) and `CI, Test Wiring & Static Enforcement` (test support). New tests: `backend/renderIr/emit.expect.test.ts`, `backend/pipeline/filmJson.expect.test.ts`, `backend/timelineResults.expect.test.ts`, `backend/timeFrameArithmetic.property.test.ts`, `backend/timeline/layerIds.property.test.ts`. New test support: `backend/testSupport/propertyTest.ts`, `backend/testSupport/expectFile.ts`. Product code changed only for three bugs the property test found (`backend/timeline/{updates,layer_manager,layer_engine}.ts`).
- **Risk tier**: Medium (tests plus a small change to timeline edit code that the studio editor bundles)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | N/A | The timeline fix is covered by the property test through the real edit functions; no browser journey drives add-layer with a repeated label (listed as a gap in the Feature Map). Targeted unit run of every `backend/timeline` and `backend/renderIr` test passed. |
| Property test for new invariants | PASS | `backend/timeFrameArithmetic.property.test.ts` (6 properties, 200 seeds each) and `backend/timeline/layerIds.property.test.ts` (300 seeds). Both fail on mutated or old code (see below). |
| Differential test on replacement | N/A | No implementation is replaced in this PR; differential tests are a listed follow-up. |
| Expect / golden test for complex output | PASS | 6 expect tests over 6 files in `test_fixtures/expect/`, captured from the real emitter, film store and timeline functions (`AIDEOS_UPDATE_EXPECT=1`), reviewed by reading the output. |
| No sleeps in tests | PASS | No sleep or timer in any new test. |
| No mocks of thing under test | PASS | The emitter, film store, timeline and layer edits run for real. Only the text measurer is the existing deterministic fake used by `emit.test.ts`. |
| Protected suites unloosened | PASS | No journey, golden, parity gate or review gate edited. |
| Weak-test audit | PASS | No test removed. The timeline tests were checked for any dependence on the old `layer-<label>-tx-<char>` id shape: none. |
| Independent review | PENDING | `no-mistakes` review pipeline on handoff. |
| Evidence log written | PASS | This file. |

## Bugs found by the new tests (fixed in this PR)

The id property test found all three; the same run at 3000 and 10000 seeds found them after the first 300 seeds had passed the earlier two fixes.

1. `addLayer` and `importMediaAssetToLayeredFilm` built ids from `generateUUID().slice(0, 4)`, which is `tx-` plus ONE random base-36 character. Two layers with the same label collided about 1 time in 36 (reproduced: 6 of 200 trials, then 0 of 200 after the fix); a duplicate id makes every edit by layer id hit the wrong layer. Fixed with `uniqueSuffixedId` (four random characters, never an id already in the film).
2. `deleteLayer` removed a layer's clips but left a surviving partner clip with `linkedClipId` pointing at a clip that no longer exists (AGENTS.md: keep `linkedClipId` symmetric). Fixed by clearing that link.
3. `importMediaAssetToLayeredFilm` made the Video Footage, Footage Audio and Music layers with the fixed numbers 15, 5 and 2 even when a layer already had that number, so the film broke Rule 2 of the layered film schema (unique layer numbers; `validateLayeredFilm` throws). Reproduced at seed 474 (an added layer lands on 15 after other layers were deleted, then a video import). Fixed with `freeLayerNumber` (the preferred number, else the nearest free slot).

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/timeline/*.test.ts backend/renderIr/*.test.ts backend/timeline/layerIds.property.test.ts backend/timeFrameArithmetic.property.test.ts backend/timelineResults.expect.test.ts backend/pipeline/filmJson.expect.test.ts` | PASS (exit 0) | 194 tests, 0 fail |
| `AIDEOS_PROPERTY_CASES=10000 node ... --test backend/timeline/layerIds.property.test.ts backend/timeFrameArithmetic.property.test.ts` | PASS (exit 0) | 7 tests, 0 fail, 44 s; an earlier 3000 seed run found the fixed-number layer bug and a generator mistake in the drift property (narration scaling could push a shot under the 15 frame clamp; the generator now keeps every scaled shot at least one second) |
| `node ... --test backend/characters/characters.test.ts backend/schemaIssues.test.ts` | PASS (exit 0) | 31 tests; both import `seeded`, now re-exported from `propertyTest.ts` |
| Old code check: `git checkout -- backend/timeline` then the layer id property test | FAIL as expected | `duplicate layer ids after edit 9 (addLayer)` at seed 1; the fix is re-applied and the test passes |
| Mutation A (round each shot duration alone in `buildTimeline`) | caught | drift property fails at seed 1 (`shot 2 ends at frame 452, true time is frame 452.8176`) |
| Mutation B (millisecond grid at 10 ms in `shotDurationsOnMillisecondGrid`) | caught | tiling property fails at seed 1 |
| Mutation C (end card length `floor + 1` in `deliveryTimeline`) | caught | both Render IR expect tests fail at the changed `durationFrames` |
| `npm run ci -- static` | PASS (exit 0) | 9/9 steps: ensure generated, file headers, every test file is wired, eslint, tsc root, oxlint editor, editor build, ruff check, ruff format --check |

## Fix attempts

- Attempts used: 1 / 3 for the type errors in the new files (an unsupported `Error` cause option and a frame rate list wider than the schema's 24, 30, 60); fixed and the type check re-run clean.

## Weak-test removals

- None.

## Independent review

- Pending: `no-mistakes` pipeline.
