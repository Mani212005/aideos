<!-- File Description: Verification evidence log for the native renderer's layer-restore rounding (compositing layers blend in floating point and round, as the reference Chrome's GPU raster does). -->

# Verification Evidence: native layer restores round like Chrome's GPU raster

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-layer-rounding`
- **Scope**: `native/aideos-render/src/raster/mod.rs` (`rounding_layer_paint`, node opacity layers), `native/aideos-render/src/raster/svg.rs` (filter layers, SVG group opacity layers, a shape fading fill and stroke together), the eight native golden frames that move by one level, `docs/NATIVE_RENDERER.md`. Feature Map rows: Export & Rendering (native renderer), Parity gates.
- **Risk tier**: Medium (every native film's layers composite with rounding instead of truncation: at most one level on a pixel).

## The defect

The parity reference is Remotion's Chrome with `AIDEOS_GL=swangle` (CI, the goldens and every native parity number):
its GPU raster blends a layer in floating point and rounds. The native renderer restored every compositing layer (a
node's or an SVG group's partial opacity, a filter's layer) through Skia's legacy 8-bit sprite blitter, which truncates
(`(d * (256 - a)) >> 8`). Over a dark ground this drew layered content one level too dark: black at alpha i/255 over
`#0A0A0B` inside a 35% layer changes level at i = 37, 110 and 183 in Chrome (swangle) and at 3, 74, 148 and 219 natively;
inside a 3% layer Chrome never changes, native dropped a level from i = 29. It is what kept two node-graph frames under
the 0.995 bar (Phase 2 step P2.2c): a lit card's shadow layers on the dark canvas, not the blur shape (on white the
native shadow is if anything slightly lighter than Chrome's Gaussian).

The fix restores every layer with an identity runtime colour filter on its paint, which sends the restore through Skia's
floating-point pipeline, the technique `exact_colour` already uses for translucent fills. Measured with the same probe,
native then changes level at 37, 110 and 183 in a 35% layer and never in a 3% layer, as Chrome does.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | the release binary on node-graph-flat (opt-in canvas), still-talking, hello-scene, the character films and pictures-stage, against Remotion stills rendered with `AIDEOS_GL=swangle` (scratch journeys outside the repo) |
| Property test for new invariants | N/A | a fixed blending rule, pinned by the goldens and the parity journeys |
| Differential test on replacement | PASS | before and after binaries against the same Remotion stills (tables below) |
| Expect / golden test for complex output | PASS | eight native golden PNGs regenerated (listed below, at most one level, inside the unchanged golden tolerance either way) |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | the real binary renders every frame |
| Protected suites unloosened | PASS | no tolerance, threshold, bar or golden selection changed |
| Weak-test removals | PASS | none |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Golden frames regenerated, each measured

Every golden PNG the change moves, regenerated with `AIDEOS_NATIVE_GOLDEN_UPDATE=1` (the golden test passed before
regenerating too: every difference is inside the strict tolerance). "After vs before" compares the golden-scale PNGs;
the last two columns are the full frame's stage SSIM against Remotion (swangle), with the before and after binaries.

| Golden | After vs before (SSIM, mean abs, max level) | vs Remotion before | after |
| --- | --- | --- | --- |
| iona-receive long-180 | 0.99975, 0.034, 1 | 0.99987 | 0.99987 |
| journey-j3-j4-dots long-180 | 0.99975, 0.034, 1 | 0.99998 | 0.99998 |
| journey-three-characters long-180 | 0.99975, 0.034, 1 | 0.99986 | 0.99986 |
| pixels-stage-marlo long-180 | 0.99975, 0.034, 1 | 0.99989 | 0.99989 |
| pixels-stage-pip long-180 | 0.99975, 0.034, 1 | 0.99981 | 0.99981 |
| pictures-stage long-225 | 1.00000, 0.0001, 1 | 0.99993 | 0.99992 |
| still-talking long-2773 | 0.99970, 0.022, 1 | 0.99445 | 0.99436 |
| still-talking reel-1848 | 1.00000, 0.0000, 1 | 0.99677 | 0.99677 |

The changes are neutral against Chrome. still-talking long 2773 moves by -0.00009, which is neutral: on the pixels the
change touches, the mean difference from Chrome falls (0.940 to 0.919 levels) while its sign flips (-0.40 to +0.57
levels), a one-level bias moving from one side to the other on a flat dark area; reel 2773 moves 0.99700 to 0.99694 for
the same reason. still-talking long 924 and 1848, reel 924 and 1848 and hello-scene long and reel 30, 150, 270 are
identical before and after.

## The node-graph canvas (opt-in, not yet used for users), stage SSIM against Remotion (swangle)

`test_fixtures/packages/node-graph-flat` with `nodeGraphCanvas`, main's emitter, 26 frames (20, 45, 60, 100, 150, 250, 255,
330, 345, 420, 435, 520, 525, long and reel): before 24 of 26 at or above 0.995 (long 250 0.99471, long 330 0.99463);
after 26 of 26 (lowest long 250 0.99570, long 330 0.99646; long 20 0.99835 to 0.99872, reel 250 0.99505 to 0.99666).
Node-graph films stay refused natively until Phase 2 step P2.2c.

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `cargo test --release -p aideos-render` | PASS (18 test binaries) | |
| `AIDEOS_NATIVE_GOLDEN_UPDATE=1 cargo test --release -p aideos-render --test golden` | PASS | the eight PNGs above rewritten; the test passed on the old PNGs too |
| `cargo clippy --release -p aideos-render` | PASS with 2 warnings | both pre-existing on main (`raster/mod.rs` lines 75 and 111), untouched here |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/svg_filters.journey.ts` | PASS | the P2.1 scene filter parity journey at its 0.995 bar |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/pictures_stage.journey.ts` | PASS (3) | the pictures stage parity journey at its bars |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/native_character_goldens.journey.ts` | PASS (2) | 30 frames, worst mean difference 0.0000 against the regenerated goldens (bar 0.05) |
| scratch journeys (outside the repo) | PASS | the tables above |

## Caveat: the GL backend

A default Remotion render (`AIDEOS_GL` unset, `angle`) on a host without a GPU falls back to Chrome's software raster,
which blends with Skia's truncating 8-bit blitters; native now matches the swangle reference, not that fallback.

## Test changes

- Eight native golden frames regenerated (table above); each moves by at most one level, inside the unchanged golden
  tolerance, and none moves further from Chrome than the neutral still-talking long 2773 (-0.00009, explained above).
- `native/aideos-render/fixtures/golden/MANIFEST.json`: the byte sizes of those PNGs.
- No assertion, tolerance, threshold, timeout, bar or golden-frame selection is edited; no test is added or removed.

## Fix attempts

- Attempts used: 0 / 3.
