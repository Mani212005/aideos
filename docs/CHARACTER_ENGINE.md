<!--
File Description: Architecture, journeys, risks, test plan and verification record for the data-driven character engine.
-->

# Character engine

Characters are data. A character is one `aideos.character/1` JSON spec: a named humanoid
skeleton built from proportions, semantic sockets, joint limits, a material palette, cel
outline and silhouette settings, a painted face with expression presets, canonical views and
a list of procedural parts. The engine turns that spec into a rig for the pose evaluator,
cel-shaded Three.js geometry for the stage, and a retargeted receive action. A new character
needs a new spec, not new code. The authoring guide is [characters/README.md](../characters/README.md).

This document is part 1 of the character effort (the character engine and the character
reference in the design and film schemas). Stage design gates (part 2), CI (part 3) and look
and review truth (part 4) consume the types exported from `src/dl/characters/`.

## Journeys this part must keep working

The whole effort's critical journeys are J1 to J12 in the captain's brief. These are the ones
part 1 changes, with the tests that hold each one closed.

| Journey | What part 1 owns | Tests |
|---|---|---|
| J5 second and third character from data, same action on all | spec format, part builder, retargeted receive | every committed spec parses, hash-verifies and passes semantic checks; the receive retargets onto Iona, Pip and Marlo and passes every numerical obligation; each compiles through the real design compiler and passes the both-crop design check; CPU geometry builds for each; sheets and wide/reel stills render for each |
| J8 failures give a named error, never a blank or broken frame | spec, resource and reach validation | missing character id, tampered or stale hash (in the library file and inside a compiled film), unknown joint, material, socket, expression or swing channel, floating rest pose, unreachable hand target (fail policy), all produce errors naming the field; clamp policy records warnings; the stage refuses an unverified spec before it allocates geometry |
| J10 an agent authors a character from the docs | authoring guide, `aideos character check` and `aideos character sheet` | the guide's minimal spec passes check; check exits 1 and lists field paths for bad input; `--stamp` writes the content hash; sheet writes the model sheet, expression sheet and wide/reel stills |
| J1 film with a character end to end | character reference in design.json and the compiled film | design build compiles each fixture character; Iona's production package rebuilds and renders byte-identical stills |
| J2 narration change moves contact | retargeted receive still binds contact to the cue | rebinding with different word timing moves contact to the new cue for every character |
| J3 preview frame equals export frame | generic apply assigns every channel absolutely | applying frames in permuted order gives identical world matrices; Iona's FilmView stills are byte-identical to the merged slice |
| J4 reel crop keeps character and prop inside the safe area | posed bounds come from the real character geometry | both-crop design check passes for all three characters; a misplaced character fails |
| J6 a changed rig, material or action reopens the right stages | the resolved character spec joins the design fingerprint | editing a referenced spec changes the design fingerprint; an unrelated library spec does not |
| J7 reviews see the stage truthfully | stage facts name character and resolved rig identity | stage evidence carries character and rig identity; numerical result stays separate from unmeasured craft (see [REVIEW.md](REVIEW.md)) |
| J9 existing SVG and template films unchanged | no change to the SVG path | full existing suite; legacy design.json with `asset`/`rig` still builds |

Journeys the brief's list missed, added here:

- **J13 approve a character by eye.** Every character has a model sheet (front, three-quarter,
  side, silhouette) and an expression sheet rendered from the same geometry the stage uses, so
  the captain judges the real art, not a separate drawing.
- **J14 stale embedded character.** A compiled film carries the resolved spec. If that copy is
  edited by hand or drifts from its hash, the stage and the build refuse it instead of rendering
  a character nobody checked.

## Risks this part must hold

| Risk | Mitigation and test |
|---|---|
| Overfitting to Iona: hardcoded joints, proportions, reach | the engine derives every length, reach, stance and grip from the spec; property tests retarget onto 180 randomly proportioned skeletons and check fixed bone lengths, planted soles, reach under the limit, joint limits, contact on the cue, seam continuity and seek order |
| Iona's look drifts during promotion | CPU geometry equality between the spec build and the frozen legacy module (positions, normals, indices, UVs, materials, outline widths, hierarchy); in-browser pixel A/B between the two in the same run; production FilmView stills byte-identical to the merged slice |
| Pixel tests differ between machines | the CPU geometry tests are the platform-independent gate; pixel comparisons run A/B inside one browser run, and the committed golden uses SwiftShader and a measured tolerance; browser tests skip when no Chrome is installed |
| Unreachable target gives NaN or a pop | limits are enforced on the action before runtime so the solver's hard clamp never engages; fail policy throws a named error with limb, frame and distances; clamp policy edits sparse keys so motion stays C1; property tests assert finite states and continuous seams |
| State kept between frames breaks out-of-order rendering | apply assigns root, joints, swing pieces, expression and prop in full every frame; permuted-order test |
| Tampered or missing resources render anyway | pure synchronous SHA-256 verifies the spec in Node and in the browser bundle; builder code stays frozen in the stage registry |
| Schema churn breaks the other parts | legacy `asset: "iona-art-v1"` design form normalizes to `character: "iona"` without rewriting packages; exported types documented here |
| Three.js weight and memory on a 16 GB Mac | each character reports triangles and draw parts; a budget test caps them; resources are owned per instance and disposed |
| Mirrored parts render inside out | tube normals are tested to point outward on both sides |
| Art quality cannot be unit tested | sheets and stills for the captain's eye; numerical passes never claim appeal |

## Test layers

Static: file headers, eslint, root type-check, editor build (which type-checks the editor). Unit and feature:
`backend/characters/characters.test.ts` (schema, hash, rig, expansion, field-named errors, budgets,
Iona exactness, outward normals, seek-order independence, library resolution, `check --stamp`).
Property and regression: `backend/journeys/character_retarget.journey.ts` (every character, fail and clamp
policies, unreachable targets, planted feet, J2 rebinding, 180 random proportions, the elbow snap).
Journey: `backend/journeys/characters.journey.ts` (J3, J5, J6, J7, J8, J10, J14, several characters on
one stage), `backend/journeys/j4_character_crops.journey.ts` (J4 safe-square, caption and inset
clearance for Iona, Pip and Marlo), plus the existing stage tests. Browser:
`backend/journeys/character_pixels.journey.ts` (legacy versus spec pixels, golden, both crops, committed Pip and
Marlo stage stills, sheets), skipped without Chrome unless
`AIDEOS_BROWSER_TESTS_REQUIRED=1`; refresh the golden with `AIDEOS_UPDATE_GOLDENS=1`. Visual: sheets
reviewed by eye.

## How it fits together

| Layer | Module | Contract |
|---|---|---|
| Spec | `src/dl/characters/schema.ts`, `validate.ts`, `hash.ts`, `sha256.ts` | strict Zod schema; semantic issues with field paths; canonical JSON and a synchronous SHA-256 that runs in Node and the browser |
| Rig | `src/dl/characters/rig.ts` | humanoid joints in the approved rig's order, four limbs, sockets and limits (`CharacterRig`) |
| Parts | `src/dl/characters/expand.ts`, `src/dl/scene/characters/` | mirror groups and limb, torso and hand generators expand into tube, head, panel and facets primitives; the builder makes cel geometry, ink outlines and the painted face; `applyCharacter` assigns every channel per frame |
| Action | `src/dl/performance/retarget.ts`, `limits.ts`, `critique.ts`, `evaluate.ts`, `math.ts`, `span.ts` | frozen receive fitting, evaluation, geometry and acceptance logic; changes reopen design through the stage identity |
| Film | `backend/designSpec/{spec,compile,build}.ts`, `src/dl/scene/stageContract.ts` | design names `character: <id>`; build resolves package then library, verifies the hash, embeds the spec in `scene.cast` and records `retarget.characterHash` on each fitted receive; stage validation refuses a receive fitted to different character content; P0 `asset: iona-art-v1` designs still build |
| Stage | `ThreeStage.tsx`, `stageFacts.ts`, `stageMaterials.ts`, `validateStage.ts` | no separate performance-count cap; the design allows up to 40 total stage assets and 1500 authored clips; the embedded spec is re-verified before any geometry is allocated; each performer's declared material colours come from its own spec palette plus its prop's; every raw face texture colour must be one of that finite palette, case-insensitively |
| Tools | `backend/characters/{library,cli,sheet}.ts` | `aideos character check|sheet`; check reports receive channels without accessory bindings as informational rest notes |

Retargeting (`retargetReceive`): the hips crouch and sway scale by leg length so knees bend through
the same angles; planted ankles stand at the target's rest stance with the sole socket on the
ground; grip keys keep their offset from the moving shoulder scaled by arm reach, so the arm uses
the same fraction of its length; the glider's flight keeps its shape and is translated to the new
contact; every elbow pole key is re-aimed to keep the reference's designed bend direction about the
new arm axis. Then rotation limits clamp or refuse authored keys, and reach and hinge limits pull
sparse grip keys in (clamp) or throw `ReceiveRetargetError` naming the field, limb and frame
(fail). A planted foot that cannot stay planted is always refused. Retargeting onto Iona herself
returns the reference unchanged.

Accessory follow-through is optional. When a character has no piece bound to a receive channel,
`applyCharacter` maps that channel to zero motion and bound pieces remain at their authored pose.
`aideos character check` reports each unbound channel as an informational note; it does not block
the character or add a design-build warning.

## Decisions

- **Embed the resolved spec in the compiled film** rather than generating a browser module of the
  library: the film stays self-contained, review and editor read exactly what renders, and the
  stage can re-verify the hash. A spec is 10 to 20 KB.
- **Fixed humanoid joint names with mirrored left-side proportions**, plus optional extra joints:
  the receive needs semantic arms and legs, and mirroring removes a whole class of authoring error.
  Non-humanoid rigs would be a new schema id.
- **Two part layers**: exact primitives (Iona's spec is written in them, bit-identical to the legacy
  module) and skeleton-driven generators (limb, torso, hand) so new characters follow their own
  proportions without hand-placed points.
- **Hash the defaulted spec**: changing a schema default changes identity, which is what it does
  to the rendered art.
- **Policy is authored per performance** (`limits: "fail" | "clamp"`, default `fail`), so a clamp is a
  visible decision recorded in the compiled film and reported by the design check.
Compiled retarget warnings are provenance: stage validation checks their consistency with the
recorded policy, including that a `fail` policy cannot carry warnings, before review facts are published.
- **Elbow repair in the reference action.** The approved receive's left pole ran within 2 degrees of
  the arm axis, snapping the elbow 0.80 rig units in one frame; the key-seam critique could not see
  it. In-between pole keys now roll each elbow evenly (approved keys, contact pose and hold
  unchanged) and `pole-clearance` guards it.

## What is general now, and what is still Iona-specific

General: the character format, the part builder, the face painter (two eye styles), materials and
outlines, expressions, swing channels, rigs, limits, the retargeted receive, stage rendering,
stage facts, validation, the design and film character reference, resume fingerprints and the
authoring tools. Three characters prove it; random proportions are property-tested.

Still Iona-specific, by design: `receive-v1` itself is authored on Iona's rig (`IONA_RIG` is the
retarget source, and the library spec must derive it exactly); its expression names and its three
swing channels are the action's vocabulary; the glider is the only prop; there is one action.
`cel-v1` remains the default shading, with optional dots documented in
[`characters/README.md`](../characters/README.md#optional-dots-treatment). The exact P0 `iona-art-v1` cast record remains a browser-safe
alias of the stamped Iona character spec so compiled films keep rendering; rebuilding its design
picks up the repaired pole clearance. Look-plan authoring, adherence scoring, Gemini facts and review truth for characters
are part 4, documented in [THREE_STAGE_P3.md](THREE_STAGE_P3.md).

The frozen stage identity covers the character, prop and receive engine files that determine
rendered output and fitted actions, including evaluation and acceptance critique. The optional dots
material and sampler have their own frozen hash, required only by films that use dots; changing them
does not change the cel identity. Both identities exclude `validateStage.ts`, `stageMaterials.ts`
declarations and design-check rules: those checks run at every build and render, while compiled films
carry the relevant frozen hash. This avoids invalidating every compiled film for a rule change; stale
films are refused with a named error before drawing.

The separate CI part owns the GitHub workflow and pull request checks. This part contributes its
character suites to `npm test` for that workflow to run.

## Verification record

- `npm test` (rebased on the part 2 stage design gates): 874 pass, 0 fail, 3 pre-existing
  intentional skips. New suites: `characters.test.ts` (16), `retarget.test.ts` (10, including 120 + 60 random-proportion cases),
  `journeys.test.ts` (10), `pixels.test.ts` (2, headless Chrome on software GL).
- Lint gate: headers, eslint, root type-check, editor build (which type-checks the editor); `smoke:studio` and the
  example `validate` pass.
- Iona promotion: CPU geometry, materials, outlines, hierarchy and mesh order are bit-identical to
  the frozen P0 module; spec-built and legacy Iona are pixel-identical in the same browser; the real
  P0 film rebuilt through the new engine renders byte-identical production stills (frames 0, 60,
  108 and 200, wide and reel) to the merged slice.
- New characters through production: the narrated P0 package with Marlo (and Pip) swapped in builds,
  passes the both-crop design check and renders through FilmView. Pip and Marlo also pass the part 2
  stage gates (every-frame safe region with margin, prop depth evidence, held carry, character-owned
  palette); two characters share one stage in a journey test. A stale P0-compiled film is refused by
  the real renderer with the named rebuild error instead of drawing a blank. Marlo wide and reel rendered at
  concurrency 2 (25.8 s and 25.6 s, about 1.05 MB each); the measured review passes every gate except
  the fixed camera, the same profile as the merged P0 slice.
- Craft for the captain's eye: model sheets, expression sheets and receive stills from
  `aideos character sheet`. Observed: Pip's catch lands at eye level, so the glider passes in front
  of the face at contact (a small upward `targetOffset` lifts it); limbs remain rigid tube sections
  like Iona's.

## Optional surface dots

The stage can render the same embedded spec and action as `dots-v1`. Authoring
fields and the dot sheet command are in `characters/README.md` (Optional dots
treatment). `src/dl/scene/materials/dotSamples.ts` owns seeded Poisson rejection samples;
`src/dl/scene/materials/dots.ts` attaches them to the existing rigid mesh hierarchy and
retains depth, outlines and painted monochrome face features. The dots resource
freeze is independent of the cel freeze. Treatment switches use absolute film
frames and never alter the character specification or action evaluator.
