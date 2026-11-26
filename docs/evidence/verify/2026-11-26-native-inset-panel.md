<!-- File Description: Verification evidence log for Phase 2 step P2.6a of the native renderer: the inset panel holding a StatCounter drawn natively for a shot without its open and close animation, behind a parity journey at 0.995 on every measured frame against the swangle reference. -->

# Verification Evidence: the inset panel with a StatCounter (P2.6a)

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-p26a-inset`
- **Scope**: `backend/renderIr/emit.ts` (`nativeSupport` accepts only the measured inset form: a scene film, a shot that is not the first, a `cut` move, exactly one StatCounter; `insetPanel`, `insetContentRect`; `statCounterNodes` takes the rect it centres in), the journey `backend/journeys/inset_panel.journey.ts`, its weight in `scripts/ciJourneyShards.ts`, docs. No Render IR change, no renderer change, no fixture change. Feature Map rows: Export & Rendering (native renderer, Render IR emitter), Parity gates.
- **Risk tier**: Medium (scene films whose inset panel holds one counter on a later cut shot now render natively in `auto`).

## Why this slice

Across the committed fixtures (2026-11-26), `inset-stage` was refused for one thing only, its `inset` panel; AGENTS.md
prescribes `stage: "inset"` with exactly one device or counter for a scene film, and scene films are otherwise native.

## What Chrome draws, measured

`Film.tsx`'s `Stage` puts an inset shot's panel in `getInsetRegion` (long 1152, 96, 672 x 703.2): the theme's surface
colour, a 1 px hairline border, the card radius, no shadow, and a centred column padded by 3 grid. A shot whose move is a
`cut` is drawn without the open and close animation. The panel is border-box in the render: its border
box is exactly the region (Chrome's panel spans x 1152 to 1823). A first native pass that read the markup as content-box
drew the panel 2 px wider and the counter 25 px low (long frames 0.98683); border-box puts the counter where Chrome does
(the number's top at y 404 in both) and the frames at 0.9985.

## Parity: native against Remotion (swangle), stage SSIM by ffmpeg

Every 15th frame of the delivered video (0 to 375 long and reel, long 390 to 479 through the end card): 59 frames, none under
0.995; lowest long 120 0.99847, reel 105 0.99886.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/inset_panel.journey.ts`: native chosen for both formats; all 21 frames at or above 0.995 (26 s) |
| Property test for new invariants | N/A | |
| Differential test on replacement | PASS | the sweep above |
| Expect / golden test for complex output | PASS | no golden or expect change; films without an inset panel emit the same documents |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | real emitter, release binary and Remotion |
| Protected suites unloosened | PASS | the stage bar unchanged; no assertion edited (the existing refusal assertion for an inset holding a Plot still passes: the reason names the inset stage) |
| Weak-test removals | PASS | none |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test` on `backend/renderIr/emit.test.ts`, `emit.expect.test.ts`, `backend/insetStage.test.ts`, `backend/rendererSelection.test.ts`, `backend/nativeRenderer.test.ts` | PASS (19, 2, 6, 10, 4) | |
| `npm run typecheck` | PASS | |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/inset_panel.journey.ts` | PASS (1) | 26 s |
| scratch sweeps (outside the repo) | PASS | the numbers above |

## Still refused (planned)

- An inset panel that opens on a camera move (Film.tsx's open and close animation and the content's delayed entrance are not
  measured yet).
- An inset holding anything but one StatCounter (the devices of P2.6).
- An inset on the first shot, an inset with no block, and an inset in a node-graph film (no scene): each is accepted by no
  journey frame, so each is refused with its own reason naming `stage "inset"` (Firstmate decision A, 2026-11-26).

## Test changes

- New journey `backend/journeys/inset_panel.journey.ts` (weight 40 s in `scripts/ciJourneyShards.ts`).
- New test in `backend/renderIr/emit.test.ts`: the measured inset form is accepted and the first-shot, empty, node-graph and camera-move insets are each refused by their reason (Firstmate decision, 2026-11-26).
- No assertion, tolerance, threshold, bar or golden is edited, loosened or removed.

## Fix attempts

- Attempts used: 1 / 3 (border-box geometry).
