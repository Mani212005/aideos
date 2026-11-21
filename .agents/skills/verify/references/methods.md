<!-- File Description: Operational guide to the three core verification methods (E2E, property-based, differential) plus expect testing for complex outputs. -->

# Verification methods

Pick every method that matches the risk of the change. Never substitute a mocked unit test when a higher-confidence method applies.

## 1. E2E testing (real user workflows)

Validate real user journeys through the real entry point (CLI, browser UI, API server, or production pipeline) with real serialization, disk I/O, and rendering where applicable.

- Drive the same gestures and commands a user executes (clicks, keyboard input, CLI flags, HTTP requests).
- Assert observable user outcomes (persisted files, rendered pixels/metadata, visible UI state, named errors), not internal private state.
- Mock only external paid/network/model boundaries when deterministic CI execution requires it; never mock the system under test.
- Wait on explicit readiness conditions (DOM state, saved status, file write, process exit), never fixed `sleep` delays.

## 2. Property-based testing (random inputs for invariants)

Generate many varied inputs to verify invariants that must hold across the entire input domain, not just two hand-picked examples.

Good targets:
- Pure math, geometry, bounding boxes, and camera or timeline calculations.
- Parsers, serializers, and schema validators (round-trip `decode(encode(x)) == x`, malformed input always returns a named error).
- Planners, editors, and state machines (every valid op sequence preserves invariants; undo restores prior state; no NaN or negative durations).
- Retargeting, layout, and crop solvers (bounds remain finite and inside safe areas across randomized proportions).

Library guidance (recommendations only - do not add a dependency without explicit approval):
- **TypeScript / JavaScript**: `fast-check`
- **Rust**: `proptest`
- **Python**: `hypothesis`
- **Zero-dependency option (when no library is installed)**: write a small deterministic seeded PRNG (e.g., Mulberry32) loop over 50-500 generated cases, print the failing seed and input on assertion failure, and shrink/pin any regression found into a permanent test case.

## 3. Differential testing (old vs new implementations)

Required whenever replacing, rewriting, porting across languages, or optimizing an implementation that already has a working oracle.

- Run both the existing reference implementation and the new implementation on the exact same shared fixtures and generated inputs.
- Compare outputs directly (exact equality for discrete structures/bytes, or explicit documented numeric/SSIM/pixel tolerances for floating-point and raster outputs).
- Test error paths too: inputs rejected by the old implementation must also be rejected by the new one with clear causes, unless a behavior change was explicitly approved.
- Never loosen the differential tolerance to hide a real regression; investigate and fix the divergence first.

## 4. Expect testing (complex structured outputs)

Use expect / golden tests when a change produces rich structured output (Render IR, compiled plans, reports, formatted text, or rendered stills) that is too detailed for ad-hoc field assertions alone.

- Commit human-reviewed expected outputs alongside the test or golden manifest.
- Keep diffs readable and deterministic (stable key order, pinned fonts/software GL, no wall-clock timestamps or random IDs).
- Update expected outputs only through the project's documented update workflow and human review of the diff, never blindly on failure.
