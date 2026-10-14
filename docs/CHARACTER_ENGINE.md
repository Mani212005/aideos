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
| J7 reviews see the stage truthfully | stage facts name character id, version and hash | stage evidence carries character identity; numerical result stays separate from unmeasured craft |
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
| Overfitting to Iona: hardcoded joints, proportions, reach | the engine derives every length, reach, stance and grip from the spec; property tests retarget onto 200 randomly proportioned skeletons and check fixed bone lengths, planted soles, reach under the limit, joint limits, contact on the cue, seam continuity and seek order |
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

Static: file headers, eslint, root and editor type-checks, editor build. Unit and property:
`backend/characters/characters.test.ts` (spec, hash, rig, limits, retarget, property runs).
Feature: good and bad fixture specs, compile and design check through the fixture package.
Journey: `backend/characters/journeys.test.ts` (J5, J8, J10, J14) plus the existing stage tests.
Regression: every defect found gets a named test. Browser: `backend/characters/pixels.test.ts`
(A/B equality and golden), skipped without Chrome. Visual: sheets reviewed by eye.

## Verification record

Filled in as the work lands.
