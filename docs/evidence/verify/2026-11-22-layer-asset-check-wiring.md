<!-- File Description: Verification evidence log for wiring the Rule 6 layered asset check into server-side film saves and AI-edit applies. -->

# Verification Evidence: wire layerAssetCheck into film saves and AI-edit applies

- **Date**: 2026-11-22
- **Branch / PR**: fm/aideos-habits-wire-layerassetcheck (PR URL is added by the pipeline)
- **Scope**: Feature Map row "Studio Cut / Edit" (`backend/timeline/layerAssetCheck.ts`, `editor/vite.config.ts` save and `/api/ai-edit`, `backend/mcp/server.ts` edit tool)
- **Risk tier**: Low to Medium (new refusal on a save path; limited to sources a write newly introduces)

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `backend/studioSaveAssets.test.ts` drives the real Studio dev server: missing file -> 422 and no film.json; real file -> 200. Full browser journeys (j3) are left to the pipeline |
| Property test for new invariants | N/A | The rule is a fixed set of cases (new vs known vs library vs remote source), covered by named cases |
| Differential test on replacement | N/A | Nothing was replaced; the existing whole-film `assertLayeredAssetsExist` behaviour is unchanged when no `knownSources` is given |
| Expect / golden test for complex output | N/A | No structured output added |
| No sleeps in tests | PASS | None used |
| No mocks of thing under test | PASS | Real files in a temp public/ folder and a real dev server |
| Protected suites unloosened | PASS | No existing assertion, tolerance, timeout or golden touched |
| Weak-test audit | PASS | No weak test removed; the new tests were checked to fail without the guard (itemId skip removed -> soundtrack case fails) |
| Independent review | PENDING | no-mistakes pipeline |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes / artifacts |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test --test-concurrency=1 backend/timeline/layerAssetCheck.test.ts backend/timeline/imported_footage.test.ts backend/studioSaveAssets.test.ts` | PASS | 6 + existing imported_footage + 1 live |
| `node ... --test --test-concurrency=1 backend/mcp/mcp.test.ts backend/editPlanner/browserSafety.test.ts` | PASS (8/8) | MCP edit path and browser-safety bundle unaffected |
| `npx tsx scripts/check_headers.ts` | PASS | 692 files |
| `npx tsx scripts/typecheck_tracked.ts` | PASS | 612 files |

## Fix attempts

- Attempts used: 0 / 3 (the live test needed a schema-valid fixture film; corrected on the first re-run).

## Weak-test removals

- None.

## Artifacts and links

- Handoff: /home/mani/aideos-linux-home/data/aideos-habits-wire-layerassetcheck/handoff.md
