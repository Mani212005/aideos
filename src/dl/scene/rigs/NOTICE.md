# Stage resources

Characters are data: each is an `aideos.character/1` spec (the library is `characters/`, the
format and authoring guide are in `characters/README.md`). The procedural part builder in
`src/dl/scene/characters/` turns a spec into cel geometry; `src/dl/scene/props/` holds the
paper glider. All of it is original procedural art authored for aideos, MIT, under the
repository LICENSE. Iona's spec reproduces the approved P0 art exactly; the frozen legacy
module that proves it lives in `test_fixtures/characters/iona-legacy/`.

`registry.ts` freezes the source hashes of the engine files that decide how any spec renders
and how the receive is fitted to it, including `src/dl/performance/limits.ts`,
`src/dl/performance/critique.ts`, `src/dl/performance/evaluate.ts`,
`src/dl/performance/math.ts` and `src/dl/performance/span.ts`, plus the approved reference fixtures.
Editing one of them changes every character's identity, so it needs an explicit re-freeze:
`npx tsx scripts/freeze_stage_resources.ts`. Each character spec carries its own content hash.

The frozen stage identity covers character, prop and receive-engine files that determine rendered
output and fitted actions, including evaluation and acceptance critique. It excludes
`src/dl/scene/validateStage.ts`, `src/dl/scene/stageMaterials.ts` declarations and design-check
rules. Compiled films carry the frozen stage hash, and those validation and design-check rules are
re-applied at every build and render. This avoids invalidating every compiled film for a rule change;
stale films are refused with a named error before drawing.

Three.js is installed from npm at 0.180.0 (MIT); its licence is included by the package.
