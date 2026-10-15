# Three stage design gates (P2)

Draft PR description and test plan, recorded before implementation. This change owns stage geometry and design checks. Character data and the look/review criteria remain with their existing owners.

| Journey | Risk | Planned behavioral evidence |
| --- | --- | --- |
| J1, J4 | A placement anchor passes while an animated limb, outline or prop leaves either crop, safe square, margin or caption clearance | Compile the production fixture and reject deliberately cropped wide/reel poses; check every rendered frame, including contact and settling. Positive stills in both formats. |
| J4 | A moving silhouette overlaps the inset | Check posed per-mesh geometry against the format's actual inset while the shot plays; a clear Three inset passes. |
| J4, J8 | Camera limits expressed in scene units allow excessive screen motion at high zoom or in the narrow reel | Measure the compiled projector in each format; negative pan/zoom/rotation speed tests and cast focus tests. |
| J1, J8 | An after-state is present in JSON but its carried object disappears, duplicates or jumps at attachment | Check unique writers, independent contact seam, and two seconds of projected carry during a settled camera hold. |
| J8, J10 | An undeclared material bypasses the SVG palette gate | Execute the material checker on good/bad mesh materials and consume character-owned material declarations. |
| J7, J8 | Hidden geometry produces an asserted visible fact | Distinguish projected bounds, sampled depth evidence, possible foreground obstruction and unmeasured raster visibility. Negative occlusion tests. |
| J3, J9 | Checks and runtime use different projection; out-of-order frames drift; SVG behavior changes | Compare projection with real Three camera matrices, cold/reverse seeks, existing SVG fixtures, root regression suite and studio smoke. |
| J8 | Invalid designs replace a working film | Exercise buildDesign with bad fixtures and assert film.json remains byte-identical, with named shot/rule errors. |
| J11, J12 | CI depends on GPU-specific golden pixels or render evidence consumes disk | Numerical tests are platform independent; root test/lint, editor type-check/build and smoke run sequentially. Check free space before short still captures. |

Additional risk: a foreground SVG plane can obscure the whole WebGL stage if its transparent compositor still paints a background rectangle. Verify actual compositing, rather than inferring visibility from placement data.

The projection owner is `src/dl/scene/projection.ts`. Geometry queries consume evaluated meshes and exported character adapters, without assuming joint names or proportions. Conservative bounds include outlines. Geometry evidence cannot establish facial appeal, finger contact or final raster visibility; those still require rendered evidence and the captain's eye.

Implemented in `backend/designCheck/threeStage.ts`: every-frame precise posed vertex extents with outline allowance, shared-square/margin/caption/inset clearance, per-format projected camera speed and acceleration, cast focus, two-second attached aftermath holds, duplicate writers, finite material declarations and explicit occlusion provenance. SVG foreground bounds retain opacity and animation. A foreground plane conservatively intersecting essential geometry blocks the design; sampled depth without an exposed prop sample also blocks it. These gates do not claim an exact raster visibility fraction.

`applyStageCamera` and `stageProjection` in the projection owner now drive runtime camera assignment and SVG measurement. The transparent foreground compositor no longer paints a full canvas rectangle. That defect was reproduced in real Remotion PNGs before fixing it and has its own failing-then-passing renderer regression. Legacy SVG backgrounds retain their canvas fill. The proof fixture's placement moves 45 stage units right to clear the reel margin; rig, action and art are unchanged.

Validation: root `npm test` passed (836 passing, 3 intentional skips, no failures), root `npm run lint` passed, editor type-check and production build passed, `npm run validate -- examples/hello-scene/film.json` passed, and `AIDEOS_SMOKE_REQUIRED=1 npm run smoke:studio` passed in local Chrome. The editor build retains its existing bundle-size and browser-externalization warnings. PNG evidence is retained under `.frames/p2/`: contact and settled poses in both formats, plus the foreground compositor before/after. No full video or art acceptance is claimed.

Character integration (part 1): `prepareStageFacts` builds each performer from its embedded, verified `aideos.character/1` spec and its prop, and `stageMaterials.ts` declares each performer's colours from that spec's palette plus the prop's colours, so the palette gate applies to any character; Iona, Pip and Marlo pass these gates in both formats (see `docs/CHARACTER_ENGINE.md`). No new character schema field was introduced by P2. The measurement helpers themselves accept arbitrary evaluated meshes, including Three's deformed vertex positions; 25 distinct proportions/transforms are checked against real camera matrices.

Character follow-up: the deferred Pip and Marlo stage stills now live in
`test_fixtures/characters/stage-stills/` and are compared by `backend/characters/pixels.test.ts`.
`backend/journeys/j4_character_crops.journey.ts` runs the receive through the real design compiler
for Iona, Pip and Marlo, checks each evaluated actor and prop silhouette through recovery in both
caption-safe crops, and proves clear/overlapping inset and out-of-bounds cases. The character-owned
palette is checked against actual builder materials, with an undeclared-color negative case in
`backend/performance/stage.test.ts`. The PR description and its risk matrix are recorded in
[`THREE_STAGE_CHARACTER_FOLLOWUP.md`](THREE_STAGE_CHARACTER_FOLLOWUP.md). This closes P2's deferred
additional-character crop and still evidence; facial appeal, finger contact and exact raster
visibility remain outside what projected geometry can prove.
