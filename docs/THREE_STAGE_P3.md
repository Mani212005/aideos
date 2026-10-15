<!--
File Description: Draft PR description and test plan for P3 (look plan and review truth for characters), recorded before implementation and kept updated with what landed.
-->

# Look plan and review truth for characters (P3)

Draft PR description and test plan, recorded before implementation. This change owns the look-first
flow and the reviewers for character films: `backend/lookPlan/`, plan adherence and stage facts in
`backend/review/`, `backend/geminiReview/`, the all-check brief, the MCP look tools, resume hashing
for characters and the J2, J6 and J7 journeys. The character format (part 1), stage gates (P2) and
CI (part 3) keep their owners.

## Journeys and the tests that hold them

| Journey | What this part changes | Tests |
| --- | --- | --- |
| J2 narration changes after design | The contact follows the new cue; review compares the action's own contact frame with the cue it resolves from the words | `j2_retime.journey.ts` (real pipeline: retimed narration moves the compiled contact to the new word, design and render rerun, the old mp4 is not reused); `review.test.ts` (a contact off its cue fails plan adherence and cue timing) |
| J6 resume reopens exactly the right stages | The look hash and the design fingerprint include the resolved character hashes | `pipeline.test.ts` (unchanged rerun reuses every stage; a package character edit reruns design and everything after it while intake, narrate and look are reused); `j6_resume.journey.ts` (the same with real renders) |
| J7 reviews see the 3D stage truthfully | Format-indexed presence and camera, plain-word facts for Gemini, unmeasured craft named, missing evidence never a pass | `review.test.ts`, `geminiReview.test.ts`, `j7_review_truth.journey.ts` (measured review and Gemini facts on the real wide and reel renders) |
| J8 failures give a named error | Look check names the performance and field for an unknown or unresolvable character, a version mismatch, a missing character, a decisive shot that does not list its performance and a one-sided look/design performance | `lookPlan.test.ts`, `characterPlan.test.ts` |
| J10 an agent authors from the docs | LOOK_BRIEF lists the available characters with id, version and hash and explains performances; all-check brief, MCP look tools and the look task mention `aideos character check` and `aideos character sheet` | `lookPlan.test.ts`, `characterPlan.test.ts`, `allCheck.test.ts`, `mcp.test.ts` |
| J9 existing SVG films unchanged | SVG plan adherence keeps the clip-start rule and its facts do not depend on the reviewed format | existing `review.test.ts` SVG cases plus a format-independence regression |

## Risks and the check that watches each

| Risk | Check |
| --- | --- |
| A performance passes adherence because the recorded decisive frame equals the cue by construction | Adherence measures the receive's own contact frame (`data.contact.frame`) against the cue resolved independently from the timed words |
| Presence measured in the wrong crop (the review used the reel projection for every video) | Film facts take the reviewed viewport; the long and reel reviews read their own projection |
| A hidden (undriven) or off-frame cast member counted as present | Only performance-driven cast is drawn; presence needs a drawn cast whose projected box lies mostly inside the viewport (`THRESHOLDS.planAdherence.stagePresentShareMin`) |
| Camera moves counted in scene units, not on screen | Three-stage camera facts come from the compiled camera projected into each output |
| Gemini told a character is "visible" from geometry alone | Facts say "projected inside the frame"; raster visibility, final occlusion, face appeal and finger contact are listed as unmeasured, and the prompt says unmeasured is never a pass |
| A reviewer reply without timestamp evidence still ends in ACCEPT | Criteria still missing evidence after the last attempt are failed and the verdict is REVISE |
| A character art edit reuses a stale design or render | The look hash and design fingerprint include resolved character hashes; pipeline test plus J6 |
| Pinning the character hash in the look plan forces a look rewrite for every art tweak | The version is identity (a mismatch is an error); a hash that differs within the same version is a warning, and design and render rebuild |
| Prompt bloat from raw stage JSON | Facts are a compact per-format summary; the full evidence stays in review.json |

## Decisions

- A look performance names `character: {id, version, hash}`. The id must be the actor cast's
  character and must resolve (package, then library) to a verified spec. A different `version` is a
  different approved character and fails the look check. A different `hash` with the same version is
  reported as a warning naming both hashes: the art changed since the plan, design and render rebuild
  on their own, and editing the hash records that the plan still holds. This keeps "a character edit
  reopens design and render, not the look" true.
- Plan adherence stays non-gating (as on SVG films). Its threshold values live in `thresholds.ts`.
- Presence counts a drawn cast member when at least half of its projected posed box lies inside the
  output (`stagePresentShareMin: 0.5`), and contact must land within one frame of the word
  (`contactCueToleranceFrames: 1`, the rounding of a word time to a frame). Both are in
  `backend/review/thresholds.ts`, next to the SVG plan-adherence values, and stay non-gating.
- A stage film without camera keyframes holds the centred wide camera, which satisfies a planned
  "wide" pose in plan adherence; SVG films keep needing ordered keyframes.

## What landed

- `backend/lookPlan/`: `character: {id, version, hash}` on look performances; `aideos.look/2`
  rejects unknown fields at every nested object boundary while `aideos.look/1` retains its legacy
  parsing behavior. The plan union is discriminated on `schema`, so a v2 error names its field
  instead of "Invalid input"; the check
  resolves characters through `packageCharacterResolver`, ties the decisive shot and each design
  performance's character to the plan, and `readCheckedLookPlan` refuses a `start` that is not before
  the decisive word. `LOOK_BRIEF.md` gains a "Character films" section with the characters a film can
  name and a worked plan pinned to a real character; `LOOK.md` says each performance in plain words and
  marks the decisive shot (the strip Gemini reads).
- `backend/review/`: film facts take the reviewed viewport; Three presence, the camera and the
  evaluated contact are per output; `stageTruth.ts` is the one summary both reviewers read, including
  resolved character and rig identities; criterion
  13 judges performances by contact against the decisive word and cue timing uses contact frames.
- `backend/geminiReview/`: stage facts in plain words per output, the stage camera from the projected
  track, a prompt rule that facts never pass a criterion alone, and REVISE whenever a criterion lacks
  evidence after the last attempt.
- `backend/pipeline/run.ts`: `lookPlanFingerprint` (look plus the characters it names) feeds the
  design fingerprint; a cached design rebuilds under the film's recorded source.
- All-check brief, MCP look tools, the server instructions and the look task name the character
  commands.

## What the list missed (found while building)

- **The review measured presence in the reel crop for every video**: a long-cut review counted the
  reel's presence. Fixed: facts take the viewport (J7).
- **An unchanged rerun of a hand-built design re-assembled and re-rendered**: the cached design stage
  rebuilt it as `agent`, which changed film.json. Fixed and held by J6 and `characterResume.test.ts`.
- **A Gemini reply still missing evidence after the last attempt could ACCEPT.** Fixed.
- **The Gemini facts pasted the whole projected stage JSON** (part boxes for every boundary). Replaced
  by the compact per-output summary.
- **Gemini's caption override filled placeholder timestamps** ("0:00-0:10") when OCR measured
  captions, so evidence validation passed on invented times. It now cites the sampled frames OCR read.
- Verify always re-probes outputs on resume (its warnings belong to every run); J6 expects that.

## Known gaps (skipped by scope)

- A remote MCP agent (`aideos connect`) has no shell and cannot write `characters/<id>.character.json`,
  so it can name library or package characters but not author new ones; authoring stays a shell task
  (`aideos character check|sheet`).
- A decisive phrase spoken more than once in its shot is refused by the look check and design build
  (`wordOnce`), which names the ambiguous cue so the author can choose a phrase spoken once.
