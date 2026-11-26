<!-- File Description: Verification evidence log for Phase 2 step P2.5a of the native renderer: Body support copy under a TextReveal headline, broken into lines as Chrome breaks text-wrap: pretty, drawn natively behind the text_cards journey at 0.995 on every measured frame against the swangle reference. -->

# Verification Evidence: Body copy under a headline (P2.5a)

- **Date**: 2026-11-26
- **Branch / PR**: `fm/aideos-native-p25a-body`
- **Scope**: `backend/renderIr/bodyWrap.ts` (new: Blink's greedy and `ScoreLineBreaker` line breaking for `text-wrap: pretty`), `backend/renderIr/emit.ts` (`nativeSupport` accepts a `TextReveal` followed by a `Body`, refuses a lone `Body` and a body size with no measured advance size; `bodyLayout`, `bodyNodes`, `columnTops`, `CHROME_BODY_ADVANCE_SIZE`; `textRevealLayout` extracted from `textRevealNodes`, which takes an optional column top), the fixture `test_fixtures/packages/text-cards`, the journey `backend/journeys/text_cards.journey.ts`, its weight, docs. No Render IR change, no renderer change. Feature Map rows: Export & Rendering (native renderer, Render IR emitter), Parity gates.
- **Risk tier**: Medium (films whose text cards carry support copy, the compiler's usual card, now render natively in `auto`; films without a `Body` emit the same documents).

## Why this slice

`design.ts` `buildTextBlocks` gives a text card a `Body` whenever a beat has a second on-screen line. P2.7 (footage) was
looked at first and set aside: production footage is a wired full-screen `AnalogyInset` playing an mp4 (`OffthreadVideo`),
which needs a native video decode path and a Render IR version (`/8`, moving the unsupported fixture to `/9`).

## What Chrome does, measured

- `text-wrap: pretty` is Blink's `ScoreLineBreaker` (Chromium `score_line_breaker.cc`, `line_break_candidate.cc`): greedy
  lines first; when the last line is one word narrower than a third of the line, a dynamic programme over the last four lines
  (`kMaxLinesForOptimal` 4), kept only with the greedy line count. Ported in `bodyWrap.ts`.
- Remotion launches Chrome with `--font-render-hinting=none` (subpixel glyph positions). A first probe without that flag saw
  whole-pixel advances and was the wrong reference (the first fixture sweep, emitted from it, was far off: lowest 0.88988); with
  the flag, Geist 400 advances at 24 px equal the native shaper's, and at 33.6 px equal the native shaper's at 33.585 px (all
  2402 word prefixes of 400 sentences within 1/64 px; 37 at 33.6). The mechanism inside Chrome is not identified; the measured
  size is a table with only the two body sizes films use, and any other size is refused.
- Line-break differential (probe page with the `Body` CSS and Remotion's flags, 400 generated sentences up to 170 characters):
  same lines for all 400 in both formats; the pretty pass changes 87 (long) and 42 (reel) of them.

## Parity: native against Remotion (swangle), stage SSIM by ffmpeg

`text-cards`, long and reel: frame 45, every 10th frame 90 to 450 (the three cards), 452, 500, and the end card (539, 600, 629
reel and long): 86 frames, none under 0.995; lowest long 240 0.99848.

## Reliability checklist

| Check | Status | Notes |
| --- | --- | --- |
| Real E2E run | PASS | `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/text_cards.journey.ts`: native chosen for both formats; all 27 frames at or above 0.995 (32 s) |
| Property test for new invariants | N/A | |
| Differential test on replacement | PASS | the line-break differential and the frame sweep above (scratch, outside the repo) |
| Expect / golden test for complex output | PASS | no golden or expect change; films without a `Body` emit the same documents |
| No sleeps in tests | PASS | none added |
| No mocks of thing under test | PASS | real emitter, release binary and Remotion |
| Protected suites unloosened | PASS | the stage bar unchanged; no assertion edited |
| Weak-test removals | PASS | none |
| Independent review | PENDING | the no-mistakes pipeline review |
| Evidence log written | PASS | this file |

## Commands run and results

| Command | Result | Notes |
| --- | --- | --- |
| `node --import tsx --import ./backend/testSupport/fixtureVideosDir.ts --test` on `backend/renderIr/emit.test.ts`, `emit.expect.test.ts` | PASS (20, 2) | |
| `AIDEOS_VIDEOS_DIR=test_fixtures/packages npm run design:check -- text-cards` | PASS | |
| `npm run typecheck` | PASS | |
| `CI=true AIDEOS_GL=swangle npx tsx backend/journeys/text_cards.journey.ts` | PASS (1) | 32 s |

## Still refused (planned)

- A `Body` on its own, any other block pair, the other primitives (P2.5), and a body size with no measured Chrome advance size.
- A `Body` whose text has a character outside ASCII letters, digits, white space and `. , ; : ' " ! ? ( ) &` (a hyphen, slash,
  dash, soft hyphen, zero-width space, non-breaking space or any other break opportunity of Chrome's UAX 14 line breaker): only
  white-space breaks are measured, so `nativeSupport` names the shot and the first such character and the film stays with Remotion.

## Test changes

- New journey `backend/journeys/text_cards.journey.ts` (weight 45 s in `scripts/ciJourneyShards.ts`) and fixture
  `test_fixtures/packages/text-cards`.
- No assertion, tolerance, threshold, bar or golden is edited, loosened or removed.

## Fix attempts

- Attempts used: 1 / 3 (the reference probe corrected to Remotion's launch flags).
