<!-- File Description: Verification evidence log for composing SVG with pictures (callouts anchored on a picture, the SVG plan that becomes the picture): guidance, briefs, worked example film and design check rules. -->

# Verification Evidence: SVG and pictures composed together

- **Date**: 2026-11-22
- **Branch / PR**: fm/aideos-svg-picture-composition (PR URL added by the pipeline)
- **Scope**: Feature Map rows "Picture Layer / Illustrated Stage" and "Review Gates, Design Check": new `backend/designCheck/pictureComposition.ts` (rules `callout-anchor`, `picture-cover`, leader `contrast`), helpers exported from `backend/designCheck/pictures.ts` and `svgBounds.ts`, wiring in `designCheck.ts`, design brief bullet (`backend/designSpec/brief.ts`), `docs/GOOD_VIDEO.md` "Pictures and SVG together", `docs/DIRECTOR_GUIDE.md`, worked example `test_fixtures/packages/picture-callouts/` (code-drawn pictures via `backend/testSupport/pictureFixtures.ts`)
- **Risk tier**: Low to Medium (new design check rules run on every film with pictures; they only measure SVG groups marked `data-callout`, SVG text under a picture and callout leaders, so a film without callouts can fail only where a picture is layered above its own text)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | The worked example built through the real `buildDesign` (PASS, two resolution warnings for the tiny code-drawn pictures) and rendered through the real Remotion compositions (`renderReviewStills`, long and reel). Stills kept outside the repo. `pictures_stage` journey not run (resource limits; that fixture and its render path are untouched) |
| Property test for new invariants | N/A | No new pure parser or math; the anchor mapping reuses the existing placement and alpha-box code and is exercised by the moved-picture case |
| Differential test on replacement | N/A | No implementation replaced |
| Expect / golden test for complex output | N/A | No IR or golden output changed; rendered stills reviewed by eye |
| No sleeps in tests | PASS | None |
| No mocks of thing under test | PASS | Real design build and design check on real files; tesseract as in `pictures.test.ts` |
| Protected suites unloosened | PASS | No assertion, tolerance, timeout or golden touched; existing thresholds unchanged, three new thresholds added to `PICTURE_THRESHOLDS` |
| Weak-test audit | PASS | None removed |
| Independent review | PENDING | `no-mistakes` pipeline |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --test backend/designCheck/pictureComposition.test.ts` | PASS (exit 0) | 6 tests. With the new rules switched off, 5 of 6 fail (the clean case passes), so the cases measure the rules |
| `node --import tsx --test backend/designCheck/pictures.test.ts backend/insetStage.test.ts` | PASS | 12 tests |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test backend/designCheck/designCheck.test.ts` | PASS | 46 tests |
| `node ... --test backend/reelCut/build.test.ts backend/designSpec/designSpec.test.ts backend/pictures/cache.test.ts` | PASS | 32 tests |
| `node ... --test backend/pipeline/director.test.ts backend/claude_script_intake.test.ts backend/pipeline/agent_director_invariants.test.ts backend/designSpec/designer.test.ts` | PASS | 37 tests (director guide and brief consumers) |
| `npm run lint`, `scripts/typecheck_tracked.ts`, `scripts/check_tests_wired.ts` | PASS | headers, eslint, tracked typecheck, tests wired |
| `npx tsc --noEmit -p editor/tsconfig.node.json` | no errors in changed files | 8 existing errors in untouched files (`defaultSoundtrack.ts`, `designCheck/soundtrack.ts`, `renderIr/emit.ts`, `editor/vite.config.ts`) |

## Fix attempts

- Attempts used: 0 / 3.

## Weak-test removals

None.

## Independent review

Pending: `no-mistakes` pipeline.
